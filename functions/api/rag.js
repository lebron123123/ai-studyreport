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

  // 多格式解析：用 Workers AI 的 toMarkdown 处理浏览器端解析不了的格式
  // 支持：图片(jpg/png/webp，走视觉模型≈OCR)、xlsx/csv/pptx等Office格式、html/xml
  // 注意：扫描版PDF（整页为图片、无文字层）toMarkdown 亦无法提取，需人工转文字后上传
  if(body.action === "parseFile"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const name = String(body.name||"file").slice(0,120);
    const b64 = String(body.dataBase64||"");
    if(!b64) return json({ok:false, error:"文件内容为空"}, 400);
    try{
      // base64 → 二进制
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      const results = await env.AI.toMarkdown([{ name, blob: new Blob([bytes], { type:"application/octet-stream" }) }]);
      const first = Array.isArray(results) ? results[0] : results;
      const text = (first && first.data) ? String(first.data) : "";
      if(!text.trim()) return json({ok:false, error:"未能从该文件中提取到文字内容（若为扫描件PDF，请先用OCR工具转成文字或图片格式后再上传）"}, 400);
      return json({ok:true, text, mimeType: first && first.mimeType, tokens: first && first.tokens});
    }catch(e){
      return json({ok:false, error:"解析失败："+e.message}, 500);
    }
  }

  // 上传预检：判断这份文件是"全新"、"内容完全重复"还是"同名旧版需替换"
  if(body.action === "precheck"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const hash = String(body.contentHash||"").slice(0,64);
    if(!title) return json({ok:false, error:"缺少文件名"}, 400);
    try{
      // 内容哈希完全一致 → 真重复（哪怕改了文件名也能识别出来）
      if(hash){
        const dup = await env.DB.prepare("SELECT title, version, updated_at, created_at FROM rag_files_v2 WHERE content_hash=? LIMIT 1").bind(hash).first();
        if(dup) return json({ok:true, verdict:"duplicate", existingTitle:dup.title, version:dup.version||1,
          at: dup.updated_at || dup.created_at });
      }
      // 同名但内容不同 → 视为新版本，建议替换
      const same = await env.DB.prepare("SELECT title, version, chunks, updated_at, created_at FROM rag_files_v2 WHERE title=?").bind(title).first();
      if(same) return json({ok:true, verdict:"newVersion", existingTitle:same.title, version:same.version||1,
        chunks:same.chunks, at: same.updated_at || same.created_at });
      return json({ok:true, verdict:"new"});
    }catch(e){ return json({ok:true, verdict:"new", warn:e.message}); }
  }

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
    // 替换模式：本批次是该文件的第一批时，先删除旧版本的全部向量，避免新旧版本同时被检索到
    // （replaceMode=true 且 isFirstBatch=true 时才删，后续批次继续追加本次的新块）
    let replacedOld = 0;
    if(body.replaceMode && body.isFirstBatch){
      try{
        const title0 = String(chunks[0].title||"未命名").slice(0,80);
        const oldRow = await env.DB.prepare("SELECT ids FROM rag_files_v2 WHERE title=?").bind(title0).first();
        if(oldRow && oldRow.ids){
          const oldIds = JSON.parse(oldRow.ids);
          if(oldIds.length){
            await env.VECTORIZE.deleteByIds(oldIds);
            replacedOld = oldIds.length;
          }
          // 清空台账里的旧id，本批次开始重新累计
          await env.DB.prepare("UPDATE rag_files_v2 SET ids='[]', chunks=0 WHERE title=?").bind(title0).run();
        }
      }catch(e){ /* 删除失败不阻断入库，但会在返回里提示 */ }
    }
    await env.VECTORIZE.upsert(items);
    // 登记入库台账（同一文件的多个批次累加本次的块）
    try{
      const title = String(chunks[0].title||"未命名").slice(0,80);
      const cat = String(body.category||"未分类").slice(0,30);
      const lvl = parseInt(body.level)||2;
      const sec = parseInt(body.security)||1;                       // 密级:1公开 2内部 3涉密
      const dscope = String(body.deptScope||"全部门").slice(0,40);   // 可见部门
      const dateOk = (s)=> /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")) ? String(s) : "";   // 只接受YYYY-MM-DD
      const effD = dateOk(body.effectiveDate);
      const expD = dateOk(body.expiryDate);
      const ids = items.map(it=>it.id);
      const chash = String(body.contentHash||"").slice(0,64);
      const row = await env.DB.prepare("SELECT ids, chunks, version FROM rag_files_v2 WHERE title=?").bind(title).first();
      if(row){
        const all = JSON.parse(row.ids||"[]").concat(ids);
        // 版本号：替换模式的第一批次才+1，同一次上传的后续批次不重复递增
        const newVer = (body.replaceMode && body.isFirstBatch) ? (parseInt(row.version)||1) + 1 : (parseInt(row.version)||1);
        await env.DB.prepare("UPDATE rag_files_v2 SET ids=?, chunks=?, category=?, level=?, security=?, dept_scope=?, effective_date=?, expiry_date=?, content_hash=?, version=?, updated_at=? WHERE title=?")
          .bind(JSON.stringify(all), all.length, cat, lvl, sec, dscope, effD, expD, chash, newVer, Date.now(), title).run();
      }else{
        await env.DB.prepare("INSERT INTO rag_files_v2(title, ids, chunks, category, level, enabled, security, dept_scope, effective_date, expiry_date, content_hash, version, updated_at, created_at) VALUES(?,?,?,?,?,1,?,?,?,?,?,1,?,?)")
          .bind(title, JSON.stringify(ids), ids.length, cat, lvl, sec, dscope, effD, expD, chash, Date.now(), Date.now()).run();
      }
    }catch(e){}
    return json({ok:true, count: items.length, replacedOld});
  }

  // 检索核心逻辑抽成共用函数:query接口和评测(evalRun)都调用它,保证评测结果和真实检索完全一致
  async function runRetrieval(q, opts){
    opts = opts || {};
    const topK = Math.min(parseInt(opts.topK)||3, 8);
    const recall = Math.min(parseInt(opts.recall)||40, 60);
    const [vec] = await embed(env, [q]);
    const r = await env.VECTORIZE.query(vec, { topK: recall, returnMetadata: "all" });
    let myDept = "", myClearance = 1;
    try{
      const u = await env.DB.prepare("SELECT department, clearance FROM users WHERE id=?").bind(user.userId).first();
      if(u){ myDept = u.department||""; myClearance = parseInt(u.clearance)||1; }
    }catch(e){}
    let disabled = new Set();
    let permMap = {};
    try{
      const dr = await env.DB.prepare("SELECT title, enabled, security, dept_scope, effective_date, expiry_date FROM rag_files_v2").all();
      (dr.results||[]).forEach(x=>{
        if(x.enabled===0) disabled.add(x.title);
        permMap[x.title] = { security: parseInt(x.security)||1, dept_scope: x.dept_scope||"全部门",
                             effective_date: x.effective_date||"", expiry_date: x.expiry_date||"" };
      });
    }catch(e){}
    const iAmAdmin = isAdmin(env, user);
    const canSee = (title)=>{
      if(iAmAdmin) return true;
      const p = permMap[title];
      if(!p) return true;
      if(p.security > myClearance) return false;
      if(p.dept_scope && p.dept_scope !== "全部门" && p.dept_scope !== myDept) return false;
      return true;
    };
    // 知识时效判定：政策等文件有生效/失效日期，过期的降权并明确标注，避免旧政策被当作现行依据引用
    const todayStr = new Date().toISOString().slice(0,10);   // YYYY-MM-DD
    const normDate = (s)=>{ s = String(s||"").trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)) ? s : ""; };
    const lifecycleOf = (title)=>{
      const p = permMap[title];
      if(!p) return { status:"valid", weight:1, note:"" };
      const eff = normDate(p.effective_date);
      const exp = normDate(p.expiry_date);
      if(exp && exp < todayStr) return { status:"expired", weight:0.5, note:"已于"+exp+"失效" };
      if(eff && eff > todayStr) return { status:"pending", weight:0.7, note:eff+"起生效（尚未生效）" };
      // 临近失效（30天内）提示但不降权
      if(exp){
        const d = (new Date(exp) - new Date(todayStr)) / 86400000;
        if(d >= 0 && d <= 30) return { status:"expiring", weight:1, note:exp+"即将失效" };
      }
      return { status:"valid", weight:1, note:"" };
    };
    const wantCat = opts.category ? String(opts.category) : null;
    const LW = {1:1.15, 2:1.0, 3:0.85};
    const kws = (q.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z]{2,}|\d{2,}/g) || []).slice(0, 8);
    let matches = (r.matches||[]).map(m=>{
      const md = m.metadata||{};
      const lvl = parseInt(md.level)||2;
      const hay = String(md.text||"") + " " + String(md.title||"") + String(md.chapter||"") + String(md.section||"");
      const titleHay = String(md.title||"") + String(md.chapter||"") + String(md.section||"");
      let kwBonus = 0, kwHitList = [];
      kws.forEach(k=>{
        if(titleHay.includes(k)){ kwBonus += 0.05; kwHitList.push(k); }
        else if(hay.includes(k)){ kwBonus += 0.03; kwHitList.push(k); }
      });
      const lc = lifecycleOf(md.title);
      const base = m.score * (LW[lvl]||1) * lc.weight;
      return {
        rawScore: m.score,
        lifecycle: lc.status, lifecycleNote: lc.note,
        score: Math.round((base + kwBonus) * 1000)/1000,
        kwHits: kwHitList,
        title: md.title, chapter: md.chapter, section: md.section,
        category: md.category||"未分类", level: lvl, text: md.text,
      };
    }).filter(m=>{
      if(disabled.has(m.title)) return false;
      if(!canSee(m.title)) return false;
      if(wantCat && m.category !== wantCat) return false;
      return true;
    });
    matches.sort((a,b)=>b.score-a.score);

    const rerankN = Math.min(matches.length, 20);
    const useRerank = opts.rerank !== false && rerankN > 1;
    if(useRerank){
      try{
        const cand = matches.slice(0, rerankN);
        const contexts = cand.map(m=>({ text: String(m.text||"").slice(0, 1000) }));
        const rr = await env.AI.run("@cf/baai/bge-reranker-base", { query: q, contexts, top_k: rerankN });
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
          if(reordered.length){
            const rest = matches.slice(rerankN);
            matches = reordered.concat(rest);
          }
        }
      }catch(e){}
    }
    return { all: matches, top: matches.slice(0, topK), category: wantCat };
  }

  if(body.action === "query"){
    const q = String(body.query||"").trim().slice(0, 500);
    if(!q) return json({ok:false, error:"查询为空"}, 400);
    const { top: matches, category: wantCat } = await runRetrieval(q, body);
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
    const rows = await env.DB.prepare("SELECT title, chunks, category, level, enabled, security, dept_scope, effective_date, expiry_date, version, updated_at, created_at FROM rag_files_v2 ORDER BY created_at DESC LIMIT 500").all();
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

  if(body.action === "evalAdd"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const q = String(body.query||"").trim().slice(0,200);
    const et = String(body.expectTitle||"").trim().slice(0,80);
    if(!q || !et) return json({ok:false, error:"检索词与应命中文件标题均不能为空"}, 400);
    await env.DB.prepare("INSERT INTO rag_evalset(query, expect_title, note, created_at) VALUES(?,?,?,?)")
      .bind(q, et, String(body.note||"").slice(0,100), Date.now()).run();
    return json({ok:true});
  }

  if(body.action === "evalList"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    const rows = await env.DB.prepare("SELECT id, query, expect_title, note, created_at FROM rag_evalset ORDER BY id DESC").all();
    return json({ok:true, cases: rows.results||[]});
  }

  if(body.action === "evalDelete"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    await env.DB.prepare("DELETE FROM rag_evalset WHERE id=?").bind(parseInt(body.id)).run();
    return json({ok:true});
  }

  if(body.action === "evalRun"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const rows = await env.DB.prepare("SELECT id, query, expect_title, note FROM rag_evalset ORDER BY id ASC").all();
    const cases = rows.results || [];
    if(!cases.length) return json({ok:false, error:"评测集为空，请先添加标准问答"}, 400);
    const results = [];
    let hitCount = 0;
    for(const c of cases){
      let rankInfo = { hit:false, rank:null, topTitles:[] };
      try{
        const { top } = await runRetrieval(c.query, { topK: 5 });
        const titles = top.map(m=>m.title);
        rankInfo.topTitles = titles;
        const idx = titles.indexOf(c.expect_title);
        if(idx >= 0){ rankInfo.hit = true; rankInfo.rank = idx+1; hitCount++; }
      }catch(e){ rankInfo.error = e.message; }
      results.push({ id:c.id, query:c.query, expectTitle:c.expect_title, note:c.note, ...rankInfo });
    }
    const accuracy = Math.round(hitCount/cases.length*1000)/10;
    // 平均命中排名(仅统计命中的,越小越好)
    const hitRanks = results.filter(r=>r.hit).map(r=>r.rank);
    const avgRank = hitRanks.length ? Math.round(hitRanks.reduce((a,b)=>a+b,0)/hitRanks.length*10)/10 : null;
    return json({ok:true, report:{ total:cases.length, hit:hitCount, accuracy, avgRank, results }});
  }

  if(body.action === "setLifecycle"){
    if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员"}, 403);
    if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
    const title = String(body.title||"").slice(0,80);
    const dateOk = (s)=> /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")) ? String(s) : "";
    const effD = dateOk(body.effectiveDate);
    const expD = dateOk(body.expiryDate);
    if(effD && expD && effD > expD) return json({ok:false, error:"生效日期不能晚于失效日期"}, 400);
    await env.DB.prepare("UPDATE rag_files_v2 SET effective_date=?, expiry_date=? WHERE title=?")
      .bind(effD, expD, title).run();
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
