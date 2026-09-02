// /api/aireport  AI可研生成（对话式）· 信息抽取 + 参数推荐 + 会话存档
// POST {action:"extract", text, previous?}           从用户原话抽取项目基础信息（调用AI，只出JSON）；带previous时是"追加修正"
// POST {action:"suggest", calcType, location}         从历史案例库(calc_cases)推荐~40个测算参数初值，标来源与置信度
// POST {action:"saveState", state}                    保存本次对话进度（覆盖式，每人一份）
// GET                                                 读取上次保存的对话进度
// DELETE                                               清空对话进度
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { catalogFor, ROLE_OPTIONS, VOLATILITY_OPTIONS, CONFIRM_OPTIONS, SOURCE_POLICY_OPTIONS } from "./_paramcatalog.js";

const TYPE_CN = { rent:"出租类", sale:"出售类", gaibao:"中资产（非居改保/商业改造等）" };

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
const PARAM_CATALOG = catalogFor(DEFAULTS);

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
// 与浏览器 paramgovernance.js 的内置兜底表保持同一业务口径；后台 calc_paramrules 可按key覆盖。
// 这里只有确有规则依据的参数，其他字段继续明确标为“专家默认值”，不能一概冒充行业规则。
export const BUILTIN_PARAM_RULES = {
  rent:[
    {key:"buildYears",value:4,basis:"建设期原则上不超过4年"},{key:"loanRate",value:3,basis:"贷款利率3%±0.3个百分点校核"},
    {key:"discountPct",value:3.5,basis:"保障房项目常用审慎区间，须按项目性质确认"},{key:"rampOcc",value:0.7,basis:"首年出租率不高于75%"},
    {key:"stableOcc",value:0.9,basis:"稳定期出租率不高于95%"},{key:"rentRate",value:5,basis:"租金递增率行业兜底，须结合合同确认"},
    {key:"manageCoeff",value:0.9,basis:"公司分区域七档管理系数，未明确区域档位时须人工确认"}],
  gaibao:[
    {key:"buildYears",value:1,basis:"建设期原则上不超过4年"},{key:"loanRate",value:3,basis:"贷款利率3%±0.3个百分点校核"},
    {key:"discount",value:6,basis:"行业兜底区间，须按项目性质确认"},{key:"rampOcc",value:0.75,basis:"首年出租率不高于75%"},
    {key:"stableOcc",value:0.95,basis:"稳定期出租率不高于95%"},{key:"rentRate",value:5,basis:"租金递增率行业兜底，须结合合同确认"}],
  sale:[
    {key:"buildYears",value:5,basis:"出售类建设进度行业初值，须由项目计划确认"},{key:"loanRate",value:3,basis:"贷款利率3%±0.3个百分点校核"},
    {key:"discountPct",value:3.5,basis:"行业兜底区间，须按项目性质确认"},{key:"rate1",value:1,basis:"销售计划须在0~100%内"},
    {key:"commStableOcc",value:0.96,basis:"商业稳定出租率审慎上限，须由市场调研确认"}],
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
  const url = new URL(request.url);
  if(url.searchParams.get("catalog")==="1"){
    return json({ok:true, defaults:DEFAULTS, rules:BUILTIN_PARAM_RULES, keyFields:KEY_FIELDS,
      meta:PARAM_CATALOG, roleOptions:ROLE_OPTIONS, volatilityOptions:VOLATILITY_OPTIONS, confirmOptions:CONFIRM_OPTIONS, sourcePolicyOptions:SOURCE_POLICY_OPTIONS,
      sourceHierarchy:["项目Excel/测算底稿","项目正式资料","适用政策/公司硬规则","同区域同类型案例中位数","其他同类型案例中位数","行业规则兜底","专家默认值"]});
  }
  const projectId = String(url.searchParams.get("projectId")||"").trim();
  if(projectId){
    try{
      const row = await env.DB.prepare("SELECT data, updated_at FROM aireport_project_sessions WHERE user_id=? AND project_id=?")
        .bind(user.userId, projectId).first();
      if(!row) return json({ok:true,state:null,projectId});
      let state=null; try{state=JSON.parse(row.data);}catch(e){}
      return json({ok:true,state,projectId,updated_at:row.updated_at});
    }catch(e){ return json({ok:true,state:null,projectId,migrationRequired:true}); }
  }
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
  const url=new URL(request.url), projectId=String(url.searchParams.get("projectId")||"").trim();
  try{
    if(projectId) await env.DB.prepare("DELETE FROM aireport_project_sessions WHERE user_id=? AND project_id=?").bind(user.userId,projectId).run();
    else await env.DB.prepare("DELETE FROM aireport_sessions WHERE user_id=?").bind(user.userId).run();
  }catch(e){}
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
  if(body.action === "parseLegacyDoc") return doParseLegacyDoc(context, body);
  if(body.action === "suggest") return doSuggest(context, body);
  if(body.action === "saveState") return doSaveState(context, body, user);
  return json({ok:false, error:"未知操作"}, 400);
}

