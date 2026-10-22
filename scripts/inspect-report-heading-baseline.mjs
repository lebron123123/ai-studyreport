// Read-only diagnosis. No report content, credentials or user records are written.
import pg from '../local-server/node_modules/pg/lib/index.js';
import C from '../report-completion-contract.js';
import fs from 'node:fs';
import vm from 'node:vm';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
  await db.query('BEGIN READ ONLY');
  const row=(await db.query('SELECT data,updated_at FROM projects WHERE id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
  const d=typeof row.data==='string'?JSON.parse(row.data):row.data;
  const versions=d.workflow?.reportVersions||[];
  const source=fs.readFileSync('report.js','utf8'),context={window:{ReportCompletionContract:C},ReportCompletionContract:C,projectWorkflow:d.workflow};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function reportBusinessHeadings('),source.indexOf('function reportCompletionPlan(')),context);
  const current=versions.find(v=>v.id===d.workflow?.currentReportVersionId);
  const recovered=(current?.chapters||[]).flatMap(c=>c.sections.filter(s=>!/依据/.test(s.t)).map(s=>({section:c.name+' / '+s.t,headings:context.reportBusinessHeadings(c,s)})));
  console.log(JSON.stringify({nextGenerationRecovery:{sections:recovered.filter(s=>s.headings.length).length,headings:recovered.reduce((n,s)=>n+s.headings.length,0),onlyLayout:true}},null,2));
  console.log(JSON.stringify({updatedAt:row.updated_at,current:d.workflow?.currentReportVersionId,versions:versions.filter(v=>[9,10,11].includes(v.version)).map(v=>({version:v.version,chapters:v.chapters.length,sections:v.chapters.reduce((n,c)=>n+c.sections.length,0),businessHeadings:v.chapters.reduce((n,c)=>n+c.sections.reduce((a,s)=>a+(/依据/.test(s.t)?0:C.headingOutline(s.editedHtml||s.content||'').length),0),0)}))},null,2));
  await db.query('ROLLBACK');
}finally{await db.end();}
