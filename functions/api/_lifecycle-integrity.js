// Project-owned lifecycle mutations: lock, reauthorize, validate links and audit together.
import '../../project-brain.js';
import { resolveProjectAccess } from './_project-access.js';

const clean = (value, size=200) => String(value == null ? '' : value).trim().slice(0,size);
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
export function lifecycleError(status, message) { return Object.assign(new Error(message), {status}); }
export async function ensureLifecycleIntegrity(env) {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS project_profiles (project_id TEXT PRIMARY KEY,owner_user_id INTEGER NOT NULL,organization_id TEXT DEFAULT '',department_id TEXT DEFAULT '',visibility TEXT NOT NULL DEFAULT 'private',confidentiality_level TEXT NOT NULL DEFAULT 'internal',lifecycle_stage TEXT NOT NULL DEFAULT 'discovery',current_gate_id TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS project_work_stages (project_id TEXT PRIMARY KEY,stage_key TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_by INTEGER NOT NULL,updated_at BIGINT NOT NULL,legacy_conflict_json TEXT NOT NULL DEFAULT '{}')",
    "CREATE TABLE IF NOT EXISTS project_fact_details (fact_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,meta_json TEXT NOT NULL DEFAULT '{}')",
    "CREATE INDEX IF NOT EXISTS idx_project_fact_details_project ON project_fact_details(project_id)",
    "CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS project_stage_history (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,from_stage TEXT DEFAULT '',to_stage TEXT NOT NULL,reason TEXT DEFAULT '',approved_by TEXT DEFAULT '',changed_at BIGINT NOT NULL)"
  ]) await env.DB.prepare(sql).run();
}

export async function withProjectMutation(env, actor, projectId, permission, fn) {
  if (!env.DB._transaction) throw lifecycleError(503,'当前数据库不支持原子保存，请使用 PostgreSQL 部署后重试');
  return env.DB._transaction(async DB => {
    await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
    const tx = {...env, DB}, access = await resolveProjectAccess(tx,actor.userId,projectId);
    if (!access) throw lifecycleError(404,'项目不存在或无权访问');
    if (!access.permissions[permission]) throw lifecycleError(403,'当前项目角色没有此操作权限');
    return fn(tx,access);
  });
}

const LINK_TABLES = new Set(['project_gates','project_milestones','project_deliverables','project_artifacts','project_facts','project_scenarios','project_decisions']);
export async function assertProjectObject(env, table, id, projectId, options={}) {
  if (!id) return null;
  if (!LINK_TABLES.has(table)) throw new Error('Unsupported lifecycle object');
  // Project row locks differ across projects. Serialize a client-supplied ID as well,
  // so two projects cannot both pass the missing-object check before an UPSERT.
  if(options.allowMissing)await env.DB.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').bind(table+':'+id).first();
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  if (!row && options.allowMissing) return null;
  if (!row || row.project_id !== projectId) throw lifecycleError(404,'关联对象不存在或不属于当前项目');
  if (options.ownerUserId != null && Number(row.user_id) !== Number(options.ownerUserId)) throw lifecycleError(404,'关联对象不是当前项目的共享资料');
  return row;
}

export async function lifecycleEvent(env, actor, ownerUserId, projectId, eventType, payload) {
  await env.DB.prepare('INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind('lifecycle-'+crypto.randomUUID(),projectId,ownerUserId,eventType,clean(actor.username||actor.userId,80),JSON.stringify({...payload,actorUserId:Number(actor.userId)}),Date.now()).run();
}

export async function readWorkStage(env, row, profile) {
  const stored = await env.DB.prepare('SELECT * FROM project_work_stages WHERE project_id=?').bind(row.id).first();
  const data=parse(row.data), legacy=data.workflow?.management?.investmentStage||data.project?.investmentStage||'', valid=key=>globalThis.ProjectBrain.STAGES.some(stage=>stage.key===key);
  if (!profile) profile = await env.DB.prepare('SELECT * FROM project_profiles WHERE project_id=?').bind(row.id).first();
  const profileStage=profile?.lifecycle_stage||profile?.lifecycleStage||'', legacyConflict=valid(legacy)&&valid(profileStage)&&legacy!==profileStage ? {profileStage,legacyStage:legacy,status:'needs_confirmation'} : null;
  const key=stored?.stage_key || (valid(profileStage)?profileStage:valid(legacy)?legacy:'discovery');
  return {key,label:globalThis.ProjectBrain.stage(key).label,version:Number(stored?.version||0),source:stored?'project_work_stages':valid(profileStage)?'legacy_profile':valid(legacy)?'legacy_explicit':'default',legacyConflict:stored?null:legacyConflict,updatedAt:Number(stored?.updated_at||0)};
}

export async function updateWorkStage(env, actor, body) {
  const target=clean(body.stageKey,50);
  if (!globalThis.ProjectBrain.STAGES.some(stage=>stage.key===target)) throw lifecycleError(400,'项目工作阶段无效');
  if (!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0) throw lifecycleError(428,'请先刷新工作阶段，再提交当前版本号');
  return withProjectMutation(env,actor,body.projectId,'manage',async(tx,access)=>{
    const before=await readWorkStage(tx,access.row);
    if (before.version!==body.expectedVersion) throw lifecycleError(409,'项目工作阶段已被其他人修改，请刷新后核对');
    if (before.key===target&&!before.legacyConflict) return {ok:true,stage:before,unchanged:true};
    const now=Date.now(),version=before.version+1,data=parse(access.row.data),workflow=data.workflow||(data.workflow={}),management=workflow.management||(workflow.management={});
    management.investmentStage=target;management.workStageVersion=version;management.stageUpdatedAt=now;management.stageUpdatedBy=Number(actor.userId);
    await tx.DB.prepare('INSERT INTO project_work_stages(project_id,stage_key,version,updated_by,updated_at,legacy_conflict_json) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET stage_key=excluded.stage_key,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at,legacy_conflict_json=excluded.legacy_conflict_json').bind(body.projectId,target,version,actor.userId,now,JSON.stringify(before.legacyConflict||{})).run();
    await tx.DB.prepare("INSERT INTO project_profiles(project_id,owner_user_id,lifecycle_stage,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET lifecycle_stage=excluded.lifecycle_stage,updated_at=excluded.updated_at").bind(body.projectId,access.ownerUserId,target,now,now).run();
    await tx.DB.prepare('UPDATE projects SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(data),Math.max(now,Number(access.row.updated_at)+1),body.projectId).run();
    // Work-stage correction is explicitly not a formal approval.
    await tx.DB.prepare('INSERT INTO project_stage_history(id,project_id,user_id,from_stage,to_stage,reason,approved_by,changed_at) VALUES(?,?,?,?,?,?,?,?)').bind('work-stage-'+crypto.randomUUID(),body.projectId,access.ownerUserId,before.key,target,clean(body.reason,300),'',now).run();
    await lifecycleEvent(tx,actor,access.ownerUserId,body.projectId,'project.work_stage.updated',{from:before.key,to:target,version,legacyConflict:before.legacyConflict,formalApproval:false});
    return {ok:true,stage:{key:target,label:globalThis.ProjectBrain.stage(target).label,version,source:'project_work_stages',legacyConflict:null,updatedAt:now},previousStageKey:before.key,undo:{stageKey:before.key,expectedVersion:version}};
  });
}
