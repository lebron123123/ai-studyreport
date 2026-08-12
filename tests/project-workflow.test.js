const test=require("node:test");
const assert=require("node:assert/strict");
const WF=require("../project-workflow.js");

function chapters(){return [
  {cn:"三",name:"市场与需求分析",sections:[{t:"租赁市场与需求分析",numeric:false,content:"旧市场稿"},{t:"政策分析",numeric:false,content:"政策稿"}]},
  {cn:"十",name:"财务评价",sections:[{t:"运营收入与成本分析",numeric:true,content:"旧财务稿"},{t:"敏感性分析",numeric:true,content:"旧敏感稿",locked:true}]},
  {cn:"十三",name:"研究结论及建议",sections:[{t:"项目可行性结论",numeric:false,content:"旧结论"}]},
];}

test("租金变化影响市场、全部数据节和结论，但不误伤纯政策节",()=>{
  const hits=WF.impactedSections(chapters(),["rent"]),titles=hits.map(x=>x.title);
  assert.ok(titles.includes("租赁市场与需求分析"));assert.ok(titles.includes("运营收入与成本分析"));assert.ok(titles.includes("敏感性分析"));assert.ok(titles.includes("项目可行性结论"));assert.ok(!titles.includes("政策分析"));
});

test("标记受影响章节时保留人工锁定，状态为locked-stale",()=>{
  const cs=chapters();WF.markImpacted(cs,["rent"],"租金已变");
  assert.equal(cs[1].sections[0].syncStatus,"stale");assert.equal(cs[1].sections[1].syncStatus,"locked-stale");assert.equal(cs[1].sections[1].locked,true);
});

test("测算预演差异只列变化数字并计算增幅",()=>{
  const d=WF.summaryDiff({irr:3,totalIncome:100,totalCost:80},{irr:2.5,totalIncome:90,totalCost:80});
  assert.equal(d.length,2);assert.equal(d.find(x=>x.key==="irr").delta,-0.5);assert.equal(d.find(x=>x.key==="totalIncome").deltaPct,-10);
});

test("测算快照和报告版本绑定且相同正文不重复制造版本",()=>{
  const state=WF.ensureState({}),cs=chapters();
  const snap=WF.createCalcSnapshot(state,"rent",{rent:45},{summary:{irr:3}},{reason:"初次确认"});
  const r1=WF.createReportVersion(state,cs,{reason:"初稿"}),r2=WF.createReportVersion(state,cs,{reason:"重复保存"});
  assert.equal(r1.calcSnapshotId,snap.id);assert.equal(r1.id,r2.id);assert.equal(state.reportVersions.length,1);
});

test("AI候选稿拒绝不改正文，接受后可撤销",()=>{
  const s={content:"原稿",editedHtml:null};WF.setCandidate(s,"建议稿","更正式");WF.rejectCandidate(s);assert.equal(s.content,"原稿");
  WF.setCandidate(s,"建议稿","更正式");WF.acceptCandidate(s);assert.equal(s.content,"建议稿");assert.equal(s.pendingRevision,null);assert.equal(WF.undoSection(s),true);assert.equal(s.content,"原稿");
});

test("报告版本保存锁定、同步状态和溯源，不只保存正文",()=>{
  const state=WF.ensureState({}),cs=chapters();cs[1].sections[1].syncStatus="locked-stale";cs[1].sections[1].prov={model:"x",kbDocs:[{title:"依据"}]};
  const v=WF.createReportVersion(state,cs,{reason:"复核版"}),saved=v.chapters[1].sections[1];
  assert.equal(saved.locked,true);assert.equal(saved.syncStatus,"locked-stale");assert.equal(saved.prov.kbDocs[0].title,"依据");
});

test("完整报告版本最多保留5份且版本号持续递增，避免项目JSON无限膨胀",()=>{
  const state=WF.ensureState({}),cs=chapters();
  for(let i=1;i<=8;i++){cs[0].sections[0].content="版本"+i;WF.createReportVersion(state,cs,{reason:"v"+i});}
  assert.equal(state.reportVersions.length,5);assert.deepEqual(state.reportVersions.map(x=>x.version),[4,5,6,7,8]);assert.equal(state.currentReportVersionId,state.reportVersions[4].id);
});

test("批量人工确认只勾选未确认项并返回准确数量，不触发后续测算",()=>{
  const boxes=[{checked:false},{checked:true},{checked:false}];
  const r=WF.bulkConfirm(boxes);
  assert.deepEqual(r,{total:3,changed:2});assert.ok(boxes.every(x=>x.checked));
});

