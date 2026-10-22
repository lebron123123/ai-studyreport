const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');

test('identical legacy tables ignore preceding prose but keep true captions, scope and cell differences',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  for(const file of ['report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js'])await page.addScriptTag({path:path.resolve(file)});
  const result=await page.evaluate(()=>{
   const lib={forSection:()=>[],renderTemplate:ReportTableTemplates.renderTemplate},parse=html=>new DOMParser().parseFromString(html,'text/html');
   const table='<table><tr><th>年份</th><th>租金收入（万元）</th></tr><tr><td>2023</td><td>1,350</td></tr><tr><td>2024</td><td>1,710</td></tr></table>';
   const run=(left,right)=>{
    const plan=ReportCompletionContract.createPlan([{name:'项目说明',sections:[{t:'收入分析'},{t:'运营分析'}]}]);
    const entries=[left,right].map((html,i)=>({key:plan.sections[i].sectionKey,html,context:{type:'test',number:'1.'+(i+1),chapter:'项目说明',section:i?'运营分析':'收入分析'}}));
    const once=ReportSectionLayout.composeDocument(entries,lib),again=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib),doc=parse(once.join(''));
    return {html:once.join(''),tables:doc.querySelectorAll('table').length,refs:doc.querySelectorAll('.rpt-table-reference').length,stable:JSON.stringify(once)===JSON.stringify(again),issues:ReportCompletionContract.reviewDocument(entries.map((e,i)=>({key:e.key,number:e.context.number,text:once[i]})),plan).reviews.flatMap(r=>r.issues).filter(i=>i.code.startsWith('reference-'))};
   };
   // These introductory sentences are from the real Longgang 4.2 and 5.3
   // pattern: neither is a title, and neither may disappear with the table.
   const prose=run('<p>根据本次测算结果，项目全周期（2022—2034年）主要财务表现如下：</p>'+table,'<p>基于上述参数，测算期内分年租金收入及租金单价变动情况如下表所示：</p>'+table.replaceAll('（','(').replaceAll('）',')'));
   const captions=run('<p class="rpt-table-caption">住宅收入明细表</p>'+table,'<p class="rpt-table-caption">商业收入明细表</p>'+table);
   const scopes=run('<p class="rpt-table-caption">2023年含税收入表</p>'+table,'<p class="rpt-table-caption">2024年不含税收入表</p>'+table);
   const values=run('<p>第一处说明。</p>'+table,'<p>第二处说明。</p>'+table.replace('1,710','1,711'));
   const spans=run(table,table.replace('<td>1,710','<td colspan="2">1,710'));
   const sourceTitles=run(table.replace('<table>','<table data-report-source-caption="住宅收入明细表">'),table.replace('<table>','<table data-report-source-caption="商业收入明细表">'));
   return {prose,captions,scopes,values,spans,sourceTitles};
  });
  assert.equal(result.prose.tables,1);assert.equal(result.prose.refs,1);assert.ok(result.prose.stable);assert.deepEqual(result.prose.issues,[]);
  assert.match(result.prose.html,/根据本次测算结果/);assert.match(result.prose.html,/基于上述参数/);assert.match(result.prose.html,/详见第1.1节/);
  for(const name of ['captions','scopes','values','spans','sourceTitles']){assert.equal(result[name].tables,2,name);assert.equal(result[name].refs,0,name);assert.ok(result[name].stable,name);}
 }finally{await browser.close();}
});

