// Durable per-call reservations. PostgreSQL row locks serialize a root and all children.
// An unresolved call is never automatically sent again, even after worker takeover.
const initialized = new WeakSet();
export async function ensureAgentBudget(env) {
  if (initialized.has(env.DB)) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_call_ledger (
    id TEXT PRIMARY KEY,run_id TEXT NOT NULL,root_run_id TEXT NOT NULL,user_id INTEGER NOT NULL,
    status TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,
    reserved_input BIGINT NOT NULL,reserved_output BIGINT NOT NULL,reserved_cost BIGINT NOT NULL,
    actual_input BIGINT,actual_output BIGINT,actual_cost BIGINT,
    rate_json TEXT NOT NULL,response_json TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_agent_call_root ON agent_call_ledger(root_run_id,status)').run();
  initialized.add(env.DB);
}
function integer(value) { return value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null; }
export function agentPrice(env, provider, model) {
  let config; try { config = JSON.parse(env.LLM_COSTS_JSON || '{}'); } catch { return null; }
  const rate = config[provider + ':' + model] || config[provider];
  if (!rate || !['inputPerMillion','outputPerMillion'].every(k => typeof rate[k] === 'number' && Number.isFinite(rate[k]) && rate[k] >= 0)) return null;
  return {inputPerMillion:Number(rate.inputPerMillion),outputPerMillion:Number(rate.outputPerMillion)};
}
export function agentUsage(raw) {
  const input = integer(raw?.prompt_tokens ?? raw?.input_tokens), output = integer(raw?.completion_tokens ?? raw?.output_tokens);
  return input === null || output === null ? null : {input,output};
}
function price(rate, input, output) { return rate ? Math.ceil(input * rate.inputPerMillion + output * rate.outputPerMillion) : null; }
async function transaction(env, action) {
  if (!env.DB._transaction) throw new Error('后台任务预算需要支持事务的数据库；未发送模型请求');
  return env.DB._transaction(DB => action({...env,DB}));
}
async function lockRoot(env, runId, userId) {
  const local = await env.DB.prepare('SELECT * FROM agent_run_governance WHERE run_id=? AND user_id=?').bind(runId,userId).first();
  if (!local) throw new Error('任务预算契约不存在');
  const root = await env.DB.prepare('SELECT * FROM agent_run_governance WHERE run_id=? AND user_id=? FOR UPDATE').bind(local.root_run_id || runId,userId).first();
  if (!root) throw new Error('根任务预算契约不存在');
  return {local,root};
}
export async function reserveAgentCall(env, call) {
  await ensureAgentBudget(env);
  return transaction(env, async scoped => {
    const {local,root} = await lockRoot(scoped,call.runId,call.userId);
    const old = await scoped.DB.prepare('SELECT * FROM agent_call_ledger WHERE id=?').bind(call.id).first();
    if (old) {
      if (old.run_id !== call.runId || Number(old.user_id) !== Number(call.userId)) throw new Error('调用幂等键冲突');
      if (old.response_json) return {reused:true,result:JSON.parse(old.response_json)};
      throw new Error('外部执行结果不确定：已有未对账调用，禁止自动再次扣费');
    }
    // UTF-8 byte count is a conservative envelope, not a tokenizer measurement.
    const input = new TextEncoder().encode(JSON.stringify(call.messages)).length + 256;
    const output = integer(call.maxTokens); if (!output) throw new Error('输出预算无效');
    const rate = agentPrice(env,call.provider,call.model), cost = price(rate,input,output);
    for (const g of root.run_id === local.run_id ? [root] : [root,local]) {
      const rootScope = g.run_id === root.run_id;
      const pending = await scoped.DB.prepare(`SELECT COALESCE(SUM(reserved_input),0) AS i,COALESCE(SUM(reserved_output),0) AS o,COALESCE(SUM(reserved_cost),0) AS c,COUNT(*) AS n FROM agent_call_ledger WHERE ${rootScope?'root_run_id':'run_id'}=? AND status!='settled'`).bind(g.run_id).first();
      // Root governance aggregates settled child usage; unresolved usage remains reserved.
      for (const [limit,used,reserved,extra,label] of [
        [g.budget_input_tokens,g.input_tokens,pending.i,input,'输入Token'],
        [g.budget_output_tokens,g.output_tokens,pending.o,output,'输出Token'],
        [g.budget_cost_micros,g.cost_micros,pending.c,cost,'费用']
      ]) if (Number(limit)>0 && (extra===null || Number(used)+Number(reserved)+extra>Number(limit))) throw new Error(label+'预算不足或价格未配置，未发送模型请求');
      // Unknown price cannot silently become free in a monetary budget.
      if (Number(g.budget_cost_micros)>0) {
        const unknown=await scoped.DB.prepare(`SELECT id FROM agent_call_ledger WHERE ${rootScope?'root_run_id':'run_id'}=? AND actual_cost IS NULL AND status='settled' LIMIT 1`).bind(g.run_id).first();
        if(unknown)throw new Error('存在未知费用，需先对账再继续费用预算任务');
      }
    }
    const now=Date.now();
    await scoped.DB.prepare("INSERT INTO agent_call_ledger(id,run_id,root_run_id,user_id,status,provider,model,reserved_input,reserved_output,reserved_cost,rate_json,created_at,updated_at) VALUES(?,?,?,?,'reserved',?,?,?,?,?,?,?,?)")
      .bind(call.id,call.runId,root.run_id,call.userId,call.provider,call.model,input,output,cost??0,JSON.stringify(rate),now,now).run();
    return {reused:false};
  });
}
export async function settleAgentCall(env, id, result, usage, latencyMs=0) {
  await ensureAgentBudget(env);
  return transaction(env,async scoped=>{
    const initial=await scoped.DB.prepare('SELECT * FROM agent_call_ledger WHERE id=?').bind(id).first();
    if(!initial)throw new Error('调用预留不存在');
    const {local,root}=await lockRoot(scoped,initial.run_id,initial.user_id);
    const row=await scoped.DB.prepare('SELECT * FROM agent_call_ledger WHERE id=?').bind(id).first();
    if(row.response_json)return JSON.parse(row.response_json);
    const measured=agentUsage(usage),rate=JSON.parse(row.rate_json),cost=measured?price(rate,measured.input,measured.output):null,now=Date.now();
    await scoped.DB.prepare('UPDATE agent_call_ledger SET status=?,actual_input=?,actual_output=?,actual_cost=?,response_json=?,updated_at=? WHERE id=?')
      .bind(measured?'settled':'usage_unknown',measured?.input??null,measured?.output??null,cost,JSON.stringify(result),now,id).run();
    if(measured){
      await scoped.DB.prepare('INSERT INTO agent_run_usage(id,run_id,user_id,provider,model,input_tokens,output_tokens,cost_micros,latency_ms,cached,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)')
        .bind(id,local.run_id,row.user_id,row.provider,row.model,measured.input,measured.output,cost??0,latencyMs,now).run();
      for(const g of root.run_id===local.run_id?[root]:[root,local])await scoped.DB.prepare('UPDATE agent_run_governance SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,cost_micros=cost_micros+?,updated_at=? WHERE run_id=?')
        .bind(measured.input,measured.output,cost??0,now,g.run_id).run();
    }
    return result;
  });
}
export async function markAgentCallUnknown(env,id) {
  await env.DB.prepare("UPDATE agent_call_ledger SET status='outcome_unknown',updated_at=? WHERE id=? AND status='reserved'").bind(Date.now(),id).run();
}
