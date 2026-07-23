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
