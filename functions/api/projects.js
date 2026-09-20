// /api/projects  云端项目库（需登录）
// GET            ?id=xxx 读取单个；不带id返回项目列表
// POST           {id, name, data} 新建或更新（仅限本人项目）
// DELETE         ?id=xxx 删除本人项目
import { verifyAuth, json } from "./_auth.js";

import { adaptEnv } from "./_adapters.js";
import { ensureProjectMemberships,resolveProjectAccess,projectRolePermissions } from "./_project-access.js";
import "../../project-brain.js";
import {ensureLifecycleIntegrity,readWorkStage} from './_lifecycle-integrity.js';
import {researchAuthorizer} from './_research-authorization.js';
import {legacyResearchLifecycle,guardLegacyResearchSave} from './_legacy-research-lifecycle.js';
import {packState,unpackState} from '../../research-state-codec.mjs';

function parseData(raw){
  try{ return typeof raw==="string"?JSON.parse(raw):(raw||{}); }catch(e){ return {}; }
}
function projectStage(data){
  const wf=data.workflow||{},chapters=Array.isArray(data.chapters)?data.chapters:[];
  const investmentStage=wf.management&&wf.management.investmentStage;
  if(investmentStage&&globalThis.ProjectBrain){const stage=globalThis.ProjectBrain.stage(investmentStage);return {key:investmentStage,label:stage.label,progress:stage.progress};}
  const sections=chapters.flatMap(c=>Array.isArray(c.sections)?c.sections:[]);
  const generated=sections.filter(s=>String(s.editedHtml||s.content||"").trim()).length;
  if((wf.reportVersions||[]).length||generated===sections.length&&sections.length)return {key:"review",label:"复核签发",progress:92};
  if(generated)return {key:"generating",label:"逐章生成",progress:Math.max(66,Math.min(88,66+Math.round(generated/Math.max(1,sections.length)*22)))};
  if(data.calcParams||(wf.calcSnapshots||[]).length)return {key:"calculated",label:"测算完成",progress:58};
  if(data.project&&data.project.name)return {key:"collecting",label:"资料准备",progress:28};
  return {key:"draft",label:"新建草稿",progress:8};
}
export function summarizeProjectRow(row){
  const data=parseData(row.data),wf=data.workflow||{},mg=wf.management||{};
  const chapters=Array.isArray(data.chapters)?data.chapters:[],sections=chapters.flatMap(c=>Array.isArray(c.sections)?c.sections:[]);
  const generated=sections.filter(s=>String(s.editedHtml||s.content||"").trim()).length;
  const stale=sections.filter(s=>s.syncStatus==="stale"||s.syncStatus==="locked-stale").length;
  const locked=sections.filter(s=>!!s.locked).length,stage=projectStage(data),project=data.project||{};
  const reportVersionItems=(Array.isArray(wf.reportVersions)?wf.reportVersions:[]).slice(-20).reverse().map(v=>({id:String(v.id||""),version:Number(v.version)||0,createdAt:String(v.createdAt||""),reason:String(v.reason||"报告版本"),current:String(v.id||"")===String(wf.currentReportVersionId||"")}));
  return {id:row.id,name:row.name,...legacyResearchLifecycle(data),updated_at:Number(row.updated_at)||0,archived:!!mg.archived,archivedAt:Number(mg.archivedAt)||0,
    status:String(mg.status||stage.key),stage:stage.label,progress:stage.progress,type:String(project.type||((wf.calcSnapshots||[]).slice(-1)[0]||{}).calcType||""),
    location:String(project.location||""),owner:String(project.owner||""),tags:Array.isArray(mg.tags)?mg.tags.slice(0,8):[],
    chapters:chapters.length,sections:sections.length,generated,stale,locked,materials:Array.isArray(data.kb)?data.kb.length:0,
    calcVersions:Array.isArray(wf.calcSnapshots)?wf.calcSnapshots.length:0,reportVersions:Array.isArray(wf.reportVersions)?wf.reportVersions.length:0,reportVersionItems,
    currentStep:Number(data.currentStep)||0,activity:Array.isArray(mg.activity)?mg.activity.slice(-8).reverse():[],dataBytes:String(row.data||"").length};
}
function appendActivity(data,type,text,user){
  const wf=data.workflow||(data.workflow={}),mg=wf.management||(wf.management={}),list=Array.isArray(mg.activity)?mg.activity:(mg.activity=[]);
  list.push({at:Date.now(),type:String(type||"update"),text:String(text||"项目已更新").slice(0,120),by:String(user||"").slice(0,40)});
  if(list.length>30)list.splice(0,list.length-30);
  return mg;
}
export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if(id){
    const access=await resolveProjectAccess(env,user.userId,id);
    if(!access) return json({ok:false, error:"项目不存在或已无访问权限"}, 404);
    const row=access.row;
    await ensureLifecycleIntegrity(env);const stage=await readWorkStage(env,row),data=parseData(row.data);data.signed=false;data.workflow=data.workflow||{};data.workflow.management={...data.workflow.management,investmentStage:stage.key,workStageVersion:stage.version};row.data=JSON.stringify(data);
    return json({ok:true, project:{id:row.id, name:row.name, updated_at:row.updated_at, data:JSON.parse(row.data),role:access.role,permissions:{...access.permissions,delete:access.ownerUserId===Number(user.userId),duplicate:access.ownerUserId===Number(user.userId)}}});
  }
  await ensureProjectMemberships(env);
  const rows = await env.DB.prepare(
    "SELECT p.id,p.user_id,p.name,p.data,p.updated_at,CASE WHEN p.user_id=? THEN 'OWNER' ELSE m.role END AS role FROM projects p LEFT JOIN project_memberships m ON m.project_id=p.id AND m.user_id=? AND m.status='active' WHERE p.user_id=? OR m.role IN ('OWNER','EDITOR','VIEWER') ORDER BY p.updated_at DESC LIMIT 100")
    .bind(user.userId,user.userId,user.userId).all();
  await ensureLifecycleIntegrity(env);const list=[];for(const row of rows.results||[]){const stage=await readWorkStage(env,row),data=parseData(row.data);data.workflow=data.workflow||{};data.workflow.management={...data.workflow.management,investmentStage:stage.key};list.push({...summarizeProjectRow({...row,data}),status:stage.key,stage:stage.label,workStageVersion:stage.version,role:row.role,permissions:{...projectRolePermissions(row.role),delete:Number(row.user_id)===Number(user.userId),duplicate:Number(row.user_id)===Number(user.userId)}});}return json({ok:true,list});
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const action=String(body.action||"upsert");
  const id = String(body.id||"");
  const name = String(body.name||"未命名项目").slice(0,100);
  if(!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ok:false, error:"项目ID非法"}, 400);
  if(action==='createProject'){
    const now=Date.now(),data={project:{name},workflow:{management:{createdAt:now}}};
    const saved=await env.DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,user.userId,name,JSON.stringify(data),now).run();
    if(saved.meta?.changes!==1)return json({ok:false,error:'项目标识已存在，请重新新建；原项目未覆盖'},409);
    return json({ok:true,id,updatedAt:now});
  }
  if(action==='setResearchAbandoned'){
    if(typeof body.abandoned!=='boolean')return json({ok:false,error:'必须明确废止或恢复状态'},400);
    const access=await resolveProjectAccess(env,user.userId,id);
    if(!access)return json({ok:false,error:'项目不存在或无权访问'},404);
    if(!access.permissions.manage)return json({ok:false,error:'仅项目负责人可废止或恢复此可研'},403);
    if(typeof env.DB._transaction!=='function')return json({ok:false,error:'当前存储尚未启用安全事务，无法变更可研状态'},503);
    try{
      const authorize=await researchAuthorizer(env,user,body.password);
      return await env.DB._transaction(async db=>{
        await db.prepare('UPDATE projects SET updated_at=updated_at WHERE id=?').bind(id).run();
        const live=await resolveProjectAccess({...env,DB:db},user.userId,id);
        if(!live?.permissions.manage)return json({ok:false,error:'项目管理权限已变化'},403);
        await authorize({db,study:{visibility:'private',owner_user_id:user.userId}});
        const row=live.row,data=parseData(row.data),state=legacyResearchLifecycle(data);
        if(state.legacyResearchAbandoned===body.abandoned)return json({ok:true,id,updatedAt:Number(row.updated_at),...state});
        if(body.expectedUpdatedAt!=null&&Number(body.expectedUpdatedAt)!==Number(row.updated_at))return json({ok:false,error:'项目已更新，请重新打开后操作',conflict:true},409);
        const mg=appendActivity(data,'legacyResearchLifecycle',body.abandoned?'可研已废止，正式项目保留':'可研已恢复',user.username||user.userId);
        mg.legacyResearchAbandoned=body.abandoned;mg.legacyResearchAbandonedAt=body.abandoned?Date.now():0;mg.legacyResearchEpoch=state.legacyResearchEpoch+1;
        const now=Math.max(Date.now(),Number(row.updated_at)+1);
        await db.prepare('UPDATE projects SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(data),now,id).run();
        return json({ok:true,id,updatedAt:now,...legacyResearchLifecycle(data)});
      });
    }catch(error){if(error.status)return json({ok:false,error:error.message},error.status);throw error;}
  }
  if(action==="duplicate"){
    const sourceId=String(body.sourceId||"");
    const source=await env.DB.prepare("SELECT data FROM projects WHERE id=? AND user_id=?").bind(sourceId,user.userId).first();
    if(!source)return json({ok:false,error:"原项目不存在"},404);
    const copy=parseData(source.data),mg=appendActivity(copy,"duplicate","由项目副本创建",user.username||user.userId);
    copy.project=copy.project||{};copy.project.name=name;
    mg.archived=false;mg.archivedAt=0;mg.createdAt=Date.now();
    const copyStr=JSON.stringify(copy),now=Date.now();
    await env.DB.prepare("INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)").bind(id,user.userId,name,copyStr,now).run();
    return json({ok:true,id,updatedAt:now});
  }
  if(action==="setArchived"||action==="updateMeta"){
    const access=await resolveProjectAccess(env,user.userId,id);
    if(!access)return json({ok:false,error:"项目不存在"},404);
    if(!(action==='setArchived'?access.permissions.manage:access.permissions.edit))return json({ok:false,error:'当前角色无权执行此操作'},403);
    const row=access.row;
    const data=parseData(row.data),mg=appendActivity(data,action,action==="setArchived"?(body.archived?"项目已归档":"项目已恢复"):"项目状态已更新",user.username||user.userId);
    if(action==="setArchived"){mg.archived=!!body.archived;mg.archivedAt=body.archived?Date.now():0;}
    else{
      if(body.status!=null)mg.status=String(body.status).slice(0,30);
      if(Array.isArray(body.tags))mg.tags=body.tags.map(x=>String(x).trim()).filter(Boolean).slice(0,8);
    }
    const dataStr=JSON.stringify(data),now=Math.max(Date.now(),Number(row.updated_at)+1);
    const changed=await env.DB.prepare("UPDATE projects SET data=?,updated_at=? WHERE id=? AND updated_at=?").bind(dataStr,now,id,row.updated_at).run();
    if(changed.meta?.changes!==1)return json({ok:false,error:'项目已更新，请重新载入后重试',conflict:true},409);
    return json({ok:true,id,updatedAt:now});
  }
  if(body.packed){
    const base=await resolveProjectAccess(env,user.userId,id);
    if(!base?.permissions.edit)return json({ok:false,error:'当前账号没有项目编辑权限'},403);
    if(!Number.isSafeInteger(body.expectedUpdatedAt)||Number(base.row.updated_at)!==body.expectedUpdatedAt)return json({ok:false,error:'项目已更新，请重新载入后再保存',conflict:true},409);
    try{
      const packed=await packState(parseData(base.row.data));
      if(!Array.isArray(body.packed.objects)||body.packed.objects.length>10000)throw Error('invalid');
      for(const entry of body.packed.objects){
        if(!Array.isArray(entry)||entry.length!==2||typeof entry[1]!=='string')throw Error('invalid');
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(entry[1]))),b=>b.toString(16).padStart(2,'0')).join('');
        if(digest!==entry[0])throw Error('invalid');
        packed.objects.set(entry[0],entry[1]);
      }
      body.data=unpackState(body.packed.manifest,packed.objects);
    }catch{return json({ok:false,error:'项目资料块不完整，原稿未修改，请重新打开后保存',conflict:true},409);}
  }
  let dataStr = JSON.stringify({...body.data,signed:false});
  // PostgreSQL 部署不受 D1 单行限制；历史版本保留完整，不为适配小行限额而丢弃。
  const oversized=env.DEPLOY_MODE==="local"?new TextEncoder().encode(dataStr).byteLength>32*1024*1024:dataStr.length>900000;
  if(oversized) return json({ok:false, error:env.DEPLOY_MODE==="local"?"项目超过32MiB保存上限，请保留本机草稿并联系管理员归档历史版本":"项目超过当前云数据库单条保存上限，请保留本机草稿并联系管理员配置大文件存储"}, 413);

  const exist = await env.DB.prepare("SELECT user_id FROM projects WHERE id=?").bind(id).first();
  const access=exist?await resolveProjectAccess(env,user.userId,id):null;
  if(exist && !access?.permissions.edit) return json({ok:false, error:"当前账号没有项目编辑权限"}, 403);

  if(exist){
    const nextData=parseData(dataStr),guard=guardLegacyResearchSave(parseData(access.row.data),nextData,body.legacyResearchEpoch);
    if(!guard.ok)return json(guard,409);dataStr=JSON.stringify(nextData);
    await ensureLifecycleIntegrity(env);const stage=await readWorkStage(env,access.row),data=parseData(dataStr);data.workflow=data.workflow||{};const previous=parseData(access.row.data).workflow?.management||{};data.workflow.management={...data.workflow.management,investmentStage:stage.key,workStageVersion:stage.version,stageUpdatedAt:previous.stageUpdatedAt,stageUpdatedBy:previous.stageUpdatedBy};if(data.project)data.project.investmentStage=stage.key;dataStr=JSON.stringify(data);
    await ensureProjectMemberships(env);
    const expected=body.expectedUpdatedAt==null?Number(access.row.updated_at):Number(body.expectedUpdatedAt);
    if(!Number.isSafeInteger(expected)||Number(access.row.updated_at)!==expected)return json({ok:false,error:"项目已在其他页面更新，请重新载入后再保存",conflict:true,updatedAt:Number(access.row.updated_at)},409);
    if(access.role!=='OWNER'&&body.expectedUpdatedAt==null)return json({ok:false,error:"协作保存必须携带读取时的版本，请重新打开项目",conflict:true},409);
    const now=Math.max(Date.now(),expected+1);
    // Check version and live membership in the write itself, not only before it.
    const saved=await env.DB.prepare("UPDATE projects SET name=?, data=?, updated_at=? WHERE id=? AND updated_at=? AND (user_id=? OR EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id=projects.id AND m.user_id=? AND m.status='active' AND m.role IN ('OWNER','EDITOR')))")
      .bind(name,dataStr,now,id,expected,user.userId,user.userId).run();
    if(saved.meta?.changes!==1)return json({ok:false,error:"项目已更新或编辑权限已撤销；未覆盖任何正文，请重新载入",conflict:true},409);
    return json({ok:true, id, updatedAt:now,storageProtocol:'parts-v1'});
  }else{
    const now=Date.now();
    await env.DB.prepare("INSERT INTO projects(id, user_id, name, data, updated_at) VALUES(?,?,?,?,?)")
      .bind(id, user.userId, name, dataStr, now).run();
    return json({ok:true, id, updatedAt:now,storageProtocol:'parts-v1'});
  }
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id")||"";
  const access=await resolveProjectAccess(env,user.userId,id);
  if(!access)return json({ok:false,error:'项目不存在或无权访问'},404);
  // Permanent deletion remains reserved for the original creator.
  if(Number(access.ownerUserId)!==Number(user.userId))return json({ok:false,error:'仅项目创建者可彻底删除项目'},403);
  await env.DB.prepare("DELETE FROM projects WHERE id=? AND user_id=?").bind(id, user.userId).run();
  return json({ok:true});
}
