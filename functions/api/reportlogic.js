// 可研逐小节生成逻辑：公司级版本治理，普通用户只读取已发布版本。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import rentSeed from "./_reportlogic-seed.js";
import gaibaoSeed from "./_reportlogic-gaibao-seed.js";

const REPORT_LOGIC_SEEDS = { rent: rentSeed, gaibao: gaibaoSeed };
const GAIBAO_SCENARIOS = ["housing_conversion", "commercial_renovation"];

const clean = (value, max = 200) => String(value == null ? "" : value).trim().slice(0, max);
const parse = (value, fallback = null) => { try { return JSON.parse(value || ""); } catch (_) { return fallback; } };
const isAdmin = (env, user) => (env.ADMIN_USERS || "").split(",").map(x => x.trim()).filter(Boolean).some(x => x === user.username || x === String(user.userId));
const passOk = (env, request) => !env.ADMIN_PASS || request.headers.get("x-admin-pass") === env.ADMIN_PASS;

async function ensureSchema(env) {
  const ts = env.DEPLOY_MODE === "local" ? "BIGINT" : "INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS report_logic_sets (id TEXT PRIMARY KEY,project_type TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',data TEXT NOT NULL,source_name TEXT DEFAULT '',created_at " + ts + " NOT NULL,created_by TEXT DEFAULT '',published_at " + ts + ")").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_report_logic_sets_type ON report_logic_sets(project_type,status,version DESC)").run();
}

function validateSet(input, expectedType = "") {
  const data = input && typeof input === "object" ? structuredClone(input) : null;
  if (!data || !Array.isArray(data.rules) || !data.rules.length) throw new Error("生成逻辑不能为空");
  const projectType = clean(expectedType || data.projectType, 30);
  if (!projectType) throw new Error("缺少项目类型");
  const ids = new Set();
  data.projectType = projectType;
  data.rules = data.rules.map((rule, index) => {
    const next = { ...rule, projectType, sourceNo: index + 1 };
    next.id = clean(next.id, 100) || `${projectType}-logic-${String(index + 1).padStart(3, "0")}`;
    if (ids.has(next.id)) throw new Error("规则ID重复：" + next.id);
    ids.add(next.id);
    next.chapter = clean(next.chapter, 160); next.section = clean(next.section, 200);
    next.subsection = clean(next.subsection, 240); next.pointTitle = clean(next.pointTitle, 240);
    next.displayTitle = clean(next.displayTitle, 300) || [next.subsection, next.pointTitle].filter(Boolean).join("｜") || next.section;
    next.requiredSources = clean(next.requiredSources, 5000); next.writingLogic = clean(next.writingLogic, 5000);
    next.outputForm = clean(next.outputForm, 200); next.importance = clean(next.importance, 80);
    next.generationMode = clean(next.generationMode, 80) || "ai_writing";
    next.missingPolicy = clean(next.missingPolicy, 2000) || "资料缺失时标注待补，不得虚构";
    next.note = clean(next.note, 2000);
    next.parentRuleId = clean(next.parentRuleId, 100);
    next.enhancement = !!next.enhancement;
    next.changeReason = clean(next.changeReason, 1000);
    next.scenarios = projectType === "gaibao"
      ? [...new Set((Array.isArray(next.scenarios) ? next.scenarios : GAIBAO_SCENARIOS).filter(x => GAIBAO_SCENARIOS.includes(x)))]
      : [];
    if (projectType === "gaibao" && !next.scenarios.length) throw new Error(`第${index + 1}条缺少适用业务场景`);
    const variants = next.scenarioVariants && typeof next.scenarioVariants === "object" ? next.scenarioVariants : {};
    next.scenarioVariants = projectType === "gaibao" ? Object.fromEntries(next.scenarios.map(scenario => {
      const variant = variants[scenario] && typeof variants[scenario] === "object" ? variants[scenario] : {};
      return [scenario, {
        section: clean(variant.section || next.section, 200),
        subsection: clean(variant.subsection || next.subsection, 240),
        pointTitle: clean(variant.pointTitle || next.pointTitle, 240),
        displayTitle: clean(variant.displayTitle || next.displayTitle, 300),
        requiredSources: clean(variant.requiredSources || next.requiredSources, 5000),
        writingLogic: clean(variant.writingLogic || next.writingLogic, 5000),
        outputForm: clean(variant.outputForm || next.outputForm, 200),
        missingPolicy: clean(variant.missingPolicy || next.missingPolicy, 2000),
        sourceKinds: Array.isArray(variant.sourceKinds) && variant.sourceKinds.length ? [...new Set(variant.sourceKinds.map(x=>clean(x,40)).filter(Boolean))] : next.sourceKinds,
        changeReason: clean(variant.changeReason || next.changeReason, 1000),
        note: clean(variant.note || next.note, 2000)
      }];
    })) : {};
    if (!next.chapter || !next.section) throw new Error(`第${index + 1}条缺少章节或小节`);
    next.sourceKinds = Array.isArray(next.sourceKinds) ? [...new Set(next.sourceKinds.map(x => clean(x, 40)).filter(Boolean))] : [];
    next.projectSpecific = !!next.projectSpecific;
    return next;
  });
  data.structure = {
    chapterCount: new Set(data.rules.map(rule => rule.chapter)).size,
    chapterNames: [...new Set(data.rules.map(rule => rule.chapter))],
    ruleCount: data.rules.length,
    scenarioCounts: projectType === "gaibao" ? Object.fromEntries(GAIBAO_SCENARIOS.map(scenario => [scenario, data.rules.filter(rule => rule.scenarios.includes(scenario)).length])) : {}
  };
  return data;
}

