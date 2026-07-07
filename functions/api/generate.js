// Cloudflare Pages Function
// 访问路径：POST /api/generate （正常生成）
//          GET  /api/generate?debug=1 （诊断：检查环境变量/KV是否配置到位，不会显示具体密钥内容）

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("debug") !== "1") {
    return json({ error: "此接口仅支持 POST，如需诊断请访问 ?debug=1" }, 405);
  }
  return json({
    诊断结果: {
      是否读到_ACCESS_CODE: !!env.ACCESS_CODE,
      是否读到_DEEPSEEK_API_KEY: !!env.DEEPSEEK_API_KEY,
      是否绑定_USAGE_KV: !!env.USAGE_KV,
    },
    说明: "上面三项应该都显示 true。如果某一项是 false，说明对应的变量/绑定没有真正传到这次部署里。",
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const code = request.headers.get("x-access-code") || "";
  if (!env.ACCESS_CODE || code !== env.ACCESS_CODE) {
    return json({ error: "访问口令错误或未填写，请联系管理员获取口令。" }, 401);
  }

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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "请求格式有误" }, 400);
  }

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
