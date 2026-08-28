import { agentId,agentJson,parseAgentJson,findOwnedRun,appendAgentStep,saveAgentCheckpoint,finishAgentRun,createAgentRun } from "./_agent-runtime.js";
import { callConfiguredLlm } from "./_llm-providers.js";

const DDL=[
  "CREATE TABLE IF NOT EXISTS agent_run_governance (run_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,parent_run_id TEXT DEFAULT '',root_run_id TEXT DEFAULT '',department TEXT DEFAULT '',security_level INTEGER NOT NULL DEFAULT 1,execution_mode TEXT NOT NULL DEFAULT 'client',budget_input_tokens INTEGER NOT NULL DEFAULT 0,budget_output_tokens INTEGER NOT NULL DEFAULT 0,budget_cost_micros BIGINT NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cost_micros BIGINT NOT NULL DEFAULT 0,provider TEXT DEFAULT '',model TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_agent_governance_root ON agent_run_governance(root_run_id,updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'llm_task',payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,next_retry_at BIGINT NOT NULL DEFAULT 0,lease_owner TEXT DEFAULT '',lease_expires_at BIGINT NOT NULL DEFAULT 0,error_text TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,completed_at BIGINT NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim ON agent_jobs(status,next_retry_at,priority,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_agent_jobs_user ON agent_jobs(user_id,updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS agent_run_usage (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,provider TEXT DEFAULT '',model TEXT DEFAULT '',input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cost_micros BIGINT NOT NULL DEFAULT 0,latency_ms INTEGER NOT NULL DEFAULT 0,cached INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_agent_usage_run ON agent_run_usage(run_id,created_at)",
  "CREATE TABLE IF NOT EXISTS agent_skill_versions (id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,version INTEGER NOT NULL,instruction_md TEXT NOT NULL DEFAULT '',evidence_json TEXT NOT NULL DEFAULT '[]',eval_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'draft',created_by INTEGER NOT NULL,created_at BIGINT NOT NULL,UNIQUE(skill_id,version))",
  "CREATE TABLE IF NOT EXISTS agent_skill_evals (id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,version INTEGER NOT NULL,passed INTEGER NOT NULL DEFAULT 0,score DOUBLE PRECISION NOT NULL DEFAULT 0,cases_json TEXT NOT NULL DEFAULT '[]',result_json TEXT NOT NULL DEFAULT '{}',created_by INTEGER NOT NULL,created_at BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS agent_skill_releases (skill_id TEXT PRIMARY KEY,active_version INTEGER NOT NULL,previous_version INTEGER NOT NULL DEFAULT 0,published_by TEXT DEFAULT '',published_at BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS agent_project_access (user_id INTEGER NOT NULL,project_id TEXT NOT NULL,department TEXT DEFAULT '',permission TEXT NOT NULL DEFAULT 'read',max_security_level INTEGER NOT NULL DEFAULT 1,updated_at BIGINT NOT NULL,PRIMARY KEY(user_id,project_id))"
];
const initialized=new WeakSet();
export async function ensureAgentEnterprise(env){ if(initialized.has(env.DB))return; for(const sql of DDL)await env.DB.prepare(sql).run(); initialized.add(env.DB); }

