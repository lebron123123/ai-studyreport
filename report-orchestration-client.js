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
    async generateSection(input,onTask,options){
      const deadline=Date.now()+540000;
      options=options||{};
      const recovery=options.recovery;
      const recovering=recovery!==undefined;
      const autoRepair=!recovering&&options.autoRepair===true&&input?.action!=='repair';
      const maxRepairRounds=options.maxRepairRounds===undefined?2:Math.min(2,options.maxRepairRounds);
      let lastTask=null,lastCompletedTask=null,connectionFailures=0,repairAttempts=0;
      const completedTasks=[];
      const timeoutMessage='后台仍在处理，任务已保存；稍后继续同一小节将恢复已有任务，不会重复提交';
      async function receive(task){
        lastTask=task;
        // POST acknowledges the durable task with only id/reused/runId. It is
        // not yet the GET task snapshot (graph/hash/status) required by the
        // caller's recovery binding. Keep the receipt, then GET this exact id.
        if(task.status===undefined){
          if(typeof task.runId!=='string'||!task.runId)throw new Error('后台启动记录缺少任务轮次，已保留任务编号，未重复提交');
          // Receipt-aware callers persist this smaller identity separately;
          // a full-task consumer must never receive it as a graph snapshot.
          if(typeof options.onReceipt==='function')await options.onReceipt(task);
          return task;
        }
        if(task.status==='completed'){lastCompletedTask=task;completedTasks.push(task);}
        if(onTask)onTask(task);return task;
      }
      function canAutoRepair(task){
        const quality=task.quality,repair=task.repair,failure=quality?.failure;
        const errors=Array.isArray(quality?.issues)?quality.issues.filter(issue=>issue.severity==='error'):[];
        const protocolIssue=/^(?:structured-(?:json|schema|extra-fields|block|block-kind|empty|heading(?:-level)?|slot(?:-count|-duplicate|-order)?|paragraph(?:-lines|-markup)?|table-(?:schema|markup))|empty|heading-structure-missing|table-shape|table-markers)$/;
        // Only the server's protocol/structure admission permits an automatic paid repair.
        // Length, evidence, facts and unknown errors are not part of this authorization.
        const admitted=autoRepair&&repairAttempts<maxRepairRounds&&task.rulesChanged!==true&&quality?.status==='blocked'
          &&repair?.canRetry===true&&Number.isInteger(repair.round)&&repair.round>=0&&repair.round<maxRepairRounds;
        if(!admitted)return false;
        const targeted=quality.targetedRepair;
        // This is an additive server-bound plan, not permission to manufacture
        // missing facts or numerical tables. The repair endpoint derives it again.
        if(repair.canTargetedRetry===true&&targeted?.version==='missing-structure-patch-v1'
          &&typeof targeted.sectionKey==='string'&&targeted.sectionKey===input.sectionKey
          &&typeof targeted.planId==='string'&&targeted.planId===input.qualityContract?.planId
          &&Number.isInteger(targeted.headingCount)&&targeted.headingCount>=0
          &&Array.isArray(targeted.tableTitles)&&targeted.tableTitles.every(t=>typeof t==='string'&&/需求|客群|产品|匹配|方案|风险|对策|比较|分层/.test(t)&&!/资金|投资|融资|贷款|资本金|财务|税|收益|成本|收入|租金|面积|套数|指标|估算|还本|利息|数量|金额|IRR|NPV|万元|百分比|[0-9%％]/i.test(t))
          &&Array.isArray(targeted.targetIds)&&targeted.targetIds.length===targeted.headingCount+targeted.tableTitles.length&&targeted.targetIds.length>0&&new Set(targeted.targetIds).size===targeted.targetIds.length
          &&targeted.targetIds.every(id=>/^(?:heading|table)-\d+$/.test(id))
          &&errors.length>0&&errors.every(issue=>!issue.requiresPlanReview&&(issue.code==='heading-structure-missing'&&targeted.headingCount>0||issue.code==='structured-structure-patch'&&issue.repairable===true||issue.code==='missing-table'&&targeted.tableTitles.some(title=>String(issue.message||'').includes('：'+title+'；')))))return true;
        return repair.canProtocolRetry===true&&failure?.protocolRepairEligible===true&&Array.isArray(failure.categories)&&failure.categories.length>0
          &&failure.categories.every(category=>category==='format'||category==='structure')
          &&errors.length>0&&errors.every(issue=>issue.repairable===true&&!issue.requiresPlanReview&&protocolIssue.test(String(issue.code||'')));
      }
      async function pausePolling(){const remaining=deadline-Date.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.min(1500,remaining)));}
      async function execute(method,payload,id){
        const remaining=deadline-Date.now();if(remaining<=0)throw new Error(timeoutMessage);
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(15000,remaining));
        try{
          const options={method,signal:controller.signal,headers:Object.assign({'Content-Type':'application/json'},root.authHeaders?root.authHeaders():{}),body:payload?JSON.stringify(payload):undefined};
          let response;
          try{response=await fetch('/api/reportexecution'+(id?'?id='+encodeURIComponent(id):''),options);}
          catch(error){if(error.name==='AbortError'||error instanceof TypeError){const connection=new Error('连接后台任务失败，已有任务不会丢失；请检查网络，恢复连接后重试同一小节');connection.code='REPORT_TASK_CONNECTION';throw connection;}throw error;}
          let data;
          try{data=await response.json();}
          catch(error){if(response.ok&&error.name==='AbortError'){const connection=new Error('读取后台任务进度超时，已有任务不会丢失；请检查网络，恢复连接后重试同一小节');connection.code='REPORT_TASK_CONNECTION';throw connection;}throw new Error('后台任务返回格式异常，请重试同一小节并检查调用台账');}
          if(!response.ok||!data||!data.ok)throw new Error(data?.error||'后台报告任务不可用');
          if(!data.task||typeof data.task.id!=='string'||!data.task.id)throw new Error('后台任务信息不完整，请重试同一小节并检查调用台账');
          if(id&&data.task.id!==id)throw new Error('后台任务身份不一致，原任务已保留，未继续生成或修复');
          if(id&&lastTask?.runId&&data.task.runId!==lastTask.runId)throw new Error('后台任务轮次与启动记录不一致，原任务已保留，未重复提交');
          const knownInputHash=Array.isArray(lastTask?.graph)?lastTask.graph.find(row=>row.key==='context_snapshot')?.hash:null;
          if(id&&knownInputHash&&(!Array.isArray(data.task.graph)||data.task.graph.find(row=>row.key==='context_snapshot')?.hash!==knownInputHash))throw new Error('后台任务输入与原记录不一致，原稿保留，未重复提交');
          if(recovering&&(data.task.runId!==recovery.backendRunId||(data.task.graph||[]).find(row=>row.key==='context_snapshot')?.hash!==recovery.inputHash))throw new Error('后台任务与原生成记录不一致，原稿保留，未重复提交');
          return data.task;
        }
        finally{clearTimeout(timer);}
      }
      try{
        if(recovering&&(!recovery||typeof recovery.taskId!=='string'||!recovery.taskId||typeof recovery.backendRunId!=='string'||!recovery.backendRunId||typeof recovery.inputHash!=='string'||!recovery.inputHash))throw new Error('原任务记录不完整，未重复提交生成');
        if(autoRepair&&(!Number.isInteger(maxRepairRounds)||maxRepairRounds<0||typeof options.beforeRepair!=='function'))throw new Error('自动修复必须提供有效轮数及项目/权限复核，未提交生成任务');
        // Recovery reads the existing paid task only. Even a blocked or failed
        // result must never turn this branch into a new paid submission.
        let task=await receive(await execute(recovering?'GET':'POST',recovering?null:input,recovering?recovery.taskId:undefined));
        while(true){
          if(task.status==='completed'){
            if(canAutoRepair(task)){
              // The caller rechecks identity, plan, facts and permission after the wait,
              // and explicitly returns true. Existing candidate edits never opt in here.
              if(await options.beforeRepair(task)!==true){const denied=new Error('项目、权限或生成输入未通过复核，原候选已保留，未自动修复');denied.code='REPORT_TASK_REPAIR_GUARD';throw denied;}
              repairAttempts++;
              // Never retry this POST on an uncertain response: it may already be paid.
              task=await receive(await execute('POST',{action:'repair',id:task.id}));
              connectionFailures=0;
              continue;
            }
            if(!task.text)throw new Error('后台任务未保留正文，请检查调用台账');
            // A remaining block stays blocked; repaired candidates never become verified facts.
            return repairAttempts?Object.assign({},task,{repairHistory:completedTasks.slice()}):task;
          }
          if(['dead','failed','cancelled','invalidated','missing'].includes(task.status)){
            const stopped=new Error(task.error||'任务已停止；记录已保留，请检查后台任务状态');
            stopped.requestDefinitelyFailed=true;throw stopped;
          }
          if(Date.now()>=deadline)throw new Error(timeoutMessage);
          try{task=await receive(await execute('GET',null,task.id));connectionFailures=0;}
          catch(error){
            // A disconnected progress query is safe to retry, unlike submitting paid AI work.
            // Authentication, HTTP, JSON and task-contract failures are never retried here.
            if(error.code!=='REPORT_TASK_CONNECTION')throw error;
            connectionFailures++;error.connectionFailures=connectionFailures;
            if(Date.now()>=deadline)throw new Error(timeoutMessage);
            if(connectionFailures>=3){error.message='连续3次连接后台任务失败，已有任务不会丢失；请检查网络，恢复连接后重试同一小节';throw error;}
            await pausePolling();continue;
          }
          if(task.status!=='completed'&&!['dead','failed','cancelled','invalidated','missing'].includes(task.status))await pausePolling();
        }
      }catch(error){
        // Keep the exact task and completed candidate available after a connection or task failure.
        error.task=lastTask;error.taskId=lastTask?.id||null;error.lastCompletedTask=lastCompletedTask;
        error.quality=lastCompletedTask?.quality||lastTask?.quality||null;
        error.rawText=lastCompletedTask?.rawText||'';error.structuredText=lastCompletedTask?.structuredText||'';
        error.repairHistory=completedTasks.slice();error.repairAttempts=repairAttempts;
        throw error;
      }
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
