// POST /api/generate  AI生成接口（登录鉴权 + 按用户限额 + 流式/非流式双模式） 
import { verifyAuth, json } from "./_auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const user = await verifyAuth(request, env);
  if(!user) return json({ error: "未登录或登录已过期，请重新登录后再生成。" }, 401);

  const USER_DAILY_LIMIT = 120;
  const today = new Date().toISOString().slice(0, 10);
  const kvKey = "usage:" + today + ":" + user.userId;
  let used = 0;
  if (env.USAGE_KV) {
    used = parseInt((await env.USAGE_KV.get(kvKey)) || "0", 10);
    if (used >= USER_DAILY_LIMIT) {
      return json({ error: "您今日的生成次数已达上限（"+USER_DAILY_LIMIT+"次），请明天再试。" }, 429);
    }
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "请求格式有误" }, 400); }

  const dsMessages = [
    { role: "system", content: body.system || "" },
    ...(body.messages || []),
  ];

  const wantStream = !!body.stream;

  // 工具调用(function calling)透传:仅在非流式的Agent问答场景使用,普通生成不受影响
  const dsPayload = {
    model: "deepseek-chat",
    messages: dsMessages,
    max_tokens: 1200,
    temperature: 0.3,
    stream: wantStream,
  };
  if(Array.isArray(body.tools) && body.tools.length){
    dsPayload.tools = body.tools;
    dsPayload.tool_choice = body.tool_choice || "auto";
  }

  const upstream = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify(dsPayload),
  });

  if (!upstream.ok) {
    const data = await upstream.json().catch(()=>({}));
    const msg = (data && data.error && data.error.message) || "上游AI接口调用失败";
    return json({ error: msg }, upstream.status);
  }

  // 计数+1
  if (env.USAGE_KV) {
    await env.USAGE_KV.put(kvKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
  }

  if (wantStream) {
    // 流式：直接透传 SSE 流
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } else {
    // 非流式：原逻辑
    const data = await upstream.json();
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const text = msg.content || "";
    // 有工具调用时一并返回,前端据此执行工具、回填结果、再次调用(ReAct循环)
    return json({ content: [{ type: "text", text }], tool_calls: msg.tool_calls || null, usage: data.usage || null });
  }
}
