import {verifyAuth,json} from "./_auth.js";
import {adaptEnv} from "./_adapters.js";
import {ensureReportOrchestration,parseJson,compactJson,clean} from "./_report-orchestration.js";
import {createAgentRun,appendAgentStep,saveAgentCheckpoint,finishAgentRun,agentId} from "./_agent-runtime.js";
import "../../project-context-contract.js";
import "../../report-task-graph.js";
import "../../report-query-planner.js";
import "../../report-feedback-learning.js";
import {registerReportCase,startReportEvaluation,trustedReportEvaluations} from './_report-trusted-evaluation.js';
import {resolveProjectAccess} from './_project-access.js';
import {guardReportRoute} from './_report-route-access.js';

const Context=globalThis.ProjectContextContract,Graph=globalThis.ReportTaskGraph,Planner=globalThis.ReportQueryPlanner,Learning=globalThis.ReportFeedbackLearning;
function admin(env,user,request){const list=String(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);return list.includes(user.username)||list.includes(String(user.userId)) ? (!env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS) : false;}
async function workflow(env,userId,id){return env.DB.prepare("SELECT * FROM report_workflows WHERE id=? AND user_id=?").bind(id,userId).first();}
async function candidate(env,userId,id,isAdmin){return env.DB.prepare(isAdmin?"SELECT * FROM report_feedback_candidates WHERE id=?":"SELECT * FROM report_feedback_candidates WHERE id=? AND user_id=?").bind(...(isAdmin?[id]:[id,userId])).first();}
async function loadCandidateEvaluations(env,row){const item=parseJson(row.candidate_json,{});item.legacyEvaluationCount=((await env.DB.prepare('SELECT id FROM report_feedback_evaluations WHERE candidate_id=?').bind(row.id).all()).results||[]).length;item.evaluations=await trustedReportEvaluations(env,row);item.evaluationStatus=item.evaluations.length?'server_verified_constraints':'trusted_runner_required';item.scope=row.scope;item.status=row.status;item.version=Number(row.version)||1;return item;}
async function changeRulePublication(env,user,request,b,action){
  const isAdmin=admin(env,user,request);
  if(!isAdmin)return json({ok:false,error:'规则扩大范围、发布和回滚必须由管理员审批'},403);
  if(!env.DB._transaction)return json({ok:false,error:'规则发布需要事务数据库'},503);
  try{return await env.DB._transaction(async DB=>{
    const scoped={...env,DB},row=await DB.prepare('SELECT * FROM report_feedback_candidates WHERE id=? FOR UPDATE').bind(clean(b.candidateId,120)).first();
    if(!row)return json({ok:false,error:'反馈候选不存在'},404);
    let item=await loadCandidateEvaluations(scoped,row);
    if(action!=='feedbackRollback'&&(!item.evaluations.length||item.evaluations.some(x=>!x.passed)))return json({ok:false,error:'该规则版本仍有未完成或未通过的受控评测'},409);
    if(action==='feedbackPublish'&&row.status==='published')return json({ok:true,reused:true,candidate:item});
    if(action==='feedbackRollback'&&row.status==='rolled_back')return json({ok:true,reused:true,candidate:item});
    if(action==='feedbackScope'){
      if(row.status==='published')throw new Error('已发布版本不可原地改范围，请创建新候选版本');
      if(b.scope==='org_rule'&&(!env.REPORT_ORGANIZATION_ID||item.organizationId!==env.REPORT_ORGANIZATION_ID))throw new Error('组织规则必须匹配服务端配置的组织标识');
      const changed=Learning.requestScope(item,clean(b.scope,30));if(!changed.ok)throw new Error(changed.reasons.join('；'));item=changed.candidate;
    }else if(action==='feedbackPublish')item=Learning.publish(item,{approved:true,approvedBy:user.username,note:b.note});
    else{if(!clean(b.reason,1000))throw new Error('回滚必须填写原因');item=Learning.rollback(item,b.reason,user.username);}
    const now=Date.now();await DB.prepare('UPDATE report_feedback_candidates SET scope=?,status=?,candidate_json=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=?').bind(item.scope,item.status,compactJson(item),user.username,clean(b.note||b.reason,1000),now,row.id).run();
    if(action==='feedbackPublish'){
      const key=item.scope===Learning.SCOPE.PROJECT_ONLY?item.projectId:item.scope===Learning.SCOPE.SCENARIO_RULE?item.scenario:item.organizationId;
      await DB.prepare("INSERT INTO report_rule_publications(id,candidate_id,scope,scope_key,version,status,payload_json,published_by,published_at) VALUES(?,?,?,?,?,'published',?,?,?)").bind(agentId('rulepub'),row.id,item.scope,key,item.version,compactJson(item),user.username,now).run();
    }
    if(action==='feedbackRollback')await DB.prepare("UPDATE report_rule_publications SET status='rolled_back',rolled_back_by=?,rollback_reason=?,rolled_back_at=? WHERE candidate_id=? AND status='published'").bind(user.username,clean(b.reason,1000),now,row.id).run();
    return json({ok:true,candidate:item});
  });}catch(e){return json({ok:false,error:e.message},409);}
}

