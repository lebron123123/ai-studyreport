// Native browser DOMParser + actual export payload/provenance modules.
// In-memory fixture only: no file export, real report, network API, or approval.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=new Map(['report-trust.js','export.js'].map(name=>[name,fs.readFileSync(path.join(__dirname,'..',name),'utf8')]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>系统测试：Word载荷</title><body><main id="sheet">
<section class="section-block" data-cn="1" data-si="0"><h4>标题外按钮<button>不得导出按钮甲</button></h4><aside class="rpt-logic-note">不得导出逻辑卡甲</aside><div class="air-section-material">不得导出材料卡甲</div><div class="body"><p>网页当前中文正文，保留正式段落。</p><table><tr><th>指标</th><th>金额（万元）</th></tr><tr><td>测试投资</td><td>123.45</td></tr></table><p>表后中文说明，须独立核验。</p></div><button>不得导出按钮乙</button></section>
<section class="section-block" data-cn="1" data-si="1"><aside>不得导出逻辑卡乙</aside><div class="body"><p>本节尚未绑定来源，不能据此确认通过。</p></div></section>
<section class="section-block" data-cn="1" data-si="3"><div class="body">尚未生成的界面占位不能进入Word</div></section>
<section class="section-block" data-cn="2" data-si="0"><div class="body">未勾选章节不能导出</div></section>
</main><script>
var project={name:'[系统测试]导出隔离项目'},signed=false,calcResult=null,reportDocumentRevision=7;
var projectWorkflow={currentReportVersionId:'fixture-v3',reportVersions:[{id:'fixture-v3',version:3},{id:'other-v9',version:9}]};
var chapters=[{cn:1,name:'中文测试章',checked:true,sections:[
 {t:'有来源待核对',content:'状态中的旧正文不应覆盖网页当前正文',prov:{model:'fixture-model',confidence:{score:99.8,label:'很高'},hasCalcData:true,calcSnapshotId:'fixture-calc-v2',calcVersion:2,calcEngineVersion:'fixture-engine-v1',kbDocs:[{title:'资料库依据',sourceRef:'fixture-material#page-3',version:'资料V2',page:3}],webEvidence:[{title:'来源政策',url:'https://source.example.test/政策?ver=2',version:'来源V2',lifecycle:'expired',lifecycleNote:'需核对替代版本'}],excelSources:[{title:'白箱表',sourceRef:'fixture.xlsx#投资估算!C9',version:'表V4'}]}},
 {t:'新增无来源小节',content:'本节尚未绑定来源，不能据此确认通过。',prov:{confidence:{score:100,label:'最高'}}},
 {t:'未渲染的已编辑小节',content:'旧状态正文',editedHtml:'<p>已编辑中文工作稿。</p><table><tr><th>范围</th><th>状态</th></tr><tr><td>点位甲</td><td>待核</td></tr></table>',syncStatus:'stale'},
 {t:'未生成小节',content:''}
 ]},{cn:2,name:'未选择章节',checked:false,sections:[{t:'不得导出',content:'未勾选章节不能导出'}]}];
function renderContent(text){return '<p>'+String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</p>';}
function getDocNo(){return 'FIXTURE-WORD-ONLY';}
</script><script src="/report-trust.js"></script><script src="/export.js"></script></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[];let apiRequests=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:html});
  if(source.has(url.pathname.slice(1)))return route.fulfill({contentType:'text/javascript',body:source.get(url.pathname.slice(1))});
  apiRequests++;return route.abort('blockedbyclient');
 });
 try{
  await page.goto('http://word-payload.test/fixture.html');
  const result=await page.evaluate(()=>{
   const before=JSON.stringify({chapters,projectWorkflow,signed,project}),dom=document.getElementById('sheet').innerHTML;
   const payload=buildExportPayload(),again=buildExportPayload();
   return {payload,again,unchanged:before===JSON.stringify({chapters,projectWorkflow,signed,project}),domUnchanged:dom===document.getElementById('sheet').innerHTML,parserIsNative:/native code/.test(String(DOMParser))};
  });
  const p=result.payload,body=JSON.stringify(p.chapters),prov=JSON.stringify(p.provenance);
  assert.equal(result.parserIsNative,true);assert.equal(result.unchanged,true);assert.equal(result.domUnchanged,true);assert.deepEqual(result.again,p);
  assert.equal(p.chapters.length,1);assert.equal(p.chapters[0].sections.length,3);assert.equal(p.chapters[0].sections[0].blocks[0].text,'网页当前中文正文，保留正式段落。');
  assert.deepEqual(p.chapters[0].sections[0].blocks[1],{type:'table',rows:[['指标','金额（万元）'],['测试投资','123.45']]});
  assert.equal(p.chapters[0].sections[0].blocks[2].text,'表后中文说明，须独立核验。');assert.match(body,/已编辑中文工作稿/);assert.match(body,/点位甲/);
  assert.doesNotMatch(body,/不得导出|旧状态正文|状态中的旧正文|界面占位|未勾选章节/);
  assert.equal(p.provenance.rows.length,4);assert.equal(p.provenance.rows[0][2],'核验状态');assert.equal(p.provenance.rows[1][2],'有来源·待核对');assert.equal(p.provenance.rows[2][2],'待核验');assert.equal(p.provenance.rows[3][2],'待同步');
  for(const value of ['https://source.example.test/政策?ver=2','来源V2','资料V2','fixture-material#page-3','fixture.xlsx#投资估算!C9','表V4','fixture-calc-v2','引擎 fixture-engine-v1','效力待核：需核对替代版本','新增无来源小节','尚未绑定可追溯来源'])assert.ok(prov.includes(value),value);
  assert.doesNotMatch(prov,/99\.8|100分|0分|最高|很高|置信度|"score"|"confidence"/);assert.match(p.provenance.note,/不按素材种类计算准确率/);
  assert.equal(p.versionNote,'关联报告版本 V3 · 工作稿修订 7 · 未签发工作稿');assert.equal(p.signed,false);assert.equal(p.docNo,'FIXTURE-WORD-ONLY');assert.equal(p.appendix,null);assert.deepEqual(p.tableAppendix,[]);
  // Legacy workflow without version metadata remains an explicitly current working draft.
  const legacy=await page.evaluate(()=>{projectWorkflow={reportVersions:[]};return buildExportPayload();});assert.equal(legacy.versionNote,'工作稿修订 7 · 未签发工作稿');assert.equal(legacy.provenance.rows.length,4);
  assert.deepEqual(errors,[]);assert.equal(apiRequests,0);
  console.log(JSON.stringify({ok:true,sections:3,provenanceRows:3,apiRequests,consoleErrors:errors,states:['native-DOMParser','body-only','Chinese-paragraphs-tables','edited-state-fallback','sources-URL-version-validity','missing-source-in-appendix','no-legacy-confidence','working-version-note','read-only-repeat','legacy-version'],boundary:'Payload only; no DOCX rendering, Word layout acceptance, external model or real report.'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