function appendEnhancementData(baseData, input, actor = "", now = Date.now()) {
  const data = validateSet(baseData, input?.projectType || baseData?.projectType || "rent"), baseRuleId = clean(input?.baseRuleId, 100);
  const base = data.rules.find(rule => rule.id === baseRuleId);
  if (!base) throw new Error("未找到要增强的原规则");
  const e = input?.enhancement && typeof input.enhancement === "object" ? input.enhancement : {};
  const requiredSources = clean(e.requiredSources, 5000), writingLogic = clean(e.writingLogic, 5000);
  if (!requiredSources && !writingLogic) throw new Error("增强规则至少要补充材料来源或写作逻辑");
  const suffix = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  data.rules.push({
    id: `${data.projectType}-enh-${suffix}`, projectType:data.projectType,
    chapter:base.chapter, section:base.section, subsection:clean(e.subsection,240)||base.subsection,
    pointTitle:clean(e.pointTitle,240)||`${base.pointTitle||base.displayTitle||base.section}（增强）`,
    displayTitle:clean(e.displayTitle,300)||`${base.displayTitle||base.section}｜增强补充`,
    requiredSources, sourceKinds:Array.isArray(e.sourceKinds)?e.sourceKinds:base.sourceKinds,
    writingLogic, outputForm:clean(e.outputForm,200)||base.outputForm,
    importance:clean(e.importance,80)||base.importance, generationMode:clean(e.generationMode,80)||base.generationMode,
    missingPolicy:clean(e.missingPolicy,2000)||base.missingPolicy,
    note:clean(e.note,2000)||`由管理员${clean(actor,80)||"人工"}在前台交互增强`,
    parentRuleId:base.id, enhancement:true, changeReason:clean(e.changeReason,1000), projectSpecific:!!e.projectSpecific,
    scenarios:Array.isArray(e.scenarios)&&e.scenarios.length?e.scenarios:base.scenarios,
    scenarioVariants:base.scenarioVariants
  });
  data.changeLog = Array.isArray(data.changeLog) ? data.changeLog.slice(-99) : [];
  data.changeLog.push({action:"append_enhancement",parentRuleId:base.id,at:now,by:clean(actor,80),reason:clean(e.changeReason,1000)});
  return validateSet(data, data.projectType);
}

