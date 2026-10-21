const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {chromium}=require('playwright');
const Contract=require('../report-completion-contract.js');
const Policy=require('../report-output-policy.js');
const source=fs.readFileSync(path.resolve('md.js'),'utf8');
function markdown(){const context={ReportCompletionContract:Contract};context.window=context;vm.runInNewContext(source,context);return context.MD;}
const clone=value=>JSON.parse(JSON.stringify(value));
const fragments=[
  '[[TABLE]]\n房型|层高（m）|套数（套）|建筑面积（㎡）|得房率（%）\n2-6F标准层|5.4|15套/层（共5层，合计75套）|454.9/层（合计2274.5）|\n7-14F标准层|4.5|15套/层（共8层，合计120套）|454.9/层（合计3639.2）|\n合计|—|195|5973||\n[[/TABLE]]',
  '[[TABLE]]\n序号|科目|成本（万元）|单方成本（元/㎡）|单房成本（元/套）|科目释义\n|合计|【待补：具体金额】|【待补：具体金额】|【待补：具体金额】|—\n[[/TABLE]]',
  '[[TABLE]]\n序号|成本科目|计算口径|单方造价(元/㎡)|估算金额(万元)|占比(%)\n|建设投资合计|—|待填|待填|100.00\n[[/TABLE]]'
];

test('framed and unframed tables preserve first/last empty cells without shifting non-empty values',()=>{
  const MD=markdown();
  for(const framed of [false,true]){
    const line=cells=>framed?'|'+cells.join('|')+'|':cells.join('|');
    const rows=[['序号','科目','金额'],['','首项','12.30'],['2','尾项','']];
    for(const marked of [false,true]){
      const body=marked?'[[TABLE]]\n'+rows.map(line).join('\n')+'\n[[/TABLE]]':line(rows[0])+'\n'+line(['---','---','---'])+'\n'+rows.slice(1).map(line).join('\n');
      const block=MD.parseBlocks(body).find(b=>b.type==='table');
      assert.deepEqual(clone(block.rows),rows);assert.equal(block.structureIssues.length,0);
      assert.match(block.displayRows[1][0],/序号.*原表空白/);assert.match(block.displayRows[2][2],/金额.*原表空白/);
      assert.deepEqual(clone(block.structureRepairs.filter(x=>x.code==='explicit-empty-cell').map(x=>[x.row,x.column,x.original])),[[2,1,''],[3,3,'']]);
      assert.doesNotThrow(()=>Contract.safeFrozenTableHtml(MD.renderHtml(body)));
    }
  }
});

test('mixed framing is accepted only for a unique alignment; ambiguous or short rows stay visible and blocked',()=>{
  const MD=markdown(),mixed=MD.parseBlocks('A|B\n---|---\n|x|y|').find(b=>b.type==='table');
  assert.deepEqual(clone(mixed.rows),[['A','B'],['x','y']]);assert.equal(mixed.structureIssues.length,0);
  for(const row of ['|x|y|','x|y']){
    const text='A|B|C\n---|---|---\n'+row,block=MD.parseBlocks(text).find(b=>b.type==='table');
    assert.equal(block.structureIssues.length,1);assert.deepEqual(clone(block.rows[1]),row.split('|'));
    assert.match(MD.renderHtml(text),/表格列位不明确/);
    const tableHtml=MD.renderHtml(text).match(/<table\b[\s\S]*<\/table>/)[0];assert.throws(()=>Contract.safeFrozenTableHtml(tableHtml),/结构不完整/);
  }
  const empty=MD.parseBlocks('A|B\n---|---\n|').find(b=>b.type==='table');
  // A single pipe is not enough to establish a data row; no invented cells.
  assert.equal(empty.rows.length,1);
});

test('three real Longgang table fragments keep original values/column coordinates and expose blank-cell audit records',()=>{
  const MD=markdown(),blocks=fragments.map(text=>MD.parseBlocks(text).find(b=>b.type==='table'));
  assert.deepEqual(clone(blocks[0].rows[1]),['2-6F标准层','5.4','15套/层（共5层，合计75套）','454.9/层（合计2274.5）','']);
  assert.deepEqual(clone(blocks[0].rows[3]),['合计','—','195','5973','']);
  assert.deepEqual(clone(blocks[1].rows[1]),['','合计','【待补：具体金额】','【待补：具体金额】','【待补：具体金额】','—']);
  assert.deepEqual(clone(blocks[2].rows[1]),['','建设投资合计','—','待填','待填','100.00']);
  assert.equal(blocks.flatMap(b=>b.structureIssues).length,0);assert.equal(blocks.flatMap(b=>b.structureRepairs).filter(x=>x.code==='explicit-empty-cell').length,5);
  for(const text of fragments)assert.doesNotThrow(()=>Contract.safeFrozenTableHtml(MD.renderHtml(text)));
});

test('output normalization and legacy Word repair share column alignment instead of stripping blank cells',()=>{
  const MD=markdown();
  for(const text of fragments){
    const direct=MD.parseBlocks(text).find(b=>b.type==='table');
    const normalized=MD.parseBlocks(Policy.normalize(text)).find(b=>b.type==='table');
    assert.deepEqual(clone(normalized.rows),clone(direct.rows));
    assert.equal(normalized.structureIssues.length,0);
    const repaired=Policy.repairBlocks(text.split('\n').map(text=>({type:'p',text}))).find(b=>b.type==='table');
    assert.deepEqual(clone(repaired.rows),clone(direct.displayRows));
    assert.equal(repaired.structureIssues.length,0);
  }
  const empty=Policy.tableBlocks('[[TABLE]]\nA|B\n||\n[[/TABLE]]').find(b=>b.type==='table');
  assert.deepEqual(empty.sourceRows,[['A','B'],['','']]);
  const ambiguous=Policy.repairBlocks([{type:'p',text:'[[TABLE]]\nA|B|C\n|x|y|\n[[/TABLE]]'}]);
  assert.equal(ambiguous.find(b=>b.type==='table').structureIssues.length,1);
  assert.ok(ambiguous.some(b=>/列位不明确/.test(b.text||'')));
});

