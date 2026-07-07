// Cloudflare Pages Function
// POST /api/generate         正常生成
// GET  /api/generate?debug=1 诊断环境变量/KV是否配置到位

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("debug") !== "1") {
    return json({ error: "此接口仅支持 POST，如需诊断请访问 ?debug=1" }, 405);
  }
  const ac = env.ACCESS_CODE || "";
  return json({
    是否读到_ACCESS_CODE: !!env.ACCESS_CODE,
    ACCESS_CODE长度: ac.length,
    ACCESS_CODE首尾字符: ac.length ? `${ac[0]}...${ac[ac.length - 1]}` : "",
    是否读到_DEEPSEEK_API_KEY: !!env.DEEPSEEK_API_KEY,
    是否绑定_USAGE_KV: !!env.USAGE_KV,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const code = request.headers.get("x-access-code") || "";
  const expected = env.ACCESS_CODE || "";

  if (!expected || code !== expected) {
    // 临时诊断信息：不显示真实内容，只显示长度和首尾字符，方便你对比是否有不可见字符
    return json(
      {
        error: "访问口令错误或未填写，请联系管理员获取口令。",
        诊断: {
          收到的口令长度: code.length,
          收到的口令首尾字符: code.length ? `${code[0]}...${code[code.length - 1]}` : "(空)",
          期望的口令长度: expected.length,
          期望的口令首尾字符: expected.length ? `${expected[0]}...${expected[expected.length - 1]}` : "(空)",
          两者是否相等: code === expected,
        },
      },
      401
    );
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