function mergeRuleRevisionData(baseData,input,actor="",now=Date.now()){
  const data=validateSet(baseData,input?.projectType||baseData?.projectType||"rent"),baseRuleId=clean(input?.baseRuleId,100),rule=data.rules.find(item=>item.id===baseRuleId);
  if(!rule)throw new Error("未找到要更新的原规则");
  const revision=input?.revision&&typeof input.revision==="object"?input.revision:{},scenario=GAIBAO_SCENARIOS.includes(input?.businessScenario)?input.businessScenario:"";
  const apply=target=>{
    if(clean(revision.requiredSources,5000))target.requiredSources=clean(revision.requiredSources,5000);
    if(clean(revision.writingLogic,5000))target.writingLogic=clean(revision.writingLogic,5000);
    if(clean(revision.outputForm,200))target.outputForm=clean(revision.outputForm,200);
    if(clean(revision.missingPolicy,2000))target.missingPolicy=clean(revision.missingPolicy,2000);
    if(Array.isArray(revision.sourceKinds)&&revision.sourceKinds.length)target.sourceKinds=[...new Set(revision.sourceKinds.map(x=>clean(x,40)).filter(Boolean))];
    target.changeReason=clean(revision.changeReason||input?.reason,1000);
    target.note=clean(revision.note,2000)||target.note;
  };
  if(scenario&&rule.scenarioVariants?.[scenario])apply(rule.scenarioVariants[scenario]);else apply(rule);
  data.changeLog=Array.isArray(data.changeLog)?data.changeLog.slice(-99):[];
  data.changeLog.push({action:"merge_rule_revision",ruleId:rule.id,businessScenario:scenario,at:now,by:clean(actor,80),reason:clean(revision.changeReason||input?.reason,1000)});
  return validateSet(data,data.projectType);
}

