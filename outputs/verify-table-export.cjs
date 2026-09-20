const fs=require('node:fs');
const {Client}=require('../local-server/node_modules/pg');
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();let row,config;
 try{row=(await db.query('SELECT id,name,data,updated_at FROM projects WHERE id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];config=(await db.query("SELECT version,status,overrides FROM report_table_template_versions WHERE project_type=$1 AND status='published' ORDER BY version DESC LIMIT 1",['gaibao-housing'])).rows[0];}finally{await db.end();}
 const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();
 await page.route('**/api/reporttables?projectType=gaibao-housing',r=>r.fulfill({json:{ok:true,config:config||null}}));
 await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ReportSectionLayout?.composeDocument&&window.MD);
 const result=await page.evaluate(async data=>{
 await ReportTableTemplates.load('gaibao-housing');
 const entries=data.chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({html:s.editedHtml||MD.renderHtml(s.content||''),context:{type:'gaibao-housing',chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1)}})));
 const output=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
 const twice=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:output[i]})),ReportTableTemplates);
 const tableList=html=>{const dom=new DOMParser().parseFromString(html,'text/html');return [...dom.querySelectorAll('table')].map(t=>({id:t.closest('figure')?.dataset.templateId||'',title:t.closest('figure')?.querySelector('figcaption')?.textContent||t.previousElementSibling?.textContent||'',rows:[...t.rows].map(r=>[...r.cells].map(c=>c.textContent.trim()))}));};
 Object.assign(project,data.project);chapters=data.chapters;calcResult=null;calcType='gaibao';rptCtype='gaibao';calcParams=data.calcParams||null;projectWorkflow=data.workflow||{};kbEntries=data.kb||[];docNo=data.docNo||null;reportDocumentRevision=Number(data.documentRevision)||0;
 if(calcParams){const t=(projectWorkflow.calcSnapshots||[]).find(x=>x.id===projectWorkflow.currentCalcSnapshotId)?.calcType||(data.domainKey==='baozhang_gaibao'?'gaibao':'rent');calcType=t;calcResult=runCalcEngine(t,calcParams);if(t==='gaibao')calcResult.sens=computeSensitivity(calcParams);}
 window.reportTableProjectType=()=> 'gaibao-housing';
 const payload=buildExportPayload();
 return {keys:Object.keys(data),name:project.name,payload,idempotent:output.map((s,i)=>s===twice[i]),sections:entries.map((e,i)=>({number:e.context.number,title:e.context.section,tables:tableList(output[i]),html:output[i]}))};
 },data);
 fs.writeFileSync('outputs/table-export-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({name:result.name,keys:result.keys,idempotent:result.idempotent.every(Boolean),unstable:result.sections.filter((s,i)=>!result.idempotent[i]).map(s=>s.number),tables:result.sections.reduce((n,s)=>n+s.tables.length,0),exportTables:result.payload.chapters.flatMap(c=>c.sections.flatMap(s=>s.blocks)).filter(b=>b.type==='table'||b.type==='templateTable').length}));
 if(process.argv.includes('--docx')){
 const docx=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/docx');
 const build=require('../docxgen.js');
 fs.writeFileSync('outputs/0908税务局可研_表格修复核验.docx',await docx.Packer.toBuffer(build(docx,result.payload)));
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
