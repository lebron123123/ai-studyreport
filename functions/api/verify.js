// Cloudflare Pages Function
// 访问路径：POST /api/verify
// 作用：单纯校验访问口令对不对，用于网站"登录门禁"，和后面生不生成报告无关

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "请求格式有误" }, 400);
  }

  const code = (body && body.code) || "";
  const expected = env.ACCESS_CODE || "";

  if (!expected || code !== expected) {
    return json({ ok: false, error: "口令错误，请联系管理员获取正确口令。" }, 401);
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
