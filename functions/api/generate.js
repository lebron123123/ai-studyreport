// POST /api/generate  AI生成接口（登录鉴权 + 分池限额 + 全站熔断 + 流式/非流式双模式）
import { verifyAuth, json } from "./_auth.js";

import { adaptEnv } from "./_adapters.js";
/* ===== 限额设计 =====
   为什么分池：Agent回答"一个问题"要调用本接口2~5次（作答/调工具/自我核查/收尾），
   而生成一篇完整可研报告要调用约40次。若共用一个池子，用户生成两三篇报告
   当天就再也不能用AI问答了——这不符合实际使用预期。故拆成两个独立额度：
     chat  日常问答、办公助手、悬浮助手（前端不传 kind 即归此池）
     batch 报告逐节生成、逐节AI评审（前端传 kind:"batch"）
   另设全站熔断：兜住"某天异常放量"导致的费用失控，个人额度放宽的前提是有这道闸。 */
const LIMITS = {
  chat:   400,     // 约 130 次问答/人/天
  batch:  200,     // 约 4~5 篇报告或评审/人/天
  global: 10000,   // 全站所有用户合计/天，成本上限约 $5/天
};

/* 原子计数：用 D1 的 UPSERT + RETURNING 一步完成"加一并取回新值"。
   原来用 KV 做计数有两个硬伤：①KV 最终一致，读到的可能是60秒前的旧值；
   ②"读-取值-写回"三步之间没有原子性，Agent 连打3~5次接口会读到同一个旧值，
   导致实际扣减次数少于真实调用量，限额形同虚设。D1 是强一致的，UPSERT 天然原子。 */
async function bump(env, key, delta){
  const now = Date.now();
  // 写法说明：DO UPDATE 子句里用【表名限定的列】+【excluded】引用待插入值。
  // 两个原因：
  //  ① 不写表名的话，PostgreSQL 会报 "column reference cnt is ambiguous"
  //     （分不清是表里的列还是待插入的值），本地化部署时会直接挂掉；
  //  ② 用 excluded.cnt 取增量，就不必把同一个参数传两遍。
  // 这个写法在 SQLite(D1) 和 PostgreSQL 上实测行为一致，两边都能跑。
  const row = await env.DB.prepare(
    "INSERT INTO usage_counters(ckey, cnt, updated_at) VALUES(?, ?, ?) " +
    "ON CONFLICT(ckey) DO UPDATE SET cnt = usage_counters.cnt + excluded.cnt, " +
    "updated_at = excluded.updated_at RETURNING cnt"
  ).bind(key, delta, now).first();
  return row ? row.cnt : 0;
}
// 退还额度：上游调用失败时不该让用户为没发生的调用买单；失败也不阻断主流程
async function refund(env, userKey, globalKey){
  try{ await bump(env, userKey, -1); }catch(e){}
  try{ await bump(env, globalKey, -1); }catch(e){}
}

export async function onRequestPost(context) {
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现

  const user = await verifyAuth(request, env);
  if(!user) return json({ error: "未登录或登录已过期，请重新登录后再生成。" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "请求格式有误" }, 400); }

  const kind = (body.kind === "batch") ? "batch" : "chat";
  const today = new Date().toISOString().slice(0, 10);
  const userKey = "u:" + kind + ":" + user.userId + ":" + today;
  const globalKey = "g:" + today;

  /* 先占额度再调用上游（预留式）：先加一，拿到新值再判断是否超限。
     这样并发请求也挤不过同一道闸；若上游调用失败，后面会退还这一次。 */
  let userCount = 0, globalCount = 0, counted = false;
  if (env.DB) {
    try{
      userCount = await bump(env, userKey, 1);
      globalCount = await bump(env, globalKey, 1);
      counted = true;
    }catch(e){ counted = false; }   // 计数表异常时放行但不计数，不因限流组件故障导致全站不可用
  }

  if (counted) {
    if (globalCount > LIMITS.global) {
      await refund(env, userKey, globalKey);
      return json({ error: "全站今日AI调用量已达上限，请明天再试（如需提升请联系管理员）。" }, 429);
    }
    if (userCount > LIMITS[kind]) {
      await refund(env, userKey, globalKey);
      const what = kind === "batch" ? "报告生成/批量评审" : "AI问答";
      return json({ error: "您今日的" + what + "次数已达上限（" + LIMITS[kind] + "次），请明天再试。"
        + (kind === "batch" ? "（日常AI问答有独立额度，不受此限制）" : "（报告生成有独立额度，不受此限制）") }, 429);
    }
  }

  const dsMessages = [
    { role: "system", content: body.system || "" },
    ...(body.messages || []),
  ];

  const wantStream = !!body.stream;

  // 工具调用(function calling)透传:仅在非流式的Agent问答场景使用,普通生成不受影响
  // 2026-07-24：DeepSeek 官方下线了 deepseek-chat 这个旧别名(过渡期内它指向 deepseek-v4-flash 的"非思考模式")，
  // 改成显式的新模型名。V4系列默认开启"思考模式"——如果只改模型名不管这个，会带来两个问题：
  // ①思考模式会多吐大量推理token，拖慢速度、拉高成本；②本站Agent多轮工具调用在思考模式下容易触发
  // "reasoning_content must be passed back"报错。显式关闭thinking，行为和之前的deepseek-chat完全一致。
  const dsModel = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  // 普通问答1200 token足够；AI PPT等结构化长输出可显式申请更高上限，但服务器封顶4000，避免失控。
  const maxTokens = Math.max(200, Math.min(4000, Number(body.max_tokens) || 1200));
  const dsPayload = {
    model: dsModel,
    messages: dsMessages,
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: wantStream,
    thinking: { type: "disabled" },
  };
  if(Array.isArray(body.tools) && body.tools.length){
    dsPayload.tools = body.tools;
    dsPayload.tool_choice = body.tool_choice || "auto";
  }

  // 大模型地址抽成环境变量：DeepSeek 用的是 OpenAI 标准格式，而 vLLM / Ollama / LM Studio
  // 等本地推理服务同样提供 OpenAI 兼容端点。将来要把AI换成本地跑，只需在部署时改这个变量
  // 指向内网地址即可，本文件及全部业务代码一行都不用动。
  const llmUrl = env.LLM_BASE_URL || "https://api.deepseek.com/chat/completions";
  let upstream;
  try{
    upstream = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify(dsPayload),
    });
  }catch(e){
    if (counted) await refund(env, userKey, globalKey);
    return json({ error: "上游AI接口连接失败：" + e.message }, 502);
  }

  if (!upstream.ok) {
    if (counted) await refund(env, userKey, globalKey);
    const data = await upstream.json().catch(()=>({}));
    const msg = (data && data.error && data.error.message) || "上游AI接口调用失败";
    return json({ error: msg }, upstream.status);
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

// GET /api/generate  查询本人今日用量（供界面显示"今日还剩多少次"）
export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ ok:false, error:"未登录" }, 401);
  const today = new Date().toISOString().slice(0, 10);
  const read = async (k)=>{
    try{
      const r = await env.DB.prepare("SELECT cnt FROM usage_counters WHERE ckey=?").bind(k).first();
      return r ? r.cnt : 0;
    }catch(e){ return 0; }
  };
  const chat  = await read("u:chat:"  + user.userId + ":" + today);
  const batch = await read("u:batch:" + user.userId + ":" + today);
  return json({ ok:true, today,
    chat:  { used: chat,  limit: LIMITS.chat,  left: Math.max(0, LIMITS.chat  - chat)  },
    batch: { used: batch, limit: LIMITS.batch, left: Math.max(0, LIMITS.batch - batch) } });
}
