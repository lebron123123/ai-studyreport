const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../scripts/windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright'),C=require('../report-completion-contract.js'),P=require('../report-output-policy.js');
const source=fs.readFileSync(path.resolve(__dirname,'../report.js'),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const renderCode=part('function renderContent(','function reportTableProjectType(');
const sectionCode=part('function renderSectionContent(','function reportSiteWritingPlan(');
const entriesCode=part('function reportCompletionEntries(','function reportSectionContract(');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metrics=[['指标名称','单位','数值','备注'],['全周期总收入','万元','21750.94','全周期'],['总成本费用','万元','16722.2','损益表口径'],['税金及附加合计','万元','646.35','不含所得税'],['净利润','万元','3288.77','全周期'],['累计净现值（NPV）','万元','1322.76','折现率6%'],['全投资内部收益率（IRR）','%','12.58','当前测算主指标'],['月度现金流XIRR','%','12.5841','按月度实际日期'],['年度现金流IRR','%','13.44','年度现金流序列'],['累计净现金流回正年份','年','2028','测算期第7年']];
const primary='<table class="rpt rpt-fixed-template" data-report-calc-kind="summary" data-report-calc-snapshot="calc-ff1c5eca-f6bf-498a-8fef-fcd2bb13833c" data-report-calc-version="2" data-report-calc-source="calc-tables-v2" data-report-calc-project="2884b7a3-960f-40c0-af89-5d19e0284836"><thead>'+metrics.slice(0,1).map(r=>'<tr>'+r.map(v=>'<th>'+v+'</th>').join('')+'</tr>').join('')+'</thead><tbody>'+metrics.slice(1).map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
const supplementRows=[['指标及单位','来源小节及原说明'],['全周期总收入（万元）','第9.3节 · 备注：全周期'],['总成本费用（万元）','第9.3节 · 备注：损益表口径'],['税金及附加（万元）','第9.3节 · 备注：不含所得税'],['净利润（万元）','第9.3节 · 备注：全周期'],['累计净现值（万元）','第9.3节 · 备注：折现率6%'],['全投资内部收益率（%）','第9.3节 · 备注：当前测算主指标'],['月度现金流XIRR（%）','第9.3节 · 备注：按月度实际日期'],['年度现金流IRR（%）','第9.3节 · 备注：年度现金流序列'],['累计净现金流回正年份（年）','第9.3节 · 备注：测算期第7年']];
const supplement='<table data-report-supplement="true" data-report-independent="true"><tbody>'+supplementRows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
// Both table strings are verbatim saved Longgang 9.3 table bytes from
// resume-state-2026-10-12T04-12-49-442Z-d5ed8a8a-longgang-end.json (/chapters/8/sections/2/content).
// The surrounding prose is shortened: one line, no editedHtml, native figure
// plus an independent field-difference table. No output file is needed at test time.
const saved='<h3>9.3.1 测算范围与基本参数</h3><p style="margin:0 0 10px;">当前测算假设，不能代替已确认的项目事实。</p><h4>财务指标</h4><figure class="rpt-template-card" data-template-id="gaibao-housing-table-11" data-report-table-scope="[&quot;&quot;,&quot;&quot;,[],[]]"><figcaption><b>财务指标汇总表</b><span>冻结结果</span></figcaption><div class="rpt-template-segment" data-segment="0"><div class="rpt-template-segment-title">财务指标汇总表</div><div class="rpt-template-scroll">'+primary+'</div></div></figure><div data-report-supplement="true" data-report-difference-key="[&quot;指标原说明&quot;]" data-report-field-differences="true"><p class="rpt-table-caption">财务指标原表说明</p>'+supplement+'</div><h3>9.3.2 评价边界</h3><p>盈亏临界值尚未求解。</p>';
const merged='<table data-report-source-caption="合并原表"><tr><th rowspan="2">项目</th><th colspan="2">金额（万元）</th></tr><tr><th>首期</th><th>合计</th></tr><tr><td><b>改造</b><br>工程</td><td>100.00</td><td>100.00</td></tr></table>';
const captioned=merged.replace('><tr>','><caption><span style="color:#66707A">原表</span>金额口径不变</caption><colgroup><col span="3"></colgroup><tr>');
const markdownBody=[...[1,2,3,4,5,6].map(n=>'#'.repeat(n)+' '+n+'级业务标题'),
  '分析**加粗**、*斜体*与`100.00`，不执行 <script>。','> 引用第一行\n> 引用第二行含`代码`。',
  '- 无序事项\n- 第二项含`代码`','1. 有序事项\n2. 第二项','---',
  '|项目|金额|\n|---|---|\n|改造|100.00|',captioned,'【待补：核对依据】'].join('\n\n');
const hostile=[
  saved.replace('<h3>','<h3 onclick="window.__attack++">'),
  saved.replace('<p style="margin:0 0 10px;">','<p style="margin:0 0 10px; background-image:url(https://invalid.example/attack)">'),
  saved.replace('<span>冻结结果','<span style="width:expression(window.__attack++)">冻结结果'),
  saved.replace('<h4>财务指标</h4>','<script>window.__attack++</script>'),
  saved+'<img src="https://invalid.example/attack" onerror="window.__attack++">',
  saved+'<svg onload="window.__attack++"></svg>',
  saved+'<a href="javascript:window.__attack++">点击</a>',
  saved+'<iframe srcdoc="&lt;script&gt;parent.__attack++&lt;/script&gt;"></iframe>',
  saved.replace('<table class="rpt rpt-fixed-template"','<table onclick="window.__attack++" class="rpt rpt-fixed-template"'),
  saved.replace('<h3>','<h3 class="ok" CLASS="duplicate">'),
  saved.replace('<p>盈亏临界值尚未求解。</p>','<p><div>非法嵌套</div></p>'),
  saved.replace('</figure>',''),
  saved.replace('</table>',''),
  '<!--'+saved+'-->',
  saved.replace('style="margin:0 0 10px;"','style="margin:0;display:none"'),
  saved.replace('style="margin:0 0 10px;"','style="margin:0;background-color:&#x72;ed"'),
];
function fixture(contract=C){
  const ctx={ReportCompletionContract:contract,ReportOutputPolicy:P,escapeHtml:esc};ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../md.js'),'utf8'),ctx);vm.runInContext(renderCode,ctx);return ctx;
}
function hostileMarkdown(generated){return [
  generated.replace('font-size:17px','font-size:18px'),
  generated.replace('font-size:17px','font-size:calc(17px)'),
  generated.replace('var(--ink,#1F262B)','var(--other,#1F262B)'),
  generated.replace('var(--ink,#1F262B)','var(--ink,red)'),
  generated.replace('var(--ink,#1F262B)','var(--ink,var(--other,#1F262B))'),
  generated.replace('var(--ink,#1F262B)','var(--ink,url(https://invalid.example/attack))'),
  generated.replace('var(--ink,#1F262B)','v\\61r(--ink,#1F262B)'),
  generated.replace('var(--ink,#1F262B)','var(--ink,&#35;1F262B)'),
  generated.replace('var(--ink,#1F262B)','var(--ink,#1F262B)!important'),
  generated.replace('var(--ink,#1F262B)','var(--ink,/*x*/#1F262B)'),
  generated.replace('border-top:1px solid var(--line,#DCE6F0)','border-top:2px solid var(--line,#DCE6F0)'),
  generated.replace('var(--line-strong,#B9B29E)','var(--line-strong,#000000)'),
  generated.replace('background:#FAFBFC','background:linear-gradient(red,blue)'),
  generated.replace('background:#F1F3F5','background:url(https://invalid.example/attack)'),
  generated.replace('border-radius:3px','border-radius:4px'),
  generated.replace('font-size:17px;','font-size:17px;position:fixed;'),
  generated.replace('<caption>','<caption onclick="window.__attack++">'),
  generated.replace('<span style="color:#66707A">','<span style="color:var(--ink,#1F262B)">'),
  generated.replace('<span style="color:#66707A">','<span href="https://invalid.example/attack">'),
  generated.replace('</caption>',''),
  generated.replace('colspan="2"','colspan="0"'),
  '<p style="font-size:17px;color:var(--ink,#1F262B);">不是 Markdown 标题样式</p>',
];}

test('complete saved HTML remains byte-identical, including both tables, hierarchy and financial identities',()=>{
  const ctx=fixture(),before=saved;
  assert.equal(ctx.renderContent(saved),saved);assert.equal(ctx.renderContent(ctx.renderContent(saved)),saved);
  assert.equal(saved,before);assert.equal(C.measure(ctx.renderContent(saved)).tableCount,2);
  assert.equal(ctx.reportStoredBodyHtml(' \n'+saved+'\n '),' \n'+saved+'\n ');
  assert.ok(saved.includes(primary)&&saved.includes(supplement));
  assert.equal(C.fingerprint(metrics.map(r=>r.map(v=>[v,1,1]))),'344239a5');
  assert.equal(C.fingerprint(supplementRows.map(r=>r.map(v=>[v,1,1]))),'5a82e8f6');
});

test('decoded unlocated notices survive Markdown, saved HTML and Word parsing without exposing HTML tags',async()=>{
  const marker='【待补：项目市场统计】',notice='项目市场统计资料待核验，相关判断暂不作确定性结论。';
  const c=C.normalize({...C.createPlan([{name:'市场',sections:[{t:'需求'}]}]).sections[0],gapRequirements:{version:C.GAP_REQUIREMENTS_VERSION,registryHash:'registry:1',sourceRevision:'source:1',primaryMarkers:[marker],references:[{gapId:'gap-market',ownerSection:'市场 / 需求',text:notice,critical:true}],forbiddenMarkers:[]}});
  const raw=JSON.stringify({blocks:[{kind:'heading',slot:'finding',level:3,text:'需求基础'},{kind:'paragraph',slot:'finding',text:'配套条件并不等于实际需求，应按真实申请台账校核规模。'}]});
  const decoded=C.decodeStructured(raw,c),ctx=fixture(),html=ctx.renderContent(decoded.text);
  assert.equal(decoded.raw,raw);assert.deepEqual(decoded.issues,[]);
  assert.match(html,/<div class="report-gap-boundaries">/);assert.doesNotMatch(html,/&lt;(?:div|p|strong)/);
  assert.equal(ctx.renderContent(html),html);assert.equal(ctx.reportStoredBodyHtml(html),html);
  assert.equal(html.split(notice).length-1,1);assert.match(html,/rpt-missing-placeholder/);
  assert.deepEqual(C.headingOutline(html).map(h=>h.text),['需求基础']);
  assert.equal(C.inspect(html,c).factsVerified,false);
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());await page.setContent('<main></main>');
    await page.addScriptTag({path:path.resolve(__dirname,'../export.js')});
    const result=await page.evaluate(html=>{
      document.querySelector('main').innerHTML=html;
      return {body:document.querySelector('main').textContent,boundaries:document.querySelectorAll('.report-gap-boundaries').length,blocks:htmlToBlocks(html)};
    },html);
    assert.equal(result.boundaries,1);assert.doesNotMatch(result.body,/<\/?(?:div|p|strong)>/);
    assert.equal(result.body.split(marker).length-1,1);assert.equal(result.body.split(notice).length-1,1);
    assert.ok(JSON.stringify(result.blocks).includes(notice));assert.ok(JSON.stringify(result.blocks).includes(marker));
    assert.equal(result.blocks.filter(b=>b.type==='h').length,1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('program notice rendering does not admit lookalike wrappers or active nested HTML',()=>{
  const ctx=fixture(),valid='<div class="report-gap-boundaries"><p><strong>资料核验边界（未定位到具体主题）</strong></p><p>项目资料尚待核验。</p></div>';
  const attacks=[valid.replace('class="report-gap-boundaries"','class="report-gap-boundaries" onclick="alert(1)"'),valid.replace('<p>项目','<p style="display:none">项目'),valid.replace('项目资料尚待核验。','<img src=x onerror="alert(1)">'),valid.replace('项目资料尚待核验。','<script>alert(1)</script>'),valid.replace('资料核验边界（未定位到具体主题）','任意标题'),valid.replace('</div>',''),valid+'<svg onload="alert(1)"></svg>'];
  for(const value of attacks){
    const rendered=ctx.MD.renderHtml('### 业务标题\n\n'+value);
    assert.doesNotMatch(rendered,/<(?:script|img|svg)\b|<div class="report-gap-boundaries"/);
    assert.ok(rendered.includes('&lt;div'));
    const mutated=ctx.MD.blocksToHtml([{type:'para',programGapHtml:value}]);
    assert.equal(mutated,'<p>'+value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p>');
  }
});

test('merged cells, exact digits, inline formatting and inert table metadata are preserved without TABLE conversion',()=>{
  const ctx=fixture(),body='<h3>投资构成</h3>'+merged+'<p>保留分析与口径。</p>';
  assert.equal(ctx.renderContent(body),body);assert.equal(C.safeFrozenTableHtml(merged),merged);
  assert.equal(ctx.renderContent(body).match(/100\.00/g).length,2);assert.doesNotMatch(ctx.renderContent(body),/\[\[TABLE\]\]/);
});

test('real Markdown output is byte-idempotent through the saved renderer, including all fixed styles and caption/span tables',()=>{
  const ctx=fixture(),generated=ctx.MD.renderHtml(markdownBody);
  assert.equal(ctx.renderContent(generated),generated);assert.equal(ctx.renderContent(ctx.renderContent(generated)),generated);
  assert.equal(ctx.reportStoredBodyHtml(generated),generated);
  for(const size of ['17px','15.5px','14.5px','13.8px','13.5px','13.2px'])assert.ok(generated.includes('font-size:'+size+';'));
  assert.match(generated,/<blockquote style="/);assert.match(generated,/<code style="/);assert.match(generated,/<hr style="/);
  assert.equal(C.measure(generated).tableCount,2);assert.ok(generated.includes(captioned));
  const styled=ctx.renderContent(markdownBody);assert.equal(ctx.renderContent(styled),styled);assert.match(styled,/rpt-missing-placeholder/);
  const unavailable=fixture(null);assert.equal(unavailable.renderContent(generated),'<p>'+esc(generated)+'</p>');
});

test('fixed Markdown styles do not admit other sizes, variables, CSS, URLs or unsafe table/caption/span markup',()=>{
  const ctx=fixture();
  for(const html of hostileMarkdown(ctx.MD.renderHtml(markdownBody))){assert.throws(()=>ctx.reportStoredBodyHtml(html));assert.equal(ctx.renderContent(html),'<p>'+esc(html)+'</p>');}
});

test('unsafe or malformed full fragments are rejected as a whole, not sanitized into trusted tables',()=>{
  const ctx=fixture();
  for(const html of hostile){
    assert.throws(()=>ctx.reportStoredBodyHtml(html),/HTML|冻结表/);
    const out=ctx.renderContent(html);assert.equal(out,'<p>'+esc(html)+'</p>');
    assert.doesNotMatch(out,/<(?:table|script|img|svg|iframe|a|figure|h3)\b/i);assert.ok(out.includes('21750.94'));
  }
  assert.throws(()=>ctx.reportStoredBodyHtml('<ul><p>不能自动纠错</p></ul>'));
  assert.throws(()=>ctx.reportStoredBodyHtml(saved+'\u0000'));
});

test('missing table validator fails closed; old Markdown, TABLE recovery and missing-value styling still use the existing path',()=>{
  const ctx=fixture(),md='### 业务分类\n\n说明**保持加粗**。\n\n|项目|金额|\n|---|---|\n|改造|100.00|';
  assert.equal(ctx.renderContent(md),ctx.MD.renderHtml(P.normalize(md)));
  assert.match(ctx.renderContent('[[TABLE]]\n项目|金额\n改造|100.00\n[[/TABLE]]'),/<table\b/);
  assert.match(ctx.renderContent('【待补：核对依据】'),/rpt-missing-placeholder/);
  const unavailable=fixture(null);assert.equal(unavailable.renderContent(saved),'<p>'+esc(saved)+'</p>');
  const withoutMd=fixture();withoutMd.MD=null;assert.equal(withoutMd.renderContent(saved),saved);
});

test('strict document binder sees the actual saved tables and still rejects changed cells, removed targets and stale references',async()=>{
  const ctx=fixture(),plan=C.createPlan([{name:'财务评价',sections:[{t:'财务指标'},{t:'引用结论'}]}]);
  ctx.chapters=[{name:'财务评价',checked:true,sections:[{t:'财务指标',content:saved,editedHtml:null},{t:'引用结论',content:'摘要',editedHtml:null}]}];
  ctx.reportTableProjectType=()=>null;vm.runInContext(entriesCode,ctx);
  const hash=C.fingerprint(metrics.map(r=>r.map(value=>[value,1,1])));
  ctx.chapters[0].sections[1].content='<p class="rpt-table-reference" data-report-ref-section="'+plan.sections[0].sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节财务指标。</p>';
  const before=JSON.stringify(ctx.chapters),entries=ctx.reportCompletionEntries();
  assert.equal(entries[0].text,saved);assert.equal(C.measure(entries[0].text).tableCount,2);
  const bound=await C.bindDocumentReferences(plan.sections[1],entries);assert.equal(bound.documentReferences.references[0].tables.length,1,'the cell-hash reference selects the primary table, not every neighboring table');
  assert.equal(bound.documentReferences.references[0].tables[0],primary);assert.equal(JSON.stringify(ctx.chapters),before);
  const changed=entries.map(e=>({...e}));changed[0].text=changed[0].text.replace('21750.94','21750.95');
  await assert.rejects(C.verifyDocumentReferences(bound,changed));await assert.rejects(C.bindDocumentReferences(plan.sections[1],changed));
  await assert.rejects(C.bindDocumentReferences(plan.sections[1],entries.slice(1)));
});

test('isolated browser: page/completion/Word share the saved HTML; hierarchy, merged cells and security survive real DOM parsing',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[];await page.route('**/*',route=>{outbound.push(route.request().url());return route.abort();});
    await page.setContent('<main id="stage"></main>');
    for(const file of ['report-completion-contract.js','md.js','report-output-policy.js','report-table-templates.js','export.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    await page.addScriptTag({content:'window.escapeHtml='+esc.toString()+';window.reportTableProjectType=()=>null;\n'+renderCode+'\n'+sectionCode+'\n'+entriesCode});
    const result=await page.evaluate(({saved,primary,supplement,merged,hostile})=>{
      window.__attack=0;window.chapters=[{name:'财务评价',checked:true,sections:[{t:'财务评价',content:saved,editedHtml:null}]}];
      const c=chapters[0],s=c.sections[0],before=JSON.stringify(chapters),stage=document.getElementById('stage');
      const pageHtml=renderSectionContent(c,s,true),entry=reportCompletionEntries()[0];stage.innerHTML=pageHtml;
      const domTable=html=>new DOMParser().parseFromString(html,'text/html').querySelector('table').outerHTML;
      const approved={exact:pageHtml===saved&&entry.text===saved,tables:stage.querySelectorAll('table').length,headings:[...stage.querySelectorAll('h3,h4')].map(e=>[e.tagName,e.textContent]),snapshot:stage.querySelector('table').dataset.reportCalcSnapshot,primary:stage.querySelector('table').outerHTML===domTable(primary),supplement:stage.querySelectorAll('table')[1].outerHTML===domTable(supplement)};
      const blocks=htmlToBlocks(entry.text),word={tables:blocks.filter(b=>b.type==='table'||b.type==='templateTable').length,headings:blocks.filter(b=>b.type==='h').map(b=>[b.level,b.text]),values:JSON.stringify(blocks).includes('21750.94')&&JSON.stringify(blocks).includes('12.5841')};
      stage.innerHTML=renderContent('<h3>投资构成</h3>'+merged);const merge={rowspan:stage.querySelector('th').rowSpan,colspan:stage.querySelectorAll('th')[1].colSpan,html:stage.querySelector('table').outerHTML===domTable(merged),values:[...stage.querySelectorAll('td')].map(e=>e.textContent)};
      const unsafe=[];
      for(const html of hostile){stage.innerHTML=renderContent(html);for(const el of stage.querySelectorAll('*'))for(const event of ['click','error','load','mouseover'])el.dispatchEvent(new Event(event));unsafe.push({executed:window.__attack,active:stage.querySelectorAll('table,script,img,svg,iframe,math,a,figure').length,events:[...stage.querySelectorAll('*')].some(e=>[...e.attributes].some(a=>/^on/i.test(a.name))),retained:stage.textContent===html});}
      return {approved,word,merge,unsafe,unchanged:JSON.stringify(chapters)===before};
    },{saved,primary,supplement,merged,hostile});
    assert.ok(result.approved.exact&&result.approved.primary&&result.approved.supplement);assert.equal(result.approved.tables,2);
    assert.deepEqual(result.approved.headings,[['H3','9.3.1 测算范围与基本参数'],['H4','财务指标'],['H3','9.3.2 评价边界']]);
    assert.equal(result.approved.snapshot,'calc-ff1c5eca-f6bf-498a-8fef-fcd2bb13833c');assert.equal(result.word.tables,2);assert.ok(result.word.values);
    assert.deepEqual(result.word.headings,[[3,'9.3.1 测算范围与基本参数'],[4,'财务指标'],[3,'9.3.2 评价边界']]);
    assert.equal(result.merge.rowspan,2);assert.equal(result.merge.colspan,2);assert.ok(result.merge.html);assert.deepEqual(result.merge.values,['改造工程','100.00','100.00']);
    assert.ok(result.unsafe.every(r=>r.executed===0&&r.active===0&&!r.events&&r.retained),JSON.stringify(result.unsafe));assert.ok(result.unchanged);assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});

test('isolated real DOM: Markdown saved round-trip retains fixed styles, caption/merged cells and Word blocks; hostile variants remain source text',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{outbound.push(route.request().url());return route.abort();});await page.setContent('<main id="stage"></main>');
    for(const file of ['report-completion-contract.js','md.js','report-output-policy.js','export.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    await page.addScriptTag({content:'window.escapeHtml='+esc.toString()+';\n'+renderCode});
    const generated=fixture().MD.renderHtml(markdownBody);
    const result=await page.evaluate(({markdownBody,generated,attacks})=>{
      const stage=document.getElementById('stage'),html=MD.renderHtml(markdownBody);window.__attack=0;
      const first=renderContent(html),second=renderContent(first);stage.innerHTML=second;
      const blocks=htmlToBlocks(second),approved={exact:html===generated&&first===html&&second===html,
        levels:[...stage.querySelectorAll('[data-report-heading-level]')].map(el=>Number(el.dataset.reportHeadingLevel)),
        sizes:[...stage.querySelectorAll('[data-report-heading-level]')].map(el=>el.style.fontSize),
        quote:[stage.querySelector('blockquote').style.backgroundColor,stage.querySelector('blockquote').style.borderLeft],
        code:stage.querySelector('code').style.borderRadius,lists:stage.querySelectorAll('ul,ol').length,
        captions:[...stage.querySelectorAll('caption')].map(el=>el.textContent),span:stage.querySelector('caption span').textContent,
        tables:stage.querySelectorAll('table').length,rowspan:stage.querySelector('table:last-of-type th').rowSpan,
        colspan:stage.querySelectorAll('table:last-of-type th')[1].colSpan,
        wordLevels:blocks.filter(b=>b.type==='h').map(b=>b.level),wordTables:blocks.filter(b=>b.type==='table').length,
        wordLists:blocks.filter(b=>b.type==='list').length};
      const unsafe=[];
      for(const html of attacks){stage.innerHTML=renderContent(html);for(const el of stage.querySelectorAll('*'))for(const event of ['click','error','load','mouseover'])el.dispatchEvent(new Event(event));unsafe.push({executed:window.__attack,active:stage.querySelectorAll('table,script,img,svg,iframe,math,a,blockquote,code,[data-report-heading-level]').length,events:[...stage.querySelectorAll('*')].some(e=>[...e.attributes].some(a=>/^on/i.test(a.name))),retained:stage.textContent===html});}
      return {approved,unsafe};
    },{markdownBody,generated,attacks:hostileMarkdown(generated)});
    assert.ok(result.approved.exact);assert.deepEqual(result.approved.levels,[1,2,3,4,5,6]);
    assert.deepEqual(result.approved.sizes,['17px','15.5px','14.5px','13.8px','13.5px','13.2px']);
    assert.equal(result.approved.quote[0],'rgb(250, 251, 252)');assert.match(result.approved.quote[1],/var\(--line-strong/);assert.equal(result.approved.code,'3px');
    assert.deepEqual(result.approved.captions,['原表金额口径不变']);assert.equal(result.approved.span,'原表');
    assert.equal(result.approved.tables,2);assert.equal(result.approved.rowspan,2);assert.equal(result.approved.colspan,2);
    assert.deepEqual(result.approved.wordLevels,[1,2,3,4,5,6]);assert.equal(result.approved.wordTables,2);assert.equal(result.approved.wordLists,2);
    assert.ok(result.unsafe.every(r=>r.executed===0&&r.active===0&&!r.events&&r.retained),JSON.stringify(result.unsafe));
    assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});
