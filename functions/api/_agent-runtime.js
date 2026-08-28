const RUNTIME_DDL = [
  "CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,agent_type TEXT NOT NULL DEFAULT 'general',project_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'running',query_text TEXT NOT NULL DEFAULT '',idempotency_key TEXT NOT NULL DEFAULT '',input_json TEXT NOT NULL DEFAULT '{}',output_json TEXT NOT NULL DEFAULT '{}',error_text TEXT NOT NULL DEFAULT '',current_step INTEGER NOT NULL DEFAULT 0,tool_call_count INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,completed_at BIGINT DEFAULT 0,UNIQUE(user_id,idempotency_key))",
  "CREATE INDEX IF NOT EXISTS idx_agent_runs_user_updated ON agent_runs(user_id,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated ON agent_runs(status,updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS agent_run_steps (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,step_no INTEGER NOT NULL,kind TEXT NOT NULL,tool_name TEXT NOT NULL DEFAULT '',risk_level TEXT NOT NULL DEFAULT 'read',status TEXT NOT NULL DEFAULT 'completed',input_json TEXT NOT NULL DEFAULT '{}',output_json TEXT NOT NULL DEFAULT '{}',error_text TEXT NOT NULL DEFAULT '',duration_ms INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_run_steps(run_id,step_no)",
  "CREATE TABLE IF NOT EXISTS agent_checkpoints (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,step_no INTEGER NOT NULL,state_json TEXT NOT NULL DEFAULT '{}',resume_token TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_run ON agent_checkpoints(run_id,step_no DESC)",
  "CREATE TABLE IF NOT EXISTS agent_approvals (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,tool_name TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',request_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',decided_by TEXT NOT NULL DEFAULT '',decision_note TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,decided_at BIGINT DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_agent_approvals_run ON agent_approvals(run_id,status,created_at DESC)",
  "CREATE TABLE IF NOT EXISTS agent_skill_candidates (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,scene TEXT NOT NULL DEFAULT 'general',description TEXT NOT NULL DEFAULT '',instruction_md TEXT NOT NULL DEFAULT '',source_run_id TEXT NOT NULL DEFAULT '',evidence_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'candidate',version INTEGER NOT NULL DEFAULT 1,reviewed_by TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_agent_skills_status ON agent_skill_candidates(status,updated_at DESC)"
];

const initialized = new WeakSet();
export async function ensureAgentRuntime(env){
  if(initialized.has(env.DB)) return;
  for(const sql of RUNTIME_DDL) await env.DB.prepare(sql).run();
  initialized.add(env.DB);
}

export function agentId(prefix){
  const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + "_" + id;
}
export function agentJson(value, max=12000){
  try{ return JSON.stringify(value == null ? {} : value).slice(0,max); }catch(e){ return JSON.stringify({serializationError:e.message}); }
}
export function parseAgentJson(value, fallback={}){
  try{ return value ? JSON.parse(value) : fallback; }catch(e){ return fallback; }
}

export async function findOwnedRun(env, userId, runId){
  return env.DB.prepare("SELECT * FROM agent_runs WHERE id=? AND user_id=?").bind(runId,userId).first();
}

export async function createAgentRun(env, userId, data={}){
  await ensureAgentRuntime(env);
  const requestedIdem = String(data.idempotencyKey||"").slice(0,160);
  if(requestedIdem){
    const old = await env.DB.prepare("SELECT * FROM agent_runs WHERE user_id=? AND idempotency_key=?").bind(userId,requestedIdem).first();
    if(old) return {run:old,reused:true};
  }
  const now=Date.now(), id=agentId("run");
  // 空幂等键不能直接落库，否则 UNIQUE(user_id,idempotency_key) 会让同一用户只能创建一次运行。
  const idem=requestedIdem||("auto:"+id);
  await env.DB.prepare("INSERT INTO agent_runs(id,user_id,agent_type,project_id,status,query_text,idempotency_key,input_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(id,userId,String(data.agentType||"general").slice(0,50),String(data.projectId||"").slice(0,100),"running",String(data.query||"").slice(0,1000),idem,agentJson(data.input||{}),now,now).run();
  return {run:await findOwnedRun(env,userId,id),reused:false};
}

export async function appendAgentStep(env,userId,runId,data={}){
  const run=await findOwnedRun(env,userId,runId); if(!run) return null;
  const stepNo=(Number(run.current_step)||0)+1, now=Date.now();
  await env.DB.prepare("INSERT INTO agent_run_steps(id,run_id,user_id,step_no,kind,tool_name,risk_level,status,input_json,output_json,error_text,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(agentId("step"),runId,userId,stepNo,String(data.kind||"event").slice(0,40),String(data.toolName||"").slice(0,100),String(data.riskLevel||"read").slice(0,20),String(data.status||"completed").slice(0,20),agentJson(data.input||{},6000),agentJson(data.output||{},8000),String(data.error||"").slice(0,2000),Number(data.durationMs)||0,now).run();
  await env.DB.prepare("UPDATE agent_runs SET current_step=?,tool_call_count=tool_call_count+?,updated_at=? WHERE id=? AND user_id=?")
    .bind(stepNo,data.kind==="tool"?1:0,now,runId,userId).run();
  return {stepNo};
}

export async function saveAgentCheckpoint(env,userId,runId,data={}){
  const run=await findOwnedRun(env,userId,runId); if(!run) return null;
  const now=Date.now(), token=agentId("resume");
  await env.DB.prepare("INSERT INTO agent_checkpoints(id,run_id,user_id,step_no,state_json,resume_token,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(agentId("cp"),runId,userId,Number(data.stepNo||run.current_step)||0,agentJson(data.state||{},16000),token,now).run();
  return {resumeToken:token};
}

export async function finishAgentRun(env,userId,runId,data={}){
  const status=["completed","failed","cancelled","waiting_approval"].includes(data.status)?data.status:"completed";
  const now=Date.now();
  await env.DB.prepare("UPDATE agent_runs SET status=?,output_json=?,error_text=?,updated_at=?,completed_at=? WHERE id=? AND user_id=?")
    .bind(status,agentJson(data.output||{},16000),String(data.error||"").slice(0,3000),now,status==="waiting_approval"?0:now,runId,userId).run();
  return findOwnedRun(env,userId,runId);
}

export async function listAgentRunDetail(env,userId,runId){
  const run=await findOwnedRun(env,userId,runId); if(!run) return null;
  const steps=await env.DB.prepare("SELECT * FROM agent_run_steps WHERE run_id=? AND user_id=? ORDER BY step_no").bind(runId,userId).all();
  const checkpoint=await env.DB.prepare("SELECT * FROM agent_checkpoints WHERE run_id=? AND user_id=? ORDER BY step_no DESC LIMIT 1").bind(runId,userId).first();
  return {run,steps:steps.results||[],checkpoint};
}
