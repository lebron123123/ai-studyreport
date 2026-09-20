import '../../investment-ops.js';
import {step4Actions,ensureStep4,readStep4,mutateStep4} from './_investment-step4.js';
import {ensureRiskReports,createRiskReport,readRiskReports} from './_investment-risk-report.js';
import {watchActions,ensureInvestmentWatch,mutateInvestmentWatch,readInvestmentWatch} from './_investment-watch.js';
import {formalFactActions,ensureFormalFacts,readFormalFacts,mutateFormalFact} from './_investment-formal-facts.js';
import {ensureInvestmentMonitor,runInvestmentCheck,readInvestmentChecks} from './_investment-monitor.js';
import {ensureObligations,readObligations,mutateObligation,obligationActions} from './_investment-obligations.js';
import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {resolveProjectAccess} from './_project-access.js';
import {withProjectMutation,lifecycleEvent,lifecycleError,assertProjectObject} from './_lifecycle-integrity.js';
import {onRequestGet as getCalcConfig} from './calcconfig.js';
import {deliverySnapshot,ensureDelivery} from './_delivery.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {ensureInvestmentTables} from './investmentops.js';
import {INVESTMENT_LIFECYCLE_ACTIONS,ensureInvestmentLifecycle,investmentLifecycleAction,investmentLifecycleRead,investmentPortfolioRead,verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {ensureInvestmentItems,investmentItemLinks,updateInvestmentItem,readInvestmentItemContexts} from './_investment-items.js';

const Ops=globalThis.InvestmentOps;
const clean=(v,n=500)=>String(v==null?'':v).trim().slice(0,n);
const parse=(v,f={})=>{try{return typeof v==='string'?JSON.parse(v):v==null?f:v;}catch{return f;}};
const uid=p=>p+'-'+crypto.randomUUID();
const fail=(status,message)=>{throw lifecycleError(status,message);};
const LEGACY_WARNING='本入口仅保存人工自报台账，不计入生产通过。请迁移至受信评测：登记独立复核版本、运行服务端评测并通过发布门禁。';
async function ensure(env){
  await ensureInvestmentTables(env);await ensureDelivery(env);await ensureInvestmentItems(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS project_decisions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,stage_key TEXT DEFAULT 'feasibility',topic TEXT NOT NULL,options_json TEXT NOT NULL DEFAULT '[]',decision_text TEXT DEFAULT '',evidence_ids_json TEXT NOT NULL DEFAULT '[]',scenario_ids_json TEXT NOT NULL DEFAULT '[]',owner TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)").run();
}
function pid(value){const id=clean(value,100);return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:'';}
function stable(value){return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;}
const hash=value=>reportEvidenceHash(stable(value));
function scenarioRow(row){
  const params=parse(row.params_json),metrics=parse(row.metrics_json),versioned=params.schemaVersion===2&&metrics.schemaVersion===2;
  return Ops.normalizeScenario({id:row.id,name:row.name,kind:row.kind,calcType:row.calc_type,calcSnapshotId:row.calc_snapshot_id,engine:versioned?row.engine:'unverified',params:versioned?params.values:params,metrics:versioned?metrics.values:metrics,metricMeta:versioned?metrics.metricMeta:{},invalidMetrics:versioned?metrics.invalidMetrics:[],verification:versioned?metrics.verification:{status:'legacy_unverified'},risks:parse(row.risks_json,[]),status:row.status});
}
async function rows(env,table,projectId,userId){return (await env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100`).bind(projectId,userId).all()).results||[];}
async function visibleScenarios(env,actor,access){const privateRows=(await env.DB.prepare("SELECT * FROM project_scenarios WHERE project_id=? AND user_id=? AND status<>'selected' ORDER BY updated_at DESC LIMIT 100").bind(access.row.id,actor.userId).all()).results||[],shared=(await env.DB.prepare("SELECT * FROM project_scenarios WHERE project_id=? AND (status='selected' OR (status='submitted' AND ?=1)) ORDER BY updated_at DESC").bind(access.row.id,access.permissions.manage?1:0).all()).results||[];return [...new Map([...shared,...privateRows].map(x=>[x.id,x])).values()];}
async function list(env,actor,access){
  const projectId=access.row.id,owner=access.ownerUserId;
  const [meetings,tasks,risks,scenarioRows,packages,evaluations,optimizations]=await Promise.all([rows(env,'project_meetings',projectId,actor.userId),rows(env,'project_tasks',projectId,owner),rows(env,'project_risks',projectId,owner),visibleScenarios(env,actor,access),rows(env,'project_decision_packages',projectId,owner),rows(env,'project_evaluations',projectId,actor.userId),rows(env,'optimization_ledger',projectId,actor.userId)]);
  const scenarios=scenarioRows.map(row=>({...scenarioRow(row),status:row.status,createdBy:Number(row.user_id),canSubmit:Number(row.user_id)===Number(actor.userId)&&['draft','returned'].includes(row.status),canAdopt:access.permissions.manage&&(Number(row.user_id)===Number(actor.userId)||row.status==='submitted'),canReturn:access.permissions.manage&&row.status==='submitted'})),selected=scenarios.filter(s=>s.status==='selected');
  const itemContexts=await readInvestmentItemContexts(env,access,tasks.concat(risks));
  const currentHash=await reportEvidenceHash(deliverySnapshot(parse(access.row.data))),packageList=[];
  let selectedValid=false;if(selected.length===1){try{selectedValid=await verifyScenario(env,scenarioRows.find(x=>x.id===selected[0].id),parse(access.row.data));}catch{}}
  for(const x of packages){
    const pack=parse(x.package_json),audit=parse(x.audit_json);let status=x.status,reason='';
    if(status==='ready'){
      if(pack.schemaVersion!==2||pack.reportHash!==currentHash||!selectedValid||pack.scenario?.id!==selected[0]?.id)reason='历史就绪状态不能代表当前版本；正文、采纳方案或引擎已变化，请重新生成决策包';
      else try{const delivery=await env.DB.prepare('SELECT * FROM report_deliveries WHERE id=? AND project_id=?').bind(pack.deliveryId,projectId).first();if(!delivery||delivery.status!=='approved'||delivery.content_hash!==currentHash||Number(delivery.author_id)===Number(delivery.reviewer_id)||parse(delivery.result_json).passed!==true||parse(delivery.note).wordLayoutReviewed!==true||parse(delivery.note).factsReviewed!==true)fail(409,'当前独立复核不再有效');if(!pack.evidenceIds?.length)fail(409,'缺少已核实证据');for(const evidenceId of pack.evidenceIds){const evidence=await verifyInvestmentEvidence(env,access,evidenceId);if(pack.evidenceProofs?.find(p=>p.id===evidenceId)?.hash!==await hash(evidence))fail(409,'关联证据内容或版本已变化，请重新生成决策包');}}catch(error){reason=error.status?error.message:'当前证据无法核验，请重新生成决策包';}
      if(reason){status='blocked';audit.passed=false;audit.status='blocked';audit.blockers=[...(audit.blockers||[]),reason];}
    }
    packageList.push({id:x.id,title:x.title,scenarioId:x.scenario_id,decisionId:x.decision_id,package:{...pack,status,audit},audit,status,historicalStatus:x.status,updatedAt:Number(x.updated_at)});
  }
  return {role:access.role,permissions:access.permissions,meetings:meetings.map(x=>({id:x.id,title:x.title,content:x.content,extraction:parse(x.extraction_json),status:x.status,updatedAt:Number(x.updated_at)})),tasks:tasks.map(x=>({id:x.id,title:x.title,owner:x.owner,dueDate:x.due_date,sourceRef:x.source_ref,status:x.status,...itemContexts[x.id]})),risks:risks.map(x=>({id:x.id,title:x.title,level:x.risk_level,owner:x.owner,sourceRef:x.source_ref,status:x.status,...itemContexts[x.id]})),scenarios,adoptedScenarioId:selected.length===1?selected[0].id:null,selectionWarning:selected.length>1?'旧记录存在多个采纳情景，请所有者明确重新采纳一个情景':'',packages:packageList,evaluations:evaluations.map(x=>({id:x.id,type:x.evaluation_type,result:parse(x.result_json),status:'recorded',legacyStatus:x.status,authority:'self_reported',migrationRequired:true,updatedAt:Number(x.updated_at)})),optimizations:optimizations.map(x=>({id:x.id,title:x.title,evidence:x.evidence,before:x.before_value,after:x.after_value,actualBenefit:x.actual_benefit,status:x.status,updatedAt:Number(x.updated_at)})),production:{...Ops.productionGate({}),authority:'legacy_non_authoritative',migrationRequired:true,warning:LEGACY_WARNING}};
}
async function findScenario(env,actor,access,id){
  const row=await assertProjectObject(env,'project_scenarios',id,access.row.id);
  if(!row||Number(row.user_id)!==Number(actor.userId)&&row.status!=='selected'&&!(access.permissions.manage&&row.status==='submitted'))fail(404,'情景不存在或属于其他成员个人草稿');
  return row;
}
async function verifyScenario(env,row,data){
  const params=parse(row.params_json),stored=parse(row.metrics_json);
  if(params.schemaVersion!==2||stored.schemaVersion!==2||stored.verification?.status!=='server_recomputed')fail(409,'旧情景未经过服务端复算，请从已保存快照重新创建');
  if(!env.INVESTMENT_CALCULATOR?.calculate)fail(503,'当前部署未配置可信复算引擎，不能采纳或签发情景');
  const result=await env.INVESTMENT_CALCULATOR.calculate({snapshot:params.sourceSnapshot,configuration:params.configuration});
  if(await hash(result)!==stored.verification.outputHash||await hash(params.sourceSnapshot)!==stored.verification.sourceHash||await hash(result.metrics)!==await hash(stored.values)||await hash(result.metricMeta)!==await hash(stored.metricMeta))fail(409,'情景快照或引擎版本已变化，请重新复算确认');
  const current=(data.workflow?.calcSnapshots||[]).find(s=>(s.id||s.snapshotId)===row.calc_snapshot_id);
  if(!current||await hash(current)!==stored.verification.sourceHash)fail(409,'情景对应的项目快照已变化或不再保留，请重新测算确认');
  return true;
}
export {verifyScenario as verifyInvestmentScenario};
async function confirmMeeting(env,actor,access,b){
  const projectId=access.row.id,meetingId=clean(b.meetingId,100),m=await env.DB.prepare('SELECT * FROM project_meetings WHERE id=? AND project_id=? AND user_id=?').bind(meetingId,projectId,actor.userId).first();
  if(!m)fail(404,'会议候选不存在');
  const links=await investmentItemLinks(env,access,b);
  const extraction=parse(m.extraction_json),candidates=['tasks','risks','decisions'].flatMap(kind=>(extraction[kind]||[]).map(item=>({kind,item}))),valid=new Set(candidates.map(x=>x.item.id));
  const ids=Array.isArray(b.selectedIds)?b.selectedIds:b.confirmAll===true?[...valid]:[];
  if(!ids.length)fail(400,'尚未选择候选项；全部确认需要明确 confirmAll');
  if(ids.some(id=>typeof id!=='string'||!valid.has(id)))fail(400,'选中的会议候选已失效，请刷新');
  const picked=new Set(ids),confirmed=new Set(extraction.confirmedIds||[]),counts={taskCount:0,riskCount:0,decisionCount:0,reusedCount:0},now=Date.now();
  for(const {kind,item} of candidates){
    if(!picked.has(item.id))continue;if(confirmed.has(item.id)){counts.reusedCount++;continue;}
    const singular={tasks:'task',risks:'risk',decisions:'decision'}[kind],sourceRef='meeting:'+meetingId+':'+(item.sourceId||'line-'+item.sourceLine),id=singular+'-'+await hash([projectId,meetingId,kind,item.id]);
    if(kind==='tasks')await env.DB.prepare("INSERT INTO project_tasks(id,project_id,user_id,title,owner,due_date,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(id) DO NOTHING").bind(id,projectId,access.ownerUserId,clean(item.text,500),clean(item.owner,100),clean(item.due,40),sourceRef,now,now).run();
    if(kind==='risks')await env.DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,risk_level,owner,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,?,'',?,'open',?,?) ON CONFLICT(id) DO NOTHING").bind(id,projectId,access.ownerUserId,clean(item.text,500),clean(item.level,20),sourceRef,now,now).run();
    if(kind==='decisions')await env.DB.prepare("INSERT INTO project_decisions(id,project_id,user_id,stage_key,topic,options_json,decision_text,evidence_ids_json,scenario_ids_json,owner,status,created_by,created_at,updated_at) VALUES(?,?,?,'decision',?,?,'','[]','[]','','candidate',?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,projectId,access.ownerUserId,clean(item.text,240),JSON.stringify([{name:'会议来源',sourceRef,sourceCandidateId:item.id}]),clean(actor.username||actor.userId,80),now,now).run();
    if(singular!=='decision'&&(links.stageKey||links.milestoneId))await updateInvestmentItem(env,actor,access,{type:singular,id,status:'open',...links});
    confirmed.add(item.id);counts[singular+'Count']++;
  }
  extraction.confirmedIds=[...confirmed];const status=confirmed.size===valid.size?'confirmed':'partially_confirmed';
  await env.DB.prepare('UPDATE project_meetings SET extraction_json=?,status=?,updated_at=? WHERE id=? AND project_id=? AND user_id=?').bind(JSON.stringify(extraction),status,now,meetingId,projectId,actor.userId).run();
  if(counts.taskCount+counts.riskCount+counts.decisionCount)await lifecycleEvent(env,actor,access.ownerUserId,projectId,'meeting.confirmed',{meetingId,selectedIds:[...picked],...counts});
  return {ok:true,status,...counts};
}
async function saveScenario(env,actor,access,b,request){
  const input=b.scenario||{};
  if(['params','metrics','engine','verification','metricMeta','calcType'].some(key=>Object.hasOwn(input,key))||input.status&&input.status!=='draft')fail(400,'情景仅接受名称、类型和风险说明；参数与指标必须来自服务端已保存快照');
  if(!env.INVESTMENT_CALCULATOR?.calculate)fail(503,'当前部署未配置可信复算引擎，不支持保存白箱情景');
  const data=parse(access.row.data),snapshots=data.workflow?.calcSnapshots||[],snapshotId=clean(b.calcSnapshotId||data.workflow?.currentCalcSnapshotId||snapshots.at(-1)?.id,120),matches=snapshots.filter(s=>(s.id||s.snapshotId)===snapshotId);
  if(!snapshotId||matches.length!==1)fail(409,'指定测算快照不存在或ID不唯一，请先测算并保存项目');
  const snapshot=matches[0];if(!snapshot.summary||!snapshot.params)fail(409,'快照缺少确认参数和汇总，请重新测算并保存');
  const response=await getCalcConfig({env,request}),configBody=await response.json();if(!response.ok||!configBody.ok)fail(503,'无法读取服务端当前测算配置');
  const configuration=configBody.config,result=await env.INVESTMENT_CALCULATOR.calculate({snapshot,configuration});
  if(await hash(snapshot.summary)!==await hash(result.summary))fail(409,'已保存快照与当前白箱配置复算不一致，请重新测算、确认并保存项目');
  const verification={status:'server_recomputed',sourceHash:await hash(snapshot),sourceVersion:snapshot.version??null,projectVersion:Number(access.row.updated_at)||0,engineVersion:result.engineVersion,configHash:result.configHash,outputHash:await hash(result),verifiedAt:Date.now(),verifiedBy:Number(actor.userId)};
  const id=uid('scenario'),scenario=Ops.normalizeScenario({...input,id,calcType:snapshot.calcType,calcSnapshotId:snapshotId,engine:'whitebox',params:snapshot.params,metrics:result.metrics,metricMeta:result.metricMeta,invalidMetrics:result.invalidMetrics,verification,status:'draft'}),now=Date.now();
  const frozen={schemaVersion:2,values:snapshot.params,sourceSnapshot:snapshot,configuration},metrics={schemaVersion:2,values:scenario.metrics,metricMeta:scenario.metricMeta,invalidMetrics:scenario.invalidMetrics,verification};
  await env.DB.prepare('INSERT INTO project_scenarios(id,project_id,user_id,name,kind,calc_type,calc_snapshot_id,engine,params_json,metrics_json,risks_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,access.row.id,actor.userId,scenario.name,scenario.kind,scenario.calcType,snapshotId,'whitebox',JSON.stringify(frozen),JSON.stringify(metrics),JSON.stringify(scenario.risks),'draft',now,now).run();
  await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'scenario.saved',{scenarioId:id,calcSnapshotId:snapshotId,engineVersion:result.engineVersion,sourceHash:verification.sourceHash});return {ok:true,id,scenario};
}
async function createPackage(env,actor,access,b){
  const row=await findScenario(env,actor,access,clean(b.scenarioId,100)),scenario=scenarioRow(row),projectId=access.row.id,data=parse(access.row.data);
  let snapshotVerified=false,snapshotIssue='';try{snapshotVerified=await verifyScenario(env,row,data);}catch(error){snapshotIssue=error.message;}
  const evidenceIds=Array.isArray(b.evidenceIds)?[...new Set(b.evidenceIds.map(id=>clean(id,100)).filter(Boolean))]:[];if(evidenceIds.length>100)fail(400,'一次最多关联100条证据');
  const evidenceProofs=[];for(const id of evidenceIds){const evidence=await verifyInvestmentEvidence(env,access,id);evidenceProofs.push({id,hash:await hash(evidence)});}
  const decisionId=clean(b.decisionId,100);if(decisionId)await assertProjectObject(env,'project_decisions',decisionId,projectId,{ownerUserId:access.ownerUserId});
  const artifacts=(await rows(env,'project_artifacts',projectId,access.ownerUserId)).map(x=>({id:x.id,artifactType:x.artifact_type})),contentHash=await reportEvidenceHash(deliverySnapshot(data));
  const deliveries=(await env.DB.prepare("SELECT * FROM report_deliveries WHERE project_id=? AND status='approved' ORDER BY reviewed_at DESC LIMIT 50").bind(projectId).all()).results||[];
  const delivery=deliveries.find(d=>d.content_hash===contentHash&&Number(d.author_id)!==Number(d.reviewer_id)&&parse(d.result_json).passed===true&&parse(d.note).wordLayoutReviewed===true&&parse(d.note).factsReviewed===true);
  const all=await visibleScenarios(env,actor,access),selected=all.filter(s=>s.status==='selected'),selectionVerified=selected.length===1&&selected[0].id===row.id;
  const pack=Ops.buildDecisionPackage({projectId,title:b.title,scenario,scenarios:all.filter(s=>s.status==='selected'||s.id===row.id).map(scenarioRow),decisionId,evidenceIds,artifactIds:artifacts.map(x=>x.id),context:{artifacts,snapshotVerified,evidenceVerified:evidenceIds.length>0,consistencyVerified:!!delivery&&selectionVerified},consistencyIssues:[]});
  if(snapshotIssue)pack.audit.blockers.push(snapshotIssue);if(!selectionVerified)pack.audit.blockers.push('请由项目所有者明确采纳一个可信情景；草稿或多重采纳不能形成就绪决策包');
  const id=uid('package');Object.assign(pack,{id,schemaVersion:2,reportHash:contentHash,deliveryId:delivery?.id||'',selectionVerified,evidenceProofs});
  await env.DB.prepare('INSERT INTO project_decision_packages(id,project_id,user_id,title,scenario_id,decision_id,package_json,audit_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,projectId,access.ownerUserId,pack.title,row.id,decisionId,JSON.stringify(pack),JSON.stringify(pack.audit),pack.status,Date.now(),Date.now()).run();
  await lifecycleEvent(env,actor,access.ownerUserId,projectId,'decision.package.created',{packageId:id,scenarioId:row.id,status:pack.status,deliveryId:pack.deliveryId});return {ok:true,id,package:pack};
}
async function mutate(env,actor,access,b,request){
  if(step4Actions.has(b.action))return mutateStep4(env,actor,access,b);
  if(b.action==='createRiskReport')return createRiskReport(env,actor,access,b);
  if(watchActions.has(b.action))return mutateInvestmentWatch(env,actor,access,b);
  if(b.action==='runInvestmentCheck')return runInvestmentCheck(env,actor,access,b,{verifyScenario});
  if(formalFactActions.has(b.action))return mutateFormalFact(env,actor,access,b);
  if(obligationActions.has(b.action))return mutateObligation(env,actor,access,b);
  const projectId=access.row.id,now=Date.now();
  if(INVESTMENT_LIFECYCLE_ACTIONS.has(b.action))return investmentLifecycleAction(env,actor,access,b,{verifyScenario});
  if(b.action==='extractMeeting'){
    const content=clean(b.content,20000);if(!content)fail(400,'请粘贴会议纪要内容');const extraction=Ops.parseMeeting(content),id=uid('meeting');
    await env.DB.prepare("INSERT INTO project_meetings(id,project_id,user_id,title,content,extraction_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'candidate',?,?)").bind(id,projectId,actor.userId,clean(b.title,200)||'项目会议纪要',content,JSON.stringify(extraction),now,now).run();
    await lifecycleEvent(env,actor,access.ownerUserId,projectId,'meeting.extracted',{meetingId:id,summary:extraction.summary});return {ok:true,id,extraction};
  }
  if(b.action==='confirmMeeting')return confirmMeeting(env,actor,access,b);
  if(b.action==='saveScenario')return saveScenario(env,actor,access,b,request);
  if(b.action==='submitScenario'||b.action==='returnScenario'){
    if(b.action==='returnScenario'&&!access.permissions.manage)fail(403,'仅项目负责人可以退回已提交方案');
    const row=await findScenario(env,actor,access,clean(b.scenarioId,100)),submit=b.action==='submitScenario';
    if(submit&&(Number(row.user_id)!==Number(actor.userId)||!['draft','returned'].includes(row.status)))fail(409,'仅能提交自己的草稿或退回方案');
    if(!submit&&(row.status!=='submitted'||!clean(b.reason)))fail(400,'请填写退回原因，且只能退回待采纳方案');
    if(submit)await verifyScenario(env,row,parse(access.row.data));
    const status=submit?'submitted':'returned';await env.DB.prepare('UPDATE project_scenarios SET status=?,updated_at=? WHERE id=? AND project_id=?').bind(status,now,row.id,projectId).run();
    await lifecycleEvent(env,actor,access.ownerUserId,projectId,'scenario.'+status,{scenarioId:row.id,reason:clean(b.reason),authorId:row.user_id,formalApproval:false});return {ok:true,id:row.id,status};
  }
  if(b.action==='selectScenario'){
    const row=await findScenario(env,actor,access,clean(b.scenarioId,100));await verifyScenario(env,row,parse(access.row.data));const scenario=scenarioRow(row),required=['irr','npv','payback'].concat(scenario.calcType==='gaibao'?[]:['totalInvestment']);
    if(required.some(key=>!Number.isFinite(scenario.metrics[key]))||scenario.invalidMetrics.length)fail(409,'关键指标无法计算或缺失，不能采纳此情景');
    await env.DB.prepare("UPDATE project_scenarios SET status='archived',updated_at=? WHERE project_id=? AND status='selected' AND id<>?").bind(now,projectId,row.id).run();
    await env.DB.prepare("UPDATE project_scenarios SET status='selected',updated_at=? WHERE id=? AND project_id=?").bind(now,row.id,projectId).run();
    await lifecycleEvent(env,actor,access.ownerUserId,projectId,'scenario.selected',{scenarioId:row.id,formalApproval:false});return {ok:true,id:row.id,adoptedScenarioId:row.id,formalApproval:false};
  }
  if(b.action==='createDecisionPackage')return createPackage(env,actor,access,b);
  if(b.action==='saveEvaluation'){
    const type=['golden_project','slo_load','workflow_recovery','business_acceptance'].includes(b.type)?b.type:'business_acceptance',id=uid('evaluation'),result={schemaVersion:2,authority:'self_reported',submittedResult:b.result||{},submittedStatus:clean(b.status,30),projectType:clean(parse(access.row.data).project?.type,30)};if(JSON.stringify(result).length>100000)fail(413,'自报评测台账过大');
    await env.DB.prepare('INSERT INTO project_evaluations(id,project_id,user_id,evaluation_type,result_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,projectId,actor.userId,type,JSON.stringify(result),'recorded',now,now).run();
    await lifecycleEvent(env,actor,access.ownerUserId,projectId,'evaluation.self_reported',{evaluationId:id,type,status:'recorded'});return {ok:true,id,status:'recorded',productionEligible:false,migrationRequired:true,warning:LEGACY_WARNING};
  }
  if(b.action==='saveOptimization'){
    const title=clean(b.title,240);if(!title)fail(400,'优化事项不能为空');const id=uid('optimization');
    await env.DB.prepare('INSERT INTO optimization_ledger(id,project_id,user_id,title,evidence,before_value,after_value,actual_benefit,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,projectId,actor.userId,title,clean(b.evidence,2000),clean(b.before,300),clean(b.after,300),clean(b.actualBenefit,500),clean(b.status||'candidate',30),now,now).run();
    await lifecycleEvent(env,actor,access.ownerUserId,projectId,'optimization.saved',{optimizationId:id,title});return {ok:true,id};
  }
  if(b.action==='updateItem'){
    return updateInvestmentItem(env,actor,access,b);
  }
  fail(400,'不支持的Investment OS操作');
}
export async function onRequestGet(c){
  const env=adaptEnv(c.env),actor=await verifyAuth(c.request,env);if(!actor)return json({ok:false,error:'未登录或登录已过期'},401);
  try{const query=new URL(c.request.url).searchParams;if(query.get('view')==='lifecyclePortfolio')return json({ok:true,portfolio:await investmentPortfolioRead(env,actor,(query.get('projectIds')||'').split(',').filter(Boolean))});const projectId=pid(query.get('projectId'));if(!projectId)fail(400,'项目ID不合法');const access=await resolveProjectAccess(env,actor.userId,projectId);if(!access)fail(404,'项目不存在或无权访问');await ensure(env);
  if(query.get('view')==='riskReports'){await ensureRiskReports(env);return json(await withProjectMutation(env,actor,projectId,'view',(tx,current)=>readRiskReports(tx,actor,current,query)));}
  if(query.get('view')==='step4'){await ensureStep4(env);return json(await withProjectMutation(env,actor,projectId,'view',(tx,current)=>readStep4(tx,actor,current)));}
  if(query.get('view')==='watch'){await ensureInvestmentWatch(env);return json(await readInvestmentWatch(env,actor,access,query.get('period')||'week'));}
  if(query.get('view')==='formalFacts'){
    await ensureInvestmentMonitor(env);
    const formalFacts=await readFormalFacts(env,actor,access);
    formalFacts.checks=await readInvestmentChecks(env,access);
    formalFacts.obligations=((await env.DB.prepare('SELECT id,detail_json FROM project_obligations WHERE project_id=? ORDER BY id').bind(projectId).all()).results||[]).map(r=>({id:r.id,title:parse(r.detail_json).title}));
    formalFacts.scenarios=(await env.DB.prepare("SELECT id,name FROM project_scenarios WHERE project_id=? AND status='selected'").bind(projectId).all()).results||[];
    return json({ok:true,formalFacts});
  }
  if(query.get('view')==='handoffs'){await ensureObligations(env);return json({ok:true,handoffs:await readObligations(env,actor,access)});}if(query.get('view')==='lifecycle')return json({ok:true,lifecycle:await investmentLifecycleRead(env,actor,access)});return json({ok:true,ops:await list(env,actor,access)});}catch(error){return json({ok:false,error:error.status?error.message:'运营台账读取失败，请稍后重试'},error.status||500);}
}
export async function onRequestPost(c){
  const env=adaptEnv(c.env),actor=await verifyAuth(c.request,env);if(!actor)return json({ok:false,error:'未登录或登录已过期'},401);let b;try{b=await c.request.json();}catch{return json({ok:false,error:'请求格式有误'},400);}
  try{if(!b||!pid(b.projectId))fail(400,'项目ID不合法');const access=await resolveProjectAccess(env,actor.userId,b.projectId);if(!access)fail(404,'项目不存在或无权访问');if(!access.permissions.edit)fail(403,'当前项目角色只读，不能修改运营台账');await ensure(env);if(step4Actions.has(b.action))await ensureStep4(env);if(b.action==='createRiskReport')await ensureRiskReports(env);if(watchActions.has(b.action))await ensureInvestmentWatch(env);if(formalFactActions.has(b.action)||b.action==='runInvestmentCheck')await ensureInvestmentMonitor(env);if(obligationActions.has(b.action))await ensureObligations(env);if(INVESTMENT_LIFECYCLE_ACTIONS.has(b.action))await ensureInvestmentLifecycle(env);const result=await withProjectMutation(env,actor,b.projectId,['selectScenario','freezeForecast','runInvestmentCheck','watchConfigure'].includes(b.action)?'manage':'edit',(tx,current)=>mutate(tx,actor,current,b,c.request));return json(result);}catch(error){return json({ok:false,error:error.status?error.message:'运营台账未保存，请稍后重试；本次事务已回滚'},error.status||500);}
}