test('canonical financial metrics reconcile explicit units and aliases without discarding notes, distinct scopes or real conflicts',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  for(const file of ['report-table-templates.js','report-section-layout.js','export.js'])await page.addScriptTag({path:path.resolve(file)});
  const financial=require('../data/report-table-templates-gaibao-housing-v1.json').templates.find(t=>t.id==='gaibao-housing-table-11');
  const result=await page.evaluate(financial=>{
   const table=(heads,rows)=>'<table data-canonical-template="gaibao-housing-table-11">'+[heads,...rows].map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
   const parse=html=>new DOMParser().parseFromString(html,'text/html');
   const lib={forSection:()=>[financial],renderTemplate:ReportTableTemplates.renderTemplate};
   const run=(html,type='gaibao-housing')=>{
    const entries=html.map((content,i)=>({html:content,context:{type,number:i?'1.'+i:'9.3',chapter:'财务评价',section:i?'指标摘要':'财务评价'}}));
    const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib),third=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:twice[i]})),lib);
    const dom=parse(once.join('')),rows=[...dom.querySelector('figure').querySelectorAll('tr')].slice(1).map(r=>[...r.cells].map(c=>c.textContent.trim())).filter(r=>r.some(Boolean));
    return {rows,html:once.join(''),notes:dom.querySelector('[data-report-field-differences]')?.textContent||'',conflict:dom.querySelector('[data-report-conflicts]')?.textContent||'',stable:JSON.stringify(once)===JSON.stringify(twice)&&JSON.stringify(twice)===JSON.stringify(third),blocksStable:JSON.stringify(htmlToBlocks(once.join('')))===JSON.stringify(htmlToBlocks(twice.join(''))),figures:dom.querySelectorAll('figure').length,refs:dom.querySelectorAll('.rpt-table-reference').length};
   };
   // Verbatim metric spellings/notes from Longgang's frozen 1.5, 9.3 and 9.4.
   const duplicate=run([
    table(['指标','数值','备注'],[['全投资内部收益率','25.79%','基准收益率4%（LPR上浮50BP）'],['累计净现值','880.47万元','折现率6%'],['累计净现金流回正年份','2028年（第7年）','含建设期']]),
    table(['指标名称','单位','测算值','口径说明','基准/目标'],[['全投资内部收益率IRR','%','25.79','全周期','≥5'],['累计净现值','万元','880.470','2022—2034年合计',''],['累计净现金流回正年份','年','2028','运营期第6年','']]),
    table(['指标名称','单位','数值','备注','基准/目标'],[['全投资内部收益率（IRR）','—','25.79%','全周期口径','≥5%'],['累计净现金流回正年份','—','2028年（第7年）','回正金额44.17万元','']])
   ]);
   const safety=[];
   for(const type of ['gaibao-housing','gaibao-commercial','rent','sale']){
    safety.push({type,...run([
     table(['指标','单位','数值','备注'],[['全投资内部收益率','%','25.79','折现率6%'],['总成本费用','万元','18444','含收楼、工程、运营、财务费用'],['投资回收期','年','7','含建设期'],['投资回收期（含改造期）','年','约6',''],['租金收入下降5%时IRR','%','22',''],['独有指标','万元','100','【待补：审定造价金额及批复文件】']]),
     table(['指标','单位','数值','口径说明','批准文号'],[['全投资内部收益率IRR','%','24.50','折现率5%',''],['全周期总成本费用','万元','18,444','含收楼成本、工程费用、运营费用、财务费用','深字123号'],['税金及附加合计','万元','1163.75','全周期',''],['税金及附加','万元','1163.75','全周期合计',''],['独有指标','元','100','不得假定为万元','']])
    ],type)});
   }
   const scopes=run([
    table(['指标','单位','数值','口径说明'],[['全投资内部收益率','%','10','2025—2026年税前'],['单位不明的净现值','','100',''],['累计净现值','万元','100','']]),
    table(['指标','单位','数值','备注'],[['全投资内部收益率','%','10','2027—2028年税后'],['单位不明的净现值','万元','100',''],['单位不明的净现值','元','100',''],['累计净现值','万元','100元','单位记载存在冲突']])
   ]);
   return {duplicate,safety,scopes};
  },financial);
  assert.equal(result.duplicate.rows.length,3,'three real metrics, not separate rows for unit/remark spellings');
  assert.equal(result.duplicate.conflict,'','complementary remarks and explicit unit spellings are not numeric conflicts');
  assert.equal(result.duplicate.figures,1);assert.equal(result.duplicate.refs,2);
  for(const fact of ['基准收益率4%（LPR上浮50BP）','折现率6%','2022—2034年合计','含建设期','（第7年）','运营期第6年','回正金额44.17万元'])assert.ok(result.duplicate.notes.includes(fact),fact);
  assert.ok(result.duplicate.stable&&result.duplicate.blocksStable);
  for(const item of result.safety){
   assert.equal(item.rows.filter(r=>r[0]==='总成本费用').length,1,item.type);
   assert.equal(item.rows.filter(r=>r[0]==='税金及附加').length,1,item.type);
   for(const fact of ['24.50','折现率','6%','5%'])assert.ok(item.conflict.includes(fact),item.type+': '+fact);
   assert.ok(item.rows.some(r=>r[0]==='投资回收期'&&r[2]==='7'));
   assert.ok(item.rows.some(r=>r[0]==='投资回收期（含改造期）'&&r[2]==='约6'));
   assert.ok(item.rows.some(r=>r[0]==='租金收入下降5%时IRR'));
   for(const fact of ['审定造价金额及批复文件','深字123号','含收楼、工程、运营、财务费用','含收楼成本、工程费用、运营费用、财务费用'])assert.ok(item.html.includes(fact),item.type+': '+fact);
   assert.equal(item.rows.filter(r=>r[0]==='独有指标').length,2,'different units never converted implicitly');
   assert.ok(item.stable&&item.blocksStable,item.type+' repeated composition');
  }
  assert.equal(result.scopes.rows.filter(r=>r[0]==='全投资内部收益率').length,2,'different tax/period scopes cannot be merged');
  assert.equal(result.scopes.rows.filter(r=>r[0]==='单位不明的净现值').length,3,'ambiguous missing unit cannot be inferred');
  assert.match(result.scopes.conflict,/单位/);assert.match(result.scopes.conflict,/100元/);
  assert.ok(result.scopes.stable&&result.scopes.blocksStable);
 }finally{await browser.close();}
});

