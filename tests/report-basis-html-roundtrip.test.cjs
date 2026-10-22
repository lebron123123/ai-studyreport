'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../report-completion-contract.js'),MD=require('../md.js');
const key='项目总论 / 编制依据与编制说明';
const headings=[{level:3,text:'编制依据'},{level:4,text:'项目专属依据'},{level:4,text:'国家层面依据'},{level:4,text:'集团层面依据'}];
async function fixture(){
  const base=C.normalize({...C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}],{budgets:{[key]:{proseTarget:1200,proseMax:1600,reason:'[系统测试]依据清单'}}}).sections[0],requiredHeadings:headings});
  const item=(title,category)=>({title,status:'received',ownerKey:key,groups:[headings[0],headings[category]],evidence:{sourceId:'[系统测试]'+title,sourceHash:'a'.repeat(64),locator:'原件标题'},verification:{}});
  const contract=await C.bindBasisCatalog(base,{items:[item('项目合作协议',1),item('物业交付标准清单',1),item('中华人民共和国民法典',2)]},'[系统测试]HTML往返');
  const text=C.decodeStructured(JSON.stringify({blocks:contract.basisCatalog.items.map(i=>({kind:'basis-ref',id:i.id}))}),contract).text;
  return {contract,text,html:MD.renderHtml(text)};
}
const hard=q=>q.issues.filter(i=>i.severity==='error');

test('依据清单经真实Markdown渲染后仍与同一目录相同，标题身份和原件绑定不变',async()=>{
  const {contract,text,html}=await fixture(),before=JSON.stringify(contract),plain=C.inspect(text,contract),rendered=C.inspect(html,contract);
  assert.deepEqual(hard(plain),[]);assert.deepEqual(hard(rendered),[]);
  assert.deepEqual(C.headingOutline(html),C.headingOutline(text));assert.equal(JSON.stringify(contract),before);
  assert.equal(rendered.status,'unverified');assert.equal(rendered.factsVerified,false);
  assert.match(html,/集团层面依据尚未登记可引用依据文件/);
  await C.verifyBasisCatalog(contract);
});

test('只统一已识别标题的程序编号：小数编号、中文编号及完整加粗标题',async()=>{
  const {contract,text,html}=await fixture();
  const numbered=html.replace('>编制依据</div>','>1.1.1 编制依据</div>').replace('>项目专属依据</div>','>1.1.1.1 项目专属依据</div>').replace('>国家层面依据</div>','>1.1.1.2 国家层面依据</div>');
  const chinese=text.replace('### 编制依据','一、编制依据').replace('#### 项目专属依据','（一）项目专属依据').replace('#### 国家层面依据','（二）国家层面依据');
  const bold=text.replace('### 编制依据','**一、编制依据**').replace('#### 项目专属依据','**（一）项目专属依据**').replace('#### 国家层面依据','**（二）国家层面依据**');
  assert.notEqual(numbered,html);for(const value of [numbered,chinese,bold])assert.deepEqual(hard(C.inspect(value,contract)),[]);
});

for(const [name,mutate] of [
  ['改文件名称',html=>html.replace('中华人民共和国民法典','中华人民共和国合同法')],
  ['删文件',html=>html.replace(/<p\b[^>]*>[^<]*《物业交付标准清单》[^<]*<\/p>/,'')],
  ['重复文件',html=>html.replace(/(<p\b[^>]*>[^<]*《物业交付标准清单》[^<]*<\/p>)/,'$1$1')],
  ['同分类文件乱序',html=>html.replace(/(<p\b[^>]*>[^<]*《项目合作协议》[^<]*<\/p>)\s*(<p\b[^>]*>[^<]*《物业交付标准清单》[^<]*<\/p>)/,'$2$1')],
  ['改分类标题',html=>html.replace('>国家层面依据</div>','>地方层面依据</div>')],
  ['把分类标题降为普通段落',html=>html.replace(/<div\b[^>]*>国家层面依据<\/div>/,'<p>国家层面依据</p>')],
  ['增加普通分析',html=>html+'<p>项目已经符合全部条件，可以立即实施。</p>'],
  ['增加普通数字文本',html=>html+'<p>1.1.1 这是额外的正文分析，不能当作编号自动忽略。</p>'],
  ['增加普通井号文本',html=>html+'<p>### 这不是登记的文件内容。</p>'],
  ['删真实缺项提示',html=>html.replace('【待补：编制依据 / 集团层面依据尚未登记可引用依据文件】','')],
  ['把路径缺项改成空泛缺项',html=>html.replace('【待补：编制依据 / 集团层面依据尚未登记可引用依据文件】','【待补：本分类尚未登记可引用依据文件】')],
  ['改核验状态',html=>html.replace('已接收，待核验','已经核验有效')],
])test('显示格式兼容不放宽内容：'+name+'仍拒绝',async()=>{
  const {contract,html}=await fixture(),changed=mutate(html);assert.notEqual(changed,html,'反例必须真实改变输入');
  const codes=hard(C.inspect(changed,contract)).map(i=>i.code);
  assert.ok(codes.includes(name==='删文件'?'basis-catalog-missing':'basis-catalog-content'));
});

test('真实隔离浏览器走原reportCompletionEntries再inspect，重复、刷新恢复及空/失败态不误放行',{timeout:45000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true}),{contract,text,html}=await fixture();
  const source=fs.readFileSync(require.resolve('../report.js'),'utf8'),entry=source.slice(source.indexOf('function reportCompletionEntries('),source.indexOf('function reportSectionContract('));
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://basis-roundtrip.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main>[系统测试]依据目录</main>'}));
    const setup=async()=>{
      await page.goto('https://basis-roundtrip.test/');
      for(const file of ['md.js','report-completion-contract.js','report-section-layout.js','report-table-templates.js'])await page.addScriptTag({path:require.resolve('../'+file)});
      await page.evaluate(({html})=>{window.chapters=[{name:'项目总论',sections:[{t:'编制依据与编制说明',editedHtml:html}]}];window.renderContent=MD.renderHtml;}, {html});
      await page.addScriptTag({content:entry});
    };
    await setup();
    const inspect=()=>page.evaluate(({contract})=>{const e=reportCompletionEntries()[0],q=ReportCompletionContract.inspect(e.text,contract);return {text:e.text,hard:q.issues.filter(i=>i.severity==='error'),headings:ReportCompletionContract.headingOutline(e.text)};},{contract});
    const first=await inspect();assert.deepEqual(first.hard,[]);assert.deepEqual(first.headings,C.headingOutline(text));
    assert.deepEqual(await inspect(),first);await setup();assert.deepEqual(await inspect(),first);
    for(const body of ['',html.replace('中华人民共和国民法典','未登记文件')]){
      await page.evaluate(body=>{chapters[0].sections[0].editedHtml=body;chapters[0].sections[0].content=body;},body);
      assert.ok((await inspect()).hard.length);
    }
    await page.evaluate(html=>{chapters[0].sections[0].editedHtml=html;},html);assert.deepEqual(await inspect(),first);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
