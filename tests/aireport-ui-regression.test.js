const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const reportSource=fs.readFileSync(path.join(root,"aireport.js"),"utf8");
const pageSource=fs.readFileSync(path.join(root,"index.html"),"utf8");

test("小节逻辑入口兼容 data 属性字符串和历史数字章节编号",()=>{
  assert.match(reportSource,/String\(item\.cn\)===String\(cn\)/);
  assert.match(reportSource,/void airOpenSectionLogicEditor\([\s\S]*?\.catch\(error=>alert\("打开本节生成逻辑失败："\+error\.message\)\)/);
});

test("共享弹窗自身可滚动且阻止滚动传递到报告正文",()=>{
  assert.match(pageSource,/\.air-modal-overlay\{[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/);
  assert.match(pageSource,/\.air-modal-card\{[^}]*max-height:calc\(100dvh - 48px\);[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/);
  assert.match(pageSource,/\.air-modal-head\{[^}]*position:sticky;top:0/);
  assert.match(pageSource,/\.air-modal-actions\{[^}]*position:sticky;bottom:0/);
  assert.match(pageSource,/\.air-enhance-modal>\*\{flex-shrink:0\}/);
});

test("报告候选稿提供批量接受入口且正式后台逻辑不再要求重复采纳",()=>{
  assert.match(reportSource,/air-doc-accept-candidates/);
  assert.match(reportSource,/ProjectWorkflow\.acceptAllCandidates\(chapters\)/);
  assert.match(reportSource,/已使用正式后台逻辑，无需再次采纳/);
  assert.match(reportSource,/allowLogicAdoption:!!t\.s\.logicSnapshot\?\.localOverride/);
});

test("受影响候选稿显示逐项完成进度且批量接受明确生成可进入版本",()=>{
  assert.match(reportSource,/生成进度 ["+]*aiReportImpactedProgress\.done\+"\/"\+aiReportImpactedProgress\.total/);
  assert.match(reportSource,/finally\{aiReportImpactedProgress\.done\+\+;updateProgress\(\);\}/);
  assert.match(reportSource,/保存为报告第"\+version\.version\+"版，可在右上角“查看版本”进入/);
  assert.match(reportSource,/airOpenReportVersionById\(selector\.value\)/);
});

test("空白受影响小节也可生成且候选完成后不再伪装成持续加载",()=>{
  assert.match(reportSource,/unlocked:rows\.filter\(x=>!x\.s\.locked&&x\.s\.syncStatus==="stale"&&!x\.s\.pendingRevision\)\.length/);
  assert.match(reportSource,/候选稿已生成，等待接受后成为当前工作稿/);
  assert.match(reportSource,/data-status="'\+\(ready\?'done':hasCandidate\?'candidate':'pending'\)/);
  assert.match(reportSource,/if\(body\)body\.innerHTML=airGenerationSkeletonHtml\(\)/);
  assert.doesNotMatch(reportSource,/content=ready\?renderContent\(airSectionDisplayContent\(c,s\)\):'<span class="skel"/);
});

test("章节圆点表示逻辑同步而非材料缺口，候选处理后立即刷新",()=>{
  assert.match(reportSource,/function airChapterSyncLevel\(chapter\)/);
  assert.match(reportSource,/本章逻辑已同步/);
  assert.match(reportSource,/const level=airChapterSyncLevel\(c\)/);
  assert.match(reportSource,/airRefreshSection\(cn,si\);airApplyDocMaterialStatuses\(\);/);
});

test("逻辑候选生成期间不把历史整篇生成记录改写为第二轮进度",()=>{
  assert.match(reportSource,/historicalProgressDuringLogicRevision\(projectWorkflow,chapters,aiReportProgressMsg\)/);
  assert.match(reportSource,/if\(!historicalLogicProgress&&aiReportProgressMsg&&window\.ProjectWorkflow\?\.reconcileGenerationProgress\)/);
  assert.match(reportSource,/这是逻辑调整流程，不是整篇报告重新生成/);
  assert.match(reportSource,/const actions=logicRevision[\s\S]*?:complete/);
});