test('real Longgang candidate fragments retain specific evidence gaps and paragraph-wrapped references are idempotent',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  for(const file of ['report-table-templates.js','report-section-layout.js','export.js'])await page.addScriptTag({path:path.resolve(file)});
  const condition=require('../data/report-table-templates-gaibao-housing-v1.json').templates.find(t=>t.id==='gaibao-housing-table-03');
  const result=await page.evaluate(condition=>{
   // Minimal verbatim table fragments from the frozen Longgang candidate. No
   // external snapshot file is required by this regression or changed by it.
   const gaps=['【待补：建筑结构安全鉴定报告】','【待补：消防检测报告及消防审批文件】','【待补：保障性租赁住房建设标准符合性核查文件】','【待补：保障性租赁住房项目认定书】'];
   const legal='<table class="rpt"><tbody><tr><th>序号</th><th>法定改建条件</th><th>本项目符合情况</th></tr><tr><td>6</td><td>建筑结构安全满足居住要求</td><td>'+gaps[0]+'</td></tr><tr><td>7</td><td>消防安全满足住宅类规范要求</td><td>'+gaps[1]+'</td></tr><tr><td>8</td><td>符合保障性租赁住房建设标准</td><td>'+gaps[2]+'</td></tr><tr><td>9</td><td>纳入保障性租赁住房项目认定</td><td>'+gaps[3]+'</td></tr></tbody></table>';
   const cash='<table class="rpt"><tbody><tr><th>年份</th><th>现金流入（万元）</th><th>现金流出（万元）</th><th>净现金流量（万元）</th><th>累计净现金流量（万元）</th></tr><tr><td>2022</td><td>0</td><td>127.2</td><td>-127.2</td><td>-127.2</td></tr><tr><td>2023</td><td>1,350</td><td>1,605.36</td><td>-255.36</td><td>-382.56</td></tr></tbody></table>';
   const entries=[
    {html:legal,context:{type:'gaibao-housing',number:'1.3',chapter:'项目总论',section:'项目本体情况、改造情况与政策符合性'}},
    {html:cash,context:{type:'gaibao-housing',number:'5.3',chapter:'建设方案',section:'改造费用'}},
    {html:'<p style="margin:0 0 10px;">具体数据见表10.1-2。</p><p style="margin:0 0 10px;">'+cash+'</p><p style="margin:0 0 10px;">注：表中数据为本次内置公式测算结果，统计期为2022—2034年，范围为全投资口径现金流量，单位为万元。</p>',context:{type:'gaibao-housing',number:'10.1',chapter:'社会效益评价',section:'社会效益评价'}}
   ];
   const lib={forSection:(_type,_chapter,section)=>section.includes('政策符合性')?[condition]:[],renderTemplate:ReportTableTemplates.renderTemplate};
   const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib),third=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:twice[i]})),lib);
   const parse=html=>new DOMParser().parseFromString(html,'text/html'),dom=parse(once.join(''));
   const figure=dom.querySelector('[data-template-id="'+condition.id+'"]');
   const legalRows=[...figure.querySelectorAll('tr')].map(r=>[...r.cells].map(c=>c.textContent.trim()));
   const secondSource=legal.replace(gaps[0],'安全鉴定已完成，待人工审签');
   const conflicted=ReportSectionLayout.composeDocument([entries[0],{...entries[0],html:secondSource,context:{...entries[0].context,number:'2.1'}}],lib);
   const conflict=parse(conflicted.join('')).querySelector('[data-report-conflicts]');
   return {same:JSON.stringify(once)===JSON.stringify(twice)&&JSON.stringify(twice)===JSON.stringify(third),gaps,legalRows,html:once.join(''),refs:[...dom.querySelectorAll('.rpt-table-reference')].map(n=>n.textContent),cashTables:[...dom.querySelectorAll('table')].filter(t=>t.textContent.includes('累计净现金流量')).length,conflict:conflict?.textContent,prose:parse(once[2]).body.textContent,blocksStable:JSON.stringify(htmlToBlocks(once.join('')))===JSON.stringify(htmlToBlocks(twice.join('')))};
  },condition);
  assert.equal(result.same,true,'old candidate structure must be stable after first planning');
  assert.equal(result.blocksStable,true,'preview and repeat export must consume identical blocks');
  assert.equal(result.cashTables,1);assert.deepEqual(result.refs,['详见第5.3节“相关明细表”。']);
  for(const gap of result.gaps)assert.ok(result.legalRows.some(row=>row.includes(gap)),'specific missing-evidence request must remain in a table: '+gap);
  assert.match(result.conflict,/建筑结构安全鉴定报告/);assert.match(result.conflict,/安全鉴定已完成/);
  assert.match(result.prose,/具体数据见表10.1-2/);assert.match(result.prose,/2022—2034年/);
  assert.doesNotMatch(result.html,/<p[^>]*>\s*<p\b/,'replacement must not introduce invalid nested paragraphs');
 }finally{await browser.close();}
});

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
   const first=JSON.stringify(once),second=JSON.stringify(twice),diff=[...first].findIndex((c,i)=>c!==second[i]);
   return {same:first===second,diff:[first.slice(Math.max(0,diff-100),diff+500),second.slice(Math.max(0,diff-100),diff+500)],ids:[...dom.querySelectorAll('figure')].map(x=>x.dataset.templateId),beforeRows,refs:[...dom.querySelectorAll('.rpt-table-reference')].map(x=>x.textContent),text:dom.body.textContent,raw:dom.querySelectorAll('table:not(figure table)').length};
  });
  assert.equal(output.same,true,JSON.stringify(output.diff));assert.equal(new Set(output.ids).size,output.ids.length);assert.equal(output.ids.length,2,'optional templates without source facts must not expand the report');
  assert.equal(output.beforeRows.find(r=>r[0]==='三房')[1],'','partial 3-bedroom site count must not be labelled as complete aggregate');
  assert.deepEqual(output.beforeRows.find(r=>r[0]==='合计'),['合计','10','1004.39']);
  assert.match(output.text,/21750.94/);assert.match(output.text,/万元/);assert.ok(output.refs.some(t=>t.includes('9.3')));assert.ok(output.raw>=1);
  assert.match(output.text,/甲小区/);assert.match(output.text,/乙小区/);assert.match(output.text,/419.63/);assert.match(output.text,/584.76/);
 }finally{await browser.close();}
});

