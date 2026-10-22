const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const report=fs.readFileSync(path.resolve('report.js'),'utf8');
const sourceFunction=report.slice(report.indexOf('function blocksToSource(htmlStr){'),report.indexOf('\nasync function reviseSection(',report.indexOf('function blocksToSource(htmlStr){')));

test('真实模板编辑值经源格式、候选采纳、预览与Word仍完整保留',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage(),baseline=JSON.parse(fs.readFileSync(path.resolve('data/report-table-templates-gaibao-housing-v1.json'),'utf8'));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://report-test.invalid/');
  await page.evaluate(base=>{window.fetch=async url=>({ok:true,json:async()=>String(url).startsWith('data/')?base:{ok:true,config:null}});},baseline);
  for(const file of ['md.js','report-output-policy.js','report-table-templates.js','report-section-layout.js','export.js','report-completion-contract.js','project-workflow.js'])await page.addScriptTag({path:path.resolve(file)});
  await page.addScriptTag({content:sourceFunction});
  const result=await page.evaluate(async()=>{
   await ReportTableTemplates.load('gaibao-housing');window.reportTableProjectType=()=> 'gaibao-housing';
   const template=ReportTableTemplates.exportTemplate('gaibao-housing-table-11','gaibao-housing');
   const dom=new DOMParser().parseFromString(ReportTableTemplates.renderTemplate(template),'text/html');
   const values=['全投资内部收益率（IRR）','%','11.08223','实际净现值','万元','3630.37001'];
   [1,2].forEach((row,i)=>dom.querySelectorAll('[data-row="'+row+'"]').forEach((cell,j)=>{cell.textContent=values[i*3+j];}));
   const html='<p>人工确认基准。</p>'+dom.body.innerHTML,source=blocksToSource(html);
   const contract={version:ReportCompletionContract.VERSION,planId:'template-roundtrip',sectionKey:'财务分析 / 盈利能力',requirements:{proseTarget:100,proseMax:1000,tableMax:2,tableRowsMax:20,tableCharsMax:2000,cellCharsMax:180},requiredTables:[{title:'财务评价指标表',terms:['IRR']}]};
   const section={t:'盈利能力',content:'旧源正文',editedHtml:html,completionContract:contract};
   const candidate=ProjectWorkflow.setCandidate(section,source+'\n\n仅补充审签说明。','精简');
   const accepted=ProjectWorkflow.acceptCandidate(section);
   const entries=[{html:MD.renderHtml(ReportOutputPolicy.normalize(section.content)),context:{type:'gaibao-housing',chapter:'财务分析',section:'盈利能力',number:'9.1'}}];
   const once=ReportSectionLayout.composeDocument(entries,ReportTableTemplates),twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:once[i]})),ReportTableTemplates);
   const blocks=htmlToBlocks(once[0]);
   const output={source,status:candidate.quality.status,accepted:!!accepted,editedHtml:section.editedHtml,preview:once[0],same:JSON.stringify(once)===JSON.stringify(twice),blocks,before:section.undoStack?.[0]?.editedHtml};
   ProjectWorkflow.undoSection(section);output.undoRestored=section.editedHtml===html;
   return output;
  });
  assert.equal(result.accepted,true,result.status);assert.equal(result.editedHtml,null);assert.equal(result.same,true);assert.equal(result.undoRestored,true);
  for(const value of ['11.08223','3630.37001','实际净现值','万元']){assert.ok(result.source.includes(value));assert.ok(result.preview.includes(value));assert.ok(result.before.includes(value));}
  const D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
  const bytes=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]模板编辑值保留'},chapters:[{cn:'一',num:1,name:'财务分析',sections:[{num:1,title:'盈利能力',blocks:result.blocks}]}]}));
  const xml=await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
  assert.match(xml,/11\.08223/);assert.match(xml,/3630\.37001/);assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);
 }finally{await browser.close();}
});

test('合并单元格、续表、空值、零值与特殊单元格原文不被删除或错列',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage();
  for(const file of ['md.js','report-table-templates.js','export.js'])await page.addScriptTag({path:path.resolve(file)});
  await page.addScriptTag({content:sourceFunction});
  const result=await page.evaluate(()=>{
   const template={id:'merged-test',title:'租金分期表（万元）',segments:[{rows:[{cells:[{col:0,text:'对象',vMerge:'restart'},{col:1,text:'2026年',colSpan:2}]},{cells:[{col:0,text:'',vMerge:'continue'},{col:1,text:'收入'},{col:2,text:'成本'}]},{cells:[{col:0,text:'甲'},{col:1,text:'0'},{col:2,text:''}]}]},{rows:[{cells:[{col:0,text:'对象'},{col:1,text:'取值'}]},{cells:[{col:0,text:'乙'},{col:1,text:'A|B\n第二行'}]}]}]};
   window.reportTableProjectType=()=> 'rent';ReportTableTemplates.exportTemplate=()=>structuredClone(template);
   const html=ReportTableTemplates.renderTemplate(template),source=blocksToSource(html),blocks=MD.parseBlocks(source),tables=blocks.filter(b=>b.type==='table');
   return {source,tables,html:MD.renderHtml(source),template};
  });
  assert.equal(result.tables.length,2);assert.deepEqual(result.tables[0].rows[1],['对象','收入','成本']);assert.deepEqual(result.tables[0].rows[2],['甲','0','']);
  assert.equal(result.tables[1].rows[1].length,2);assert.match(result.source,/租金分期表（万元）（续表1）/);assert.match(result.source,/单元格原文/);assert.ok(result.source.includes('A|B\n第二行'));assert.match(result.html,/A\|B/);
 }finally{await browser.close();}
});
