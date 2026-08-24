import test from "node:test";
import assert from "node:assert/strict";
import seed from "../functions/api/_reportlogic-seed.js";
import { validateSet, appendEnhancementData } from "../functions/api/reportlogic.js";

test("出租类逐小节逻辑以137条和14章为正式基线并连续重编号", () => {
  assert.equal(seed.rules.length, 137);
  assert.equal(seed.structure.chapterCount, 14);
  assert.deepEqual(seed.rules.map(rule => rule.sourceNo), Array.from({length:137}, (_, index) => index + 1));
  assert.equal(new Set(seed.rules.map(rule => rule.id)).size, 137);
  assert.equal(seed.rules[116].legacySourceNo, "158");
  assert.equal(seed.rules[27].writingLogic, seed.rules[26].writingLogic, "纵向合并的共用写作逻辑应继承到后续行");
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
  globalThis.fetch = async () => new Response(JSON.stringify({ok:true,set:{id:"set1",version:1,projectType:"rent",data:seed}}), {status:200,headers:{"content-type":"application/json"}});
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