test('shared table plan preserves scopes and facts, flags conflicts and stays stable through preview/export',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  for(const file of ['report-table-templates.js','report-section-layout.js','export.js'])await page.addScriptTag({path:path.resolve(file)});
  const result=await page.evaluate(()=>{
   const failures=[];
   const template=(id,headers,required=false)=>({id,title:id,required,segments:[{rows:[{cells:headers.map((text,col)=>({text,col,role:'static'}))},...Array.from({length:2},()=>({cells:headers.map((_,col)=>({text:'',col,role:'value'}))}))]}]});
   const table=(id,headers,rows,caption='')=>(caption?'<p class="rpt-table-caption">'+caption+'</p>':'')+'<table'+(id?' data-canonical-template="'+id+'"':'')+'>'+[headers,...rows].map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
   const parse=html=>new DOMParser().parseFromString(html,'text/html');
   const run=(type,templates,html)=>{
    const lib={forSection:()=>templates,renderTemplate:ReportTableTemplates.renderTemplate};
    const entries=html.map((content,i)=>({html:content,context:{type,number:'1.'+(i+1),chapter:'总论',section:'小节'+i}}));
    const once=ReportSectionLayout.composeDocument(entries,lib),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),lib);
    if(JSON.stringify(once)!==JSON.stringify(twice))failures.push(type+': non-idempotent '+templates[0]?.id);
    return {html:once.join(''),dom:parse(once.join(''))};
   };
   for(const type of ['gaibao-housing','gaibao-commercial','rent','sale']){
    const id=type+'-shared-register',t=template(id,['对象','金额（万元）']);
    const same=table(id,['对象','金额（万元）'],[['A','100'],['B','200']]);
    const duplicate=run(type,[t],[same,same]);
    if(duplicate.dom.querySelectorAll('table').length!==1||duplicate.dom.querySelectorAll('.rpt-table-reference').length!==1)failures.push(type+': duplicate whole table returned');
    const units=run(type,[t],[same,table(id,['对象','金额（元）'],[['A','100']])]);
    if(units.dom.querySelectorAll('table').length!==2||!units.html.includes('金额（元）'))failures.push(type+': unit mismatch merged');
    const periods=run(type,[t],[table(id,['对象','金额（万元）'],[['A','100']],'2025年含税金额表'),table(id,['对象','金额（万元）'],[['A','100']],'2026年不含税金额表'),table(id,['对象','金额（万元）'],[['A','100']],'2027年不含税金额表')]);
    if(periods.dom.querySelectorAll('table').length!==3||!periods.dom.body.textContent.includes('2025年含税金额表')||!periods.dom.body.textContent.includes('2026年不含税金额表')||!periods.dom.body.textContent.includes('2027年不含税金额表'))failures.push(type+': date/accounting scope lost');
    const conflict=run(type,[t],[same,table(id,['对象','金额（万元）'],[['A','150'],['C','300']])]);
    const warning=conflict.dom.querySelector('[data-report-conflicts]');
    if(!warning||!warning.textContent.includes('150')||!warning.textContent.includes('1.2')||!conflict.html.includes('300'))failures.push(type+': conflict or unique object lost');
    if(conflict.dom.querySelector('figure').textContent.includes('100；150'))failures.push(type+': conflicts silently concatenated');
    const extra=run(type,[t],[table(id,['对象','金额（万元）','批准文号'],[['A','100','深字123号']]),table(id,['对象','金额（万元）','批准文号'],[['A','100','深字123号']])]);
    const main=extra.dom.querySelector('figure');
    if(!extra.html.includes('批准文号：深字123号')||extra.dom.querySelectorAll('table').length!==2||!main)failures.push(type+': unmatched fact not kept once as a field difference');
    const byPeriod=template(id,['对象','统计期','金额（万元）']);
    const periodsInRows=run(type,[byPeriod],[table(id,['对象','统计期','金额（万元）'],[['A','2025','100']]),table(id,['对象','统计期','金额（万元）'],[['A','2026','150']])]);
    if(periodsInRows.dom.querySelector('[data-report-conflicts]')||!periodsInRows.html.includes('2025')||!periodsInRows.html.includes('2026'))failures.push(type+': row period mapped to wrong object');
    const serial=template(id,['序号','对象','金额（万元）']);
    const serials=run(type,[serial],[table(id,['序号','对象','金额（万元）'],[['1','甲','100']]),table(id,['序号','对象','金额（万元）'],[['1','乙','200']])]);
    if(serials.dom.querySelector('[data-report-conflicts]')||!serials.dom.querySelector('figure').textContent.includes('乙'))failures.push(type+': row numbers mistaken for business objects');
    const ambiguous=run(type,[t],[table(id,['对象','建筑面积（㎡）','项目面积'],[['甲','100','80']])]);
    if(!ambiguous.dom.body.textContent.includes('100')||!ambiguous.dom.body.textContent.includes('80')||ambiguous.dom.querySelectorAll('table').length!==1)failures.push(type+': ambiguous aliases dropped a column');
   }
   const required=template('required-register',['对象','值'],true),optional=template('optional-register',['对象','值']);
   const presence=run('rent',[required,optional],['<p>尚无项目数据。</p>']);
   if(presence.dom.querySelectorAll('figure').length!==1||!presence.dom.querySelector('[data-template-id="required-register"]'))failures.push('required/optional contract');
   const rentTemplates=['20','21','22','23'].map(id=>template('gaibao-housing-table-'+id,['地域','统计期','成交租金']));
   const rents=run('gaibao-housing',rentTemplates,[rentTemplates.map(t=>table(t.id,['地域','统计期','成交租金'],[['市区','2026','60']])).join('')]);
   if(rents.dom.querySelectorAll('figure').length!==4)failures.push('distinct rent series merged');
   const condition=template('gaibao-housing-table-03',['序号','法定改建条件','符合情况']);
   const conditions=table(condition.id,['序号','法定改建条件','符合情况'],[['1','权属清晰且无争议','符合'],['2','无查封及抵押限制','待核实']]);
   const cond=run('gaibao-housing',[condition],[conditions,conditions]);
   if(cond.dom.querySelectorAll('table').length!==1||!cond.html.includes('无查封及抵押限制'))failures.push('condition labels caused whole-table supplement');
   const sensitivity=run('rent',[],[table('', ['敏感因素','波动幅度','IRR','说明'],[['租金','-20%','8.0%','真实来源甲']],'敏感性分析表'),table('', ['变动因素','变动幅度','IRR','NPV（万元）','审核结论'],[['租金','-20%','9.0%','100','仍待审批']],'敏感性分析表')]);
   // Different explicit-unit schemas remain separate; neither unrecognised fields nor the conflict may disappear.
   if(!sensitivity.dom.body.textContent.includes('真实来源甲')||!sensitivity.dom.body.textContent.includes('仍待审批')||!sensitivity.dom.body.textContent.includes('9.0%'))failures.push('sensitivity unknown fields lost');
   const sameSensitivity=run('rent',[],[table('', ['敏感因素','波动幅度','IRR','说明'],[['租金','-20%','8.0%','真实来源甲']],'敏感性分析表'),table('', ['变动因素','变动幅度','IRR','审核结论'],[['租金','-20%','9.0%','仍待审批']],'敏感性分析表')]);
   if(!sameSensitivity.dom.querySelector('[data-report-conflicts]')||!sameSensitivity.dom.body.textContent.includes('真实来源甲')||!sameSensitivity.dom.body.textContent.includes('仍待审批'))failures.push('sensitivity safe union/conflict missing');
   // The downstream exporter consumes the already planned HTML repeatedly.
   window.reportTableProjectType=()=> 'gaibao-housing';
   ReportTableTemplates.exportTemplate=()=>JSON.parse(JSON.stringify(condition));
   const blocks=htmlToBlocks(cond.html),again=htmlToBlocks(cond.html);
   if(JSON.stringify(blocks)!==JSON.stringify(again))failures.push('preview/export composition changed facts');
   return {failures,blocks};
  });
  assert.deepEqual(result.failures,[]);
  const docx=require('../docx.umd.js'),build=require('../docxgen.js');
  const buffer=await docx.Packer.toBuffer(build(docx,{project:{name:'[系统测试]跨节表格安全归并'},chapters:[{cn:'一',num:1,name:'总论',sections:[{num:1,title:'项目条件',blocks:result.blocks}]}]}));
  const zip=await require('../local-server/node_modules/jszip').loadAsync(buffer);
  const xml=await zip.file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,1,'Word must consume only the one owned main table');
  assert.match(xml,/无查封及抵押限制/);assert.match(xml,/待核实/);
 }finally{await browser.close();}
});
