const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto'),policy=require('../report-output-policy.js'),docxBuilder=require('../docxgen.js');
const source=fs.readFileSync(require.resolve('../export.js'),'utf8');
const fn=source.slice(source.indexOf('async function exportWord(){'),source.indexOf('/* ================= 测算说明书 Word 导出'));
function paginationResult(pages=3){return {ok:pages<=120,pages,maxPages:120,renderer:'WPS',receipt:{schemaVersion:'report-pagination-receipt-v1',documentSha256:createHash('sha256').update('doc').digest('hex'),checkedAt:'2026-09-22T00:00:00Z',scope:'pagination-only',validationStatus:pages<=120?'within-page-limit':'over-page-limit',pages,maxPages:120,rulesVersion:policy.contentVersion,documentRulesVersion:policy.contentVersion,templateVersion:docxBuilder.templateVersion,documentTemplateVersion:docxBuilder.templateVersion,versionsMatch:true,renderer:'WPS',rendererVersion:'12.0',contentQualityCertified:false}};}
function preparedResponse(pages=3,{tampered=false}={}){
 const data=paginationResult(pages),form=new FormData();
 data.receipt.tocUpdated=true;data.receipt.preparedDocumentSha256=createHash('sha256').update('updated-doc').digest('hex');
 form.set('receipt',JSON.stringify(data));form.set('document',new Blob([tampered?'wrong-doc':'updated-doc']),'report.docx');
 return new Response(form,{status:pages>120?422:200});
}
function fixture({changeDuringPack=false}={}){
 let current='run_old',payloadSeen,clicks=[],errors=[],downloaded=[];
 const project={name:'旧研究'},input={project,chapters:[{name:'第一章'}],versionNote:'工作稿',signed:false,completionReview:{status:'passed',planId:'plan-test',issues:[],reviews:[]}};
 const window={crypto:webcrypto,ReportOutputPolicy:policy,ResearchUI:{active:()=>true,capture:()=>({researchId:'research_a',runId:current}),guard:async token=>{if(token.runId!==current)throw Error('研究轮次已变化');}},docx:{Packer:{toBlob:async()=>{project.name='后来修改';if(changeDuringPack)current='run_new';return new Blob(['doc']);}}},buildDocxDocument:(_,payload)=>{payloadSeen=payload;return payload;}};
 window.buildDocxDocument.templateVersion=docxBuilder.templateVersion;
 const sandbox={window,project,currentProjectId:null,projectWorkflow:{reportVersions:[]},ensureDocxLib:async()=>{},ensureReportTableTemplates:async()=>{},fetch:async(_url,options)=>{assert.equal(options.headers.Accept,'multipart/form-data');return preparedResponse();},authHeaders:()=>({}),AbortSignal,buildExportPayload:()=>input,collectReportImages:async()=>[],Blob,URL:{createObjectURL:blob=>{downloaded.push(blob);return '/download';},revokeObjectURL(){}},document:{getElementById:()=>null,createElement:()=>({click(){clicks.push(this.download);}}),body:{appendChild(){},removeChild(){}}},alert:x=>errors.push(x)};
 vm.createContext(sandbox);vm.runInContext(fn,sandbox);
 // The actual receipt/hash gate remains active; its DOM is covered by report-pagination-frontend.
 sandbox.exportReportPaginationPanel=()=>({status:{dataset:{}},detail:{replaceChildren(){}}});
 sandbox.exportReportPaginationReceiptView=()=>{};
 return {sandbox,clicks,errors,input,downloaded,payload:()=>payloadSeen};
}
test('Word export deep freezes payload and filename; a historical round remains unsigned',async()=>{
 const f=fixture();await f.sandbox.exportWord();assert.equal(f.errors.length,0);assert.equal(f.clicks.length,1);assert.match(f.clicks[0],/^旧研究_未签发工作稿/);assert.equal(f.payload().project.name,'旧研究');assert.equal(f.payload().signed,false);
 assert.equal(await f.downloaded[0].text(),'updated-doc','downloads the verified, populated file, never the original packed blob');
});
test('工作稿导出绑定已确认篇幅计划，历史快照不借用当前计划，未确认或失效计划回退默认范围',()=>{
 const L=require('../report-length-plan.js'),f=fixture();
 const outline=[{cn:'一',name:'完整业务',checked:true,sections:Array.from({length:43},(_,i)=>({t:'业务小节'+(i+1),content:''}))}];
 const plan=L.createPlan(outline,{targetPages:100,budgetPriority:'pages'});plan.confirmedAt='2026-10-10T00:00:00Z';plan.budgetResolution={policy:'confirmed-length-plan'};
 Object.assign(f.sandbox,{chapters:outline,calcResult:null,getDocNo:()=>'',renderContent:()=>''});
 f.sandbox.document.querySelectorAll=()=>[];f.sandbox.window.ReportLengthPlan=L;f.sandbox.window.ReportLengthUI={savedPlan:()=>plan};
 vm.runInContext(source.slice(source.indexOf('function exportProvenance('),source.indexOf('/* ===== 图表转PNG')),f.sandbox);
 const draft=f.sandbox.buildExportPayload();assert.equal(draft.paginationTarget.min,90);assert.equal(draft.paginationTarget.max,110);assert.equal(draft.paginationTarget.planId,plan.planId);
 const historical=f.sandbox.buildExportPayload({version:{version:9,chapters:outline}});assert.equal(historical.paginationTarget.source,'default');assert.equal(historical.paginationTarget.min,110);assert.equal(historical.paginationTarget.max,130);
 plan.targetPageRange.max=999;assert.equal(draft.paginationTarget.max,110,'captured target is independent of later plan edits');assert.equal(f.sandbox.buildExportPayload().paginationTarget.source,'default');
 delete plan.confirmedAt;assert.equal(f.sandbox.buildExportPayload().paginationTarget.source,'default');
});
test('Word异步打包冻结自选目标，115页超过90–110目标须确认且不误称超过130保护线',async()=>{
 for(const accepted of [true,false]){
  const f=fixture();f.input.paginationTarget={min:90,max:110,targetPages:100,source:'confirmed-length-plan',planId:'plan-custom'};
  f.sandbox.window.docx.Packer.toBlob=async()=>{f.input.paginationTarget.max=999;return new Blob(['doc']);};
  f.sandbox.fetch=async()=>preparedResponse(115);let prompts=0;
  f.sandbox.confirm=message=>{prompts++;assert.match(message,/90–110页目标（未达标）/);assert.doesNotMatch(message,/超过固定130/);return accepted;};
  await f.sandbox.exportWord();assert.equal(prompts,1);assert.equal(f.payload().paginationTarget.max,110);assert.equal(f.clicks.length,accepted?1:0);
 }
});
test('late Word packing cannot download after research restart or switch',async()=>{
 const f=fixture({changeDuringPack:true});await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.match(f.errors[0],/轮次已变化/);
});

