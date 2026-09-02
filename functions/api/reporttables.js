// 可研标准表格模板治理：静态1:1基线 + 数据库差异覆盖，避免每版重复存储9MB模板。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const clean=(value,max=500)=>String(value==null?"":value).trim().slice(0,max);
const parse=(value,fallback)=>{try{return JSON.parse(value||"");}catch(_){return fallback;}};
const isAdmin=(env,user)=>(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean).some(x=>x===user.username||x===String(user.userId));
const passOk=(env,request)=>!env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS;

async function ensureSchema(env){
  const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS report_table_template_versions (id TEXT PRIMARY KEY,project_type TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'published',overrides TEXT NOT NULL,created_at "+ts+" NOT NULL,created_by TEXT DEFAULT '',reason TEXT NOT NULL DEFAULT '',restored_from_version INTEGER)").run();
  for(const sql of [
    "ALTER TABLE report_table_template_versions ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE report_table_template_versions ADD COLUMN restored_from_version INTEGER"
  ]){
    try{await env.DB.prepare(sql).run();}catch(error){if(!/already exists|duplicate column/i.test(String(error?.message||error)))throw error;}
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_report_table_versions_type ON report_table_template_versions(project_type,status,version DESC)").run();
}

function validateOverrides(input,expectedType="rent"){
  const source=input&&typeof input==="object"?input:{};
  const projectType=clean(expectedType||source.projectType,30)||"rent";
  if(!["rent","gaibao-housing","gaibao-commercial"].includes(projectType))throw new Error("不支持的表格模板库");
  const templates=source.templates&&typeof source.templates==="object"?source.templates:{};
  const output={projectType,templates:{},deletedTemplateIds:[],addedTemplates:[]};
  const deleted=Array.isArray(source.deletedTemplateIds)?source.deletedTemplateIds:[];
  if(deleted.length>100)throw new Error("删除表格数量异常");
  output.deletedTemplateIds=deleted.map(id=>clean(id,120)).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const ids=Object.keys(templates);
  if(ids.length>60)throw new Error("表格覆盖项数量异常");
  ids.forEach(id=>{
    const item=templates[id]||{},next={};
    const title=clean(item.title,240);if(title)next.title=title;
    const chapter=clean(item.chapter,240);if(chapter)next.chapter=chapter;
    if(Array.isArray(item.match))next.match=item.match.slice(0,20).map(x=>clean(x,120)).filter(Boolean);
    const cells=item.cells&&typeof item.cells==="object"?item.cells:{};
    const keys=Object.keys(cells);if(keys.length>20000)throw new Error("单元格覆盖项数量异常："+id);
    const normalized={};
    keys.forEach(key=>{if(!/^\d+:\d+:\d+$/.test(key))throw new Error("单元格坐标格式有误："+key);normalized[key]=clean(cells[key],1000);});
    if(keys.length)next.cells=normalized;
    if(next.title||next.chapter||next.match||next.cells)output.templates[clean(id,120)]=next;
  });
  const added=Array.isArray(source.addedTemplates)?source.addedTemplates:[];
  if(added.length>50)throw new Error("新增表格数量异常");
  output.addedTemplates=added.map((template,index)=>{
    const id=clean(template?.id,120);if(!id)throw new Error("新增表格缺少ID："+(index+1));
    const segments=Array.isArray(template.segments)?template.segments:[];if(!segments.length||segments.length>20)throw new Error("新增表格结构异常："+id);
    let cellCount=0;
    const safeSegments=segments.map(segment=>({sourceTableNumber:Number(segment.sourceTableNumber||0),gridWidths:(Array.isArray(segment.gridWidths)?segment.gridWidths:[]).slice(0,50).map(Number),rows:(Array.isArray(segment.rows)?segment.rows:[]).slice(0,300).map(row=>({cells:(Array.isArray(row.cells)?row.cells:[]).slice(0,50).map(cell=>{cellCount++;return {text:clean(cell.text,1000),col:Number(cell.col||0),colSpan:Math.max(1,Number(cell.colSpan||1)),vMerge:["restart","continue"].includes(cell.vMerge)?cell.vMerge:"",fill:clean(cell.fill,12),align:clean(cell.align,20),role:cell.role==="value"?"value":"static"};})}))}));
    if(cellCount>20000)throw new Error("新增表格单元格过多："+id);
    return {id,title:clean(template.title,240)||"新建表格",projectType,businessScenario:clean(template.businessScenario,40),version:Math.max(1,Number(template.version||1)),chapter:clean(template.chapter,240),match:(Array.isArray(template.match)?template.match:[]).slice(0,20).map(x=>clean(x,120)).filter(Boolean),placement:clean(template.placement,500),appendix:!!template.appendix,longPeriod:!!template.longPeriod,sourceTableNumbers:[],segments:safeSegments};
  });
  return output;
}

function rowOut(row){return row?{id:row.id,projectType:row.project_type,version:Number(row.version||0),status:row.status,overrides:parse(row.overrides,{projectType:row.project_type,templates:{}}),createdAt:Number(row.created_at||0),createdBy:row.created_by||"",reason:row.reason||"",restoredFromVersion:row.restored_from_version==null?null:Number(row.restored_from_version)}:null;}

export async function onRequestGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:"未登录"},401);
  try{await ensureSchema(env);}catch(error){return json({ok:false,error:"表格模板配置初始化失败："+error.message},500);}
  const url=new URL(context.request.url),projectType=clean(url.searchParams.get("projectType")||"rent",30),action=clean(url.searchParams.get("action"),30);
  if(action==="history"){
    if(!isAdmin(env,user))return json({ok:false,error:"仅管理员可查看表格模板版本历史"},403);
    const rows=(await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE project_type=? ORDER BY version DESC LIMIT 100").bind(projectType).all()).results||[];
    return json({ok:true,projectType,history:rows.map(rowOut)});
  }
  const row=await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
  return json({ok:true,config:rowOut(row)||{projectType,version:1,status:"baseline",overrides:{projectType,templates:{}}}});
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:"未登录"},401);
  if(!isAdmin(env,user)||!passOk(env,context.request))return json({ok:false,error:"仅管理员可发布表格模板修改"},403);
  try{await ensureSchema(env);}catch(error){return json({ok:false,error:"表格模板配置初始化失败："+error.message},500);}
  let body;try{body=await context.request.json();}catch(_){return json({ok:false,error:"请求格式有误"},400);}
  const action=clean(body.action,30);
  if(!["publish","rollback"].includes(action))return json({ok:false,error:"未知操作"},400);
  try{
    const projectType=clean(body.projectType||"rent",30);
    const latest=await env.DB.prepare("SELECT version FROM report_table_template_versions WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first();
    const version=Math.max(1,Number(latest?.version||1)+1),now=Date.now(),id=`report-tables-${projectType}-v${version}-${now.toString(36)}`;
    let overrides,restoredFromVersion=null,reason=clean(body.reason,500);
    if(action==="rollback"){
      restoredFromVersion=Math.max(1,Number(body.targetVersion||0));
      const target=await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE project_type=? AND version=? LIMIT 1").bind(projectType,restoredFromVersion).first();
      if(!target)return json({ok:false,error:"找不到要恢复的历史版本"},404);
      overrides=validateOverrides(parse(target.overrides,{}),projectType);
      reason=reason||`恢复历史版本 V${restoredFromVersion}`;
    }else{
      overrides=validateOverrides(body.overrides,projectType);
      reason=reason||"发布表格模板修改";
    }
    await env.DB.prepare("UPDATE report_table_template_versions SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();
    await env.DB.prepare("INSERT INTO report_table_template_versions(id,project_type,version,status,overrides,created_at,created_by,reason,restored_from_version) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id,projectType,version,"published",JSON.stringify(overrides),now,user.username||String(user.userId),reason,restoredFromVersion).run();
    return json({ok:true,config:rowOut(await env.DB.prepare("SELECT * FROM report_table_template_versions WHERE id=?").bind(id).first())});
  }catch(error){return json({ok:false,error:error.message},400);}
}

export { validateOverrides };