export async function onRequestGet(context){const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);await ensureReportOrchestration(env);const u=new URL(context.request.url),type=u.searchParams.get("type")||"workflow",id=clean(u.searchParams.get("id"),120);
  if(!await guardReportRoute(env,user.userId,Object.fromEntries(u.searchParams),true))return json({ok:false,error:'项目读取权限已失效'},403);
  if(type==="workflow"&&id){const row=await workflow(env,user.userId,id);return row?json({ok:true,item:{...row,graph:parseJson(row.graph_json,{})}}):json({ok:false,error:"工作流不存在"},404);}
  if(type==="queryPlan"&&id){const row=await env.DB.prepare("SELECT * FROM report_query_plans WHERE id=? AND user_id=?").bind(id,user.userId).first();return row?json({ok:true,item:{...row,plan:parseJson(row.plan_json,{})}}):json({ok:false,error:"查询计划不存在"},404);}
  if(type==="feedback"&&id){const row=await candidate(env,user.userId,id,admin(env,user,context.request));return row?json({ok:true,item:await loadCandidateEvaluations(env,row)}):json({ok:false,error:"反馈候选不存在"},404);}
  const projectId=clean(u.searchParams.get("projectId"),120);if(!projectId)return json({ok:false,error:"缺少projectId"},400);const rows=(await env.DB.prepare("SELECT * FROM report_workflows WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 30").bind(projectId,user.userId).all()).results||[];return json({ok:true,list:rows.map(x=>({...x,graph:parseJson(x.graph_json,{})}))});
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env);
  if(!await verifyAuth(context.request,env))return json({ok:false,error:'未登录'},401);
  if(!env.DB._transaction)return handlePost(context);
  await ensureReportOrchestration(env);
  return env.DB._transaction(DB=>handlePost({...context,env:{...env,DB}}));
}
async function handlePost(context){const env=adaptEnv(context.env),request=context.request,user=await verifyAuth(request,env);if(!user)return json({ok:false,error:"未登录"},401);let b={};try{b=await request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}await ensureReportOrchestration(env);const action=clean(b.action,40);
  if(!await guardReportRoute(env,user.userId,b))return json({ok:false,error:'项目编辑权限已失效'},403);
  if(action==='trustedCaseRegister'||action==='trustedEvaluationStart'){
    if(!admin(env,user,request))return json({ok:false,error:'受控样本及评测仅由管理员执行'},403);
    try{
      if(action==='trustedCaseRegister')return json({ok:true,sample:await registerReportCase(env,user.userId,b.sample||{})});
      const row=await candidate(env,user.userId,clean(b.candidateId,120),true);
      if(!row)return json({ok:false,error:'规则候选不存在'},404);
      if(!(await resolveProjectAccess(env,user.userId,row.project_id))?.permissions.edit)return json({ok:false,error:'需要项目编辑权限'},403);
      return json({ok:true,evaluation:await startReportEvaluation(env,user.userId,row,clean(b.caseId,120))});
    }catch(e){return json({ok:false,error:e.message},409);}
  }
  if(action==="contextCreate"){let snapshot;try{snapshot=Context.build({...b.context,createdBy:b.context?.createdBy||user.username,identity:{...(b.context?.identity||{}),userId:String(user.userId)}});}catch(e){return json({ok:false,error:e.message},400);}const existing=await env.DB.prepare("SELECT * FROM project_context_snapshots WHERE user_id=? AND project_id=? AND context_hash=?").bind(user.userId,snapshot.identity.projectId,snapshot.contextHash).first();if(existing)return json({ok:true,reused:true,context:snapshot});await env.DB.prepare("INSERT INTO project_context_snapshots(id,context_hash,project_id,user_id,payload_json,created_at) VALUES(?,?,?,?,?,?)").bind(snapshot.contextId,snapshot.contextHash,snapshot.identity.projectId,user.userId,compactJson(snapshot),Date.now()).run();return json({ok:true,reused:false,context:snapshot});}
  if(action==="workflowCreate"){const contextId=clean(b.contextId,120),ctx=await env.DB.prepare("SELECT * FROM project_context_snapshots WHERE id=? AND user_id=?").bind(contextId,user.userId).first();if(!ctx)return json({ok:false,error:"项目上下文不存在或无权访问"},404);const snapshot=parseJson(ctx.payload_json,{}),created=await createAgentRun(env,user.userId,{agentType:"report_workflow",projectId:ctx.project_id,query:b.query||"生成并复核可研报告",idempotencyKey:b.idempotencyKey,input:{contextId,contextHash:ctx.context_hash}});if(created.reused){const old=await env.DB.prepare("SELECT * FROM report_workflows WHERE run_id=? AND user_id=?").bind(created.run.id,user.userId).first();if(old)return json({ok:true,reused:true,workflow:{...old,graph:parseJson(old.graph_json,{})}});}const id=agentId("rwf"),graph=Graph.create({workflowId:id,runId:created.run.id,projectId:ctx.project_id,contextId,contextHash:snapshot.contextHash}),now=Date.now();await env.DB.prepare("INSERT INTO report_workflows(id,run_id,project_id,context_id,user_id,status,graph_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,created.run.id,ctx.project_id,contextId,user.userId,graph.status,compactJson(graph),now,now).run();await saveAgentCheckpoint(env,user.userId,created.run.id,{state:{workflowId:id,graph}});return json({ok:true,reused:false,workflow:{id,runId:created.run.id,graph}});}
  if(action==="nodeComplete"||action==="nodeApprove"||action==="workflowInvalidate"||action==="workflowPause"||action==="workflowResume"){const row=await workflow(env,user.userId,clean(b.workflowId,120));if(!row)return json({ok:false,error:"工作流不存在"},404);let graph=parseJson(row.graph_json,{}),result;try{if(action==="nodeComplete")result=Graph.complete(graph,clean(b.nodeKey,80),b.input,b.output),graph=result.graph;else if(action==="nodeApprove")graph=Graph.approve(graph,clean(b.nodeKey,80),b.note);else if(action==="workflowInvalidate")result=Graph.invalidate(graph,b.changedResources||[]),graph=result.graph;else if(action==="workflowPause")graph=Graph.pause(graph,b.reason);else graph=Graph.resume(graph);}catch(e){return json({ok:false,error:e.message},409);}await env.DB.prepare("UPDATE report_workflows SET status=?,graph_json=?,updated_at=? WHERE id=? AND user_id=?").bind(graph.status,compactJson(graph),Date.now(),row.id,user.userId).run();await appendAgentStep(env,user.userId,row.run_id,{kind:"workflow",status:"completed",input:{action,nodeKey:b.nodeKey,changedResources:b.changedResources},output:{workflowStatus:graph.status,reused:result?.reused,invalidated:result?.invalidated}});await saveAgentCheckpoint(env,user.userId,row.run_id,{state:{workflowId:row.id,graph}});if(graph.status===Graph.STATUS.COMPLETED)await finishAgentRun(env,user.userId,row.run_id,{status:"completed",output:{workflowId:row.id}});return json({ok:true,reused:result?.reused===true,invalidated:result?.invalidated||[],graph});}
  if(action==="queryPlanCreate"){const row=await workflow(env,user.userId,clean(b.workflowId,120));if(!row)return json({ok:false,error:"工作流不存在"},404);const plan=Planner.createPlan({...b.requirement,requirementId:b.requirement?.requirementId||agentId("req")}),id=agentId("qplan"),now=Date.now();await env.DB.prepare("INSERT INTO report_query_plans(id,workflow_id,project_id,user_id,risk,decision,status,plan_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,row.id,row.project_id,user.userId,plan.risk,plan.decision,plan.status,compactJson(plan),now,now).run();return json({ok:true,id,plan});}
  if(action==="queryPlanRecord"){const id=clean(b.planId,120),row=await env.DB.prepare("SELECT * FROM report_query_plans WHERE id=? AND user_id=?").bind(id,user.userId).first();if(!row)return json({ok:false,error:"查询计划不存在"},404);const plan=Planner.record(parseJson(row.plan_json,{}),b.result||{});await env.DB.prepare("UPDATE report_query_plans SET status=?,plan_json=?,updated_at=? WHERE id=? AND user_id=?").bind(plan.status,compactJson(plan),Date.now(),id,user.userId).run();return json({ok:true,plan});}
  if(action==="feedbackCreate"){let item;try{item=Learning.createCandidate({...b.feedback,candidateId:agentId("feedback")});}catch(e){return json({ok:false,error:e.message},400);}const now=Date.now();await env.DB.prepare("INSERT INTO report_feedback_candidates(id,project_id,user_id,scope,status,scenario,organization_id,candidate_json,version,previous_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(item.candidateId,item.projectId,user.userId,item.scope,item.status,item.scenario,item.organizationId,compactJson(item),item.version,item.previousVersionId,now,now).run();return json({ok:true,candidate:item});}
  // Legacy endpoint accepted client-supplied passed/project/holdout assertions.
  // Preserve historic records, but fail closed until the server runner binds outputs to rules and approved samples.
  if(action==="feedbackEvaluate")return json({ok:false,code:'TRUSTED_EVALUATION_REQUIRED',error:'不能把前端提交的分数或通过标记作为学习证据；需接通绑定规则版本及受控样本的服务端评测。现有记录保留，暂不用于扩大规则范围。'},409);
  if(['feedbackScope','feedbackPublish','feedbackRollback'].includes(action))return changeRulePublication(env,user,request,b,action);
  return json({ok:false,error:"未知操作"},400);
}
