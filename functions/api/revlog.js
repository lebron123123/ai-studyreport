// /api/revlog  修改意见记录（POST所有登录用户 / GET仅管理员）
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

function passOk(env, request){
  if(!env.ADMIN_PASS) return true;   // 未配置则不启用
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
}


export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"格式有误"}, 400); }
  const instruction = String(body.instruction||"").trim().slice(0, 500);
  if(!instruction) return json({ok:false, error:"意见为空"}, 400);
  await env.DB.prepare("INSERT INTO revision_logs(user_id, chapter, section, instruction, created_at) VALUES(?,?,?,?,?)")
    .bind(user.userId, String(body.chapter||"").slice(0,50), String(body.section||"").slice(0,80), instruction, Date.now()).run();
  return json({ok:true});
}

export async function onRequestGet(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可查看"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
  const rows = await env.DB.prepare(
    "SELECT chapter, section, instruction, created_at FROM revision_logs ORDER BY id DESC LIMIT 500").all();
  return json({ok:true, list: rows.results||[]});
}
