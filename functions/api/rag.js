// /api/rag  全量RAG知识库（Vectorize + Workers AI bge-m3）
// POST {action:"upsert", chunks:[{title,chapter,section,text}]}  管理员入库
// POST {action:"query", query, topK}                             登录用户检索
// POST {action:"stats"}                                          管理员查看规模
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

async function embed(env, texts){
  // bge-m3：中文语义向量，1024维
  const r = await env.AI.run("@cf/baai/bge-m3", { text: texts });
  return r.data;   // number[][]
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!env.VECTORIZE || !env.AI) return json({ok:false, error:"未绑定 VECTORIZE / AI，请按部署说明配置"}, 500);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"格式有误"}, 400); }

  if(body.action === "upsert"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可入库"}, 403);
    const chunks = (body.chunks||[]).slice(0, 20);   // 每请求最多20块
    if(!chunks.length) return json({ok:false, error:"无内容"}, 400);
    const texts = chunks.map(c=>String(c.text||"").slice(0, 2500));
    const vecs = await embed(env, texts);
    const now = Date.now();
    const items = chunks.map((c,i)=>({
      id: "c" + now + "_" + i + "_" + Math.random().toString(36).slice(2,8),
      values: vecs[i],
      metadata: {
        title: String(c.title||"").slice(0,80),
        chapter: String(c.chapter||"").slice(0,50),
        section: String(c.section||"").slice(0,80),
        text: texts[i],
      },
    }));
    await env.VECTORIZE.upsert(items);
    return json({ok:true, count: items.length});
  }

  if(body.action === "query"){
    const q = String(body.query||"").trim().slice(0, 500);
    if(!q) return json({ok:false, error:"查询为空"}, 400);
    const topK = Math.min(parseInt(body.topK)||3, 5);
    const [vec] = await embed(env, [q]);
    const r = await env.VECTORIZE.query(vec, { topK, returnMetadata: "all" });
    const matches = (r.matches||[]).map(m=>({
      score: Math.round(m.score*1000)/1000,
      title: m.metadata && m.metadata.title,
      chapter: m.metadata && m.metadata.chapter,
      section: m.metadata && m.metadata.section,
      text: m.metadata && m.metadata.text,
    }));
    return json({ok:true, matches});
  }

  if(body.action === "stats"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    try{
      const d = await env.VECTORIZE.describe();
      return json({ok:true, count: d.vectorCount ?? d.vectorsCount ?? null, dimensions: d.dimensions});
    }catch(e){ return json({ok:true, count: null}); }
  }

  return json({ok:false, error:"未知操作"}, 400);
}
