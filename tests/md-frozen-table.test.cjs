const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {chromium}=require('playwright');
const C=require('../report-completion-contract.js');
const source=fs.readFileSync(path.join(__dirname,'../md.js'),'utf8');
const table='<table class="rpt" style="border-collapse:collapse"><tr><th rowspan="2">项目</th><th colspan="2">金额（万元）</th></tr><tr><th>首期</th><th>合计</th></tr><tr><td><span style="font-weight:bold">改造</span><br>工程</td><td>100.00</td><td>100.00</td></tr></table>';
const hostile=[
  '<table onclick="window.__frozenAttack++"><tr><td>1</td></tr></table>',
  '<table><tr><td><img src="https://invalid.example/frozen-attack" onerror="window.__frozenAttack++"></td></tr></table>',
  '<table><tr><td><svg onload="window.__frozenAttack++"></svg></td></tr></table>',
  '<table><tr><td><script>window.__frozenAttack++</script></td></tr></table>',
  '<table><tr><td style="background-image:url(https://invalid.example/frozen-attack)">1</td></tr></table>',
  '<table><tr><td style="width:expression(window.__frozenAttack++)">1</td></tr></table>',
  '<table><tr><td><a href="javascript:window.__frozenAttack++">点击</a></td></tr></table>',
  '<table><tr><td><iframe srcdoc="<script>parent.__frozenAttack++</script>"></iframe></td></tr></table>',
  '<table><tr><td><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__frozenAttack++>"></table></mtext></math></td></tr></table>'
];
function markdown(withValidator=true){const context={};context.window=context;if(withValidator)context.ReportCompletionContract=C;vm.runInNewContext(source,context);return context.MD;}

test('共享Markdown结构保留冻结表原HTML、rowspan/colspan及文字单元格，不二次改写数字',()=>{
  const MD=markdown(),blocks=MD.parseBlocks('简要结论。\n\n'+table+'\n\n风险待核对。'),frozen=blocks.find(block=>block.type==='table');
  assert.equal(frozen.frozenHtml,table);assert.deepEqual(JSON.parse(JSON.stringify(frozen.rows)),[['项目','金额（万元）'],['首期','合计'],['改造\n工程','100.00','100.00']]);
  const once=MD.renderHtml(table);assert.equal(once,table);assert.equal(MD.renderHtml(once),table);assert.equal(MD.blocksToHtml([frozen]),table);
  assert.match(MD.renderHtml('|指标|值|\n|---|---|\n|收入|100.00|'),/<table class="rpt">/,'历史Markdown表仍走原结构解析');
});

test('冻结表验证器缺失或原HTML不安全时只转义展示，不能因已有frozenHtml标记绕过',()=>{
  const MD=markdown(),unavailable=markdown(false);
  for(const html of hostile){
    const rendered=MD.renderHtml(html),forged=MD.blocksToHtml([{type:'table',frozenHtml:html,rows:[['伪造信任']]}]);
    assert.equal(MD.parseBlocks(html).filter(block=>block.frozenHtml).length,0);assert.doesNotMatch(rendered,/<table\b|<img\b|<svg\b|<script\b|<iframe\b|<a\b/i);assert.doesNotMatch(forged,/<table\b|<img\b|<script\b/i);
    assert.ok(rendered.includes('&lt;table'),'危险原文保留为可见转义文本，不能静默丢弃');
  }
  assert.doesNotMatch(unavailable.renderHtml(table),/<table\b/);assert.ok(unavailable.renderHtml(table).includes('100.00'));
  assert.doesNotMatch(unavailable.blocksToHtml([{type:'table',frozenHtml:table,rows:[]}]),/<table\b/);
});

test('真实隔离浏览器：允许的冻结表合并格保留，攻击HTML无可执行节点、事件或外部请求',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[];await page.route('**/*',route=>{outbound.push(route.request().url());return route.abort();});
    await page.setContent('<main id="stage"></main>');
    for(const file of ['report-completion-contract.js','md.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    const result=await page.evaluate(({table,hostile})=>{
      const stage=document.getElementById('stage');window.__frozenAttack=0;stage.innerHTML=MD.renderHtml(table);
      const approved={count:stage.querySelectorAll('table').length,rowSpan:stage.querySelector('th').rowSpan,colSpan:stage.querySelectorAll('th')[1].colSpan,span:stage.querySelector('span').textContent,values:[...stage.querySelectorAll('td')].map(cell=>cell.textContent),parsed:MD.parseBlocks(table)[0].frozenHtml};
      const unsafe=[];
      for(const html of hostile){
        for(const rendered of [MD.renderHtml(html),MD.blocksToHtml([{type:'table',frozenHtml:html,rows:[]}])]){
          stage.innerHTML=rendered;
          for(const el of stage.querySelectorAll('*'))for(const event of ['click','error','load','mouseover'])el.dispatchEvent(new Event(event));
          unsafe.push({executed:window.__frozenAttack,active:stage.querySelectorAll('table,script,img,svg,iframe,math,a').length,events:[...stage.querySelectorAll('*')].some(el=>[...el.attributes].some(attr=>/^on/i.test(attr.name))),retained:stage.textContent.includes('<table')});
        }
      }
      const escaped='<table><tr><td>&lt;img src=x onerror=window.__frozenAttack++&gt;</td></tr></table>';
      stage.innerHTML=MD.renderHtml(escaped);
      return {approved,unsafe,encodedText:stage.textContent,encodedImages:stage.querySelectorAll('img').length,executed:window.__frozenAttack};
    },{table,hostile});
    assert.equal(result.approved.count,1);assert.equal(result.approved.rowSpan,2);assert.equal(result.approved.colSpan,2);assert.equal(result.approved.span,'改造');assert.deepEqual(result.approved.values,['改造工程','100.00','100.00']);assert.equal(result.approved.parsed,table);
    assert.ok(result.unsafe.every(row=>row.executed===0&&row.active===0&&row.events===false&&row.retained===true),JSON.stringify(result.unsafe));
    assert.equal(result.encodedImages,0);assert.match(result.encodedText,/<img src=x/);assert.equal(result.executed,0);assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});
