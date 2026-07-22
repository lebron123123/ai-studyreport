// /api/rag  全量RAG知识库（Vectorize + Workers AI bge-m3）
// POST {action:"upsert", chunks:[{title,chapter,section,text}]}  管理员入库
// POST {action:"query", query, topK}                             登录用户检索
// POST {action:"stats"}                                          管理员查看规模
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

function passOk(env, request){
  if(!env.ADMIN_PASS) return true;   // 未配置则不启用
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
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
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
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
        category: String(body.category||"未分类").slice(0,30),
        level: parseInt(body.level)||2,
        text: texts[i],
      },
    }));
    await env.VECTORIZE.upsert(items);
    // 登记入库台账（同名文件多批次累加）
    try{
      const title = String(chunks[0].title||"未命名").slice(0,80);
      const cat = String(body.category||"未分类").slice(0,30);
      const lvl = parseInt(body.level)||2;
      const ids = items.map(it=>it.id);
      const row = await env.DB.prepare("SELECT ids, chunks FROM rag_files_v2 WHERE title=?").bind(title).first();
      if(row){
        const all = JSON.parse(row.ids).concat(ids);
        await env.DB.prepare("UPDATE rag_files_v2 SET ids=?, chunks=?, category=?, level=?, created_at=? WHERE title=?")
          .bind(JSON.stringify(all), all.length, cat, lvl, Date.now(), title).run();
      }else{
        await env.DB.prepare("INSERT INTO rag_files_v2(title, ids, chunks, category, level, enabled, created_at) VALUES(?,?,?,?,?,1,?)")
          .bind(title, JSON.stringify(ids), ids.length, cat, lvl, Date.now()).run();
      }
    }catch(e){}
    return json({ok:true, count: items.length});
  }

  if(body.action === "query"){
    const q = String(body.query||"").trim().slice(0, 500);
    if(!q) return json({ok:false, error:"查询为空"}, 400);
    const topK = Math.min(parseInt(body.topK)||3, 5);
    // 取回更多候选,再按分类过滤/等级加权后截取
    const [vec] = await embed(env, [q]);
    const r = await env.VECTORIZE.query(vec, { topK: Math.min(topK*3, 20), returnMetadata: "all" });
    // 读取已停用文件标题(停用的不参与检索)
    let disabled = new Set();
    try{
      const dr = await env.DB.prepare("SELECT title FROM rag_files_v2 WHERE enabled=0").all();
      (dr.results||[]).forEach(x=>disabled.add(x.title));
    }catch(e){}
    const wantCat = body.category ? String(body.category) : null;  // 指定分类则只检索该类
    const LW = {1:1.15, 2:1.0, 3:0.85};   // 等级加权:权威×1.15 参考×1.0 存档×0.85
    let matches = (r.matches||[]).map(m=>{
      const md = m.metadata||{};
      const lvl = parseInt(md.level)||2;
      return {
        rawScore: m.score,
        score: Math.round(m.score * (LW[lvl]||1) * 1000)/1000,
        title: md.title, chapter: md.chapter, section: md.section,
        category: md.category||"未分类", level: lvl, text: md.text,
      };
    }).filter(m=>{
      if(disabled.has(m.title)) return false;
      if(wantCat && m.category !== wantCat) return false;
      return true;
    });
    matches.sort((a,b)=>b.score-a.score);
    matches = matches.slice(0, topK);
    // 记录检索日志(可追溯)
    try{
      const titles = matches.map(m=>m.title).filter(Boolean).slice(0,5).join("；");
      await env.DB.prepare("INSERT INTO rag_logs(user_id, query, category, hit_titles, hit_count, top_score, created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(user.userId, q.slice(0,200), wantCat||"", titles, matches.length, matches[0]?matches[0].score:0, Date.now()).run();
    }catch(e){}
    return json({ok:true, matches});
  }

  if(body.action === "stats"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    try{
      const d = await env.VECTORIZE.describe();
      return json({ok:true, count: d.vectorCount ?? d.vectorsCount ?? null, dimensions: d.dimensions});
    }catch(e){ return json({ok:true, count: null}); }
  }

  if(body.action === "list"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT title, chunks, category, level, enabled, created_at FROM rag_files_v2 ORDER BY created_at DESC LIMIT 500").all();
    return json({ok:true, files: rows.results||[]});
  }

  if(body.action === "toggle"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const en = body.enabled ? 1 : 0;
    await env.DB.prepare("UPDATE rag_files_v2 SET enabled=? WHERE title=?").bind(en, title).run();
    return json({ok:true, enabled: en});
  }

  if(body.action === "setMeta"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const cat = String(body.category||"未分类").slice(0,30);
    const lvl = parseInt(body.level)||2;
    await env.DB.prepare("UPDATE rag_files_v2 SET category=?, level=? WHERE title=?").bind(cat, lvl, title).run();
    return json({ok:true});
  }

  if(body.action === "logs"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT query, category, hit_titles, hit_count, top_score, created_at FROM rag_logs ORDER BY id DESC LIMIT 200").all();
    return json({ok:true, logs: rows.results||[]});
  }

  if(body.action === "dashboard"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const out = {};
    try{
      // 各分类文件数与块数
      const cat = await env.DB.prepare("SELECT category, COUNT(*) as files, SUM(chunks) as chunks, SUM(CASE WHEN enabled=0 THEN 1 ELSE 0 END) as disabled FROM rag_files_v2 GROUP BY category").all();
      out.byCategory = cat.results||[];
      // 各等级文件数
      const lv = await env.DB.prepare("SELECT level, COUNT(*) as files FROM rag_files_v2 GROUP BY level").all();
      out.byLevel = lv.results||[];
      // 检索总次数与近7天
      const tot = await env.DB.prepare("SELECT COUNT(*) as n FROM rag_logs").first();
      out.totalQueries = tot ? tot.n : 0;
      const wk = await env.DB.prepare("SELECT COUNT(*) as n FROM rag_logs WHERE created_at > ?").bind(Date.now()-7*86400000).first();
      out.weekQueries = wk ? wk.n : 0;
      // 命中最频繁的文件Top10
      const hot = await env.DB.prepare("SELECT hit_titles FROM rag_logs WHERE hit_titles != '' ORDER BY id DESC LIMIT 500").all();
      const freq = {};
      (hot.results||[]).forEach(r=>{ String(r.hit_titles||"").split("；").forEach(t=>{ if(t) freq[t]=(freq[t]||0)+1; }); });
      out.hotFiles = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([title,n])=>({title,n}));
      // 从未被检索命中的文件(冷门/可疑垃圾)
      const allF = await env.DB.prepare("SELECT title FROM rag_files_v2").all();
      const hitSet = new Set(Object.keys(freq));
      out.coldFiles = (allF.results||[]).map(f=>f.title).filter(t=>!hitSet.has(t)).slice(0,20);
    }catch(e){ out.error = e.message; }
    return json({ok:true, dashboard: out});
  }

  if(body.action === "deleteByTitle"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可删除"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const row = await env.DB.prepare("SELECT ids FROM rag_files_v2 WHERE title=?").bind(title).first();
    if(!row) return json({ok:false, error:"台账中未找到该文件（可能是早期版本入库，需重建索引清理）"}, 404);
    const ids = JSON.parse(row.ids);
    for(let i=0; i<ids.length; i+=100){
      await env.VECTORIZE.deleteByIds(ids.slice(i, i+100));
    }
    await env.DB.prepare("DELETE FROM rag_files_v2 WHERE title=?").bind(title).run();
    return json({ok:true, deleted: ids.length});
  }

  return json({ok:false, error:"未知操作"}, 400);
}
