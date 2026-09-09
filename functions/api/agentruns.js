import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { ensureAgentRuntime,createAgentRun,appendAgentStep,saveAgentCheckpoint,finishAgentRun,listAgentRunDetail,findOwnedRun,agentId,agentJson } from "./_agent-runtime.js";
import { ensureAgentEnterprise,upsertRunGovernance,recordAgentUsage,checkAgentBudget } from "./_agent-enterprise.js";
import { resolveAgentPrincipal,authorizeAgentAction } from "./_agent-policy.js";
import { resolveProjectAccess } from './_project-access.js';
import {ensureAgentBudget} from './_agent-budget.js';

async function visibleRun(env,userId,run){
  return !!run && (!run.project_id || !!await resolveProjectAccess(env,userId,run.project_id));
}

function admin(env,user,request){
  const xs=String(env.ADMIN_USERS||"").split(",").map(x=>x.trim());
  const role=xs.includes(user.username)||xs.includes(String(user.userId));
  return role && (!env.ADMIN_PASS || request.headers.get("x-admin-pass")===env.ADMIN_PASS);
}
export async function onRequestGet(context){
  const env=adaptEnv(context.env), user=await verifyAuth(context.request,env);
  if(!user) return json({ok:false,error:"未登录"},401);
  await ensureAgentRuntime(env);
  await ensureAgentEnterprise(env);
  const u=new URL(context.request.url), action=u.searchParams.get("action")||"list";
  if(action==="detail"){
    const runId=u.searchParams.get("runId")||"",detail=await listAgentRunDetail(env,user.userId,runId);
    if(!detail || !await visibleRun(env,user.userId,detail.run))return json({ok:false,error:"运行不存在或无权访问"},404);
    const governance=await env.DB.prepare("SELECT * FROM agent_run_governance WHERE run_id=? AND user_id=?").bind(runId,user.userId).first();
    const usage=await env.DB.prepare("SELECT * FROM agent_run_usage WHERE run_id=? AND user_id=? ORDER BY created_at").bind(runId,user.userId).all();
    const children=await env.DB.prepare("SELECT r.*,g.parent_run_id,g.root_run_id FROM agent_runs r JOIN agent_run_governance g ON g.run_id=r.id WHERE g.parent_run_id=? AND r.user_id=? ORDER BY r.created_at").bind(runId,user.userId).all();
    await ensureAgentBudget(env);
    const ledger=await env.DB.prepare('SELECT id,status,provider,model,reserved_input,reserved_output,reserved_cost,actual_input,actual_output,actual_cost,updated_at FROM agent_call_ledger WHERE run_id=? AND user_id=? ORDER BY created_at').bind(runId,user.userId).all();
    return json({ok:true,...detail,governance,usage:usage.results||[],callLedger:ledger.results||[],children:children.results||[]});
  }
  if(action==="adminList" && admin(env,user,context.request)){
    const rows=await env.DB.prepare("SELECT * FROM agent_runs ORDER BY updated_at DESC LIMIT 100").all();
    const jobs=await env.DB.prepare("SELECT status,COUNT(*) cnt FROM agent_jobs GROUP BY status").all();
    const usage=await env.DB.prepare("SELECT COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(cost_micros),0) cost_micros FROM agent_run_usage").first();
    const skills=await env.DB.prepare("SELECT COUNT(*) cnt FROM agent_skill_candidates WHERE status='candidate'").first();
    return json({ok:true,runs:rows.results||[],stats:{jobs:jobs.results||[],usage:usage||{},pendingSkills:Number(skills&&skills.cnt)||0}});
  }
  const rows=await env.DB.prepare("SELECT * FROM agent_runs WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").bind(user.userId).all();
  const visible=[];
  for(const run of rows.results||[])if(await visibleRun(env,user.userId,run))visible.push(run);
  return json({ok:true,runs:visible});
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env), user=await verifyAuth(context.request,env);
  if(!user) return json({ok:false,error:"未登录"},401);
  let b={}; try{ b=await context.request.json(); }catch(e){ return json({ok:false,error:"格式有误"},400); }
  await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
  if(b.action==="create"){
    const principal=await resolveAgentPrincipal(env,user);
    const decision=await authorizeAgentAction(env,principal,{projectId:b.projectId,securityLevel:b.securityLevel,action:'write'});
    if(!decision.ok)return json({ok:false,error:decision.reason},403);
    const created=await createAgentRun(env,user.userId,b);
    if(String(created.run.project_id||'')!==String(b.projectId||''))return json({ok:false,error:'幂等键已用于其他项目'},409);
    await upsertRunGovernance(env,user.userId,created.run.id,{department:principal.department,securityLevel:b.securityLevel,executionMode:b.executionMode,parentRunId:b.parentRunId,rootRunId:b.rootRunId,budgetInputTokens:b.budgetInputTokens,budgetOutputTokens:b.budgetOutputTokens,budgetCostMicros:b.budgetCostMicros});
    return json({ok:true,...created});
  }
  if(b.action==="accessGrant"){
    if(!admin(env,user,context.request))return json({ok:false,error:"仅管理员可配置项目权限"},403);
    const targetUserId=Number(b.targetUserId),projectId=String(b.projectId||"");if(!targetUserId||!projectId)return json({ok:false,error:"用户和项目不能为空"},400);
    const permission=["read","write","approve","admin"].includes(b.permission)?b.permission:"read";
    await env.DB.prepare("INSERT INTO agent_project_access(user_id,project_id,department,permission,max_security_level,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET department=excluded.department,permission=excluded.permission,max_security_level=excluded.max_security_level,updated_at=excluded.updated_at")
      .bind(targetUserId,projectId,String(b.department||""),permission,Math.max(1,Number(b.maxSecurityLevel)||1),Date.now()).run();return json({ok:true,permission});
  }
  if(b.action==="accessRevoke"){
    if(!admin(env,user,context.request))return json({ok:false,error:"仅管理员可撤销项目权限"},403);
    await env.DB.prepare("DELETE FROM agent_project_access WHERE user_id=? AND project_id=?").bind(Number(b.targetUserId),String(b.projectId||"")).run();return json({ok:true});
  }
  const runId=String(b.runId||"");
  const ownedRun=runId?await findOwnedRun(env,user.userId,runId):null;
  if(!await visibleRun(env,user.userId,ownedRun)) return json({ok:false,error:"运行不存在或无权访问"},404);
  const mutationDecision=await authorizeAgentAction(env,await resolveAgentPrincipal(env,user),{projectId:ownedRun.project_id,action:['budget','authorize'].includes(b.action)?'read':'write'});
  if(!mutationDecision.ok)return json({ok:false,error:mutationDecision.reason},403);
  if(['step','checkpoint','complete','fail','cancel','usage'].includes(b.action)){
    const serverContract=await env.DB.prepare('SELECT execution_mode FROM agent_run_governance WHERE run_id=? AND user_id=?').bind(runId,user.userId).first();
    if(serverContract?.execution_mode==='server')return json({ok:false,error:'后台任务的进度、成果和费用只能由持有租约的工作进程记录'},403);
  }
  if(b.action==="step") return json({ok:true,step:await appendAgentStep(env,user.userId,runId,b)});
  if(b.action==="checkpoint") return json({ok:true,checkpoint:await saveAgentCheckpoint(env,user.userId,runId,b)});
  if(b.action==="usage") {
    const contract=await env.DB.prepare('SELECT execution_mode FROM agent_run_governance WHERE run_id=? AND user_id=?').bind(runId,user.userId).first();
    if(contract?.execution_mode==='server')return json({ok:false,error:'后台任务费用由服务端调用台账结算，不能由前端上报覆盖'},403);
    const usage=b.usage||b;
    if([usage.prompt_tokens??usage.input_tokens??0,usage.completion_tokens??usage.output_tokens??0,b.costMicros??0].some(v=>!Number.isSafeInteger(Number(v))||Number(v)<0))return json({ok:false,error:'用量必须是非负整数'},400);
    return json({ok:true,usage:await recordAgentUsage(env,user.userId,runId,b)});
  }
  if(b.action==="budget"){
    const decision=await checkAgentBudget(env,runId);return decision.ok?json({ok:true,decision}):json({ok:false,error:decision.error,decision},429);
  }
  if(b.action==="authorize"){
    const principal=await resolveAgentPrincipal(env,user),run=await findOwnedRun(env,user.userId,runId);
    const decision=await authorizeAgentAction(env,principal,{projectId:run.project_id,toolName:b.toolName,securityLevel:b.securityLevel,action:b.permission||((b.riskLevel==="read"||!b.riskLevel)?"read":"write"),toolMeta:b.meta});
    await appendAgentStep(env,user.userId,runId,{kind:"authorization",toolName:b.toolName,riskLevel:b.riskLevel,status:decision.ok?"completed":"failed",input:{permission:b.permission,meta:b.meta},output:decision});
    return decision.ok?json({ok:true,decision}):json({ok:false,error:decision.reason,decision},403);
  }
  if(["complete","fail","cancel"].includes(b.action)){
    const status=b.action==="complete"?"completed":b.action==="fail"?"failed":"cancelled";
    return json({ok:true,run:await finishAgentRun(env,user.userId,runId,{status,output:b.output,error:b.error})});
  }
  if(b.action==="approvalCreate"){
    const now=Date.now(), id=agentId("approval");
    await env.DB.prepare("INSERT INTO agent_approvals(id,run_id,user_id,tool_name,reason,request_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id,runId,user.userId,String(b.toolName||"").slice(0,100),String(b.reason||"").slice(0,500),agentJson(b.request||{},6000),"pending",now).run();
    await finishAgentRun(env,user.userId,runId,{status:"waiting_approval",output:{approvalId:id}});
    return json({ok:true,approvalId:id});
  }
  if(b.action==="approvalDecide"){
    const status=b.approved===true?"approved":"rejected", now=Date.now();
    await env.DB.prepare("UPDATE agent_approvals SET status=?,decided_by=?,decision_note=?,decided_at=? WHERE id=? AND run_id=? AND user_id=? AND status='pending'")
      .bind(status,user.username,String(b.note||"").slice(0,500),now,String(b.approvalId||""),runId,user.userId).run();
    return json({ok:true,status});
  }
  return json({ok:false,error:"未知操作"},400);
}
