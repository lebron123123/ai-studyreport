import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),D=require('../docx.umd.js'),build=require('../docxgen.js');
const dir='outputs/report-standardization',source=JSON.parse(await fs.readFile(dir+'/longgang-source.json','utf8')),candidate=JSON.parse(await fs.readFile(dir+'/longgang-candidate.json','utf8'));
if(candidate.results.some(r=>r.status==='failed'))throw Error('Unresolved sections: '+candidate.results.filter(r=>r.status==='failed').map(r=>r.title));
const db=createD1Shim(process.env.DATABASE_URL),browser=await chromium.launch({headless:true});
try {
 const config=await db.prepare("SELECT version,overrides FROM report_table_template_versions WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind('gaibao-housing').first();
 if(config&&typeof config.overrides==='string')config.overrides=JSON.parse(config.overrides);
 const page=await browser.newPage();await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/reporttables?')?{ok:true,config}:{ok:false}}));await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 const output=await page.evaluate(async({source,candidate})=>{
  await ReportTableTemplates.load('gaibao-housing');window.reportTableProjectType=()=> 'gaibao-housing';
  const draft=source.state.draft||source.state,entries=candidate.results.map(r=>{
   let html=MD.renderHtml(r.after);for(let i=0;i<r.tables.length;i++)html=html.replace(new RegExp('<p>\\s*@@TABLE_'+i+'@@\\s*</p>|@@TABLE_'+i+'@@'),r.tables[i]);
   if(/@@TABLE_/.test(html))throw Error('Unresolved table');
   const doc=new DOMParser().parseFromString(html,'text/html');
   const actual=[...doc.querySelectorAll('table')].map(t=>t.outerHTML);if(JSON.stringify(actual)!==JSON.stringify(r.tables))throw Error('Frozen table changed: '+r.title);
   return {html,context:{type:'gaibao-housing',chapter:r.chapter,section:r.title,number:(r.ci+1)+'.'+(r.si+1)}};
  });
  const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);let offset=0;
  const payload={project:{...draft.project,name:source.name},versionNote:'独立精简候选副本 · 未覆盖工作稿、已有候选或历史版本 · 待人工审签',chapters:draft.chapters.map((c,ci)=>({cn:c.cn,num:ci+1,name:c.name,sections:c.sections.map((s,si)=>({num:si+1,title:s.t,blocks:htmlToBlocks(composed[offset++])}))}))};
  return {payload,html:composed.join('\n'),frozenTables:entries.reduce((n,e)=>n+(e.html.match(/<table\b/g)||[]).length,0)};
 },{source,candidate});
 await fs.writeFile(dir+'/longgang-candidate.docx',await D.Packer.toBuffer(build(D,output.payload)));
 await fs.writeFile(dir+'/longgang-candidate.html','<!doctype html><meta charset="utf-8"><style>body{max-width:900px;margin:40px auto;font:16px SimSun;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}figure{margin:16px 0}figcaption span{display:none}</style><h1>龙岗布吉盈信大楼 · 独立精简候选</h1><p>未覆盖工作稿或已有候选；待事实核验和人工审签。</p>'+output.html);
 console.log('Frozen source tables preserved:',output.frozenTables);
}finally{await browser.close();await db._close();}