/* 旧版二进制 Word（.doc）无法由浏览器端 mammoth 读取，因此只把这一种格式交给服务端。
   云端使用 Workers AI toMarkdown；本地适配器使用纯 Node 的 word-extractor，不依赖 Office。 */
async function doParseLegacyDoc(context, body){
  const env = adaptEnv(context.env);
  const name = String(body.name||"").trim().slice(0,120);
  const b64 = String(body.dataBase64||"");
  if(!/\.doc$/i.test(name)) return json({ok:false,error:"该接口只接收旧版 .doc 文件"},400);
  if(!b64) return json({ok:false,error:"旧版 Word 文件内容为空"},400);
  if(b64.length>18*1024*1024) return json({ok:false,error:"旧版 .doc 单文件不能超过约12MB"},413);
  if(!env.AI || typeof env.AI.toMarkdown!=="function") return json({ok:false,error:"当前部署未启用旧版 .doc 解析；请用 Word 另存为 .docx 后重试"},501);
  try{
    const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const results=await env.AI.toMarkdown([{name,blob:new Blob([bytes],{type:"application/msword"})}]);
    const first=Array.isArray(results)?results[0]:results,text=String(first&&first.data||"").trim();
    if(!text)return json({ok:false,error:"未从该 .doc 提取到文字；文件可能已损坏、加密或只有图片"},422);
    const clipped=text.slice(0,80000);
    return json({ok:true,text:clipped+(text.length>80000?"\n…（超长材料已保留前8万字）":""),truncated:text.length>80000});
  }catch(error){
    return json({ok:false,error:"旧版 .doc 解析失败："+String(error&&error.message||error||"未知错误")+"。可尝试用 Word 另存为 .docx 后重试"},422);
  }
}

