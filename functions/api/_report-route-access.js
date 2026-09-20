import {resolveProjectAccess} from './_project-access.js';
// Resolve the project from stored IDs, never trust a second client projectId.
export async function reportRouteProject(env,b,get=false){
  let table,id;
  if(get){
    if(b.id){table={workflow:'report_workflows',queryPlan:'report_query_plans',feedback:'report_feedback_candidates'}[b.type||'workflow'];id=b.id;}
    else return String(b.projectId||'');
  }else{
    if(b.action==='contextCreate')return String(b.context?.identity?.projectId||'');
    if(b.action==='feedbackCreate')return String(b.feedback?.projectId||'');
    if(b.action==='trustedCaseRegister')return String(b.sample?.projectId||'');
    if(b.action==='workflowCreate'){table='project_context_snapshots';id=b.contextId;}
    else if(['nodeComplete','nodeApprove','workflowInvalidate','workflowPause','workflowResume','queryPlanCreate'].includes(b.action)){table='report_workflows';id=b.workflowId;}
    else if(b.action==='queryPlanRecord'){table='report_query_plans';id=b.planId;}
    else if(['feedbackScope','feedbackPublish','feedbackRollback','trustedEvaluationStart'].includes(b.action)){table='report_feedback_candidates';id=b.candidateId;}
  }
  return table&&id?String((await env.DB.prepare('SELECT project_id FROM '+table+' WHERE id=?').bind(String(id)).first())?.project_id||''):'';
}
export async function guardReportRoute(env,userId,b,get=false){
  const pid=await reportRouteProject(env,b,get);
  if(!pid)return !['contextCreate','feedbackCreate','trustedCaseRegister'].includes(b.action);
  if(!get&&env.DB._transaction)await env.DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(pid).first();
  const access=await resolveProjectAccess(env,userId,pid);
  return !!access?.permissions[get?'view':'edit'];
}
