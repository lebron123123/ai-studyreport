const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

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
  assert.match(reportSource,/finally\{batch\.done\+\+;if\(aiReportImpactedProgress===batch\)updateProgress\(\);\}/);
  assert.match(reportSource,/保存为报告第"\+version\.version\+"版，可在右上角“查看版本”进入/);
  assert.match(reportSource,/airOpenReportVersionById\(selector\.value\)/);
});

test("空白受影响小节也可生成且候选完成后不再伪装成持续加载",()=>{
  assert.match(reportSource,/unlocked:rows\.filter\(x=>!x\.s\.locked&&x\.s\.syncStatus!=="locked-stale"&&!x\.s\.pendingRevision\)\.length/);
  assert.match(reportSource,/候选稿已生成，等待接受后成为当前工作稿/);
  assert.match(reportSource,/data-status="'\+\(ready\?'done':hasCandidate\?'candidate':s\.generationFailure\?'failed':'pending'\)/);
  assert.match(reportSource,/if\(body\)body\.innerHTML=airGenerationSkeletonHtml\(\)/);
  assert.doesNotMatch(reportSource,/content=ready\?renderContent\(airSectionDisplayContent\(c,s\)\):'<span class="skel"/);
});

test("空白、逻辑待生成、候选和失败占位均执行实际函数且不伪装成加载",()=>{
  const start=reportSource.indexOf('function airEmptySectionBodyHtml('),end=reportSource.indexOf('function airRenderCompletedSection(',start);
  const section={t:'合作安排'},chapter={cn:'test-chapter',sections:[section]};
  const box=vm.createContext({chapters:[chapter],escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(reportSource.slice(start,end),box);
  assert.match(box.airEmptySectionBodyHtml(section),/尚未生成正文/);
  Object.assign(section,{staleKind:'logic',syncStatus:'stale'});assert.match(box.airEmptySectionBodyHtml(section),/尚未生成候选稿/);
  section.generationFailure={message:'模型服务 <失败>'};const failed=box.airEmptySectionBodyHtml(section);assert.match(failed,/生成失败：模型服务 &lt;失败>/);assert.match(failed,/data-cn="test-chapter" data-si="0"/);assert.match(failed,/只重试本节/);assert.doesNotMatch(failed,/skel|持续加载/);
  section.pendingRevision={after:'待确认稿'};const before=JSON.stringify(section);assert.match(box.airEmptySectionBodyHtml(section),/候选稿已生成，等待接受/);assert.doesNotMatch(box.airEmptySectionBodyHtml(section),/生成失败|skel/);assert.equal(JSON.stringify(section),before);
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
  const progress={total:43,done:43,active:false,reportVersionId:'original'},before=JSON.stringify(progress);
  const box=vm.createContext({chapters:[{cn:'一',sections:[{content:'历史正文'}]}],aiReportProgressMsg:progress,
    window:{ProjectWorkflow:{logicRevisionInProgress:()=>true}},airCompletedVersionForProgress:()=>({id:'original'}),
    airReportGenerationStatus:()=>({total:43,generated:43,remaining:0,complete:true})});
  vm.runInContext(reportSource.slice(reportSource.indexOf('function airDeliverHtml('),reportSource.indexOf('async function airDeliverAction(')),box);
  const logicHtml=box.airDeliverHtml();
  assert.match(logicHtml,/这是逻辑调整流程，不是整篇报告重新生成/);
  assert.match(logicHtml,/下载当前阶段 Word/);assert.match(logicHtml,/查看上一完整版本/);
  assert.doesNotMatch(logicHtml,/继续生成剩余|air-resume-inline-btn|air-review-primary/);
  assert.equal(JSON.stringify(progress),before);
  box.airReportGenerationStatus=()=>({total:43,generated:43,remaining:0,complete:true,partialUpdate:{unresolved:9}});
  const partialHtml=box.airDeliverHtml();
  assert.match(partialHtml,/本轮更新尚未完成/);assert.match(partialHtml,/下载当前阶段 Word/);
  assert.doesNotMatch(partialHtml,/这是逻辑调整流程|继续生成剩余|air-review-primary/);
  box.window.ProjectWorkflow.logicRevisionInProgress=()=>false;
  box.airReportGenerationStatus=()=>({total:43,generated:43,remaining:0,complete:true});
  assert.match(box.airDeliverHtml(),/air-review-primary/);
  assert.equal(JSON.stringify(progress),before);
});

test("重复打开独立模块复用现有界面，不反复重绘长报告和材料台账",()=>{
  assert.match(reportSource,/if\(document\.querySelector\("#airDocPane \.air-doc-head"\)\)\{airSetDocVisible\(true\);return;\}/);
  assert.match(reportSource,/if\(airFocusExistingMessage\("materialCheck"\)\)return;/);
  assert.match(reportSource,/if\(airFocusExistingMessage\("infoCard"\)\)return;/);
  assert.match(reportSource,/data-air-msg-kind=/);
});
