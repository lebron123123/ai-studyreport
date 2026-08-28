// /api/projects  云端项目库（需登录）
// GET            ?id=xxx 读取单个；不带id返回项目列表
// POST           {id, name, data} 新建或更新（仅限本人项目）
// DELETE         ?id=xxx 删除本人项目
import { verifyAuth, json } from "./_auth.js";

import { adaptEnv } from "./_adapters.js";

function parseData(raw){
  try{ return typeof raw==="string"?JSON.parse(raw):(raw||{}); }catch(e){ return {}; }
}
function projectStage(data){
  const wf=data.workflow||{},chapters=Array.isArray(data.chapters)?data.chapters:[];
  const sections=chapters.flatMap(c=>Array.isArray(c.sections)?c.sections:[]);
  const generated=sections.filter(s=>String(s.editedHtml||s.content||"").trim()).length;
  if(data.signed)return {key:"signed",label:"已签发",progress:100};
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
  return {id:row.id,name:row.name,updated_at:Number(row.updated_at)||0,archived:!!mg.archived,archivedAt:Number(mg.archivedAt)||0,
    status:String(mg.status||stage.key),stage:stage.label,progress:stage.progress,type:String(project.type||((wf.calcSnapshots||[]).slice(-1)[0]||{}).calcType||""),
    location:String(project.location||""),owner:String(project.owner||""),tags:Array.isArray(mg.tags)?mg.tags.slice(0,8):[],
    chapters:chapters.length,sections:sections.length,generated,stale,locked,materials:Array.isArray(data.kb)?data.kb.length:0,
    calcVersions:Array.isArray(wf.calcSnapshots)?wf.calcSnapshots.length:0,reportVersions:Array.isArray(wf.reportVersions)?wf.reportVersions.length:0,
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
    const row = await env.DB.prepare("SELECT id, name, data, updated_at FROM projects WHERE id=? AND user_id=?")
      .bind(id, user.userId).first();
    if(!row) return json({ok:false, error:"项目不存在"}, 404);
    return json({ok:true, project:{id:row.id, name:row.name, updated_at:row.updated_at, data:JSON.parse(row.data)}});
  }
  const rows = await env.DB.prepare(
    "SELECT id, name, data, updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .bind(user.userId).all();
  return json({ok:true, list:(rows.results||[]).map(summarizeProjectRow)});
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
    const row=await env.DB.prepare("SELECT name,data FROM projects WHERE id=? AND user_id=?").bind(id,user.userId).first();
    if(!row)return json({ok:false,error:"项目不存在"},404);
    const data=parseData(row.data),mg=appendActivity(data,action,action==="setArchived"?(body.archived?"项目已归档":"项目已恢复"):"项目状态已更新",user.username||user.userId);
    if(action==="setArchived"){mg.archived=!!body.archived;mg.archivedAt=body.archived?Date.now():0;}
    else{
      if(body.status!=null)mg.status=String(body.status).slice(0,30);
      if(Array.isArray(body.tags))mg.tags=body.tags.map(x=>String(x).trim()).filter(Boolean).slice(0,8);
    }
    const dataStr=JSON.stringify(data),now=Date.now();
    await env.DB.prepare("UPDATE projects SET data=?,updated_at=? WHERE id=? AND user_id=?").bind(dataStr,now,id,user.userId).run();
    return json({ok:true,id,updatedAt:now});
  }
  const dataStr = JSON.stringify(body.data||{});
  if(dataStr.length > 900000) return json({ok:false, error:"项目数据过大，无法保存"}, 413);

  const exist = await env.DB.prepare("SELECT user_id FROM projects WHERE id=?").bind(id).first();
  if(exist && exist.user_id !== user.userId) return json({ok:false, error:"无权限"}, 403);

  if(exist){
    if(body.expectedUpdatedAt!=null){
      const latest=await env.DB.prepare("SELECT updated_at FROM projects WHERE id=? AND user_id=?").bind(id,user.userId).first();
      if(latest&&Number(latest.updated_at)!==Number(body.expectedUpdatedAt))return json({ok:false,error:"项目已在其他页面更新，请重新载入后再保存",conflict:true,updatedAt:Number(latest.updated_at)},409);
    }
    const now=Date.now();
    await env.DB.prepare("UPDATE projects SET name=?, data=?, updated_at=? WHERE id=? AND user_id=?")
      .bind(name, dataStr, now, id, user.userId).run();
    return json({ok:true, id, updatedAt:now});
  }else{
    const now=Date.now();
    await env.DB.prepare("INSERT INTO projects(id, user_id, name, data, updated_at) VALUES(?,?,?,?,?)")
      .bind(id, user.userId, name, dataStr, now).run();
    return json({ok:true, id, updatedAt:now});
  }
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id")||"";
  await env.DB.prepare("DELETE FROM projects WHERE id=? AND user_id=?").bind(id, user.userId).run();
  return json({ok:true});
}
