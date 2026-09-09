// /api/projectbrain —— Investment OS统一项目上下文、事实、指标、成果、决策、变更与生命周期。
import "../../project-brain.js";
import "../../report-dependency.js";
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { resolveProjectAccess } from "./_project-access.js";
import { ensureLifecycleIntegrity,readWorkStage,updateWorkStage,withProjectMutation,assertProjectObject,lifecycleError } from "./_lifecycle-integrity.js";

const Core=globalThis.ProjectBrain;
const clean=(v,n=240)=>String(v==null?"":v).trim().slice(0,n);
const parse=(v,f={})=>{try{return typeof v==="string"?JSON.parse(v):v==null?f:v;}catch(_){return f;}};
const uid=p=>p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
const TABLES=[
  "CREATE TABLE IF NOT EXISTS project_facts (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,fact_type TEXT NOT NULL,fact_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',source_type TEXT DEFAULT '',source_ref TEXT DEFAULT '',confidence REAL NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'candidate',valid_from TEXT DEFAULT '',valid_to TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_facts_version ON project_facts(project_id,user_id,fact_key,version)",
  "CREATE INDEX IF NOT EXISTS idx_project_facts_lookup ON project_facts(project_id,user_id,status,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_metrics (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,metric_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',calc_snapshot_id TEXT DEFAULT '',lineage_json TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_metrics_lookup ON project_metrics(project_id,user_id,metric_key,version)",
  "CREATE TABLE IF NOT EXISTS project_artifacts (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,artifact_type TEXT NOT NULL,title TEXT DEFAULT '',module_ref TEXT DEFAULT '',version TEXT DEFAULT '',status TEXT DEFAULT 'draft',evidence_audit_id TEXT DEFAULT '',meta_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_artifacts_lookup ON project_artifacts(project_id,user_id,artifact_type,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_events_lookup ON project_events(project_id,user_id,created_at)",
  "CREATE TABLE IF NOT EXISTS project_decisions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,stage_key TEXT DEFAULT 'feasibility',topic TEXT NOT NULL,options_json TEXT NOT NULL DEFAULT '[]',decision_text TEXT DEFAULT '',evidence_ids_json TEXT NOT NULL DEFAULT '[]',scenario_ids_json TEXT NOT NULL DEFAULT '[]',owner TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_decisions_lookup ON project_decisions(project_id,user_id,status,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_change_sets (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT DEFAULT '',before_json TEXT NOT NULL DEFAULT '{}',after_json TEXT NOT NULL DEFAULT '{}',impact_json TEXT NOT NULL DEFAULT '{}',approval_status TEXT NOT NULL DEFAULT 'preview',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_changes_lookup ON project_change_sets(project_id,user_id,created_at)",
  "CREATE TABLE IF NOT EXISTS project_stage_history (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,from_stage TEXT DEFAULT '',to_stage TEXT NOT NULL,reason TEXT DEFAULT '',approved_by TEXT DEFAULT '',changed_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_stage_history_lookup ON project_stage_history(project_id,user_id,changed_at)"
];
async function ensure(env){for(const sql of TABLES)await env.DB.prepare(sql).run();await ensureLifecycleIntegrity(env);}
function projectIdOf(v){const id=clean(v,100);return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";}
function factRow(x){const meta=parse(x.fact_meta_json,{});return {...meta,id:x.id,factType:x.fact_type,factKey:meta.originalFactKey||x.fact_key,label:x.label,value:parse(x.value_json,null),unit:x.unit,sourceType:x.source_type,sourceRef:x.source_ref,confidence:Number(x.confidence),status:x.status,validFrom:x.valid_from,validTo:x.valid_to,version:Number(x.version),createdAt:Number(x.created_at),updatedAt:Number(x.updated_at)};}
function metricRow(x){return {id:x.id,metricKey:x.metric_key,label:x.label,value:parse(x.value_json,null),unit:x.unit,calcSnapshotId:x.calc_snapshot_id,lineage:parse(x.lineage_json,{}),version:Number(x.version),updatedAt:Number(x.updated_at)};}
function artifactRow(x){return {id:x.id,artifactType:x.artifact_type,title:x.title,moduleRef:x.module_ref,version:x.version,status:x.status,evidenceAuditId:x.evidence_audit_id,meta:parse(x.meta_json,{}),updatedAt:Number(x.updated_at)};}
function decisionRow(x){return {id:x.id,stageKey:x.stage_key,topic:x.topic,options:parse(x.options_json,[]),decision:x.decision_text,evidenceIds:parse(x.evidence_ids_json,[]),scenarioIds:parse(x.scenario_ids_json,[]),owner:x.owner,status:x.status,createdBy:x.created_by,createdAt:Number(x.created_at),updatedAt:Number(x.updated_at)};}
function eventRow(x){return {id:x.id,eventType:x.event_type,actor:x.actor,payload:parse(x.payload_json,{}),createdAt:Number(x.created_at)};}
function changeRow(x){return {id:x.id,title:x.title,before:parse(x.before_json,{}),after:parse(x.after_json,{}),impact:parse(x.impact_json,{}),approvalStatus:x.approval_status,createdBy:x.created_by,createdAt:Number(x.created_at),updatedAt:Number(x.updated_at)};}
async function insertEvent(env,user,projectId,type,payload){const now=Date.now(),id=uid("event");await env.DB.prepare("INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,projectId,user.userId,clean(type,60),clean(user.username||user.actorUserId||user.userId,80),JSON.stringify({...payload,actorUserId:user.actorUserId||user.userId}),now).run();return id;}
async function loadContext(env,user,row){
  const pid=row.id,queries=await Promise.all([
    env.DB.prepare("SELECT f.*,d.meta_json AS fact_meta_json FROM project_facts f LEFT JOIN project_fact_details d ON d.fact_id=f.id AND d.project_id=f.project_id WHERE f.project_id=? AND f.user_id=? ORDER BY f.fact_key,f.version DESC LIMIT 500").bind(pid,user.userId).all(),
    env.DB.prepare("SELECT * FROM project_metrics WHERE project_id=? AND user_id=? ORDER BY metric_key,version DESC LIMIT 300").bind(pid,user.userId).all(),
    env.DB.prepare("SELECT * FROM project_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 200").bind(pid,user.userId).all(),
    env.DB.prepare("SELECT * FROM project_decisions WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100").bind(pid,user.userId).all(),
    // Historical draft backups stay complete in storage, not in the routine activity feed.
    env.DB.prepare("SELECT id,project_id,user_id,event_type,actor,created_at,CASE WHEN event_type='report.delivery.restored' THEN '{\"backupStored\":true,\"formalApproval\":false,\"restorationScope\":\"report_body_and_references_only\"}' ELSE payload_json END AS payload_json FROM project_events WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100").bind(pid,user.userId).all(),
    env.DB.prepare("SELECT * FROM project_change_sets WHERE project_id=? AND (user_id=? OR (user_id=? AND approval_status IN ('approved','adopted'))) ORDER BY created_at DESC LIMIT 60").bind(pid,user.actorUserId||user.userId,user.userId).all()
  ]),latest=(rows,key)=>{const seen=new Set();return (rows.results||[]).filter(x=>{const k=x[key];if(seen.has(k))return false;seen.add(k);return true;});},data=parse(row.data,{});
  const workStage=await readWorkStage(env,row),context=Core.buildContext({projectId:pid,name:row.name,data,stageKey:workStage.key,updatedAt:row.updated_at,
    facts:latest(queries[0],"fact_key").map(factRow),metrics:latest(queries[1],"metric_key").map(metricRow),artifacts:(queries[2].results||[]).map(artifactRow),decisions:(queries[3].results||[]).map(decisionRow),events:(queries[4].results||[]).map(eventRow),changes:(queries[5].results||[]).map(changeRow)});
  if(globalThis.ReportDependency){const calc=(data.workflow&&data.workflow.calcSnapshots||[]).slice(-1)[0]||{},graph=globalThis.ReportDependency.buildGraph({calcType:calc.calcType||data.project&&data.project.type||"",paramKeys:Object.keys(data.calcParams||calc.params||{}),chapters:data.chapters||[]});context.lineage={schemaVersion:graph.schemaVersion,parameters:graph.parameters||[],metrics:graph.metrics||[],sections:graph.sections||[],edges:graph.edges||[]};context.summary.lineageEdges=context.lineage.edges.length;}
  context.lifecycle={...context.lifecycle,version:workStage.version,legacyConflict:workStage.legacyConflict,source:workStage.source};context.snapshotLimits={facts:500,metrics:300,artifacts:200};return context;
}

export async function onRequestGet(context){
  try{return await brainGet(context);}catch(error){return json({ok:false,error:'项目资料读取失败，请重试；未将读取失败当作空数据'},503);}
}
async function brainGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);
  await ensure(env);const url=new URL(context.request.url),projectId=projectIdOf(url.searchParams.get("projectId"));if(!projectId)return json({ok:false,error:"项目ID不合法"},400);
  const access=await resolveProjectAccess(env,user.userId,projectId);if(!access)return json({ok:false,error:"项目不存在或无权访问"},404);
  const out=await loadContext(env,{...user,userId:access.ownerUserId,actorUserId:user.userId},access.row);if(!await resolveProjectAccess(env,user.userId,projectId))return json({ok:false,error:"项目访问权限已撤销"},404);
  return json({ok:true,context:out,role:access.role,permissions:{...access.permissions,approve:false}});
}

export async function onRequestPost(context){
  try{return await brainPost(context);}catch(error){return json({ok:false,error:error.status?error.message:"项目保存失败，数据未提交，请稍后重试"},error.status||503);}
}
async function brainPost(context){
  const env=adaptEnv(context.env),request=context.request,actor=await verifyAuth(request,env);if(!actor)return json({ok:false,error:"未登录或登录已过期"},401);
  await ensure(env);let body={};try{body=await request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}const action=clean(body.action,50),projectId=projectIdOf(body.projectId);
  if(!projectId)return json({ok:false,error:"项目ID不合法"},400);
  if(action==='setStage'||action==='updateWorkStage')return json(await updateWorkStage(env,actor,{...body,projectId}));
  return withProjectMutation(env,actor,projectId,action==='previewChange'?'view':action==='saveFactRequirements'?'manage':'edit',async(tx,access)=>brainMutate(tx,{...actor,userId:access.ownerUserId,actorUserId:actor.userId},access.row,body,action,projectId));
}
async function brainMutate(env,user,row,body,action,projectId){
  const now=Date.now();
  if(action==="upsertFact"){
    const f=Core.normalizeFact(body.fact||body),factKey=clean(f.factKey,120),key=f.scopeId?factKey+'::scope:'+f.scopeId:factKey;if(!factKey)return json({ok:false,error:"事实键不能为空"},400);
    if(f.status==='not_applicable'&&!f.naReason)throw lifecycleError(400,'标为不适用必须说明原因');
    if(f.status==='confirmed'&&(f.value==null||f.value===''))throw lifecycleError(400,'空事实不能标为已确认');
    const old=await env.DB.prepare("SELECT MAX(version) AS n FROM project_facts WHERE project_id=? AND user_id=? AND fact_key=?").bind(projectId,user.userId,key).first(),version=Number(old&&old.n||0)+1,id=uid("fact");
    await env.DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,label,value_json,unit,source_type,source_ref,confidence,status,valid_from,valid_to,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.userId,f.factType,key,clean(f.label,160),JSON.stringify(f.value),clean(f.unit,30),clean(f.sourceType,40),clean(f.sourceRef,300),f.confidence,f.status,clean(f.validFrom,30),clean(f.validTo,30),version,clean(user.username||user.userId,80),now,now).run();
    await env.DB.prepare('INSERT INTO project_fact_details(fact_id,project_id,meta_json) VALUES(?,?,?)').bind(id,projectId,JSON.stringify({originalFactKey:factKey,scopeId:f.scopeId,asOf:f.asOf,sourceLocator:f.sourceLocator,basis:f.basis,naReason:f.naReason,conflictValues:f.conflictValues,confirmedBy:f.status==='confirmed'?String(user.actorUserId):'',confirmedAt:f.status==='confirmed'?now:0})).run();
    await insertEvent(env,user,projectId,"fact.updated",{factId:id,factKey:key,version,status:f.status});return json({ok:true,id,version});
  }
  if(action==="upsertMetric"){
    const m=body.metric||body,key=clean(m.metricKey||m.key,120);if(!key)return json({ok:false,error:"指标键不能为空"},400);const old=await env.DB.prepare("SELECT MAX(version) AS n FROM project_metrics WHERE project_id=? AND user_id=? AND metric_key=?").bind(projectId,user.userId,key).first(),version=Number(old&&old.n||0)+1,id=uid("metric");
    if(m.calcSnapshotId)throw lifecycleError(400,'手工指标不能冒充测算快照，请在参数与测算页面采用后台测算结果');
    await env.DB.prepare("INSERT INTO project_metrics(id,project_id,user_id,metric_key,label,value_json,unit,calc_snapshot_id,lineage_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.userId,key,clean(m.label||key,160),JSON.stringify(m.value==null?null:m.value),clean(m.unit,30),'',JSON.stringify({source:'manual',trust:'unverified',actorUserId:user.actorUserId}),version,now,now).run();
    await insertEvent(env,user,projectId,"metric.updated",{metricId:id,metricKey:key,version});return json({ok:true,id,version});
  }
  if(action==="registerArtifact"){
    const a=body.artifact||body,type=clean(a.artifactType||a.type,50);if(!type)return json({ok:false,error:"成果类型不能为空"},400);const id=clean(a.id,100)||uid("artifact");
    if(['signed','approved','published','frozen'].includes(a.status))throw lifecycleError(403,'手工登记不能创建正式签发或批准成果，请使用成果复核发布流程');
    const meta={...(a.meta||{})};if(meta.confirmed===true){meta.confirmedBy=user.actorUserId||user.userId;meta.confirmedAt=now;}
    if(type==='evidence'&&a.status==='ready'&&(!clean(a.title)||!clean(a.version)||!clean(meta.content)||!clean(meta.sourceRef)||!clean(meta.sourceLocator)||meta.confirmed!==true))throw lifecycleError(400,'就绪证据必须填写正文、标题、版本、来源及定位，并由当前成员确认');
    await env.DB.prepare("INSERT INTO project_artifacts(id,project_id,user_id,artifact_type,title,module_ref,version,status,evidence_audit_id,meta_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.userId,type,clean(a.title,200),clean(a.moduleRef,240),clean(a.version,40),clean(a.status||"draft",30),clean(a.evidenceAuditId,120),JSON.stringify(meta),now,now).run();
    await insertEvent(env,user,projectId,"artifact.registered",{artifactId:id,artifactType:type});return json({ok:true,id});
  }
  if(action==="createDecision"){
    const d=body.decision||body,topic=clean(d.topic,240);if(!topic)return json({ok:false,error:"决策议题不能为空"},400);const stage=Core.stage(d.stageKey).key,id=uid("decision"),status=["candidate","reviewing","adopted","rejected","closed"].includes(d.status)?d.status:"candidate";
    if(!['candidate','reviewing'].includes(status))throw lifecycleError(403,'正式决策处理需要独立审批职责，当前仅可编制或送审候选');
    for(const evidenceId of Array.isArray(d.evidenceIds)?d.evidenceIds:[])await assertProjectObject(env,'project_artifacts',clean(evidenceId,100),projectId,{ownerUserId:user.userId});
    for(const scenarioId of Array.isArray(d.scenarioIds)?d.scenarioIds:[]){const scenario=await assertProjectObject(env,'project_scenarios',clean(scenarioId,100),projectId);if(scenario.status!=='selected')throw lifecycleError(400,'共享决策只能引用本项目已采用方案');}
    await env.DB.prepare("INSERT INTO project_decisions(id,project_id,user_id,stage_key,topic,options_json,decision_text,evidence_ids_json,scenario_ids_json,owner,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.userId,stage,topic,JSON.stringify(Array.isArray(d.options)?d.options:[]),clean(d.decision,2000),JSON.stringify(Array.isArray(d.evidenceIds)?d.evidenceIds:[]),JSON.stringify(Array.isArray(d.scenarioIds)?d.scenarioIds:[]),clean(d.owner,100),status,clean(user.username||user.userId,80),now,now).run();
    await insertEvent(env,user,projectId,"decision.created",{decisionId:id,topic,status});return json({ok:true,id,status});
  }
  if(action==="updateDecision"){
    const id=clean(body.id,100),status=["candidate","reviewing","adopted","rejected","closed"].includes(body.status)?body.status:"";if(!id||!status)return json({ok:false,error:"决策ID或状态无效"},400);
    const old=await assertProjectObject(env,'project_decisions',id,projectId,{ownerUserId:user.userId});if(!['candidate','reviewing'].includes(status)||!['candidate','reviewing'].includes(old.status))throw lifecycleError(403,'正式决策处理或覆盖历史结论需要独立审批职责');
    await env.DB.prepare("UPDATE project_decisions SET status=?,decision_text=?,updated_at=? WHERE id=? AND project_id=? AND user_id=?").bind(status,clean(body.decision,2000),now,id,projectId,user.userId).run();await insertEvent(env,user,projectId,"decision.status",{decisionId:id,status});return json({ok:true,id,status});
  }
  if(action==="previewChange"||action==="saveChangeSet"){
    const data=parse(row.data,{}),before=body.before||{},after=body.after||{},changedKeys=Array.isArray(body.changedKeys)?body.changedKeys:[],calcType=clean(body.calcType||((data.workflow&&data.workflow.calcSnapshots||[]).slice(-1)[0]||{}).calcType,30),graph=globalThis.ReportDependency?globalThis.ReportDependency.buildGraph({calcType,paramKeys:[...new Set(changedKeys.concat(Object.keys(before),Object.keys(after)))],chapters:data.chapters||[]}):null,impact=Core.previewChange({before,after,changedKeys,dependencyGraph:graph});
    if(action==="previewChange")return json({ok:true,impact});if(body.approvalStatus&&body.approvalStatus!=='preview')throw lifecycleError(403,'变更预演不是批准，正式变更需独立授权');const id=uid("change");await env.DB.prepare("INSERT INTO project_change_sets(id,project_id,user_id,title,before_json,after_json,impact_json,approval_status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.actorUserId,clean(body.title||"项目参数变更",200),JSON.stringify(before),JSON.stringify(after),JSON.stringify(impact),'preview',clean(user.username||user.userId,80),now,now).run();await insertEvent(env,user,projectId,"change.preview.saved",{changeSetId:id,changedKeys:impact.changedKeys});return json({ok:true,id,impact});
  }
  if(action==='saveFactRequirements'){
    const requirements=body.requirements;if(!Array.isArray(requirements)||requirements.length>100||requirements.some(x=>!x||!clean(x.factKey,120)||!['required','conditional','optional'].includes(x.requirement||'required')))throw lifecycleError(400,'资料清单最多100项，每项需填写事实键与要求类型');
    if(!Number.isSafeInteger(body.expectedUpdatedAt)||body.expectedUpdatedAt!==Number(row.updated_at))throw lifecycleError(409,'项目已变化，请刷新后再保存资料清单');
    const data=parse(row.data),workflow=data.workflow||(data.workflow={});workflow.factRequirements=requirements.map(x=>({factKey:clean(x.factKey,120),label:clean(x.label,160),scopeId:clean(x.scopeId,100),requirement:x.requirement||'required',...(x.requirement==='conditional'?{conditionMet:typeof x.conditionMet==='boolean'?x.conditionMet:null}:{})}));
    await env.DB.prepare('UPDATE projects SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(data),Math.max(now,Number(row.updated_at)+1),projectId).run();await insertEvent(env,user,projectId,'project.fact_requirements.updated',{requirements:workflow.factRequirements});return json({ok:true,requirements:workflow.factRequirements,updatedAt:Math.max(now,Number(row.updated_at)+1)});
  }
  return json({ok:false,error:"不支持的Project Brain操作"},400);
}
