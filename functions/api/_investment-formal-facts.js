// External decision evidence registry. Verification never grants corporate approval.
import {resolveProjectAccess} from './_project-access.js';
import {lifecycleError,lifecycleEvent} from './_lifecycle-integrity.js';
import {reportEvidenceHash as hash} from './_report-trusted-evaluation.js';
import {ensureProjectArtifacts} from './projectartifacts.js';
const fail=(s,m)=>{throw lifecycleError(s,m);};
const str=(v,n=1000)=>{if(typeof v!=='string'||v.length>n)fail(400,'字段类型或长度不合法');return v.trim();};
const parse=v=>JSON.parse(v||'{}');
export const formalFactActions=new Set(['saveFormalFact','verifyFormalFact','grantFactVerifier']);
export const formalFactKinds=['scheduled','held','decision','condition','original','adjustment','extension','pause','started','rule'];
export const formalFactSchema=[
 "CREATE TABLE IF NOT EXISTS investment_fact_verifiers(project_id TEXT NOT NULL,user_id INTEGER NOT NULL,basis TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(project_id,user_id))",
 "CREATE TABLE IF NOT EXISTS investment_formal_facts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,round INTEGER NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,created_by INTEGER NOT NULL,verified_by INTEGER,updated_at BIGINT NOT NULL,UNIQUE(project_id,event_id,kind,round))"
];
export async function ensureFormalFacts(env){await ensureProjectArtifacts(env);for(const sql of formalFactSchema)await env.DB.prepare(sql).run();}
function version(b,row){if(!Number.isSafeInteger(b.expectedVersion))fail(428,'请读取当前版本');if(b.expectedVersion!==Number(row?.version||0))fail(409,'记录已变化，请刷新核对');}
function date(v){v=str(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'日期不合法');return v;}
export function normalizeFormalFact(b){
 const kind=str(b.kind,20);if(!formalFactKinds.includes(kind))fail(400,'事实类型不合法');
 const p={title:str(b.title,500),date:date(b.date),locator:str(b.locator),note:str(b.note||'',4000),reason:str(b.reason)};
 if(!p.title||!p.locator||!p.reason)fail(400,'请填写标题、原件定位和登记/更正原因');
 if(kind==='decision'){if(!['passed','conditional','deferred','rejected'].includes(b.result))fail(400,'请选择明确决议结果');p.result=b.result;p.conditions=(b.conditions||[]);if(!Array.isArray(p.conditions)||p.conditions.length>30)fail(400,'条件列表不合法');p.conditions=p.conditions.map(x=>str(x,500));if(p.conditions.some(x=>!x)||new Set(p.conditions).size!==p.conditions.length||p.result==='conditional'&&!p.conditions.length||p.result!=='conditional'&&p.conditions.length)fail(400,'附条件决议须列明不重复的条件，其他结果不得携带条件');}
 if(kind==='condition'){p.decisionId=str(b.decisionId,100);p.condition=str(b.condition,500);if(!p.decisionId||!p.condition)fail(400,'请关联决议与原条件');}
 if(['original','adjustment'].includes(kind)){
  const amount=str(b.amount,24);if(!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(amount)||!Number(amount))fail(400,'批准金额须为大于0的元金额，最多两位小数');
  p.amount=amount;p.currency=str(b.currency,3);if(!/^[A-Z]{3}$/.test(p.currency))fail(400,'币种须为三位代码');p.amountBasis=str(b.amountBasis,1000);p.decisionId=str(b.decisionId,100);p.plannedStart=b.plannedStart?date(b.plannedStart):'';
  if(!p.amountBasis||!p.decisionId)fail(400,'批准金额必须有口径及关联决议');
  if(kind==='adjustment'){p.originalId=str(b.originalId,100);if(!p.originalId)fail(400,'调整必须关联原批准，不得关联预测');}
  p.scope=str(b.scope||'',500);
 }
 if(['extension','pause'].includes(kind)){
  p.decisionId=str(b.decisionId,100);p.obligationId=str(b.obligationId,100);
  if(!p.decisionId||!p.obligationId)fail(400,'期限变更须关联批准决议和原交接事项');
  if(kind==='extension')p.newDue=date(b.newDue);
  else {p.start=date(b.start);p.end=b.end?date(b.end):'';if(p.end&&p.end<p.start)fail(400,'暂停结束不得早于开始');}
 }
 if(kind==='started'){p.originalId=str(b.originalId,100);if(!p.originalId)fail(400,'实际开工须关联原批准');}
 if(kind==='rule'){
  p.ruleType=str(b.ruleType,30);if(!['deadline','investment','construction'].includes(p.ruleType))fail(400,'规则仅支持交接期限、预计投资偏差、开工延期');
  p.validFrom=date(b.validFrom);p.validUntil=b.validUntil?date(b.validUntil):'';if(p.validUntil&&p.validUntil<p.validFrom)fail(400,'规则效期不合法');
  p.scope=str(b.scope,500);if(!p.scope)fail(400,'须确认规则适用的本项目范围');
  p.operator=b.operator;if(!['gt','gte'].includes(p.operator))fail(400,'请选择严格超过或达到阈值');
  p.timezone='Asia/Shanghai';
  if(p.ruleType==='deadline'){
   p.clockStart=date(b.clockStart);p.stacking=str(b.stacking,40);if(!['no-mix','extension-plus-pauses'].includes(p.stacking))fail(400,'须明确延期与暂停叠加口径');
  }
  if(p.ruleType==='investment'){
   p.thresholdBps=Number(b.thresholdBps);if(b.thresholdBps==null||String(b.thresholdBps).trim()===''||!Number.isSafeInteger(p.thresholdBps)||p.thresholdBps<0||p.thresholdBps>100000)fail(400,'比例阈值须为0至100000的整数基点，20%为2000');
   p.currency=str(b.currency,3);p.amountBasis=str(b.amountBasis,1000);p.scenarioId=str(b.scenarioId,100);p.metricUnit=str(b.metricUnit,10);
   if(!/^[A-Z]{3}$/.test(p.currency)||!p.amountBasis||!p.scenarioId||!['元','万元'].includes(p.metricUnit))fail(400,'须核对采纳情景ID、币种、金额口径和引擎单位');
  }
  if(p.ruleType==='construction'){p.years=Number(b.years);if(!Number.isSafeInteger(p.years)||p.years<1||p.years>100)fail(400,'日历年阈值须为1至100');p.calendar='gregorian-clamp-feb28';}
 }
 return p;
}
async function source(env,projectId,id){const s=await env.DB.prepare('SELECT id,content_hash,storage_key,file_name,size_bytes FROM report_source_artifacts WHERE id=? AND project_id=?').bind(id,projectId).first();if(!s||!Number(s.size_bytes)||!s.content_hash)fail(409,'请先归档本项目非空原件');return s;}
async function canVerify(env,projectId,userId){const a=await resolveProjectAccess(env,userId,projectId);return !!a?.permissions.edit&&!!await env.DB.prepare('SELECT user_id FROM investment_fact_verifiers WHERE project_id=? AND user_id=? AND active=1').bind(projectId,userId).first();}
async function allRows(env,projectId){const rows=(await env.DB.prepare('SELECT * FROM investment_formal_facts WHERE project_id=? ORDER BY updated_at DESC,id LIMIT 5001').bind(projectId).all()).results||[];if(rows.length>5000)fail(413,'事实超过安全读取上限，请分批查询');return rows;}
export async function checkedRows(env,projectId,{physical=false}={}){
 const rows=await allRows(env,projectId),map=new Map(rows.map(r=>[r.id,r])),cache=new Map();
 async function valid(r,chain=new Set()){
  if(!r||r.status!=='verified'||chain.has(r.id))return false;if(cache.has(r.id))return cache.get(r.id);
  const next=new Set(chain).add(r.id),p=parse(r.payload_json);let ok=true;
  try{const s=await source(env,projectId,r.source_id);ok=await hash(s)===r.source_hash;if(ok&&physical){const proof=await env.RAG_OBJECTS?.verify(s.storage_key,s.content_hash);ok=!!proof?.ok&&Number(proof.sizeBytes)===Number(s.size_bytes);}}catch{ok=false;}
  for(const dep of p.dependencies||[]){const parent=map.get(dep.id);if(!parent||Number(parent.version)!==dep.version||!await valid(parent,next))ok=false;}
  cache.set(r.id,ok);return ok;
 }
 const result=[];for(const r of rows)result.push({...r,payload:parse(r.payload_json),currentValid:await valid(r)});return result;
}
export async function readFormalFacts(env,actor,access){
 await ensureFormalFacts(env);const rows=await checkedRows(env,access.row.id);
 const original=rows.find(r=>r.kind==='original'&&r.currentValid)||null;
 const latestAdjustment=rows.filter(r=>r.kind==='adjustment'&&r.payload.originalId===original?.id).sort((a,b)=>b.payload.date.localeCompare(a.payload.date)||Number(b.updated_at)-Number(a.updated_at))[0];
 const adjustment=latestAdjustment?.currentValid?latestAdjustment:null;
 const grants=(await env.DB.prepare('SELECT user_id,active,version,basis FROM investment_fact_verifiers WHERE project_id=?').bind(access.row.id).all()).results||[];
 const meetings=(await env.DB.prepare('SELECT id,title FROM project_meetings WHERE project_id=? ORDER BY updated_at DESC LIMIT 500').bind(access.row.id).all()).results||[];
 const sources=(await env.DB.prepare('SELECT id,file_name FROM report_source_artifacts WHERE project_id=? ORDER BY created_at DESC LIMIT 100').bind(access.row.id).all()).results||[];
 const members=(await env.DB.prepare("SELECT user_id FROM project_memberships WHERE project_id=? AND status='active' AND role IN ('OWNER','EDITOR')").bind(access.row.id).all()).results||[];
 return {items:rows,meetings,sources,members:[...new Set([Number(access.ownerUserId),...members.map(m=>Number(m.user_id))])],approvedBaseline:original,approvedAdjustment:adjustment,canManage:access.permissions.manage,canEdit:access.permissions.edit,canVerify:await canVerify(env,access.row.id,actor.userId),actorId:Number(actor.userId),grants,warning:'外部批准事实登记，不代替企业审批。预测不进入批准基线；更正后及依赖失效时须重新核验。'};
}
export async function mutateFormalFact(env,actor,access,b){
 if(!formalFactActions.has(b.action))fail(400,'未知事实操作');
 const projectId=access.row.id,now=Date.now();let before,after,id;
 if(b.action==='grantFactVerifier'){
  if(!access.permissions.manage)fail(403,'仅负责人可登记核验动作授权');const userId=Number(b.userId),basis=str(b.basis);if(!Number.isSafeInteger(userId)||!basis||typeof b.active!=='boolean')fail(400,'请提供有效人员、授权依据和状态');
  if(b.active&&!(await resolveProjectAccess(env,userId,projectId))?.permissions.edit)fail(400,'核验人必须为当前有效项目编辑成员');
  before=await env.DB.prepare('SELECT * FROM investment_fact_verifiers WHERE project_id=? AND user_id=?').bind(projectId,userId).first();version(b,before);
  await env.DB.prepare('INSERT INTO investment_fact_verifiers(project_id,user_id,basis,active,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET basis=excluded.basis,active=excluded.active,version=excluded.version,updated_at=excluded.updated_at').bind(projectId,userId,basis,b.active?1:0,Number(before?.version||0)+1,now).run();after={userId,basis,active:b.active};id=String(userId);
 }else if(b.action==='saveFormalFact'){
  if(!access.permissions.edit)fail(403,'只读成员不能登记');const eventId=str(b.eventId,100);if(!Number.isSafeInteger(b.round)||b.round<1)fail(400,'轮次不合法');
  if(!await env.DB.prepare('SELECT id FROM project_meetings WHERE id=? AND project_id=?').bind(eventId,projectId).first())fail(404,'请选择本项目原会议事件');
  const payload=normalizeFormalFact(b),s=await source(env,projectId,str(b.sourceId,100));
  before=await env.DB.prepare('SELECT * FROM investment_formal_facts WHERE project_id=? AND event_id=? AND kind=? AND round=?').bind(projectId,eventId,b.kind,b.round).first();version(b,before);if(!before&&b.newRoundConfirmed!==true)fail(400,'新事项或轮次须明确确认');
  id=before?.id||'formal-'+crypto.randomUUID();after={...payload};
  await env.DB.prepare('INSERT INTO investment_formal_facts(id,project_id,event_id,kind,round,version,status,payload_json,source_id,source_hash,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,event_id,kind,round) DO UPDATE SET version=excluded.version,status=excluded.status,payload_json=excluded.payload_json,source_id=excluded.source_id,source_hash=excluded.source_hash,created_by=excluded.created_by,verified_by=NULL,updated_at=excluded.updated_at').bind(id,projectId,eventId,b.kind,b.round,Number(before?.version||0)+1,'pending',JSON.stringify(payload),s.id,await hash(s),actor.userId,now).run();
 }else{
  if(!await canVerify(env,projectId,actor.userId))fail(403,'未获批准事实核验动作授权');
  before=await env.DB.prepare('SELECT * FROM investment_formal_facts WHERE id=? AND project_id=?').bind(str(b.id,100),projectId).first();if(!before)fail(404,'事实不存在');version(b,before);
  if(before.status!=='pending')fail(409,'仅待核验记录可核验');if(Number(before.created_by)===Number(actor.userId))fail(403,'登记或更正人不能自行核验');
  if(b.confirmed!==true||!str(b.reason))fail(400,'须明确确认已核对原件并填写核验意见');
  const originalSource=await source(env,projectId,before.source_id);
  if(await hash(originalSource)!==before.source_hash)fail(409,'原件已变化，请重新登记');
  if(!env.RAG_OBJECTS?.verify)fail(503,'未配置原件完整性校验，不能核验通过');
  let proof;try{proof=await env.RAG_OBJECTS.verify(originalSource.storage_key,originalSource.content_hash);}catch{fail(409,'原件不可读取，请恢复原件后重新核验');}
  if(!proof?.ok||Number(proof.sizeBytes)!==Number(originalSource.size_bytes))fail(409,'原件内容或大小校验失败，不能核验通过');
  const p=parse(before.payload_json),rows=await checkedRows(env,projectId),dependencies=[];
  const dep=(id,kind)=>{const x=rows.find(r=>r.id===id&&r.kind===kind&&r.currentValid);if(!x)fail(409,'前置事实未核验或已失效');dependencies.push({id:x.id,version:Number(x.version)});return x;};
  if(before.kind!=='scheduled'&&p.date>new Date().toISOString().slice(0,10))fail(409,'实际事实日期不能在未来');
  if(before.kind==='decision') {const held=rows.find(r=>r.event_id===before.event_id&&Number(r.round)===Number(before.round)&&r.kind==='held'&&r.currentValid);if(!held)fail(409,'请先核验同轮实际召开事实，排期不能代替召开');if(p.date<held.payload.date)fail(409,'决议日期不能早于召开日期');dep(held.id,'held');}
  if(before.kind==='condition'){const decision=dep(p.decisionId,'decision');if(!decision.payload.conditions?.includes(p.condition)||decision.event_id!==before.event_id||p.date<decision.payload.date)fail(409,'条件不属于此决议或落实日期早于决议');}
  if(['original','adjustment'].includes(before.kind)){
   const decision=dep(p.decisionId,'decision');if(decision.event_id!==before.event_id||p.date<decision.payload.date||!['passed','conditional'].includes(decision.payload.result))fail(409,'批准日期、决议结果或所属会议不符合要求');
   for(const c of decision.payload.conditions||[]){const fulfilled=rows.find(r=>r.kind==='condition'&&r.payload.decisionId===decision.id&&r.payload.condition===c&&r.currentValid);if(!fulfilled)fail(409,'附带条件尚未全部核验落实');dep(fulfilled.id,'condition');}
   if(before.kind==='original'&&rows.some(r=>r.kind==='original'&&r.id!==before.id&&r.status==='verified'))fail(409,'原批准已存在，请更正原记录或登记调整');
   if(before.kind==='adjustment'){const original=dep(p.originalId,'original');if(original.payload.currency!==p.currency||original.payload.amountBasis!==p.amountBasis||p.date<original.payload.date)fail(409,'调整批准须保持币种及金额口径一致，日期不得早于原批准');}
  }
  if(['extension','pause'].includes(before.kind)){
   const decision=dep(p.decisionId,'decision');
   if(decision.event_id!==before.event_id||p.date<decision.payload.date||decision.payload.result!=='passed')fail(409,'期限变更须有同会议已通过决议，附条件事项请先确认条件落实后的批准');
   const target=await env.DB.prepare('SELECT * FROM project_obligations WHERE id=? AND project_id=?').bind(p.obligationId,projectId).first();
   if(!target)fail(409,'原交接事项不存在');const detail=parse(target.detail_json);
   if(!detail.dueDate||!detail.dueBasis||!detail.formalFactId)fail(409,'原事项缺少有依据的期限或正式决议');dep(detail.formalFactId,'decision');
   p.targetHash=await obligationTimingHash(target);p.targetEventId=target.event_id;p.targetRound=Number(target.round);
   if(before.kind==='extension'&&p.newDue<detail.dueDate)fail(409,'延期不得提前原截止日');
  }
  if(before.kind==='started'){const original=dep(p.originalId,'original');if(p.date<original.payload.date)fail(409,'实际开工早于原批准，请核对事实');}
  if(before.kind==='rule'&&rows.some(r=>r.id!==before.id&&r.kind==='rule'&&r.status==='verified'&&r.payload.ruleType===p.ruleType&&(!p.validUntil||r.payload.validFrom<=p.validUntil)&&(!r.payload.validUntil||p.validFrom<=r.payload.validUntil)))fail(409,'同类规则有效期重叠，请更正原规则，不能并行发布冲突规则');
  id=before.id;after={...p,dependencies,verificationNote:b.reason,verifiedAt:now};
  await env.DB.prepare("UPDATE investment_formal_facts SET status='verified',payload_json=?,verified_by=?,version=?,updated_at=? WHERE id=? AND project_id=?").bind(JSON.stringify(after),actor.userId,Number(before.version)+1,now,id,projectId).run();
 }
 await lifecycleEvent(env,actor,access.ownerUserId,projectId,'formal.'+b.action,{id,before,after});return {ok:true,id};
}
export async function obligationTimingHash(row){const d=parse(row.detail_json);return hash({eventId:row.event_id,round:Number(row.round),type:row.obligation_type,dueDate:d.dueDate,dueBasis:d.dueBasis,formalFactId:d.formalFactId,formalFactVersion:d.formalFactVersion});}
