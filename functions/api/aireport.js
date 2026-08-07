// /api/aireport  AI可研生成（对话式）· 信息抽取 + 参数推荐 + 会话存档
// POST {action:"extract", text, previous?}           从用户原话抽取项目基础信息（调用AI，只出JSON）；带previous时是"追加修正"
// POST {action:"suggest", calcType, location}         从历史案例库(calc_cases)推荐~40个测算参数初值，标来源与置信度
// POST {action:"saveState", state}                    保存本次对话进度（覆盖式，每人一份）
// GET                                                 读取上次保存的对话进度
// DELETE                                               清空对话进度
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const TYPE_CN = { rent:"出租类", sale:"出售类", gaibao:"非居改保" };

/* ===== 阶段②：参数推荐 —— 行业默认值（字段与 calc.js 的 readRentForm/readSaleForm/readCalcForm 完全对齐，
   数值取自各表单里"照Excel对数过"的默认值，保证没有历史案例时也能算出一套自洽的结果） ===== */
const DEFAULTS = {
  rent: {
    buildStart:2025, buildYears:5, operateYears:66, firstMonths:12,
    area:34330, rent:32, rentSpan:10, rentRate:5,
    occRamp:[0.7,0.8], parkOccRamp:[0.65,0.75], parkStableOcc:0.9, stableOcc:0.9,
    rentDiscount:0.6,
    subsidyArea:0, subsidyPrice:32, subsidyDiscount:0.3, subsidyStableOcc:0.75,
    parkCount:420, parkPrice:200, parkRatio:0.5, otherTotal:69.2388,
    areaPostOffice:1500, postOfficePrice:3875.44, areaKindergarten:2200, areaPropertyRoom:145, areaPoliceRoom:50,
    totalBuildArea:61900.75, manageCoeff:0.85, decorationCost:3089.71, houseType:"公租房",
    totalInvestment:50928.27, landArea:8495.2, constructionCost:40742.62,
    loanAmount:40742.62, loanPlanText:"2025:6440.51,2026:6255.48,2027:9348.87,2028:9348.87,2029:9348.87",
    loanRate:3, firstRepayRatio:3, repayIncreaseRate:4.5, loanTotalYears:25,
    invest:50928.27, discountPct:3.5,
  },
  sale: {
    buildStart:2026, buildYears:2, operateYears:10, otherTotal:500,
    saleArea:56105, saleAvgPrice:12880, rate1:0.5, rate2:0.3, rate3:0.2,
    commArea:20000, commRent:120, commRentSpan:3, commRentRate:5, commRampOcc:0.7, commStableOcc:0.9,
    commRentStableStart:2033, leaseMonths:12, parkCount:300,
    landCost:30000, constructionCost:40000, infraCost:5000, otherEngCost:3000, devCost:8000,
    saleConstructionCost:28000, saleInfraCost:3500, projectInputTax:200, landUseArea:25000, landFloorPrice:1000,
    totalInvestment:90000,
    loanAmount:50000, loanRate:3, loanTotalYears:12, repayStart:2030, repayAmount:10000, repayYears:4,
    discountPct:3.5,
  },
  gaibao: {
    buildStart:2026, buildYears:1, operateYears:12, firstMonths:12,
    area:20000, rent:75, rentSpan:3, rentRate:5, rampOcc:0.85, stableOcc:0.95,
    collect:25, mode:"lease", collectPct:100, sharePct:0,
    deco:1500, decoInt:10, decoRatio:0.30,
    units:500, unitCost:800, startup:50, loan:13892,
    interestBase:10600, rateDiscount:0.80, loanRate:3.5, discount:6, repay:1157.67,
  },
};

