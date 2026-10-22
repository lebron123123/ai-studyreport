const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const policy=require('../report-output-policy.js'),build=require('../docxgen.js');
const source=fs.readFileSync(path.resolve(__dirname,'../export.js'),'utf8');
const bytes=Buffer.from([0x50,0x4b,0,255,228,184,173]);
const digest=createHash('sha256').update(bytes).digest('hex');
function result(pages=6,version=2){const maxPages=version===1?120:130;return {ok:pages<=maxPages,pages,maxPages,renderer:'WPS',receipt:{schemaVersion:'report-pagination-receipt-v'+version,documentSha256:digest,checkedAt:'2026-09-22T00:00:00Z',scope:'pagination-only',validationStatus:pages<=maxPages?'within-page-limit':'over-page-limit',pages,maxPages,rulesVersion:policy.contentVersion,documentRulesVersion:policy.contentVersion,templateVersion:build.templateVersion,documentTemplateVersion:build.templateVersion,versionsMatch:true,renderer:'WPS',rendererVersion:'12.0',contentQualityCertified:false},diagnostics:{status:'available',measurement:'actual-renderer-pages',sections:[{bookmark:'_tc0_0',title:'1.1 项目概况',startPage:3,endPage:4}],tables:[{index:1,sectionBookmark:'_tc0_0',startPage:3,endPage:4}],reason:null}};}
function context(){
 const state={calls:0,confirms:0,view:{status:{dataset:{},textContent:''},detail:{replaceChildren(){}}}};
 const ctx={Blob,Uint8Array,TextEncoder,Date,AbortSignal,crypto:webcrypto,ReportOutputPolicy:policy,buildDocxDocument:build,authHeaders:()=>({'x-test':'isolated'}),confirm:()=>{state.confirms++;return true;}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.exportReportPaginationPanel=()=>state.view;
 ctx.exportReportPaginationReceiptView=(_view,data)=>{state.shown=data;state.view.status.dataset.paginationStatus=data.pages>130||data.pages>data.paginationTarget.max?'over-limit':'verified';};
 ctx.fetch=async(_url,options)=>{state.calls++;state.body=options.body;const data=state.result||result();return {ok:data.ok,status:data.ok?200:422,json:async()=>data};};
 return {ctx,state};
}
test('首次起草只测量真实页数，不显示下载弹窗，不把超页确认作为达标',async()=>{
 const {ctx,state}=context();state.result=result(151);
 ctx.exportReportPaginationPanel=()=>{throw Error('measurement must not open download panel');};
 const measured=await ctx.verifyReportPageLimit(new Blob([bytes]),{measurementOnly:true});
 assert.equal(measured.pages,151);assert.equal(measured.ok,false);assert.equal(state.confirms,0);assert.equal(measured.overLimitAccepted,undefined);assert.equal(state.calls,1);
 state.result.receipt.documentSha256='0'.repeat(64);
 await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes]),{measurementOnly:true}),/不一致/);
});
function initialMeasurementContext(){
 const fixture=context(),{ctx}=fixture;
 const plan={planId:'confirmed-test-plan',proseTotal:75000};
 ctx.chapters=[{cn:1,name:'项目总论',checked:true,sections:[{t:'项目背景',content:'已核对的正文',editedHtml:null}]}];
 ctx.ReportLengthUI={savedPlan:()=>plan};ctx.ensureDocxLib=async()=>{};ctx.ensureReportTableTemplates=async()=>{};
 const builder=()=>({document:'same-production-builder'});builder.templateVersion=build.templateVersion;ctx.buildDocxDocument=builder;
 ctx.docx={Packer:{toBlob:async()=>new Blob([bytes])}};
 ctx.buildExportPayload=()=>({chapters:[{sections:[{text:'已核对的正文'}]}],completionReview:{status:'passed',planId:'quality-plan'},paginationTarget:{min:110,max:130,source:'confirmed-length-plan',planId:plan.planId}});
 return {...fixture,plan};
}
test('首次整篇实排使用当前导出链路，返回正文hash和同文件回执，不保存、不下载',async()=>{
 const {ctx,state}=initialMeasurementContext();let checks=0;state.result=result(119);
 const output=await ctx.reportMeasureInitialDelivery({expectedPlanId:'confirmed-test-plan',assertCurrent:async()=>{checks++;}});
 assert.equal(output.pages,119);assert.equal(output.documentSha256,digest);assert.match(output.bodyHash,/^[a-f0-9]{64}$/);assert.equal(output.planId,'confirmed-test-plan');assert.equal(output.qualityReview.status,'passed');assert.equal(state.confirms,0);assert.ok(checks>=4);
});
test('首次实排拒收排版期间变动正文、计划或权限的旧回执',async()=>{
 for(const mutation of ['body','plan','permission']){
  const {ctx,state,plan}=initialMeasurementContext();let deny=false;state.result=result(120);
  ctx.fetch=async()=>{if(mutation==='body')ctx.chapters[0].sections[0].content='人工刚刚写入';if(mutation==='plan')plan.planId='other-plan';if(mutation==='permission')deny=true;return {ok:true,status:200,json:async()=>state.result};};
  await assert.rejects(ctx.reportMeasureInitialDelivery({assertCurrent:async()=>{if(deny)throw Error('权限已变化');}}),/变化/);
  assert.equal(state.confirms,0);
 }
});
function detailMeasurementContext(){
 const fixture=initialMeasurementContext(),{ctx,state}=fixture;
 ctx.chapters=[{cn:1,name:'总论',sections:[{t:'摘要',content:''}]},{cn:2,name:'业务',sections:[{t:'业务分析',content:'已完成的详细分析'}]}];
 ctx.ReportArgument={contract:(_chapter,title)=>({summary:title==='摘要'})};
 ctx.reportSectionContract=()=>({});ctx.ReportCompletionContract={inspect:()=>({status:'passed'})};
 const payload=ctx.buildExportPayload;ctx.buildExportPayload=options=>{state.exportOptions=options;return payload();};
 return fixture;
}
test('明细阶段按同一模板实排，只读保存正文，不把缺摘要的页数当完整报告',async()=>{
 const {ctx,state}=detailMeasurementContext();state.result=result(137);
 const original=JSON.stringify(ctx.chapters);
 const measured=await ctx.reportMeasureInitialDeliveryDetails({expectedPlanId:'confirmed-test-plan'});
 assert.equal(measured.pages,137);assert.equal(measured.measurementScope,'details-only');
 assert.equal(measured.receipt.scope,'pagination-only');assert.equal(measured.receipt.contentQualityCertified,false);
 assert.equal(state.exportOptions.stateOnly,true);assert.equal(state.confirms,0);assert.equal(JSON.stringify(ctx.chapters),original);
});
test('明细实排拒绝缺节、已写摘要、待采用候选、质量阻断及分类模块缺失',async()=>{
 for(const mutate of [ctx=>ctx.chapters[1].sections[0].content='',ctx=>ctx.chapters[0].sections[0].content='已有摘要',ctx=>ctx.chapters[1].sections[0].pendingRevision={after:'候选'},ctx=>ctx.ReportCompletionContract.inspect=()=>({status:'blocked'}),ctx=>delete ctx.ReportArgument]){
  const {ctx,state}=detailMeasurementContext();mutate(ctx);
  await assert.rejects(ctx.reportMeasureInitialDeliveryDetails());assert.equal(state.calls,0);
 }
});
test('明细排版回执到达时重新核对摘要、候选、正文和质量',async()=>{
 for(const mutate of [ctx=>ctx.chapters[0].sections[0].content='新摘要',ctx=>ctx.chapters[1].sections[0].pendingRevision={after:'新候选'},ctx=>ctx.chapters[1].sections[0].content='人工新稿',ctx=>ctx.ReportCompletionContract.inspect=()=>({status:'blocked'})]){
  const {ctx,state}=detailMeasurementContext();state.result=result(137);ctx.fetch=async()=>{mutate(ctx);return {ok:false,status:422,json:async()=>state.result};};
  await assert.rejects(ctx.reportMeasureInitialDeliveryDetails());assert.equal(state.calls,0);assert.equal(state.confirms,0);
 }
});
test('下载端核对实际Blob SHA256与服务端/文件内/页面规则版本',async()=>{
 const {ctx,state}=context(),blob=new Blob([bytes]);
 const data=await ctx.verifyReportPageLimit(blob);
 assert.equal(state.body,blob);assert.equal(data.receipt.documentSha256,digest);assert.equal(state.view.status.dataset.paginationStatus,'verified');assert.equal(state.confirms,0);
 assert.equal(data.receipt.scope,'pagination-only');assert.equal(data.receipt.contentQualityCertified,false);
});
test('哈希错配、版本错误、虚假质量认证和篡改页数均拒绝且不询问超页授权',async()=>{
 const variants=[
  d=>d.receipt.documentSha256='0'.repeat(64),d=>delete d.receipt,d=>d.receipt.rulesVersion='old',d=>d.receipt.documentRulesVersion='old',d=>d.receipt.templateVersion='old',d=>d.receipt.documentTemplateVersion='old',d=>d.receipt.versionsMatch=false,
  d=>d.receipt.scope='content-certified',d=>d.receipt.contentQualityCertified=true,d=>d.receipt.pages=9,d=>d.receipt.validationStatus='over-page-limit',d=>d.receipt.rendererVersion='unknown',d=>d.receipt.renderer='Other',d=>d.receipt.checkedAt='invalid',d=>d.pages=0,d=>d.pages=1.5,d=>d.maxPages=999,d=>d.maxPages=120,d=>d.receipt.maxPages=120,d=>d.receipt.schemaVersion='report-pagination-receipt-v3',d=>d.receipt.schemaVersion='report-pagination-receipt-v1',
 ];
 for(const change of variants){const {ctx,state}=context();state.result=result();change(state.result);await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])));assert.equal(state.confirms,0);assert.equal(state.view.status.dataset.paginationStatus,'failed');}
 const {ctx,state}=context();state.result=result(171);state.result.receipt.documentSha256='0'.repeat(64);await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])),/文件不一致/);assert.equal(state.confirms,0);
});
test('新旧分页协议均严格核对；121–130页按当前目标不误报，不询问超页',async()=>{
 for(const version of [1,2])for(const pages of [110,120,121,125,130]){
  const {ctx,state}=context();state.result=result(pages,version);
  // Server metadata cannot silently replace the captured client target.
  state.result.paginationTarget={min:1,max:999,source:'confirmed-length-plan',planId:'forged'};
  const data=await ctx.verifyReportPageLimit(new Blob([bytes]));
  assert.equal(state.confirms,0);assert.equal(state.view.status.dataset.paginationStatus,'verified');assert.equal(data.paginationTarget.min,110);assert.equal(data.paginationTarget.max,130);assert.equal(data.receipt.maxPages,version===1?120:130);
 }
 const {ctx,state}=context();state.result=result(121);ctx.fetch=async()=>({ok:false,status:422,json:async()=>state.result});
 await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])),/状态不一致/);assert.equal(state.confirms,0);
});
test('已确认自选计划优先且与固定保护线分开，旧计划无效不偷套，异步目标保持快照',async()=>{
 const L=require('../report-length-plan.js'),outline=[{name:'完整业务',sections:Array.from({length:43},(_,i)=>({t:'分析'+i}))}];
 const plan=pages=>({...L.createPlan(outline,{targetPages:pages,planningPriority:'pages'}),confirmedAt:'2026-10-10T02:00:00Z',budgetResolution:{policy:'confirmed-length-plan'}});
 const {ctx,state}=context();ctx.ReportLengthPlan=L;
 const target=ctx.exportReportPaginationTarget(plan(100));assert.equal(target.min,90);assert.equal(target.max,110);
 state.result=result(115);const data=await ctx.verifyReportPageLimit(new Blob([bytes]),{paginationTarget:target});assert.equal(state.confirms,1);assert.equal(data.ok,true);assert.equal(data.overLimitAccepted,true);assert.match(state.view.status.textContent,/90–110页目标（未达标）/);assert.doesNotMatch(state.view.status.textContent,/超过固定130/);
 state.result=result(140);await ctx.verifyReportPageLimit(new Blob([bytes]),{paginationTarget:ctx.exportReportPaginationTarget(plan(150))});assert.match(state.view.status.textContent,/135–165页自选目标范围/);assert.match(state.view.status.textContent,/固定130页下载保护线/);
 const invalid=plan(100);invalid.targetPageRange.max=999;assert.equal(ctx.exportReportPaginationTarget(invalid).source,'default');
 const old=plan(100);old.version='20261009-confirmed-length-v2';assert.equal(ctx.exportReportPaginationTarget(old).max,130);
 state.result=result(115);state.confirms=0;ctx.fetch=async()=>{target.max=999;return {ok:true,status:200,json:async()=>state.result};};
 const frozen=await ctx.verifyReportPageLimit(new Blob([bytes]),{paginationTarget:target});assert.equal(frozen.paginationTarget.max,110);assert.equal(state.confirms,1);
});
test('真实超页回执仅在明确同意后放行，取消不下载、不标达标',async()=>{
 const {ctx,state}=context();state.result=result(171);
 const data=await ctx.verifyReportPageLimit(new Blob([bytes]));
 assert.equal(state.confirms,1);assert.equal(data.ok,false);assert.equal(data.overLimitAccepted,true);assert.equal(state.view.status.dataset.paginationStatus,'over-limit');assert.match(state.view.status.textContent,/未达标/);
 ctx.confirm=()=>false;await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])),/已取消/);assert.equal(state.view.status.dataset.paginationStatus,'cancelled');
});
test('服务失败、响应状态矛盾、缺有效页数以及无安全哈希能力均不放行',async()=>{
 for(const reply of [{ok:false,status:503,json:async()=>({ok:false,error:'排版不可用'})},{ok:true,status:200,json:async()=>result(171)},{ok:false,status:422,json:async()=>result()},{ok:true,status:200,json:async()=>{throw Error('not json');}}]){
  const {ctx,state}=context();ctx.fetch=async()=>reply;await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])));assert.equal(state.confirms,0);assert.equal(state.view.status.dataset.paginationStatus,'failed');
 }
 const {ctx,state}=context();ctx.fetch=async()=>{throw Error('network');};await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])),/服务暂不可用/);
 ctx.crypto={};await assert.rejects(ctx.verifyReportPageLimit(new Blob([bytes])),/HTTPS 或 localhost/);assert.equal(state.calls,0);
});
test('浏览器隔离验收：真实DOM可折叠回执、部分/空明细、失败、重复和刷新',{timeout:60000},async()=>{
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let payload=result(),status=200,release;
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>分页回执隔离测试</title><button id="verify">核验系统测试文件</button><div id="out"></div><script src="/report-output-policy.js"></script><script src="/docxgen.js"></script><script src="/export.js"></script><script>window.authHeaders=()=>({});document.querySelector("#verify").onclick=async()=>{try{const result=await verifyReportPageLimit(new Blob([new Uint8Array('+JSON.stringify([...bytes])+')]));document.querySelector("#out").textContent=result.overLimitAccepted?"超页已确认":"仅分页通过";}catch(e){document.querySelector("#out").textContent=e.message;}};</script></html>';
  await page.route('**/*',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/api/report-pagination'){if(release)await new Promise(resolve=>{release.resolve=resolve;});return route.fulfill({status,json:payload});}
   const files={'/report-output-policy.js':'report-output-policy.js','/docxgen.js':'docxgen.js','/export.js':'export.js'};
   if(files[pathname])return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.resolve(__dirname,'..',files[pathname]),'utf8')});
   return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://localhost:8080/[system-test]-pagination');
  for(let pass=0;pass<2;pass++){
   if(pass)await page.reload();
   release={};await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="loading"]');
   while(!release.resolve)await new Promise(resolve=>setTimeout(resolve,10));release.resolve();release=null;
   await page.waitForSelector('[data-pagination-status="verified"]');assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),/实际 6 页/);assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),/低于110–130页详实目标/);
   for(let i=0;i<5;i++){await page.locator('#reportPaginationReceiptPanel summary').click();assert.equal(await page.locator('#reportPaginationReceiptPanel details').evaluate(node=>node.open),i%2===0);}
   const text=await page.locator('#reportPaginationReceiptPanel').innerText();assert.match(text,/1.1 项目概况：第 3–4 页/);assert.match(text,/表 1：第 3–4 页/);assert.match(text,/不证明正文事实/);assert.match(text,/不能相加/);
   await page.locator('#reportPaginationReceiptPanel button').click();assert.equal(await page.locator('#reportPaginationReceiptPanel').count(),0);
  }
  for(const [pages,depth,text] of [[60,'below-target','需核查分析深度'],[110,'within-target','内容仍须审签'],[115,'within-target','内容仍须审签'],[121,'within-target','内容仍须审签'],[130,'within-target','内容仍须审签']]){
   payload=result(pages);await page.locator('#verify').click();await page.waitForSelector('[data-depth-status="'+depth+'"]');assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),new RegExp(text));
  }
  payload=result();payload.diagnostics={status:'partial',measurement:'actual-renderer-pages',sections:[],tables:[{index:1,startPage:3,endPage:4}],reason:'旧稿缺结束书签'};
  await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="verified"]');await page.locator('#reportPaginationReceiptPanel summary').click();assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),/旧稿缺结束书签/);
  payload=result();payload.diagnostics={status:'unavailable',measurement:'actual-renderer-pages',sections:[],tables:[],reason:'此引擎仅有总页数'};
  await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="verified"]');await page.locator('#reportPaginationReceiptPanel summary').click();assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),/章节实际页区间不可用/);
  payload=result();payload.diagnostics.sections[0].title='<img src=x onerror="throw Error(1)">';await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="verified"]');assert.equal(await page.locator('#reportPaginationReceiptPanel img').count(),0);
  payload=result(171);status=422;page.once('dialog',dialog=>dialog.dismiss());await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="cancelled"]');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#verify').click();await page.waitForFunction(()=>document.querySelector('#out').textContent==='超页已确认');assert.match(await page.locator('[data-pagination-status="over-limit"]').innerText(),/未达标/);
  payload={ok:false,error:'[系统测试]排版失败'};status=503;await page.locator('#verify').click();await page.waitForSelector('[data-pagination-status="failed"]');assert.match(await page.locator('#reportPaginationReceiptPanel').innerText(),/排版失败/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
