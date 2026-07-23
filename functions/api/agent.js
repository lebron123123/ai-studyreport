// /api/agent  Agent调用链路日志(自建,替代第三方LangSmith,数据不出本账号)
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}
function passOk(env, request){
  if(!env.ADMIN_PASS) return true;
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"格式有误"}, 400); }

  // 记录一次Agent调用链路(前端问答循环结束后调用,fire-and-forget)
  if(body.action === "trace"){
    try{
      await env.DB.prepare("INSERT INTO agent_traces(user_id, query, rounds, tool_calls, final_answer, duration_ms, created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(user.userId, String(body.query||"").slice(0,300), parseInt(body.rounds)||0,
          JSON.stringify(body.toolCalls||[]).slice(0,4000), String(body.finalAnswer||"").slice(0,1000),
          parseInt(body.durationMs)||0, Date.now()).run();
    }catch(e){}
    return json({ok:true});
  }

  // ===== 长期记忆:每个用户自己的偏好(用户可见可删,不是黑箱) =====
  if(body.action === "memGet"){
    const rows = await env.DB.prepare("SELECT mkey, mvalue, source, updated_at FROM agent_memory WHERE user_id=? ORDER BY updated_at DESC LIMIT 30")
      .bind(user.userId).all();
    return json({ok:true, memory: rows.results||[]});
  }

  if(body.action === "memSet"){
    const k = String(body.key||"").trim().slice(0,40);
    const v = String(body.value||"").trim().slice(0,200);
    if(!k || !v) return json({ok:false, error:"键与值不能为空"}, 400);
    // 上限保护:每人最多30条,超出时淘汰最旧的
    try{
      const cnt = await env.DB.prepare("SELECT COUNT(*) as n FROM agent_memory WHERE user_id=?").bind(user.userId).first();
      if(cnt && cnt.n >= 30){
        await env.DB.prepare("DELETE FROM agent_memory WHERE id = (SELECT id FROM agent_memory WHERE user_id=? ORDER BY updated_at ASC LIMIT 1)")
          .bind(user.userId).run();
      }
    }catch(e){}
    await env.DB.prepare("INSERT INTO agent_memory(user_id, mkey, mvalue, source, updated_at) VALUES(?,?,?,?,?) "
      + "ON CONFLICT(user_id, mkey) DO UPDATE SET mvalue=excluded.mvalue, source=excluded.source, updated_at=excluded.updated_at")
      .bind(user.userId, k, v, String(body.source||"auto").slice(0,10), Date.now()).run();
    return json({ok:true});
  }

  if(body.action === "memDelete"){
    const k = String(body.key||"").trim();
    if(k === "__ALL__"){
      await env.DB.prepare("DELETE FROM agent_memory WHERE user_id=?").bind(user.userId).run();
      return json({ok:true, cleared:true});
    }
    if(!k) return json({ok:false, error:"缺少key"}, 400);
    await env.DB.prepare("DELETE FROM agent_memory WHERE user_id=? AND mkey=?").bind(user.userId, k).run();
    return json({ok:true});
  }

  // 管理员查看调用记录(可观测,替代LangSmith的追踪面板)
  if(body.action === "list"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT id, user_id, query, rounds, tool_calls, final_answer, duration_ms, created_at FROM agent_traces ORDER BY id DESC LIMIT 100").all();
    return json({ok:true, traces: rows.results||[]});
  }

  if(body.action === "stats"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    const tot = await env.DB.prepare("SELECT COUNT(*) as n, AVG(rounds) as avgRounds, AVG(duration_ms) as avgMs FROM agent_traces").first();
    return json({ok:true, stats: tot || {n:0, avgRounds:0, avgMs:0}});
  }

  return json({ok:false, error:"未知操作"}, 400);
}
