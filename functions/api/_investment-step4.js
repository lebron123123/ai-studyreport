// Step 4 orchestration. Every mutation is called under the project row lock.
import {ensurePostEvaluation,createPostEvaluation,readPostEvaluations,saveContractCandidate,confirmContractClause} from './_investment-post-evaluation.js';
import {readFormalFacts} from './_investment-formal-facts.js';
import {verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {resolveProjectAccess} from './_project-access.js';
import {lifecycleError,lifecycleEvent,withProjectMutation} from './_lifecycle-integrity.js';
import {reportEvidenceHash as hash} from './_report-trusted-evaluation.js';
import {ensureWikiSchema,publishReviewedWiki} from './wiki.js';
import {ensureWikiSourceAccess,bindWikiSources,wikiSourcesAccessible} from './_wiki-source-access.js';
import {evaluationDate,evaluationTableHeaders} from '../../investment-post-evaluation.mjs';
const fail=(s,m)=>{throw lifecycleError(s,m);},parse=s=>JSON.parse(s||'{}');
const text=(v,n=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>n)fail(400,'请填写必要字段，且不要超过长度限制');return v.trim();};
export const step4Actions=new Set(['contractReadSource','contractCandidate','contractConfirm','evaluationCreate','evaluationSubmit','evaluationReview','rectificationCreate','rectificationSubmit','rectificationReview','experienceSave','experienceSubmit','experienceReview','experiencePublish','experienceWithdraw','evaluationSchedule','evaluationNoticeComplete','step4Refresh']);
export const step4Schema=[
 "CREATE TABLE IF NOT EXISTS investment_step4_records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,parent_id TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,created_by INTEGER NOT NULL,updated_at BIGINT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS investment_step4_history(record_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(record_id,version))",
 "CREATE INDEX IF NOT EXISTS idx_step4_project ON investment_step4_records(project_id,kind)",
 "CREATE TABLE IF NOT EXISTS investment_evaluation_schedule(project_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL,next_date TEXT NOT NULL,interval_days INTEGER NOT NULL,basis TEXT NOT NULL,updated_by INTEGER NOT NULL)",
 "CREATE TABLE IF NOT EXISTS investment_step4_notices(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,title TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',updated_at BIGINT NOT NULL)"
];
export async function ensureStep4(env){await ensurePostEvaluation(env);await ensureWikiSchema(env);await ensureWikiSourceAccess(env);for(const s of step4Schema)await env.DB.prepare(s).run();}
async function record(env,a,id,kind){const r=await env.DB.prepare('SELECT * FROM investment_step4_records WHERE id=? AND project_id=?').bind(text(id,100),a.row.id).first();if(!r||r.kind!==kind)fail(404,'记录不存在');return {...r,payload:parse(r.payload_json)};}
function version(b,r){if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!==Number(r?.version||0))fail(409,'记录已变化，请刷新核对后重试');}
async function put(env,actor,a,r,payload,status){const v=Number(r.version||0)+1,now=Date.now();await env.DB.prepare('INSERT INTO investment_step4_records(id,project_id,kind,parent_id,version,status,payload_json,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at').bind(r.id,a.row.id,r.kind,r.parent_id||'',v,status,JSON.stringify(payload),r.created_by||actor.userId,now).run();await env.DB.prepare('INSERT INTO investment_step4_history(record_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').bind(r.id,v,JSON.stringify({payload,status,actor:actor.userId}),now).run();await lifecycleEvent(env,actor,a.ownerUserId,a.row.id,'step4.'+r.kind+'.'+status,{id:r.id,version:v});return {ok:true,id:r.id,version:v,status};}
async function independent(env,actor,a,author){if(Number(author)===Number(actor.userId))fail(403,'提交人与复核人必须不同');if(!a.permissions.edit||!await env.DB.prepare('SELECT user_id FROM investment_fact_verifiers WHERE project_id=? AND user_id=? AND active=1').bind(a.row.id,actor.userId).first())fail(403,'需要当前有效的独立核验授权');}
async function proof(env,a,id,locator){return {id:text(id,100),locator:text(locator,1000),hash:await hash(await verifyInvestmentEvidence(env,a,id))};}
async function currentProof(env,a,p){try{return p&&p.hash===await hash(await verifyInvestmentEvidence(env,a,p.id));}catch(e){if([400,403,404,409].includes(e.status))return false;throw e;}}
async function evaluation(env,actor,a,id){const e=(await readPostEvaluations(env,actor,a)).find(x=>x.id===id);if(!e)fail(404,'后评价不存在');if(!e.current)fail(409,'目标批准或实际证据已变化，请重新建立评价快照');return e;}
async function reviewedEvaluation(env,actor,a,id){const e=await evaluation(env,actor,a,id),r=await record(env,a,id,'evaluation');if(r.status!=='approved')fail(409,'请先完成后评价独立复核');return {e,r};}
async function evaluationSources(env,a,e){const out=e.snapshot.sources.map(p=>({projectId:a.row.id,evidenceId:p.id,locator:p.locator}));for(const x of e.snapshot.actuals)out.push({projectId:a.row.id,evidenceId:x.sourceEvidenceId,locator:x.sourceRef});return out;}
async function experienceCurrent(env,actor,a,r){
 try{await reviewedEvaluation(env,actor,a,r.parent_id);}catch(e){if([404,409].includes(e.status))return false;throw e;}
 for(const id of r.payload.rectificationIds||[]){const fix=await record(env,a,id,'rectification');if(fix.status!=='closed'||!await currentProof(env,a,fix.payload.proof))return false;}
 return r.payload.reviewDate>=new Date().toISOString().slice(0,10)&&await wikiSourcesAccessible(env,actor.userId,r.id);
}
export async function readStep4(env,actor,a){
 const formal=await readFormalFacts(env,actor,a),evaluations=await readPostEvaluations(env,actor,a);
 const records=(await env.DB.prepare('SELECT * FROM investment_step4_records WHERE project_id=? ORDER BY updated_at DESC LIMIT 1001').bind(a.row.id).all()).results||[];if(records.length>1000)fail(413,'台账超过单页安全上限，请联系管理员分期归档');
 for(const r of records){r.payload=parse(r.payload_json);delete r.payload_json;r.current=r.kind==='experience'?await experienceCurrent(env,actor,a,r):r.kind==='rectification'&&r.status==='closed'?await currentProof(env,a,r.payload.proof):true;}
 const clauses=(await env.DB.prepare('SELECT * FROM investment_contract_clauses WHERE project_id=? ORDER BY updated_at DESC LIMIT 501').bind(a.row.id).all()).results||[];if(clauses.length>500)fail(413,'条款超过安全读取上限');
 for(const r of clauses){r.payload=parse(r.payload_json);delete r.payload_json;}
 const proofs=[];for(const table of ['project_facts','project_artifacts']){const rows=(await env.DB.prepare(`SELECT id FROM ${table} WHERE project_id=? ORDER BY updated_at DESC LIMIT 100`).bind(a.row.id).all()).results||[];for(const r of rows)try{const p=await verifyInvestmentEvidence(env,a,r.id);proofs.push({id:r.id,label:p.title||p.fact_key||r.id});}catch(e){if(![400,403,404,409].includes(e.status))throw e;}}
 return {ok:true,permissions:a.permissions,actorId:actor.userId,canVerify:formal.canVerify,members:formal.members,approvals:[formal.approvedBaseline,formal.approvedAdjustment].filter(Boolean),proofs,evaluations,records,clauses,headers:evaluationTableHeaders,schedule:await env.DB.prepare('SELECT * FROM investment_evaluation_schedule WHERE project_id=?').bind(a.row.id).first(),notices:(await env.DB.prepare("SELECT * FROM investment_step4_notices WHERE project_id=? AND status='open' ORDER BY updated_at DESC").bind(a.row.id).all()).results||[]};
}
export async function mutateStep4(env,actor,a,b){
 if(b.action==='contractReadSource'){const p=await verifyInvestmentEvidence(env,a,text(b.sourceEvidenceId,100)),content=JSON.stringify(p);return {ok:true,content:content.slice(0,16000),truncated:content.length>16000};}
 if(b.action==='contractCandidate')return saveContractCandidate(env,actor,a,b);
 if(b.action==='contractConfirm')return confirmContractClause(env,actor,a,b);
 if(b.action==='evaluationCreate'){const result=await createPostEvaluation(env,actor,a,b);if(!result.reused)await put(env,actor,a,{id:result.id,kind:'evaluation'},{reason:'',authorId:actor.userId},'draft');return result;}
 if(b.action==='evaluationSubmit'||b.action==='evaluationReview'){
  const e=await evaluation(env,actor,a,b.id),r=await record(env,a,b.id,'evaluation');version(b,r);let p={...r.payload,reason:text(b.reason)},status;
  if(b.action==='evaluationSubmit'){if(!['draft','returned'].includes(r.status))fail(409,'仅草稿或退回评价可提交');p.authorId=actor.userId;status='submitted';}
  else{if(r.status!=='submitted'||typeof b.approved!=='boolean'||b.confirmed!==true)fail(409,'请核对目标原文、实际口径、缺失项并明确复核结论');await independent(env,actor,a,r.payload.authorId);status=b.approved?'approved':'returned';p={...p,reviewerId:actor.userId,reviewedAt:Date.now(),coverage:e.snapshot.comparison.coverage};}
  await env.DB.prepare('UPDATE investment_post_evaluations SET status=? WHERE id=? AND project_id=?').bind(status,r.id,a.row.id).run();return put(env,actor,a,r,p,status);
 }
 if(b.action==='rectificationCreate'){
  await reviewedEvaluation(env,actor,a,b.evaluationId);const id=text(b.id,100),old=await env.DB.prepare('SELECT id FROM investment_step4_records WHERE id=?').bind(id).first();if(old)fail(409,'整改标识已使用，请刷新');const owner=Number(b.ownerId);if(!Number.isSafeInteger(owner)||!(await resolveProjectAccess(env,owner,a.row.id))?.permissions.edit)fail(400,'责任人必须是有效编辑成员');const p={issue:text(b.issue),cause:text(b.cause),ownerId:owner,dueDate:evaluationDate(b.dueDate),dueBasis:text(b.dueBasis),authorId:actor.userId};
  await env.DB.prepare('INSERT INTO project_tasks(id,project_id,user_id,title,owner,due_date,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'open\',?,?)').bind(id,a.row.id,a.ownerUserId,p.issue,String(owner),p.dueDate,'post-evaluation:'+b.evaluationId,Date.now(),Date.now()).run();return put(env,actor,a,{id,kind:'rectification',parent_id:b.evaluationId},p,'open');
 }
 if(b.action==='rectificationSubmit'||b.action==='rectificationReview'){
  const r=await record(env,a,b.id,'rectification');version(b,r);await reviewedEvaluation(env,actor,a,r.parent_id);let p={...r.payload},status;
  if(b.action==='rectificationSubmit'){if(!['open','returned'].includes(r.status)&&!(r.status==='closed'&&!await currentProof(env,a,p.proof)))fail(409,'当前整改不能提交');if(Number(p.ownerId)!==Number(actor.userId)&&!a.permissions.manage)fail(403,'仅责任人或负责人可提交');p={...p,proof:await proof(env,a,b.sourceEvidenceId,b.locator),reason:text(b.reason),submitter:actor.userId};status='submitted';}
  else{if(r.status!=='submitted'||typeof b.approved!=='boolean'||b.confirmed!==true)fail(409,'请明确整改复核结论');await independent(env,actor,a,p.submitter);if(!await currentProof(env,a,p.proof))fail(409,'整改证据已变化或失效');status=b.approved?'closed':'returned';p={...p,reviewReason:text(b.reason),reviewerId:actor.userId,reviewedAt:Date.now()};}
  await env.DB.prepare('UPDATE project_tasks SET status=?,updated_at=? WHERE id=? AND project_id=?').bind(status==='closed'?'done':'open',Date.now(),r.id,a.row.id).run();return put(env,actor,a,r,p,status);
 }
 if(b.action==='experienceSave'){
  const {e}=await reviewedEvaluation(env,actor,a,b.evaluationId);const id=b.id||'ev-'+crypto.randomUUID().replaceAll('-','');if(!/^ev-[a-f0-9]{32}$/.test(id))fail(400,'经验ID不合法');const existing=await env.DB.prepare('SELECT * FROM investment_step4_records WHERE id=? AND project_id=?').bind(id,a.row.id).first();version(b,existing);if(existing&&!['draft','returned','withdrawn'].includes(existing.status))fail(409,'已提交或发布经验须先撤回再编辑');if(existing&&existing.parent_id!==e.id)fail(409,'经验不得更换来源评价，请新建经验');
  const title=text(b.title,80),content=text(b.content,30000),reviewDate=evaluationDate(b.reviewDate);if(content.length<60||reviewDate<new Date().toISOString().slice(0,10))fail(400,'正文至少60字且复核日期不能过期');
  const ids=b.rectificationIds||[];if(!Array.isArray(ids)||ids.length>20||new Set(ids).size!==ids.length)fail(400,'整改关联列表不合法');const sources=await evaluationSources(env,a,e);
  for(const fixId of ids){const fix=await record(env,a,fixId,'rectification');if(fix.parent_id!==e.id||fix.status!=='closed'||!await currentProof(env,a,fix.payload.proof))fail(409,'仅关联本评价已独立复核且证据有效的整改');sources.push({projectId:a.row.id,evidenceId:fix.payload.proof.id,locator:fix.payload.proof.locator});}
  const unique=[...new Map(sources.map(s=>[s.evidenceId,s])).values()];if(unique.length>20)fail(400,'单篇经验最多关联20份原件，请拆分经验');
  await env.DB.prepare("INSERT INTO wiki_pages(id,title,kind,status,content,source_ref,security,dept_scope,expiry_date,created_by,created_name,created_at,updated_at) VALUES(?,?,'case','draft',?,?,1,'全部门',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status='draft',content=excluded.content,source_ref=excluded.source_ref,expiry_date=excluded.expiry_date,updated_at=excluded.updated_at").bind(id,title,content,'项目 '+a.row.id+'；评价 '+e.id,reviewDate,actor.userId,actor.username||String(actor.userId),Date.now(),Date.now()).run();
  await env.DB.prepare('DELETE FROM wiki_source_bindings WHERE wiki_id=?').bind(id).run();await bindWikiSources(env,actor.userId,id,unique);
  return put(env,actor,a,existing||{id,kind:'experience',parent_id:e.id},{title,content,reviewDate,rectificationIds:ids,authorId:actor.userId,sources:unique,scope:'source_project_intersection'},'draft');
 }
 if(['experienceSubmit','experienceReview','experiencePublish','experienceWithdraw'].includes(b.action)){
  const r=await record(env,a,b.id,'experience');version(b,r);let p={...r.payload},status;
  if(b.action!=='experienceWithdraw'&&!await experienceCurrent(env,actor,a,r))fail(409,'来源变化、撤回或复核到期，须重新核验并修订经验');
  if(b.action==='experienceSubmit'){if(!['draft','returned'].includes(r.status))fail(409,'当前经验不能提交');p.authorId=actor.userId;status='submitted';}
  if(b.action==='experienceReview'){if(r.status!=='submitted'||typeof b.approved!=='boolean'||b.confirmed!==true)fail(409,'请明确经验复核结论');await independent(env,actor,a,p.authorId);status=b.approved?'approved':'returned';p={...p,reviewerId:actor.userId,reviewReason:text(b.reason)};}
  if(b.action==='experiencePublish'){if(!a.permissions.manage||r.status!=='approved')fail(403,'仅负责人可发布已独立复核经验');const page=await env.DB.prepare('SELECT * FROM wiki_pages WHERE id=?').bind(r.id).first();await publishReviewedWiki(env,actor,page);status='published';}
  if(b.action==='experienceWithdraw'){if(!a.permissions.manage)fail(403,'仅负责人可撤回经验');p.reason=text(b.reason);status='withdrawn';await env.DB.prepare("UPDATE wiki_pages SET status='archived',updated_at=? WHERE id=?").bind(Date.now(),r.id).run();await env.DB.prepare('UPDATE rag_files_v2 SET enabled=0 WHERE title LIKE ?').bind('【Wiki】'+r.id+'｜%').run();}
  return put(env,actor,a,r,p,status);
 }
 if(b.action==='evaluationSchedule'){
  if(!a.permissions.manage||typeof b.enabled!=='boolean')fail(403,'仅负责人可启停后评价计划');const r=await env.DB.prepare('SELECT * FROM investment_evaluation_schedule WHERE project_id=?').bind(a.row.id).first();version(b,r);const next=evaluationDate(b.nextDate),days=b.intervalDays;if(!Number.isSafeInteger(days)||days<1||days>3660)fail(400,'周期须为1至3660天');await env.DB.prepare('INSERT INTO investment_evaluation_schedule(project_id,enabled,version,next_date,interval_days,basis,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,next_date=excluded.next_date,interval_days=excluded.interval_days,basis=excluded.basis,updated_by=excluded.updated_by').bind(a.row.id,b.enabled?1:0,Number(r?.version||0)+1,next,days,text(b.basis),actor.userId).run();await lifecycleEvent(env,actor,a.ownerUserId,a.row.id,'step4.schedule',{enabled:b.enabled,next,days});return {ok:true};
 }
 if(b.action==='evaluationNoticeComplete'){
  if(!a.permissions.manage)fail(403,'仅负责人可确认后评价计划完成');const n=await env.DB.prepare("SELECT * FROM investment_step4_notices WHERE id=? AND project_id=? AND status='open'").bind(text(b.id,150),a.row.id).first();if(!n||!n.id.startsWith('scheduled-'))fail(409,'仅计划提醒可关联已复核评价完成');const {e}=await reviewedEvaluation(env,actor,a,b.evaluationId);const day=n.id.slice(-10);if(Number(e.snapshot.createdAt)<Date.parse(day))fail(409,'评价必须在本次计划日期后建立');await env.DB.prepare("UPDATE investment_step4_notices SET status='done',reason=?,updated_at=? WHERE id=? AND project_id=?").bind(n.reason+'；完成评价：'+e.id,Date.now(),n.id,a.row.id).run();await lifecycleEvent(env,actor,a.ownerUserId,a.row.id,'step4.schedule.completed',{noticeId:n.id,evaluationId:e.id});return {ok:true};
 }
 if(b.action==='step4Refresh'){await refreshStep4(env,actor,a);return {ok:true};}
 fail(400,'未知步骤4操作');
}
export async function refreshStep4(env,actor,a){
 const data=await readStep4(env,actor,a),today=new Date().toISOString().slice(0,10),notices=[];
 for(const r of data.records)if(!r.current){notices.push({id:'review-'+r.id,title:r.kind==='experience'?'经验需要重新复核':'整改证据需要重新复核',reason:'来源变化、撤回或复核到期；不得继续引用旧结论'});if(r.kind==='experience')await env.DB.prepare("UPDATE wiki_pages SET status='archived' WHERE id=?").bind(r.id).run();if(r.kind==='rectification')await env.DB.prepare("UPDATE project_tasks SET status='open' WHERE id=? AND project_id=?").bind(r.id,a.row.id).run();}
 for(const e of data.evaluations)if(!e.current)notices.push({id:'review-'+e.id,title:'后评价目标/实际来源失效',reason:'重新建立评价快照并独立复核'});
 const s=data.schedule;if(s?.enabled&&s.next_date<=today){notices.push({id:'scheduled-'+a.row.id+'-'+s.next_date,title:'后评价计划到期：'+s.next_date,reason:s.basis+'；请人工选择批准目标建立评价，未自动批准'});const days=Math.floor((Date.parse(today)-Date.parse(s.next_date))/86400000),next=new Date(Date.parse(s.next_date)+(Math.floor(days/s.interval_days)+1)*s.interval_days*86400000).toISOString().slice(0,10);await env.DB.prepare('UPDATE investment_evaluation_schedule SET next_date=?,version=version+1 WHERE project_id=?').bind(next,a.row.id).run();}
 for(const n of notices)await env.DB.prepare("INSERT INTO investment_step4_notices(id,project_id,title,reason,status,updated_at) VALUES(?,?,?,?,'open',?) ON CONFLICT(id) DO UPDATE SET status='open',reason=excluded.reason,updated_at=excluded.updated_at").bind(n.id,a.row.id,n.title,n.reason,Date.now()).run();
 for(const r of data.records)if(r.current&&['closed','published'].includes(r.status))await env.DB.prepare("UPDATE investment_step4_notices SET status='done',updated_at=? WHERE id=? AND project_id=?").bind(Date.now(),'review-'+r.id,a.row.id).run();
}
export async function tickStep4(env){
 const projects=(await env.DB.prepare("SELECT DISTINCT project_id FROM investment_step4_records UNION SELECT project_id FROM investment_evaluation_schedule WHERE enabled=1").all()).results||[];
 for(const p of projects){const row=await env.DB.prepare('SELECT user_id FROM projects WHERE id=?').bind(p.project_id).first();if(!row)continue;try{const actor={userId:Number(row.user_id)};await withProjectMutation(env,actor,p.project_id,'manage',(tx,a)=>refreshStep4(tx,actor,a));}catch{console.error('[investment-worker] 后评价复核检查失败，保留待办，下轮重试');}}
}
