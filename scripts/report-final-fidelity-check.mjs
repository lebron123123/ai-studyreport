// Offline, read-only final-body -> production payload -> prepared Word audit.
// This supplements (does not replace) report-actual-word-acceptance and visual QA.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {expectedSections} from './report-actual-word-acceptance.mjs';
const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const Zip=createRequire(new URL('../local-server/server.js',import.meta.url))('jszip');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function compareSourceInBrowser({state,payload,expected}){
  const norm=v=>window.ReportOutputPolicy.cleanText(String(v??'')).replace(/\s/g,'');
  const chapters=(state.chapters||[]).filter(c=>c.checked!==false),issues=[],sections=[];
  if(chapters.length!==12)issues.push('Expected 12 active chapters; got '+chapters.length);
  if(expected.length!==43)issues.push('Expected 43 payload sections; got '+expected.length);
  if(chapters.flatMap(c=>c.sections||[]).length!==43)issues.push('Expected 43 actual sections');
  if((payload.chapters||[]).length!==chapters.length)issues.push('Chapter count changed');
  for(const [ci,c] of chapters.entries()){
    const pc=payload.chapters?.[ci];
    if(!pc||norm(pc.name)!==norm(c.name))issues.push('Chapter '+(ci+1)+' title changed');
    if((pc?.sections||[]).length!==(c.sections||[]).length)issues.push('Chapter '+(ci+1)+' section count changed');
    for(const [si,s] of (c.sections||[]).entries()){
      const number=(ci+1)+'.'+(si+1),target=expected.find(e=>e.number===number),ps=pc?.sections?.[si],problems=[];
      if(!ps||norm(ps.title)!==norm(s.title||s.t))problems.push('Section title changed');
      if(s.pendingRevision)problems.push('Actual body still has an unadopted candidate');
      const html=s.editedHtml||window.MD.renderHtml(s.content||'');
      if(!String(s.editedHtml||s.content||'').trim())problems.push('Actual body is empty');
      const box=document.createElement('div');box.innerHTML=html;
      // Only the existing heading numbering/duplicate-parent normalization is
      // allowed here. Do NOT run composeDocument: that is what we are auditing.
      window.ReportSectionLayout.normalizeHeadings(box,{chapter:c.name,section:s.t||s.title,number});
      const texts=[];
      function visit(node){
        if(node.nodeType===3){const value=norm(node.textContent);if(value)texts.push(value);return;}
        if(node.nodeType!==1||node.matches('table,script,style'))return;
        if(node.matches('ul,ol')||node.querySelector('table,p,div,h1,h2,h3,h4,h5,h6,ul,ol')){for(const child of node.childNodes)visit(child);return;}
        for(const segment of node.innerHTML.split(/<br\s*\/?>/i)){const p=document.createElement('div');p.innerHTML=segment;const value=norm(p.textContent);if(value)texts.push(value);}
      }
      for(const node of box.childNodes)visit(node);
      const output=(target?.paragraphs||[]).join('');let cursor=0;
      for(const [index,value] of texts.entries()){
        const found=output.indexOf(value,cursor);
        if(found<0)problems.push('Missing/reordered source paragraph '+(index+1)+': '+value.slice(0,80));
        else cursor=found+value.length;
      }
      const sourceTables=[...box.querySelectorAll('table')].map(table=>{
        const grid=[];
        [...table.rows].forEach((row,ri)=>{grid[ri]||=[];let col=0;for(const cell of row.cells){while(grid[ri][col]!==undefined)col++;const rs=Math.max(1,cell.rowSpan||1),cs=Math.max(1,cell.colSpan||1);for(let dr=0;dr<rs;dr++){grid[ri+dr]||=[];for(let dc=0;dc<cs;dc++)grid[ri+dr][col+dc]=norm(cell.textContent);}col+=cs;}});
        const width=Math.max(0,...grid.map(row=>row.length));return grid.map(row=>Array.from({length:width},(_,i)=>row[i]??''));
      });
      const remaining=(target?.tables||[]).map(table=>JSON.stringify(table));
      for(const [index,table] of sourceTables.entries()){
        const found=remaining.indexOf(JSON.stringify(table));
        if(found<0)problems.push('Source table '+(index+1)+' changed or missing (requires explicit review)');
        else remaining.splice(found,1);
      }
      sections.push({number,title:s.title||s.t,sourceParagraphs:texts.length,sourceTables:sourceTables.length,passed:problems.length===0,issues:problems});
    }
  }
  return {passed:issues.length===0&&sections.every(s=>s.passed),issues,sections};
}

