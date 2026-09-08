// /api/projectintelligence —— Project Intelligence Read Model V1 与真实项目进度底座。
import "../../project-intelligence.js";
import "../../project-brain.js";
import { verifyAuth, json } from "./_auth.js";
import { changeProjectMember } from "./_project-members.js";
import { adaptEnv } from "./_adapters.js";
import { resolveProjectAccess } from "./_project-access.js";
import { ensureLifecycleIntegrity,readWorkStage,updateWorkStage,withProjectMutation,assertProjectObject,lifecycleError,lifecycleEvent } from "./_lifecycle-integrity.js";
import { verifyInvestmentScenario } from "./_investment-ops-service.js";

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
async function piEnsure(env){for(const sql of PI_TABLES)await env.DB.prepare(sql).run();await ensureLifecycleIntegrity(env);}
function piProjectId(v){const id=piText(v,100);return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";}
async function piProject(env,id){return env.DB.prepare("SELECT id,name,data,updated_at,user_id FROM projects WHERE id=?").bind(id).first();}
async function piAccess(env,user,row){
  const access=row&&await resolveProjectAccess(env,user.userId,row.id);return access?{projectId:row.id,userId:user.userId,role:access.role,status:"active"}:null;
}
async function piBootstrapOwner(env,row){
  const now=Date.now(),data=piParse(row.data,{}),explicit=data.workflow?.management?.investmentStage||data.project?.investmentStage,stage=Brain.STAGES.some(x=>x.key===explicit)?explicit:"discovery";
  await env.DB.prepare("INSERT INTO project_profiles(project_id,owner_user_id,organization_id,department_id,visibility,confidentiality_level,lifecycle_stage,current_gate_id,created_at,updated_at) VALUES(?,?, '', '', 'private','internal',?,'',?,?) ON CONFLICT(project_id) DO NOTHING").bind(row.id,row.user_id,stage,now,now).run();
  await env.DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'OWNER','active',?,?) ON CONFLICT(project_id,user_id) DO NOTHING").bind(row.id,row.user_id,now,now).run();
}
async function piAll(env,sql,...args){try{return ((await env.DB.prepare(sql).bind(...args).all()).results||[]);}catch(error){if(error.code==="42P01"||/no such table/i.test(error.message||""))return [];throw error;}}
function piLatest(rows,key){const seen=new Set();return rows.filter(x=>{const k=x[key];if(seen.has(k))return false;seen.add(k);return true;});}
async function piBrain(env,row){
  const id=row.id,userId=row.user_id,data=piParse(row.data,{}),sets=await Promise.all([
    piAll(env,"SELECT f.*,d.meta_json AS fact_meta_json FROM project_facts f LEFT JOIN project_fact_details d ON d.fact_id=f.id AND d.project_id=f.project_id WHERE f.project_id=? AND f.user_id=? ORDER BY f.fact_key,f.version DESC LIMIT 500",id,userId),
    piAll(env,"SELECT * FROM project_metrics WHERE project_id=? AND user_id=? ORDER BY metric_key,version DESC LIMIT 300",id,userId),
    piAll(env,"SELECT * FROM project_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 200",id,userId),
    piAll(env,"SELECT * FROM project_decisions WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100",id,userId),
    piAll(env,"SELECT * FROM project_change_sets WHERE project_id=? AND user_id=? AND approval_status IN ('approved','adopted') ORDER BY updated_at DESC LIMIT 60",id,userId)
  ]);
  return Brain.buildContext({projectId:id,name:row.name,data,updatedAt:row.updated_at,
    facts:piLatest(sets[0],"fact_key").map(x=>({...piParse(x.fact_meta_json,{}),id:x.id,factType:x.fact_type,factKey:piParse(x.fact_meta_json,{}).originalFactKey||x.fact_key,label:x.label,value:piParse(x.value_json,null),unit:x.unit,sourceType:x.source_type,sourceRef:x.source_ref,confidence:x.confidence,status:x.status,version:x.version})),
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
    piAll(env,"SELECT * FROM project_tasks WHERE project_id=? AND user_id=? AND status='open' ORDER BY updated_at DESC LIMIT 100",row.id,row.user_id),
    piAll(env,"SELECT * FROM project_risks WHERE project_id=? AND user_id=? AND status='open' ORDER BY updated_at DESC LIMIT 100",row.id,row.user_id),
    piAll(env,"SELECT * FROM project_scenarios WHERE project_id=? AND status='selected' ORDER BY updated_at DESC LIMIT 30",row.id)
  ]),data=piParse(row.data,{}),workStage=await readWorkStage(env,row,profileRow),brain=await piBrain(env,row),profile=PI.normalizeProfile({...profileRow,projectId:row.id,ownerUserId:row.user_id,lifecycleStage:workStage.key,workStageVersion:workStage.version}),kpis={totalInvestment:null,irr:null};
  let kpiVerification={status:scenarios.length>1?'selection_conflict':'not_selected',message:scenarios.length>1?'存在多个旧采用方案，请明确重新采用一个方案':'尚未采用服务端复算方案'};
  if(scenarios.length===1){try{await verifyInvestmentScenario(env,scenarios[0],data);const envelope=piParse(scenarios[0].metrics_json),values=envelope.values||{};kpis.totalInvestment=values.totalInvestment??null;kpis.irr=envelope.metricMeta?.irr?.irrType==='project'?(values.irr??null):null;kpiVerification={status:'server_recomputed',scenarioId:scenarios[0].id,irrType:envelope.metricMeta?.irr?.irrType||null};}catch(error){kpiVerification={status:'unverified',scenarioId:scenarios[0].id,message:error.status?error.message:'采用方案暂时无法核验，请重试'};}}
  brain.lifecycle={...brain.lifecycle,current:workStage.key,label:workStage.label};brain.requirements=Brain.requiredFacts({facts:brain.facts,stageKey:workStage.key,requirements:data.workflow?.factRequirements});brain.summary.missingFacts=brain.requirements.missingCount;
  const model=PI.buildReadModel({project:{id:row.id,name:row.name,type:data.project&&data.project.type,location:data.project&&data.project.location,owner:data.project&&data.project.owner},profile,workStage,membership,memberships:members,gates:gates.map(x=>({...x,criteria:piParse(x.criteria_json,[])})),milestones,deliverables,brain,ops:{tasks:tasks.map(x=>({id:x.id,title:x.title,owner:x.owner,dueDate:x.due_date,status:x.status,stageKey:x.stage_key||"",milestoneId:x.milestone_id||""})),risks:risks.map(x=>({id:x.id,title:x.title,level:x.risk_level,status:x.status,stageKey:x.stage_key||""})),scenarios:scenarios.map(x=>({id:x.id,name:x.name,status:x.status,metrics:piParse(x.metrics_json,{})}))},kpis,currentPage:"project-overview"});
  const selected=model.contextContract.activeScenario;if(selected){const envelope=selected.metrics||{};selected.metrics=kpiVerification.status==='server_recomputed'?envelope.values||{}:{};selected.verification=kpiVerification;}
  model.kpiVerification=kpiVerification;model.snapshotLimits={facts:500,metrics:300,artifacts:200,tasks:100,risks:100};return model;
}
async function piOwnedModel(env,user,projectId){const row=await piProject(env,projectId);if(!row)return {error:"项目不存在",status:404};const membership=await piAccess(env,user,row);if(!membership)return {error:"项目不存在或无权访问",status:404};await piBootstrapOwner(env,row);return {row,membership,model:await piLoad(env,user,row,membership)};}
export async function onRequestGet(c){try{const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await piEnsure(env);const projectId=piProjectId(new URL(c.request.url).searchParams.get("projectId"));if(!projectId)return json({ok:false,error:"项目ID不合法"},400);const x=await piOwnedModel(env,user,projectId);if(x.error)return json({ok:false,error:x.error},x.status);if(!await resolveProjectAccess(env,user.userId,projectId))return json({ok:false,error:"项目访问权限已撤销"},404);return json({ok:true,readModel:x.model});}catch(error){return json({ok:false,error:"项目数据读取失败，请重试；未将读取失败当作空数据"},503);}}

