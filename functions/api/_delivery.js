import {resolveProjectAccess} from './_project-access.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {scoreReportQuality,validateQualityContract} from './_report-quality.js';
import {parseJson} from './_report-orchestration.js';
import {deliverySnapshot,deliverySchema,restoreDeliveryDraft,deliveryVisibleText} from './_delivery-snapshot.js';
import {riskSource,riskDeliverySource,riskDeliveryQuality} from './_risk-delivery-source.js';
export {deliverySnapshot} from './_delivery-snapshot.js';
export async function ensureDelivery(env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS report_deliveries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,author_id INTEGER NOT NULL,reviewer_id INTEGER NOT NULL,content_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,contract_json TEXT NOT NULL,result_json TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,reviewed_at BIGINT NOT NULL DEFAULT 0)").run();
}
export function deliveryText(snapshot){const visible=s=>String(s).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ');return snapshot.chapters.map(c=>'# '+c.name+'\n'+c.sections.map(s=>'## '+s.title+'\n'+visible(s.content)).join('\n')).join('\n');}
export function assertExpectedDeliveryHash(expected,actual){
  if(expected!==undefined&&(!/^[a-f0-9]{64}$/.test(String(expected))||expected!==actual))throw new Error('后台已保存的正文或测算已变化，请重新读取版本后再冻结');
}
export async function verifyDeliverySnapshot(row){
  const snapshot=parseJson(row.snapshot_json,null);
  if(!snapshot||!Array.isArray(snapshot.chapters)||!snapshot.chapters.length||snapshot.chapters.some(c=>!Array.isArray(c.sections)||!c.sections.length||c.sections.some(s=>typeof s.content!=='string'||!s.content.trim())))throw new Error('冻结正文不完整，不能确认通过');
  const schema=deliverySchema(snapshot);if(schema>=3&&snapshot.chapters.some(c=>c.sections.some(s=>!deliveryVisibleText(s.content))))throw new Error('冻结正文缺少可见内容');
  if(await reportEvidenceHash(snapshot)!==row.content_hash)throw new Error('冻结内容校验不一致，不能确认通过');
  return snapshot;
}
export async function verifyFrozenDelivery(row,currentHash){
  const snapshot=await verifyDeliverySnapshot(row);
  if(currentHash!==row.content_hash)throw new Error('正文或测算已变化，请先冻结新版本');
  const result=deliveryQuality(snapshot,parseJson(row.contract_json,{}));
  if(!result.passed)throw new Error('冻结版本重新检查未通过，请核对检查依据后重新冻结');
  return result;
}
function deliveryQuality(snapshot,contract){return riskSource(snapshot)?riskDeliveryQuality(snapshot):scoreReportQuality({...validateQualityContract(contract),noPending:true},deliveryText(snapshot));}
async function deliveryCurrent(env,userId,access,data,snapshot){
 if(riskSource(snapshot)){const source=await riskDeliverySource(env,userId,access,riskSource(snapshot));return source.current?source.hash:'';}
 return reportEvidenceHash(deliverySnapshot(data,deliverySchema(snapshot)));
}
export async function deliveryAction(env,userId,b){
  await ensureDelivery(env);if(!env.DB._transaction)throw new Error('正式验收需要事务数据库');
  return env.DB._transaction(async DB=>{
    const scoped={...env,DB},projectId=String(b.projectId||'');
    await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
    const access=await resolveProjectAccess(scoped,userId,projectId);if(!access?.permissions.view)throw new Error('无项目权限');
    const data=parseJson(access.row.data,{});let snapshot=deliverySnapshot(data),hash=await reportEvidenceHash(snapshot);
    if(b.action==='freeze'){
      if(!access.permissions.manage)throw new Error('仅项目所有者可指定正式复核人');
      if(!b.riskReportId&&riskSource(snapshot))throw new Error('风险报告必须从服务端风险草稿送审，不能使用工作稿中的风险标记');
      if(b.riskReportId){const source=await riskDeliverySource(scoped,userId,access,String(b.riskReportId),{requireCurrent:true});snapshot=source.snapshot;hash=source.hash;}
      assertExpectedDeliveryHash(b.expectedContentHash,hash);
      const reviewerId=Number(b.reviewerId),reviewer=await resolveProjectAccess(scoped,reviewerId,projectId);
      if(!reviewer?.permissions.view||reviewerId===userId)throw new Error('请选择另一位有效项目成员作为复核人，不能自审');
      if(reviewer.role!=='VIEWER')throw new Error('独立复核人必须为只读成员，不能同时具有本项目编制权限');
      const history=(await DB.prepare("SELECT payload_json FROM project_events WHERE project_id=? AND event_type='project.member.updated'").bind(projectId).all()).results||[];
      if(history.some(r=>{const p=parseJson(r.payload_json,{});return Number(p.userId)===reviewerId&&['OWNER','EDITOR'].includes(p.role);}))throw new Error('该成员曾具有本项目编制权限，请指定另一位独立复核人');
      const contract=riskSource(snapshot)?{kind:'immutable-risk-snapshot-v1'}:{...validateQualityContract(b.contract||{}),noPending:true},text=deliveryText(snapshot);
      if(!snapshot.chapters.length||snapshot.chapters.some(c=>!c.sections.length||c.sections.some(s=>!deliveryVisibleText(s.content))))throw new Error('存在空章节或不可见正文，不能冻结正式验收稿');
      const result=deliveryQuality(snapshot,contract),id='delivery_'+await reportEvidenceHash([projectId,hash,userId,reviewerId,contract]);
      await DB.prepare("INSERT INTO report_deliveries(id,project_id,author_id,reviewer_id,content_hash,snapshot_json,contract_json,result_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING").bind(id,projectId,userId,reviewerId,hash,JSON.stringify(snapshot),JSON.stringify(contract),JSON.stringify(result),Date.now()).run();
      return {id,contentHash:hash,result};
    }
    const row=await DB.prepare('SELECT * FROM report_deliveries WHERE id=? AND project_id=? FOR UPDATE').bind(String(b.id||''),projectId).first();if(!row)throw new Error('验收版本不存在');
    if(b.action==='restoreWorkingDraft'){
      if(riskSource(parseJson(row.snapshot_json,{})))throw new Error('风险报告不能覆盖可研工作稿');
      if(!access.permissions.manage)throw new Error('仅项目所有者可恢复历史工作稿');
      if(b.confirmRestore!==true)throw new Error('恢复历史版本需要明确确认，不会自动恢复');
      if(b.expectedContentHash===undefined)throw new Error('请重新读取后台版本后再恢复');
      assertExpectedDeliveryHash(b.expectedContentHash,hash);
      if(!Number.isSafeInteger(b.expectedUpdatedAt)||b.expectedUpdatedAt!==Number(access.row.updated_at))throw new Error('项目已更新，请重新读取后台版本后再恢复；未覆盖任何工作稿');
      const frozen=await verifyDeliverySnapshot(row),restored=restoreDeliveryDraft(data,frozen,row.id,row.content_hash),now=Math.max(Date.now(),Number(access.row.updated_at)+1);
      restored.ts=now;
      // Keep the complete previous working data, without truncation, in the same transaction.
      await DB.prepare('INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').bind('delivery_restore_'+crypto.randomUUID(),projectId,access.ownerUserId,'report.delivery.restored',String(userId),JSON.stringify({deliveryId:row.id,contentHash:row.content_hash,previousUpdatedAt:Number(access.row.updated_at),previousData:data,documentRevision:restored.documentRevision,formalApproval:false}),now).run();
      const saved=await DB.prepare('UPDATE projects SET data=?,updated_at=? WHERE id=? AND updated_at=?').bind(JSON.stringify(restored),now,projectId,access.row.updated_at).run();
      if(saved.meta?.changes!==1)throw new Error('项目已更新；未覆盖任何工作稿，请重新读取');
      return {id:row.id,status:'draft',workingDraft:true,updatedAt:now,documentRevision:restored.documentRevision,contentHash:await reportEvidenceHash(deliverySnapshot(restored)),requiresReload:true,requiresReview:true,restorationScope:'report_body_and_references_only',calculationsRestored:false,projectFactsRestored:false,versionConsistency:'requires_manual_reconciliation'};
    }
    if(b.action!=='approve'&&b.action!=='reject')throw new Error('未知验收操作');
    if(Number(row.reviewer_id)!==userId||Number(row.author_id)===userId||access.role!=='VIEWER')throw new Error('仅指定的独立只读复核人可操作');
    const authored=(await DB.prepare("SELECT payload_json FROM project_events WHERE project_id=? AND event_type='project.member.updated'").bind(projectId).all()).results||[];
    if(authored.some(r=>{const p=parseJson(r.payload_json,{});return Number(p.userId)===userId&&['OWNER','EDITOR'].includes(p.role);}))throw new Error('复核人曾取得编制权限，请重新指定独立复核人');
    if(row.status!=='pending')throw new Error('此版本已有不可覆盖的复核结论');
    if(!String(b.note||'').trim())throw new Error('请填写复核依据');
    if(b.action==='approve'){
      const schema=deliverySchema(parseJson(row.snapshot_json,{}));
      if(schema<3)throw new Error('旧冻结格式未包含完整项目身份，请重新冻结后复核');
      await verifyFrozenDelivery(row,await deliveryCurrent(scoped,userId,access,data,parseJson(row.snapshot_json,{})));
      if(b.wordLayoutReviewed!==true||b.factsReviewed!==true)throw new Error('需检查通过，并由复核人确认Word版式和事实数值');
    }
    await DB.prepare('UPDATE report_deliveries SET status=?,note=?,reviewed_at=? WHERE id=?').bind(b.action==='approve'?'approved':'rejected',JSON.stringify({note:String(b.note).slice(0,2000),wordLayoutReviewed:b.wordLayoutReviewed===true,factsReviewed:b.factsReviewed===true}),Date.now(),row.id).run();
    return {id:row.id,status:b.action==='approve'?'approved':'rejected'};
  });
}
export async function listDeliveries(env,userId,projectId,id='',riskReportId=''){
  const access=await resolveProjectAccess(env,userId,projectId);if(!access?.permissions.view)throw new Error('无项目权限');await ensureDelivery(env);
  const data=parseJson(access.row.data,{}),hash=await reportEvidenceHash(deliverySnapshot(data)),legacyHash=await reportEvidenceHash(deliverySnapshot(data,1));
  if(id){const row=await env.DB.prepare('SELECT * FROM report_deliveries WHERE id=? AND project_id=?').bind(id,projectId).first();if(!row)throw new Error('验收版本不存在');const snapshot=await verifyDeliverySnapshot(row),schema=deliverySchema(snapshot),review=parseJson(row.note,{}),result=deliveryQuality(snapshot,parseJson(row.contract_json,{}));return {id:row.id,status:row.status,contentHash:row.content_hash,createdAt:Number(row.created_at),approval:{authorId:row.author_id,reviewerId:row.reviewer_id,reviewedAt:row.reviewed_at,...review},formalExportAllowed:result.passed&&schema>=3&&row.status==='approved'&&Number(row.author_id)!==Number(row.reviewer_id)&&review.factsReviewed===true&&review.wordLayoutReviewed===true,current:row.content_hash===await deliveryCurrent(env,userId,access,data,snapshot),snapshot,integrity:{verified:true,schemaVersion:schema,referenceStatus:schema===1?'unknown':'recorded_unverified'},contract:parseJson(row.contract_json,{}),result};}
  const riskContract=JSON.stringify({kind:'immutable-risk-snapshot-v1'});
  const riskPattern='%'+('"reportId":'+JSON.stringify(riskReportId)).replace(/[!%_]/g,c=>'!'+c)+'%';
  const query=riskReportId?env.DB.prepare("SELECT * FROM report_deliveries WHERE project_id=? AND contract_json=? AND snapshot_json LIKE ? ESCAPE '!' ORDER BY created_at DESC LIMIT 50").bind(projectId,riskContract,riskPattern):env.DB.prepare('SELECT * FROM report_deliveries WHERE project_id=? AND contract_json<>? ORDER BY created_at DESC LIMIT 50').bind(projectId,riskContract);
  const rows=(await query.all()).results||[];
  const versions=await Promise.all(rows.map(async r=>{
    const {snapshot_json,contract_json,result_json,...metadata}=r;
    const source=riskSource(parseJson(snapshot_json,{}));if(riskReportId?source!==riskReportId:!!source)return null;
    try{const snapshot=await verifyDeliverySnapshot(r),schema=deliverySchema(snapshot);
      return {...metadata,schemaVersion:schema,current:r.content_hash===await deliveryCurrent(env,userId,access,data,snapshot),referenceStatus:schema===1?'unknown':'recorded_unverified',result:deliveryQuality(snapshot,parseJson(contract_json,{}))};
    }catch(error){return {...metadata,current:false,result:{passed:false,score:null,coverageComplete:false,error:error.message}};}
  }));
  return {role:access.role,userId,currentHash:hash,updatedAt:Number(access.row.updated_at),versions:versions.filter(Boolean)};
}
