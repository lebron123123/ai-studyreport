// /api/population  人口参考表（街道/乡镇一级人口没有官方免费API，靠人工整理真实统计公报维护）
// GET ?lookup=1&location=xxx   按地址文本模糊匹配最合适的一条（供AI可研生成的自动检索用）
// GET                          列出全部（管理后台用）
// POST                         新增一条（仅管理员）
// PATCH ?id=xx                 修改一条（仅管理员）
// DELETE ?id=xx                删除一条（仅管理员）
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

// 与 calccases.js / rag.js 保持同一套管理员判定口径
function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

// 粗略的地址匹配：city/district/street 只要出现在传入的地址文本里就算命中；
// street命中的优先于只命中district的——街道级数据比区级更精确
function matchScore(row, addr){
  let score = 0;
  if(row.city && addr.includes(row.city)) score += 1;
  if(row.district && addr.includes(row.district)) score += 2;
  if(row.street && addr.includes(row.street)) score += 4;
  return score;
}

export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const url = new URL(request.url);

  if(url.searchParams.get("lookup")){
    const addr = String(url.searchParams.get("location")||"").trim();
    if(!addr) return json({ok:true, item:null});
    try{
      const r = await env.DB.prepare("SELECT * FROM population_ref ORDER BY year DESC").all();
      const rows = r.results||[];
      let best = null, bestScore = 0;
      rows.forEach(row=>{
        const s = matchScore(row, addr);
        if(s > bestScore){ bestScore = s; best = row; }
      });
      if(!best || bestScore < 2) return json({ok:true, item:null}); // 至少要命中district级别才算数，光命中city不够精确
      return json({ok:true, item: best});
    }catch(e){
      return json({ok:true, item:null}); // 表还没建/查询异常都不阻断——按"未收录"处理
    }
  }

  try{
    const r = await env.DB.prepare("SELECT * FROM population_ref ORDER BY city, district, street").all();
    return json({ok:true, list: r.results||[]});
  }catch(e){
    return json({ok:true, list:[]});
  }
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可维护人口参考表"}, 403);
  let b; try{ b = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }

  const city = String(b.city||"").trim().slice(0,40);
  const district = String(b.district||"").trim().slice(0,40);
  const population = parseFloat(b.population);
  const year = parseInt(b.year);
  if(!city || !district) return json({ok:false, error:"请填写城市与区（县）"}, 400);
  if(!isFinite(population) || population<=0) return json({ok:false, error:"常住人口（万人）请填正数"}, 400);
  if(!isFinite(year) || year<2000 || year>2100) return json({ok:false, error:"年份不合法"}, 400);

  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO population_ref(city, district, street, population, year, source, note, user_id, updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
  ).bind(city, district, String(b.street||"").trim().slice(0,40), population, year,
    String(b.source||"").trim().slice(0,200), String(b.note||"").trim().slice(0,200), user.userId, now).run();
  return json({ok:true, id:(r.meta&&r.meta.last_row_id)||null});
}

export async function onRequestPatch(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可维护人口参考表"}, 403);
  const id = new URL(request.url).searchParams.get("id");
  if(!id) return json({ok:false, error:"缺少id"}, 400);
  let b; try{ b = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }

  const now = Date.now();
  await env.DB.prepare(
    "UPDATE population_ref SET city=COALESCE(?,city), district=COALESCE(?,district), street=COALESCE(?,street), "+
    "population=COALESCE(?,population), year=COALESCE(?,year), source=COALESCE(?,source), note=COALESCE(?,note), updated_at=? WHERE id=?"
  ).bind(
    b.city!=null? String(b.city).trim().slice(0,40) : null,
    b.district!=null? String(b.district).trim().slice(0,40) : null,
    b.street!=null? String(b.street).trim().slice(0,40) : null,
    b.population!=null? parseFloat(b.population) : null,
    b.year!=null? parseInt(b.year) : null,
    b.source!=null? String(b.source).trim().slice(0,200) : null,
    b.note!=null? String(b.note).trim().slice(0,200) : null,
    now, id
  ).run();
  return json({ok:true});
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可维护人口参考表"}, 403);
  const id = new URL(request.url).searchParams.get("id");
  if(!id) return json({ok:false, error:"缺少id"}, 400);
  await env.DB.prepare("DELETE FROM population_ref WHERE id=?").bind(id).run();
  return json({ok:true});
}
