// POST /api/generate  AI生成接口（需登录，按用户每日限额）
import { verifyAuth, json } from "./_auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const user = await verifyAuth(request, env);
  if(!user) return json({ error: "未登录或登录已过期，请重新登录后再生成。" }, 401);

  // 每用户每日限额
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

  const upstream = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
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

  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

  if (env.USAGE_KV) {
    await env.USAGE_KV.put(kvKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
  }

  return json({ content: [{ type: "text", text }], usage: data.usage || null });
}
