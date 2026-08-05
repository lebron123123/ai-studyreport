// /api/calccases  历史项目测算案例库
// GET                列出已确认的案例（管理员可加 ?status=pending 看待审）
// POST               提交一个测算案例（默认待审核）
// PATCH  ?id=xx      审核：{action:"confirm"|"reject"} 或修改名称/备注（仅管理员）
// DELETE ?id=xx      删除（仅管理员）
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const TYPE_CN = { rent:"出租类", sale:"出售类", gaibao:"非居改保" };

// 与 rag.js 保持同一套管理员判定口径
function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "confirmed";
  const type = url.searchParams.get("type") || "";
  const id = url.searchParams.get("id");

  // 取单条：带完整参数，供"载入该项目参数"用
  if(id){
    const row = await env.DB.prepare("SELECT * FROM calc_cases WHERE id=?").bind(id).first();
    if(!row) return json({ok:false, error:"案例不存在"}, 404);
    if(row.status!=="confirmed" && !isAdmin(env,user) && row.user_id!==user.userId)
      return json({ok:false, error:"该案例尚未通过审核"}, 403);
    let params={}, summary={};
    try{ params=JSON.parse(row.params||"{}"); }catch(e){}
    try{ summary=JSON.parse(row.summary||"{}"); }catch(e){}
    return json({ok:true, item:{ id:row.id, name:row.name, calc_type:row.calc_type,
      location:row.location, note:row.note, status:row.status, params, summary,
      created_at:row.created_at }});
  }

  // 待审列表仅管理员可看；普通用户看已确认的 + 自己提交的
  let sql, binds=[];
  if(status==="pending"){
    if(!isAdmin(env,user)) return json({ok:false, error:"仅管理员可查看待审案例"}, 403);
    sql = "SELECT id,name,calc_type,location,note,status,summary,created_at,username FROM calc_cases WHERE status='pending'";
  }else{
    sql = "SELECT id,name,calc_type,location,note,status,summary,created_at,username FROM calc_cases WHERE status='confirmed'";
  }
  if(type){ sql += " AND calc_type=?"; binds.push(type); }
  sql += " ORDER BY created_at DESC LIMIT 300";
  const r = await env.DB.prepare(sql).bind(...binds).all();
  const list = (r.results||[]).map(x=>{
    let s={}; try{ s=JSON.parse(x.summary||"{}"); }catch(e){}
    return { id:x.id, name:x.name, calc_type:x.calc_type, typeCn:TYPE_CN[x.calc_type]||x.calc_type,
      location:x.location, note:x.note, status:x.status, username:x.username,
      created_at:x.created_at, summary:s };
  });
  return json({ok:true, list});
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  let b; try{ b=await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }

  const name = String(b.name||"").trim().slice(0,80);
  if(!name) return json({ok:false, error:"请填写项目名称"}, 400);
  const calc_type = String(b.calc_type||"").trim();
  if(!TYPE_CN[calc_type]) return json({ok:false, error:"测算类型不合法"}, 400);
  const params = JSON.stringify(b.params||{});
  const summary = JSON.stringify(b.summary||{});
  if(params.length > 200000) return json({ok:false, error:"参数数据过大"}, 413);

  // 同名同类型视为更新（重新测算后覆盖），避免同一项目反复堆积
  const exist = await env.DB.prepare(
    "SELECT id,status FROM calc_cases WHERE name=? AND calc_type=?").bind(name, calc_type).first();
  const now = Date.now();
  if(exist){
    await env.DB.prepare(
      "UPDATE calc_cases SET params=?, summary=?, location=?, note=?, status='pending', "+
      "user_id=?, username=?, created_at=? WHERE id=?"
    ).bind(params, summary, String(b.location||"").slice(0,120), String(b.note||"").slice(0,300),
           user.userId, user.username||"", now, exist.id).run();
    return json({ok:true, id:exist.id, updated:true, message:"已更新，等待管理员确认"});
  }
  const r = await env.DB.prepare(
    "INSERT INTO calc_cases(name, calc_type, location, note, params, summary, status, user_id, username, created_at) "+
    "VALUES(?,?,?,?,?,?,'pending',?,?,?)"
  ).bind(name, calc_type, String(b.location||"").slice(0,120), String(b.note||"").slice(0,300),
         params, summary, user.userId, user.username||"", now).run();
  return json({ok:true, id:(r.meta&&r.meta.last_row_id)||null, message:"已提交，等待管理员确认后进入案例库"});
}

export async function onRequestPatch(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  if(!isAdmin(env,user)) return json({ok:false, error:"仅管理员可审核"}, 403);
  const id = new URL(request.url).searchParams.get("id");
  if(!id) return json({ok:false, error:"缺少id"}, 400);
  let b; try{ b=await request.json(); }catch(e){ b={}; }

  if(b.action==="confirm" || b.action==="reject"){
    const st = b.action==="confirm" ? "confirmed" : "rejected";
    await env.DB.prepare("UPDATE calc_cases SET status=? WHERE id=?").bind(st, id).run();
    return json({ok:true, status:st});
  }
  // 修改名称/地点/备注
  await env.DB.prepare("UPDATE calc_cases SET name=COALESCE(?,name), location=COALESCE(?,location), note=COALESCE(?,note) WHERE id=?")
    .bind(b.name!=null?String(b.name).slice(0,80):null,
          b.location!=null?String(b.location).slice(0,120):null,
          b.note!=null?String(b.note).slice(0,300):null, id).run();
  return json({ok:true});
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  if(!isAdmin(env,user)) return json({ok:false, error:"仅管理员可删除"}, 403);
  const id = new URL(request.url).searchParams.get("id");
  if(!id) return json({ok:false, error:"缺少id"}, 400);
  await env.DB.prepare("DELETE FROM calc_cases WHERE id=?").bind(id).run();
  return json({ok:true});
}
