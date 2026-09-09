// Isolated Step 4 service; API integration follows module acceptance.
import {buildEvaluationComparison,normalizeContractClause,evaluationDate} from '../../investment-post-evaluation.mjs';
import {ensureInvestmentLifecycle,investmentLifecycleRead,verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {ensureObligations} from './_investment-obligations.js';
import {resolveProjectAccess} from './_project-access.js';
import {lifecycleError,lifecycleEvent} from './_lifecycle-integrity.js';
import {reportEvidenceHash as hash} from './_report-trusted-evaluation.js';
import {checkedRows} from './_investment-formal-facts.js';
const fail=(s,m)=>{throw lifecycleError(s,m);};
const parse=s=>JSON.parse(s||'{}');
const str=(v,n=1000)=>{if(typeof v!=='string'||v.length>n||!v.trim())fail(400,'必要字段为空或过长');return v.trim();};
export const postEvaluationSchema=[
 "CREATE TABLE IF NOT EXISTS investment_post_evaluations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,content_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_by INTEGER NOT NULL,created_at BIGINT NOT NULL,UNIQUE(project_id,request_key))",
 "CREATE TABLE IF NOT EXISTS investment_contract_clauses(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,contract_id TEXT NOT NULL,clause_key TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,created_by INTEGER NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(project_id,contract_id,clause_key))",
 "CREATE TABLE IF NOT EXISTS investment_contract_clause_versions(clause_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(clause_id,version))"
];
export async function ensurePostEvaluation(env){await ensureInvestmentLifecycle(env);await ensureObligations(env);for(const sql of postEvaluationSchema)await env.DB.prepare(sql).run();}
async function evidence(env,access,id,locator){str(id,100);str(locator,1000);const value=await verifyInvestmentEvidence(env,access,id);return {id,locator,hash:await hash(value),snapshot:value};}
async function sourceCurrent(env,access,p){try{const source=p.id.startsWith('formal:')?(await checkedRows(env,access.row.id)).find(x=>x.id===p.id.slice(7)&&x.currentValid):await verifyInvestmentEvidence(env,access,p.id);return !!source&&p.hash===await hash(source);}catch(error){if(error.status&&[400,403,404,409].includes(error.status))return false;throw error;}}
export async function createPostEvaluation(env,actor,access,b){
 if(!access.permissions.manage)fail(403,'仅项目负责人可冻结后评价目标');
 const requestKey=str(b.requestKey,100),title=str(b.title,500),approvalId=str(b.approvalId,100);
 if(!Array.isArray(b.targets)||!b.targets.length||b.targets.length>100)fail(400,'请提供1至100项目标');
 const signature=await hash({title,approvalId,targets:b.targets,exclusions:b.exclusions||[]});
 const previous=await env.DB.prepare('SELECT * FROM investment_post_evaluations WHERE project_id=? AND request_key=?').bind(access.row.id,requestKey).first();
 if(previous){if(previous.payload_hash!==signature)fail(409,'同一请求标识不能提交不同内容');return {ok:true,id:previous.id,reused:true,snapshot:parse(previous.snapshot_json)};}
 const lifecycle=await investmentLifecycleRead(env,actor,access),approval=[lifecycle.approvedBaseline,lifecycle.approvedAdjustment].find(x=>x?.id===approvalId&&x.currentValid);
 if(!approval)fail(409,'请选择当前有效且独立核验的原批准或调整批准，不使用预测版冒充批准');
 const sources=[];
 for(const target of b.targets){
  if(target.confirmed!==true||target.sourceEvidenceId!==approval.source_id)fail(400,'各项目标必须人工核对并关联所选批准原件');
  str(target.locator,1000);str(target.quote,4000);
  sources.push({id:'formal:'+approval.id,locator:target.locator,hash:await hash(approval),snapshot:approval});
 }
 const comparison=buildEvaluationComparison(b.targets,lifecycle.actuals,b.exclusions||[]),snapshot={schemaVersion:1,title,approval:structuredClone(approval),targets:structuredClone(b.targets),sources,comparison,createdAt:Date.now(),createdBy:actor.userId,actuals:lifecycle.actuals.filter(x=>comparison.rows.some(r=>r.actualId===x.id)),authority:'owner_confirmed_targets_not_audit',status:'draft'};
 const id='posteval-'+crypto.randomUUID(),contentHash=await hash(snapshot);
 await env.DB.prepare('INSERT INTO investment_post_evaluations(id,project_id,request_key,payload_hash,snapshot_json,content_hash,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,access.row.id,requestKey,signature,JSON.stringify(snapshot),contentHash,'draft',actor.userId,snapshot.createdAt).run();
 await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'postevaluation.created',{id,contentHash,approvalId,coverage:comparison.coverage});return {ok:true,id,snapshot};
}
export async function readPostEvaluations(env,actor,access){
 const rows=(await env.DB.prepare('SELECT * FROM investment_post_evaluations WHERE project_id=? ORDER BY created_at DESC LIMIT 101').bind(access.row.id).all()).results||[];
 if(rows.length>100)fail(413,'后评价超过本次读取上限，需分页后再接入界面');
 const lifecycle=await investmentLifecycleRead(env,actor,access),out=[];
 for(const row of rows){const s=parse(row.snapshot_json);if(await hash(s)!==row.content_hash)fail(409,'后评价快照校验失败');const currentApproval=[lifecycle.approvedBaseline,lifecycle.approvedAdjustment].find(x=>x?.id===s.approval.id);let current=!!currentApproval&&currentApproval.currentValid&&await hash(currentApproval)===await hash(s.approval);for(const p of s.sources)if(!await sourceCurrent(env,access,p))current=false;for(const actual of s.actuals){const live=lifecycle.actuals.find(x=>x.id===actual.id);if(!live||live.requiresReview||lifecycle.actuals.some(x=>x.supersedesId===actual.id))current=false;}out.push({id:row.id,status:row.status,current,snapshot:s,contentHash:row.content_hash});}
 return out;
}
export async function saveContractCandidate(env,actor,access,b){
 const contractId=str(b.contractId,100),clause=normalizeContractClause(b.clause),source=await evidence(env,access,b.sourceEvidenceId,clause.locator),row=await env.DB.prepare('SELECT * FROM investment_contract_clauses WHERE project_id=? AND contract_id=? AND clause_key=?').bind(access.row.id,contractId,clause.clauseId).first();
 if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!==Number(row?.version||0))fail(409,'条款版本变化，请刷新核对；更正应使用原条款编号');
 const sourceText=JSON.stringify(source.snapshot).replace(/\s+/g,'');if(!sourceText.includes(clause.quote.replace(/\s+/g,'')))fail(400,'条款原文未在所选证据中找到，不能把模型改写当成原文');
 if(row?.status==='confirmed'&&(!access.permissions.manage||b.changeConfirmed!==true))fail(409,'正式条款须由负责人明确建立变更候选，原义务暂停至重新确认');
 const id=row?.id||'clause-'+crypto.randomUUID(),version=Number(row?.version||0)+1,now=Date.now(),payload={...clause,activated:false,deadline:null,proposed:clause,source,reason:str(b.reason,2000)};
 await env.DB.prepare("INSERT INTO investment_contract_clauses(id,project_id,contract_id,clause_key,version,status,payload_json,source_id,source_hash,created_by,updated_at) VALUES(?,?,?,?,?,'candidate',?,?,?,?,?) ON CONFLICT(project_id,contract_id,clause_key) DO UPDATE SET version=excluded.version,status='candidate',payload_json=excluded.payload_json,source_id=excluded.source_id,source_hash=excluded.source_hash,created_by=excluded.created_by,updated_at=excluded.updated_at").bind(id,access.row.id,contractId,clause.clauseId,version,JSON.stringify(payload),source.id,source.hash,actor.userId,now).run();
 await env.DB.prepare('INSERT INTO investment_contract_clause_versions(clause_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').bind(id,version,JSON.stringify({payload,status:'candidate',actor:actor.userId}),now).run();
 await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'contract.candidate',{id,version,activated:false});return {ok:true,id,version};
}
export async function confirmContractClause(env,actor,access,b){
 if(!access.permissions.manage||b.confirmed!==true)fail(403,'仅项目负责人明确核对后可确认条款');
 const row=await env.DB.prepare('SELECT * FROM investment_contract_clauses WHERE id=? AND project_id=?').bind(str(b.id,100),access.row.id).first();if(!row)fail(404,'条款不存在');
 if(!Number.isSafeInteger(b.expectedVersion)||Number(row.version)!==b.expectedVersion)fail(409,'条款已变化，请重新核对');
 const old=parse(row.payload_json);if(!await sourceCurrent(env,access,old.source))fail(409,'协议原文已变化，须重新提取核对');
 if(row.status==='confirmed'&&b.changeConfirmed!==true)fail(409,'已确认条款变更须明确确认，不能重复覆盖');
 const clause=normalizeContractClause(b.clause||old.proposed);if(clause.clauseId!==row.clause_key)fail(400,'更正须保持原条款业务编号');
 if(clause.quote!==old.proposed.quote||clause.locator!==old.proposed.locator)fail(409,'原文变更须建立新的来源候选版本');
 const trigger=clause.activated?await evidence(env,access,clause.triggerEvidenceId,clause.triggerLocator):null;
 const assignee=b.assigneeId?Number(b.assigneeId):null;if(assignee&&!Number.isSafeInteger(assignee))fail(400,'责任人成员ID不合法');if(assignee&&!(await resolveProjectAccess(env,assignee,access.row.id))?.permissions.edit)fail(400,'责任人必须为本项目有效编辑成员');
 const obligationId='contract-'+row.id,existing=await env.DB.prepare('SELECT * FROM project_obligations WHERE id=? AND project_id=?').bind(obligationId,access.row.id).first();
 const now=Date.now(),version=Number(row.version)+1,payload={...clause,proposed:clause,source:old.source,trigger,reason:str(b.reason,2000),confirmedBy:actor.userId};
 const status=clause.activated?(assignee?'pending':'unassigned'):'returned',detail={title:clause.title,basis:clause.quote,dueDate:clause.deadline||'',dueBasis:clause.activated?'协议触发证据 '+clause.triggerEvidenceId:'条件未成立/未知/协议未生效或终止，禁止起算',reason:payload.reason,contractClauseId:row.id,contractClauseVersion:version,sourceHash:old.source.hash,conditionStatus:clause.conditionStatus};
 // Only this stable clause's obligation changes; other clauses keep their versions.
 if(clause.activated||existing)await env.DB.prepare('INSERT INTO project_obligations(id,project_id,event_id,obligation_type,round,version,detail_json,status,assignee_id,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,detail_json=excluded.detail_json,status=excluded.status,assignee_id=excluded.assignee_id,updated_at=excluded.updated_at').bind(obligationId,access.row.id,row.contract_id,'contract:'+row.clause_key,Number(existing?.version||0)+1,JSON.stringify(detail),status,assignee,existing?.created_at||now,now).run();
 await env.DB.prepare("UPDATE investment_contract_clauses SET version=?,status='confirmed',payload_json=?,updated_at=? WHERE id=?").bind(version,JSON.stringify(payload),now,row.id).run();
 await env.DB.prepare('INSERT INTO investment_contract_clause_versions(clause_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').bind(row.id,version,JSON.stringify({payload,status:'confirmed',actor:actor.userId}),now).run();
 await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'contract.confirmed',{id:row.id,version,before:old,after:payload,obligationId:clause.activated||existing?obligationId:null});return {ok:true,id:row.id,version,activated:clause.activated,obligationId:clause.activated||existing?obligationId:null};
}