function ruleForScenario(rule,scenario){
  const variant=scenario&&rule?.scenarioVariants?.[scenario];return variant?{...rule,...variant,id:rule.id,sourceNo:rule.sourceNo,chapter:rule.chapter}:rule;
}
function ruleQuality(rule){
  const writing=clean(rule?.writingLogic,5000),sources=clean(rule?.requiredSources,5000),output=clean(rule?.outputForm,500),missing=clean(rule?.missingPolicy,2000),kinds=Array.isArray(rule?.sourceKinds)?rule.sourceKinds:[];
  let score=35;
  if(writing.length>=60)score+=10;if(/核验|比对|勾稽|分析|判断|引用|形成|输出/.test(writing))score+=12;if(/条件|口径|步骤|结论|风险|差异/.test(writing))score+=7;
  if(sources.length>=30)score+=5;if(/字段|统计期|版本|有效|原件|接口|台账|发布日期|来源机构/.test(sources))score+=10;
  if(output)score+=5;if(missing)score+=5;if(kinds.length)score+=5;if(/不得虚构|待补|复核/.test(missing))score+=6;
  return Math.min(100,score);
}
function evaluateRuleRevisionData(baseData,input){
  const data=validateSet(baseData,input?.projectType||baseData?.projectType||"rent"),base=data.rules.find(item=>item.id===clean(input?.baseRuleId,100));
  if(!base)throw new Error("未找到要评测的原规则");
  const scenario=GAIBAO_SCENARIOS.includes(input?.businessScenario)?input.businessScenario:"",oldRule=ruleForScenario(base,scenario),revision=input?.revision&&typeof input.revision==="object"?input.revision:{};
  const candidate={...oldRule};for(const key of ["requiredSources","writingLogic","outputForm","missingPolicy","note","changeReason"])if(clean(revision[key],5000))candidate[key]=clean(revision[key],5000);if(Array.isArray(revision.sourceKinds)&&revision.sourceKinds.length)candidate.sourceKinds=[...new Set(revision.sourceKinds.map(x=>clean(x,40)).filter(Boolean))];
  const changed=["requiredSources","writingLogic","outputForm","missingPolicy","sourceKinds"].filter(key=>JSON.stringify(candidate[key]||"")!==JSON.stringify(oldRule[key]||"")),allText=[candidate.requiredSources,candidate.writingLogic,candidate.outputForm,candidate.missingPolicy].join(" "),blockers=[],warnings=[];
  if(!changed.length)blockers.push("候选与现行逻辑没有实质变化");
  if(/(?:\d+(?:\.\d+)?\s*(?:万元|亿元|元\/|%|平方米|㎡|套|户))|(?:20\d{2}[年/-]\d{1,2}[月/-]\d{0,2})/.test(allText))blockers.push("候选含项目专属精确数值或日期，不能沉淀为通用逻辑");
  if(/(?:华越龙苑|安小居|本次项目地址|本项目实际为)/.test(allText))blockers.push("候选含具体项目事实或名称");
  if((candidate.sourceKinds||[]).includes("web_search")&&/批复|合同|权属|证照|图纸|内部台账|项目实际面积|项目实际户数/.test(candidate.requiredSources||""))blockers.push("项目内部事实被错误配置为联网检索来源");
  if(!/不得虚构|待补|复核/.test(candidate.missingPolicy||""))warnings.push("缺失材料处理未明确禁止虚构");
  if((candidate.sourceKinds||[]).includes("web_search")&&!/统计期|发布日期|有效|来源机构|官网|原始发布/.test(candidate.requiredSources||""))warnings.push("联网来源缺少时效或权威性约束");
  const oldScore=ruleQuality(oldRule),candidateScore=Math.max(0,ruleQuality(candidate)-warnings.length*3-blockers.length*20),delta=candidateScore-oldScore,recommended=!blockers.length&&candidateScore>=80&&delta>=2;
  return {evaluationVersion:1,ruleId:base.id,businessScenario:scenario,oldScore,candidateScore,delta,changed,blockers,warnings,recommended,recommendation:recommended?"评测通过，可推荐采纳":"未达到采纳门槛，请继续完善候选逻辑",thresholds:{candidateScore:80,minDelta:2,noBlockers:true}};
}

