const test=require("node:test");
const assert=require("node:assert/strict");
const Trust=require("../report-trust.js");
global.ReportTrust=Trust;
delete require.cache[require.resolve("../project-workflow.js")];
const Workflow=require("../project-workflow.js");

test("四类信息标签能同时表达白箱计算、事实依据、AI判断和待核假设",()=>{
  const p=Trust.buildSectionProfile({numeric:true,content:"收入依据正式材料测算。【待补：最终批复】",prov:{hasCalcData:true,model:"m1",kbDocs:[{title:"批复"}],confidence:{score:.92}}},{hasCalculation:true});
  assert.deepEqual(p.types,[Trust.TYPES.CALCULATION,Trust.TYPES.FACT,Trust.TYPES.ASSUMPTION,Trust.TYPES.AI_JUDGEMENT]);
  assert.equal(p.primaryType,Trust.TYPES.CALCULATION);
  assert.ok(p.score<92,"存在待补内容时必须扣分");
});

test("无证据AI正文不会被误标成事实，高置信度必须有来源",()=>{
  const p=Trust.buildSectionProfile({content:"项目具备较好发展前景",prov:{model:"m1"}});
  assert.deepEqual(p.types,[Trust.TYPES.AI_JUDGEMENT]);
  assert.equal(p.score,52);
});

test("报告版本绑定项目、参数、测算、知识、证据、流程、模型和审查快照",()=>{
  const state=Workflow.ensureState({knowledgeSnapshotId:"kb-2",evidenceSnapshotId:"ev-3",reviewSnapshotId:"rv-1"});
  const calc=Workflow.createCalcSnapshot(state,"rent",{rent:42},{summary:{irr:3.1}},{reason:"确认"});
  const chapters=[{cn:"一",name:"总论",sections:[{t:"项目概况",content:"正文",prov:{model:"deepseek",kbDocs:[{title:"依据"}]}}]}];
  const v=Workflow.createReportVersion(state,chapters,{projectData:{name:"A项目"},knowledgeSnapshot:{docs:["x"]},evidenceSnapshot:{items:["y"]},workflowVersion:"wf-2",promptVersion:"p-7",model:"deepseek",reviewSnapshot:{errors:0}});
  assert.equal(v.lineage.calculation.id,calc.id);
  assert.ok(v.lineage.projectData.hash);assert.ok(v.lineage.parameterSet.hash);assert.ok(v.lineage.knowledge.hash);assert.ok(v.lineage.evidence.hash);assert.ok(v.lineage.review.hash);
  assert.equal(v.lineage.workflowVersion,"wf-2");assert.equal(v.lineage.promptVersion,"p-7");assert.equal(v.lineage.model,"deepseek");
  assert.equal(v.trustSummary.total,1);assert.equal(v.chapters[0].sections[0].trust.primaryType,Trust.TYPES.FACT);
});

test("正文相同但证据快照变化时必须形成新报告版本",()=>{
  const state=Workflow.ensureState({}),chapters=[{cn:"一",name:"总论",sections:[{t:"背景",content:"同一正文"}]}];
  const a=Workflow.createReportVersion(state,chapters,{evidenceSnapshot:{version:1}});
  const b=Workflow.createReportVersion(state,chapters,{evidenceSnapshot:{version:2}});
  assert.notEqual(a.id,b.id);assert.equal(state.reportVersions.length,2);
});

test("报告可信度汇总准确列出低可信与待补小节",()=>{
  const s=Trust.buildReportSummary([{cn:"一",sections:[{t:"有依据",content:"内容",prov:{hasCalcData:true}},{t:"待补",content:"【待补：批复】",prov:{model:"m"}}]}]);
  assert.equal(s.total,2);assert.equal(s.attention.length,1);assert.equal(s.attention[0].title,"待补");
});