test('policy resolves the shared parser in either script order and fails closed when MD is unavailable',()=>{
  const policySource=fs.readFileSync(path.resolve('report-output-policy.js'),'utf8'),context={};context.window=context;
  vm.runInNewContext(policySource,context);
  const text=fragments[2],protectedText=context.ReportOutputPolicy.normalize(text);
  assert.match(protectedText,/解析组件未就绪/);assert.ok(protectedText.includes(text));
  const protectedBlocks=context.ReportOutputPolicy.repairBlocks([{type:'p',text}]);
  assert.equal(protectedBlocks.some(b=>b.type==='table'),false);assert.ok(protectedBlocks.some(b=>b.text===text));
  vm.runInNewContext(source,context);
  assert.deepEqual(clone(context.MD.parseBlocks(context.ReportOutputPolicy.normalize(text)).find(b=>b.type==='table').rows),clone(markdown().parseBlocks(text).find(b=>b.type==='table').rows));
  const NodeMD=require('../md.js');assert.equal(typeof NodeMD.parseTableRows,'function');
  assert.deepEqual(NodeMD.parseTableRows(['A|B','|x']).rows,[['A','B'],['','x']]);
  const continued='[[TABLE]]\nA|B\nx|运营（待\n核实）\n[[/TABLE]]';
  assert.equal(Policy.tableBlocks(continued).find(b=>b.type==='table').rows[1][1],'运营（待核实）');
});

test('TABLE recovery retains captions/comments and escapes executable HTML in cells and blank labels',()=>{
  const MD=markdown(),text='[[TABLE]]\n表1 明细\n序号|<img src=x onerror=alert(1)>|金额\n|甲|100.00\n注：表后说明，不得吞表。';
  const blocks=MD.parseBlocks(text),html=MD.renderHtml(text);
  assert.equal(blocks.filter(b=>b.type==='table').length,1);assert.equal(blocks.at(-1).text,'注：表后说明，不得吞表。');
  assert.match(html,/表1 明细/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img\b/);
  assert.equal(MD.parseBlocks('[[TABLE]]\nA|B\n||\n[[/TABLE]]').find(b=>b.type==='table').rows[1].length,2);
  const before='\u0001MD_TABLE_0\u0002';assert.ok(MD.parseBlocks(before+'\n\n'+fragments[2]).some(b=>b.text===before),'source token-like text cannot refer to an internal table');
});

test('real browser preview and actual DOCX XML retain all non-empty values in the same columns',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[],errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{outbound.push(route.request().url());return route.abort();});
    for(const file of ['md.js','report-output-policy.js','export.js','report-completion-contract.js'])await page.addScriptTag({path:path.resolve(file)});
    const result=await page.evaluate(fragments=>{
      const html=fragments.map(t=>MD.renderHtml(ReportOutputPolicy.normalize(t))).join(''),doc=new DOMParser().parseFromString(html,'text/html');
      return {html,rows:[...doc.querySelectorAll('table')].map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.textContent))),blocks:htmlToBlocks(html)};
    },fragments);
    assert.equal(result.rows[0][1][3],'454.9/层（合计2274.5）');assert.match(result.rows[0][1][4],/得房率.*原表空白/);
    assert.equal(result.rows[1][1][1],'合计');assert.equal(result.rows[1][1][5],'—');assert.equal(result.rows[2][1][5],'100.00');
    const D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
    const bytes=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]空格列位保留'},chapters:[{cn:'一',num:1,name:'结构核验',sections:[{num:1,title:'三张原表',blocks:result.blocks}]}]}));
    const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
    const wordRows=await page.evaluate(xml=>{
      const doc=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      return [...doc.getElementsByTagNameNS(ns,'tbl')].map(t=>[...t.getElementsByTagNameNS(ns,'tr')].map(r=>[...r.getElementsByTagNameNS(ns,'tc')].map(c=>[...c.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(''))));
    },xml);
    assert.deepEqual(wordRows,result.rows,'actual Word XML and browser table coordinates agree');assert.equal(wordRows.length,3);
    const legacyBytes=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]旧稿表格修复'},chapters:[{cn:'一',num:1,name:'结构核验',sections:[{num:1,title:'原始TABLE',blocks:fragments.flatMap(t=>t.split('\n').map(text=>({type:'p',text})))}]}]}));
    const legacyXml=await(await JSZip.loadAsync(legacyBytes)).file('word/document.xml').async('string');
    const legacyRows=await page.evaluate(xml=>{
      const doc=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      return [...doc.getElementsByTagNameNS(ns,'tbl')].map(t=>[...t.getElementsByTagNameNS(ns,'tr')].map(r=>[...r.getElementsByTagNameNS(ns,'tc')].map(c=>[...c.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(''))));
    },legacyXml);
    assert.deepEqual(legacyRows,result.rows,'legacy TABLE paragraphs produce the same actual Word cells');
    assert.deepEqual(outbound,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