async function ensureSeeds(env) {
  const now = Date.now();
  for (const [projectType, sourceSeed] of Object.entries(REPORT_LOGIC_SEEDS)) {
    const data = validateSet(sourceSeed, projectType), seedId = data.setId || `report-logic-${projectType}-v1`;
    const existing = await env.DB.prepare("SELECT id,version,created_by,data FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
    if (existing) {
      if (needsAuthoritativeBaseline(existing.data, data)) {
        const latest = await env.DB.prepare("SELECT version FROM report_logic_sets WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first();
        const version = Number(latest?.version || existing.version || 0) + 1;
        const id = `report-logic-${projectType}-v${version}-${now.toString(36)}`;
        data.version = version; data.status = "published"; data.setId = id;
        await env.DB.prepare("UPDATE report_logic_sets SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();
        await env.DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,source_name,created_at,created_by,published_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .bind(id, projectType, data.name || `${projectType}可研逐小节生成逻辑`, version, "published", JSON.stringify(data), data.source?.fileName || "", now, "system-baseline-migration", now).run();
        continue;
      }
      if (existing.id === seedId && existing.created_by === "system-seed" && existing.data !== JSON.stringify(data)) {
        await env.DB.prepare("UPDATE report_logic_sets SET data=?,source_name=?,published_at=? WHERE id=?").bind(JSON.stringify(data), data.source?.fileName || "", now, existing.id).run();
      }
      continue;
    }
    await env.DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,source_name,created_at,created_by,published_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(seedId, projectType, data.name || `${projectType}可研逐小节生成逻辑`, 1, "published", JSON.stringify(data), data.source?.fileName || "", now, "system-seed", now).run();
  }
}

function needsAuthoritativeBaseline(existingData, targetData) {
  const target = clean(targetData?.source?.baselineId, 160);
  if (!target) return false;
  const current = clean(parse(existingData, {})?.source?.baselineId, 160);
  return current !== target;
}

function rowOut(row, includeData = true) {
  if (!row) return null;
  const out = { id: row.id, projectType: row.project_type, name: row.name, version: Number(row.version), status: row.status, sourceName: row.source_name || "", createdAt: Number(row.created_at || 0), createdBy: row.created_by || "", publishedAt: Number(row.published_at || 0) };
  if (includeData) out.data = parse(row.data, {});
  else {
    const data = parse(row.data, {});
    out.ruleCount = Number(data?.structure?.ruleCount || data?.rules?.length || 0);
    out.chapterCount = Number(data?.structure?.chapterCount || 0);
  }
  return out;
}

export async function onRequestGet(context) {
  const env = adaptEnv(context.env), user = await verifyAuth(context.request, env);
  if (!user) return json({ ok: false, error: "未登录" }, 401);
  try { await ensureSchema(env); await ensureSeeds(env); } catch (error) { return json({ ok: false, error: "生成逻辑库初始化失败：" + error.message }, 500); }
  const url = new URL(context.request.url), projectType = clean(url.searchParams.get("projectType") || "rent", 30);
  const row = await env.DB.prepare("SELECT * FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
  return row ? json({ ok: true, set: rowOut(row, true) }) : json({ ok: true, set: null });
}

export async function onRequestPost(context) {
  const env = adaptEnv(context.env), user = await verifyAuth(context.request, env);
  if (!user) return json({ ok: false, error: "未登录" }, 401);
  try { await ensureSchema(env); await ensureSeeds(env); } catch (error) { return json({ ok: false, error: "生成逻辑库初始化失败：" + error.message }, 500); }
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ ok: false, error: "请求格式有误" }, 400); }
  const action = clean(body.action, 30);
  if (action === "adminCapability") return json({ ok: true, isAdmin: isAdmin(env, user) });
  if(action==="evaluateRuleRevision"){
    try{const projectType=clean(body.projectType||"rent",30),current=await env.DB.prepare("SELECT * FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();if(!current)return json({ok:false,error:"当前项目类型尚无已发布逻辑"},404);return json({ok:true,evaluation:evaluateRuleRevisionData(parse(current.data,{}),{projectType,baseRuleId:body.baseRuleId,businessScenario:body.businessScenario,revision:body.revision})});}catch(error){return json({ok:false,error:error.message},400);}
  }
  if (action === "adminList") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可查看逻辑版本" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM report_logic_sets ORDER BY project_type,version DESC LIMIT 100").all();
    return json({ ok: true, items: (rows.results || []).map(row => rowOut(row, false)) });
  }
  if (action === "restoreRentSeed" || action === "restoreSeed" || action === "publish") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可发布生成逻辑" }, 403);
    try {
      const projectType = clean(action === "restoreRentSeed" ? "rent" : (body.projectType || body.data?.projectType || "rent"), 30);
      const seed = REPORT_LOGIC_SEEDS[projectType];
      if (action === "restoreSeed" && !seed) throw new Error("当前项目类型没有内置基线");
      const data = validateSet(action === "restoreRentSeed" ? rentSeed : action === "restoreSeed" ? seed : body.data, projectType);
      const latest = await env.DB.prepare("SELECT version FROM report_logic_sets WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first();
      const version = Number(latest?.version || 0) + 1, now = Date.now(), id = `report-logic-${projectType}-v${version}-${now.toString(36)}`;
      await env.DB.prepare("UPDATE report_logic_sets SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();
      data.version = version; data.status = "published"; data.setId = id;
      await env.DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,source_name,created_at,created_by,published_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(id, projectType, clean(data.name, 160) || `${projectType}可研逐小节生成逻辑`, version, "published", JSON.stringify(data), clean(data.source?.fileName, 240), now, user.username || String(user.userId), now).run();
      return json({ ok: true, set: rowOut(await env.DB.prepare("SELECT * FROM report_logic_sets WHERE id=?").bind(id).first(), false) });
    } catch (error) { return json({ ok: false, error: error.message }, 400); }
  }
  if (action === "appendEnhancement") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可确认并发布增强规则" }, 403);
    try {
      const projectType=clean(body.projectType||"rent",30),current=await env.DB.prepare("SELECT * FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
      if(!current)return json({ok:false,error:"当前项目类型尚无已发布逻辑"},404);
      const data=appendEnhancementData(parse(current.data,{}),{projectType,baseRuleId:body.baseRuleId,enhancement:body.enhancement},user.username||String(user.userId));
      const latest=await env.DB.prepare("SELECT version FROM report_logic_sets WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first(),version=Number(latest?.version||0)+1,now=Date.now(),id=`report-logic-${projectType}-v${version}-${now.toString(36)}`;
      await env.DB.prepare("UPDATE report_logic_sets SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();
      data.version=version;data.status="published";data.setId=id;
      await env.DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,source_name,created_at,created_by,published_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,projectType,clean(data.name,160)||`${projectType}可研逐小节生成逻辑`,version,"published",JSON.stringify(data),clean(data.source?.fileName,240),now,user.username||String(user.userId),now).run();
      return json({ok:true,set:rowOut(await env.DB.prepare("SELECT * FROM report_logic_sets WHERE id=?").bind(id).first(),false),enhancement:data.rules[data.rules.length-1]});
    } catch(error) { return json({ok:false,error:error.message},400); }
  }
  if(action==="mergeRuleRevision"){
    if(!isAdmin(env,user)||!passOk(env,context.request))return json({ok:false,error:"仅管理员可直接并入生成逻辑"},403);
    try{
      const projectType=clean(body.projectType||"rent",30),current=await env.DB.prepare("SELECT * FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
      if(!current)return json({ok:false,error:"当前项目类型尚无已发布逻辑"},404);
      const evaluation=evaluateRuleRevisionData(parse(current.data,{}),{projectType,baseRuleId:body.baseRuleId,businessScenario:body.businessScenario,revision:body.revision});if(!evaluation.recommended)return json({ok:false,error:"候选逻辑未通过自动评测",evaluation},422);
      const data=mergeRuleRevisionData(parse(current.data,{}),{projectType,baseRuleId:body.baseRuleId,businessScenario:body.businessScenario,revision:body.revision},user.username||String(user.userId));
      const latest=await env.DB.prepare("SELECT version FROM report_logic_sets WHERE project_type=? ORDER BY version DESC LIMIT 1").bind(projectType).first(),version=Number(latest?.version||0)+1,now=Date.now(),id=`report-logic-${projectType}-v${version}-${now.toString(36)}`;
      await env.DB.prepare("UPDATE report_logic_sets SET status='archived' WHERE project_type=? AND status='published'").bind(projectType).run();data.version=version;data.status="published";data.setId=id;
      await env.DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,source_name,created_at,created_by,published_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,projectType,clean(data.name,160)||`${projectType}可研逐小节生成逻辑`,version,"published",JSON.stringify(data),clean(data.source?.fileName,240),now,user.username||String(user.userId),now).run();
      return json({ok:true,set:rowOut(await env.DB.prepare("SELECT * FROM report_logic_sets WHERE id=?").bind(id).first(),false),rule:data.rules.find(item=>item.id===body.baseRuleId),evaluation});
    }catch(error){return json({ok:false,error:error.message},400);}
  }
  return json({ ok: false, error: "未知操作" }, 400);
}

export { validateSet, appendEnhancementData, mergeRuleRevisionData, evaluateRuleRevisionData, ruleQuality, needsAuthoritativeBaseline, ensureSeeds };
