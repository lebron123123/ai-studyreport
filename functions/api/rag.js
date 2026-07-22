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
      const sec = parseInt(body.security)||1;                       // 密级:1公开 2内部 3涉密
      const dscope = String(body.deptScope||"全部门").slice(0,40);   // 可见部门
      const ids = items.map(it=>it.id);
      const row = await env.DB.prepare("SELECT ids, chunks FROM rag_files_v2 WHERE title=?").bind(title).first();
      if(row){
        const all = JSON.parse(row.ids).concat(ids);
        await env.DB.prepare("UPDATE rag_files_v2 SET ids=?, chunks=?, category=?, level=?, security=?, dept_scope=?, created_at=? WHERE title=?")
          .bind(JSON.stringify(all), all.length, cat, lvl, sec, dscope, Date.now(), title).run();
      }else{
        await env.DB.prepare("INSERT INTO rag_files_v2(title, ids, chunks, category, level, enabled, security, dept_scope, created_at) VALUES(?,?,?,?,?,1,?,?,?)")
          .bind(title, JSON.stringify(ids), ids.length, cat, lvl, sec, dscope, Date.now()).run();
      }
    }catch(e){}
    return json({ok:true, count: items.length});
  }

  if(body.action === "query"){
    const q = String(body.query||"").trim().slice(0, 500);
    if(!q) return json({ok:false, error:"查询为空"}, 400);
    const topK = Math.min(parseInt(body.topK)||3, 8);
    // 第一级:向量大召回(上万份材料时,固定20会漏,扩大到40候选)
    const recall = Math.min(parseInt(body.recall)||40, 60);
    const [vec] = await embed(env, [q]);
    const r = await env.VECTORIZE.query(vec, { topK: recall, returnMetadata: "all" });
    // 读取当前用户的部门与权限等级(默认:无部门、等级1只能看公开)
    let myDept = "", myClearance = 1;
    try{
      const u = await env.DB.prepare("SELECT department, clearance FROM users WHERE id=?").bind(user.userId).first();
      if(u){ myDept = u.department||""; myClearance = parseInt(u.clearance)||1; }
    }catch(e){}
    // 读取文件权限信息(停用/密级/可见部门)——按标题过滤,改权限无需重新向量化
    let disabled = new Set();
    let permMap = {};   // title -> {security, dept_scope}
    try{
      const dr = await env.DB.prepare("SELECT title, enabled, security, dept_scope FROM rag_files_v2").all();
      (dr.results||[]).forEach(x=>{
        if(x.enabled===0) disabled.add(x.title);
        permMap[x.title] = { security: parseInt(x.security)||1, dept_scope: x.dept_scope||"全部门" };
      });
    }catch(e){}
    // 权限判定:用户可见 = 密级≤本人等级 且 (文件全部门可见 或 属本人部门)
    const iAmAdmin = isAdmin(env, user);   // 管理员豁免:始终可见全部
    const canSee = (title)=>{
      if(iAmAdmin) return true;
      const p = permMap[title];
      if(!p) return true;   // 台账无记录(早期入库)默认可见,不误伤
      if(p.security > myClearance) return false;
      if(p.dept_scope && p.dept_scope !== "全部门" && p.dept_scope !== myDept) return false;
      return true;
    };
    const wantCat = body.category ? String(body.category) : null;  // 指定分类则只检索该类
    const LW = {1:1.15, 2:1.0, 3:0.85};   // 等级加权:权威×1.15 参考×1.0 存档×0.85
    // 混合检索:从查询里提取关键词(2字以上的中文词/英文词),命中正文/标题则加分
    const kws = (q.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z]{2,}|\d{2,}/g) || []).slice(0, 8);
    let matches = (r.matches||[]).map(m=>{
      const md = m.metadata||{};
      const lvl = parseInt(md.level)||2;
      // 关键词命中:每命中一个不同关键词,加0.03分(在标题命中权重更高,加0.05)
      const hay = String(md.text||"") + " " + String(md.title||"") + String(md.chapter||"") + String(md.section||"");
      const titleHay = String(md.title||"") + String(md.chapter||"") + String(md.section||"");
      let kwBonus = 0, kwHitList = [];
      kws.forEach(k=>{
        if(titleHay.includes(k)){ kwBonus += 0.05; kwHitList.push(k); }
        else if(hay.includes(k)){ kwBonus += 0.03; kwHitList.push(k); }
      });
      const base = m.score * (LW[lvl]||1);
      return {
        rawScore: m.score,
        score: Math.round((base + kwBonus) * 1000)/1000,
        kwHits: kwHitList,
        title: md.title, chapter: md.chapter, section: md.section,
        category: md.category||"未分类", level: lvl, text: md.text,
      };
    }).filter(m=>{
      if(disabled.has(m.title)) return false;
      if(!canSee(m.title)) return false;   // 权限过滤:越权文档不返回
      if(wantCat && m.category !== wantCat) return false;
      return true;
    });
    matches.sort((a,b)=>b.score-a.score);

    // 第二级:Rerank精排(用bge-reranker对粗排候选重新打分)
    // 取粗排前若干个送重排(reranker有512token限制,截取每块前1000字符)
    const rerankN = Math.min(matches.length, 20);
    const useRerank = body.rerank !== false && rerankN > 1;
    if(useRerank){
      try{
        const cand = matches.slice(0, rerankN);
        const contexts = cand.map(m=>({ text: String(m.text||"").slice(0, 1000) }));
        const rr = await env.AI.run("@cf/baai/bge-reranker-base", { query: q, contexts, top_k: rerankN });
        // rr.response: [{id/index, score}] —— 按重排分重新排序
        const ranked = (rr && (rr.response || rr.results || rr)) || [];
        if(Array.isArray(ranked) && ranked.length){
          const reordered = [];
          ranked.forEach(item=>{
            const idx = (item.id !== undefined) ? item.id : item.index;
            if(idx !== undefined && cand[idx]){
              cand[idx].rerankScore = Math.round((item.score||0)*1000)/1000;
              reordered.push(cand[idx]);
            }
          });
          // 重排成功:用重排结果 + 剩余未重排的候选兜底
          if(reordered.length){
            const rest = matches.slice(rerankN);
            matches = reordered.concat(rest);
          }
        }
      }catch(e){ /* 重排失败则退回向量粗排,不影响可用性 */ }
    }
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
    const rows = await env.DB.prepare("SELECT title, chunks, category, level, enabled, security, dept_scope, created_at FROM rag_files_v2 ORDER BY created_at DESC LIMIT 500").all();
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

  if(body.action === "feedback"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    await env.DB.prepare("INSERT INTO rag_feedback(query, title, useful, created_at) VALUES(?,?,?,?)")
      .bind(String(body.query||"").slice(0,200), String(body.title||"").slice(0,80), body.useful?1:0, Date.now()).run();
    return json({ok:true});
  }

  if(body.action === "logs"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT l.query, l.category, l.hit_titles, l.hit_count, l.top_score, l.created_at, u.username FROM rag_logs l LEFT JOIN users u ON l.user_id=u.id ORDER BY l.id DESC LIMIT 200").all();
    return json({ok:true, logs: rows.results||[]});
  }

  if(body.action === "graph"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT title, category, level FROM rag_files_v2 WHERE enabled=1 LIMIT 60").all();
    const files = rows.results || [];
    // 节点=文件,边=同分类 或 标题共享2字以上词
    const nodes = files.map((f,i)=>({id:i, title:f.title, category:f.category||"未分类", level:parseInt(f.level)||2}));
    const edges = [];
    const tokenize = t => (String(t).match(/[\u4e00-\u9fa5]{2,}|[A-Za-z]{3,}/g)||[]);
    for(let i=0;i<files.length;i++){
      for(let j=i+1;j<files.length;j++){
        let weight = 0, reason = "";
        if(files[i].category === files[j].category){ weight += 1; reason = "同类"; }
        // 标题共词
        const ti = new Set(tokenize(files[i].title)), tj = tokenize(files[j].title);
        const shared = tj.filter(w=>ti.has(w));
        if(shared.length){ weight += shared.length; reason = (reason?reason+"+":"")+"共词:"+shared.slice(0,2).join(","); }
        if(weight >= 1 && reason.includes("共词")) edges.push({source:i, target:j, weight, reason});
        else if(weight >= 1 && files[i].category===files[j].category && edges.filter(e=>e.source===i||e.target===i).length<3) edges.push({source:i, target:j, weight, reason});
      }
    }
    return json({ok:true, graph:{nodes, edges}});
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
      // 反馈统计:被标"无关"最多的文件(检索质量差,建议核查)
      const fb = await env.DB.prepare("SELECT title, SUM(CASE WHEN useful=1 THEN 1 ELSE 0 END) as good, SUM(CASE WHEN useful=0 THEN 1 ELSE 0 END) as bad FROM rag_feedback GROUP BY title HAVING bad > 0 ORDER BY bad DESC LIMIT 10").all();
      out.poorFiles = (fb.results||[]).map(f=>({title:f.title, good:f.good, bad:f.bad}));
    }catch(e){ out.error = e.message; }
    return json({ok:true, dashboard: out});
  }

  if(body.action === "users"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT id, username, department, clearance, created_at FROM users ORDER BY id DESC LIMIT 500").all();
    return json({ok:true, users: rows.results||[]});
  }

  if(body.action === "setUserPerm"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const uid = parseInt(body.userId);
    const dept = String(body.department||"").slice(0,40);
    const clr = Math.min(Math.max(parseInt(body.clearance)||1, 1), 3);
    await env.DB.prepare("UPDATE users SET department=?, clearance=? WHERE id=?").bind(dept, clr, uid).run();
    return json({ok:true});
  }

  if(body.action === "setScope"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const sec = Math.min(Math.max(parseInt(body.security)||1, 1), 3);
    const dscope = String(body.deptScope||"全部门").slice(0,40);
    await env.DB.prepare("UPDATE rag_files_v2 SET security=?, dept_scope=? WHERE title=?").bind(sec, dscope, title).run();
    return json({ok:true});
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
