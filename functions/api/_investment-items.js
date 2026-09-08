import {lifecycleError,lifecycleEvent,assertProjectObject} from './_lifecycle-integrity.js';
import {verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
const parse=(v,f={})=>{try{return typeof v==='string'?JSON.parse(v):v??f;}catch{return f;}};
const clean=(v,n=100)=>String(v??'').trim().slice(0,n);
const fail=(status,message)=>{throw lifecycleError(status,message);};
const completed=status=>['done','mitigated','closed'].includes(status);
export async function ensureInvestmentItems(env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS investment_item_context (item_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, item_type TEXT NOT NULL, stage_key TEXT NOT NULL DEFAULT '', milestone_id TEXT NOT NULL DEFAULT '', evidence_ids_json TEXT NOT NULL DEFAULT '[]', completion_meta_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER NOT NULL, updated_at BIGINT NOT NULL)").run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_investment_item_context_project ON investment_item_context(project_id)').run();
}
export async function investmentItemLinks(env,access,b,previous={}){
  let stageKey=b.stageKey===undefined?previous.stage_key||'':clean(b.stageKey,50),milestoneId=b.milestoneId===undefined?previous.milestone_id||'':clean(b.milestoneId);
  if(stageKey&&!globalThis.ProjectBrain.STAGES.some(x=>x.key===stageKey))fail(400,'事项关联的工作阶段无效');
  if(milestoneId){const milestone=await assertProjectObject(env,'project_milestones',milestoneId,access.row.id);if(!milestone||milestone.status==='cancelled')fail(409,'关联里程碑不存在或已取消');if(stageKey&&milestone.stage_key&&stageKey!==milestone.stage_key)fail(409,'事项工作阶段与里程碑所属阶段不一致');if(!stageKey)stageKey=milestone.stage_key||'';}
  return {stageKey,milestoneId};
}
export async function updateInvestmentItem(env,actor,access,b){
  const table={task:'project_tasks',risk:'project_risks'}[b.type],allowed={task:['open','done','cancelled'],risk:['open','mitigated','closed']}[b.type];if(!table||!allowed.includes(b.status))fail(400,'事项类型或状态无效');
  const id=clean(b.id),projectId=access.row.id,row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=? AND user_id=?`).bind(id,projectId,access.ownerUserId).first();if(!row)fail(404,'项目事项不存在');
  const previous=await env.DB.prepare('SELECT * FROM investment_item_context WHERE item_id=? AND project_id=?').bind(id,projectId).first(),links=await investmentItemLinks(env,access,b,previous||{});
  if(b.expectedVersion!==undefined&&(!Number.isInteger(b.expectedVersion)||b.expectedVersion!==Number(previous?.version||0)))fail(409,'事项关联已变化，请刷新后重试');
  const ids=b.evidenceIds===undefined?parse(previous?.evidence_ids_json,[]):b.evidenceIds;if(!Array.isArray(ids)||ids.length>20||ids.some(x=>typeof x!=='string'||!x.trim()))fail(400,'请提供最多20条有效的项目证据ID');
  const evidenceIds=[...new Set(ids.map(x=>clean(x)))],proofs=[];if(completed(b.status)&&!evidenceIds.length)fail(409,'完成/缓释/关闭事项必须关联已确认项目证据；旧完成状态不等于本次核验');
  for(const evidenceId of evidenceIds){const evidence=await verifyInvestmentEvidence(env,access,evidenceId);proofs.push({id:evidenceId,hash:await reportEvidenceHash(evidence)});}
  const oldMeta=parse(previous?.completion_meta_json),same=previous&&row.status===b.status&&links.stageKey===previous.stage_key&&links.milestoneId===previous.milestone_id&&JSON.stringify(evidenceIds)===previous.evidence_ids_json&&oldMeta.status===(completed(b.status)?'evidence_verified':'not_completed')&&JSON.stringify(oldMeta.proofs||[])===JSON.stringify(proofs);
  if(same)return {ok:true,id,status:b.status,contextVersion:Number(previous.version),reused:true};
  const now=Date.now(),version=Number(previous?.version||0)+1,meta={status:completed(b.status)?'evidence_verified':'not_completed',proofs,actorUserId:Number(actor.userId),checkedAt:now};
  await env.DB.prepare('INSERT INTO investment_item_context(item_id,project_id,item_type,stage_key,milestone_id,evidence_ids_json,completion_meta_json,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET stage_key=excluded.stage_key,milestone_id=excluded.milestone_id,evidence_ids_json=excluded.evidence_ids_json,completion_meta_json=excluded.completion_meta_json,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(id,projectId,b.type,links.stageKey,links.milestoneId,JSON.stringify(evidenceIds),JSON.stringify(meta),version,actor.userId,now).run();
  await env.DB.prepare(`UPDATE ${table} SET status=?,updated_at=? WHERE id=? AND project_id=? AND user_id=?`).bind(b.status,now,id,projectId,access.ownerUserId).run();
  await lifecycleEvent(env,actor,access.ownerUserId,projectId,b.type+'.status',{id,status:b.status,...links,evidenceIds,contextVersion:version,completionVerification:meta.status});return {ok:true,id,status:b.status,...links,evidenceIds,contextVersion:version,completionVerification:meta.status};
}
export async function readInvestmentItemContexts(env,access,items){
  const rows=(await env.DB.prepare('SELECT * FROM investment_item_context WHERE project_id=?').bind(access.row.id).all()).results||[],byId=new Map(rows.map(x=>[x.item_id,x])),result={};
  for(const item of items){const row=byId.get(item.id),meta=parse(row?.completion_meta_json),evidenceIds=parse(row?.evidence_ids_json,[]);let verification=completed(item.status)?'legacy_unverified':'not_completed';
    if(completed(item.status)&&meta.status==='evidence_verified'&&evidenceIds.length){verification='evidence_verified';try{for(const id of evidenceIds){const evidence=await verifyInvestmentEvidence(env,access,id);if(meta.proofs?.find(x=>x.id===id)?.hash!==await reportEvidenceHash(evidence))throw Error('changed');}}catch{verification='evidence_changed_or_unavailable';}}
    result[item.id]={stageKey:row?.stage_key||'',milestoneId:row?.milestone_id||'',completionEvidenceIds:evidenceIds,completionVerification:verification,contextVersion:Number(row?.version||0)};
  }return result;
}
