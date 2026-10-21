// Isolated QA only: render exact final tasks from a structured-live API run.
// No AI requests, DB writes, candidate adoption, source edits, or browser storage.
// Use the dependency-loader's bundled Node and pass its modules path explicitly.
// Usage: node script LIVE_DIR PLAN_FILE BUNDLED_NODE_MODULES [--render POPPLER_BIN]
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowed=path.join(root,'outputs','report-standardization')+path.sep;
const [liveArg,planArg,bundleArg,renderFlag,popplerArg]=process.argv.slice(2);
if(!liveArg||!planArg||!bundleArg||renderFlag&&renderFlag!=='--render'||renderFlag&&!popplerArg)
  throw Error('Pass LIVE_DIR PLAN_FILE BUNDLED_NODE_MODULES [--render POPPLER_BIN]');
const live=path.resolve(liveArg),planFile=path.resolve(planArg),bundle=path.resolve(bundleArg);
if(!live.startsWith(allowed)||!path.basename(live).startsWith('structured-live-')||!planFile.startsWith(allowed))
  throw Error('Only exact isolated structured-live outputs and an isolated plan are accepted');
const require=createRequire(import.meta.url),bundledRequire=createRequire(path.join(bundle,'package.json'));
const Contract=require('../report-completion-contract.js'),build=require('../docxgen.js');
const D=bundledRequire('docx'),JSZip=bundledRequire('jszip'),{chromium}=bundledRequire('playwright');
const execute=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const guards=new Map(),read=async file=>{const bytes=await fs.readFile(file);guards.set(file,sha(bytes));return JSON.parse(bytes);};
const summary=await read(path.join(live,'summary.json')),plan=await read(planFile);
assert.equal(summary.format,Contract.OUTPUT_FORMAT);
assert.equal(summary.sourceUnchanged,true);
assert.equal(summary.sections.length,3,'This acceptance is for exactly three real generated sections');
const sourceFile=path.join(root,'outputs','report-standardization','longgang-source.json'),source=await read(sourceFile);
assert.equal(guards.get(sourceFile),summary.sourceSha256);
const draft=source.state?.draft||source.state||source;
assert.ok(Array.isArray(draft.chapters));
const selections=[];
for(const row of summary.sections){
  assert.match(row.section,/^\d+\.\d+$/);
  const [ci,si]=row.section.split('.').map(n=>Number(n)-1),chapter=draft.chapters[ci],section=chapter?.sections?.[si];
  assert.equal(section?.t,row.title);
  const taskFiles=(await fs.readdir(live)).filter(file=>file.startsWith(ci+'-'+si+'-attempt-')&&file.endsWith('.json'));
  const tasks=await Promise.all(taskFiles.map(file=>read(path.join(live,file))));
  const matches=tasks.filter(task=>task.id===row.finalId);
  assert.equal(matches.length,1,'Summary must identify exactly one preserved final API response');
  const task=matches[0],contract=await read(path.join(live,ci+'-'+si+'-contract.json'));
  assert.ok(contract);assert.equal(task.status,'completed');assert.equal(task.outputFormat,Contract.OUTPUT_FORMAT);
 const decoded=Contract.decodeStructured(task.structuredText||task.rawText,contract);
  assert.equal(decoded.text,task.text,'Do not export a different reconstruction of the API output');
  selections.push({ci,si,number:row.section,chapter:chapter.name,title:section.t,task,contract,decodedIssues:decoded.issues});
}
selections.sort((a,b)=>a.ci-b.ci||a.si-b.si);
const out=path.join(root,'outputs','report-standardization','structured-docx-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'));
await fs.mkdir(out);
const save=(file,value)=>fs.writeFile(path.join(out,file),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{flag:'wx'});
const scriptNames=['report-completion-contract.js','md.js','report-output-policy.js','report-table-templates.js','report-section-layout.js','export.js'];
const scripts=await Promise.all(scriptNames.map(async file=>({file,text:await fs.readFile(path.join(root,file),'utf8')})));
const templates={};
for(const type of ['rent','gaibao-housing','gaibao-commercial']){
  const file='data/report-table-templates-'+type+'-v1.json';templates[file]=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
}
const audit={at:new Date().toISOString(),live,planFile,out,scope:'three real API-generated sections only; not the whole report',
  qaOnly:true,factsVerified:false,financialConclusionCertified:false,visualAcceptance:false,
  dependencyRoot:bundle,docxLibrary:JSON.parse(await fs.readFile(path.join(bundle,'docx','package.json'),'utf8')).version,
  productionTemplateVersion:build.templateVersion,templateScope:'bundled template JSON; published DB template overrides are not loaded',
  rendererNote:'No bundled LibreOffice; optional rendering uses existing product WPS COM scripts and bundled Poppler',
  scripts:scripts.map(s=>({file:s.file,sha256:sha(s.text)})),sections:selections.map(s=>({number:s.number,title:s.title,taskId:s.task.id,
    textSha256:sha(s.task.text),rawSha256:sha(s.task.rawText),quality:s.task.quality,decodedIssues:s.decodedIssues})),errors:[]};
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort('blockedbyclient'));
  await page.evaluate(local=>{window.fetch=async url=>{
    const key=String(url).replace(/^\.\//,'');
    if(Object.hasOwn(local,key))return {ok:true,json:async()=>structuredClone(local[key])};
    if(key.startsWith('/api/reporttables?'))return {ok:true,json:async()=>({ok:true,config:null})};
    throw Error('Offline QA blocked fetch: '+key);
  };},templates);
  for(const script of scripts)await page.addScriptTag({content:script.text});
  const rendered=await page.evaluate(async({draft,selections})=>{
    const type='gaibao-housing';window.reportTableProjectType=()=>type;await ReportTableTemplates.load(type);
    const parser=new DOMParser(),dom=html=>parser.parseFromString(html,'text/html');
    const tables=html=>[...dom(html).querySelectorAll('table')].map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.textContent.trim())));
    const entries=selections.map(s=>({key:s.chapter+' / '+s.title,html:MD.renderHtml(s.task.text),
      context:{type,chapter:s.chapter,section:s.title,number:s.number}}));
    const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
    const again=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:composed[i]})),ReportTableTemplates);
    const records=entries.map((entry,i)=>({number:selections[i].number,rawHtml:entry.html,composedHtml:composed[i],
      rawTables:tables(entry.html),composedTables:tables(composed[i]),idempotent:again[i]===composed[i],
      warnings:[...dom(composed[i]).querySelectorAll('.rpt-table-conflict,.rpt-layout-warning')].map(e=>e.textContent.trim()),
      blocks:htmlToBlocks(composed[i])}));
    const chapters=[];
    for(const [i,s] of selections.entries()){
      let c=chapters.find(c=>c.num===s.ci+1);
      if(!c){c={num:s.ci+1,cn:draft.chapters[s.ci].cn,name:s.chapter,sections:[]};chapters.push(c);}
      c.sections.push({num:s.si+1,title:s.title,blocks:records[i].blocks});
    }
    const payload={project:{...draft.project,name:(draft.project?.name||'龙岗')+'（三节结构化生成 QA 片段）'},
      signed:false,docNo:'QA-STRUCTURED-FRAGMENTS',versionNote:'仅验收三节真实生成片段；非完整报告、非已审定成果；事实与财务口径仍待确认',
      unsignedNote:'本件仅供排版和表格 QA；未覆盖原工作稿、候选稿或正式成果，不能据此认定整篇报告完成或财务可行。',chapters};
    return {records,payload};
  },{draft,selections});
  await save('composition.json',rendered);
  await save('fragments.html','<!doctype html><meta charset="utf-8"><title>QA fragments</title>'+rendered.records.map(r=>'<h1>'+r.number+'</h1>'+r.composedHtml).join('\n'));
  const bytes=await D.Packer.toBuffer(build(D,rendered.payload));
  const docxFile=path.join(out,'fragments.docx');await save('fragments.docx',bytes);
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
  const packageDetail=await page.evaluate(({xml,records,selections})=>{
    const p=new DOMParser(),d=p.parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    if(d.querySelector('parsererror'))throw Error('DOCX document XML malformed');
    const text=[...d.getElementsByTagNameNS(ns,'t')].map(n=>n.textContent).join('');
    const norm=s=>String(s).replace(/\s/g,'');
    const wordTables=[...d.getElementsByTagNameNS(ns,'tbl')].map(t=>[...t.children].filter(r=>r.localName==='tr').map(r=>[...r.children].filter(c=>c.localName==='tc').map(c=>[...c.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(''))));
    const paragraphMissing=[];
    for(const s of selections){
      let data;try{data=JSON.parse((s.task.structuredText||s.task.rawText).replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{continue;}
      for(const b of data.blocks||[])if(b.kind==='paragraph'&&typeof b.text==='string'&&!norm(text).includes(norm(ReportOutputPolicy.cleanText(b.text))))
        paragraphMissing.push({section:s.number,slot:b.slot,text:b.text});
    }
    const composedCells=records.flatMap(r=>r.composedTables.flat(2)),missingCells=composedCells.filter(c=>!norm(text).includes(norm(ReportOutputPolicy.cleanText(c))));
    const normalizedTables=items=>items.map(t=>t.map(r=>r.map(c=>norm(ReportOutputPolicy.cleanText(c)))));
    const composedTables=records.flatMap(r=>r.composedTables);
    return {wordTables,paragraphMissing,missingCells,tableCellsMatch:JSON.stringify(normalizedTables(wordTables))===JSON.stringify(normalizedTables(composedTables)),documentText:text};
  },{xml,records:rendered.records,selections});
  audit.composition=rendered.records.map(r=>({number:r.number,idempotent:r.idempotent,rawTables:r.rawTables.length,
    composedTables:r.composedTables.length,rawTableCellsRetained:JSON.stringify(r.rawTables)===JSON.stringify(r.composedTables),warnings:r.warnings}));
  audit.docx={file:docxFile,sha256:sha(bytes),bytes:bytes.length,tables:packageDetail.wordTables.length,
    rows:packageDetail.wordTables.reduce((n,t)=>n+t.length,0),unresolvedMarkers:/\[\[\/?TABLE\]\]|@@TABLE_\d+@@/.test(xml),
    paragraphMissing:packageDetail.paragraphMissing,missingCells:packageDetail.missingCells,tableCellsMatch:packageDetail.tableCellsMatch};
  if(packageDetail.paragraphMissing.length||packageDetail.missingCells.length||!packageDetail.tableCellsMatch||audit.docx.unresolvedMarkers)
    audit.errors.push('Content preservation check failed; inspect word-content.json and composition.json');
  await save('word-content.json',packageDetail);
  if(renderFlag){
    assert.equal(process.platform,'win32','This QA adapter deliberately has no unbundled LibreOffice fallback');
    const layout=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'local-server','report-pagination.ps1'),'-InputDocx',docxFile],{timeout:60000,windowsHide:true,maxBuffer:2*1024*1024});
    audit.layout={...JSON.parse(layout.stdout.trim().replace(/^\uFEFF/,'')),documentSha256:sha(bytes),scope:'pagination-only'};
    const pdfFile=path.join(out,'fragments.pdf');
    const pdf=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','render-report-copy.ps1'),'-InputDocx',docxFile,'-OutputPdf',pdfFile],{timeout:60000,windowsHide:true,maxBuffer:2*1024*1024});
    audit.pdf={file:pdfFile,sha256:sha(await fs.readFile(pdfFile)),renderLog:pdf.stdout.trim()};
    const poppler=path.resolve(popplerArg);
    const info=await execute(path.join(poppler,'pdfinfo.exe'),[pdfFile],{timeout:20000,windowsHide:true});
    audit.pdf.pages=Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);assert.equal(audit.pdf.pages,audit.layout.pages);
    await execute(path.join(poppler,'pdftotext.exe'),['-layout',pdfFile,path.join(out,'fragments.txt')],{timeout:20000,windowsHide:true});
    await execute(path.join(poppler,'pdftoppm.exe'),['-r','100','-png',pdfFile,path.join(out,'page')],{timeout:60000,windowsHide:true,maxBuffer:2*1024*1024});
    audit.pdf.images=(await fs.readdir(out)).filter(f=>/^page-\d+\.png$/.test(f));assert.equal(audit.pdf.images.length,audit.pdf.pages);
    // PNG creation is not visual acceptance. A human/agent must inspect every page.
    audit.visualAcceptance=false;audit.visualReviewRequired=audit.pdf.images;
  }
}catch(error){audit.errors.push(error.stack||error.message);process.exitCode=1;}
finally{
  await browser.close();audit.sourcesUnchanged=true;
  for(const [file,before] of guards)if(sha(await fs.readFile(file))!==before)audit.sourcesUnchanged=false;
  if(!audit.sourcesUnchanged){audit.errors.push('A guarded input changed during the run');process.exitCode=1;}
  if(audit.errors.length)process.exitCode=1;
  await save('audit.json',audit);console.log(JSON.stringify({out,docx:audit.docx,layout:audit.layout,errors:audit.errors}));
}
