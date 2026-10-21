// Imported drafts use a separate one-shot receipt. Unresolved claims are never replayed.
// Like _agent-budget, reserve before dispatch and retain the full result for recovery.
import {createSchemaInitializer} from './_schema-once.js';

export const ensureImportRequests = createSchemaInitializer([
  `CREATE TABLE IF NOT EXISTS report_import_requests (
    user_id INTEGER NOT NULL, request_id TEXT NOT NULL, draft_id TEXT NOT NULL,
    source_hash TEXT NOT NULL, context_hash TEXT NOT NULL, input_hash TEXT NOT NULL,
    status TEXT NOT NULL, response_json TEXT NOT NULL DEFAULT '', response_status INTEGER,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(user_id,request_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_report_import_requests_draft ON report_import_requests(user_id,draft_id,created_at)'
]);
const error = (status, code, message) => Object.assign(new Error(message), {status, code});
export async function importDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function importBinding(value) {
  if (!value || typeof value.draftId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(value.draftId)
    || typeof value.sourceHash !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.sourceHash)
    || typeof value.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contextHash)) {
    throw error(400, 'INVALID', '缺少已保存草稿、原件与上下文绑定；未调用模型');
  }
  return {draftId:value.draftId, sourceHash:value.sourceHash, contextHash:value.contextHash};
}
export function importRequestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw error(400, 'INVALID', '缺少有效的已保存候选编号；未调用模型');
  return value;
}
function sameBinding(row, binding) {
  return row.draft_id === binding.draftId && row.source_hash === binding.sourceHash && row.context_hash === binding.contextHash;
}
export async function findImportRequest(env, userId, id, binding) {
  const row = await env.DB.prepare('SELECT * FROM report_import_requests WHERE user_id=? AND request_id=?').bind(userId,id).first();
  if (row && !sameBinding(row,binding)) throw error(409,'CONTEXT_CONFLICT','请求对应的草稿、原件或修改范围不同，旧结果未返回；请保留现有工作稿');
  return row;
}
export async function claimImportRequest(env,userId,id,binding,generation) {
  await ensureImportRequests(env);
  const hash = await importDigest({binding,generation}), now = Date.now();
  const inserted = await env.DB.prepare("INSERT INTO report_import_requests(user_id,request_id,draft_id,source_hash,context_hash,input_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'running',?,?) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING request_id")
    .bind(userId,id,binding.draftId,binding.sourceHash,binding.contextHash,hash,now,now).first();
  const row = await findImportRequest(env,userId,id,binding);
  if (!row) throw error(503,'STORAGE','请求登记未成功，未调用模型');
  if (row.input_hash !== hash) throw error(409,'INPUT_CONFLICT','同一请求编号的内容已变化，禁止再次调用模型');
  return {claimed:!!inserted,row};
}
export function importReceipt(row,now=Date.now()) {
  let status = row.status;
  // A crashed worker cannot attest whether the provider completed or billed it.
  if (status === 'running' && now - Number(row.created_at) > 180000) status = 'outcome_unknown';
  let result = null;
  if (row.response_json) {
    try { result = JSON.parse(row.response_json); }
    catch { throw error(503,'STORAGE','已保存回执无法读取，保留原记录并停止生成'); }
  }
  return {request_id:row.request_id, durable_import_request_protocol:1, status,
    binding:{draftId:row.draft_id,sourceHash:row.source_hash,contextHash:row.context_hash},
    created_at:Number(row.created_at),updated_at:Number(row.updated_at),
    result,response_status:row.response_status == null ? null : Number(row.response_status),
    retry_allowed:false,billing_confirmed:false};
}
export async function settleImportRequest(env,userId,id,response) {
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = {error:'模型接口未返回有效回执；结果与费用待核对，禁止自动补发'}; }
  const completed = response.ok && result.single_attempt === true && result.single_attempt_protocol === 1 && result.request_id === id
    && result.finish_reason === 'stop' && !result.tool_calls?.length && Array.isArray(result.content)
    && result.content.length === 1 && result.content[0]?.type === 'text' && typeof result.content[0].text === 'string' && !!result.content[0].text.trim();
  // Even a 4xx/5xx from generate does not prove that no upstream cost occurred.
  await env.DB.prepare("UPDATE report_import_requests SET status=?,response_json=?,response_status=?,updated_at=? WHERE user_id=? AND request_id=? AND status='running'")
    .bind(completed?'completed':'outcome_unknown',JSON.stringify(result),response.status,Date.now(),userId,id).run();
}
export async function markImportUnknown(env,userId,id) {
  await env.DB.prepare("UPDATE report_import_requests SET status='outcome_unknown',updated_at=? WHERE user_id=? AND request_id=? AND status='running'").bind(Date.now(),userId,id).run();
}
