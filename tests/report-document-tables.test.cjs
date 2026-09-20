const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
test('document plan owns each table once, preserves distinct rent series and cannot misaggregate site rows',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  await page.addScriptTag({path:path.resolve('report-table-templates.js')});
  await page.addScriptTag({path:path.resolve('report-section-layout.js')});
  const output=await page.evaluate(()=>{
   const template=(n,title,headers,labels)=>({id:'gaibao-housing-table-'+n,title,segments:[{rows:[{cells:headers.map((text,col)=>({text,col,role:'static'}))},...Array.from({length:4},(_,i)=>({cells:headers.map((_,col)=>({col,text:col===0&&labels?labels[i]||'':'',role:col===0&&labels?'static':'value'}))}))]}]});
   const finance=template('11','财务评价指标表',['指标名称','单位','测算值']);
   const before=template('02','改造前户型及物业现状表',['房型','套数（套）','建筑面积（㎡）'],['单间','一房','三房','合计']);
   const after={...before,id:'gaibao-housing-table-04',title:'改造后户型及房源表'};
   const rents=['20','21','22','23'].map(n=>template(n,'历史租金'+n,['地域','统计期','成交租金']));
   const all=[finance,before,after,...rents];
   const lib={forSection:()=>all,renderTemplate:ReportTableTemplates.renderTemplate};
   const table=(headers,rows)=>'<table>'+[headers,...rows].map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
   const f=table(['项目','数值'],[['全周期总收入（万元）','21750.94'],['全投资内部收益率（IRR）','25.79%']]);
   const b='<p>改造前户型及物业现状表</p>'+table(['项目名称','房型','套数（套）','建筑面积（㎡）'],[['甲小区','三房','3','419.63'],['乙小区','三房/一房','7','584.76'],['合计','—','10','1004.39']]);
   const entries=[{context:{type:'gaibao-housing',number:'1.3',section:'本体',chapter:'总论'},html:b+f},{context:{type:'gaibao-housing',number:'9.3',section:'财务评价',chapter:'财务'},html:f}];
   const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib);
   const dom=new DOMParser().parseFromString(once.join(''),'text/html');
   const beforeRows=[...dom.querySelector('[data-template-id$="-02"]').querySelectorAll('tr')].map(r=>[...r.cells].map(c=>c.textContent.trim()));
   return {same:JSON.stringify(once)===JSON.stringify(twice),ids:[...dom.querySelectorAll('figure')].map(x=>x.dataset.templateId),beforeRows,refs:[...dom.querySelectorAll('.rpt-table-reference')].map(x=>x.textContent),text:dom.body.textContent,raw:dom.querySelectorAll('table:not(figure table)').length};
  });
  assert.equal(output.same,true);assert.equal(new Set(output.ids).size,output.ids.length);assert.equal(output.ids.length,7);
  assert.equal(output.beforeRows.find(r=>r[0]==='三房')[1],'','partial 3-bedroom site count must not be labelled as complete aggregate');
  assert.deepEqual(output.beforeRows.find(r=>r[0]==='合计'),['合计','10','1004.39']);
  assert.match(output.text,/21750.94/);assert.match(output.text,/万元/);assert.ok(output.refs.some(t=>t.includes('9.3')));assert.equal(output.raw,0);
 }finally{await browser.close();}
});
