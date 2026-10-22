// Authenticated human gap confirmation, not AI fact verification or formal sign-off.
// Receipts are signed, source-bound and audited; writable project JSON is never authority.
import {resolveProjectAccess} from './_project-access.js';
import {authorizeResearchTask} from './_research-store.js';
import {loadReportWritingPolicy,loadReportRequirementOverrides,savedReportWritingType} from './_report-writing-policy.js';
import {legacyResearchLifecycle} from './_legacy-research-lifecycle.js';
const G=globalThis.ReportGapRegistry,W=globalThis.ReportGapWorkflow;
const VERSION='report-gap-human-receipt-v1',DOMAIN='anju:report-gap-human-confirmation:v1\n';
const stable=x=>x&&typeof x==='object'?(Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'):JSON.stringify(x);
const parse=x=>typeof x==='string'?JSON.parse(x):x||{};
const text=x=>String(x??'').trim();
const hex=x=>Array.from(new Uint8Array(x),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))));}
async function key(env){if(!env.SESSION_SECRET)throw new Error('缺少服务端审核签名密钥，未关闭任何缺口；请管理员检查环境配置');return crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function sourceView(ctx){return W.sourceSnapshot(ctx,{fullContent:true});}
async function verifiedReceipt(env,receipt,ctx,record,sourceHash){
  if(!receipt||receipt.version!==VERSION||receipt.gapId!==record.id||!/^([a-f0-9]{64})$/.test(receipt.signature||'')||receipt.sourceHash!==sourceHash)return false;
  const {signature,...payload}=receipt,p=receipt.approval;
  if(!p||p.projectKey!==ctx.projectKey||p.sourceRevision!==W.sourceRevision(ctx)||p.requirementRevision!==record.requirementRevision||p.identityKey!==stable(record.identity)||!['satisfied','not-applicable'].includes(p.status))return false;
  const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
  return crypto.subtle.verify('HMAC',await key(env),bytes,new TextEncoder().encode(DOMAIN+stable(payload)));
}
// Always called with context derived from saved state and published requirements.
// No client-supplied trustedApprovals or verifiedEvidence are ever admitted.
export async function loadReportGapApprovals(env,saved,ctx){
  const receipts=saved?.workflow?.reportGapReceipts||{},raw=W.create({...ctx,trustedApprovals:[],verifiedEvidence:[]});
  if(!env.SESSION_SECRET||!raw.registry.valid)return [];
  const sourceHash=await digest(sourceView(ctx)),trusted=[];
  for(const record of raw.registry.records){
    const receipt=receipts[record.id];
    if(await verifiedReceipt(env,receipt,ctx,record,sourceHash))trusted.push(receipt.approval);
  }
  return trusted;
}
async function savedScope(env,userId,input){
  if(input.research){
    if(env.RESEARCH_IDENTITY_ENABLED!=='1')throw new Error('研究功能尚未启用');
    const access=await authorizeResearchTask(env.DB,userId,input.research);
    if(access.study.formal_project_id&&!(await resolveProjectAccess(env,userId,access.study.formal_project_id))?.permissions.view)throw new Error('关联项目权限已失效');
    const state=access.run.state,saved=state?.draft||state?.legacySnapshot||state||{};
    return {saved,projectKey:access.study.id+':'+access.run.runId,lookupId:'',ownerId:access.study.owner_user_id,version:{research:{researchId:access.study.id,runId:access.run.runId,epoch:access.run.epoch,expectedVersion:access.run.version}}};
  }
  const projectId=text(input.projectId);if(!projectId)throw new Error('缺少当前项目');
  await env.DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
  const access=await resolveProjectAccess(env,userId,projectId);
  if(!access?.permissions.edit)throw new Error('当前账号没有项目编辑权限');
  if(!Number.isSafeInteger(input.expectedUpdatedAt)||input.expectedUpdatedAt!==Number(access.row.updated_at))throw new Error('项目已更新，请重新载入后再核实；原台账未修改');
  const saved=parse(access.row.data),lifecycle=legacyResearchLifecycle(saved);
  if(lifecycle.legacyResearchAbandoned||(lifecycle.legacyResearchEpoch>0&&input.legacyResearchEpoch!==lifecycle.legacyResearchEpoch))throw new Error('可研轮次已变化，请重新进入后核实');
  return {saved,projectKey:projectId,lookupId:projectId,ownerId:access.ownerUserId,version:{expectedUpdatedAt:Number(access.row.updated_at)}};
}
export async function reviewReportGaps(env,userId,input){
  if(!env.DB._transaction)throw new Error('资料核实需要事务数据库，当前环境不能安全签发收据');
  if(!['confirmGap','verifyGaps'].includes(input.action))throw new Error('未知资料核实操作');
  return env.DB._transaction(async DB=>{
    const scoped={...env,DB},scope=await savedScope(scoped,userId,input),{saved,projectKey}=scope;
    if(!saved.workflow?.reportGapRegistry)throw new Error('请先保存当前项目的资料缺口台账');
    const projectType=savedReportWritingType(saved),policy=await loadReportWritingPolicy(scoped,saved,projectType,''),overrides=await loadReportRequirementOverrides(scoped,scope.ownerId,scope.lookupId,saved);
    const ctx=W.fromSaved(saved,{projectKey,projectType,logicData:policy.logicData,requirementOverrides:overrides}),sourceRevision=W.sourceRevision(ctx),trustedApprovals=await loadReportGapApprovals(scoped,saved,ctx);
    let derived=W.create({...ctx,trustedApprovals});
    if(!derived.registry.valid)throw new Error('资料台账结构或归属无效，请重新核对');
    if(input.action==='verifyGaps')return {registry:derived.registry,trustedApprovals,sourceRevision,...scope.version};
    if(input.confirmed!==true||input.sourceRevision!==sourceRevision)throw new Error('请明确确认当前资料版本后重试；资料已变化时不能沿用旧核实');
    if(!derived.active)throw new Error('请先应用并保存当前资料台账，再核实具体事项');
    const record=derived.registry.records.find(r=>r.id===input.gapId),status=input.status,reason=text(input.reason);
    if(!record||!['satisfied','not-applicable'].includes(status))throw new Error('请选择有效缺口和核实状态');
    if(reason.length<12||reason.length>2000)throw new Error('请填写12至2000字的核实理由，说明字段、对象和适用范围，不能仅填“已核实”');
    let evidence=null;
    if(status==='satisfied'){
      const e=input.evidence||{},quote=text(e.quote),locator=text(e.locator),materials=(ctx.materials||[]).filter(m=>W.materialId(m)===text(e.materialId));
      if(materials.length!==1||quote.length<8||quote.length>12000||!locator||locator.length>500)throw new Error('已核实须选择唯一原材料、至少8字的逐字引文及页码/段落定位');
      const material=materials[0],content=String(material.content??material.text??material.extractedText??'');
      if(!content.includes(quote))throw new Error('引文与当前已保存材料不符，不能签发核实收据');
      evidence={materialId:text(e.materialId),quote,locator,contentHash:await digest(content),field:record.identity.field,identityKey:stable(record.identity)};
    }
    const approval={kind:'human',confirmed:true,actorId:String(userId),reason,at:new Date().toISOString(),projectKey,sourceRevision,requirementRevision:record.requirementRevision,identityKey:stable(record.identity),status};
    const payload={version:VERSION,gapId:record.id,approval,evidence,sourceHash:await digest(sourceView(ctx))};
    const receipt={...payload,signature:hex(await crypto.subtle.sign('HMAC',await key(scoped),new TextEncoder().encode(DOMAIN+stable(payload))))};
    // Existing append-only event storage: signed payload cannot be forged through
    // generic project events or by writing a status into project JSON.
    await DB.prepare("CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL)").run();
    await DB.prepare('INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').bind('gap-review-'+crypto.randomUUID(),projectKey,scope.ownerId,'report.gap.human-confirmed',String(userId),JSON.stringify({receipt,version:scope.version,formalApproval:false}),Date.now()).run();
    const next=structuredClone(saved);next.workflow.reportGapReceipts={...(next.workflow.reportGapReceipts||{}),[record.id]:receipt};
    const nextRecord=next.workflow.reportGapRegistry.records.find(r=>r.id===record.id);if(!nextRecord)throw new Error('台账已变化，请重新应用后核实');nextRecord.status=status;nextRecord.approval=approval;
    const trusted=await loadReportGapApprovals(scoped,next,ctx);derived=W.create({...W.fromSaved(next,{projectKey,projectType,logicData:policy.logicData,requirementOverrides:overrides}),trustedApprovals:trusted});
    return {approval,receipt,registry:derived.registry,trustedApprovals:trusted,sourceRevision,...scope.version,requiresSave:true,formalApproval:false};
  });
}
