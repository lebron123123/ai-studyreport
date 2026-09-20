const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../export.js'),'utf8');
const fn=source.slice(source.indexOf('async function exportWord(){'),source.indexOf('/* ================= 测算说明书 Word 导出'));
function fixture({changeDuringPack=false}={}){
 let current='run_old',payloadSeen,clicks=[],errors=[];
 const project={name:'旧研究'},input={project,chapters:[{name:'第一章'}],versionNote:'工作稿',signed:false};
 const window={ResearchUI:{active:()=>true,capture:()=>({researchId:'research_a',runId:current}),guard:async token=>{if(token.runId!==current)throw Error('研究轮次已变化');}},docx:{Packer:{toBlob:async()=>{project.name='后来修改';if(changeDuringPack)current='run_new';return new Blob(['doc']);}}},buildDocxDocument:(_,payload)=>{payloadSeen=payload;return payload;}};
 const sandbox={window,project,currentProjectId:null,projectWorkflow:{reportVersions:[]},ensureDocxLib:async()=>{},ensureReportTableTemplates:async()=>{},fetch:async()=>({ok:true,json:async()=>({ok:true,pages:3})}),authHeaders:()=>({}),AbortSignal,buildExportPayload:()=>input,collectReportImages:async()=>[],Blob,URL:{createObjectURL:()=>'/download',revokeObjectURL(){}},document:{getElementById:()=>null,createElement:()=>({click(){clicks.push(this.download);}}),body:{appendChild(){},removeChild(){}}},alert:x=>errors.push(x)};
 vm.createContext(sandbox);vm.runInContext(fn,sandbox);return {sandbox,clicks,errors,payload:()=>payloadSeen};
}
test('Word export deep freezes payload and filename; a historical round remains unsigned',async()=>{
 const f=fixture();await f.sandbox.exportWord();assert.equal(f.errors.length,0);assert.equal(f.clicks.length,1);assert.match(f.clicks[0],/^旧研究_未签发工作稿/);assert.equal(f.payload().project.name,'旧研究');assert.equal(f.payload().signed,false);
});
test('late Word packing cannot download after research restart or switch',async()=>{
 const f=fixture({changeDuringPack:true});await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.match(f.errors[0],/轮次已变化/);
});

test('缺少有效核验结果或页数服务失败时不触发下载',async()=>{
 for(const response of [{ok:false,json:async()=>({ok:false,pages:121,error:'超过120页'})},{ok:true,json:async()=>({ok:true,pages:NaN})}]){
  const f=fixture();f.sandbox.fetch=async()=>response;await f.sandbox.exportWord();assert.equal(f.clicks.length,0);assert.ok(f.errors.length);
 }
});

test('180页真实核验允许确认下载，取消不下载',async()=>{
 for(const accepted of [true,false]){
  const f=fixture();let prompts=0;
  f.sandbox.fetch=async()=>({ok:false,status:422,json:async()=>({ok:false,pages:180,maxPages:120})});
  f.sandbox.confirm=message=>{prompts++;assert.match(message,/180页/);return accepted;};
  await f.sandbox.exportWord();assert.equal(prompts,1);assert.equal(f.clicks.length,accepted?1:0);
 }
});
test('all chart SVG sources are captured before asynchronous raster conversion',async()=>{
 const imageFn=source.slice(source.indexOf('async function collectReportImages(){'),source.indexOf('async function exportWord(){'));
 let calls=[];const context={calcResult:{},calcParams:{rent:30},project:{competitors:[{name:'旧竞品',rent:20,occ:90},{name:'旧竞品二',rent:25,occ:80}]},cashflowChartHtml:()=>'<svg>cash</svg>',cpBarSvg:rows=>JSON.stringify(rows),svgToPng:async svg=>{calls.push(svg);context.project.competitors=[{name:'新研究竞品',rent:999}];return 'png';},console};
 vm.createContext(context);vm.runInContext(imageFn,context);const images=await context.collectReportImages();assert.equal(images.length,3);assert.ok(calls[1].includes('旧竞品'));assert.ok(!calls.join('').includes('新研究竞品'));
});