// 7个"关键参数"——前期灵敏度测试实测对IRR影响最大的字段，唯一需要人工确认的环节
const KEY_FIELDS = {
  rent: [
    { key:"rent", label:"起始租金（元/㎡/月）" },
    { key:"area", label:"可租面积（㎡）" },
    { key:"stableOcc", label:"稳定期出租率", pct:true },
    { key:"manageCoeff", label:"管理系数" },
    { key:"parkCount", label:"车位个数" },
    { key:"decorationCost", label:"住宅装修造价（万元）" },
    { key:"totalInvestment", label:"总投资（万元，折旧基数）" },
  ],
  sale: [
    { key:"saleAvgPrice", label:"可售均价（元/㎡）" },
    { key:"saleArea", label:"配保房销售面积（㎡）" },
    { key:"commRent", label:"商业起始租金（元/㎡/月）" },
    { key:"commArea", label:"商业出租面积（㎡）" },
    { key:"landCost", label:"土地成本费（万元）" },
    { key:"constructionCost", label:"建安工程费（万元）" },
    { key:"totalInvestment", label:"项目总投资（万元）" },
  ],
  gaibao: [
    { key:"rent", label:"起始租金（元/㎡/月）" },
    { key:"area", label:"可租面积（㎡）" },
    { key:"stableOcc", label:"稳定期出租率", pct:true },
    { key:"collect", label:"收楼单价（元/㎡/月，物业收缴口径）" },
    { key:"unitCost", label:"单位运营成本（元/套/月）" },
    { key:"units", label:"户数（总套数）" },
    { key:"deco", label:"装修单价（元/㎡）" },
  ],
};

function median(nums){
  const arr = nums.filter(x=>typeof x==="number" && isFinite(x)).slice().sort((a,b)=>a-b);
  if(!arr.length) return null;
  const mid = Math.floor(arr.length/2);
  return arr.length%2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
}
/* KEY_FIELDS 是手工挑的短名单，早于敏感性分析(sensitivity-core.js的Sobol/Spearman/SRC排序)存在，
   两者可能对不上（比如rentRate/rentDiscount/rentSpan/buildYears排名很靠前但不在手工名单里）。
   这里优先用管理员在后台「敏感性分析」页跑过、同步到configs表(calc_sensitivity)的真实排序结果替换掉
   手工名单——只挑排名靠前、且这套AI推荐参数的数据模型(DEFAULTS[calcType]的字段)里真的有的那些键
   （敏感性分析里一些ie_前缀的投资估算细项，AI推荐这条链路目前并不单独采集，排进来也匹配不到案例数据，
   直接过滤掉，不然会挑出一个案例库永远填不上的"关键参数"）。没有可用的敏感性结果，或匹配数不足3个时，
   回退到原来手工维护的短名单，行为不变。 */
function resolveKeyFields(calcType, sensAll){
  const fallback = KEY_FIELDS[calcType];
  const sens = sensAll && sensAll[calcType];
  if(!sens || !Array.isArray(sens.table) || !sens.table.length) return fallback;
  const eligibleKeys = new Set(Object.keys(DEFAULTS[calcType]));
  const rankOf = (row) => {
    if(row.combinedRank!=null) return row.combinedRank;
    if(row.STi!=null) return -row.STi;
    if(row.spearmanRho!=null) return -Math.abs(row.spearmanRho);
    if(row.src!=null) return -Math.abs(row.src);
    return Infinity;
  };
  const ranked = sens.table.filter(row=>eligibleKeys.has(row.key)).sort((a,b)=>rankOf(a)-rankOf(b));
  if(ranked.length < 3) return fallback;
  return ranked.slice(0, fallback.length).map(row=>({ key: row.key, label: row.label||row.key }));
}
// 粗略的"同区域"判断：字符串互相包含即可（如"深圳市坪山区龙田街道"包含"坪山区龙田街道"）
function sameRegion(a, b){
  a = String(a||"").trim(); b = String(b||"").trim();
  if(!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  try{
    const row = await env.DB.prepare("SELECT data, updated_at FROM aireport_sessions WHERE user_id=?")
      .bind(user.userId).first();
    if(!row) return json({ok:true, state:null});
    let state = null;
    try{ state = JSON.parse(row.data); }catch(e){ state = null; }
    return json({ok:true, state, updated_at: row.updated_at});
  }catch(e){
    // 存档表若还没建（如刚部署未跑 schema），不影响正常使用，只是这次没有历史可恢复
    return json({ok:true, state:null});
  }
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  try{ await env.DB.prepare("DELETE FROM aireport_sessions WHERE user_id=?").bind(user.userId).run(); }catch(e){}
  return json({ok:true});
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }

  if(body.action === "extract") return doExtract(context, body);
  if(body.action === "suggest") return doSuggest(context, body);
  if(body.action === "saveState") return doSaveState(context, body, user);
  return json({ok:false, error:"未知操作"}, 400);
}