export async function onRequestPost(c){
  try{return await piPost(c);}catch(error){return json({ok:false,error:error.status?error.message:"项目保存失败，数据未提交，请稍后重试"},error.status||503);}
}
async function piPost(c){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:"未登录或登录已过期"},401);await piEnsure(env);
  let b={};try{b=await c.request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}
  const projectId=piProjectId(b.projectId),action=piText(b.action,50);if(!projectId)return json({ok:false,error:"项目ID不合法"},400);
  if(action==="addMember"){const result=await changeProjectMember(env,user.userId,projectId,Number(b.member?.userId),String(b.member?.role||'VIEWER').toUpperCase());return json(result,result.status||200);}
  if(action==="updateWorkStage")return json(await updateWorkStage(env,user,{...b,projectId}));
  if(!["updateProfile","saveGate","saveMilestone","saveDeliverable"].includes(action))return json({ok:false,error:"不支持的Project Intelligence操作"},400);
  return withProjectMutation(env,user,projectId,action==="updateProfile"?"manage":"edit",async(tx,access)=>{
    await piBootstrapOwner(tx,access.row);const now=Date.now(),owned=(table,id,allowMissing=false)=>assertProjectObject(tx,table,id,projectId,{allowMissing}),audit=(type,payload)=>lifecycleEvent(tx,user,access.ownerUserId,projectId,type,payload);
    if(action==="updateProfile"){
      const existing=await tx.DB.prepare('SELECT * FROM project_profiles WHERE project_id=?').bind(projectId).first(),stage=await readWorkStage(tx,access.row,existing),incoming=b.profile||{};
      if((incoming.lifecycleStage||incoming.lifecycle_stage)&&String(incoming.lifecycleStage||incoming.lifecycle_stage)!==stage.key)throw lifecycleError(409,"请使用独立的工作阶段操作调整阶段，保存项目设置不会改变阶段");
      const p=PI.normalizeProfile({...existing,...incoming,projectId,ownerUserId:access.ownerUserId,lifecycleStage:stage.key});await owned('project_gates',p.currentGateId);
      await tx.DB.prepare("UPDATE project_profiles SET organization_id=?,department_id=?,visibility=?,confidentiality_level=?,current_gate_id=?,updated_at=? WHERE project_id=?").bind(p.organizationId,p.departmentId,p.visibility,p.confidentialityLevel,p.currentGateId,now,projectId).run();await audit('project.profile.updated',p);
      return json({ok:true,readModel:await piLoad(tx,user,access.row,{projectId,userId:user.userId,role:access.role,status:'active'})});
    }
    const input=action==='saveGate'?b.gate:action==='saveMilestone'?b.milestone:b.deliverable;
    if(!input||typeof input!=='object'||Array.isArray(input))throw lifecycleError(400,'请填写有效项目对象');
    const stageKey=input.stageKey||input.stage_key;if(stageKey&&!Brain.STAGES.some(x=>x.key===stageKey))throw lifecycleError(400,'项目阶段无效');
    if(action==="saveGate"){
      const g=PI.normalizeGate({...input,id:input.id||piId('gate')}),old=await owned('project_gates',g.id,true);
      if(['passed','waived'].includes(g.status)||['passed','waived'].includes(old?.status))throw lifecycleError(403,'正式通过或豁免需要独立审批职责；当前协作角色不能办理或覆盖正式结论');
      if(g.actualDate)throw lifecycleError(400,'普通编辑不能填写正式通过日期');
      await tx.DB.prepare("INSERT INTO project_gates(id,project_id,name,stage_key,status,planned_date,actual_date,owner,criteria_json,block_reason,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,status=excluded.status,planned_date=excluded.planned_date,actual_date=excluded.actual_date,owner=excluded.owner,criteria_json=excluded.criteria_json,block_reason=excluded.block_reason,sort_order=excluded.sort_order,updated_at=excluded.updated_at WHERE project_gates.project_id=excluded.project_id").bind(g.id,projectId,g.name,g.stageKey,g.status,g.plannedDate,'',g.owner,JSON.stringify(g.criteria),g.blockReason,g.sortOrder,now,now).run();await audit('project.gate.updated',g);return json({ok:true,id:g.id});
    }
    if(action==="saveMilestone"){
      const m=PI.normalizeMilestone({...input,id:input.id||piId('milestone')});await owned('project_milestones',m.id,true);const gate=await owned('project_gates',m.gateId);if(gate?.stage_key&&m.stageKey&&gate.stage_key!==m.stageKey)throw lifecycleError(400,'里程碑与关联阶段门不属于同一阶段');
      await tx.DB.prepare("INSERT INTO project_milestones(id,project_id,name,stage_key,gate_id,status,planned_date,forecast_date,actual_date,owner,progress,weight,risk_level,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,gate_id=excluded.gate_id,status=excluded.status,planned_date=excluded.planned_date,forecast_date=excluded.forecast_date,actual_date=excluded.actual_date,owner=excluded.owner,progress=excluded.progress,weight=excluded.weight,risk_level=excluded.risk_level,sort_order=excluded.sort_order,updated_at=excluded.updated_at WHERE project_milestones.project_id=excluded.project_id").bind(m.id,projectId,m.name,m.stageKey,m.gateId,m.status,m.plannedDate,m.forecastDate,m.actualDate,m.owner,m.progress,m.weight,m.riskLevel,m.sortOrder,now,now).run();await audit('project.milestone.updated',m);return json({ok:true,id:m.id});
    }
    const d=PI.normalizeDeliverable({...input,id:input.id||piId('deliverable')});await owned('project_deliverables',d.id,true);const gate=await owned('project_gates',d.gateId),milestone=await owned('project_milestones',d.milestoneId);await assertProjectObject(tx,'project_artifacts',d.artifactId,projectId,{ownerUserId:access.ownerUserId});
    if([gate,milestone].some(x=>x?.stage_key&&d.stageKey&&x.stage_key!==d.stageKey)||milestone?.gate_id&&d.gateId&&milestone.gate_id!==d.gateId)throw lifecycleError(400,'成果、里程碑与阶段门的关联不一致');
    if(d.status==='done'&&!d.artifactId)throw lifecycleError(400,'完成成果必须关联已登记的项目成果');
    await tx.DB.prepare("INSERT INTO project_deliverables(id,project_id,name,stage_key,gate_id,milestone_id,artifact_id,status,required,owner,due_date,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stage_key=excluded.stage_key,gate_id=excluded.gate_id,milestone_id=excluded.milestone_id,artifact_id=excluded.artifact_id,status=excluded.status,required=excluded.required,owner=excluded.owner,due_date=excluded.due_date,sort_order=excluded.sort_order,updated_at=excluded.updated_at WHERE project_deliverables.project_id=excluded.project_id").bind(d.id,projectId,d.name,d.stageKey,d.gateId,d.milestoneId,d.artifactId,d.status,d.required?1:0,d.owner,d.dueDate,d.sortOrder,now,now).run();await audit('project.deliverable.updated',d);return json({ok:true,id:d.id});
  });
}
