// Isolated read-only historical QA. Never saves a project, edits a version,
// adopts a candidate, requests AI generation or opens the user's browser.
// node --env-file=local-server/.env scripts/compare-tax-report-pagination.mjs
// node scripts/compare-tax-report-pagination.mjs --render OUTPUT_DIRECTORY
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
const require=createRequire(import.meta.url),execute=promisify(execFile);
const sha=value=>createHash('sha256').update(value).digest('hex');
const JSZip=require('../local-server/node_modules/jszip');
const textXml=xml=>[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')).join('');
const packageBody=async bytes=>{
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
  const first=xml.indexOf('w:name="_tc0"');
  assert.ok(first>=0,'Production chapter bookmark must exist');
  return {bodyText:textXml(xml.slice(first)),tables:(xml.match(/<w:tbl\b/g)||[]).length,
    sectionBookmarks:[...xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="(_tc\d+_\d+)"/g)].map(m=>m[1]),xml};
};

if(process.argv[2]==='--render'){
  const out=path.resolve(process.argv[3]||'');
  if(!out.startsWith(allowed)||!path.basename(out).startsWith('tax-history-pagination-'))
    throw Error('Only isolated tax-history-pagination QA directories are accepted');
  const audit=JSON.parse(await fs.readFile(path.join(out,'audit.json'),'utf8'));
  assert.equal(audit.qaOnly,true);assert.equal(audit.readOnlyProjectUnchanged,true);
  const {inspectPreparedToc}=await import('../local-server/report-pagination.js');
  for(const row of audit.versions){
    const original=path.join(out,`V${row.version}-production.docx`),prepared=path.join(out,`V${row.version}-toc-updated.docx`),pdf=path.join(out,`V${row.version}-rendered.pdf`);
    const originalBytes=await fs.readFile(original);assert.equal(sha(originalBytes),row.docxSha256);
    const raw=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'local-server','report-pagination.ps1'),'-InputDocx',original,'-OutputDocx',prepared],{timeout:60000,windowsHide:true,maxBuffer:2*1024*1024,encoding:'utf8'});
    const layout=JSON.parse(raw.stdout.trim().replace(/^\uFEFF/,''));
    await fs.writeFile(path.join(out,`V${row.version}-pagination.json`),JSON.stringify(layout,null,2),{flag:'wx'});
    const preparedBytes=await fs.readFile(prepared),toc=await inspectPreparedToc(preparedBytes,{maxPages:layout.pages});
    const before=await packageBody(originalBytes),after=await packageBody(preparedBytes);
    assert.equal(after.bodyText,before.bodyText,'Updating TOC must preserve every body text character');
    assert.equal(after.tables,before.tables,'Updating TOC must preserve every table');
    assert.deepEqual(after.sectionBookmarks,before.sectionBookmarks);
    const rendered=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','render-report-copy.ps1'),'-InputDocx',prepared,'-OutputPdf',pdf],{timeout:60000,windowsHide:true,maxBuffer:1024*1024,encoding:'utf8'});
    const renderedPages=Number(rendered.stdout.match(/Rendered pages:\s*(\d+)/)?.[1]);
    assert.equal(renderedPages,layout.pages,'Prepared Word and PDF rendering must agree');
    Object.assign(row,{layout:{pages:layout.pages,renderer:'WPS',rendererVersion:layout.rendererVersion,diagnosticsStatus:layout.diagnostics?.status,sectionRanges:layout.diagnostics?.sections?.length,tableRanges:layout.diagnostics?.tables?.length},toc,bodyPreserved:true,tablesPreserved:true,preparedDocx:path.basename(prepared),preparedSha256:sha(preparedBytes),pdf:path.basename(pdf),pdfSha256:sha(await fs.readFile(pdf)),renderedPages});
    await fs.writeFile(path.join(out,'render-audit.json'),JSON.stringify(audit,null,2));
    console.log(JSON.stringify({version:row.version,pages:layout.pages,rendererVersion:layout.rendererVersion,tocUpdated:toc.updated,tocEntries:toc.entries,bodyPreserved:true,tables:after.tables}));
  }
  audit.newProductionGenerationVerified=false;
  audit.visualAcceptance='Not performed by this script; selected PDF pages require visual inspection.';
  await fs.writeFile(path.join(out,'render-audit.json'),JSON.stringify(audit,null,2));
  console.log(JSON.stringify({out,scope:'Historical V9/V11 copies only; no new full report generation or professional certification'}));
}else{
  const pg=require('../local-server/node_modules/pg'),Contract=require('../report-completion-contract.js');
  const D=require('../docx.umd.js'),build=require('../docxgen.js'),{chromium}=require('playwright');
  const out=path.join(root,'outputs','report-standardization','tax-history-pagination-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'));
  const scriptNames=['md.js','report-writing-standard.js','report-completion-contract.js','report-output-policy.js','report-table-templates.js','report-section-layout.js','export.js','report.js','docxgen.js','docx.umd.js'];
  const scripts=await Promise.all(scriptNames.map(async file=>({file,text:await fs.readFile(path.join(root,file),'utf8')})));
  const report=scripts.find(s=>s.file==='report.js').text;
  const renderContent=report.slice(report.indexOf('function renderContent('),report.indexOf('function reportTableProjectType('));
  const getDocNo=report.slice(report.indexOf('let docNo = null;'),report.indexOf('function archiveCardHtml('));
  assert.match(renderContent,/function renderContent/);assert.match(getDocNo,/function getDocNo/);
  const templates={};
  for(const type of ['rent','gaibao-housing','gaibao-commercial']){
    const file=`data/report-table-templates-${type}-v1.json`;
    templates[file]=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  }
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  let browser;
  try{
    await db.query('BEGIN READ ONLY');
    const projectId='1bb24013-18ce-4819-9588-09fe98e5e0c0';
    const original=(await db.query('SELECT name,data,updated_at FROM projects WHERE id=$1',[projectId])).rows[0];
    assert.ok(original,'Tax project must exist');
    const state=typeof original.data==='string'?JSON.parse(original.data):original.data;
    const sourceSha256=sha(JSON.stringify(original.data)),versions=state.workflow?.reportVersions||[];
    const selected=[9,11].map(number=>{
      const matches=versions.filter(v=>v.version===number);assert.equal(matches.length,1,`Exactly one V${number} is required`);return matches[0];
    });
    const configs={};
    for(const type of ['rent','gaibao-housing','gaibao-commercial']){
      const config=(await db.query("SELECT version,overrides FROM report_table_template_versions WHERE project_type=$1 AND status='published' ORDER BY version DESC LIMIT 1",[type])).rows[0];
      configs[type]=config?{...config,overrides:typeof config.overrides==='string'?JSON.parse(config.overrides):config.overrides}:null;
    }
    await db.query('ROLLBACK');
    await fs.mkdir(out,{recursive:true});
    const audit={at:new Date().toISOString(),out,projectId,projectName:original.name,sourceUpdatedAt:original.updated_at,sourceSha256,qaOnly:true,
      exportPath:'Production buildExportPayload({version}) + production docx.umd.js / docxgen.js; current DOM, calc appendix and current table injection excluded by historical export',
      templateVersion:build.templateVersion,productionScripts:scripts.map(s=>({file:s.file,sha256:sha(s.text)})),publishedTemplateVersions:Object.fromEntries(Object.entries(configs).map(([k,v])=>[k,v?.version??null])),versions:[],newProductionGenerationVerified:false};
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();await page.route('**/*',route=>route.abort('blockedbyclient'));
    await page.evaluate(({templates,configs})=>{
      window.fetch=async url=>{
        const key=String(url).replace(/^\.\//,'');
        if(Object.hasOwn(templates,key))return {ok:true,json:async()=>structuredClone(templates[key])};
        if(key.startsWith('/api/reporttables?'))return {ok:true,json:async()=>({ok:true,config:structuredClone(configs[new URL(key,'https://offline.invalid').searchParams.get('projectType')]||null)})};
        throw Error('Isolated QA prohibits network: '+key);
      };
    },{templates,configs});
    for(const script of scripts.filter(s=>!['report.js','docxgen.js','docx.umd.js'].includes(s.file)))await page.addScriptTag({content:script.text});
    await page.addScriptTag({content:renderContent+'\n'+getDocNo});
    await page.evaluate(async()=>{for(const type of ['rent','gaibao-housing','gaibao-commercial'])await ReportTableTemplates.load(type);});
    for(const version of selected){
      const result=await page.evaluate(({version,state})=>{
        window.project=state.project;window.chapters=structuredClone(version.chapters);window.projectWorkflow=state.workflow;window.calcResult=null;
        const frozen=structuredClone(version),versionBefore=JSON.stringify(frozen);
        const payload=buildExportPayload({version:frozen});
        payload.images=[];
        if(JSON.stringify(frozen)!==versionBefore)throw Error('Production historical export mutated the immutable source snapshot');
        const canonical=version.chapters.filter(c=>c.checked!==false).flatMap((c,ci)=>c.sections.map((s,si)=>{
          const box=document.createElement('div');box.innerHTML=s.editedHtml||renderContent(s.content||'');
          ReportSectionLayout.normalizeHeadings(box,{type:null,chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1)});
          return {number:(ci+1)+'.'+(si+1),title:s.title||s.t,html:box.innerHTML,measure:ReportCompletionContract.measure(box.innerHTML),businessHeadings:box.querySelectorAll('h1,h2,h3,h4,h5,h6,[data-report-heading-level]').length,tables:box.querySelectorAll('table').length};
        }));
        return {payload,canonical};
      },{version,state:{project:state.project,workflow:state.workflow}});
      assert.equal(result.payload.project.name,state.project.name);
      assert.equal(result.payload.chapters.length,version.chapters.filter(c=>c.checked!==false).length);
      const bytes=await D.Packer.toBuffer(build(D,result.payload)),filename=`V${version.version}-production.docx`;
      await fs.writeFile(path.join(out,filename),bytes,{flag:'wx'});
      await fs.writeFile(path.join(out,`V${version.version}-canonical.json`),JSON.stringify(result,null,2),{flag:'wx'});
      const word=await packageBody(bytes),expectedTables=result.canonical.reduce((n,s)=>n+s.tables,0);
      assert.equal(word.tables,expectedTables,'Production historical export must preserve the canonical table count');
      assert.equal(word.sectionBookmarks.length,result.canonical.length,'All historical sections must be present');
      const sections=version.chapters.filter(c=>c.checked!==false).flatMap(c=>c.sections);
      const raw=sections.map(s=>Contract.measure(s.editedHtml||s.content||''));
      const sum=(items,key)=>items.reduce((n,s)=>n+(s[key]||0),0);
      audit.versions.push({version:version.version,versionId:version.id,sourceVersionSha256:sha(JSON.stringify(version)),sourceChars:{prose:sum(raw,'proseCharacters'),table:sum(raw,'tableCharacters')},
        canonicalChars:{prose:sum(result.canonical.map(s=>s.measure),'proseCharacters'),table:sum(result.canonical.map(s=>s.measure),'tableCharacters')},chapters:result.payload.chapters.length,sections:word.sectionBookmarks.length,
        canonicalBusinessHeadings:sum(result.canonical,'businessHeadings'),tables:word.tables,docx:filename,docxBytes:bytes.length,docxSha256:sha(bytes),bodyTextSha256:sha(word.bodyText),bodyTextChars:word.bodyText.length});
    }
    await db.query('BEGIN READ ONLY');
    const after=(await db.query('SELECT data,updated_at FROM projects WHERE id=$1',[projectId])).rows[0];await db.query('ROLLBACK');
    audit.readOnlyProjectUnchanged=sha(JSON.stringify(after.data))===sourceSha256&&after.updated_at===original.updated_at;
    assert.equal(audit.readOnlyProjectUnchanged,true,'Formal project changed while exporting; do not claim immutable baseline');
    audit.productionFilesUnchanged=await Promise.all(scripts.map(async s=>({file:s.file,unchanged:sha(await fs.readFile(path.join(root,s.file),'utf8'))===sha(s.text)})));
    await fs.writeFile(path.join(out,'audit.json'),JSON.stringify(audit,null,2),{flag:'wx'});
    console.log(JSON.stringify({out,readOnlyProjectUnchanged:audit.readOnlyProjectUnchanged,templateVersion:audit.templateVersion,versions:audit.versions},null,2));
  }finally{if(browser)await browser.close();await db.end();}
}
