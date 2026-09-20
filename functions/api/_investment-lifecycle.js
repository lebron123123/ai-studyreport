import '../../investment-lifecycle.js';
import {readFormalFacts} from './_investment-formal-facts.js';
import {lifecycleError,lifecycleEvent,assertProjectObject} from './_lifecycle-integrity.js';
import {resolveProjectAccess} from './_project-access.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {deliverySnapshot} from './_delivery.js';

const L=globalThis.InvestmentLifecycle;
const parse=(v,f={})=>{try{return typeof v==='string'?JSON.parse(v):v??f;}catch{return f;}};
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const fail=(status,message)=>{throw lifecycleError(status,message);};
const uid=p=>p+'-'+crypto.randomUUID();
const hash=reportEvidenceHash;
const requestKey=b=>{if(!/^[A-Za-z0-9_-]{8,100}$/.test(b.requestKey||''))fail(400,'请提供有效的幂等请求标识');return b.requestKey;};
export const INVESTMENT_LIFECYCLE_ACTIONS=new Set(['freezeForecast','previewChange','requestInvestmentApproval','recordActual']);
// Same additive definitions as migration 0025. Runtime initialization supports existing local installs.
export async function ensureInvestmentLifecycle(env){
  const statements=[
    "CREATE TABLE IF NOT EXISTS investment_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, version_number INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'forecast' CHECK(kind='forecast'), name TEXT NOT NULL, scenario_id TEXT NOT NULL, payload_json TEXT NOT NULL, content_hash TEXT NOT NULL, request_key TEXT NOT NULL, created_by INTEGER NOT NULL, created_at BIGINT NOT NULL, UNIQUE(project_id,version_number), UNIQUE(project_id,request_key))",
    "CREATE TABLE IF NOT EXISTS investment_change_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, version_id TEXT NOT NULL, baseline_version_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested' CHECK(status='requested'), request_type TEXT NOT NULL, reason TEXT NOT NULL, content_hash TEXT NOT NULL, request_key TEXT NOT NULL, created_by INTEGER NOT NULL, created_at BIGINT NOT NULL, UNIQUE(project_id,request_key))",
    "CREATE TABLE IF NOT EXISTS investment_actual_values (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, metric_key TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, unit TEXT NOT NULL, currency TEXT NOT NULL, basis TEXT NOT NULL, value DOUBLE PRECISION NOT NULL, source_ref TEXT NOT NULL, source_evidence_id TEXT NOT NULL, source_hash TEXT NOT NULL, version INTEGER NOT NULL, supersedes_id TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, confirmed_by INTEGER NOT NULL, created_at BIGINT NOT NULL, UNIQUE(project_id,metric_key,period_start,period_end,unit,currency,basis,version), UNIQUE(project_id,request_key))",
    'CREATE INDEX IF NOT EXISTS idx_investment_versions_project ON investment_versions(project_id,version_number)',
    'CREATE INDEX IF NOT EXISTS idx_investment_requests_project ON investment_change_requests(project_id,created_at)',
    'CREATE INDEX IF NOT EXISTS idx_investment_actuals_project ON investment_actual_values(project_id,created_at)'
  ];for(const sql of statements)await env.DB.prepare(sql).run();
}
function actualRow(x){return {id:x.id,projectId:x.project_id,metricKey:x.metric_key,periodStart:x.period_start,periodEnd:x.period_end,unit:x.unit,currency:x.currency,basis:x.basis,value:Number(x.value),sourceRef:x.source_ref,sourceEvidenceId:x.source_evidence_id,sourceHash:x.source_hash,version:Number(x.version),supersedesId:x.supersedes_id,confirmedBy:Number(x.confirmed_by),confirmation:'actor_confirmed_not_independently_audited',createdAt:Number(x.created_at)};}
async function actuals(env,access){const result=(await env.DB.prepare('SELECT * FROM investment_actual_values WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 5001').bind(access.row.id,access.ownerUserId).all()).results||[];if(result.length>5000)fail(413,'实际值台账超过本次安全读取上限，请先按期间归档/查询，未生成不完整汇总');const values=[];for(const row of result){const value=actualRow(row);try{const evidence=await verifyInvestmentEvidence(env,access,row.source_evidence_id);value.currentSourceStatus=await hash(evidence)===row.source_hash?'valid':'changed';}catch{value.currentSourceStatus='unavailable_or_expired';}value.requiresReview=value.currentSourceStatus!=='valid';values.push(value);}return values;}
async function versionRow(env,access,id){
  const row=await env.DB.prepare('SELECT * FROM investment_versions WHERE id=? AND project_id=? AND user_id=?').bind(clean(id,100),access.row.id,access.ownerUserId).first();if(!row)fail(404,'本项目冻结版本不存在');
  const payload=parse(row.payload_json);if(payload.schemaVersion!==1||payload.kind!=='forecast'||await hash(payload)!==row.content_hash)fail(409,'冻结版本内容校验失败，不可作为预演或申请依据');return {row,payload};
}
export async function investmentLifecycleRead(env,actor,access){
  await ensureInvestmentLifecycle(env);
  const versions=(await env.DB.prepare('SELECT * FROM investment_versions WHERE project_id=? AND user_id=? ORDER BY version_number DESC LIMIT 101').bind(access.row.id,access.ownerUserId).all()).results||[];
  if(versions.length>100)fail(413,'预测版本超过安全读取上限，请按版本查询');
  const requests=(await env.DB.prepare('SELECT * FROM investment_change_requests WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').bind(access.row.id,access.ownerUserId).all()).results||[],values=await actuals(env,access),selected=(await env.DB.prepare("SELECT id,name FROM project_scenarios WHERE project_id=? AND status='selected'").bind(access.row.id).all()).results||[];
  const verified=[];for(const row of versions){const payload=parse(row.payload_json),valid=payload.schemaVersion===1&&payload.kind==='forecast'&&await hash(payload)===row.content_hash;verified.push({id:row.id,name:row.name,number:Number(row.version_number),kind:'forecast',scenarioId:row.scenario_id,contentHash:row.content_hash,valid,createdBy:Number(row.created_by),createdAt:Number(row.created_at),payload:valid?payload:null});}
  const latest=verified.find(x=>x.valid);
  const formal=await readFormalFacts(env,actor,access);
  return {projectId:access.row.id,actorUserId:Number(actor.userId),permissions:access.permissions,approvalConfigured:false,externalFactsVerification:true,approvedBaseline:formal.approvedBaseline,approvedAdjustment:formal.approvedAdjustment,selectedScenario:selected.length===1?selected[0]:null,selectionConflict:selected.length>1,versions:verified,requests:requests.map(x=>({id:x.id,versionId:x.version_id,baselineVersionId:x.baseline_version_id,status:'requested',requestType:x.request_type,reason:x.reason,createdBy:Number(x.created_by),createdAt:Number(x.created_at)})),actuals:values,latestForecastId:latest?.id||null,variance:L.compareActuals(latest?.payload,values),warning:'原批准及调整批准来自独立核验的外部原件，不代替企业审批；预测单独保存。实际值为录入人确认，不等于独立财务审计。'};
}
export async function investmentPortfolioRead(env,actor,projectIds){
  if(!Array.isArray(projectIds)||!projectIds.length||projectIds.length>30||projectIds.some(id=>!/^[A-Za-z0-9_-]{8,100}$/.test(id)))fail(400,'请明确选择1至30个项目');
  const accessList=[];for(const id of [...new Set(projectIds)]){const access=await resolveProjectAccess(env,actor.userId,id);if(!access)fail(404,'所选项目不存在或当前无权访问，未返回部分汇总');accessList.push(access);}
  await ensureInvestmentLifecycle(env);const projects=[];for(const access of accessList)projects.push({projectId:access.row.id,actuals:await actuals(env,access)});return {projectIds:projects.map(x=>x.projectId),...L.aggregateActuals(projects)};
}
export async function verifyInvestmentEvidence(env,access,id){
  let row=await assertProjectObject(env,'project_artifacts',id,access.row.id,{allowMissing:true,ownerUserId:access.ownerUserId});if(!row)row=await assertProjectObject(env,'project_facts',id,access.row.id,{ownerUserId:access.ownerUserId});
  const today=new Date().toISOString().slice(0,10);if(!row||!['confirmed','accepted','approved','final','published','ready','active'].includes(row.status)||row.valid_from&&row.valid_from>today||row.valid_to&&row.valid_to<today)fail(409,'实际数据来源未确认或已失效');
  const meaningful=v=>v!==null&&v!==undefined&&(typeof v==='object'?Object.keys(v).length>0:!!String(v).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>|&nbsp;|[\u200b-\u200d\ufeff]/g,'').trim());
  if(Object.hasOwn(row,'value_json')){if(!meaningful(parse(row.value_json,null))||!clean(row.source_ref)||!Number(row.version)||!clean(row.created_by))fail(409,'事实缺少有效值、来源、版本或确认人，不能作为已核验证据');}
  else {const meta=parse(row.meta_json);if(!clean(row.title)||!clean(row.version)||!meaningful(meta.content)||!clean(meta.sourceRef)||!clean(meta.sourceLocator)||meta.confirmed!==true||!meta.confirmedBy)fail(409,'成果只有登记状态，缺少正文、来源定位、版本或人工确认，不能关闭风险');if(meta.validFrom&&meta.validFrom>today||meta.validTo&&meta.validTo<today)fail(409,'成果依据已过期或尚未生效');}
  return row;
}
export async function investmentLifecycleAction(env,actor,access,b,{verifyScenario}){
  const projectId=access.row.id,owner=access.ownerUserId,now=Date.now();
  if(b.action==='freezeForecast'){
    const key=requestKey(b);if(['payload','metrics','parameters','kind','status','approvedDecisionId'].some(k=>Object.hasOwn(b,k)))fail(400,'冻结只读取服务器采纳方案，不接受客户端指标、参数或批准状态');
    const old=await env.DB.prepare('SELECT * FROM investment_versions WHERE project_id=? AND request_key=?').bind(projectId,key).first();if(old){if(old.scenario_id!==b.scenarioId||old.name!==(clean(b.name,200)||'最新预测'))fail(409,'同一请求标识已用于不同冻结内容');return {ok:true,id:old.id,kind:'forecast',reused:true,formalApproval:false};}
    const selected=(await env.DB.prepare("SELECT * FROM project_scenarios WHERE project_id=? AND status='selected'").bind(projectId).all()).results||[];
    if(selected.length!==1||selected[0].id!==b.scenarioId)fail(409,'请明确指定唯一的当前采纳方案，个人草稿不能冻结为共享预测');
    const scenario=selected[0],data=parse(access.row.data);await verifyScenario(env,scenario,data);const params=parse(scenario.params_json),stored=parse(scenario.metrics_json),result=await env.INVESTMENT_CALCULATOR.calculate({snapshot:params.sourceSnapshot,configuration:params.configuration});
    if(result.invalidMetrics?.length||!Array.isArray(result.annualValues)||!result.annualValues.length)fail(409,'此版本缺少完整可信指标或年度预测，请重新测算');
    const milestones=(await env.DB.prepare('SELECT id,name,stage_key,planned_date,forecast_date,actual_date,status,updated_at FROM project_milestones WHERE project_id=? ORDER BY id').bind(projectId).all()).results||[];
    const payload={schemaVersion:1,kind:'forecast',scenarioId:scenario.id,parameters:params.values,metrics:result.metrics,metricMeta:result.metricMeta,annualValues:result.annualValues,sourceSnapshot:params.sourceSnapshot,configuration:params.configuration,dependencies:{calcSnapshotId:scenario.calc_snapshot_id,sourceHash:stored.verification.sourceHash,engineVersion:result.engineVersion,configHash:result.configHash,reportHash:await hash(deliverySnapshot(data)),projectVersion:Number(access.row.updated_at),milestones},formalApproval:false};
    if(JSON.stringify(payload).length>1000000)fail(413,'冻结版本超过安全大小限制');const sequence=Number((await env.DB.prepare('SELECT MAX(version_number) AS n FROM investment_versions WHERE project_id=?').bind(projectId).first())?.n||0)+1,id=uid('forecast'),name=clean(b.name,200)||'最新预测';
    await env.DB.prepare("INSERT INTO investment_versions(id,project_id,user_id,version_number,kind,name,scenario_id,payload_json,content_hash,request_key,created_by,created_at) VALUES(?,?,?,?,'forecast',?,?,?,?,?,?,?)").bind(id,projectId,owner,sequence,name,scenario.id,JSON.stringify(payload),await hash(payload),key,actor.userId,now).run();
    await lifecycleEvent(env,actor,owner,projectId,'investment.forecast.frozen',{versionId:id,number:sequence,scenarioId:scenario.id,formalApproval:false});return {ok:true,id,number:sequence,kind:'forecast',formalApproval:false};
  }
  if(b.action==='previewChange'){
    const baseline=await versionRow(env,access,b.baselineVersionId),next=await versionRow(env,access,b.versionId);return {ok:true,preview:L.previewChange(baseline.payload,next.payload)};
  }
  if(b.action==='requestInvestmentApproval'){
    const key=requestKey(b),version=await versionRow(env,access,b.versionId),reason=clean(b.reason,2000);if(!reason)fail(400,'审批申请必须说明原因');
    if(b.approvedDecisionId||b.status&&b.status!=='requested'||b.requestType&&b.requestType!=='baseline')fail(409,'企业审批规则未配置，不能确认批准或批准调整；可登记原基准审批申请');
    if(b.baselineVersionId)fail(409,'尚无可信的正式批准基准，预测不能冒充批准调整依据');
    const old=await env.DB.prepare('SELECT * FROM investment_change_requests WHERE project_id=? AND request_key=?').bind(projectId,key).first();if(old){if(old.version_id!==version.row.id||old.reason!==reason)fail(409,'同一申请标识已用于不同内容');return {ok:true,id:old.id,status:'requested',reused:true,formalApproval:false};}
    const id=uid('investment-request');await env.DB.prepare("INSERT INTO investment_change_requests(id,project_id,user_id,version_id,baseline_version_id,status,request_type,reason,content_hash,request_key,created_by,created_at) VALUES(?,?,?,?,'','requested','baseline',?,?,?,?,?)").bind(id,projectId,owner,version.row.id,reason,version.row.content_hash,key,actor.userId,now).run();await lifecycleEvent(env,actor,owner,projectId,'investment.approval.requested',{requestId:id,versionId:version.row.id,formalApproval:false});return {ok:true,id,status:'requested',formalApproval:false,warning:'申请已留痕；尚未配置企业审签权限，不会自动转为正式批准。'};
  }
  if(b.action==='recordActual'){
    if(b.status||b.forecast||b.approved===true)fail(400,'实际值不能由预测或批准状态替代');const input=L.normalizeActual(b.actual),source=await verifyInvestmentEvidence(env,access,input.sourceEvidenceId),payloadHash=await hash(input),old=await env.DB.prepare('SELECT * FROM investment_actual_values WHERE project_id=? AND request_key=?').bind(projectId,input.requestKey).first();
    if(old){if(old.payload_hash!==payloadHash)fail(409,'同一录入标识已用于不同实际值');return {ok:true,id:old.id,version:Number(old.version),reused:true};}
    const current=await env.DB.prepare('SELECT * FROM investment_actual_values WHERE project_id=? AND metric_key=? AND period_start=? AND period_end=? AND unit=? AND currency=? AND basis=? ORDER BY version DESC LIMIT 1').bind(projectId,input.metricKey,input.periodStart,input.periodEnd,input.unit,input.currency,input.basis).first();
    if(Number(current?.version||0)!==input.expectedVersion)fail(409,'实际值已被其他成员更新，请刷新后在最新版本上修正');
    const id=uid('actual'),version=input.expectedVersion+1;await env.DB.prepare('INSERT INTO investment_actual_values(id,project_id,user_id,metric_key,period_start,period_end,unit,currency,basis,value,source_ref,source_evidence_id,source_hash,version,supersedes_id,request_key,payload_hash,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,projectId,owner,input.metricKey,input.periodStart,input.periodEnd,input.unit,input.currency,input.basis,input.value,input.sourceRef,input.sourceEvidenceId,await hash(source),version,current?.id||'',input.requestKey,payloadHash,actor.userId,now).run();
    await lifecycleEvent(env,actor,owner,projectId,'investment.actual.recorded',{actualId:id,metricKey:input.metricKey,version,supersedesId:current?.id||'',sourceEvidenceId:input.sourceEvidenceId,confirmation:'actor_confirmed'});return {ok:true,id,version,supersedesId:current?.id||'',confirmation:'actor_confirmed_not_independently_audited'};
  }
  fail(400,'不支持的投资生命周期操作');
}
