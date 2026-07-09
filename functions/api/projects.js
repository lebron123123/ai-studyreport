// /api/projects  云端项目库（需登录）
// GET            ?id=xxx 读取单个；不带id返回项目列表
// POST           {id, name, data} 新建或更新（仅限本人项目）
// DELETE         ?id=xxx 删除本人项目
import { verifyAuth, json } from "./_auth.js";

export async function onRequestGet(context){
  const { request, env } = context;
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
    "SELECT id, name, updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 100")
    .bind(user.userId).all();
  return json({ok:true, list: rows.results||[]});
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const id = String(body.id||"");
  const name = String(body.name||"未命名项目").slice(0,100);
  if(!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ok:false, error:"项目ID非法"}, 400);
  const dataStr = JSON.stringify(body.data||{});
  if(dataStr.length > 900000) return json({ok:false, error:"项目数据过大，无法保存"}, 413);

  const exist = await env.DB.prepare("SELECT user_id FROM projects WHERE id=?").bind(id).first();
  if(exist && exist.user_id !== user.userId) return json({ok:false, error:"无权限"}, 403);

  if(exist){
    await env.DB.prepare("UPDATE projects SET name=?, data=?, updated_at=? WHERE id=? AND user_id=?")
      .bind(name, dataStr, Date.now(), id, user.userId).run();
  }else{
    await env.DB.prepare("INSERT INTO projects(id, user_id, name, data, updated_at) VALUES(?,?,?,?,?)")
      .bind(id, user.userId, name, dataStr, Date.now()).run();
  }
  return json({ok:true, id});
}

export async function onRequestDelete(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id")||"";
  await env.DB.prepare("DELETE FROM projects WHERE id=? AND user_id=?").bind(id, user.userId).run();
  return json({ok:true});
}
