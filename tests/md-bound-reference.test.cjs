const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const C=require('../report-completion-contract.js');
const source=fs.readFileSync(path.resolve(__dirname,'../md.js'),'utf8');
const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
const hash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
function markdown(withValidator=true){const ctx={};ctx.window=ctx;if(withValidator)ctx.ReportCompletionContract=C;vm.runInNewContext(source,ctx);return ctx.MD;}
async function fixture(){
  const plan=C.createPlan([{name:'总论',sections:[{t:'规模台账'},{t:'结论摘要'}]}]),[target,section]=plan.sections;
  section.requiredTables=[{title:'规模表',headers:['项目','面积'],terms:[]}];
  const legacy='<span class="rpt-table-reference" data-report-ref-section="'+target.sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节规模台账。</span>';
  const entries=[{key:target.sectionKey,number:'1.1',text:table},{key:section.sectionKey,number:'1.2',text:'<p>摘要。</p>'+legacy}];
  const contract=await C.bindDocumentReferences(section,entries);plan.sections[1]=contract;
  const reference=contract.documentReferences.references[0].html;
  return {plan,entries,contract,reference};
}
function hostile(reference){return [
  reference.replace('<p ','<p onclick="window.__referenceAttack++" '),
  reference.replace('<p ','<p style="background-image:url(https://invalid.example/reference-attack)" '),
  reference.replace('<p ','<p href="javascript:window.__referenceAttack++" '),
  reference.replace('<p ','<p data-unknown="untrusted" '),
  reference.replace('class="rpt-table-reference"','class="rpt-table-reference" class="rpt-table-reference"'),
  reference.replace('data-report-ref-scope="document"','data-report-ref-scope="window"'),
  reference.replace('data-report-ref-table-kind="cells-v1"','data-report-ref-table-kind="untrusted"'),
  reference.replace('data-report-ref-table-hash="'+hash+'"','data-report-ref-table-hash="not-a-hash"'),
  reference.replace('data-report-ref-table-hash="'+hash+'"','data-report-ref-table-hash=""'),
  reference.replace('详见第1.1节','没有节号'),
  reference.replace('</p>','<img src="https://invalid.example/reference-attack" onerror="window.__referenceAttack++"></p>'),
  reference.replace('</p>','<script>window.__referenceAttack++</script></p>'),
  reference.replace('</p>','<svg onload="window.__referenceAttack++"></svg></p>'),
  reference.replace('>详见','><span>详见').replace('</p>','</span></p>'),
  reference+'<iframe src="https://invalid.example/reference-attack"></iframe>',
  reference.replace('<p ','<p autofocus ')
];}

test('独立绑定引用按安全结构往返，真实清单与当前目标仍通过成稿核验',async()=>{
  const f=await fixture(),MD=markdown(),decoded=C.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'规模以已列台账为准。'}]}),f.contract),blocks=MD.parseBlocks(decoded.text),block=blocks.find(b=>b.referenceHtml);
  assert.equal(C.safeDocumentReferenceHtml(f.reference),f.reference);assert.equal(block.referenceHtml,f.reference);assert.equal(block.type,'para');assert.equal(block.text,'详见第1.1节规模台账。');
  assert.equal(MD.blocksToHtml([block]),f.reference);assert.equal(MD.renderHtml(f.reference),f.reference);assert.equal(MD.renderHtml(MD.renderHtml(f.reference)),f.reference);
  const actual=structuredClone(f.entries);actual[1].text=MD.blocksToHtml(blocks);
  assert.equal(C.inspect(actual[1].text,f.contract).status,'passed');assert.equal(C.reviewDocument(actual,f.plan).status,'passed');
});