/* ===== 会话存档：整段对话状态覆盖式保存，每人一份（同 office_chats 的做法） ===== */
async function doSaveState(context, body, user){
  const env = adaptEnv(context.env);
  const dataStr = JSON.stringify(body.state||{});
  if(dataStr.length > 400000) return json({ok:false, error:"对话内容过大，无法保存"}, 413);
  const now = Date.now();
  try{
    const exist = await env.DB.prepare("SELECT user_id FROM aireport_sessions WHERE user_id=?").bind(user.userId).first();
    if(exist){
      await env.DB.prepare("UPDATE aireport_sessions SET data=?, updated_at=? WHERE user_id=?")
        .bind(dataStr, now, user.userId).run();
    }else{
      await env.DB.prepare("INSERT INTO aireport_sessions(user_id, data, updated_at) VALUES(?,?,?)")
        .bind(user.userId, dataStr, now).run();
    }
  }catch(e){
    // 存档表若还没建，不阻断当前对话——只是这次没同步到云端
    return json({ok:false, error:"云端存档暂不可用，本次对话仍可正常使用"});
  }
  return json({ok:true});
}

/* ===== 阶段①：信息抽取 —— 借道 /api/generate 完成AI调用，
   这样鉴权、限额、上游密钥都只有一处实现，不必在这里重复一份。
   带 previous 时是"追加修正"：用户已经确认过一版信息，又补了一句话（比如"不对，是2026年开工"），
   这次抽取只需要覆盖用户这句话里明确提到的字段，其余字段前端会保留 previous 里的原值。 ===== */
async function doExtract(context, body){
  const { request } = context;
  const env = adaptEnv(context.env);
  const text = String(body.text||"").trim();
  if(!text) return json({ok:false, error:"请先描述一下项目情况"}, 400);
  const previous = body.previous && typeof body.previous==="object" ? body.previous : null;

  let sys = "你是一个信息抽取助手，负责从用户对一个保障房/可研项目的口语化描述中提取关键信息。"
    + "只输出一个JSON对象，不要任何解释文字，不要markdown代码块围栏。字段如下：\n"
    + "projectName：项目名称，没有明确名称时可用地点+类型自拟一个合理名称；\n"
    + "location：建设地点，尽量具体到区/街道；\n"
    + "calcType：仅能是以下三选一——\"rent\"（长期持有出租经营，如公租房/保租房/出租）、\"sale\"（以出售/配售为主，如配售房/商品房）、\"gaibao\"（非居物业改造为保障性住房，如商业改造/非居改保）；实在无法判断填null；\n"
    + "landArea：用地面积，单位平方米，数字，没提到填null；\n"
    + "landPrice：地价，单位万元，数字，没提到填null；\n"
    + "startYear：建设/开工年份，数字，没提到填null；\n"
    + "owner：建设或委托单位，没提到填null；\n"
    + "landNature：土地性质，如\"出让\"\"划拨\"\"居住用地\"\"商业用地\"等，没提到填null；\n"
    + "desc：对项目概况的简要复述，50字以内。\n"
    + "规则：拿不准的字段一律填null，绝不能猜测编造具体数值。";
  if(previous){
    sys += "\n\n这不是第一句话——用户此前已经提供过一版信息，现在只是补充/修正了一部分。"
      + "已有信息（JSON）：" + JSON.stringify(previous)
      + "\n请只输出用户这句新话里明确提到、需要新增或修改的字段；没提到的字段一律填null（前端会保留原值，不会被你的null覆盖）。";
  }

  let upstream;
  try{
    const origin = new URL(request.url).origin;
    upstream = await fetch(origin + "/api/generate", {
      method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, {"Authorization": request.headers.get("authorization")||""}),
      body: JSON.stringify({ system: sys, messages:[{role:"user", content:text}], kind:"chat" }),
    });
  }catch(e){
    return json({ok:false, error:"AI服务连接失败："+e.message}, 502);
  }
  const data = await upstream.json().catch(()=>({}));
  if(!upstream.ok || data.error){
    // 原样透传 /api/generate 的状态码（401未登录/429限额/502上游失败），不要把它们都压成200——
    // 前端目前只看 ok/error 字段，不受影响，但状态码留着方便以后按状态区分处理（比如限额单独提示）
    return json({ok:false, error: data.error || "AI抽取信息失败，请稍后重试"}, upstream.status || 500);
  }
  const raw = ((data.content||[])[0]||{}).text || "";
  const cleaned = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  let parsed;
  try{ parsed = JSON.parse(cleaned); }catch(e){
    return json({ok:false, error:"AI没能理解这段描述，请换个说法，或直接说明：地块所在区域/街道、做出租还是出售、大概哪年开工"});
  }
  const missing = [];
  if(!parsed.location) missing.push("location");
  if(!parsed.calcType || !TYPE_CN[parsed.calcType]) missing.push("calcType");
  return json({ok:true, data:{
    projectName: parsed.projectName || null,
    location: parsed.location || null,
    calcType: TYPE_CN[parsed.calcType] ? parsed.calcType : null,
    landArea: (typeof parsed.landArea==="number") ? parsed.landArea : null,
    landPrice: (typeof parsed.landPrice==="number") ? parsed.landPrice : null,
    startYear: (typeof parsed.startYear==="number") ? parsed.startYear : null,
    owner: parsed.owner || null,
    landNature: parsed.landNature || null,
    desc: parsed.desc || null,
    missing,
  }});
}

