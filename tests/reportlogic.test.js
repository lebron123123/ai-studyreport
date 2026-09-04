import test from "node:test";
import assert from "node:assert/strict";
import seed from "../functions/api/_reportlogic-seed.js";
import gaibaoSeed from "../functions/api/_reportlogic-gaibao-seed.js";
import { validateSet, appendEnhancementData, mergeRuleRevisionData, evaluateRuleRevisionData, needsAuthoritativeBaseline, ensureSeeds } from "../functions/api/reportlogic.js";

test("出租类逐小节逻辑以137条和14章为正式基线并连续重编号", () => {
  assert.equal(seed.rules.length, 137);
  assert.equal(seed.structure.chapterCount, 14);
  assert.deepEqual(seed.rules.map(rule => rule.sourceNo), Array.from({length:137}, (_, index) => index + 1));
  assert.equal(new Set(seed.rules.map(rule => rule.id)).size, 137);
  assert.equal(seed.rules[116].legacySourceNo, "158");
  assert.equal(seed.rules[27].writingLogic, seed.rules[26].writingLogic, "纵向合并的共用写作逻辑应继承到后续行");
});

test("改造项目逐小节逻辑以74条、13章和两个业务场景独立成库", () => {
  assert.equal(gaibaoSeed.projectType, "gaibao");
  assert.equal(gaibaoSeed.rules.length, 74);
  assert.equal(gaibaoSeed.structure.chapterCount, 13);
  assert.deepEqual(gaibaoSeed.rules.map(rule => rule.sourceNo), Array.from({length:74}, (_, index) => index + 1));
  assert.equal(new Set(gaibaoSeed.rules.map(rule => rule.id)).size, 74);
  assert.deepEqual(gaibaoSeed.structure.scenarioCounts,{housing_conversion:65,commercial_renovation:67});
  assert.ok(gaibaoSeed.rules.every(rule=>Array.isArray(rule.scenarios)&&rule.scenarios.length));
  assert.ok(gaibaoSeed.rules.every(rule => rule.projectType === "gaibao"));
  assert.ok(gaibaoSeed.rules.some(rule => rule.sourceKinds.includes("calculation_engine")), "测算规则引擎应被识别为测算来源");
  assert.equal(gaibaoSeed.source.sheetIndex,1);
  assert.equal(gaibaoSeed.source.selectionPolicy,"first_sheet_only");
  assert.ok(gaibaoSeed.structure.chapterNames.includes("第七章 合作协议"));
  assert.ok(!gaibaoSeed.structure.chapterNames.some(name=>/绿色建筑|海绵城市/.test(name)));
  const cooperation=gaibaoSeed.rules.find(rule=>rule.section==="7.1项目合作模式");
  assert.equal(cooperation.chapter,"第七章 合作协议");
  assert.match(cooperation.requiredSources,/合作模式比选分析报告、风险收益评估表/);
  const basis=gaibaoSeed.rules.find(rule=>rule.subsection==="1.1.3编制依据");
  assert.match(basis.requiredSources,/深圳市保障性租赁住房管理办法/);
  assert.match(basis.requiredSources,/商业改造（自持改造）专项政策/);
  const splitRule=gaibaoSeed.rules.find(rule=>rule.id==="gaibao-v1-009");
  assert.match(splitRule.scenarioVariants.housing_conversion.writingLogic,/非居改保、居改居等（住房改造）/);
  assert.doesNotMatch(splitRule.scenarioVariants.housing_conversion.writingLogic,/商业改造（自持改造）/);
  assert.match(splitRule.scenarioVariants.commercial_renovation.writingLogic,/商业改造（自持改造）/);
  assert.doesNotMatch(splitRule.scenarioVariants.commercial_renovation.writingLogic,/非居改保/);
  const housingOnly=gaibaoSeed.rules.find(rule=>rule.id==="gaibao-v1-017"),commercialOnly=gaibaoSeed.rules.find(rule=>rule.id==="gaibao-v1-018");
  assert.deepEqual(housingOnly.scenarios,["housing_conversion"]);
  assert.deepEqual(commercialOnly.scenarios,["commercial_renovation"]);
  const conclusion=gaibaoSeed.rules.find(rule=>rule.id==="gaibao-v1-011");
  assert.match(conclusion.scenarioVariants.housing_conversion.writingLogic,/a\.非居改保:/);
  assert.doesNotMatch(conclusion.scenarioVariants.housing_conversion.writingLogic,/b\.自持:/);
  assert.match(conclusion.scenarioVariants.commercial_renovation.writingLogic,/b\.自持:/);
  assert.doesNotMatch(conclusion.scenarioVariants.commercial_renovation.writingLogic,/a\.非居改保:/);
  for(const rule of gaibaoSeed.rules){
    assert.doesNotMatch(rule.scenarioVariants?.housing_conversion?.writingLogic||"",/【商业改造（自持改造）/);
    assert.doesNotMatch(rule.scenarioVariants?.commercial_renovation?.writingLogic||"",/【非居改保|保障性租赁住房|保租房/);
  }
});

