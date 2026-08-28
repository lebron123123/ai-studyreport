// 可研标准表格模板治理：静态1:1基线 + 数据库差异覆盖，避免每版重复存储9MB模板。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const clean=(value,max=500)=>String(value==null?"":value).trim().slice(0,max);
const parse=(value,fallback)=>{try{return JSON.parse(value||"");}catch(_){return fallback;}};
const isAdmin=(env,user)=>(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean).some(x=>x===user.username||x===String(user.userId));
const passOk=(env,request)=>!env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS;

async function ensureSchema(env){
  const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS report_table_template_versions (id TEXT PRIMARY KEY,project_type TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'published',overrides TEXT NOT NULL,created_at "+ts+" NOT NULL,created_by TEXT DEFAULT '')").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_report_table_versions_type ON report_table_template_versions(project_type,status,version DESC)").run();
}

function validateOverrides(input,expectedType="rent"){
  const source=input&&typeof input==="object"?input:{};
  const projectType=clean(expectedType||source.projectType,30)||"rent";
  if(projectType!=="rent")throw new Error("当前仅开放出租类表格模板治理");
  const templates=source.templates&&typeof source.templates==="object"?source.templates:{};
  const output={projectType,templates:{}};
  const ids=Object.keys(templates);
  if(ids.length>60)throw new Error("表格覆盖项数量异常");
  ids.forEach(id=>{
    const item=templates[id]||{},next={};
    const title=clean(item.title,240);if(title)next.title=title;
    const cells=item.cells&&typeof item.cells==="object"?item.cells:{};
    const keys=Object.keys(cells);if(keys.length>20000)throw new Error("单元格覆盖项数量异常："+id);
    const normalized={};
    keys.forEach(key=>{if(!/^\d+:\d+:\d+$/.test(key))throw new Error("单元格坐标格式有误："+key);normalized[key]=clean(cells[key],1000);});
    if(keys.length)next.cells=normalized;
    if(next.title||next.cells)output.templates[clean(id,120)]=next;
  });
  return output;
}

function rowOut(row){return row?{id:row.id,projectType:row.project_type,version:Number(row.version||0),status:row.status,overrides:parse(row.overrides,{projectType:row.project_type,templates:{}}),createdAt:Number(row.created_at||0),createdBy:row.created_by||""}:null;}

export async function onRequestGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:"未登录"},401);
  try{await ensureSchema(env);}catch(error){return json({ok:false,error:"表格模板配置初始化失败："+error.message},500);}
  const projectType=clean(new URL(context.request.url).searchParams.get("projectType")||"rent",30);
  const row=await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
  return json({ok:true,config:rowOut(row)||{projectType,version:1,status:"baseline",overrides:{projectType,templates:{}}}});
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:"未登录"},401);
  if(!isAdmin(env,user)||!passOk(env,context.request))return json({ok:false,error:"仅管理员可发布表格模板修改"},403);
  try{await ensureSchema(env);}catch(error){return json({ok:false,error:"表格模板配置初始化失败："+error.message},500);}
  let body;try{body=await context.request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}
  if(clean(body.action,30)!=="publish")return json({ok:false,error:"未知操作"},400);
  try{
    const projectType=clean(body.projectType||"rent",30),overrides=validateOverrides(body.overrides,projectType);
    const latest=await env.DB.prepare("SELECT version FROM report_table_template_versions WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first();
    const version=Math.max(1,Number(latest?.version||1)+1),now=Date.now(),id=`report-tables-${projectType}-v${version}-${now.toString(36)}`;
    await env.DB.prepare("UPDATE report_table_template_versions SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();
    await env.DB.prepare("INSERT INTO report_table_template_versions(id,project_type,version,status,overrides,created_at,created_by) VALUES(?,?,?,?,?,?,?)")
      .bind(id,projectType,version,"published",JSON.stringify(overrides),now,user.username||String(user.userId)).run();
    return json({ok:true,config:rowOut(await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE id=?").bind(id).first())});
  }catch(error){return json({ok:false,error:error.message},400);}
}

export { validateOverrides };
