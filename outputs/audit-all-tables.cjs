const fs=require('node:fs');
const {Client}=require('../local-server/node_modules/pg');
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();let row,configRow;
 try{row=(await db.query('SELECT id,name,data,updated_at FROM projects WHERE id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
 configRow=(await db.query("SELECT version,status,overrides FROM report_table_template_versions WHERE project_type=$1 AND status='published' ORDER BY version DESC LIMIT 1",['gaibao-housing'])).rows[0];
 }finally{await db.end();}
 if(!row)throw Error('Project missing');const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();
 // Replay only the read-only published template snapshot, without credentials or project writes.
 await page.route('**/api/reporttables?projectType=gaibao-housing',route=>route.fulfill({json:{ok:true,config:configRow?{version:configRow.version,status:configRow.status,overrides:typeof configRow.overrides==='string'?JSON.parse(configRow.overrides):configRow.overrides}:null}}));
 await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ReportSectionLayout&&window.ReportTableTemplates&&window.MD);
 const result=await page.evaluate(async data=>{
 await ReportTableTemplates.load('gaibao-housing');
 const list=html=>{const doc=new DOMParser().parseFromString(html,'text/html');return [...doc.querySelectorAll('table')].map((t,i)=>{
 const fig=t.closest('figure');let prev=t.previousElementSibling;
 const rows=[...t.rows].map(r=>[...r.cells].map(c=>c.textContent.trim()));
 return {i:i+1,id:fig?.dataset.templateId||'',title:fig?.querySelector('figcaption')?.textContent||prev?.textContent.slice(-160)||'',rows};
 });};
 return (data.chapters||[]).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>{
 const raw=s.editedHtml||MD.renderHtml(s.content||'');const ctx={type:'gaibao-housing',chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1)};
 return {section:ctx.number,title:s.t,before:list(raw),after:list(ReportSectionLayout.compose(raw,ctx,ReportTableTemplates))};
 }));
 },data);
 fs.writeFileSync('outputs/all-table-details.json',JSON.stringify({project:row.name,updated:row.updated_at,templateVersion:configRow?.version||'baseline',sections:result},null,2));
 console.log(JSON.stringify({templateVersion:configRow?.version||'baseline',sections:result.length,before:result.reduce((n,s)=>n+s.before.length,0),after:result.reduce((n,s)=>n+s.after.length,0)}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