/* ===== 会话存档：整段对话状态覆盖式保存，每人一份（同 office_chats 的做法） ===== */
async function doSaveState(context, body, user){
  const env = adaptEnv(context.env);
  const dataStr = JSON.stringify(body.state||{});
  if(dataStr.length > 400000) return json({ok:false, error:"对话内容过大，无法保存"}, 413);
  const now = Date.now();
  const projectId=String(body.projectId||"").trim();
  try{
    if(projectId){
      if(!/^[A-Za-z0-9-]{8,64}$/.test(projectId)) return json({ok:false,error:"项目ID非法"},400);
      const id="airs-"+user.userId+"-"+projectId;
      const exist=await env.DB.prepare("SELECT id FROM aireport_project_sessions WHERE user_id=? AND project_id=?").bind(user.userId,projectId).first();
      if(exist) await env.DB.prepare("UPDATE aireport_project_sessions SET data=?, updated_at=? WHERE user_id=? AND project_id=?").bind(dataStr,now,user.userId,projectId).run();
      else await env.DB.prepare("INSERT INTO aireport_project_sessions(id,user_id,project_id,data,updated_at) VALUES(?,?,?,?,?)").bind(id,user.userId,projectId,dataStr,now).run();
      return json({ok:true,projectId});
    }
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

function materialFallbackExtraction(text, reason){
  const source=String(text||"").replace(/\r/g,"");
  const exactValue=labels=>{
    const escaped=labels.map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
    const match=source.match(new RegExp("(?:^|\\n)\\s*(?:"+escaped+")\\s*[：:]\\s*([^\\n]{2,180})","i"));
    return match?String(match[1]).replace(/[；;。].*$/,"").trim():null;
  };
  const projectName=exactValue(["项目名称","工程名称","项目名"]),location=exactValue(["建设地点","项目地址","建设地址","项目位置","坐落位置"]);
  const owner=exactValue(["建设单位","委托单位","项目业主","业主单位"]),landNature=exactValue(["土地性质","用地性质"]);
  const yearRaw=exactValue(["开工年份","建设年份","计划开工时间","开工时间"]),areaRaw=exactValue(["用地面积","土地面积"]);
  const typeRaw=exactValue(["测算类型","项目类型","业务类型","改造类型"]),typeText=String(typeRaw||"");
  let calcType=null,businessScenario=null;
  if(/商业改造|自持改造/.test(typeText)){calcType="gaibao";businessScenario="commercial_renovation";}
  else if(/非居改保|住房改造/.test(typeText)){calcType="gaibao";businessScenario="housing_conversion";}
  else if(/出售|配售/.test(typeText))calcType="sale";else if(/出租|公租房|保租房/.test(typeText))calcType="rent";
  const startYear=yearRaw&&String(yearRaw).match(/(?:19|20)\d{2}/),landArea=areaRaw&&String(areaRaw).replace(/,/g,"").match(/\d+(?:\.\d+)?/);
  const analysisSites=projectName&&location?[{id:"site-1",name:projectName,address:location,role:"primary"}]:null;
  const data={projectName,location,analysisSites,calcType,businessScenario,landArea:landArea?Number(landArea[0]):null,landPrice:null,startYear:startYear?Number(startYear[0]):null,owner,landNature,desc:null};
  data.missing=Object.entries({projectName,location,calcType}).filter(([,value])=>!value).map(([key])=>key);
  return {ok:true,degraded:true,degradedReason:String(reason||"AI信息抽取暂不可用").slice(0,300),data};
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
    + "analysisSites：用户明确提到多个待分析项目/地块时，输出1至6项数组，每项含name、address、role；影响最大或用户指定重点的唯一一项role为primary，其余为secondary。只有一个项目或没有逐项信息时填null，绝不能把同一地址拆成多个点位；\n"
    + "calcType：仅能是以下三选一——\"rent\"（长期持有出租经营）、\"sale\"（以出售/配售为主）、\"gaibao\"（既有非居物业改造项目）；实在无法判断填null；\n"
    + "businessScenario：calcType为gaibao时必须在\"housing_conversion\"（非居改保，改为保障性住房）与\"commercial_renovation\"（商业改造、自持经营）中二选一；用户未明确时填null；其他calcType填null；\n"
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
  if(body.materialMode===true){
    sys += "\n\n本次输入来自批量上传的项目材料。只能抽取文件中明确出现的事实，不得根据文件名、常识或相似项目补全。"
      + "项目名称不明确就填null；多个文件存在冲突就保留null交人工确认。analysisSites只能放实际待分析/待改造的项目点位，不得把联系地址、主管单位地址、政策适用地区、周边竞品或案例地址当成项目点位。最多6项且只能有一个primary。";
  }

  const extractionTool={type:"function",function:{name:"submit_project_info",description:"提交从用户描述或项目材料中明确抽取到的项目信息；不确定字段可以省略",parameters:{type:"object",properties:{
    projectName:{type:"string"},location:{type:"string"},analysisSites:{type:"array",maxItems:6,items:{type:"object",properties:{name:{type:"string"},address:{type:"string"},role:{type:"string",enum:["primary","secondary"]}},required:["name","address","role"]}},
    calcType:{type:"string",enum:["rent","sale","gaibao"]},businessScenario:{type:"string",enum:["housing_conversion","commercial_renovation"]},landArea:{type:"number"},landPrice:{type:"number"},startYear:{type:"number"},owner:{type:"string"},landNature:{type:"string"},desc:{type:"string"}
  }}}};

  let upstream;
  try{
    const origin = new URL(request.url).origin;
    upstream = await fetch(origin + "/api/generate", {
      method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, {"Authorization": request.headers.get("authorization")||""}),
      body: JSON.stringify({ system: sys, messages:[{role:"user", content:text}], kind:"chat", tools:[extractionTool], tool_choice:{type:"function",function:{name:"submit_project_info"}} }),
    });
  }catch(e){
    if(body.materialMode===true)return json(materialFallbackExtraction(text,"AI服务连接失败："+String(e&&e.message||e||"未知错误")));
    return json({ok:false, error:"AI服务连接失败："+e.message}, 502);
  }
  const data = await upstream.json().catch(()=>({}));
  if(!upstream.ok || data.error){
    if(body.materialMode===true)return json(materialFallbackExtraction(text,"AI抽取接口返回"+upstream.status+"："+String(data.error||"上游调用失败")));
    // 原样透传 /api/generate 的状态码（401未登录/429限额/502上游失败），不要把它们都压成200——
    // 前端目前只看 ok/error 字段，不受影响，但状态码留着方便以后按状态区分处理（比如限额单独提示）
    return json({ok:false, error: data.error || "AI抽取信息失败，请稍后重试"}, upstream.status || 500);
  }
  const toolCall=(Array.isArray(data.tool_calls)?data.tool_calls:[]).find(call=>call&&call.function&&call.function.name==="submit_project_info");
  const toolArgs=toolCall&&toolCall.function&&toolCall.function.arguments;
  const raw = ((data.content||[])[0]||{}).text || "";
  const cleaned = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  let parsed;
  try{parsed=typeof toolArgs==="string"?JSON.parse(toolArgs):(toolArgs&&typeof toolArgs==="object"?toolArgs:JSON.parse(cleaned));}catch(e){
    try{const start=cleaned.indexOf("{"),end=cleaned.lastIndexOf("}");if(start<0||end<=start)throw e;parsed=JSON.parse(cleaned.slice(start,end+1));}
    catch(_){
    if(body.materialMode===true)return json(materialFallbackExtraction(text,"AI已响应，但返回内容不是有效JSON；请点击重新提取"));
    return json({ok:false, error:"AI没能理解这段描述，请换个说法，或直接说明：地块所在区域/街道、做出租还是出售、大概哪年开工"});
    }
  }
  const nullableExtractedText=value=>{
    const text=String(value==null?"":value).trim();
    return !text||/^(?:null|undefined|none|未提及|不详)$/i.test(text)?null:text;
  };
  const missing = [];
  if(!parsed.location) missing.push("location");
  if(!parsed.calcType || !TYPE_CN[parsed.calcType]) missing.push("calcType");
  const businessScenario=["housing_conversion","commercial_renovation"].includes(parsed.businessScenario)?parsed.businessScenario:null;
  if(parsed.calcType==="gaibao"&&!businessScenario)missing.push("businessScenario");
  const rawSites=Array.isArray(parsed.analysisSites)?parsed.analysisSites.slice(0,6).map((site,index)=>({
    id:"site-"+(index+1),name:String(nullableExtractedText(site&&site.name)||"").slice(0,100),address:String(nullableExtractedText(site&&site.address)||"").slice(0,160),role:site&&site.role==="primary"?"primary":"secondary",
  })).filter(site=>site.name&&site.address):[];
  if(rawSites.length){let primary=rawSites.findIndex(site=>site.role==="primary");if(primary<0)primary=0;rawSites.forEach((site,index)=>site.role=index===primary?"primary":"secondary");}
  return json({ok:true, data:{
    projectName: nullableExtractedText(parsed.projectName),
    location: (rawSites.find(site=>site.role==="primary")||{}).address || nullableExtractedText(parsed.location),
    analysisSites: rawSites.length?rawSites:null,
    calcType: TYPE_CN[parsed.calcType] ? parsed.calcType : null,
    businessScenario,
    landArea: (typeof parsed.landArea==="number") ? parsed.landArea : null,
    landPrice: (typeof parsed.landPrice==="number") ? parsed.landPrice : null,
    startYear: (typeof parsed.startYear==="number") ? parsed.startYear : null,
    owner: nullableExtractedText(parsed.owner),
    landNature: nullableExtractedText(parsed.landNature),
    desc: nullableExtractedText(parsed.desc),
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
  const projectType = String(body.projectType||"").trim();
  const today = new Date().toISOString().slice(0,10);
  const explicitParams = (body.explicitParams && typeof body.explicitParams==="object") ? body.explicitParams : {};

  let expertOverrides = {};
  try{
    const row = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_paramdefaults").first();
    const all = row ? JSON.parse(row.data||"{}") : {};
    expertOverrides = all[calcType] && typeof all[calcType]==="object" ? all[calcType] : {};
  }catch(e){ expertOverrides={}; }
  try{
    const q=await env.DB.prepare("SELECT param_key,published_data FROM param_governance WHERE calc_type=? AND status='published'").bind(calcType).all(),day=new Date().toISOString().slice(0,10);
    for(const x of q.results||[]){let d={};try{d=JSON.parse(x.published_data||"{}");}catch(e){}delete expertOverrides[x.param_key];const active=(!d.effectiveDate||d.effectiveDate<=day)&&(!d.expiryDate||d.expiryDate>=day);if(active&&d.hasExpertOverride&&!d.derived&&d.input!==false)expertOverrides[x.param_key]=d.expertValue;}
  }catch(e){/* 参数治理表尚未初始化时继续使用兼容配置 */}
  const effectiveDefaults = Object.assign({}, DEFAULTS[calcType], expertOverrides);

  let sensAll = null;
  try{
    const sensRow = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_sensitivity").first();
    if(sensRow) sensAll = JSON.parse(sensRow.data||"null");
  }catch(e){
    // 敏感性结果读取失败(没同步过/表还没建/JSON坏了)不阻断——退化为原来手工维护的关键参数短名单
    sensAll = null;
  }
  const keyFields = resolveKeyFields(calcType, sensAll);

  let configuredRules = [];
  try{
    const row = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_paramrules").first();
    const all = row ? JSON.parse(row.data||"{}") : {};
    configuredRules = Array.isArray(all[calcType]) ? all[calcType] : [];
  }catch(e){ configuredRules=[]; }
  const configuredRuleMap = Object.fromEntries([...(BUILTIN_PARAM_RULES[calcType]||[]),...configuredRules].filter(x=>x&&x.key).map(x=>[x.key,x]));

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

  const params = Object.assign({}, effectiveDefaults);
  const sources = {};
  const keyInfo = Object.fromEntries(keyFields.map(f=>[f.key,f]));
  Object.keys(params).forEach(key=>{
    const f = keyInfo[key] || {key,label:key};
    const meta=(PARAM_CATALOG[calcType]&&PARAM_CATALOG[calcType][key])||{};
    const regionHits = regionCases.filter(c=>typeof c.params[key]==="number");
    const otherHits = otherCases.filter(c=>typeof c.params[key]==="number");
    const candidateRule=configuredRuleMap[key];
    const regionOk=!candidateRule||!candidateRule.region||sameRegion(candidateRule.region,location);
    const projectOk=!candidateRule||!candidateRule.projectType||!projectType||sameRegion(candidateRule.projectType,projectType);
    const dateOk=!candidateRule||(!candidateRule.effectiveDate||candidateRule.effectiveDate<=today)&&(!candidateRule.expiryDate||candidateRule.expiryDate>=today);
    const rule=candidateRule&&candidateRule.enabled!==false&&regionOk&&projectOk&&dateOk&&Number.isFinite(candidateRule.value)?candidateRule:null;
    const ruleSource=()=>({value:rule.value,from:"行业/制度规则："+(rule.basis||rule.label||f.label),confidence:rule.evidenceRefs&&rule.evidenceRefs.length?"中":"低",evidence:Array.isArray(rule.evidenceRefs)?rule.evidenceRefs:[],sourceCode:rule.role==="policy_constant"?"binding_rule":"industry_fallback",sourceLevel:rule.role==="policy_constant"?3:6,requiresManualConfirmation:rule.manualRequired!==false,basis:rule.basis||"",version:rule.version||null,effectiveDate:rule.effectiveDate||"",expiryDate:rule.expiryDate||""});
    const expertSource=()=>({value:effectiveDefaults[key],from:"专家默认值/占位初值（尚无适用的高等级来源）",confidence:"低",evidence:[],sourceCode:"expert_default",sourceLevel:7,requiresManualConfirmation:true,basis:""});
    let src;
    const explicitValue=explicitParams[key],hasExplicit=Object.prototype.hasOwnProperty.call(explicitParams,key)&&((typeof explicitValue==="number"&&isFinite(explicitValue))||typeof explicitValue==="string"||Array.isArray(explicitValue));
    if(hasExplicit){
      src={value:explicitValue,from:"项目正式资料/信息卡",confidence:"高",evidence:[],sourceCode:"project_document",sourceLevel:2,requiresManualConfirmation:false};
    }else if(rule && (meta.sourcePolicy==="binding_rule"||meta.sourcePolicy==="industry_fallback")){
      src=ruleSource();
    }else if(meta.sourcePolicy==="project_document"||meta.sourcePolicy==="manual_decision"){
      // 项目事实和管理决策不能拿别的项目中位数冒充本项目数据；缺资料时只给低置信度占位值。
      src=expertSource();
    }else if(regionHits.length){
      src=Object.assign(mkSource(regionHits,key,"个同区域案例中位数",regionHits.length>=2?"高":"中"),{sourceCode:"regional_case",sourceLevel:4,requiresManualConfirmation:true});
    }else if(otherHits.length){
      src=Object.assign(mkSource(otherHits,key,"个案例中位数（非本区域，仅供参考）","中"),{sourceCode:"general_case",sourceLevel:5,requiresManualConfirmation:true});
    }else if(rule) src=ruleSource();
    else src=expertSource();
    params[key] = src.value;
    sources[key] = src;
  });

  return json({ok:true, params, sources, keyFields, paramMeta:PARAM_CATALOG[calcType], caseCount:cases.length, regionCaseCount:regionCases.length,
    keyFieldsSource: keyFields===KEY_FIELDS[calcType] ? "manual" : "sensitivity",
    sourceHierarchy:["项目Excel/测算底稿","项目正式资料","适用政策/公司硬规则","同区域同类型案例中位数","其他同类型案例中位数","行业规则兜底","专家默认值"]});
}