test("首表权威基线标识变化时触发一次性数据库替换",()=>{
  assert.equal(needsAuthoritativeBaseline(JSON.stringify({source:{baselineId:"old"}}),gaibaoSeed),true);
  assert.equal(needsAuthoritativeBaseline(JSON.stringify({source:{baselineId:gaibaoSeed.source.baselineId}}),gaibaoSeed),false);
  assert.equal(needsAuthoritativeBaseline("{}",{source:{}}),false);
});

test("初始化会归档旧改造逻辑并发布首表74条新基线",async()=>{
  const rows=[
    {id:"rent-current",project_type:"rent",name:"rent",version:2,status:"published",data:JSON.stringify(seed),source_name:"",created_at:1,created_by:"admin",published_at:1},
    {id:"gaibao-old",project_type:"gaibao",name:"old",version:3,status:"published",data:JSON.stringify({projectType:"gaibao",source:{baselineId:"old"},rules:[{id:"old",chapter:"第八章 绿色建筑及海绵城市",section:"8.1旧逻辑",scenarios:["housing_conversion","commercial_renovation"]}]}),source_name:"old.xlsx",created_at:1,created_by:"admin",published_at:1}
  ];
  const db={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){
    if(sql.startsWith("SELECT id,version,created_by,data"))return rows.filter(row=>row.project_type===args[0]&&row.status==="published").sort((a,b)=>b.version-a.version)[0]||null;
    if(sql.startsWith("SELECT version"))return rows.filter(row=>row.project_type===args[0]).sort((a,b)=>b.version-a.version)[0]||null;
    throw new Error("unexpected first SQL: "+sql);
  },async run(){
    if(sql.startsWith("UPDATE report_logic_sets SET status='archived'")){rows.filter(row=>row.project_type===args[0]&&row.status==="published").forEach(row=>row.status="archived");return{};}
    if(sql.startsWith("INSERT INTO report_logic_sets")){const [id,projectType,name,version,status,data,sourceName,createdAt,createdBy,publishedAt]=args;rows.push({id,project_type:projectType,name,version,status,data,source_name:sourceName,created_at:createdAt,created_by:createdBy,published_at:publishedAt});return{};}
    if(sql.startsWith("UPDATE report_logic_sets SET data="))return{};
    throw new Error("unexpected run SQL: "+sql);
  }};}};
  await ensureSeeds({DB:db});
  const current=rows.filter(row=>row.project_type==="gaibao"&&row.status==="published").sort((a,b)=>b.version-a.version)[0];
  const data=JSON.parse(current.data);
  assert.equal(current.version,4);
  assert.equal(current.created_by,"system-baseline-migration");
  assert.equal(data.rules.length,74);
  assert.ok(data.structure.chapterNames.includes("第七章 合作协议"));
  assert.ok(!data.structure.chapterNames.some(name=>/绿色建筑|海绵城市/.test(name)));
  assert.equal(rows.find(row=>row.id==="gaibao-old").status,"archived");
});

