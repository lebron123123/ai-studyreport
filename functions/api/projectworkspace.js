// /api/projectworkspace —— Investment OS Phase 2.5 企业级项目工作区聚合与治理。
import "../../project-enterprise.js";
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const Enterprise=globalThis.ProjectEnterprise;
const clean=(v,n=240)=>String(v==null?"":v).trim().slice(0,n);
const parse=(v,f={})=>{try{return typeof v==="string"?JSON.parse(v):v==null?f:v;}catch(_){return f;}};
const id=p=>p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
const projectIdOf=v=>{const x=clean(v,100);return /^[A-Za-z0-9_-]{8,100}$/.test(x)?x:"";};
const TABLES=[
  "CREATE TABLE IF NOT EXISTS project_profiles (project_id TEXT PRIMARY KEY,owner_user_id INTEGER NOT NULL,organization_id TEXT DEFAULT '',department_id TEXT DEFAULT '',visibility TEXT NOT NULL DEFAULT 'private',confidentiality_level TEXT NOT NULL DEFAULT 'internal',lifecycle_stage TEXT NOT NULL DEFAULT 'discovery',current_gate_id TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS project_memberships (project_id TEXT NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'VIEWER',status TEXT NOT NULL DEFAULT 'active',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(project_id,user_id))",
  "CREATE TABLE IF NOT EXISTS project_files (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_user_id INTEGER NOT NULL,file_name TEXT NOT NULL,file_type TEXT DEFAULT '',category TEXT DEFAULT 'other',storage_ref TEXT DEFAULT '',fingerprint TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'registered',parse_status TEXT DEFAULT 'pending',is_current INTEGER NOT NULL DEFAULT 1,parent_file_id TEXT DEFAULT '',size_bytes BIGINT NOT NULL DEFAULT 0,meta_json TEXT NOT NULL DEFAULT '{}',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id,is_current,updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS project_file_extractions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,file_id TEXT NOT NULL,extraction_type TEXT NOT NULL DEFAULT 'fact',item_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',source_location TEXT DEFAULT '',confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,review_status TEXT NOT NULL DEFAULT 'candidate',target_ref TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_file_extractions_project ON project_file_extractions(project_id,file_id,review_status,updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS project_data_issues (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,item_kind TEXT NOT NULL,item_key TEXT NOT NULL,issue_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'medium',description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'open',resolution TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_data_issues_project ON project_data_issues(project_id,status,severity,updated_at DESC)"
];
async function ensure(env){for(const sql of TABLES)await env.DB.prepare(sql).run();}
async function all(env,sql,...args){try{return (await env.DB.prepare(sql).bind(...args).all()).results||[];}catch(_){return [];}}
async function one(env,sql,...args){try{return await env.DB.prepare(sql).bind(...args).first();}catch(_){return null;}}
async function event(env,user,projectId,type,payload){try{await env.DB.prepare("INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(id("event"),projectId,user.userId,clean(type,80),clean(user.username||user.userId,80),JSON.stringify(payload||{}),Date.now()).run();}catch(_){}}
async function access(env,user,projectId){
  const row=await one(env,"SELECT id,name,data,updated_at,user_id FROM projects WHERE id=?",projectId);if(!row)return null;
  let profile=await one(env,"SELECT * FROM project_profiles WHERE project_id=?",projectId),member=await one(env,"SELECT * FROM project_memberships WHERE project_id=? AND user_id=? AND status='active'",projectId,user.userId),now=Date.now();
  if(!profile&&Number(row.user_id)===Number(user.userId)){await env.DB.prepare("INSERT INTO project_profiles(project_id,owner_user_id,lifecycle_stage,created_at,updated_at) VALUES(?,?,?,?,?)").bind(projectId,row.user_id,"discovery",now,now).run();profile={project_id:projectId,owner_user_id:row.user_id,organization_id:"",department_id:"",visibility:"private",confidentiality_level:"internal",lifecycle_stage:"discovery"};}
  if(!member&&Number(row.user_id)===Number(user.userId)){await env.DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at").bind(projectId,user.userId,"OWNER","active",now,now).run();member={project_id:projectId,user_id:user.userId,role:"OWNER",status:"active"};}
  if(!member)return null;const role=clean(member.role,20).toUpperCase();return {row,profile:profile||{},member,role,ownerUserId:Number((profile&&profile.owner_user_id)||row.user_id),permissions:{view:true,edit:role==="OWNER"||role==="EDITOR",manage:role==="OWNER"}};
}
function factRow(x){return {id:x.id,factType:x.fact_type,factKey:x.fact_key,label:x.label,value:parse(x.value_json,null),unit:x.unit,status:x.status,sourceType:x.source_type,sourceRef:x.source_ref,version:Number(x.version),confidence:Number(x.confidence)};}
function metricRow(x){return {id:x.id,metricKey:x.metric_key,label:x.label,value:parse(x.value_json,null),unit:x.unit,calcSnapshotId:x.calc_snapshot_id,lineage:parse(x.lineage_json,{}),version:Number(x.version)};}
function artifactRow(x){return {id:x.id,artifactType:x.artifact_type,title:x.title,moduleRef:x.module_ref,version:x.version,status:x.status,evidenceAuditId:x.evidence_audit_id,meta:parse(x.meta_json,{})};}
function extractionRow(x){return {id:x.id,fileId:x.file_id,type:x.extraction_type,key:x.item_key,label:x.label,value:parse(x.value_json,null),sourceLocation:x.source_location,confidence:Number(x.confidence),reviewStatus:x.review_status,targetRef:x.target_ref};}
function decisionRow(x){return {id:x.id,stageKey:x.stage_key,topic:x.topic,decision:x.decision_text,evidenceIds:parse(x.evidence_ids_json,[]),scenarioIds:parse(x.scenario_ids_json,[]),owner:x.owner,status:x.status};}
function changeRow(x){return {id:x.id,title:x.title,before:parse(x.before_json,{}),after:parse(x.after_json,{}),impact:parse(x.impact_json,{}),approvalStatus:x.approval_status,decisionId:clean(parse(x.impact_json,{}).decisionId,100)};}
function scenarioRow(x){return {id:x.id,name:x.name,kind:x.kind,calcType:x.calc_type,calcSnapshotId:x.calc_snapshot_id,metrics:parse(x.metrics_json,{}),status:x.status};}
function fileRow(x){return {...x,meta:parse(x.meta_json,{})};}
function context(a){return {project:{id:a.row.id,name:a.row.name,updatedAt:Number(a.row.updated_at),data:parse(a.row.data,{})},profile:{organizationId:a.profile.organization_id||"",departmentId:a.profile.department_id||"",visibility:a.profile.visibility||"private",confidentialityLevel:a.profile.confidentiality_level||"internal",lifecycleStage:a.profile.lifecycle_stage||"discovery"},role:a.role,permissions:a.permissions};}
async function loadView(env,a,view){
  const pid=a.row.id,uid=a.ownerUserId,base={context:context(a),view};
  if(view==="data"){
    const [facts,metrics,artifacts,extractions,issues]=await Promise.all([
      all(env,"SELECT * FROM project_facts WHERE project_id=? AND user_id=? ORDER BY fact_key,version DESC",pid,uid),all(env,"SELECT * FROM project_metrics WHERE project_id=? AND user_id=? ORDER BY metric_key,version DESC",pid,uid),all(env,"SELECT * FROM project_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_file_extractions WHERE project_id=? ORDER BY updated_at DESC",pid),all(env,"SELECT * FROM project_data_issues WHERE project_id=? ORDER BY updated_at DESC",pid)
    ]);const latest=(rows,key)=>{const seen=new Set();return rows.filter(x=>{if(seen.has(x[key]))return false;seen.add(x[key]);return true;});};return {...base,data:Enterprise.buildDataRegistry({facts:latest(facts,"fact_key").map(factRow),metrics:latest(metrics,"metric_key").map(metricRow),artifacts:artifacts.map(artifactRow),extractions:extractions.map(extractionRow),issues})};
  }
  if(view==="files"){
    const [files,extractions]=await Promise.all([all(env,"SELECT * FROM project_files WHERE project_id=? ORDER BY updated_at DESC",pid),all(env,"SELECT * FROM project_file_extractions WHERE project_id=? ORDER BY updated_at DESC",pid)]);return {...base,data:Enterprise.buildFileIntelligence({files:files.map(fileRow),extractions:extractions.map(extractionRow)})};
  }
  if(view==="decisions"){
    const [decisions,changes,scenarios,artifacts]=await Promise.all([all(env,"SELECT * FROM project_decisions WHERE project_id=? AND user_id=? ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_change_sets WHERE project_id=? AND user_id=? ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_scenarios WHERE project_id=? AND user_id=? ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC",pid,uid)]);return {...base,data:{chains:Enterprise.buildImpactChains({decisions:decisions.map(decisionRow),changes:changes.map(changeRow),scenarios:scenarios.map(scenarioRow),artifacts:artifacts.map(artifactRow)}),summary:{decisions:decisions.length,changes:changes.length,scenarios:scenarios.length}}};
  }
  if(view==="spatial"){
    const [scope,observations,pois,odFlows,snapshots]=await Promise.all([one(env,"SELECT * FROM project_analysis_scopes WHERE project_id=? AND user_id=?",pid,uid),all(env,"SELECT * FROM analysis_observations WHERE project_id=? AND user_id=? AND review_status='approved' ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_pois WHERE project_id=? AND user_id=? AND review_status='approved' ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_od_flows WHERE project_id=? AND user_id=? AND review_status='approved' ORDER BY updated_at DESC",pid,uid),all(env,"SELECT * FROM project_analysis_snapshots WHERE project_id=? AND user_id=? ORDER BY version DESC",pid,uid)]);return {...base,data:Enterprise.buildSpatialWorkspace({scope,observations,pois,odFlows,snapshots})};
  }
  if(view==="members"){
    const members=await all(env,"SELECT project_id,user_id,role,status,created_at,updated_at FROM project_memberships WHERE project_id=? ORDER BY role,user_id",pid);return {...base,data:{members:members.map(x=>({userId:Number(x.user_id),role:x.role,status:x.status,createdAt:Number(x.created_at),updatedAt:Number(x.updated_at)})),profile:base.context.profile,permissions:a.permissions}};
  }
  return {...base,data:{}};
}
export async function onRequestGet(contextArg){
  const env=adaptEnv(contextArg.env),user=await verifyAuth(contextArg.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await ensure(env);const url=new URL(contextArg.request.url),projectId=projectIdOf(url.searchParams.get("projectId")),view=clean(url.searchParams.get("view")||"data",20);if(!projectId)return json({ok:false,error:"项目ID不合法"},400);if(!["data","files","decisions","spatial","members"].includes(view))return json({ok:false,error:"工作区视图无效"},400);const a=await access(env,user,projectId);if(!a)return json({ok:false,error:"项目不存在或无权访问"},404);return json({ok:true,...await loadView(env,a,view)});
}
export async function onRequestPost(contextArg){
  const env=adaptEnv(contextArg.env),request=contextArg.request,user=await verifyAuth(request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await ensure(env);let b={};try{b=await request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}const projectId=projectIdOf(b.projectId),action=clean(b.action,40);if(!projectId)return json({ok:false,error:"项目ID不合法"},400);const a=await access(env,user,projectId);if(!a)return json({ok:false,error:"项目不存在或无权访问"},404);const now=Date.now();
  if(action==="registerFile"){
    if(!a.permissions.edit)return json({ok:false,error:"当前角色无权登记文件"},403);const f=Enterprise.normalizeFile({...b.file,projectId}),name=clean(f.name,220);if(!name)return json({ok:false,error:"文件名不能为空"},400);const old=await one(env,"SELECT id,version FROM project_files WHERE project_id=? AND LOWER(file_name)=LOWER(?) AND is_current=1 ORDER BY version DESC",projectId,name),version=Number(old&&old.version||0)+1,fileId=id("pfile");if(old)await env.DB.prepare("UPDATE project_files SET is_current=0,status='superseded',updated_at=? WHERE project_id=? AND LOWER(file_name)=LOWER(?) AND is_current=1").bind(now,projectId,name).run();await env.DB.prepare("INSERT INTO project_files(id,project_id,owner_user_id,file_name,file_type,category,storage_ref,fingerprint,version,status,parse_status,is_current,parent_file_id,size_bytes,meta_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(fileId,projectId,a.ownerUserId,name,f.fileType,f.category,f.storageRef,f.fingerprint,version,"registered","pending",1,old&&old.id||"",f.sizeBytes,JSON.stringify(f.meta||{}),clean(user.username||user.userId,80),now,now).run();await event(env,user,projectId,"project.file.registered",{fileId,name,version,parentFileId:old&&old.id||""});return json({ok:true,fileId,version});
  }
  if(action==="saveExtraction"){
    if(!a.permissions.edit)return json({ok:false,error:"当前角色无权保存解析结果"},403);const x=Enterprise.normalizeExtraction(b.extraction||{}),file=await one(env,"SELECT id FROM project_files WHERE id=? AND project_id=?",x.fileId,projectId);if(!file||!x.key)return json({ok:false,error:"文件或字段键无效"},400);const extractionId=id("extract");await env.DB.prepare("INSERT INTO project_file_extractions(id,project_id,file_id,extraction_type,item_key,label,value_json,source_location,confidence,review_status,target_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(extractionId,projectId,x.fileId,x.type,x.key,x.label,JSON.stringify(x.value),x.sourceLocation,x.confidence,"candidate",x.targetRef,now,now).run();await env.DB.prepare("UPDATE project_files SET status='needs_review',parse_status='parsed',updated_at=? WHERE id=? AND project_id=?").bind(now,x.fileId,projectId).run();await event(env,user,projectId,"project.file.extracted",{extractionId,fileId:x.fileId,key:x.key,type:x.type});return json({ok:true,extractionId,status:"candidate"});
  }
  if(action==="reviewExtraction"){
    if(!a.permissions.manage)return json({ok:false,error:"仅项目OWNER可审核解析结果"},403);const extractionId=clean(b.id,100),decision=b.decision==="approve"?"approved":b.decision==="reject"?"rejected":"";if(!decision)return json({ok:false,error:"审核决定无效"},400);const x=await one(env,"SELECT * FROM project_file_extractions WHERE id=? AND project_id=?",extractionId,projectId);if(!x)return json({ok:false,error:"解析项不存在"},404);await env.DB.prepare("UPDATE project_file_extractions SET review_status=?,updated_at=? WHERE id=? AND project_id=?").bind(decision,now,extractionId,projectId).run();
    if(decision==="approved"){
      const value=parse(x.value_json,null),source="file:"+x.file_id+"#"+x.source_location;
      if(x.extraction_type==="metric"){
        const old=await one(env,"SELECT MAX(version) AS n FROM project_metrics WHERE project_id=? AND user_id=? AND metric_key=?",projectId,a.ownerUserId,x.item_key),version=Number(old&&old.n||0)+1;await env.DB.prepare("INSERT INTO project_metrics(id,project_id,user_id,metric_key,label,value_json,unit,calc_snapshot_id,lineage_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id("metric"),projectId,a.ownerUserId,x.item_key,x.label,JSON.stringify(value),"","",JSON.stringify({sourceFileId:x.file_id,sourceLocation:x.source_location,extractionId}),version,now,now).run();
      }else{
        const old=await one(env,"SELECT MAX(version) AS n FROM project_facts WHERE project_id=? AND user_id=? AND fact_key=?",projectId,a.ownerUserId,x.item_key),version=Number(old&&old.n||0)+1;await env.DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,label,value_json,unit,source_type,source_ref,confidence,status,valid_from,valid_to,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id("fact"),projectId,a.ownerUserId,x.extraction_type==="parameter"?"ASSUMPTION":"FACT",x.item_key,x.label,JSON.stringify(value),"","file",source,Number(x.confidence),"confirmed","","",version,clean(user.username||user.userId,80),now,now).run();
      }
    }
    await event(env,user,projectId,"project.file.extraction.reviewed",{extractionId,decision});return json({ok:true,status:decision});
  }
  if(action==="saveDataIssue"){
    if(!a.permissions.edit)return json({ok:false,error:"当前角色无权登记数据问题"},403);const issue=b.issue||{},kind=clean(issue.kind||issue.itemKind,30),key=clean(issue.key||issue.itemKey,160),type=clean(issue.type||issue.issueType,40);if(!kind||!key||!type)return json({ok:false,error:"数据问题字段不完整"},400);const issueId=id("issue");await env.DB.prepare("INSERT INTO project_data_issues(id,project_id,item_kind,item_key,issue_type,severity,description,status,resolution,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(issueId,projectId,kind,key,type,clean(issue.severity||"medium",20),clean(issue.description,800),"open","",now,now).run();await event(env,user,projectId,"project.data.issue.created",{issueId,kind,key,type});return json({ok:true,issueId});
  }
  if(action==="resolveDataIssue"){
    if(!a.permissions.edit)return json({ok:false,error:"当前角色无权处理数据问题"},403);const issueId=clean(b.id,100);await env.DB.prepare("UPDATE project_data_issues SET status='resolved',resolution=?,updated_at=? WHERE id=? AND project_id=?").bind(clean(b.resolution,800),now,issueId,projectId).run();await event(env,user,projectId,"project.data.issue.resolved",{issueId});return json({ok:true,status:"resolved"});
  }
  if(action==="updateMember"){
    if(!a.permissions.manage)return json({ok:false,error:"仅项目OWNER可管理成员"},403);const target=Number(b.userId),role=clean(b.role,20).toUpperCase();if(!Number.isInteger(target)||target<=0||!["OWNER","EDITOR","VIEWER"].includes(role))return json({ok:false,error:"成员或角色无效"},400);await env.DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at").bind(projectId,target,role,"active",now,now).run();await event(env,user,projectId,"project.member.updated",{userId:target,role});return json({ok:true,userId:target,role});
  }
  if(action==="removeMember"){
    if(!a.permissions.manage)return json({ok:false,error:"仅项目OWNER可管理成员"},403);const target=Number(b.userId);if(target===a.ownerUserId)return json({ok:false,error:"不能移除项目OWNER"},400);await env.DB.prepare("UPDATE project_memberships SET status='inactive',updated_at=? WHERE project_id=? AND user_id=?").bind(now,projectId,target).run();await event(env,user,projectId,"project.member.removed",{userId:target});return json({ok:true,userId:target});
  }
  if(action==="updateProfile"){
    if(!a.permissions.manage)return json({ok:false,error:"仅项目OWNER可修改项目边界"},403);const p=b.profile||{},visibility=["private","department","organization"].includes(p.visibility)?p.visibility:"private",level=["public","internal","confidential","restricted"].includes(p.confidentialityLevel)?p.confidentialityLevel:"internal";await env.DB.prepare("UPDATE project_profiles SET organization_id=?,department_id=?,visibility=?,confidentiality_level=?,updated_at=? WHERE project_id=?").bind(clean(p.organizationId,100),clean(p.departmentId,100),visibility,level,now,projectId).run();await event(env,user,projectId,"project.profile.updated",{visibility,confidentialityLevel:level});return json({ok:true});
  }
  return json({ok:false,error:"不支持的项目工作区操作"},400);
}
