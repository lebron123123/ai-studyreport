// /api/calcconfig  测算参数配置（登录用户可读，管理员可写）
// GET              返回全部配置 {gaibao:{}, rent:{}, sale:{}, metrics:[]}
// POST             {key:"gaibao"|"rent"|"sale"|"metrics", data:{...}|[...]}
import { verifyAuth, json } from "./_auth.js";

const KEYS = ["gaibao","rent","sale","metrics"];
function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

export async function onRequestGet(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  const out = {};
  for(const k of KEYS){
    const row = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_"+k).first();
    out[k] = row? JSON.parse(row.data) : (k==="metrics"? [] : {});
  }
  return json({ok:true, config: out});
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可修改测算参数"}, 403);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const key = String(body.key||"");
  if(!KEYS.includes(key)) return json({ok:false, error:"未知配置项"}, 400);
  const dataStr = JSON.stringify(body.data ?? (key==="metrics"? []:{}));
  if(dataStr.length > 50000) return json({ok:false, error:"配置过大"}, 413);
  const exist = await env.DB.prepare("SELECT key FROM configs WHERE key=?").bind("calc_"+key).first();
  if(exist){
    await env.DB.prepare("UPDATE configs SET data=?, updated_at=? WHERE key=?").bind(dataStr, Date.now(), "calc_"+key).run();
  }else{
    await env.DB.prepare("INSERT INTO configs(key, data, updated_at) VALUES(?,?,?)").bind("calc_"+key, dataStr, Date.now()).run();
  }
  return json({ok:true});
}
