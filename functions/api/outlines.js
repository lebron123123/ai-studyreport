// /api/outlines  大纲管理接口（仅管理员可写，所有登录用户可读）
// GET              列表/单个(?key=xxx)
// POST             {key, label, chapters} 新建或更新
// DELETE           ?key=xxx 删除
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

function passOk(env, request){
  if(!env.ADMIN_PASS) return true;   // 未配置则不启用
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
}


export async function onRequestGet(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if(key){
    const row = await env.DB.prepare("SELECT key, label, chapters, updated_at FROM outlines WHERE key=?").bind(key).first();
    if(!row) return json({ok:false, error:"大纲不存在"}, 404);
    return json({ok:true, outline:{key:row.key, label:row.label, chapters:JSON.parse(row.chapters), updated_at:row.updated_at}});
  }
  const rows = await env.DB.prepare("SELECT key, label, updated_at FROM outlines ORDER BY updated_at DESC").all();
  return json({ok:true, list: rows.results||[]});
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可编辑大纲"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const key = String(body.key||"").trim();
  const label = String(body.label||"").trim().slice(0,50);
  if(!/^[a-z0-9_-]{2,40}$/.test(key)) return json({ok:false, error:"大纲key需为2-40位小写字母数字下划线"}, 400);
  if(!label) return json({ok:false, error:"标签不能为空"}, 400);
  const chapStr = JSON.stringify(body.chapters||[]);
  const exist = await env.DB.prepare("SELECT key FROM outlines WHERE key=?").bind(key).first();
  if(exist){
    await env.DB.prepare("UPDATE outlines SET label=?, chapters=?, updated_at=? WHERE key=?")
      .bind(label, chapStr, Date.now(), key).run();
  }else{
    await env.DB.prepare("INSERT INTO outlines(key, label, chapters, updated_at) VALUES(?,?,?,?)")
      .bind(key, label, chapStr, Date.now()).run();
  }
  return json({ok:true, key});
}

export async function onRequestDelete(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可删除大纲"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
  const url = new URL(request.url);
  const key = url.searchParams.get("key")||"";
  await env.DB.prepare("DELETE FROM outlines WHERE key=?").bind(key).run();
  return json({ok:true});
}
