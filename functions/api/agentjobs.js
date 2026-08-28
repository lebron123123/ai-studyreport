import { verifyAuth,json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { ensureAgentRuntime,createAgentRun,findOwnedRun,finishAgentRun } from "./_agent-runtime.js";
import { ensureAgentEnterprise,enqueueAgentJob,upsertRunGovernance } from "./_agent-enterprise.js";
import { resolveAgentPrincipal,authorizeAgentAction } from "./_agent-policy.js";

export async function onRequestGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);
  await ensureAgentEnterprise(env); const u=new URL(context.request.url),id=String(u.searchParams.get("id")||"");
  if(id){const job=await env.DB.prepare("SELECT * FROM agent_jobs WHERE id=? AND user_id=?").bind(id,user.userId).first();return job?json({ok:true,job}):json({ok:false,error:"任务不存在"},404);}
  const rows=await env.DB.prepare("SELECT * FROM agent_jobs WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").bind(user.userId).all();return json({ok:true,jobs:rows.results||[]});
}
export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);let b={};try{b=await context.request.json();}catch(_){return json({ok:false,error:"格式有误"},400);}
  await ensureAgentRuntime(env);await ensureAgentEnterprise(env);const principal=await resolveAgentPrincipal(env,user);
  if(b.action==="enqueue"){
    const access=await authorizeAgentAction(env,principal,{projectId:b.projectId,securityLevel:b.securityLevel,action:"read"});if(!access.ok)return json({ok:false,error:access.reason},403);
    const run=(await createAgentRun(env,user.userId,{agentType:b.kind==="multi_agent"?"orchestrator":"background",projectId:b.projectId,query:b.query||b.payload&&b.payload.query,idempotencyKey:b.idempotencyKey})).run;
    await upsertRunGovernance(env,user.userId,run.id,{department:principal.department,securityLevel:b.securityLevel,executionMode:"server",budgetInputTokens:b.budgetInputTokens,budgetOutputTokens:b.budgetOutputTokens,budgetCostMicros:b.budgetCostMicros});
    const job=await enqueueAgentJob(env,user.userId,run.id,{kind:b.kind,payload:{...(b.payload||{}),projectId:b.projectId,department:principal.department,securityLevel:b.securityLevel},priority:b.priority,maxAttempts:b.maxAttempts});return json({ok:true,run,job});
  }
  const job=await env.DB.prepare("SELECT * FROM agent_jobs WHERE id=? AND user_id=?").bind(String(b.id||""),user.userId).first();if(!job)return json({ok:false,error:"任务不存在"},404);
  if(b.action==="cancel"){await env.DB.prepare("UPDATE agent_jobs SET status='cancelled',lease_owner='',lease_expires_at=0,updated_at=? WHERE id=? AND user_id=? AND status NOT IN ('completed','dead')").bind(Date.now(),job.id,user.userId).run();await finishAgentRun(env,user.userId,job.run_id,{status:"cancelled"});return json({ok:true,status:"cancelled"});}
  if(b.action==="retry"){await env.DB.prepare("UPDATE agent_jobs SET status='queued',next_retry_at=?,lease_owner='',lease_expires_at=0,error_text='',updated_at=? WHERE id=? AND user_id=? AND status IN ('dead','retry')").bind(Date.now(),Date.now(),job.id,user.userId).run();return json({ok:true,status:"queued"});}
  return json({ok:false,error:"未知操作"},400);
}

