const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../docx.umd.js');
const build=require('../docxgen.js');
const JSZip=require('../local-server/node_modules/jszip');

const paragraphs=xml=>[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);
const tables=xml=>[...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m=>m[0]);
const keepNext=/<w:keepNext(?:\s+w:val="(?:true|1)")?\s*\/>/;
const ordinaryTable={type:'table',rows:[['投资费用项目','单位','测算金额'],['工程费用合计','万元','480.0012'],['其他投资费用','万元','【待补：批准总投资】']]};
const templateTable={type:'templateTable',template:{title:'财务测算标准表',segments:[{gridWidths:[1,1],rows:[{cells:[{col:0,text:'项目'},{col:1,text:'金额'}]},{cells:[{col:0,text:'工程费用'},{col:1,text:'480.0012'}]}]}]}};

async function packageXml(blocks,extra={}){
  const payload={project:{name:'[系统测试]标题表名分页'},documentDate:'2026-10-13',chapters:[{num:9,cn:'九',name:'财务评价',sections:[{num:4,title:'不确定性分析',blocks}]}],...extra};
  const before=JSON.stringify(payload);
  const zip=await JSZip.loadAsync(await D.Packer.toBuffer(build(D,payload)));
  assert.equal(JSON.stringify(payload),before,'export never mutates the saved source blocks or values');
  return {document:await zip.file('word/document.xml').async('string'),styles:await zip.file('word/styles.xml').async('string')};
}

test('all business heading levels stay with following content, not just inline subheadings',async()=>{
  const {document,styles}=await packageXml([...Array.from({length:4},(_,i)=>({type:'h',level:i+3,text:'分类标题'+(i+3)})),{type:'p',text:'业务分析正文，不得因分页修改。'}]);
  const headingParagraphs=paragraphs(document).filter(p=>/<w:pStyle w:val="Heading[1-6]"/.test(p));
  assert.equal(headingParagraphs.length,6);
  headingParagraphs.forEach(p=>assert.match(p,keepNext));
  for(let level=1;level<=6;level++){
    const style=[...styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)].map(m=>m[0]).find(s=>s.includes('w:styleId="Heading'+level+'"'));
    assert.match(style,keepNext,'the heading style also keeps headings added by Word together');
  }
  const body=paragraphs(document).find(p=>p.includes('业务分析正文'));
  assert.doesNotMatch(body,/<w:keepNext|<w:keepLines|<w:pageBreakBefore/);
  assert.match(document,/9.4/);
  assert.match(document,/<w:pgSz w:w="11906" w:h="16838"/);
  assert.match(document,/<w:pgMar w:top="1440" w:right="1700" w:bottom="1440" w:left="1700"/);
});

test('legacy plain table captions keep their original styling and follow the table first row only',async()=>{
  for(const text of ['投资估算表','投资估算表（单位：万元）','表8-1 投资构成']){
    const withTable=await packageXml([{type:'p',text},ordinaryTable]);
    const plain=await packageXml([{type:'p',text}]);
    const caption=paragraphs(withTable.document).find(p=>p.includes(text));
    assert.match(caption,keepNext);
    assert.equal(caption.replace(keepNext,''),paragraphs(plain.document).find(p=>p.includes(text)),'only keepNext changes: no new bold, alignment, size or indent');
    assert.match(withTable.document,new RegExp(caption.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'<w:tbl>'),'nothing is inserted between caption and table');
    assert.equal(tables(withTable.document)[0],tables((await packageXml([ordinaryTable])).document)[0],'table rows/cells/values remain byte-identical');
    assert.doesNotMatch(tables(withTable.document)[0],/<w:keepNext|<w:keepLines|<w:pageBreakBefore/,'no row chain makes the whole table inseparable');
  }
});

test('table labels repaired from TABLE markers get the same pagination rule without changing their data',async()=>{
  const {document}=await packageXml([{type:'p',text:'投资估算表\n[[TABLE]]\n项目|金额\n工程费用|480.0012\n其他费用|【待补：批准总投资】\n[[/TABLE]]'}]);
  assert.match(paragraphs(document).find(p=>p.includes('投资估算表')),keepNext);
  assert.equal(tables(document).length,1);
  assert.match(tables(document)[0],/480.0012/);
  assert.match(tables(document)[0],/【待补：批准总投资】/);
  assert.doesNotMatch(tables(document)[0],/<w:keepNext/);
});

test('ordinary prose, lists, notes and isolated table names are not bound into long page blocks',async()=>{
  const cases=['详见投资估算表','参见投资估算表','投资估算表如下。','说明：应补充投资估算表','长篇分析'.repeat(25)+'表','本段第一行\n投资估算表'];
  for(const text of cases){
    const {document}=await packageXml([{type:'p',text},ordinaryTable]);
    const beforeTable=document.slice(0,document.indexOf('<w:tbl>'));
    const p=paragraphs(beforeTable).at(-1);
    assert.doesNotMatch(p,/<w:keepNext|<w:keepLines/);
  }
  const {document,styles}=await packageXml([{type:'p',text:'投资估算表'},{type:'p',text:'不是紧邻表格的标题。'},{type:'list',ordered:true,items:['普通条款一。','普通条款二。']},ordinaryTable]);
  for(const p of paragraphs(document).filter(p=>p.includes('投资估算表')||p.includes('普通条款')||p.includes('不是紧邻')))
    assert.doesNotMatch(p,/<w:keepNext|<w:keepLines/);
  assert.doesNotMatch(styles.match(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/)[0],/<w:keepNext|<w:keepLines/);
});

test('explicit and template captions, long tables and appendices retain bounded pagination',async()=>{
  const longTable={type:'table',rows:[ordinaryTable.rows[0],...Array.from({length:80},(_,i)=>['费用'+i,'万元',String(i)])]};
  const {document}=await packageXml([{type:'tableCaption',text:'投资费用分类明细'},longTable,templateTable],{includeAppendices:true,appendix:{mainRows:ordinaryTable.rows,sensRows:ordinaryTable.rows}});
  for(const title of ['投资费用分类明细','财务测算标准表','附表二'])assert.match(paragraphs(document).find(p=>p.includes(title)),keepNext);
  for(const table of tables(document)){
    assert.doesNotMatch(table,/<w:keepNext|<w:keepLines|<w:pageBreakBefore|<w:trHeight/);
    const rows=[...table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
    assert.match(rows[0],/<w:tblHeader\s*\/>/);
    rows.forEach(row=>assert.match(row,/<w:cantSplit\s*\/>/));
  }
  assert.equal((tables(document)[0].match(/<w:tr>/g)||[]).length,81);
});
