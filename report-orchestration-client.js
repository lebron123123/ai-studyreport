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