test('历史Word下载绑定所选版本并防重复，历史版本异步变化会中止，按钮原文恢复',async()=>{
 for(const changed of [false,true]){
  const f=fixture(),version={id:'v9',version:9,chapters:[{name:'旧章节'}]},button={disabled:false,textContent:'下载本版 Word（V9）'};
  f.sandbox.projectWorkflow.reportVersions=[version];let seen;
  f.sandbox.buildExportPayload=options=>{seen=options.version;return f.input;};
  f.sandbox.window.docx.Packer.toBlob=async()=>{if(changed)version.chapters[0].name='异步改变';return new Blob(['doc']);};
  await f.sandbox.exportWord({versionId:'v9',button});
  assert.equal(seen.id,'v9');assert.equal(seen.chapters[0].name,'旧章节');assert.equal(f.clicks.length,changed?0:1);
  if(changed)assert.match(f.errors[0],/历史版本.*变化/);else assert.match(f.clicks[0],/V9/);
  assert.equal(button.disabled,false);assert.equal(button.textContent,'下载本版 Word（V9）');
  button.disabled=true;await f.sandbox.exportWord({versionId:'v9',button});assert.equal(f.clicks.length,changed?0:1);
 }
});

test('缺少有效核验结果或页数服务失败时不触发下载',async()=>{
 for(const response of [{ok:false,json:async()=>({ok:false,pages:121,error:'超过120页'})},{ok:true,json:async()=>({ok:true,pages:NaN})}]){
  const f=fixture();f.sandbox.fetch=async()=>response;await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.ok(f.errors.length);
 }
});

test('180页真实核验允许确认下载，取消不下载',async()=>{
 for(const accepted of [true,false]){
  const f=fixture();let prompts=0;
  f.sandbox.fetch=async()=>preparedResponse(180);
  f.sandbox.confirm=message=>{prompts++;assert.match(message,/180页/);return accepted;};
  await f.sandbox.exportWord();assert.equal(prompts,1);assert.equal(f.clicks.length,accepted?1:0);
 }
});
test('旧服务仅页数回执或更新后文件哈希不符，一律不下载原始空目录',async()=>{
 for(const fetch of [async()=>Response.json(paginationResult()),async()=>preparedResponse(3,{tampered:true})]){
  const f=fixture();f.sandbox.fetch=fetch;await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.equal(f.downloaded.length,0);assert.match(f.errors[0],/未返回已更新目录|下载回执不一致/);
 }
});
test('成稿预算及证据未通过须明确确认，损坏表格或缺少检查不能下载',async()=>{
 for(const status of ['blocked','unverified'])for(const accept of [true,false]){
  const f=fixture();f.input.completionReview={status,planId:'plan-test',issues:[{code:'document-budget',message:'全篇超过预算'}],reviews:[]};
  let calls=0;f.sandbox.confirm=message=>{calls++;assert.match(message,/完整待审工作稿/);return accept;};
  await f.sandbox.exportWord();assert.equal(calls,1);assert.equal(f.clicks.length,accept?1:0);if(accept)assert.equal(f.payload().signed,false);
 }
 for(const review of [null,{status:'blocked',planId:'plan-test',reviews:[{key:'现金流',issues:[{code:'table-placeholder',message:'未还原'}]}]}]){
  const f=fixture();f.input.completionReview=review;f.sandbox.confirm=()=>{throw Error('不应允许绕过');};await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.equal(f.errors.length,1);
 }
});
test('all chart SVG sources are captured before asynchronous raster conversion',async()=>{
 const imageFn=source.slice(source.indexOf('async function collectReportImages(){'),source.indexOf('async function exportWord(){'));
 let calls=[];const context={calcResult:{},calcParams:{rent:30},project:{competitors:[{name:'旧竞品',rent:20,occ:90},{name:'旧竞品二',rent:25,occ:80}]},cashflowChartHtml:()=>'<svg>cash</svg>',cpBarSvg:rows=>JSON.stringify(rows),svgToPng:async svg=>{calls.push(svg);context.project.competitors=[{name:'新研究竞品',rent:999}];return 'png';},console};
 vm.createContext(context);vm.runInContext(imageFn,context);const images=await context.collectReportImages();assert.equal(images.length,3);assert.ok(calls[1].includes('旧竞品'));assert.ok(!calls.join('').includes('新研究竞品'));
});
