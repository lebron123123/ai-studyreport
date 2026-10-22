const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
require('../scripts/windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright');

async function packageXml(blocks){
  const buffer=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]列表与标题'},chapters:[{cn:'一',name:'运营方案',sections:[{title:'运营安排',blocks}]}]}));
  const zip=await JSZip.loadAsync(buffer);
  return {document:await zip.file('word/document.xml').async('string'),numbering:await zip.file('word/numbering.xml').async('string'),styles:await zip.file('word/styles.xml').async('string'),custom:await zip.file('docProps/custom.xml').async('string')};
}
const paragraphs=xml=>Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),match=>match[0]);

test('Word ordinary lists use true decimal/bullet numbering and stay separate from business headings',async()=>{
  const xml=await packageXml([
    {type:'h',level:3,text:'1.1.1 运营职责'},
    {type:'list',ordered:true,items:['按20%租金落实收楼。','管理费15.7%，期限2027—2031年。']},
    {type:'list',ordered:false,items:['核实合同条件。','【待补：责任单位】']},
    {type:'h',level:4,text:'1.1.1.1 责任边界'},
  ]);
  for(const text of ['按20%租金落实收楼','管理费15.7%','核实合同条件','责任单位']){
    const paragraph=paragraphs(xml.document).find(p=>p.includes(text));
    assert.ok(paragraph,text);assert.match(paragraph,/<w:numPr>/);assert.doesNotMatch(paragraph,/w:pStyle w:val="Heading/);assert.doesNotMatch(paragraph,/<w:outlineLvl\b/);
  }
  assert.match(xml.document,/w:pStyle w:val="Heading3"/);assert.match(xml.document,/w:pStyle w:val="Heading4"/);
  assert.match(xml.numbering,/<w:numFmt w:val="decimal"/);assert.match(xml.numbering,/<w:numFmt w:val="bullet"/);
  assert.match(xml.document,/<w:color w:val="C62828"[^>]*\/>[\s\S]*?【待补：责任单位】/);
  assert.doesNotMatch(xml.document,/<w:t[^>]*>(?:1\. |· |• )/);
});

test('Word Heading1–6 define genuine outline levels; ordinary lists and body text remain outside the outline',async()=>{
  const xml=await packageXml([
    ...[3,4,5,6].map(level=>({type:'h',level,text:'系统测试第'+level+'级标题'})),
    {type:'list',ordered:true,items:['系统测试普通编号事项。']},
    {type:'p',text:'系统测试普通正文。'},
  ]);
  const styles=Array.from(xml.styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g),match=>match[0]);
  for(let level=1;level<=6;level++){
    const style=styles.find(s=>s.includes('w:styleId="Heading'+level+'"'));
    assert.ok(style,'Heading'+level+' style exists');
    assert.match(style,new RegExp('<w:pPr>[\\s\\S]*?<w:outlineLvl w:val="'+(level-1)+'"[^>]*/>[\\s\\S]*?</w:pPr>'));
  }
  const paragraphDefaults=xml.styles.match(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/)?.[0];
  assert.ok(paragraphDefaults,'document paragraph defaults exist');
  assert.doesNotMatch(paragraphDefaults,/<w:outlineLvl\b/);
  for(const style of styles.filter(s=>s.includes('w:type="paragraph"')&&s.includes('w:default="1"'))){
    assert.doesNotMatch(style,/<w:outlineLvl\b/);
  }
  for(const text of ['系统测试普通编号事项。','系统测试普通正文。']){
    const paragraph=paragraphs(xml.document).find(p=>p.includes(text));assert.ok(paragraph);
    assert.doesNotMatch(paragraph,/<w:outlineLvl\b|w:pStyle w:val="Heading/);
    const styleId=paragraph.match(/<w:pStyle w:val="([^"]+)"/)?.[1];
    if(styleId){
      const style=styles.find(s=>s.includes('w:styleId="'+styleId+'"'));assert.ok(style,styleId);
      assert.doesNotMatch(style,/<w:outlineLvl\b/);
    }
  }
  assert.equal(build.templateVersion,'report-docx-20261013-cover-metadata-v7');
  assert.ok(xml.custom.includes(build.templateVersion));assert.doesNotMatch(xml.custom,/structured-lists-v5/);
});

test('HTML export keeps direct items, nesting, continuation text and list start without duplicating numeric facts',{timeout:45000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.addScriptTag({path:path.resolve('export.js')});
    const blocks=await page.evaluate(()=>htmlToBlocks('<div><h3>1.1.1 运营职责</h3><ol start="3"><li>收楼成本20%。<ul><li>合同保留60%收益。</li><li>【待补：合同】</li></ul><p>总面积5000㎡。</p></li><li>第二项完整保留。</li></ol><p>后文2027年不改。</p></div>'));
    const list=blocks.find(b=>b.type==='list');assert.ok(list);assert.equal(list.start,3);assert.equal(list.ordered,true);assert.equal(list.items.length,2);
    assert.equal(list.items[0].blocks[1].type,'list');assert.equal(list.items[0].blocks[1].items.length,2);
    assert.equal(list.items[0].blocks[2].text,'总面积5000㎡。');
    assert.equal(JSON.stringify(blocks).split('合同保留60%收益。').length-1,1);
    const xml=await packageXml(blocks),items=paragraphs(xml.document).filter(p=>p.includes('<w:numPr>'));
    assert.equal(items.length,4);assert.match(items[0],/w:ilvl w:val="0"/);assert.match(items[1],/w:ilvl w:val="1"/);
    assert.match(xml.numbering,/<w:start w:val="3"/);assert.match(xml.document,/总面积5000㎡。/);assert.match(xml.document,/后文2027年不改。/);
    assert.equal(xml.document.split('合同保留60%收益。').length-1,1);
  }finally{await browser.close();}
});