test("发布前校验会按现有顺序重编号且拒绝重复规则ID", () => {
  const normalized = validateSet({ projectType:"rent", rules:[
    {id:"r1",chapter:"第一章 总论",section:"1.1项目背景",sourceNo:99},
    {id:"r2",chapter:"第二章 必要性",section:"2.1必要性",sourceNo:120}
  ] }, "rent");
  assert.deepEqual(normalized.rules.map(rule => rule.sourceNo), [1,2]);
  assert.equal(normalized.rules[0].missingPolicy, "资料缺失时标注待补，不得虚构");
  assert.equal(normalized.structure.chapterCount, 2);
  assert.throws(() => validateSet({projectType:"rent",rules:[
    {id:"same",chapter:"第一章",section:"1.1"},{id:"same",chapter:"第二章",section:"2.1"}
  ]}, "rent"), /规则ID重复/);
});

test("前端运行时可把粗粒度报告小节匹配到多条细分逻辑并过滤项目特例", async () => {
  globalThis.window = {};
  globalThis.fetch = async url => {
    const isGaibao=String(url).includes("projectType=gaibao"),data=isGaibao?gaibaoSeed:seed,type=isGaibao?"gaibao":"rent";
    return new Response(JSON.stringify({ok:true,set:{id:"set-"+type,version:1,projectType:type,data}}), {status:200,headers:{"content-type":"application/json"}});
  };
  await import("../report-logic-core.js?reportlogic-test=" + Date.now());
  const core = window.ReportLogicCore;
  await core.load("rent");
  const general = core.match("rent", "总论", "项目背景", {projectText:"普通保障性租赁住房项目"});
  assert.ok(general.length >= 10, "项目背景应覆盖Excel中1.1下的多条细分逻辑");
  assert.equal(general.some(rule => rule.projectSpecific), false, "未命中特征时不得套用参考项目特例");
  const prompt = core.prompt("rent", "总论", "项目背景", {projectText:"普通保障性租赁住房项目"});
  assert.match(prompt, /内部生成约束｜严禁写入报告正文/);
  assert.match(prompt, /所需材料/);
  assert.match(prompt, /材料不足不等于停止写作/);
  assert.match(prompt, /禁止整节只输出待补提示或返回空内容/);
  assert.match(prompt, /不得输出.*写作逻辑/);
  const outline=core.outline("rent");
  assert.equal(outline.chapters.length,14);
  assert.equal(outline.chapters[13].name,"研究结论与建议");
  assert.deepEqual(outline.chapters[13].sections.map(x=>x.t),["结论","建议"]);
  const manualRule=seed.rules.find(rule=>(rule.sourceKinds||[]).includes("manual_upload")&&/^★★★/.test(rule.importance||""));
  const missing=core.requirementStatus(manualRule,{hasKnowledge:true,hasCalculation:true});
  assert.equal(missing.ready,false);
  assert.equal(missing.blocking,true,"重要小节缺人工资料时必须形成生成前阻断提示");
  assert.ok(missing.missing.includes("manual_upload"));
  const inventory=core.materialInventory("rent",{hasCalculation:true});
  assert.equal(inventory.total,137);
  assert.equal(inventory.chapters.length,14);
  assert.equal(inventory.chapters.reduce((sum,chapter)=>sum+chapter.total,0),137);
  assert.ok(inventory.summary.knowledge_base>0);
  assert.ok(inventory.summary.web_search>0);
  assert.ok(inventory.summary.provider>0);
  assert.ok(inventory.summary.calculation_engine>0);
  assert.ok(inventory.summary.manual_upload>0);
  assert.ok(inventory.summary.pendingKnowledge>0);
  assert.ok(inventory.summary.pendingWeb>0);
  assert.ok(inventory.summary.pendingManual>0);
  assert.ok(inventory.items.every(item=>Array.isArray(item.sourceKinds)&&Array.isArray(item.missing)));
  const sourcePlan=core.sourcePlan("rent","总论","项目背景",{context:{hasCalculation:true}});
  assert.ok(sourcePlan.needs.length>0);
  assert.ok(sourcePlan.needs.every(item=>item.label&&item.task&&!Object.hasOwn(item,"requiredSources")),"前台寻源计划不应重复暴露整段Excel来源原文");
  assert.ok(sourcePlan.requirements.length>0);
  assert.ok(sourcePlan.requirements.every(item=>item.schemaVersion===1&&item.fields.length&&item.budget.maxQueries===1&&item.budget.maxResults===5));
  const projectFact=core.dataRequirement({id:"internal",sourceNo:1,chapter:"项目概况",section:"权属",displayTitle:"项目权属与面积",requiredSources:"项目产权证、批复原件和实际面积台账",sourceKinds:["manual_upload","provider"]},{location:"深圳市龙华区"});
  assert.equal(projectFact.dataNature,"project_fact");assert.equal(projectFact.webAllowed,false);assert.ok(!projectFact.query.includes("产权证、批复原件"));
  const wronglyTagged=core.dataRequirement({id:"wrong-web",sourceNo:9,chapter:"项目概况",section:"权属",displayTitle:"项目批复与合同",requiredSources:"网上搜索项目批复、权属证书和合同原件",sourceKinds:["web_search"]},{location:"深圳市龙华区"});
  assert.equal(wronglyTagged.dataNature,"project_fact");assert.equal(wronglyTagged.webAllowed,false,"即使Excel误写网上搜索，项目内部事实也必须禁止联网");
  const marketRequirement=core.dataRequirement({id:"market",sourceNo:2,chapter:"市场分析",section:"租金",displayTitle:"周边租金市场",requiredSources:"网上搜索周边租金",sourceKinds:["web_search"]},{location:"深圳市龙华区"});
  assert.equal(marketRequirement.dataNature,"market_observation");assert.equal(marketRequirement.webAllowed,true);assert.equal(marketRequirement.timeScope.maxAgeMonths,12);assert.match(marketRequirement.query,/深圳市龙华区/);
  assert.equal(marketRequirement.decision.level,"important");assert.ok(marketRequirement.decision.priority>=80);assert.match(marketRequirement.decision.reason,/市场假设/);assert.match(marketRequirement.decision.reuseKey,/rent_market/);
  const refined=core.dataRequirement({id:"market",sourceNo:2,chapter:"市场分析",section:"租金",displayTitle:"周边租金市场",requiredSources:"网上搜索周边租金",sourceKinds:["web_search"]},{location:"深圳市龙华区",requirementOverrides:{market:{version:3,feedback:"只用接口和知识库",requirement:{fields:[{key:"rent",label:"近12个月月租金",dataType:"number",required:true}],geoScope:{level:"district",value:"龙华区"},timeScope:{kind:"latest_12_months",maxAgeMonths:12},allowedChannels:["provider","knowledge_base"],quality:{minScore:90,minAuthority:"A"},budget:{maxQueries:1,maxResults:3}}}}});
  assert.equal(refined.refinementVersion,3);assert.equal(refined.webAllowed,false);assert.deepEqual(refined.allowedChannels,["provider","knowledge_base"]);assert.match(refined.query,/近12个月月租金/);
  assert.notEqual(refined.decision.reuseKey,marketRequirement.decision.reuseKey,"人工精化字段后应重算复用键，使后续批量任务按新版需求演进");
  const actualWebRule=seed.rules.find(rule=>(rule.sourceKinds||[]).includes("web_search")),refinedInventory=core.materialInventory("rent",{requirementOverrides:{[actualWebRule.id]:{version:2,requirement:{allowedChannels:["provider","knowledge_base"]}}}}),refinedRow=refinedInventory.items.find(item=>item.ruleId===actualWebRule.id);
  assert.equal(refinedRow.sourceKinds.includes("web_search"),false);assert.equal(refinedRow.missing.includes("web_search"),false);assert.ok(refinedRow.sourceKinds.includes("provider"));

  const manualEvidence=core.requirementStatus(manualRule,{evidenceByRule:{[manualRule.id]:[{kind:"all",title:"人工上传材料"}]}});
  assert.equal(manualEvidence.ready,true,"只有明确关联到当前规则的上传材料才能消除该规则缺口");
  const unclassified=core.requirementStatus({id:"x",sourceNo:999,sourceKinds:[],importance:""},{});
  assert.equal(unclassified.ready,false,"未配置来源的逻辑项不能被误判为已有材料");
  assert.deepEqual(unclassified.missing,["unclassified"]);
  const criticalReadiness=core.generationReadiness(manualRule,{});
  assert.equal(criticalReadiness.level,"critical");
  assert.equal(criticalReadiness.canDraft,true,"关键资料缺失时仍应允许先生成章节框架");
  const frameworkRule=seed.rules.find(rule=>/^★参考/.test(rule.importance||"")&&!/(数据|表格|金额|批复|证书)/.test([rule.requiredSources,rule.outputForm].join(" ")));
  const frameworkReadiness=core.generationReadiness(frameworkRule,{});
  assert.equal(frameworkReadiness.level,"framework");
  const fallback=core.fallbackDraft("rent","总论","项目背景",{projectText:"普通保障性租赁住房项目"});
  assert.match(fallback,/可先形成完整的论证框架/);
  assert.match(fallback,/【待补：/);
  assert.doesNotMatch(fallback,/本节重点按照以下逻辑展开|写作逻辑：|所需材料摘要：/);
  const marked=core.ensureMissingMarkers("本节可先形成正式分析正文。",[manualRule],{});
  assert.match(marked,/资料待补提示/);
  assert.match(marked,/【待补：/);
  assert.equal(core.ensureMissingMarkers(marked,[manualRule],{}),marked,"同一缺口不得重复追加");
  const links=core.suggestMaterialRuleLinks("rent","项目用地批复.pdf","本文件明确项目规划指标、用地面积和容积率",5);
  assert.ok(links.length>0);
  assert.ok(links.every(item=>item.ruleId&&item.title&&Number.isFinite(item.score)));

  await core.load("gaibao");
  const housing={businessScenario:"housing_conversion",hasCalculation:true},commercial={businessScenario:"commercial_renovation",hasCalculation:true};
  const gaibaoOverview=core.overview("gaibao",housing),gaibaoOutline=core.outline("gaibao",housing),gaibaoInventory=core.materialInventory("gaibao",housing),commercialInventory=core.materialInventory("gaibao",commercial);
  assert.equal(gaibaoOverview.ruleCount,65);
  assert.equal(gaibaoOutline.chapters.length,13);
  assert.equal(gaibaoInventory.total,65);
  assert.equal(commercialInventory.total,67);
  assert.equal(core.overview("gaibao",commercial).businessScenario,"commercial_renovation");
  assert.ok(gaibaoInventory.summary.calculation_engine>2);
  assert.ok(core.match("gaibao","投资估算与资金筹措","投资估算",{projectText:"非居改保项目",...housing}).length>0);
  const housingMarket=core.match("gaibao","项目市场分析","住房市场分析",housing);
  const commercialMarket=core.match("gaibao","项目市场分析","商业市场分析",commercial);
  assert.ok(housingMarket.length>0&&housingMarket.every(rule=>rule.scenarios.includes("housing_conversion")));
  assert.ok(commercialMarket.length>0&&commercialMarket.every(rule=>rule.scenarios.includes("commercial_renovation")));
  assert.match(core.prompt("gaibao","项目总论","项目背景",commercial),/当前业务场景：商业改造（自持改造）/);
  assert.match(core.prompt("gaibao","项目总论","项目背景",commercial),/禁止混用另一场景/);
  const housingScale=core.match("gaibao","项目总论","项目概况",housing).find(rule=>rule.id==="gaibao-v1-009"),commercialScale=core.match("gaibao","项目总论","项目概况",commercial).find(rule=>rule.id==="gaibao-v1-009");
  assert.doesNotMatch(housingScale.writingLogic,/商业改造（自持改造）/);
  assert.doesNotMatch(commercialScale.writingLogic,/非居改保/);
});

