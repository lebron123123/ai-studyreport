const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),G=require("../report-golden.js");
const raw=JSON.parse(fs.readFileSync(require.resolve("../data/report-golden-tax-v2-training.json"),"utf8"));
test("税务局阶段稿候选带来源哈希且不会冒充经理终稿",()=>{const sample=G.createSample(raw);assert.equal(sample.datasetRole,"training");assert.equal(sample.approvalStatus,"phase_draft_not_manager_approved");assert.match(sample.sourceDocument.sha256,/^[a-f0-9]{64}$/);assert.match(sample.reviewBaseline.publishGate,/经理确认后的终稿/);});
test("税务局阶段稿候选覆盖结构和关键白箱事实",()=>{const sample=G.createSample(raw);assert.equal(sample.sections.length,4);assert.equal(sample.expectedFacts.unitCount,51);assert.equal(sample.expectedFacts.grossAreaSqm,5621.15);assert.equal(sample.expectedFacts.irrPercent,25.79);});
test("龙悦居保留隔离Holdout候选，只有文档哈希不得冒充逐句核验",()=>{
  const source=JSON.parse(fs.readFileSync(require.resolve("../data/report-golden-longyue-holdout.json"),"utf8")),sample=G.createSample(source),E=require("../report-evidence-graph.js");
  const chapters=sample.sections.map((s,i)=>({cn:i+1,name:s.chapter,sections:[{t:s.title,content:s.text,numeric:s.numeric,prov:s.prov}]})),audit=E.preSubmitAudit(chapters);
  assert.equal(sample.datasetRole,"holdout");assert.equal(sample.approvalStatus,"historical_document_holdout_candidate");
  assert.equal(sample.sourceDocument.sha256,"d850413026be64edc4fce103ad457abaf8a263f13cdf8ee9c413eb383ae880ae");
  assert.equal(audit.ready,false);assert.equal(audit.independentReviewRequired,true);
  assert.equal(audit.candidateCoverage,100);assert.equal(audit.claimCoverage,0);
  assert.ok(audit.issues.some(x=>x.code==='NUMERIC_WITHOUT_EVIDENCE'));
});
