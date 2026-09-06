import { verifyAuth,json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { ensureAgentRuntime,createAgentRun,findOwnedRun,finishAgentRun } from "./_agent-runtime.js";
import { ensureAgentEnterprise,enqueueAgentJob,upsertRunGovernance } from "./_agent-enterprise.js";
import { resolveAgentPrincipal,authorizeAgentAction } from "./_agent-policy.js";
import { parseAgentJson } from "./_agent-runtime.js";

async function jobAccess(env,principal,job,action='read'){
  const payload=parseAgentJson(job.payload_json,{});
  const run=await findOwnedRun(env,job.user_id,job.run_id);
  if(!run)return {ok:false,reason:'任务关联记录不存在'};
  return authorizeAgentAction(env,principal,{projectId:run.project_id,securityLevel:payload.securityLevel,action});
}

export async function onRequestGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);
  await ensureAgentEnterprise(env); const u=new URL(context.request.url),id=String(u.searchParams.get("id")||"");
  const principal=await resolveAgentPrincipal(env,user);
  if(id){const job=await env.DB.prepare("SELECT * FROM agent_jobs WHERE id=? AND user_id=?").bind(id,user.userId).first();return job&&(await jobAccess(env,principal,job)).ok?json({ok:true,job}):json({ok:false,error:"任务不存在或项目授权已失效"},404);}
  const rows=await env.DB.prepare("SELECT * FROM agent_jobs WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").bind(user.userId).all(),jobs=[];
  for(const job of rows.results||[])if((await jobAccess(env,principal,job)).ok)jobs.push(job);
  return json({ok:true,jobs});
}
export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);let b={};try{b=await context.request.json();}catch(_){return json({ok:false,error:"格式有误"},400);}
  await ensureAgentRuntime(env);await ensureAgentEnterprise(env);const principal=await resolveAgentPrincipal(env,user);
  if(b.action==="enqueue"){
    const access=await authorizeAgentAction(env,principal,{projectId:b.projectId,securityLevel:b.securityLevel,action:"write"});if(!access.ok)return json({ok:false,error:access.reason},403);
    const enqueue=async DB=>{
      if(b.projectId&&env.DB._transaction)await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(String(b.projectId)).first();
      const currentAccess=await authorizeAgentAction({...env,DB},principal,{projectId:b.projectId,securityLevel:b.securityLevel,action:'write'});
      if(!currentAccess.ok)return {ok:false,error:currentAccess.reason,status:403};
      const scoped={...env,DB},run=(await createAgentRun(scoped,user.userId,{agentType:b.kind==="multi_agent"?"orchestrator":"background",projectId:b.projectId,query:b.query||b.payload&&b.payload.query,idempotencyKey:b.idempotencyKey})).run;
      if(String(run.project_id||'')!==String(b.projectId||''))return {ok:false,error:'幂等键已绑定另一项目，请为新任务使用新键'};
      await upsertRunGovernance(scoped,user.userId,run.id,{department:principal.department,securityLevel:b.securityLevel,executionMode:"server",budgetInputTokens:b.budgetInputTokens,budgetOutputTokens:b.budgetOutputTokens,budgetCostMicros:b.budgetCostMicros});
      const job=await enqueueAgentJob(scoped,user.userId,run.id,{kind:b.kind,payload:{...(b.payload||{}),projectId:b.projectId,department:principal.department,securityLevel:b.securityLevel},priority:b.priority,maxAttempts:b.maxAttempts});return {ok:true,run,job};
    };
    const result=env.DB._transaction?await env.DB._transaction(enqueue):await enqueue(env.DB);return json(result,result.ok?200:result.status||409);
  }
  const job=await env.DB.prepare("SELECT * FROM agent_jobs WHERE id=? AND user_id=?").bind(String(b.id||""),user.userId).first();if(!job)return json({ok:false,error:"任务不存在"},404);
  if(b.action!=='cancel'){const access=await jobAccess(env,principal,job,'write');if(!access.ok)return json({ok:false,error:access.reason},403);}
  if(b.action==="cancel"){
    const cancel=async DB=>{
      const changed=await DB.prepare("UPDATE agent_jobs SET status='cancelled',lease_owner='',lease_expires_at=0,updated_at=? WHERE id=? AND user_id=? AND status IN ('queued','retry','running')").bind(Date.now(),job.id,user.userId).run();
      if(changed.meta?.changes===1)await finishAgentRun({...env,DB},user.userId,job.run_id,{status:"cancelled"});
      const current=await DB.prepare("SELECT status FROM agent_jobs WHERE id=? AND user_id=?").bind(job.id,user.userId).first();return current.status;
    };
    const status=env.DB._transaction?await env.DB._transaction(cancel):await cancel(env.DB);
    return json({ok:status==='cancelled',status},status==='cancelled'?200:409);
  }
  if(b.action==="retry"){const changed=await env.DB.prepare("UPDATE agent_jobs SET status='queued',next_retry_at=?,lease_owner='',lease_expires_at=0,error_text='',updated_at=? WHERE id=? AND user_id=? AND status IN ('dead','retry')").bind(Date.now(),Date.now(),job.id,user.userId).run();return changed.meta?.changes===1?json({ok:true,status:"queued"}):json({ok:false,error:"当前任务状态不允许重试"},409);}
  return json({ok:false,error:"未知操作"},400);
}