test("管理员增强只追加子规则并保留137条原逻辑",()=>{
  const original=structuredClone(seed),base=original.rules[6];
  const enhanced=appendEnhancementData(original,{projectType:"rent",baseRuleId:base.id,enhancement:{requiredSources:"补充：规划指标复函原件、总平面图及指标表",sourceKinds:["manual_upload"],writingLogic:"在原规划指标逻辑后增加文件版本、批复日期和指标勾稽核验。",outputForm:"文字+指标核对表",changeReason:"细化规划指标来源与复核方式"}},"admin",123456);
  assert.equal(enhanced.rules.length,138);
  assert.deepEqual(enhanced.rules.slice(0,137).map(x=>x.id),original.rules.map(x=>x.id));
  const added=enhanced.rules[137];
  assert.equal(added.parentRuleId,base.id);
  assert.equal(added.enhancement,true);
  assert.match(added.requiredSources,/规划指标复函原件/);
  assert.equal(enhanced.changeLog.at(-1).action,"append_enhancement");
});

test("定稿逻辑采纳会替换同一规则并保持规则数量与ID不变",()=>{
  const base=gaibaoSeed.rules.find(rule=>rule.scenarioVariants?.housing_conversion),before=structuredClone(gaibaoSeed);
  const merged=mergeRuleRevisionData(before,{projectType:"gaibao",baseRuleId:base.id,businessScenario:"housing_conversion",revision:{writingLogic:"按定稿后的论证链核验项目条件并形成结论。",outputForm:"文字+核验表",changeReason:"用户定稿采纳"}},"zgbyd",123);
  assert.equal(merged.rules.length,74);
  assert.deepEqual(merged.rules.map(x=>x.id),gaibaoSeed.rules.map(x=>x.id));
  const changed=merged.rules.find(rule=>rule.id===base.id);
  assert.equal(changed.scenarioVariants.housing_conversion.writingLogic,"按定稿后的论证链核验项目条件并形成结论。");
  assert.equal(changed.scenarioVariants.housing_conversion.outputForm,"文字+核验表");
  assert.equal(merged.changeLog.at(-1).action,"merge_rule_revision");
  assert.equal(merged.changeLog.at(-1).by,"zgbyd");
});