export function normalizeUsage(raw={}){
  return {inputTokens:Number(raw.prompt_tokens??raw.input_tokens)||0,outputTokens:Number(raw.completion_tokens??raw.output_tokens)||0};
}
function costMicros(env,provider,model,usage){
  let cfg={}; try{cfg=JSON.parse(String(env.LLM_COSTS_JSON||"{}"));}catch(_){ }
  const rate=cfg[provider+":"+model]||cfg[provider]||null; if(!rate)return 0;
  return Math.round((usage.inputTokens*(Number(rate.inputPerMillion)||0)+usage.outputTokens*(Number(rate.outputPerMillion)||0)));
}
export async function recordAgentUsage(env,userId,runId,data={}){
  await ensureAgentEnterprise(env); const usage=normalizeUsage(data.usage||data), cost=Number(data.costMicros)||costMicros(env,data.provider,data.model,usage), now=Date.now();
  await env.DB.prepare("INSERT INTO agent_run_usage(id,run_id,user_id,provider,model,input_tokens,output_tokens,cost_micros,latency_ms,cached,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(agentId("usage"),runId,userId,String(data.provider||""),String(data.model||""),usage.inputTokens,usage.outputTokens,cost,Number(data.latencyMs)||0,data.cached?1:0,now).run();
  await env.DB.prepare("UPDATE agent_run_governance SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,cost_micros=cost_micros+?,provider=?,model=?,updated_at=? WHERE run_id=? AND user_id=?")
    .bind(usage.inputTokens,usage.outputTokens,cost,String(data.provider||""),String(data.model||""),now,runId,userId).run();
  return {...usage,costMicros:cost};
}
export async function upsertRunGovernance(env,userId,runId,data={}){
  await ensureAgentEnterprise(env); const now=Date.now(),root=String(data.rootRunId||runId);
  await env.DB.prepare("INSERT INTO agent_run_governance(run_id,user_id,parent_run_id,root_run_id,department,security_level,execution_mode,budget_input_tokens,budget_output_tokens,budget_cost_micros,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET parent_run_id=excluded.parent_run_id,root_run_id=excluded.root_run_id,department=excluded.department,security_level=excluded.security_level,execution_mode=excluded.execution_mode,budget_input_tokens=excluded.budget_input_tokens,budget_output_tokens=excluded.budget_output_tokens,budget_cost_micros=excluded.budget_cost_micros,updated_at=excluded.updated_at")
    .bind(runId,userId,String(data.parentRunId||""),root,String(data.department||""),Math.max(1,Number(data.securityLevel)||1),String(data.executionMode||"client"),Number(data.budgetInputTokens)||0,Number(data.budgetOutputTokens)||0,Number(data.budgetCostMicros)||0,now,now).run();
}
export async function enqueueAgentJob(env,userId,runId,data={}){
  await ensureAgentEnterprise(env); const id=agentId("job"),now=Date.now();
  await env.DB.prepare("INSERT INTO agent_jobs(id,run_id,user_id,kind,payload_json,status,priority,max_attempts,next_retry_at,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?,?)")
    .bind(id,runId,userId,String(data.kind||"llm_task"),agentJson(data.payload||{},30000),Math.max(-10,Math.min(10,Number(data.priority)||0)),Math.max(1,Math.min(5,Number(data.maxAttempts)||3)),now,now,now).run();
  return env.DB.prepare("SELECT * FROM agent_jobs WHERE id=?").bind(id).first();
}
export async function claimAgentJob(env,workerId,leaseMs=30000){
  await ensureAgentEnterprise(env); const now=Date.now();
  const row=await env.DB.prepare("SELECT * FROM agent_jobs WHERE (status='queued' OR status='retry' OR (status='running' AND lease_expires_at<?)) AND next_retry_at<=? ORDER BY priority DESC,created_at ASC LIMIT 1").bind(now,now).first();
  if(!row)return null;
  await env.DB.prepare("UPDATE agent_jobs SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND (status='queued' OR status='retry' OR lease_expires_at<?)")
    .bind(workerId,now+leaseMs,now,row.id,now).run();
  const claimed=await env.DB.prepare("SELECT * FROM agent_jobs WHERE id=?").bind(row.id).first();
  return claimed&&claimed.lease_owner===workerId?claimed:null;
}
export async function heartbeatAgentJob(env,id,workerId,leaseMs=30000){ const now=Date.now(); await env.DB.prepare("UPDATE agent_jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=? AND status='running'").bind(now+leaseMs,now,id,workerId).run(); }
export async function settleAgentJob(env,job,ok,error=""){
  const now=Date.now(); if(ok){await env.DB.prepare("UPDATE agent_jobs SET status='completed',lease_owner='',lease_expires_at=0,error_text='',updated_at=?,completed_at=? WHERE id=?").bind(now,now,job.id).run();return "completed";}
  const dead=Number(job.attempts)>=Number(job.max_attempts),delay=Math.min(60000,1000*Math.pow(2,Math.max(0,Number(job.attempts)-1)));
  await env.DB.prepare("UPDATE agent_jobs SET status=?,lease_owner='',lease_expires_at=0,error_text=?,next_retry_at=?,updated_at=? WHERE id=?").bind(dead?"dead":"retry",String(error).slice(0,2000),now+delay,now,job.id).run();
  return dead?"dead":"retry";
}
async function budgetOk(env,runId){ const g=await env.DB.prepare("SELECT * FROM agent_run_governance WHERE run_id=?").bind(runId).first(); if(!g)return {ok:true}; if(g.budget_input_tokens>0&&g.input_tokens>=g.budget_input_tokens)return {ok:false,error:"输入Token预算已用尽"}; if(g.budget_output_tokens>0&&g.output_tokens>=g.budget_output_tokens)return {ok:false,error:"输出Token预算已用尽"}; if(g.budget_cost_micros>0&&g.cost_micros>=g.budget_cost_micros)return {ok:false,error:"费用预算已用尽"}; return {ok:true}; }
export async function checkAgentBudget(env,runId){ return budgetOk(env,runId); }
export async function executeLlmTask(env,job,payload){
  const existing=await env.DB.prepare("SELECT state_json FROM agent_checkpoints WHERE run_id=? AND user_id=? ORDER BY step_no DESC,created_at DESC LIMIT 1").bind(job.run_id,job.user_id).first();
  const prior=parseAgentJson(existing&&existing.state_json,{});if(prior.completed&&prior.text)return {text:prior.text,provider:prior.provider||"",model:prior.model||"",resumed:true};
  const budget=await budgetOk(env,job.run_id); if(!budget.ok)throw new Error(budget.error);
  const started=Date.now(),called=await callConfiguredLlm(env,payload.provider,{messages:[{role:"system",content:String(payload.system||"")},{role:"user",content:String(payload.query||"")}],max_tokens:Math.max(200,Math.min(4000,Number(payload.maxTokens)||1200)),temperature:Number(payload.temperature)||0.2,stream:false});
  const data=await called.response.json(),msg=data.choices&&data.choices[0]&&data.choices[0].message||{},text=String(msg.content||"");
  await recordAgentUsage(env,job.user_id,job.run_id,{usage:data.usage,provider:called.provider,model:called.model,latencyMs:Date.now()-started});
  await appendAgentStep(env,job.user_id,job.run_id,{kind:"model",status:"completed",output:{text:text.slice(0,6000),provider:called.provider,model:called.model},durationMs:Date.now()-started});
  await saveAgentCheckpoint(env,job.user_id,job.run_id,{state:{completed:true,text,provider:called.provider,model:called.model}});
  await finishAgentRun(env,job.user_id,job.run_id,{status:"completed",output:{text,provider:called.provider,model:called.model}}); return {text,provider:called.provider,model:called.model};
}
export async function executeMultiAgentTask(env,job,payload){
  const tasks=Array.isArray(payload.tasks)?payload.tasks.slice(0,4):[]; if(!tasks.length)throw new Error("多Agent任务不能为空");
  const root=job.run_id,existing=await env.DB.prepare("SELECT state_json FROM agent_checkpoints WHERE run_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1").bind(root,job.user_id).first(),state=parseAgentJson(existing&&existing.state_json,{}),results=Array.isArray(state.multiResults)?state.multiResults:[];
  for(let base=results.length;base<tasks.length;base+=2){
    const batch=tasks.slice(base,base+2);
    const out=await Promise.all(batch.map(async(task,offset)=>{
      const index=base+offset,child=(await createAgentRun(env,job.user_id,{agentType:String(task.role||"specialist"),projectId:String(payload.projectId||""),query:String(task.query||""),idempotencyKey:"job:"+job.id+":child:"+index})).run;
      await upsertRunGovernance(env,job.user_id,child.id,{parentRunId:root,rootRunId:root,department:payload.department,securityLevel:payload.securityLevel,executionMode:"server",budgetInputTokens:payload.childBudgetInputTokens,budgetOutputTokens:payload.childBudgetOutputTokens,budgetCostMicros:payload.childBudgetCostMicros});
      const fake={...job,run_id:child.id};return {role:task.role,...await executeLlmTask(env,fake,{system:task.system||"你是受控的专业子Agent，只完成分配给你的任务。",query:task.query,maxTokens:task.maxTokens||1000,provider:payload.provider})};
    }));
    results.push(...out);await saveAgentCheckpoint(env,job.user_id,root,{state:{multiResults:results,completedChildren:results.length}});
  }
  const synthesisQuery=results.map(x=>"【"+x.role+"】\n"+x.text).join("\n\n");
  return executeLlmTask(env,job,{system:payload.synthesisSystem||"你是主Agent，请综合子Agent结果，消除重复并明确结论与待核事项。",query:synthesisQuery,maxTokens:payload.maxTokens||1600,provider:payload.provider});
}
export async function executeAgentJob(env,job){ const payload=parseAgentJson(job.payload_json,{}); return job.kind==="multi_agent"?executeMultiAgentTask(env,job,payload):executeLlmTask(env,job,payload); }

export async function reauthorizeAgentJob(env,job){
  const payload=parseAgentJson(job.payload_json,{}), projectId=String(payload.projectId||"");
  const user=await env.DB.prepare("SELECT id,department,clearance FROM users WHERE id=?").bind(job.user_id).first();
  if(!user)return {ok:false,error:"任务所属用户已不存在"};
  const level=Math.max(1,Number(payload.securityLevel)||1);if(level>(Number(user.clearance)||1))return {ok:false,error:"任务密级已超过用户当前权限"};
  if(!projectId)return {ok:true};
  const owned=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND user_id=?").bind(projectId,job.user_id).first();if(owned)return {ok:true};
  const grant=await env.DB.prepare("SELECT * FROM agent_project_access WHERE user_id=? AND project_id=?").bind(job.user_id,projectId).first();
  if(!grant)return {ok:false,error:"任务执行前复核发现项目授权已失效"};
  if(grant.department&&user.department&&grant.department!==user.department)return {ok:false,error:"任务执行前复核发现部门权限已变化"};
  if(level>(Number(grant.max_security_level)||1))return {ok:false,error:"任务执行前复核发现项目密级授权不足"};return {ok:true};
}
