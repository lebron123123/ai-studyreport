const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
const root=path.resolve(__dirname,'..');
function provenance(){
  const context=vm.createContext({window:{ReportTrust:require('../report-trust.js')}});
  vm.runInContext(fs.readFileSync(path.join(root,'export.js'),'utf8'),context);
  return context.exportProvenance([{cn:'一',name:'总论',sections:[
    {t:'依据',content:'依据内容',prov:{confidence:{score:0.99,label:'高'},webEvidence:[{title:'[系统测试]政策依据',url:'https://example.gov.cn/policy',version:'v2',locator:'第3条'}]}},
    {t:'缺来源',content:'尚未补证'},
    {t:'空稿',content:''}
  ]}]);
}
test('Word附录不输出伪置信度，保留联网来源/版本并公开无来源状态',()=>{
  const p=provenance(),text=JSON.stringify(p);
  assert.equal(p.rows.length,3);assert.match(text,/example.gov.cn\/policy/);assert.match(text,/版本 v2/);assert.match(text,/第3条/);
  assert.match(text,/待核验/);assert.match(text,/尚未绑定可追溯来源/);assert.doesNotMatch(text,/99分|0分|置信度评级/);
});
test('真实Word包标题/目录/版本/溯源及全部表格宽度一致',async()=>{
  const template={title:'合并表头',segments:[{gridWidths:[1,2,1],rows:[{cells:[{col:0,colSpan:2,text:'金额口径'},{col:2,text:'依据'}]},{cells:[{col:0,text:'事项'},{col:1,text:'100万元'},{col:2,text:'【待补：原件】'}]}]}]};
  const doc=build(D,{project:{name:'[系统测试]Word完整性'},signed:false,docNo:'',versionNote:'关联报告版本 V3 · 工作稿修订 12',chapters:[{cn:'一',num:1,name:'总论',sections:[{title:'项目判断',blocks:[{type:'h',text:'1.1.1 判断条件'},{type:'p',text:'此为合成材料，不代表真实项目验收。'},{type:'table',rows:[['事项','金额','来源'],...Array.from({length:70},(_,i)=>['测试事项'+i,'100万元','对应原件，第'+i+'页'])]},{type:'templateTable',template}]}]}],provenance:provenance()});
  const buffer=await D.Packer.toBuffer(doc),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/关联报告版本 V3/);assert.match(xml,/Heading3/);assert.match(xml,/TOC/);assert.match(xml,/PAGEREF/);assert.match(xml,/example.gov.cn\/policy/);assert.match(xml,/尚未经过人工复核签发/);
  const tables=[...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m=>m[0]);assert.equal(tables.length,3);
  for(const table of tables){
    assert.match(table,/<w:tblW w:type="dxa" w:w="8506"\/>/);assert.match(table,/w:tblHeader/);
    const widths=[...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(m=>Number(m[1]));assert.equal(widths.reduce((s,w)=>s+w,0),8506);
    for(const row of table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)){
      const cells=[...row[0].matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/g)].map(m=>Number(m[1]));assert.equal(cells.reduce((s,w)=>s+w,0),8506);
    }
  }
  if(process.env.WORD_SMOKE_OUTPUT)fs.writeFileSync(path.resolve(process.env.WORD_SMOKE_OUTPUT),buffer);
});
