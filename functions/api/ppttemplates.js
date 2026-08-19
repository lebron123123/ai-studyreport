// AI PPT template governance: user drafts/submissions + administrator approval/publishing.
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
let ready=false;
const clean=(v,n=200000)=>String(v==null?"":v).trim().slice(0,n);
const parse=(v,f={})=>{try{return JSON.parse(v||"")||f;}catch(e){return f;}};
const id=()=>"pt_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function isAdmin(env,u){const a=(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);return a.includes(u.username)||a.includes(String(u.userId));}
function passOk(env,r){return !env.ADMIN_PASS||r.headers.get("x-admin-pass")===env.ADMIN_PASS;}
async function schema(env){if(ready)return;const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";for(const s of [
  "CREATE TABLE IF NOT EXISTS ppt_templates (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',category TEXT DEFAULT 'custom',storage_key TEXT DEFAULT '',fingerprint TEXT DEFAULT '',profile TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,review_note TEXT DEFAULT '',created_at "+ts+" NOT NULL,updated_at "+ts+" NOT NULL,reviewed_at "+ts+",reviewed_by TEXT DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS idx_ppt_templates_status ON ppt_templates(status,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_ppt_templates_user ON ppt_templates(user_id,updated_at DESC)"
])await env.DB.prepare(s).run();ready=true;}
function out(r){return r?{...r,profile:parse(r.profile,{}),created_at:Number(r.created_at||0),updated_at:Number(r.updated_at||0),reviewed_at:Number(r.reviewed_at||0)}:null;}
export async function onRequestPost(context){const env=adaptEnv(context.env),u=await verifyAuth(context.request,env);if(!u)return json({ok:false,error:"未登录"},401);try{await schema(env);}catch(e){return json({ok:false,error:"模板治理初始化失败："+e.message},500);}let b;try{b=await context.request.json();}catch(e){return json({ok:false,error:"请求格式有误"},400);}const a=clean(b.action,30)||"list";
  if(a==="list"){const rows=await env.DB.prepare("SELECT * FROM ppt_templates WHERE status='published' OR user_id=? ORDER BY CASE WHEN status='published' THEN 0 ELSE 1 END,updated_at DESC LIMIT 300").bind(u.userId).all();return json({ok:true,items:(rows.results||[]).map(out)});}
  if(a==="adminList"){if(!isAdmin(env,u)||!passOk(env,context.request))return json({ok:false,error:"仅管理员可查看模板审核队列"},403);const rows=await env.DB.prepare("SELECT * FROM ppt_templates ORDER BY updated_at DESC LIMIT 500").all();return json({ok:true,items:(rows.results||[]).map(out)});}
  if(a==="save"){const p=b.item||{},now=Date.now(),tid=clean(p.id,80)||id(),old=await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=? AND user_id=?").bind(tid,u.userId).first(),name=clean(p.name,120)||"未命名参考模板",profile=JSON.stringify(p.profile&&typeof p.profile==="object"?p.profile:{});if(profile.length>600000)return json({ok:false,error:"模板分析结果过大"},413);if(old)await env.DB.prepare("UPDATE ppt_templates SET name=?,status='draft',category=?,storage_key=?,fingerprint=?,profile=?,version=version+1,updated_at=? WHERE id=? AND user_id=?").bind(name,clean(p.category,40)||"custom",clean(p.storage_key,300),clean(p.fingerprint,100),profile,now,tid,u.userId).run();else await env.DB.prepare("INSERT INTO ppt_templates(id,user_id,name,status,category,storage_key,fingerprint,profile,version,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,1,?,?)").bind(tid,u.userId,name,clean(p.category,40)||"custom",clean(p.storage_key,300),clean(p.fingerprint,100),profile,now,now).run();return json({ok:true,item:out(await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=?").bind(tid).first())});}
  if(a==="submit"){const row=await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=? AND user_id=?").bind(clean(b.id,80),u.userId).first();if(!row)return json({ok:false,error:"模板不存在"},404);await env.DB.prepare("UPDATE ppt_templates SET status='pending',updated_at=? WHERE id=?").bind(Date.now(),row.id).run();return json({ok:true,message:"已提交管理员审核；通过前仅本人可用"});}
  if(a==="review"){if(!isAdmin(env,u)||!passOk(env,context.request))return json({ok:false,error:"仅管理员可审核模板"},403);const status=b.decision==="publish"?"published":b.decision==="reject"?"rejected":"draft";await env.DB.prepare("UPDATE ppt_templates SET status=?,review_note=?,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?").bind(status,clean(b.note,1000),Date.now(),u.username,Date.now(),clean(b.id,80)).run();return json({ok:true,status});}
  return json({ok:false,error:"未知操作"},400);
}
