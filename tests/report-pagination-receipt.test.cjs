const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const D=require('../docx.umd.js'),build=require('../docxgen.js'),policy=require('../report-output-policy.js');
const JSZip=require('../local-server/node_modules/jszip');
const api=()=>import('../local-server/report-pagination.js');
async function fixture(){
 return D.Packer.toBuffer(build(D,{project:{name:'[系统测试]分页回执'},documentDate:'2026-09-22',chapters:[{cn:'一',name:'项目概况',sections:[{title:'正文与普通表',blocks:[{type:'p',text:'事实说明及【待补：协议确认】。'},{type:'table',rows:[['事项','内容'],['经营期','六年，待确认']]}]},{title:'后续小节',blocks:[{type:'p',text:'不修改正文、字号或排版。'}]}]},{cn:'二',name:'财务指标',sections:[{title:'年度数据',blocks:[{type:'table',rows:[['年度','金额'],...Array.from({length:70},(_,i)=>[String(2026+i),String(i+1)])]}]}]}]}));
}
test('DOCX内部版本与零宽章节结束书签不接受payload覆盖',async()=>{
 const {inspectReportPackage}=await api(),buffer=await fixture(),meta=await inspectReportPackage(buffer),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
 assert.equal(meta.templateVersion,build.templateVersion);assert.equal(meta.rulesVersion,policy.contentVersion);
 assert.deepEqual(meta.sectionBookmarks,['_tc0_0','_tc0_1','_tc1_0']);
 assert.equal((xml.match(/w:name="_rp_end_/g)||[]).length,3);
 assert.ok(/<\/w:tbl><w:bookmarkStart[^>]+w:name="_rp_end_0_0"[^>]*\/><w:bookmarkEnd/.test(xml));
 assert.equal(xml.includes('<undefined>'),false);
 const ids=[...xml.matchAll(/<w:bookmarkStart\b[^>]+\bw:id="(\d+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 assert.match(xml,/经营期/);assert.match(xml,/六年，待确认/);assert.match(xml,/w:sz w:val="24"/);
});
test('原生目录使用唯一标题样式和明确大纲级别，不再依赖手画文字目录',async()=>{
 const zip=await JSZip.loadAsync(await fixture()),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string');
 assert.match(xml,/<w:sdt>[\s\S]*?TOC \\h \\o &quot;1-2&quot;/);
 for(const [name,level]of [['Heading1',0],['Heading2',1]]){
  const defs=[...styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)].map(m=>m[0]).filter(s=>s.includes('w:styleId="'+name+'"'));
  assert.equal(defs.length,1);assert.match(defs[0],new RegExp('<w:outlineLvl w:val="'+level+'"'));
 }
});
test('目录验收覆盖Word链接与WPS嵌套域，拒绝空页码、失效目标和漏项',async()=>{
 const {inspectPreparedToc}=await api();
 const prefix='<w:document><w:sdt><w:sdtContent><w:p><w:r><w:instrText>TOC \\h </w:instrText></w:r></w:p>';
 const suffix='</w:sdtContent></w:sdt><w:bookmarkStart w:id="0" w:name="_tc0"/><w:bookmarkStart w:id="1" w:name="_Toc1"/></w:document>';
 const native='<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>第一章</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>3</w:t></w:r></w:hyperlink></w:p>';
 const wps='<w:p><w:r><w:instrText> HYPERLINK \\l _Toc1 </w:instrText></w:r><w:r><w:t>第一章</w:t></w:r><w:r><w:instrText> PAGEREF _Toc1 \\h </w:instrText></w:r><w:r><w:t>3</w:t></w:r></w:p>';
 const pack=async xml=>{const zip=new JSZip();zip.file('word/document.xml',xml);return zip.generateAsync({type:'nodebuffer'});};
 for(const entry of [native,wps]){
  assert.equal((await inspectPreparedToc(await pack(prefix+entry+suffix))).entries,1);
  await assert.rejects(inspectPreparedToc(await pack(prefix+entry.replace('<w:t>3</w:t>','<w:t></w:t>')+suffix)),/空页码/);
  await assert.rejects(inspectPreparedToc(await pack(prefix+entry+suffix.replace('w:name="_Toc1"','w:name="missing"'))),/失效链接/);
  await assert.rejects(inspectPreparedToc(await pack(prefix+entry+suffix.replace('</w:document>','<w:bookmarkStart w:id="2" w:name="_tc1"/></w:document>'))),/数量不一致/);
 }
 await assert.rejects(inspectPreparedToc(await fixture()),/没有可跳转/);
});
test('服务端回执绑定二进制、规则与模板，页数与内容质量分开',async()=>{
 const {inspectReportPackage,buildPaginationResult}=await api(),buffer=await fixture(),metadata=await inspectReportPackage(buffer);
 const layout={pages:7,renderer:'WPS',rendererVersion:'12.test',diagnostics:{status:'available',sections:metadata.sectionBookmarks.map((bookmark,i)=>({bookmark,title:'章节 '+i,startPage:3+i,endPage:3+i})),tables:[{index:1,sectionBookmark:'_tc0_0',startPage:3,endPage:3},{index:2,sectionBookmark:'_tc1_0',startPage:5,endPage:7}]}};
 const result=buildPaginationResult(buffer,layout,metadata);
 assert.equal(result.ok,true);assert.equal(result.receipt.scope,'pagination-only');assert.equal(result.receipt.contentQualityCertified,false);
 assert.equal(result.maxPages,130);assert.equal(result.receipt.maxPages,130);assert.equal(result.receipt.schemaVersion,'report-pagination-receipt-v2');
 assert.equal(result.receipt.documentSha256,createHash('sha256').update(buffer).digest('hex'));assert.equal(result.receipt.versionsMatch,true);
 assert.equal(result.receipt.rendererVersion,'12.test');assert.equal(result.diagnostics.status,'available');assert.equal(result.diagnostics.tables[1].pageSpan,3);
 const changed=buildPaginationResult(Buffer.concat([buffer,Buffer.from('changed')]),layout,metadata);assert.notEqual(changed.receipt.documentSha256,result.receipt.documentSha256);
});
test('下载保护线130页与110–130目标分开：不因低于目标改内容，121–130不误拒绝',async()=>{
 const {pageDecision,buildPaginationResult}=await api();
 for(const pages of [1,109,110,120,121,125,130]){
  const decision=pageDecision(pages);assert.equal(decision.ok,true);assert.equal(decision.pages,pages);assert.equal(decision.maxPages,130);assert.equal(decision.error,undefined);
  const result=buildPaginationResult(Buffer.from('same-content'),{pages,renderer:'WPS',rendererVersion:'12.test'},{});
  assert.equal(result.receipt.validationStatus,'within-page-limit');assert.equal(result.receipt.contentQualityCertified,false);
 }
 for(const pages of [131,180]){const result=pageDecision(pages);assert.equal(result.ok,false);assert.match(result.error,/130页下载保护线/);assert.match(result.error,/未截断/);}
 for(const pages of [0,-1,1.5,NaN,Infinity,'120'])assert.throws(()=>pageDecision(pages),/实际页数/);
});
test('伪造通过字段不能覆盖服务器实际超页决定或缺失版本',async()=>{
 const {buildPaginationResult}=await api();
 const result=buildPaginationResult(Buffer.from('test'),{pages:131,renderer:'WPS',ok:true},{rulesVersion:'old',templateVersion:'old',passed:true});
 assert.equal(result.ok,false);assert.equal(result.receipt.validationStatus,'over-page-limit');assert.equal(result.receipt.versionsMatch,false);assert.equal(result.receipt.contentQualityCertified,false);
 assert.equal(result.diagnostics.status,'unavailable');assert.throws(()=>buildPaginationResult(Buffer.from('test'),{pages:0,renderer:'WPS'},{}),/实际页数/);
});
test('区间非法、未知书签、缺失小节不冒充完整诊断',async()=>{
 const {buildPaginationResult}=await api();
 const result=buildPaginationResult(Buffer.from('test'),{pages:4,renderer:'WPS',diagnostics:{status:'available',sections:[{bookmark:'_tc0_0',startPage:3,endPage:3},{bookmark:'_tc0_1',startPage:4,endPage:99},{bookmark:'_tc99_0',startPage:2,endPage:2}],tables:[{index:1,startPage:0,endPage:2},{index:2,sectionBookmark:'_tc99_0',startPage:2,endPage:2}]}},{sectionBookmarks:['_tc0_0','_tc0_1']});
 assert.equal(result.diagnostics.status,'partial');assert.equal(result.diagnostics.sections.length,1);assert.equal(result.diagnostics.tables.length,1);assert.equal(result.diagnostics.tables[0].sectionBookmark,null);assert.match(result.diagnostics.reason,/部分章节/);
});
test('Linux仅真实总页数时明确明细不可用，不返回估算范围',async()=>{
 const {buildPaginationResult}=await api();
 const result=buildPaginationResult(Buffer.from('test'),{pages:6,renderer:'LibreOffice',diagnostics:{status:'unavailable',reason:'adapter unavailable'}},{});
 assert.equal(result.ok,true);assert.equal(result.diagnostics.status,'unavailable');assert.deepEqual(result.diagnostics.sections,[]);assert.deepEqual(result.diagnostics.tables,[]);
});
test('包结构安全与鉴权原有边界仍生效',async()=>{
 const {inspectReportPackage,reportPaginationResponse}=await api(),buffer=await fixture();
 const zip=await JSZip.loadAsync(buffer);zip.file('word/_rels/custom.xml.rels','<Relationships><Relationship TargetMode="External" Target="https://example.test/"/></Relationships>');
 await assert.rejects(inspectReportPackage(await zip.generateAsync({type:'nodebuffer'})),/外部链接/);
 const unauth=await reportPaginationResponse(new Request('http://localhost/test',{method:'POST',body:buffer}),async()=>false);assert.equal(unauth.status,401);
 const malformed=await reportPaginationResponse(new Request('http://localhost/test',{method:'POST',body:'not-a-docx'}),async()=>true);assert.equal(malformed.status,503);assert.equal((await malformed.json()).receipt,undefined);
});
if(process.env.REPORT_PAGINATION_REAL_TEST==='1')test('真实WPS排版返回章节和跨页表格区间以及精确文件回执',{timeout:90000},async()=>{
 const {paginateReport,inspectPreparedToc}=await api(),buffer=await fixture(),result=await paginateReport(buffer,{prepareDownload:true});
 assert.equal(result.renderer,'WPS');assert.ok(result.pages>=4);assert.equal(result.receipt.versionsMatch,true);
 assert.equal(result.diagnostics.status,'available',JSON.stringify(result.diagnostics));assert.equal(result.diagnostics.sections.length,3);assert.equal(result.diagnostics.tables.length,2);
 assert.ok(result.diagnostics.tables[1].pageSpan>1);assert.equal(result.diagnostics.tables[1].sectionBookmark,'_tc1_0');
 assert.equal(result.receipt.documentSha256,createHash('sha256').update(buffer).digest('hex'));
 assert.equal(result.receipt.preparedDocumentSha256,createHash('sha256').update(result.document).digest('hex'));assert.equal(result.receipt.tocUpdated,true);
 assert.equal((await inspectPreparedToc(result.document)).entries,5);
 console.log(JSON.stringify({pages:result.pages,rendererVersion:result.receipt.rendererVersion,diagnostics:result.diagnostics}));
});
