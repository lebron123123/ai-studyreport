// Cloudflare Pages Function
// 访问路径：POST /api/generate
// 本版本对接 DeepSeek 的 API（OpenAI兼容格式）

export async function onRequestPost(context) {
  const { request, env } = context;

  // ---- 第一层防护：访问口令 ----
  const code = request.headers.get("x-access-code") || "";
  if (!env.ACCESS_CODE || code !== env.ACCESS_CODE) {
    return json({ error: "访问口令错误或未填写，请联系管理员获取口令。" }, 401);
  }

  // ---- 第二层防护：每日总调用次数上限 ----
  const DAILY_LIMIT = 200;
  const today = new Date().toISOString().slice(0, 10);
  const kvKey = `usage:${today}`;

  let used = 0;
  if (env.USAGE_KV) {
    used = parseInt((await env.USAGE_KV.get(kvKey)) || "0", 10);
    if (used >= DAILY_LIMIT) {
      return json({ error: "今日生成次数已达上限，请明天再试。" }, 429);
    }
  }

  // ---- 解析前端请求 ----
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式有误" }, 400);
  }

  // ---- 转发给 DeepSeek（OpenAI兼容格式：system作为第一条消息） ----
  const dsMessages = [
    { role: "system", content: body.system || "" },
    ...(body.messages || []),
  ];

  const upstream = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: dsMessages,
      max_tokens: 1200,
      temperature: 0.3,
    }),
  });

  const data = await upstream.json();

  if (!upstream.ok) {
    const msg = (data && data.error && data.error.message) || "上游AI接口调用失败";
    return json({ error: msg }, upstream.status);
  }

  // ---- 把DeepSeek的返回格式转换成前端期望的格式（content数组） ----
  const text =
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

  if (env.USAGE_KV) {
    await env.USAGE_KV.put(kvKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
  }

  return json({ content: [{ type: "text", text }] });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