/* ===== 阶段②：参数推荐 —— 纯数据查询，不调用AI。
   优先级：①同区域同类型案例中位数 → ②不限区域同类型案例中位数（标注"非本区域，仅供参考"） → ③行业默认值 ===== */
async function doSuggest(context, body){
  const env = adaptEnv(context.env);
  const calcType = String(body.calcType||"");
  if(!DEFAULTS[calcType]) return json({ok:false, error:"测算类型不合法"}, 400);
  const location = String(body.location||"").trim();

  let sensAll = null;
  try{
    const sensRow = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_sensitivity").first();
    if(sensRow) sensAll = JSON.parse(sensRow.data||"null");
  }catch(e){
    // 敏感性结果读取失败(没同步过/表还没建/JSON坏了)不阻断——退化为原来手工维护的关键参数短名单
    sensAll = null;
  }
  const keyFields = resolveKeyFields(calcType, sensAll);

  let cases = [];
  try{
    const r = await env.DB.prepare(
      "SELECT name, location, params FROM calc_cases WHERE status='confirmed' AND calc_type=? ORDER BY created_at DESC LIMIT 200"
    ).bind(calcType).all();
    cases = (r.results||[]).map(row=>{
      let params={}; try{ params = JSON.parse(row.params||"{}"); }catch(e){}
      return { name: row.name||"未命名案例", location: row.location||"", params };
    });
  }catch(e){
    // 案例库查询失败（如表还没建）不阻断——退化为全部使用行业默认值
    cases = [];
  }

  const regionCases = location ? cases.filter(c=>sameRegion(c.location, location)) : [];
  const otherCases = cases.filter(c=> !regionCases.includes(c));

  // 证据明细：具体是哪几个案例、各给了什么值——供前端"查看依据"展开
  const mkSource = (hits, key, fromSuffix, confidence) => ({
    value: median(hits.map(c=>c.params[key])),
    from: hits.length + fromSuffix,
    confidence,
    evidence: hits.map(c=>({ name:c.name, value:c.params[key] })),
  });

  const params = Object.assign({}, DEFAULTS[calcType]);
  const sources = {};
  keyFields.forEach(f=>{
    const regionHits = regionCases.filter(c=>typeof c.params[f.key]==="number");
    const otherHits = otherCases.filter(c=>typeof c.params[f.key]==="number");
    const src = regionHits.length ? mkSource(regionHits, f.key, "个同区域案例中位数", regionHits.length>=2?"高":"中")
      : otherHits.length ? mkSource(otherHits, f.key, "个案例中位数（非本区域，仅供参考）", "中")
      : { value: DEFAULTS[calcType][f.key], from:"行业默认值，无历史案例，请务必人工核实", confidence:"低", evidence:[] };
    params[f.key] = src.value;
    sources[f.key] = src;
  });

  return json({ok:true, params, sources, keyFields, caseCount:cases.length, regionCaseCount:regionCases.length,
    keyFieldsSource: keyFields===KEY_FIELDS[calcType] ? "manual" : "sensitivity"});
}