export function inspectOuterHeadingsInBrowser({xml,stylesXml,payload}){
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',parser=new DOMParser();
  const doc=parser.parseFromString(xml,'application/xml'),styles=parser.parseFromString(stylesXml,'application/xml');
  if(doc.querySelector('parsererror')||styles.querySelector('parsererror'))throw Error('Malformed Word XML');
  const nodes=(n,name)=>[...n.getElementsByTagNameNS(ns,name)],attr=(n,k)=>n?.getAttributeNS(ns,k)||n?.getAttribute('w:'+k)||'';
  const normal=v=>String(v??'').replace(/\s/g,''),map=new Map(nodes(styles,'style').map(s=>[attr(s,'styleId'),s]));
  function outline(id,seen=new Set()){
    if(!id||seen.has(id))return null;seen.add(id);const style=map.get(id);if(!style)return null;
    const level=nodes(style,'outlineLvl')[0];if(level)return Number(attr(level,'val'))+1;
    return outline(attr(nodes(style,'basedOn')[0],'val'),seen);
  }
  function level(p){const explicit=nodes(p,'outlineLvl')[0];if(explicit)return Number(attr(explicit,'val'))+1;const id=attr(nodes(p,'pStyle')[0],'val');return outline(id)||Number((id.match(/^Heading([1-6])$/i)||[])[1])||null;}
  const headings=[];
  for(const p of nodes(doc,'p'))for(const mark of nodes(p,'bookmarkStart')){
    const bookmark=attr(mark,'name');if(!/^_tc\d+(?:_\d+)?$/.test(bookmark))continue;
    headings.push({bookmark,level:level(p),text:normal(nodes(p,'t').map(n=>n.textContent).join(''))});
  }
  const expected=[];
  for(const [ci,c] of (payload.chapters||[]).entries()){
    expected.push({bookmark:'_tc'+ci,level:1,text:normal('第'+c.cn+'章　'+c.name)});
    for(const [si,s] of (c.sections||[]).entries())expected.push({bookmark:'_tc'+ci+'_'+si,level:2,text:normal((c.num||ci+1)+'.'+(s.num||si+1)+'　'+s.title)});
  }
  const issues=[];
  for(const e of expected){const matches=headings.filter(h=>h.bookmark===e.bookmark);if(matches.length!==1||matches[0].level!==e.level||matches[0].text!==e.text)issues.push({expected:e,actual:matches});}
  for(const h of headings)if(!expected.some(e=>e.bookmark===h.bookmark))issues.push({unexpected:h});
  const chapterCount=headings.filter(h=>/^_tc\d+$/.test(h.bookmark)).length,sectionCount=headings.length-chapterCount;
  if(chapterCount!==12||sectionCount!==43)issues.push({counts:{chapterCount,sectionCount},expected:{chapterCount:12,sectionCount:43}});
  return {passed:issues.length===0,chapterCount,sectionCount,issues};
}

export async function openOfflinePage(){
  require('./windows-browser-lockout-guard.cjs');
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  for(const file of ['report-output-policy.js','md.js','report-section-layout.js'])await page.addScriptTag({content:await fs.readFile(path.join(ROOT,file),'utf8')});
  return {page,browser};
}

export async function auditFiles({stateFile,artifactDir}){
  const root=path.join(ROOT,'outputs','report-standardization')+path.sep;
  stateFile=path.resolve(stateFile);artifactDir=path.resolve(artifactDir);
  if(!stateFile.startsWith(root)||!artifactDir.startsWith(root))throw Error('Inputs must be inside outputs/report-standardization');
  const stateBytes=await fs.readFile(stateFile),state=JSON.parse(stateBytes),payload=JSON.parse(await fs.readFile(path.join(artifactDir,'payload.json'),'utf8'));
  const acceptance=JSON.parse(await fs.readFile(path.join(artifactDir,'acceptance.json'),'utf8'));
  const docxFile=path.join(artifactDir,acceptance.key+'.prepared.docx'),bytes=await fs.readFile(docxFile),zip=await Zip.loadAsync(bytes);
  const {page,browser}=await openOfflinePage();
  try{
    const source=await page.evaluate(compareSourceInBrowser,{state,payload,expected:expectedSections(payload)});
    const headings=await page.evaluate(inspectOuterHeadingsInBrowser,{xml:await zip.file('word/document.xml').async('string'),stylesXml:await zip.file('word/styles.xml').async('string'),payload});
    return {passed:source.passed&&headings.passed,source,headings,stateFile,stateSha256:sha(stateBytes),preparedDocx:docxFile,preparedSha256:sha(bytes),paidAiCalls:0,sourceWrites:0,paginationCalls:0,completeReportCertified:false};
  }finally{await browser.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2)throw Error('Usage: node scripts/report-final-fidelity-check.mjs <actual-final.json> <existing-actual-word-project-dir>');
  const result=await auditFiles({stateFile:args[0],artifactDir:args[1]});console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
