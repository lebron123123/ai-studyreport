import {ensureInvestmentMonitor,evaluateInvestmentChecks,investmentBusinessDate} from './_investment-monitor.js';
import {withProjectMutation,lifecycleError,lifecycleEvent} from './_lifecycle-integrity.js';
import {verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {investmentRiskPeriod} from './_investment-risk-period.mjs';
import {calendarDate} from './_investment-rule-engine.mjs';
const parse=s=>JSON.parse(s||'{}'),interval=15*60000,lease=5*60000;
const fail=(s,m)=>{throw lifecycleError(s,m);};
export const watchActions=new Set(['watchConfigure','watchRiskAction']);
export async function ensureInvestmentWatch(env){
 await ensureInvestmentMonitor(env);
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS investment_watch(project_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,next_at BIGINT NOT NULL,watermark BIGINT NOT NULL DEFAULT 0,complete_at BIGINT NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT \'\',lease_until BIGINT NOT NULL DEFAULT 0,last_json TEXT NOT NULL DEFAULT \'{}\')',
  'CREATE TABLE IF NOT EXISTS investment_watch_risks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,rule_key TEXT NOT NULL,round INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT \'open\',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,detail_json TEXT NOT NULL,UNIQUE(project_id,rule_key))',
  'CREATE TABLE IF NOT EXISTS investment_watch_notices(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,risk_id TEXT NOT NULL,recipient_id INTEGER NOT NULL,window_key TEXT NOT NULL,created_at BIGINT NOT NULL,UNIQUE(risk_id,recipient_id,window_key))'
 ])await env.DB.prepare(sql).run();
}
async function proof(env,access,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(x=>typeof x!=='string'||!x.trim()))fail(409,'请关联1至20条非空、已确认且有效的项目证据');
 const out=[];for(const id of [...new Set(ids)])out.push({id,hash:await reportEvidenceHash(await verifyInvestmentEvidence(env,access,id))});return out;
}
async function independent(env,actor,access,submitter){
 if(Number(submitter)===Number(actor.userId))fail(403,'提交人与复核人必须不同');
 if(!access.permissions.edit||!await env.DB.prepare('SELECT user_id FROM investment_fact_verifiers WHERE project_id=? AND user_id=? AND active=1').bind(access.row.id,actor.userId).first())fail(403,'需要当前有效的独立核验授权');
}
export async function mutateInvestmentWatch(env,actor,access,b){
 const now=Date.now(),pid=access.row.id;
 if(b.action==='watchConfigure'){
  if(!access.permissions.manage)fail(403,'仅负责人可启停持续检查');
  if(typeof b.enabled!=='boolean'||b.confirmed!==true)fail(400,'请明确确认持续检查设置');
  const row=await env.DB.prepare('SELECT * FROM investment_watch WHERE project_id=?').bind(pid).first();
  if(Number(b.expectedVersion)!==Number(row?.version||0))fail(409,'设置已变化，请刷新');
  await env.DB.prepare("INSERT INTO investment_watch(project_id,enabled,version,next_at) VALUES(?,?,1,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,version=investment_watch.version+1,next_at=excluded.next_at,lease_token='',lease_until=0").bind(pid,b.enabled?1:0,now).run();
  await lifecycleEvent(env,actor,access.ownerUserId,pid,'watch.configure',{enabled:b.enabled});return {ok:true};
 }
 const row=await env.DB.prepare('SELECT * FROM investment_watch_risks WHERE id=? AND project_id=?').bind(b.id,pid).first();
 if(!row)fail(404,'风险不存在');if(Number(b.expectedVersion)!==Number(row.version))fail(409,'风险已更新，请刷新后重新核对');
 const d=parse(row.detail_json),reason=String(b.reason||'').trim();if(!reason||reason.length>2000)fail(400,'请填写不超过2000字的处置说明');
 let state=row.state;
 if(b.operation==='claim'){if(state==='closed')fail(409,'已关闭事项需先重开');if(d.assignee&&Number(d.assignee)!==Number(actor.userId))fail(409,'已有责任人，不可覆盖认领');d.assignee=actor.userId;}
 else if(b.operation==='submit'){
  if(state==='closed')fail(409,'已关闭事项需先重开');
  d.proofs=await proof(env,access,b.evidenceIds);d.submitter=actor.userId;d.submission='close';state='review';
 }else if(b.operation==='exception'){
  if(state==='closed')fail(409,'已关闭事项需先重开');
  calendarDate(b.until);if(b.until<=investmentBusinessDate(now))fail(400,'例外截止必须晚于今天');
  d.proofs=await proof(env,access,b.evidenceIds);d.submitter=actor.userId;d.submission='exception';d.until=b.until;state='review';
 }else if(b.operation==='approve'){
  if(state!=='review')fail(409,'仅待复核事项可批准');await independent(env,actor,access,d.submitter);
  const current=await proof(env,access,(d.proofs||[]).map(x=>x.id));if(JSON.stringify(current)!==JSON.stringify(d.proofs))fail(409,'证据已变化，请重新提交');
  if(d.submission==='exception'&&d.until<=investmentBusinessDate(now))fail(409,'例外期限已经到期');
  state=d.submission==='exception'?'exception':'closed';d.reviewer=actor.userId;d.reviewedAt=now;
  // A continuing condition does not immediately reopen an explicitly reviewed event.
  d.closedFingerprint=d.fingerprint;d.clearedAfterClose=false;
 }else if(b.operation==='return'){
  if(state!=='review')fail(409,'事项不在待复核');await independent(env,actor,access,d.submitter);state='open';
 }else if(b.operation==='reopen'){if(!['closed','exception'].includes(state))fail(409,'只有已关闭或例外事项需要重开');state='open';d.reopenedAt=now;}
 else fail(400,'无效的风险动作');
 d.lastReason=reason;
 await env.DB.prepare('UPDATE investment_watch_risks SET state=?,version=version+1,round=round+?,detail_json=?,updated_at=? WHERE id=?').bind(state,b.operation==='reopen'?1:0,JSON.stringify(d),now,row.id).run();
 await env.DB.prepare('UPDATE project_risks SET status=?,updated_at=? WHERE id=? AND project_id=?').bind(state==='closed'?'closed':'open',now,row.id,pid).run();
 await lifecycleEvent(env,actor,access.ownerUserId,pid,'watch.risk.'+b.operation,{id:row.id,previous:row.state,state,reason,proofs:d.proofs||[],round:Number(row.round)});return {ok:true};
}
export async function claimInvestmentWatch(env,now=Date.now()){
 return env.DB._transaction(async DB=>{
  const row=await DB.prepare('SELECT w.* FROM investment_watch w JOIN projects p ON p.id=w.project_id WHERE w.enabled=1 AND w.next_at<=? AND w.lease_until<=? ORDER BY w.next_at,w.project_id FOR UPDATE OF w SKIP LOCKED LIMIT 1').bind(now,now).first();
  if(!row)return null;const token=crypto.randomUUID();await DB.prepare('UPDATE investment_watch SET lease_token=?,lease_until=? WHERE project_id=?').bind(token,now+lease,row.project_id).run();return {...row,token};
 });
}
async function synchronize(env,actor,access,result,now){
 const pid=access.row.id;
 for(const r of result.results){
  const old=await env.DB.prepare('SELECT * FROM investment_watch_risks WHERE project_id=? AND rule_key=?').bind(pid,r.key).first();
  const alarming=['unknown','overdue','triggered','late'].includes(r.status),level=r.status==='unknown'?'unknown':r.status==='triggered'?'high':'medium';
  if(!old&&!alarming)continue;
  const d=old?parse(old.detail_json):{},fingerprint=await reportEvidenceHash({result:r,sourceVersions:result.sourceVersions});
  let state=old?.state||'open',round=Number(old?.round||1),reopen=false;
  if(state==='exception'&&d.until<=investmentBusinessDate(now)){state='open';reopen=true;}
  if(state==='exception')try{if(JSON.stringify(await proof(env,access,(d.proofs||[]).map(x=>x.id)))!==JSON.stringify(d.proofs)){state='open';reopen=true;}}catch{state='open';reopen=true;}
  if(state==='closed'){
   let invalid=false;try{const p=await proof(env,access,(d.proofs||[]).map(x=>x.id));invalid=JSON.stringify(p)!==JSON.stringify(d.proofs);}catch{invalid=true;}
   if(invalid||alarming&&(d.clearedAfterClose||d.closedFingerprint!==fingerprint)){state='open';reopen=true;}
   else if(!alarming)d.clearedAfterClose=true;
  }
  if(reopen){round++;d.reopenedAt=now;}
  if(alarming){if(old&&({unknown:0,medium:1,high:2}[level]>({unknown:0,medium:1,high:2}[d.level]??0)))d.escalatedDate=investmentBusinessDate(now);d.level=level;}
  Object.assign(d,{title:r.title,latest:r,fingerprint,lastCheckedAt:now,dueDate:r.effectiveDue||r.thresholdDate||d.dueDate||''});
  const id=old?.id||'watch-'+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO investment_watch_risks(id,project_id,rule_key,round,version,state,created_at,updated_at,detail_json) VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET round=excluded.round,version=investment_watch_risks.version+1,state=excluded.state,updated_at=excluded.updated_at,detail_json=excluded.detail_json').bind(id,pid,r.key,round,state,old?.created_at||now,now,JSON.stringify(d)).run();
  await env.DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,risk_level,owner,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,'',?,?,?,?) ON CONFLICT(id) DO UPDATE SET risk_level=excluded.risk_level,status=excluded.status,updated_at=excluded.updated_at").bind(id,pid,access.ownerUserId,r.title,d.level,'investment-check:'+r.key,state==='closed'?'closed':'open',old?.created_at||now,now).run();
  if(!old||reopen||parse(old.detail_json).fingerprint!==fingerprint)await lifecycleEvent(env,actor,access.ownerUserId,pid,'watch.risk.evaluated',{id,round,state,result:r});
  // Stored in-project inbox, no external delivery. Read always reauthorizes access.
  if(state!=='closed')for(const recipient of [...new Set([Number(access.ownerUserId),Number(d.assignee)].filter(Boolean))]){
   if(recipient!==Number(access.ownerUserId)&&!await env.DB.prepare("SELECT user_id FROM project_memberships WHERE project_id=? AND user_id=? AND status='active'").bind(pid,recipient).first())continue;
   await env.DB.prepare('INSERT INTO investment_watch_notices(id,project_id,risk_id,recipient_id,window_key,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(risk_id,recipient_id,window_key) DO NOTHING').bind(crypto.randomUUID(),pid,id,recipient,round+':'+d.level+':'+investmentBusinessDate(now),now).run();
  }
 }
}
export async function executeInvestmentWatch(env,job,services={}){
 const owner=await env.DB.prepare('SELECT user_id FROM projects WHERE id=?').bind(job.project_id).first();if(!owner)return;
 const actor={userId:Number(owner.user_id),username:'系统持续检查'};
 try{return await withProjectMutation(env,actor,job.project_id,'manage',async(tx,access)=>{
  const locked=await tx.DB.prepare('SELECT * FROM investment_watch WHERE project_id=? FOR UPDATE').bind(job.project_id).first();
  if(!locked?.enabled||locked.lease_token!==job.token||Number(locked.lease_until)<=Date.now())fail(409,'检查租约已失效');
  const now=Date.now(),result=await evaluateInvestmentChecks(tx,access,{...services,now});
  result.failed=0;result.scope=result.results.map(x=>x.key);
  result.notice='后台补查当前状态；窗口为上次水位至本次时点，不伪造停机期间的历史快照。';result.window={from:Number(locked.watermark)||Number(locked.next_at),to:now};
  await synchronize(tx,actor,access,result,now);
  if(Number(locked.lease_until)<=Date.now())fail(409,'检查超过租约，迟到结果不写入');
  const id='watch-check-'+crypto.randomUUID();
  await tx.DB.prepare('INSERT INTO investment_check_runs(id,project_id,request_id,checked_at,actor_id,result_json) VALUES(?,?,?,?,?,?)').bind(id,job.project_id,'watch-'+job.token,now,actor.userId,JSON.stringify(result)).run();
  await tx.DB.prepare("UPDATE investment_watch SET watermark=?,complete_at=?,next_at=?,lease_token='',lease_until=0,last_json=? WHERE project_id=?").bind(now,result.status==='complete'?now:Number(locked.complete_at),now+interval,JSON.stringify(result),job.project_id).run();return result;
 });}catch(error){
  await env.DB._transaction(async DB=>{
   const current=await DB.prepare('SELECT lease_token FROM investment_watch WHERE project_id=? FOR UPDATE').bind(job.project_id).first();
   if(current?.lease_token!==job.token)return;
   const now=Date.now(),failure={status:'failed',expected:null,checked:0,unknown:null,failed:1,results:[],notice:'检查失败，旧风险保留，覆盖未知；后台将在一分钟后重试。'};
   await DB.prepare('INSERT INTO investment_check_runs(id,project_id,request_id,checked_at,actor_id,result_json) VALUES(?,?,?,?,?,?)').bind('watch-failed-'+crypto.randomUUID(),job.project_id,'watch-failed-'+job.token,now,actor.userId,JSON.stringify(failure)).run();
   await DB.prepare("UPDATE investment_watch SET next_at=?,lease_token='',lease_until=0,last_json=? WHERE project_id=?").bind(now+60000,JSON.stringify(failure),job.project_id).run();
  });
  throw error;
 }
}
export async function readInvestmentWatch(env,actor,access,period='week',all=false){
 const pid=access.row.id,now=Date.now(),schedule=await env.DB.prepare('SELECT * FROM investment_watch WHERE project_id=?').bind(pid).first();
 const rows=(await env.DB.prepare('SELECT * FROM investment_watch_risks WHERE project_id=? ORDER BY created_at DESC,id').bind(pid).all()).results||[];
 const risks=[];
 for(const row of rows){
  const d=parse(row.detail_json);let closureVerified=false;
  if(row.state==='closed')try{closureVerified=JSON.stringify(await proof(env,access,(d.proofs||[]).map(x=>x.id)))===JSON.stringify(d.proofs);}catch{}
  risks.push({...d,id:row.id,projectId:pid,version:Number(row.version),round:Number(row.round),status:row.state,createdDate:investmentBusinessDate(Number(row.created_at)),closureVerified,closureInvalid:row.state==='closed'&&!closureVerified});
 }
 // Historical risks remain visible, but a legacy closed flag is not independent review.
 const legacy=(await env.DB.prepare("SELECT * FROM project_risks WHERE project_id=? AND source_ref NOT LIKE 'investment-check:%'").bind(pid).all()).results||[];
 for(const row of legacy)risks.push({id:row.id,projectId:pid,title:row.title,level:row.risk_level,status:row.status,legacy:true,closureVerified:false,createdDate:Number(row.created_at)>0?investmentBusinessDate(Number(row.created_at)):'',latest:{reason:'历史风险，沿用原台账处置；旧关闭标记不自动视为完成独立复核。'}});
 const last=parse(schedule?.last_json),fresh=!!schedule?.enabled&&now-Number(schedule.watermark)<=2*interval&&last.status==='complete';
 const view=investmentRiskPeriod({asOf:investmentBusinessDate(now),period,risks,coverage:[{status:fresh?'complete':'unknown',checkedAt:Number(schedule?.watermark||0),now,maxAgeMs:2*interval}]});
 if(all){view.items=risks.map(r=>({...r,unresolved:!(r.status==='closed'&&r.closureVerified)}));view.totals={unique:risks.length,unresolved:view.items.filter(r=>r.unresolved).length};}
 const notices=(await env.DB.prepare('SELECT id,risk_id,created_at FROM investment_watch_notices WHERE project_id=? AND recipient_id=? ORDER BY created_at DESC LIMIT 100').bind(pid,actor.userId).all()).results||[];
 const canReview=access.permissions.edit&&!!await env.DB.prepare('SELECT user_id FROM investment_fact_verifiers WHERE project_id=? AND user_id=? AND active=1').bind(pid,actor.userId).first();
 const evidence=[];
 for(const table of ['project_facts','project_artifacts']){
  const candidates=(await env.DB.prepare('SELECT id FROM '+table+' WHERE project_id=? AND user_id=?').bind(pid,access.ownerUserId).all()).results||[];
  for(const x of candidates)try{const value=await verifyInvestmentEvidence(env,access,x.id);evidence.push({id:x.id,label:String(value.title||value.fact_key||value.artifact_type||x.id)});}catch{}
 }
 const history=(await env.DB.prepare("SELECT event_type,actor,payload_json,created_at FROM project_events WHERE project_id=? AND event_type LIKE 'watch.%' ORDER BY created_at DESC LIMIT 200").bind(pid).all()).results||[];
 return {ok:true,view,notices,evidence,history:history.map(x=>({...x,payload:parse(x.payload_json),payload_json:undefined})),schedule:{enabled:!!schedule?.enabled,version:Number(schedule?.version||0),watermark:Number(schedule?.watermark||0),completeAt:Number(schedule?.complete_at||0),nextAt:Number(schedule?.next_at||0),last,fresh,intervalMinutes:15},canManage:access.permissions.manage,canEdit:access.permissions.edit,canReview,actorId:Number(actor.userId)};
}