test('额外属性、重复属性、无效身份、嵌套可执行结构全部转义，手造 referenceHtml 不能绕过二次校验',async()=>{
  const {reference}=await fixture(),MD=markdown();
  for(const html of hostile(reference)){
    assert.throws(()=>C.safeDocumentReferenceHtml(html));
    const parsed=MD.parseBlocks(html),rendered=MD.renderHtml(html),forged=MD.blocksToHtml([{type:'para',text:'伪造可信标记',referenceHtml:html}]);
    assert.equal(parsed.some(block=>block.referenceHtml),false,html);
    for(const value of [rendered,forged]){assert.doesNotMatch(value,/<(?:p\b[^>]*class="rpt-table-reference"|img\b|svg\b|script\b|iframe\b)/i);assert.ok(value.includes('&lt;p'),html);}
  }
  const unavailable=markdown(false);assert.ok(unavailable.renderHtml(reference).includes('&lt;p'));assert.ok(unavailable.blocksToHtml([{type:'para',text:'引用',referenceHtml:reference}]).includes('&lt;p'));
});

test('安全渲染不是审批：合法形状的伪哈希与真实目标换值仍被清单或整篇门禁阻断',async()=>{
  const f=await fixture(),MD=markdown(),forged=f.reference.replace(hash,'00000000');
  assert.equal(C.safeDocumentReferenceHtml(forged),forged);assert.equal(MD.renderHtml(forged),forged);
  const quality=C.inspect('规模以台账为准。\n\n'+forged,f.contract);assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(issue=>/bound-reference|reference-/.test(issue.code)));
  const actual=structuredClone(f.entries);actual[1].text=MD.renderHtml(f.reference);actual[0].text=actual[0].text.replace('5973','7973');
  const review=C.reviewDocument(actual,f.plan);assert.equal(review.status,'blocked');assert.ok(review.reviews.some(section=>section.issues.some(issue=>/reference-/.test(issue.code))));
});

test('真实隔离 DOM：正确引用保留五项身份，攻击节点、事件及外部请求为零',{timeout:30000},async()=>{
  const {reference}=await fixture(),{chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),outbound=[];await page.route('**/*',route=>{outbound.push(route.request().url());return route.abort();});await page.setContent('<main id="stage"></main>');
    for(const file of ['report-completion-contract.js','md.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    const result=await page.evaluate(({reference,attacks})=>{
      const stage=document.getElementById('stage');window.__referenceAttack=0;stage.innerHTML=MD.renderHtml(reference);
      const ref=stage.querySelector('.rpt-table-reference'),approved={count:stage.querySelectorAll('.rpt-table-reference').length,tag:ref.tagName,attributes:[...ref.attributes].map(attr=>[attr.name,attr.value]),text:ref.textContent,html:ref.outerHTML};
      const unsafe=[];for(const html of attacks)for(const rendered of [MD.renderHtml(html),MD.blocksToHtml([{type:'para',text:'伪造可信标记',referenceHtml:html}])]){
        stage.innerHTML=rendered;for(const el of stage.querySelectorAll('*'))for(const event of ['click','error','load','focus'])el.dispatchEvent(new Event(event));
        unsafe.push({executed:window.__referenceAttack,active:stage.querySelectorAll('.rpt-table-reference,script,img,svg,iframe,a').length,events:[...stage.querySelectorAll('*')].some(el=>[...el.attributes].some(attr=>/^on/i.test(attr.name))),retained:stage.textContent.includes('<p')});
      }
      return {approved,unsafe};
    },{reference,attacks:hostile(reference)});
    assert.equal(result.approved.count,1);assert.equal(result.approved.tag,'P');assert.equal(result.approved.attributes.length,5);assert.equal(result.approved.text,'详见第1.1节规模台账。');assert.equal(result.approved.html,reference);
    assert.ok(result.unsafe.every(row=>row.executed===0&&row.active===0&&row.events===false&&row.retained===true),JSON.stringify(result.unsafe));assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});

test('真实 DOCX 使用解析后的可见引用文字，不导出身份属性或转义 HTML',async()=>{
  const {reference}=await fixture(),blocks=markdown().parseBlocks(reference),docx=require('../docx.umd.js'),buildDocx=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
  const buffer=await docx.Packer.toBuffer(buildDocx(docx,{project:{name:'[系统测试]引用导出'},chapters:[{cn:'一',name:'总论',sections:[{title:'结论摘要',blocks}]}]})),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/详见第1\.1节规模台账。/);assert.doesNotMatch(xml,/data-report-ref|rpt-table-reference|&lt;p|&amp;lt;p/);
});