test("新旧逻辑自动评测只推荐真正提升且不污染通用规则的候选",()=>{
  const data={projectType:"rent",rules:[{id:"r1",chapter:"第一章",section:"项目背景",requiredSources:"网上搜索",sourceKinds:["web_search"],writingLogic:"说明项目背景。",outputForm:"文字",missingPolicy:"资料缺失时标注待补，不得虚构"}]};
  const good=evaluateRuleRevisionData(data,{projectType:"rent",baseRuleId:"r1",revision:{requiredSources:"取得发布机构、发布日期、统计期和原始官网链接，并核验文件现行有效性",writingLogic:"先核验来源机构和统计期，再比对政策适用条件、数据口径与项目边界，说明差异、风险和结论，形成可追溯的论证链。",outputForm:"文字+依据核验表",changeReason:"增加精确字段和核验步骤"}});
  assert.equal(good.recommended,true);assert.ok(good.candidateScore>=80);assert.ok(good.delta>=2);
  const polluted=evaluateRuleRevisionData(data,{projectType:"rent",baseRuleId:"r1",revision:{writingLogic:"华越龙苑项目投资为1234万元，按2026年8月1日数据直接形成结论。"}});
  assert.equal(polluted.recommended,false);assert.ok(polluted.blockers.some(x=>/项目专属/.test(x)||/具体项目/.test(x)));
});
