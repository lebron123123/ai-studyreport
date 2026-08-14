// /api/pptprojects — AI办公固定模板PPT项目与版本。所有记录按登录用户隔离。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

let schemaReady=false,schemaPromise=null;
const clean=(v,n=200000)=>String(v==null?"":v).trim().slice(0,n);
function makeId(prefix){const a=new Uint32Array(1);crypto.getRandomValues(a);return prefix+Date.now().toString(36)+a[0].toString(36).slice(0,7);}
function parse(v,fallback={}){try{return JSON.parse(v||"")||fallback;}catch(e){return fallback;}}
function output(row){return row?{id:row.id,title:row.title,status:row.status,templateId:row.template_id,data:parse(row.data,{}),revision:Number(row.revision||1),createdAt:Number(row.created_at||0),updatedAt:Number(row.updated_at||0)}:null;}
async function ensureSchema(env){
  if(schemaReady)return;if(schemaPromise)return schemaPromise;const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  schemaPromise=(async()=>{for(const sql of [
    "CREATE TABLE IF NOT EXISTS ppt_projects (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',template_id TEXT NOT NULL DEFAULT 'anju-blue',data TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1,created_at "+ts+" NOT NULL,updated_at "+ts+" NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_projects_user ON ppt_projects(user_id,updated_at DESC)",
    "CREATE TABLE IF NOT EXISTS ppt_project_versions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,revision INTEGER NOT NULL,label TEXT DEFAULT '',data TEXT NOT NULL,created_at "+ts+" NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_versions_project ON ppt_project_versions(user_id,project_id,created_at DESC)"
  ])await env.DB.prepare(sql).run();schemaReady=true;})().catch(e=>{schemaPromise=null;throw e;});return schemaPromise;
}
async function owned(env,user,id){return env.DB.prepare("SELECT * FROM ppt_projects WHERE id=? AND user_id=?").bind(id,user.userId).first();}
async function snapshot(env,user,row,label){
  await env.DB.prepare("INSERT INTO ppt_project_versions(id,project_id,user_id,revision,label,data,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(makeId("pptv_"),row.id,user.userId,Number(row.revision||1),clean(label,100),row.data,Date.now()).run();
  const all=await env.DB.prepare("SELECT id FROM ppt_project_versions WHERE project_id=? AND user_id=? ORDER BY created_at DESC").bind(row.id,user.userId).all();
  for(const old of (all.results||[]).slice(50))await env.DB.prepare("DELETE FROM ppt_project_versions WHERE id=? AND user_id=?").bind(old.id,user.userId).run();
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);
  try{await ensureSchema(env);}catch(e){return json({ok:false,error:"PPT工作台初始化失败："+e.message},500);}
  let body;try{body=await context.request.json();}catch(e){return json({ok:false,error:"请求格式有误"},400);}const action=clean(body.action,32)||"list";
  if(action==="list"){const rows=await env.DB.prepare("SELECT * FROM ppt_projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 200").bind(user.userId).all();return json({ok:true,items:(rows.results||[]).map(output)});}
  if(action==="get"){const row=await owned(env,user,clean(body.id,80));return row?json({ok:true,item:output(row)}):json({ok:false,error:"项目不存在或无权访问"},404);}
  if(action==="create"){
    const id=makeId("ppt_"),now=Date.now(),title=clean(body.title,120)||"未命名汇报",templateId=clean(body.templateId,40)||"anju-blue",data=JSON.stringify(body.data&&typeof body.data==="object"?body.data:{});
    await env.DB.prepare("INSERT INTO ppt_projects(id,user_id,title,status,template_id,data,revision,created_at,updated_at) VALUES(?,?,?,'draft',?,?,1,?,?)").bind(id,user.userId,title,templateId,data,now,now).run();
    return json({ok:true,item:output(await owned(env,user,id))});
  }
  if(action==="save"){
    const row=await owned(env,user,clean(body.id,80));if(!row)return json({ok:false,error:"项目不存在或无权修改"},404);
    const expected=Number(body.revision||0);if(expected&&expected!==Number(row.revision||1))return json({ok:false,error:"项目已在其他页面更新，请刷新后再保存",conflict:true,current:output(row)},409);
    await snapshot(env,user,row,body.label||"保存前自动快照");const data=JSON.stringify(body.data&&typeof body.data==="object"?body.data:parse(row.data,{})),title=clean(body.title,120)||row.title,templateId=clean(body.templateId,40)||row.template_id,status=["draft","review","final"].includes(body.status)?body.status:row.status,now=Date.now();
    await env.DB.prepare("UPDATE ppt_projects SET title=?,status=?,template_id=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").bind(title,status,templateId,data,now,row.id,user.userId).run();
    return json({ok:true,item:output(await owned(env,user,row.id))});
  }
  if(action==="versions"){
    const row=await owned(env,user,clean(body.id,80));if(!row)return json({ok:false,error:"项目不存在"},404);
    const rows=await env.DB.prepare("SELECT id,revision,label,created_at FROM ppt_project_versions WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50").bind(row.id,user.userId).all();return json({ok:true,current:output(row),versions:rows.results||[]});
  }
  if(action==="restore"){
    const row=await owned(env,user,clean(body.id,80));if(!row)return json({ok:false,error:"项目不存在"},404);
    const ver=await env.DB.prepare("SELECT * FROM ppt_project_versions WHERE id=? AND project_id=? AND user_id=?").bind(clean(body.versionId,80),row.id,user.userId).first();if(!ver)return json({ok:false,error:"历史版本不存在"},404);
    await snapshot(env,user,row,"恢复前快照");const data=parse(ver.data,{}),now=Date.now();await env.DB.prepare("UPDATE ppt_projects SET title=?,template_id=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?").bind(clean(data.title,120)||row.title,clean(data.templateId,40)||row.template_id,ver.data,now,row.id,user.userId).run();return json({ok:true,item:output(await owned(env,user,row.id))});
  }
  if(action==="delete"){
    const row=await owned(env,user,clean(body.id,80));if(!row)return json({ok:false,error:"项目不存在"},404);
    await env.DB.prepare("DELETE FROM ppt_project_versions WHERE project_id=? AND user_id=?").bind(row.id,user.userId).run();await env.DB.prepare("DELETE FROM ppt_projects WHERE id=? AND user_id=?").bind(row.id,user.userId).run();return json({ok:true});
  }
  return json({ok:false,error:"未知操作"},400);
}
