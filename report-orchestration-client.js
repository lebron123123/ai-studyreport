/* AI可研任务编排、最少查询与反馈学习的浏览器调用入口。 */
(function(root){
  "use strict";
  async function request(method,payload,query){
    const suffix=query?"?"+new URLSearchParams(query).toString():"";
    const response=await fetch("/api/reportorchestration"+suffix,{method,headers:Object.assign({"Content-Type":"application/json"},root.authHeaders?root.authHeaders():{}),body:payload===undefined?undefined:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({ok:false,error:"服务返回格式异常"}));
    if(!response.ok||!data.ok)throw new Error(data.error||"可研智能编排请求失败");
    return data;
  }
  const api={
    async generateSection(input,onTask){
      async function execute(method,payload,id){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch('/api/reportexecution'+(id?'?id='+encodeURIComponent(id):''),{method,signal:controller.signal,headers:Object.assign({'Content-Type':'application/json'},root.authHeaders?root.authHeaders():{}),body:payload?JSON.stringify(payload):undefined});
          const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'后台报告任务不可用');return data.task;
        }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw new Error('连接后台任务失败，已有任务不会丢失；恢复连接后重试同一小节');throw e;}
        finally{clearTimeout(timer);}
      }
      const task=await execute('POST',input);if(onTask)onTask(task);
      const deadline=Date.now()+180000;
      while(Date.now()<deadline){
        const state=await execute('GET',null,task.id);if(onTask)onTask(state);
        if(state.status==='completed'){if(!state.text)throw new Error('后台任务未保留正文，请检查调用台账');return state;}
        if(['dead','cancelled','invalidated','missing'].includes(state.status))throw new Error(state.error||'任务已停止；记录已保留，请检查后台任务状态');
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      throw new Error('后台仍在处理，任务已保存；稍后继续同一小节将恢复已有任务，不会重复提交');
    },
    createContext:context=>request("POST",{action:"contextCreate",context}),
    createWorkflow:(contextId,options)=>request("POST",Object.assign({action:"workflowCreate",contextId},options||{})),
    getWorkflow:id=>request("GET",undefined,{type:"workflow",id}),
    listWorkflows:projectId=>request("GET",undefined,{projectId}),
    completeNode:(workflowId,nodeKey,input,output)=>request("POST",{action:"nodeComplete",workflowId,nodeKey,input,output}),
    approveNode:(workflowId,nodeKey,note)=>request("POST",{action:"nodeApprove",workflowId,nodeKey,note}),
    invalidate:(workflowId,changedResources)=>request("POST",{action:"workflowInvalidate",workflowId,changedResources}),
    pause:(workflowId,reason)=>request("POST",{action:"workflowPause",workflowId,reason}),
    resume:workflowId=>request("POST",{action:"workflowResume",workflowId}),
    createQueryPlan:(workflowId,requirement)=>request("POST",{action:"queryPlanCreate",workflowId,requirement}),
    recordQuery:(planId,result)=>request("POST",{action:"queryPlanRecord",planId,result}),
    createFeedback:feedback=>request("POST",{action:"feedbackCreate",feedback}),
    evaluateFeedback:(candidateId,evaluation)=>request("POST",{action:"feedbackEvaluate",candidateId,evaluation}),
    changeFeedbackScope:(candidateId,scope)=>request("POST",{action:"feedbackScope",candidateId,scope}),
    publishFeedback:(candidateId,note)=>request("POST",{action:"feedbackPublish",candidateId,note}),
    rollbackFeedback:(candidateId,reason)=>request("POST",{action:"feedbackRollback",candidateId,reason})
  };
  root.ReportOrchestrationClient=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
