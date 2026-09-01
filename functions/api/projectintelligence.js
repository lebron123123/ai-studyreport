// /api/projectintelligence —— Project Intelligence Read Model V1 与真实项目进度底座。
import "../../project-intelligence.js";
import "../../project-brain.js";
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const PI=globalThis.ProjectIntelligence,Brain=globalThis.ProjectBrain;
const piText=(v,n=240)=>String(v==null?"":v).trim().slice(0,n);
const piParse=(v,f={})=>{try{return typeof v==="string"?JSON.parse(v):v==null?f:v;}catch(_){return f;}};
const piId=p=>p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9);
const PI_TABLES=[
  "CREATE TABLE IF NOT EXISTS project_profiles (project_id TEXT PRIMARY KEY,owner_user_id INTEGER NOT NULL,organization_id TEXT DEFAULT '',department_id TEXT DEFAULT '',visibility TEXT NOT NULL DEFAULT 'private',confidentiality_level TEXT NOT NULL DEFAULT 'internal',lifecycle_stage TEXT NOT NULL DEFAULT 'discovery',current_gate_id TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS project_memberships (project_id TEXT NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'VIEWER',status TEXT NOT NULL DEFAULT 'active',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(project_id,user_id))",
  "CREATE INDEX IF NOT EXISTS idx_project_memberships_user ON project_memberships(user_id,status,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_gates (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',planned_date TEXT DEFAULT '',actual_date TEXT DEFAULT '',owner TEXT DEFAULT '',criteria_json TEXT NOT NULL DEFAULT '[]',block_reason TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_gates_project ON project_gates(project_id,sort_order,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_milestones (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',gate_id TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',planned_date TEXT DEFAULT '',forecast_date TEXT DEFAULT '',actual_date TEXT DEFAULT '',owner TEXT DEFAULT '',progress REAL NOT NULL DEFAULT 0,weight REAL NOT NULL DEFAULT 1,risk_level TEXT DEFAULT 'normal',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id,sort_order,updated_at)",
  "CREATE TABLE IF NOT EXISTS project_deliverables (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',gate_id TEXT DEFAULT '',milestone_id TEXT DEFAULT '',artifact_id TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',required INTEGER NOT NULL DEFAULT 1,owner TEXT DEFAULT '',due_date TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_project_deliverables_project ON project_deliverables(project_id,sort_order,updated_at)"
];
async function piEnsure(env){for(const sql of PI_TABLES)await env.DB.prepare(sql).run();}
function piProjectId(v){const id=piText(v,100);return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";}
async function piProject(env,id){return env.DB.prepare("SELECT id,name,data,updated_at,user_id FROM projects WHERE id=?").bind(id).first();}
async function piAccess(env,user,row){
  if(!row)return null;if(Number(row.user_id)===Number(user.userId))return {projectId:row.id,userId:user.userId,role:"OWNER",status:"active"};
  const x=await env.DB.prepare("SELECT project_id,user_id,role,status FROM project_memberships WHERE project_id=? AND user_id=? AND status='active'").bind(row.id,user.userId).first();return x?PI.normalizeMembership(x):null;
}
async function piBootstrapOwner(env,row){
  const now=Date.now(),data=piParse(row.data,{}),stage=Brain.legacyStage(data);
  await env.DB.prepare("INSERT INTO project_profiles(project_id,owner_user_id,organization_id,department_id,visibility,confidentiality_level,lifecycle_stage,current_gate_id,created_at,updated_at) VALUES(?,?, '', '', 'private','internal',?,'',?,?) ON CONFLICT(project_id) DO NOTHING").bind(row.id,row.user_id,stage,now,now).run();
  await env.DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'OWNER','active',?,?) ON CONFLICT(project_id,user_id) DO NOTHING").bind(row.id,row.user_id,now,now).run();
}
async function piAll(env,sql,...args){try{return ((await env.DB.prepare(sql).bind(...args).all()).results||[]);}catch(_){return [];}}
function piLatest(rows,key){const seen=new Set();return rows.filter(x=>{const k=x[key];if(seen.has(k))return false;seen.add(k);return true;});}
async function piBrain(env,row){
  const id=row.id,userId=row.user_id,data=piParse(row.data,{}),sets=await Promise.all([
    piAll(env,"SELECT * FROM project_facts WHERE project_id=? AND user_id=? ORDER BY fact_key,version DESC LIMIT 500",id,userId),
    piAll(env,"SELECT * FROM project_metrics WHERE project_id=? AND user_id=? ORDER BY metric_key,version DESC LIMIT 300",id,userId),
    piAll(env,"SELECT * FROM project_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 200",id,userId),
    piAll(env,"SELECT * FROM project_decisions WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100",id,userId),
    piAll(env,"SELECT * FROM project_change_sets WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 60",id,userId)
  ]);
  return Brain.buildContext({projectId:id,name:row.name,data,updatedAt:row.updated_at,
    facts:piLatest(sets[0],"fact_key").map(x=>({id:x.id,factType:x.fact_type,factKey:x.fact_key,label:x.label,value:piParse(x.value_json,null),unit:x.unit,sourceType:x.source_type,sourceRef:x.source_ref,confidence:x.confidence,status:x.status,version:x.version})),
    metrics:piLatest(sets[1],"metric_key").map(x=>({id:x.id,metricKey:x.metric_key,label:x.label,value:piParse(x.value_json,null),unit:x.unit,calcSnapshotId:x.calc_snapshot_id,lineage:piParse(x.lineage_json,{}),version:x.version})),
    artifacts:sets[2].map(x=>({id:x.id,artifactType:x.artifact_type,title:x.title,moduleRef:x.module_ref,version:x.version,status:x.status,meta:piParse(x.meta_json,{})})),
    decisions:sets[3].map(x=>({id:x.id,stageKey:x.stage_key,topic:x.topic,decision:x.decision_text,owner:x.owner,status:x.status,updatedAt:Number(x.updated_at)})),
    changes:sets[4].map(x=>({id:x.id,title:x.title,before:piParse(x.before_json,{}),after:piParse(x.after_json,{}),impact:piParse(x.impact_json,{}),approvalStatus:x.approval_status,updatedAt:Number(x.updated_at)}))});
}
async function piLoad(env,user,row,membership){
  const [profileRow,members,gates,milestones,deliverables,tasks,risks,scenarios]=await Promise.all([
    env.DB.prepare("SELECT * FROM project_profiles WHERE project_id=?").bind(row.id).first(),
    piAll(env,"SELECT project_id,user_id,role,status FROM project_memberships WHERE project_id=? AND status='active' ORDER BY role,user_id",row.id),
    piAll(env,"SELECT * FROM project_gates WHERE project_id=? ORDER BY sort_order,updated_at",row.id),
    piAll(env,"SELECT * FROM project_milestones WHERE project_id=? ORDER BY sort_order,updated_at",row.id),
    piAll(env,"SELECT * FROM project_deliverables WHERE project_id=? ORDER BY sort_order,updated_at",row.id),
    piAll(env,"SELECT * FROM project_tasks WHERE project_id=? AND status='open' ORDER BY updated_at DESC LIMIT 100",row.id),
    piAll(env,"SELECT * FROM project_risks WHERE project_id=? AND status='open' ORDER BY updated_at DESC LIMIT 100",row.id),
    piAll(env,"SELECT * FROM project_scenarios WHERE project_id=? ORDER BY updated_at DESC LIMIT 30",row.id)
  ]),data=piParse(row.data,{}),brain=await piBrain(env,row),profile=PI.normalizeProfile(profileRow||{projectId:row.id,ownerUserId:row.user_id,lifecycleStage:Brain.legacyStage(data)}),summary=data.calcSummary||{},kpis={totalInvestment:summary.totalInvestment??summary.totalInvest??null,irr:summary.irr??summary.projectIrr??null};
  return PI.buildReadModel({project:{id:row.id,name:row.name,type:data.project&&data.project.type,location:data.project&&data.project.location,owner:data.project&&data.project.owner},profile,membership,memberships:members,gates:gates.map(x=>({...x,criteria:piParse(x.criteria_json,[])})),milestones,deliverables,brain,ops:{tasks:tasks.map(x=>({id:x.id,title:x.title,owner:x.owner,dueDate:x.due_date,status:x.status})),risks:risks.map(x=>({id:x.id,title:x.title,level:x.risk_level,status:x.status})),scenarios:scenarios.map(x=>({id:x.id,name:x.name,status:x.status,metrics:piParse(x.metrics_json,{})}))},kpis,currentPage:"project-overview"});
}
async function piOwnedModel(env,user,projectId){const row=await piProject(env,projectId);if(!row)return {error:"项目不存在",status:404};await piBootstrapOwner(env,row);const membership=await piAccess(env,user,row);if(!membership)return {error:"项目不存在或无权访问",status:404};return {row,membership,model:await piLoad(env,user,row,membership)};}
async function piEvent(env,user,projectId,type,payload){try{await env.DB.prepare("INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(piId("event"),projectId,user.userId,type,piText(user.username||user.userId,80),JSON.stringify(payload||{}),Date.now()).run();}catch(_){}}

export async function onRequestGet(c){const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await piEnsure(env);const projectId=piProjectId(new URL(c.request.url).searchParams.get("projectId"));if(!projectId)return json({ok:false,error:"项目ID不合法"},400);const x=await piOwnedModel(env,user,projectId);if(x.error)return json({ok:false,error:x.error},x.status);return json({ok:true,readModel:x.model});}

export async function onRequestPost(c){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await piEnsure(env);let b={};try{b=await c.request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}const projectId=piProjectId(b.projectId),x=await piOwnedModel(env,user,projectId);if(x.error)return json({ok:false,error:x.error},x.status);const role=x.membership.role,manage=role==="OWNER",edit=manage||role==="EDITOR",action=piText(b.action,50),now=Date.now();
  if(action==="updateProfile"){
    if(!manage)return json({ok:false,error:"仅项目负责人可修改项目数据边界"},403);const p=PI.normalizeProfile({...b.profile,projectId,ownerUserId:x.row.user_id});await env.DB.prepare("UPDATE project_profiles SET organization_id=?,department_id=?,visibility=?,confidentiality_level=?,lifecycle_stage=?,current_gate_id=?,updated_at=? WHERE project_id=?").bind(p.organizationId,p.departmentId,p.visibility,p.confidentialityLevel,p.lifecycleStage,p.currentGateId,now,projectId).run();await piEvent(env,user,projectId,"project.profile.updated",p);return json({ok:true,readModel:(await piOwnedModel(env,user,projectId)).model});
  }
  if(action==="addMember"){
    if(!manage)return json({ok:false,error:"仅项目负责人可管理成员"},403);const m=PI.normalizeMembership({...b.member,projectId});if(!m.userId)return json({ok:false,error:"成员用户ID不能为空"},400);await env.DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,'active',?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at").bind(projectId,m.userId,m.role,now,now).run();await piEvent(env,user,projectId,"project.member.updated",m);return json({ok:true});
  }
  if(!edit)return json({ok:false,error:"当前角色没有编辑项目进度的权限"},403);
  if(action==="saveGate"){
    const g=PI.normalizeGate({...b.gate,id:b.gate&&b.gate.id||piId("gate")});await env.DB.prepare("INSERT INTO project_gates(id,project_id,name,stage_key,status,planned_date,actual_date,owner,criteria_json,block_reason,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,status=excluded.status,planned_date=excluded.planned_date,actual_date=excluded.actual_date,owner=excluded.owner,criteria_json=excluded.criteria_json,block_reason=excluded.block_reason,sort_order=excluded.sort_order,updated_at=excluded.updated_at").bind(g.id,projectId,g.name,g.stageKey,g.status,g.plannedDate,g.actualDate,g.owner,JSON.stringify(g.criteria),g.blockReason,g.sortOrder,now,now).run();await piEvent(env,user,projectId,"project.gate.updated",g);return json({ok:true,id:g.id});
  }
  if(action==="saveMilestone"){
    const m=PI.normalizeMilestone({...b.milestone,id:b.milestone&&b.milestone.id||piId("milestone")});await env.DB.prepare("INSERT INTO project_milestones(id,project_id,name,stage_key,gate_id,status,planned_date,forecast_date,actual_date,owner,progress,weight,risk_level,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,gate_id=excluded.gate_id,status=excluded.status,planned_date=excluded.planned_date,forecast_date=excluded.forecast_date,actual_date=excluded.actual_date,owner=excluded.owner,progress=excluded.progress,weight=excluded.weight,risk_level=excluded.risk_level,sort_order=excluded.sort_order,updated_at=excluded.updated_at").bind(m.id,projectId,m.name,m.stageKey,m.gateId,m.status,m.plannedDate,m.forecastDate,m.actualDate,m.owner,m.progress,m.weight,m.riskLevel,m.sortOrder,now,now).run();await piEvent(env,user,projectId,"project.milestone.updated",m);return json({ok:true,id:m.id});
  }
  if(action==="saveDeliverable"){
    const d=PI.normalizeDeliverable({...b.deliverable,id:b.deliverable&&b.deliverable.id||piId("deliverable")});await env.DB.prepare("INSERT INTO project_deliverables(id,project_id,name,stage_key,gate_id,milestone_id,artifact_id,status,required,owner,due_date,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,gate_id=excluded.gate_id,milestone_id=excluded.milestone_id,artifact_id=excluded.artifact_id,status=excluded.status,required=excluded.required,owner=excluded.owner,due_date=excluded.due_date,sort_order=excluded.sort_order,updated_at=excluded.updated_at").bind(d.id,projectId,d.name,d.stageKey,d.gateId,d.milestoneId,d.artifactId,d.status,d.required?1:0,d.owner,d.dueDate,d.sortOrder,now,now).run();await piEvent(env,user,projectId,"project.deliverable.updated",d);return json({ok:true,id:d.id});
  }
  return json({ok:false,error:"不支持的Project Intelligence操作"},400);
}
