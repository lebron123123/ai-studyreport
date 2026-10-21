// Read-only audit: references control length, never supply another project's facts.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const dir='outputs/report-standardization',inputs={};
for(const name of ['tax','longgang']){const s=JSON.parse(await fs.readFile(`${dir}/${name}-source.json`,'utf8'));inputs[name]=s.state.draft||s.state;}
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.route('**/api/**',r=>r.fulfill({json:{ok:false}}));await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(inputs=>{
  function inspect(draft){return draft.chapters.flatMap((c,ci)=>c.sections.map((s,si)=>{
   const doc=new DOMParser().parseFromString(s.editedHtml||MD.renderHtml(ReportOutputPolicy.normalize(s.content||'')),'text/html');
   const tables=[...doc.querySelectorAll('table')].map(t=>({text:t.textContent.replace(/\s+/g,''),rows:t.rows.length}));
   doc.querySelectorAll('table').forEach(t=>t.remove());
   return {id:`${ci+1}.${si+1}`,chapter:c.name,title:s.t,characters:doc.body.textContent.replace(/\s+/g,'').length,tables};
  }));}
  const reference=inspect(inputs.tax),actual=inspect(inputs.longgang),seen=new Map();
  return actual.map(row=>{
   const ref=reference.find(r=>r.chapter===row.chapter&&r.title===row.title);
   const duplicates=[];row.tables.forEach((t,i)=>{if(t.text.length<20)return;if(seen.has(t.text))duplicates.push({table:i+1,sameAs:seen.get(t.text)});else seen.set(t.text,{section:row.id,table:i+1});});
   return {id:row.id,chapter:row.chapter,title:row.title,longgangCharacters:row.characters,taxCharacters:ref?.characters??null,longgangTables:row.tables.length,taxTables:ref?.tables.length??null,longgangTableRows:row.tables.reduce((a,t)=>a+t.rows,0),excessCharacters:ref?Math.max(0,row.characters-ref.characters):null,exactDuplicateTables:duplicates,action:/财务|资金|投资|合作/.test(row.chapter+' '+row.title)?'先核协议及测算口径，再精简':ref&&row.characters>ref.characters*1.25?'优先精简重复论证；保留独有事实':'按职责核对，不凑长、不强删'};
  });
 },inputs);
 const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 await fs.writeFile(`${dir}/section-comparison.json`,JSON.stringify({scope:'原工作稿，正文去空白字符；不含表格，不是逐节物理页数。只读，不自动删除。',sections:result},null,2));
 await fs.writeFile(`${dir}/section-comparison.html`,'<!doctype html><meta charset="utf-8"><title>龙岗与税务局逐节精简台账</title><style>body{font:15px sans-serif;margin:30px;color:#173b58}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd9e5;padding:10px;text-align:left}th{background:#eaf3fa;position:sticky;top:0}p{line-height:1.8}</style><h1>龙岗与税务局：43小节精简对照</h1><p>参照结构与篇幅，不复制税务局事实。数字为原工作稿正文去空白字符数，不含表格，不等于Word页数。表格完全重复仅提示，未经字段/口径核查不删除。财务与协议相关内容先核事实。</p><table><tr><th>小节</th><th>龙岗正文</th><th>税务局正文</th><th>表数 龙岗/税务局</th><th>处理方向</th></tr>'+result.map(r=>`<tr><td>${esc(r.id+' '+r.title)}</td><td>${r.longgangCharacters}</td><td>${esc(r.taxCharacters)}</td><td>${r.longgangTables}/${esc(r.taxTables)}</td><td>${esc(r.action)}${r.exactDuplicateTables.length?'；有完全重复表待核':''}</td></tr>`).join('')+'</table>');
 console.log(JSON.stringify({sections:result.length,priority:result.filter(r=>r.action.startsWith('优先')).length,largestExcess:[...result].sort((a,b)=>b.excessCharacters-a.excessCharacters).slice(0,6).map(r=>({section:r.id+' '+r.title,excess:r.excessCharacters}))},null,2));
}finally{await browser.close();}
