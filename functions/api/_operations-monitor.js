import {ensureAgentRuntime} from './_agent-runtime.js';
import {ensureAgentEnterprise} from './_agent-enterprise.js';
import {ensureAgentBudget} from './_agent-budget.js';
export async function ensureOperations(env){
  await ensureAgentRuntime(env);await ensureAgentEnterprise(env);await ensureAgentBudget(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS operations_monitor(id TEXT PRIMARY KEY,state_json TEXT NOT NULL,observed_at BIGINT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS operations_alerts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at BIGINT NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,delivered_at BIGINT NOT NULL DEFAULT 0)").run();
}
export async function operationsSnapshot(env){
  const jobs=(await env.DB.prepare('SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM agent_jobs GROUP BY status').all()).results||[];
  const uncertain=Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_call_ledger WHERE status IN ('usage_unknown','outcome_unknown')").first()).n);
  const overdue=Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE status='running' AND lease_expires_at<?").bind(Date.now()).first()).n);
  return {observedAt:Date.now(),jobs,uncertainCalls:uncertain,expiredLeases:overdue,runtime:env.RUNTIME_METRICS?.snapshot?.()||null};
}
export function monitorConditions(snapshot,previous={},env={}){
  const r=snapshot.runtime,p=previous.runtime;
  const requests=r&&p&&r.startedAt===p.startedAt?r.requests-p.requests:0;
  const failures=requests>0?r.failures-p.failures:0;
  return {billing:snapshot.uncertainCalls>0,expired_lease:snapshot.expiredLeases>0,
    server_errors:requests>=10&&failures/requests>=Number(env.OPERATIONS_ERROR_RATIO||0.1),
    latency:requests>=10&&r.p95Ms>Number(env.OPERATIONS_P95_MS||10000),
    queue_stalled:snapshot.jobs.some(j=>['queued','retry'].includes(j.status)&&Number(j.count)>0&&snapshot.observedAt-Number(j.oldest)>Number(env.OPERATIONS_QUEUE_AGE_MS||300000))};
}
// One transaction owns each transition; the outbox survives process restarts.
export async function observeOperations(env,snapshot){
  if(!env.DB._transaction)throw new Error('自动监控需要事务数据库');
  return env.DB._transaction(async DB=>{
    await DB.prepare("INSERT INTO operations_monitor(id,state_json,observed_at) VALUES('main','{}',0) ON CONFLICT(id) DO NOTHING").run();
    const row=await DB.prepare("SELECT * FROM operations_monitor WHERE id='main' FOR UPDATE").first(),old=JSON.parse(row.state_json);
    if(Number(row.observed_at)>=snapshot.observedAt)return old;
    const conditions=monitorConditions(snapshot,old,env);
    for(const [key,active] of Object.entries(conditions))if(active!==!!old.conditions?.[key]){
      const id=crypto.randomUUID(),kind=active?'alert':'recovery';
      await DB.prepare('INSERT INTO operations_alerts(id,kind,payload_json,created_at) VALUES(?,?,?,?)').bind(id,kind,JSON.stringify({id,kind,key,observedAt:snapshot.observedAt}),snapshot.observedAt).run();
    }
    const state={...snapshot,conditions};
    await DB.prepare("UPDATE operations_monitor SET state_json=?,observed_at=? WHERE id='main'").bind(JSON.stringify(state),snapshot.observedAt).run();return state;
  });
}
export async function dispatchOperations(env,send=fetch){
  if(!env.OPERATIONS_ALERT_URL)return {configured:false,sent:0};
  const url=new URL(env.OPERATIONS_ALERT_URL);if(url.protocol!=='https:')throw new Error('告警地址必须使用HTTPS');
  let sent=0;
  for(let i=0;i<10;i++){
    const row=await env.DB._transaction(async DB=>{
      const item=await DB.prepare("SELECT * FROM operations_alerts WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED").bind(Date.now()).first();
      if(item)await DB.prepare('UPDATE operations_alerts SET next_at=?,attempts=attempts+1 WHERE id=?').bind(Date.now()+30000,item.id).run();return item;
    });
    if(!row)break;
    try{
      const r=await send(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','idempotency-key':row.id},body:row.payload_json,signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error('receiver');
      await env.DB.prepare("UPDATE operations_alerts SET status='delivered',delivered_at=? WHERE id=?").bind(Date.now(),row.id).run();sent++;
    }catch{await env.DB.prepare('UPDATE operations_alerts SET next_at=? WHERE id=?').bind(Date.now()+Math.min(3600000,30000*2**Math.min(7,Number(row.attempts))),row.id).run();}
  }
  return {configured:true,sent,deliverySemantics:'at-least-once; receiver must deduplicate idempotency-key'};
}
export async function readOperations(env){
  const row=await env.DB.prepare("SELECT * FROM operations_monitor WHERE id='main'").first();
  return {state:row?JSON.parse(row.state_json):null,stale:!row||Date.now()-Number(row.observed_at)>180000,events:(await env.DB.prepare('SELECT id,kind,status,attempts,created_at,delivered_at FROM operations_alerts ORDER BY created_at DESC LIMIT 30').all()).results||[],webhookConfigured:!!env.OPERATIONS_ALERT_URL,productionContinuousMonitoringVerified:false};
}