test("AI可研流程阶段由已形成的业务结果决定，刷新后不会倒退",()=>{
  assert.equal(WF.aiReportStage({}),"empty");
  assert.equal(WF.aiReportStage({extracted:{projectName:"A"}}),"info");
  assert.equal(WF.aiReportStage({extracted:{},suggested:{params:{rent:50}}}),"suggested");
  assert.equal(WF.aiReportStage({suggested:{},calcParams:{rent:50}}),"calculated");
  assert.equal(WF.aiReportStage({hasDoc:true,suggested:{},calcParams:{}}),"generating");
  assert.equal(WF.aiReportStage({chat:[{kind:"genProgress",total:3,done:3,active:false,stopped:false}]}),"delivered");
});

test("传统财务测算结果不能污染AI可研流程阶段",()=>{
  assert.equal(WF.aiReportStage({calcParams:{rent:50},calcSummary:{irr:3.2}}),"empty");
  assert.equal(WF.aiReportStage({extracted:{projectName:"A"},calcParams:{rent:50}}),"info");
});

test("AI可研暂停生成与最终交付能区分，确保只展示正确的继续按钮",()=>{
  assert.equal(WF.aiReportStage({suggested:{},chat:[{kind:"genProgress",total:8,done:3,active:false,stopped:true}]}),"paused");
  assert.equal(WF.aiReportStage({suggested:{},chat:[{kind:"deliver"}],calcParams:{}}),"delivered");
  assert.ok(WF.aiReportStageRank("calculated")>WF.aiReportStageRank("suggested"));
});

test("刷新草稿时保留AI可研入口，普通旧草稿仍回到传统报告流程",()=>{
  assert.equal(WF.resumeAppMode("report",true),"aireport");
  assert.equal(WF.resumeAppMode("aireport",true),"aireport");
  assert.equal(WF.resumeAppMode(undefined,false),"report");
  assert.equal(WF.resumeAppMode("calc",false),"calc");
});

test("报告完成后可用自然语言直接进入复核，但普通咨询不会误跳转",()=>{
  assert.equal(WF.aiReportDirectAction("复核"),"review");
  assert.equal(WF.aiReportDirectAction("帮我进入复核与签发"),"review");
  assert.equal(WF.aiReportDirectAction("现在进行人工审查"),"review");
  assert.equal(WF.aiReportDirectAction("复核一下租金变化有什么影响"),null);
});

test("项目综合诊断汇总白箱指标、异常、敏感性、来源和章节状态",()=>{
  const d=WF.buildProjectDiagnostic({project:{name:"A项目",location:"龙华区"},calcType:"rent",summary:{irr:2.8,totalNpv:-120,totalIncome:1000},
    anomalies:[{severity:"error",key:"stableOcc",label:"稳定期出租率",message:"超过规则上限",rule:"不高于95%"}],
    sensitivity:[{key:"rent",label:"租金",impactLabel:"核心",impactRank:1,STi:0.42}],
    sources:{rent:{confidence:"低",requiresManualConfirmation:true,from:"行业兜底"}},paramMeta:{rent:{label:"起始租金"}},
    sections:[{title:"财务分析",status:"stale"},{title:"结论",status:"locked-stale",locked:true}],reviewIssues:[{sev:"warn",secTitle:"需求分析",msg:"缺少数据表"}],knowledgeEvidence:[{title:"公司指引",score:0.9}]});
  assert.equal(d.metrics.irr,2.8);assert.equal(d.hardRuleAnomalies.length,1);assert.equal(d.sensitivityTop[0].key,"rent");assert.equal(d.parameterSourceRisks[0].label,"起始租金");
  assert.equal(d.reportStatus.stale,1);assert.equal(d.reportStatus.lockedStale,1);assert.equal(d.dataAvailability.hasKnowledgeEvidence,true);assert.ok(d.actionCandidates.some(x=>x.priority==="高"));
});

test("项目综合诊断在数据缺失时明确标识不可用，不伪造行业或敏感性结论",()=>{
  const d=WF.buildProjectDiagnostic({project:{name:"空项目"}});
  assert.deepEqual(d.metrics,{});assert.equal(d.dataAvailability.hasCalculation,false);assert.equal(d.dataAvailability.hasSensitivity,false);assert.equal(d.knowledgeEvidence.length,0);
  assert.ok(d.actionCandidates.some(x=>x.basisType==="数据缺口"));assert.ok(d.guardrails.some(x=>x.includes("不能推测")));
});
