const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const C=require('../report-completion-contract.js');

const planFor=()=>C.createPlan([{name:'项目说明',sections:[{t:'规模台账'},{t:'结论摘要'}]}]);
const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
const tableHash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
function reference(key,number='1.1',hash=tableHash){return '<p class="rpt-table-reference" data-report-ref-section="'+key+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第'+number+'节规模台账。</p>';}
function entriesFor(plan,text=reference(plan.sections[0].sectionKey)){return [{key:plan.sections[0].sectionKey,number:'1.1',text:table},{key:plan.sections[1].sectionKey,number:'1.2',text}];}
const errors=q=>q.reviews.flatMap(r=>r.issues).filter(i=>i.severity==='error').map(i=>i.code);

test('悬空或空表引用独立阻断，没有职责必要表也不能漏检；历史有效引用兼容',()=>{
 const plan=planFor();
 for(const [text,code] of [['<p class="rpt-table-reference">详见第99.9节原表。</p>','reference-target-missing'],['<p class="rpt-table-reference">详见第1.2节原表。</p>','reference-self'],['<p class="rpt-table-reference">详见原表。</p>','reference-metadata']]){
  const q=C.reviewDocument(entriesFor(plan,text),plan);assert.equal(q.status,'blocked');assert.ok(errors(q).includes(code));assert.ok(!errors(q).includes('missing-table'));
 }
 const legacy=entriesFor(plan,'<p>说明：<span class="rpt-table-reference">详见第1.1节规模台账。</span></p>');
 assert.equal(C.reviewDocument(legacy,plan).status,'passed');
 legacy[0].text='该节仅有说明，无实际表格。';
 assert.ok(errors(C.reviewDocument(legacy,plan)).includes('reference-table-missing'));
 legacy[0].text='|项目|面积|\n|---|---|\n|甲|5973|';assert.equal(C.reviewDocument(legacy,plan).status,'passed');
});

test('现代引用绑定稳定小节、实际表数据和合并关系，不能用同名表或改标签冒充',()=>{
 const plan=planFor(),entries=entriesFor(plan);assert.equal(C.reviewDocument(entries,plan).status,'passed');
 const cases=[
  [e=>{e[1].text=reference(plan.sections[0].sectionKey,'1.8');},'reference-number-mismatch'],
  [e=>{e[1].text=reference('别的项目 / 规模台账');},'reference-target-missing'],
  [e=>{e[0].text=e[0].text.replace('5973','7973');},'reference-table-mismatch'],
  [e=>{e[0].text=e[0].text.replace('<td>5973','<td colspan="2">5973');},'reference-table-mismatch'],
  [e=>{e[1].text=e[1].text.replace('cells-v1','other');},'reference-table-identity'],
  [e=>{e[1].text=e[1].text.replace('scope="document"','scope="other-report"');},'reference-scope'],
  [e=>{e[1].text=e[1].text.replace('class="','data-report-ref-section="伪造" class="');},'reference-metadata']
 ];
 for(const [change,code] of cases){const e=structuredClone(entries);change(e);const q=C.reviewDocument(e,plan);assert.equal(q.status,'blocked',code);assert.ok(errors(q).includes(code),JSON.stringify(errors(q)));}
 const multiple=structuredClone(entries);multiple[0].text+=table;multiple[1].text=reference(plan.sections[0].sectionKey,'1.1',tableHash+' '+tableHash);assert.ok(!errors(C.reviewDocument(multiple,plan)).some(c=>c.startsWith('reference-')));
 multiple[0].text=table;assert.ok(errors(C.reviewDocument(multiple,plan)).includes('reference-table-mismatch'),'two referenced segments require two actual tables');
});

test('事实引用只指向实际承担必要事实的小节；待确认不提升为已核实，引用不能替代 owner 内容',()=>{
 const key='项目说明 / 规模台账',plan=C.createPlan([{name:'项目说明',sections:[{t:'规模台账'},{t:'结论摘要'}]}],{facts:[{key:'area',label:'协议面积',value:'5973平方米',status:'pending',source:'协议草案',owner:key,required:true}]});
 const ref='<p class="rpt-fact-reference" data-report-ref-section="'+key+'" data-report-ref-fact="area" data-report-ref-fact-status="pending">规模口径待确认，详见第1.1节。</p>';
 const entries=entriesFor(plan,ref);entries[0].text='协议面积5973平方米，待确认。';
 let q=C.reviewDocument(entries,plan);assert.equal(q.status,'unverified');assert.equal(q.factsVerified,false);assert.ok(!errors(q).some(c=>c.startsWith('reference-')));
 const missing=structuredClone(entries);missing[0].text='协议面积尚未核实。';assert.ok(errors(C.reviewDocument(missing,plan)).includes('reference-fact-missing'));
 const labelOnly=structuredClone(entries);labelOnly[0].text='<p class="rpt-fact-reference" data-report-ref-section="'+plan.sections[1].sectionKey+'" data-report-ref-fact="area">5973平方米，详见第1.2节。</p>';assert.ok(errors(C.reviewDocument(labelOnly,plan)).includes('reference-fact-missing'));
 const status=structuredClone(entries);status[1].text=ref.replace('status="pending"','status="confirmed"');assert.ok(errors(C.reviewDocument(status,plan)).includes('reference-fact-status'));
 const keyMismatch=structuredClone(entries);keyMismatch[1].text=ref.replace('fact="area"','fact="other"');assert.ok(errors(C.reviewDocument(keyMismatch,plan)).includes('reference-fact-owner'));
});

test('实际浏览器归属、重复排版及 Word 导出适配器共享引用；目标变更不能被重新签名掩盖',async()=>{
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();for(const file of ['report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js','export.js'])await page.addScriptTag({path:path.resolve(file)});
  const result=await page.evaluate(({table})=>{
   const plan=ReportCompletionContract.createPlan([{name:'项目说明',sections:[{t:'规模台账'},{t:'结论摘要'}]}]);
   const entries=plan.sections.map((s,i)=>({key:s.sectionKey,html:table,context:{type:'test',chapter:'项目说明',section:i?'结论摘要':'规模台账',number:'1.'+(i+1)}}));
   const lib={forSection:()=>[],renderTemplate:ReportTableTemplates.renderTemplate};
   const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib);
   const review=html=>ReportCompletionContract.reviewDocument(entries.map((e,i)=>({key:e.key,number:e.context.number,text:html[i]})),plan);
   const changed=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:i?once[i]:once[i].replace('5973','7973')})),lib);
   const dom=new DOMParser().parseFromString(once.join(''),'text/html'),ref=dom.querySelector('.rpt-table-reference');
   const sameSection=ReportSectionLayout.composeDocument([{...entries[0],html:table+table}],lib);
   const sensitivity='<table><tr><th>敏感因素</th><th>波动幅度</th><th>IRR</th></tr><tr><td>租金</td><td>-10%</td><td>8%</td></tr></table>';
   const merged=ReportSectionLayout.composeDocument([{...entries[0],html:sensitivity+sensitivity}],lib);
   const cell=(text,col,role='static')=>({text,col,role}),template={id:'reference-test',title:'规模台账',segments:[{rows:[{cells:[cell('项目',0),cell('面积',1)]},{cells:[cell('甲',0),cell('',1,'value')]}]}]};
   const canonicalLib={forSection:()=>[template],renderTemplate:ReportTableTemplates.renderTemplate};
   const canonical=ReportSectionLayout.composeDocument(entries,canonicalLib),canonicalAgain=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:canonical[i]})),canonicalLib);
   return {once,twice,q:review(once),changed:review(changed),tableCount:dom.querySelectorAll('table').length,attrs:{...ref.dataset},blocks:once.map(htmlToBlocks),sameSection: sameSection.join(''),merged:merged.join(''),canonical,canonicalAgain,canonicalReview:review(canonical)};
  },{table});
  assert.equal(result.tableCount,1);assert.deepEqual(result.once,result.twice);assert.equal(result.q.status,'passed');assert.equal(result.attrs.reportRefSection,'项目说明 / 规模台账');assert.equal(result.attrs.reportRefTableHash,tableHash);
  assert.ok(errors(result.changed).includes('reference-table-mismatch'));
  assert.doesNotMatch(result.sameSection,/rpt-table-reference/);assert.equal((result.sameSection.match(/<table\b/g)||[]).length,2,'same-section duplicates remain visible for review');
  assert.doesNotMatch(result.merged,/rpt-table-reference/);assert.equal((result.merged.match(/<table\b/g)||[]).length,1,'already merged register must not manufacture self-reference');
  assert.equal(result.blocks.flat().filter(b=>b.type==='table').length,1);assert.match(JSON.stringify(result.blocks[1]),/详见第1.1节/);assert.match(JSON.stringify(result.blocks[0]),/5973/);
  assert.deepEqual(result.canonical,result.canonicalAgain);assert.equal(result.canonicalReview.status,'passed',JSON.stringify(result.canonicalReview));assert.match(result.canonical[1],/data-report-ref-template="reference-test"/);
  // Exercise the production Word builder in memory. This validates document
  // structure, not a page-count or a claim of visual rendering acceptance.
  const docx=require('../docx.umd.js'),build=require('../docxgen.js');
  const buffer=await docx.Packer.toBuffer(build(docx,{project:{name:'[系统测试]稳定交叉引用'},chapters:[{cn:'一',num:1,name:'项目说明',sections:result.blocks.map((blocks,i)=>({num:i+1,title:i?'结论摘要':'规模台账',blocks}))}]}));
  const zip=await require('../local-server/node_modules/jszip').loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);assert.match(xml,/5973/);assert.match(xml,/详见第1.1节/);assert.doesNotMatch(xml,/data-report-ref-/);
 }finally{await browser.close();}
});
