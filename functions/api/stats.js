// /api/stats  运维可观测性看板（仅管理员可读）
// GET   今日AI调用量占全站上限比例、向量化缓存命中率与Ollama平均耗时(仅本地部署有)
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}
function passOk(env, request){
  if(!env.ADMIN_PASS) return true;
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
}

// 与 generate.js 的限额配置保持一致——独立维护一份而不是互相import，
// 是因为这两个文件各自作为独立的Pages Function部署，改这几个数字的地方本来就该在generate.js，
// 这里只是"展示口径"，真正生效的限流判断以generate.js里那份为准，不会因为这里没同步而影响限流本身。
const LIMITS = { chat: 400, batch: 200, global: 10000 };

export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可查看运维看板"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);

  const today = new Date().toISOString().slice(0, 10);
  const out = { today, limits: LIMITS };

  // 今日AI调用量：全站汇总 + 按用户拆分的chat/batch各自前10名（谁在大量消耗额度一眼看出来）
  try{
    const g = await env.DB.prepare("SELECT cnt FROM usage_counters WHERE ckey=?").bind("g:"+today).first();
    out.globalToday = g ? g.cnt : 0;
    const topUsersOf = async (kind) => {
      const rows = await env.DB.prepare(
        "SELECT ckey, cnt FROM usage_counters WHERE ckey LIKE ? ORDER BY cnt DESC LIMIT 10"
      ).bind("u:"+kind+":%:"+today).all();
      return (rows.results||[]).map(r=>{
        const parts = r.ckey.split(":");   // u:kind:userId:date
        return { userId: parts[2], cnt: r.cnt };
      });
    };
    out.topChatUsers = await topUsersOf("chat");
    out.topBatchUsers = await topUsersOf("batch");
  }catch(e){
    out.usageError = "usage_counters表读取失败："+e.message;
  }

  // 向量化缓存命中率/Ollama耗时：只有本地部署(env.AI是ai-ollama.js的适配器)才有这个方法，
  // 云端用的是Cloudflare Workers AI原生绑定，没有这个自定义方法，如实返回null而不是报错
  out.vectorCache = (env.AI && typeof env.AI._cacheStats === "function") ? env.AI._cacheStats() : null;

  return json({ok:true, ...out});
}
