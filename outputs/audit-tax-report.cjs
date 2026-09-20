const fs=require('node:fs');
const {Client}=require('../local-server/node_modules/pg');
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 let rows;try{rows=(await db.query('SELECT id,name,data,updated_at FROM projects WHERE name LIKE $1 ORDER BY updated_at DESC',['%税务%'])).rows;}finally{await db.end();}
 console.log(JSON.stringify(rows.map(r=>({id:r.id,name:r.name,updated:r.updated_at}))));
 if(rows.length!==1&&!process.env.AUDIT_PROJECT_ID)return;
 const row=process.env.AUDIT_PROJECT_ID?rows.find(r=>r.id===process.env.AUDIT_PROJECT_ID):rows[0];if(!row)throw Error('No target');
 const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage();await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ReportSectionLayout&&window.MD);
 const audit=await page.evaluate(data=>{
  return (data.chapters||[]).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>{
   const number=(ci+1)+'.'+(si+1),html=s.editedHtml||MD.renderHtml(s.content||'');
   const ctx={chapter:c.name,section:s.t,number};
   const after=ReportSectionLayout.compose(html,ctx);
   const doc=new DOMParser().parseFromString(after,'text/html');
   const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(n=>n.textContent);
   const beforeDoc=new DOMParser().parseFromString(html,'text/html');
   const text=doc.body.textContent;
   const suspect=[...doc.querySelectorAll('p,div')].filter(n=>!n.closest('table,figure')&&!n.querySelector('p,div,table')).map(n=>n.textContent.trim()).filter(t=>/^\d+(?:[.．]\d+)+/.test(t)&&t.length<100);
   return {number,chapter:c.name,title:s.t,generated:!!(s.editedHtml||String(s.content||'').trim()),changed:html!==after,headings,suspect,idempotent:after===ReportSectionLayout.compose(after,ctx),tables:beforeDoc.querySelectorAll('table').length,summary:/小结|结论|建议/.test(s.t),textChars:text.length};
  }));
 },data);
 const tableAudit=await page.evaluate(async data=>{
   await ReportTableTemplates.load('gaibao-housing');
   return (data.chapters||[]).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>{
     const html=s.editedHtml||MD.renderHtml(s.content||'');
     const after=ReportSectionLayout.compose(html,{chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1),type:'gaibao-housing'},ReportTableTemplates);
     const doc=new DOMParser().parseFromString(after,'text/html');
     return {number:(ci+1)+'.'+(si+1),raw:[...doc.querySelectorAll('table')].filter(t=>!t.closest('figure')).map(t=>[...t.rows[0].cells].map(c=>c.textContent)),templates:doc.querySelectorAll('figure[data-template-id]').length};
   }));
 },data);
 fs.writeFileSync('outputs/tax-report-table-audit.json',JSON.stringify(tableAudit,null,2));
 fs.writeFileSync('outputs/tax-report-section-audit.json',JSON.stringify({id:row.id,name:row.name,updated:row.updated_at,audit},null,2));
 fs.writeFileSync('outputs/0908税务局报告43节编号核查.md','# 税务局报告逐节编号核查\n\n对象：后台已保存工作稿，12章43节。只读检查，未覆盖保存数据或冻结版本。\n\n检查范围：标题编号、重复父标题、重复渲染一致性；不代表事实、政策效力或表格数值已人工核验。无独立子标题的连续正文不强制拆分。\n\n|小节|名称|规范化后的子标题|重复处理一致|\n|---|---|---|---|\n'+audit.map(x=>'|'+x.number+'|'+x.title+'|'+(x.headings.join('；')||'未识别独立子标题，保留正文')+'|'+(x.idempotent?'通过':'失败')+'|').join('\n'));
 console.log(JSON.stringify({sections:audit.length,generated:audit.filter(x=>x.generated).length,changed:audit.filter(x=>x.changed).length,nonIdempotent:audit.filter(x=>!x.idempotent),suspect:audit.filter(x=>x.suspect.length),summaries:audit.filter(x=>x.summary),all:audit.map(x=>({number:x.number,title:x.title,headings:x.headings}))}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
