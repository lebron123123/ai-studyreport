/* Project Brain：统一项目上下文、四类信息和投资全周期阶段模型。 */
(function(root){
  "use strict";
  const PB_FACT_TYPES={FACT:"事实",ASSUMPTION:"假设",CALCULATION:"计算结果",AI_JUDGEMENT:"AI判断"};
  const PB_STAGES=[
    {key:"discovery",label:"项目发现",progress:8,deliverables:["机会来源","初始项目线索"]},
    {key:"screening",label:"初步研判",progress:18,deliverables:["政策适配初判","区位与需求初判","财务边界"]},
    {key:"initiation",label:"立项",progress:30,deliverables:["立项材料","审批要求","项目计划"]},
    {key:"feasibility",label:"可研与尽调",progress:48,deliverables:["可研报告","财务测算","尽调资料"]},
    {key:"decision",label:"投资决策",progress:65,deliverables:["方案比较","决策台账","签发包"]},
    {key:"implementation",label:"项目实施",progress:78,deliverables:["工期计划","投资计划","合同与变更"]},
    {key:"post_investment",label:"投后管理",progress:90,deliverables:["经营指标","预算偏差","投后风险"]},
    {key:"exit_review",label:"退出与复盘",progress:100,deliverables:["退出结论","项目复盘","知识沉淀"]}
  ];
  const PB_STAGE_MAP=Object.fromEntries(PB_STAGES.map(x=>[x.key,x]));
  const clone=x=>JSON.parse(JSON.stringify(x==null?null:x));
  const arr=x=>Array.isArray(x)?x:[];
  const text=(x,n=240)=>String(x==null?"":x).trim().slice(0,n);
  function pbJson(x,fallback={}){try{return typeof x==="string"?JSON.parse(x):x==null?fallback:x;}catch(_){return fallback;}}
  function pbId(prefix="pb"){return prefix+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);}
  function pbStage(value){return PB_STAGE_MAP[value]||PB_STAGE_MAP.feasibility;}
  function pbLegacyStage(data){
    data=data||{};const mg=data.workflow&&data.workflow.management||{},explicit=mg.investmentStage||data.project&&data.project.investmentStage;
    if(PB_STAGE_MAP[explicit])return explicit;
    if(data.signed)return "decision";
    if(arr(data.chapters).length||data.calcParams||data.suggested)return "feasibility";
    if(data.project&&data.project.name)return "screening";
    return "discovery";
  }
  function pbFact(input){
    input=input||{};const factType=PB_FACT_TYPES[input.factType]?input.factType:"FACT";
    return {id:text(input.id,100)||pbId("fact"),factType,factKey:text(input.factKey||input.key,120),label:text(input.label||input.factKey||input.key,160),
      value:clone(input.value),unit:text(input.unit,30),sourceType:text(input.sourceType||"manual",40),sourceRef:text(input.sourceRef,300),
      confidence:Math.max(0,Math.min(1,Number(input.confidence==null?1:input.confidence)||0)),status:["candidate","confirmed","superseded","rejected"].includes(input.status)?input.status:"candidate",
      validFrom:text(input.validFrom,30),validTo:text(input.validTo,30),version:Math.max(1,Number(input.version)||1)};
  }
  function pbLegacyFacts(data){
    const p=data&&data.project||{},out=[];
    [["project.name","项目名称",p.name],["project.location","项目位置",p.location],["project.type","项目类型",p.type],["project.owner","项目负责人",p.owner]].forEach(([factKey,label,value])=>{
      if(value!==undefined&&value!==null&&String(value).trim()!=="")out.push(pbFact({id:"legacy:"+factKey,factKey,label,value,factType:"FACT",sourceType:"project",sourceRef:"projects.data.project",status:"confirmed"}));
    });
    const calc=data&&data.calcParams||{};Object.keys(calc).slice(0,120).forEach(k=>out.push(pbFact({id:"legacy:param:"+k,factKey:"param."+k,label:k,value:calc[k],factType:"ASSUMPTION",sourceType:"calculation_input",sourceRef:"projects.data.calcParams",status:data.paramsConfirmed?"confirmed":"candidate"})));
    const summary=data&&data.calcSummary||{};Object.keys(summary).slice(0,80).forEach(k=>out.push(pbFact({id:"legacy:metric:"+k,factKey:"metric."+k,label:k,value:summary[k],factType:"CALCULATION",sourceType:"whitebox",sourceRef:"projects.data.calcSummary",status:"confirmed"})));
    return out;
  }
  function pbLegacyMetrics(data){
    const summary=data&&data.calcSummary||{};
    return Object.keys(summary).slice(0,80).map((key,i)=>({id:"legacy-metric:"+key,metricKey:key,label:key,value:clone(summary[key]),unit:"",calcSnapshotId:data&&data.workflow&&data.workflow.currentCalcSnapshotId||"",lineage:{source:"projects.data.calcSummary",type:"whitebox"},version:1,updatedAt:0,legacyOrder:i}));
  }
  function pbLegacyArtifacts(data){
    const workflow=data&&data.workflow||{},out=[];
    const calc=arr(workflow.calcSnapshots).slice(-1)[0];if(calc)out.push({id:"legacy-artifact:calc:"+(calc.id||calc.version||1),artifactType:"calculation",title:"财务测算快照",moduleRef:"calc",version:String(calc.version||""),status:"current",meta:{calcType:calc.calcType||""}});
    const report=arr(workflow.reportVersions).slice(-1)[0];if(report)out.push({id:"legacy-artifact:report:"+(report.id||report.version||1),artifactType:"report",title:"可研报告版本",moduleRef:"aireport",version:String(report.version||""),status:data&&data.signed?"signed":"draft",evidenceAuditId:report.evidenceAudit&&report.evidenceAudit.hash||""});
    if(data&&data.signed&&!report)out.push({id:"legacy-artifact:signed-report",artifactType:"report",title:"已签发可研报告",moduleRef:"aireport",version:"",status:"signed"});
    return out;
  }
  function pbBuildContext(input){
    input=input||{};const data=input.data||{},project=data.project||{},stageKey=input.stageKey||pbLegacyStage(data),stage=pbStage(stageKey);
    const chapters=arr(data.chapters),sections=chapters.flatMap(c=>arr(c.sections)),workflow=data.workflow||{};
    const facts=[...pbLegacyFacts(data),...arr(input.facts)].reduce((m,x)=>{const f=pbFact(x),old=m.get(f.factKey);if(!old||Number(f.version)>=Number(old.version))m.set(f.factKey,f);return m;},new Map());
    const metrics=[...pbLegacyMetrics(data),...arr(input.metrics)].reduce((m,x)=>{const k=x.metricKey||x.id,old=m.get(k);if(!old||Number(x.version||1)>=Number(old.version||1))m.set(k,x);return m;},new Map()),artifacts=[...pbLegacyArtifacts(data),...arr(input.artifacts)].reduce((m,x)=>{m.set(x.id||x.moduleRef+":"+x.artifactType,x);return m;},new Map()),decisions=arr(input.decisions),events=arr(input.events),changes=arr(input.changes);
    const missingFacts=[...facts.values()].filter(x=>x.status!=="confirmed").length;
    return {schemaVersion:1,project:{id:text(input.projectId,100),name:text(input.name||project.name||"未命名项目",160),type:text(project.type,50),location:text(project.location,200),owner:text(project.owner,100)},
      lifecycle:{current:stageKey,label:stage.label,progress:stage.progress,stages:clone(PB_STAGES)},
      summary:{facts:facts.size,confirmedFacts:facts.size-missingFacts,missingFacts,metrics:metrics.size,artifacts:artifacts.size,decisions:decisions.length,openDecisions:decisions.filter(x=>x.status!=="adopted"&&x.status!=="closed").length,events:events.length,changes:changes.length,chapters:chapters.length,sections:sections.length,generatedSections:sections.filter(s=>text(s.editedHtml||s.content,10)).length,calcVersions:arr(workflow.calcSnapshots).length,reportVersions:arr(workflow.reportVersions).length,materials:arr(data.kb).length},
      facts:[...facts.values()],metrics:[...metrics.values()],artifacts:[...artifacts.values()],decisions,events,changes,updatedAt:Number(input.updatedAt)||0};
  }
  function pbPreviewChange(input){
    input=input||{};const before=input.before||{},after=input.after||{},keys=[...new Set(arr(input.changedKeys).concat(Object.keys(after).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]))))];
    const graph=input.dependencyGraph||{},parameters=arr(graph.parameters),metrics=arr(graph.metrics),sections=arr(graph.sections),edges=arr(graph.edges),changedParamIds=new Set();
    keys.forEach(k=>parameters.filter(p=>p.key===k||p.id===k||String(p.id).endsWith(":"+k)).forEach(p=>changedParamIds.add(p.id)));
    const metricIds=new Set(edges.filter(e=>changedParamIds.has(e.from)).map(e=>e.to)),sectionIds=new Set(edges.filter(e=>metricIds.has(e.from)||changedParamIds.has(e.from)).map(e=>e.to));
    return {schemaVersion:1,changedKeys:keys,changedValues:keys.map(key=>({key,before:before[key],after:after[key]})),affectedMetrics:metrics.filter(x=>metricIds.has(x.id)),affectedSections:sections.filter(x=>sectionIds.has(x.id)),requiresApproval:keys.length>0};
  }
  const api={FACT_TYPES:PB_FACT_TYPES,STAGES:PB_STAGES,stage:pbStage,legacyStage:pbLegacyStage,normalizeFact:pbFact,legacyFacts:pbLegacyFacts,legacyMetrics:pbLegacyMetrics,legacyArtifacts:pbLegacyArtifacts,buildContext:pbBuildContext,previewChange:pbPreviewChange,id:pbId,json:pbJson};
  root.ProjectBrain=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
