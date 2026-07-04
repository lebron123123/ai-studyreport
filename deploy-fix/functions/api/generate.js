// Cloudflare Pages Function
// 访问路径：POST /api/generate
// 作用：前端不再直接持有API Key，所有请求都先经过这里校验，再由这里代为调用Anthropic

export async function onRequestPost(context) {
  const { request, env } = context;

  // ---- 第一层防护：访问口令 ----
  // 在 Cloudflare 后台把 ACCESS_CODE 设置成你自己定的口令，只把口令发给要用的人
  const code = request.headers.get("x-access-code") || "";
  if (!env.ACCESS_CODE || code !== env.ACCESS_CODE) {
    return json({ error: "访问口令错误或未填写，请联系管理员获取口令。" }, 401);
  }

  // ---- 第二层防护：每日总调用次数上限 ----
  // 防止口令泄露或使用过于频繁导致API账单失控，可自行调整 DAILY_LIMIT
  const DAILY_LIMIT = 200;
  const today = new Date().toISOString().slice(0, 10);
  const kvKey = `usage:${today}`;

  let used = 0;
  if (env.USAGE_KV) {
    used = parseInt((await env.USAGE_KV.get(kvKey)) || "0", 10);
    if (used >= DAILY_LIMIT) {
      return json({ error: "今日生成次数已达上限，请明天再试，或联系管理员调整限额。" }, 429);
    }
  }

  // ---- 转发给 Anthropic ----
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式有误" }, 400);
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: body.system,
      messages: body.messages,
    }),
  });

  const data = await upstream.json();

  if (env.USAGE_KV) {
    // 计数+1，两天后自动过期，不需要手动清理
    await env.USAGE_KV.put(kvKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
  }

  return json(data, upstream.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
