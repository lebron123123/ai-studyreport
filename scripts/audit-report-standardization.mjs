// Read-only production snapshot audit; never saves project or research state.
import fs from 'node:fs/promises';
import {createD1Shim} from '../local-server/d1-shim.js';
import {readStoredState} from '../functions/api/_research-state-objects.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const exportCopies=process.argv.includes('--export');
const db=createD1Shim(process.env.DATABASE_URL),snapshots=[];
try{
 const tax=await db.prepare('SELECT name,data FROM projects WHERE id=?').bind('1bb24013-18ce-4819-9588-09fe98e5e0c0').first();
 snapshots.push({name:tax.name,state:JSON.parse(tax.data)});
 const studies=await db.prepare("SELECT id,title FROM research_studies WHERE title LIKE ? AND status='active'").bind('%龙岗%').all();
 for(const study of studies.results){
  const run=await db.prepare("SELECT * FROM research_runs WHERE research_id=? AND status='active' ORDER BY ordinal DESC LIMIT 1").bind(study.id).first();
  if(run)snapshots.push({name:study.title,state:await readStoredState(db,run)});
 }
 const config=await db.prepare("SELECT version,overrides FROM report_table_template_versions WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind('gaibao-housing').first();
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/api/**',route=>route.fulfill({json:route.request().url().includes('/reporttables?')?{ok:true,config:config?{...config,overrides:typeof config.overrides==='string'?JSON.parse(config.overrides):config.overrides}:null}:{ok:false}}));
  await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
  const result=[];
  for(const snapshot of snapshots){
   const audited=await page.evaluate(async({name,state,exportCopies})=>{
    const data=state.chapters?state:state.draft?.chapters?state.draft:state;
    await ReportTableTemplates.load('gaibao-housing');
    const entries=(data.chapters||[]).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>({html:s.editedHtml||MD.renderHtml(ReportOutputPolicy.normalize(s.content||'')),context:{type:'gaibao-housing',chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1)},source:s})));
    const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
    const summary=(html)=>{const doc=new DOMParser().parseFromString(html,'text/html');return {characters:doc.body.textContent.length,tables:doc.querySelectorAll('table').length,rows:doc.querySelectorAll('tr').length,markers:(doc.body.textContent.match(/\[\[\/?TABLE\]\]/gi)||[]).length};};
    const after=new DOMParser().parseFromString(composed.join(''),'text/html').body.textContent;
    let payload=null;
    if(exportCopies){
     window.reportTableProjectType=()=> 'gaibao-housing';let offset=0;
     payload={project:{...data.project,name},chapters:(data.chapters||[]).map((c,ci)=>({cn:c.cn,num:ci+1,name:c.name,sections:(c.sections||[]).map((s,si)=>({num:si+1,title:s.t,blocks:htmlToBlocks(composed[offset++])}))}))};
    }
    return {name,payload,preview:exportCopies?composed[3]:null,keys:Object.keys(state),sections:entries.map((e,i)=>{
     const dom=new DOMParser().parseFromString(e.html,'text/html');
     return {number:e.context.number,title:e.context.section,sourceChars:(e.source.content||'').length,edited:!!e.source.editedHtml,openingMarkers:(e.source.content?.match(/\[\[TABLE\]\]/gi)||[]).length,before:summary(e.html),after:summary(composed[i]),unparsed: [...dom.querySelectorAll('p')].filter(p=>(p.textContent.match(/\|/g)||[]).length>3).map(p=>p.textContent.slice(0,500)),missingCells:[...dom.querySelectorAll('td')].map(c=>c.textContent.trim()).filter(t=>t.length>6&&!after.includes(t)).slice(0,8)};
    })};
   },{...snapshot,exportCopies});
   if(exportCopies){
    const D=require('../docx.umd.js'),build=require('../docxgen.js'),zipLib=require('../local-server/node_modules/jszip');
    await fs.mkdir('outputs/report-standardization',{recursive:true});
    const buffer=await D.Packer.toBuffer(build(D,audited.payload)),filename='outputs/report-standardization/'+(result.length?'longgang':'tax')+'-audit.docx';
    await fs.writeFile(filename,buffer);
    const zip=await zipLib.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
    audited.word={filename,tables:(xml.match(/<w:tbl>/g)||[]).length,bytes:buffer.length,unparsedMarkers:(xml.match(/\[\[\/?TABLE\]\]/gi)||[]).length};
    await page.setContent('<html><head><meta charset="utf-8"><style>body{font:16px SimSun;margin:40px;color:#183e5d}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #a9bdcd;padding:8px}figure{margin:0}figcaption span{display:none}</style></head><body>'+audited.preview+'</body></html>');
    await page.screenshot({path:'outputs/report-standardization/'+(result.length?'longgang':'tax')+'-tables.png',fullPage:true});
    console.log('Word snapshot: '+JSON.stringify(audited.word));
   }
   if(process.argv.includes('--snapshot'))await fs.writeFile('outputs/report-standardization/'+(result.length?'longgang':'tax')+'-source.json',JSON.stringify({name:snapshot.name,state:snapshot.state}));
   delete audited.payload;delete audited.preview;result.push(audited);
  }
  await fs.mkdir('outputs/report-standardization',{recursive:true});
  await fs.writeFile('outputs/report-standardization/audit.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.map(r=>({...r,sections:r.sections.length,totals:r.sections.reduce((a,s)=>({sourceChars:a.sourceChars+s.sourceChars,beforeTables:a.beforeTables+s.before.tables,afterTables:a.afterTables+s.after.tables,afterChars:a.afterChars+s.after.characters,markers:a.markers+s.after.markers}),{sourceChars:0,beforeTables:0,afterTables:0,afterChars:0,markers:0})})),null,2));
 }finally{await browser.close();}
}finally{await db._close();}
