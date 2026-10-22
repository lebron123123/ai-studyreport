const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');

test('风险表按类别和描述识别对象：不同风险不制造冲突，同风险真实差异完整保留',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();for(const f of ['report-table-templates.js','report-section-layout.js','export.js'])await page.addScriptTag({path:path.resolve(f)});
  const template=require('../data/report-table-templates-gaibao-housing-v1.json').templates.find(t=>t.id==='gaibao-housing-table-13');
  const result=await page.evaluate(template=>{
   const heads=['风险类别','风险描述','发生概率','影响程度','应对措施','责任单位','监测节点'];
   const table=rows=>'<table data-canonical-template="'+template.id+'">'+[heads,...rows].map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
   const a=['市场风险','改造后租赁需求波动导致出租率不及预期','中','高','建立意向租户储备库','运营单位','每季度'];
   const b=['市场风险','周边竞品集中入市加剧竞争','较高','中','建立竞品动态监测机制','运营单位','每月'];
   const c=['市场风险','改造后租赁需求波动导致出租率不及预期','低','高','明确风险分担条款','运营单位','每季度'];
   const emptyA=['其他风险','','中','低','待确认具体事项甲','运营单位','每月'];
   const emptyB=['其他风险','','高','高','待确认具体事项乙','运营单位','每月'];
   const run=rows=>{
    const entries=rows.map((r,i)=>({key:'风险分析 / 风险'+i,html:table(r),context:{type:'gaibao-housing',number:'11.'+(i+1),chapter:'风险分析',section:'风险'+i}}));
    const lib={forSection:()=>[template],renderTemplate:ReportTableTemplates.renderTemplate};
    const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib);
    const dom=new DOMParser().parseFromString(once.join(''),'text/html'),figure=dom.querySelector('figure[data-template-id="'+template.id+'"]');
    return {html:once.join(''),rows:[...figure.querySelectorAll('tr')].slice(1).map(r=>[...r.cells].map(c=>c.textContent.trim())).filter(r=>r.some(v=>v&&!/^【待补/.test(v))),conflicts:[...dom.querySelectorAll('[data-report-conflicts] tr')].slice(1).map(r=>[...r.cells].map(c=>c.textContent.trim())),stable:JSON.stringify(once)===JSON.stringify(twice),blocksStable:JSON.stringify(once.map(htmlToBlocks))===JSON.stringify(twice.map(htmlToBlocks)),refs:dom.querySelectorAll('.rpt-table-reference').length};
   };
   return {distinct:run([[a,b],[b]]),conflict:run([[a,b],[c]]),missing:run([[emptyA],[emptyB]])};
  },template);
  assert.equal(result.distinct.rows.length,2);assert.deepEqual(result.distinct.conflicts,[]);assert.equal(result.distinct.refs,1);
  for(const value of ['改造后租赁需求波动导致出租率不及预期','周边竞品集中入市加剧竞争','建立意向租户储备库','建立竞品动态监测机制'])assert.ok(result.distinct.html.includes(value),value);
  assert.equal(result.conflict.rows.length,2);assert.equal(result.conflict.conflicts.length,2);
  assert.deepEqual(result.conflict.conflicts.map(r=>r[2]),['发生概率','应对措施']);
  assert.ok(result.conflict.conflicts.every(r=>r[1]==='市场风险：改造后租赁需求波动导致出租率不及预期'));
  assert.ok(result.conflict.conflicts.some(r=>r[3]==='中'&&r[4]==='低'));
  assert.ok(result.conflict.conflicts.some(r=>r[3]==='建立意向租户储备库'&&r[4]==='明确风险分担条款'));
  assert.equal(result.missing.rows.length,2);assert.deepEqual(result.missing.conflicts,[],'absent risk identity is not evidence of conflicting values');
  for(const item of Object.values(result)){assert.ok(item.stable,'compose must be idempotent');assert.ok(item.blocksStable,'Word blocks must match repeated composition');}
 }finally{await browser.close();}
});
