/* 可研业务任务图：节点依赖、幂等执行、语义 Checkpoint 与局部失效。 */
(function (root, factory) {
  const api = factory(root && root.ProjectContextContract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ReportTaskGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (ContextContract) {
  "use strict";

  const STATUS = Object.freeze({
    PENDING:"pending", READY:"ready", RUNNING:"running", WAITING_APPROVAL:"waiting_approval",
    PAUSED:"paused", COMPLETED:"completed", FAILED:"failed", INVALIDATED:"invalidated", CANCELLED:"cancelled"
  });
  const DEFINITIONS = Object.freeze([
    {key:"material_parse",label:"材料解析",dependsOn:[],reads:["projectFiles"],writes:["projectFacts"]},
    {key:"fact_confirm",label:"事实确认",dependsOn:["material_parse"],reads:["projectFacts"],writes:["confirmedFacts"],requiresApproval:true},
    {key:"data_gap",label:"数据缺口判断",dependsOn:["fact_confirm"],reads:["confirmedFacts","financialParameters"],writes:["dataRequirements"]},
    {key:"data_acquire",label:"必要数据获取",dependsOn:["data_gap"],reads:["dataRequirements","projectFiles","knowledge"],writes:["candidateEvidence"]},
    {key:"evidence_adopt",label:"证据采纳",dependsOn:["data_acquire"],reads:["candidateEvidence"],writes:["evidence"],requiresApproval:true},
    {key:"financial_calc",label:"财务测算",dependsOn:["fact_confirm","evidence_adopt"],reads:["confirmedFacts","financialParameters","evidence"],writes:["financialResults"]},
    {key:"content_generate",label:"报告生成",dependsOn:["financial_calc"],reads:["confirmedFacts","financialResults","evidence","rules","tableTemplate","reportTemplate"],writes:["report"]},
    {key:"consistency_review",label:"一致性复核",dependsOn:["content_generate"],reads:["report","financialResults","evidence"],writes:["reviewResult"]},
    {key:"word_export",label:"Word 导出",dependsOn:["consistency_review"],reads:["report","reviewResult"],writes:["wordArtifact"]},
    {key:"human_signoff",label:"人工签发",dependsOn:["word_export"],reads:["wordArtifact","reviewResult"],writes:["signedArtifact"],requiresApproval:true}
  ]);

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function stable(value){
    if(ContextContract && ContextContract.stableStringify) return ContextContract.stableStringify(value);
    if(value===null||typeof value!=="object") return JSON.stringify(value);
    if(Array.isArray(value)) return "["+value.map(stable).join(",")+"]";
    return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
  }
  function hash(value){
    const text=stable(value);
    if(ContextContract && ContextContract.sha256) return "sha256:"+ContextContract.sha256(text);
    let h=2166136261;for(let i=0;i<text.length;i+=1){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return "fnv1a:"+(h>>>0).toString(16).padStart(8,"0");
  }
  function refresh(graph){
    const byKey=new Map(graph.nodes.map(n=>[n.key,n]));
    graph.nodes.forEach(node=>{
      if(node.status===STATUS.PENDING||node.status===STATUS.INVALIDATED){
        const ready=node.dependsOn.every(key=>byKey.get(key)&&byKey.get(key).status===STATUS.COMPLETED);
        if(ready) node.status=STATUS.READY;
      }
    });
    graph.status=graph.nodes.every(n=>n.status===STATUS.COMPLETED)?STATUS.COMPLETED:
      graph.nodes.some(n=>n.status===STATUS.FAILED)?STATUS.FAILED:
      graph.nodes.some(n=>n.status===STATUS.WAITING_APPROVAL)?STATUS.WAITING_APPROVAL:
      graph.nodes.some(n=>n.status===STATUS.PAUSED)?STATUS.PAUSED:STATUS.RUNNING;
    graph.updatedAt=new Date().toISOString();
    return graph;
  }
  function create(input){
    input=input||{};const graph={schemaVersion:1,workflowId:String(input.workflowId||"workflow-"+Date.now()),runId:String(input.runId||""),projectId:String(input.projectId||""),contextId:String(input.contextId||""),contextHash:String(input.contextHash||""),status:STATUS.RUNNING,createdAt:input.createdAt||new Date().toISOString(),updatedAt:"",nodes:DEFINITIONS.map((d,index)=>({...clone(d),order:index+1,status:index===0?STATUS.READY:STATUS.PENDING,inputHash:"",executionKey:"",resultVersion:0,output:null,error:"",checkpoint:null}))};return refresh(graph);
  }
  function find(graph,key){const node=graph.nodes.find(n=>n.key===key);if(!node)throw new Error("未知任务节点："+key);return node;}
  function start(graph,key,input){const next=clone(graph),node=find(next,key);if(![STATUS.READY,STATUS.FAILED].includes(node.status))throw new Error("节点当前不可执行："+key);node.inputHash=hash(input||{});node.executionKey=key+":"+node.inputHash;node.status=STATUS.RUNNING;node.error="";return refresh(next);}
  function complete(graph,key,input,output){
    const next=clone(graph),node=find(next,key),inputHash=hash(input||{}),executionKey=key+":"+inputHash;
    if(node.status===STATUS.COMPLETED&&node.executionKey===executionKey)return {graph:next,reused:true,node};
    const depsOk=node.dependsOn.every(dep=>find(next,dep).status===STATUS.COMPLETED);if(!depsOk)throw new Error("前置节点尚未完成："+key);
    node.inputHash=inputHash;node.executionKey=executionKey;node.output=clone(output==null?{}:output);node.resultVersion=(Number(node.resultVersion)||0)+1;node.error="";node.status=node.requiresApproval&&!(output&&output.approved===true)?STATUS.WAITING_APPROVAL:STATUS.COMPLETED;node.checkpoint={nodeKey:key,resultVersion:node.resultVersion,inputHash,completedAt:new Date().toISOString()};return {graph:refresh(next),reused:false,node};
  }
  function approve(graph,key,note){const next=clone(graph),node=find(next,key);if(node.status!==STATUS.WAITING_APPROVAL)throw new Error("节点不在待审批状态："+key);node.status=STATUS.COMPLETED;node.output=Object.assign({},node.output||{},{approved:true,approvalNote:String(note||"")});node.checkpoint=Object.assign({},node.checkpoint||{},{approvedAt:new Date().toISOString()});return refresh(next);}
  function fail(graph,key,error){const next=clone(graph),node=find(next,key);node.status=STATUS.FAILED;node.error=String(error&&error.message||error||"执行失败");return refresh(next);}
  function invalidate(graph,changedResources){
    const next=clone(graph),changed=new Set((changedResources||[]).map(String)),invalidated=[];let expanded=true;
    while(expanded){expanded=false;next.nodes.forEach(node=>{if([STATUS.COMPLETED,STATUS.WAITING_APPROVAL,STATUS.FAILED].includes(node.status)&&node.reads.some(x=>changed.has(x))){node.status=STATUS.INVALIDATED;node.output=null;node.error="";invalidated.push(node.key);node.writes.forEach(x=>{if(!changed.has(x)){changed.add(x);expanded=true;}});}});}
    next.nodes.forEach(node=>{if(invalidated.includes(node.key))node.checkpoint={invalidatedAt:new Date().toISOString(),changedResources:[...changed].sort()};});return {graph:refresh(next),invalidated,changedResources:[...changed].sort()};
  }
  function pause(graph,reason){const next=clone(graph);next.nodes.filter(n=>n.status===STATUS.RUNNING||n.status===STATUS.READY).forEach(n=>{n.status=STATUS.PAUSED;n.error=String(reason||"");});return refresh(next);}
  function resume(graph){const next=clone(graph);next.nodes.filter(n=>n.status===STATUS.PAUSED).forEach(n=>{n.status=STATUS.PENDING;n.error="";});return refresh(next);}
  function readyNodes(graph){return graph.nodes.filter(n=>n.status===STATUS.READY).map(clone);}
  function checkpoint(graph){return {schemaVersion:1,workflowId:graph.workflowId,contextId:graph.contextId,contextHash:graph.contextHash,status:graph.status,nodes:graph.nodes.map(n=>({key:n.key,status:n.status,inputHash:n.inputHash,executionKey:n.executionKey,resultVersion:n.resultVersion,checkpoint:n.checkpoint}))};}
  return Object.freeze({STATUS,DEFINITIONS,create,start,complete,approve,fail,invalidate,pause,resume,readyNodes,checkpoint,hash});
});
