// Offline QA of the EXACT 43-section frozen review, never candidate adoption.
// Run with the Node/modules returned by load_workspace_dependencies.
// node SCRIPT FULL_REVIEW_DIR BUNDLED_MODULES [--render POPPLER_BIN]
// node SCRIPT --self-test BUNDLED_MODULES (synthetic data; no AI/DB/WPS)
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Only top-level whitespace-only text nodes may move during composition.
// Element markup (including internal whitespace/attributes), nonblank text,
// comments and their order remain exact. This function runs in the DOM realm.
export function frozenCompositionContentEqual(before,after){
  const significant=html=>{
    // Parse a fragment so a leading comment is not moved outside <body> and
    // silently lost from this comparison by document-level HTML parsing.
    const fragment=document.createElement('template');fragment.innerHTML=html;
    return Array.from(fragment.content.childNodes)
      .filter(node=>node.nodeType!==3||node.nodeValue.trim()!=='')
      .map(node=>[node.nodeType,node.nodeType===1?node.outerHTML:node.nodeValue]);
  };
  return JSON.stringify(significant(before))===JSON.stringify(significant(after));
}

async function main(){
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowed=path.join(root,'outputs','report-standardization');
const [inputArg,bundleArg,renderFlag,popplerArg]=process.argv.slice(2);
if(!inputArg||!bundleArg||renderFlag&&renderFlag!=='--render'||renderFlag&&!popplerArg)
  throw Error('Pass FULL_REVIEW_DIR BUNDLED_MODULES [--render POPPLER_BIN], or --self-test BUNDLED_MODULES');
const selfTest=inputArg==='--self-test';
if(selfTest&&renderFlag)throw Error('Self-test deliberately does not invoke WPS');
const sha=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const require=createRequire(import.meta.url),bundle=path.resolve(bundleArg),bundledRequire=createRequire(path.join(bundle,'package.json'));
const D=bundledRequire('docx'),JSZip=bundledRequire('jszip'),{chromium}=bundledRequire('playwright');
const build=require('../docxgen.js'),execute=promisify(execFile);
const QA='本件仅为完整报告 QA 副本；不是正式候选接受、事实审签或标准达标成果。未通过小节完整保留原稿，不能据此认定已精简或财务可行。';
const CAVEAT='协议口径仍待确认，且与旧测算的规模、年限和收益模式存在冲突；旧财务表仅为原稿留存，须重核后审签。';
const scriptNames=['report-completion-contract.js','md.js','report-output-policy.js','report-table-templates.js','report-section-layout.js','export.js'];
const scripts=await Promise.all(scriptNames.map(async file=>({file,text:await fs.readFile(path.join(root,file),'utf8')})));
const templates={},templateHashes=[];
for(const type of ['rent','gaibao-housing','gaibao-commercial']){
  const file='data/report-table-templates-'+type+'-v1.json',bytes=await fs.readFile(path.join(root,file));templates[file]=JSON.parse(bytes);templateHashes.push({file,sha256:sha(bytes)});
}
const guards=new Map();
async function guarded(file,json=true){const bytes=await fs.readFile(file);guards.set(file,sha(bytes));return json?JSON.parse(bytes):bytes.toString('utf8');}
async function inside(file){const real=await fs.realpath(file),base=await fs.realpath(allowed);assert.ok(real.startsWith(base+path.sep),'QA input must resolve inside outputs/report-standardization');return real;}
function validate(candidate,plan,identity,source,sidecar){
  const draft=source.state?.draft||source.state||source;
  assert.ok(Array.isArray(draft.chapters),'Missing full report chapters');
  assert.equal(candidate.sourceUnchanged,true,'Full-review source must already be verified unchanged');
  assert.equal(candidate.readyForPublication,false,'This adapter only accepts unapproved QA copies');
  assert.equal(candidate.sourceFileHash,identity.sourceFileHash);
  assert.equal(candidate.sourceHash,identity.sourceHash);assert.equal(candidate.sourceHash,sha(JSON.stringify(draft)));
  assert.equal(candidate.planId,plan.planId);assert.equal(candidate.results.length,43,'Exactly 43 frozen sections required');
  assert.equal(sidecar.length,43);assert.equal(new Set(candidate.results.map(r=>r.key)).size,43,'Duplicate section keys');
  assert.equal(new Set(candidate.results.map(r=>r.number)).size,43,'Duplicate section numbers');
  const expected=draft.chapters.flatMap((c,ci)=>c.checked===false?[]:(c.sections||[]).map((s,si)=>({ci,si,number:(ci+1)+'.'+(si+1),key:c.name+' / '+s.t,title:s.t,chapter:c.name})));
  assert.equal(expected.length,43,'Source must have the same complete scope');
  for(const [i,e] of expected.entries()){
    const r=candidate.results[i],f=sidecar[i];
    for(const field of ['ci','si','number','key','title','chapter'])assert.equal(r[field],e[field],'Frozen source identity/order mismatch: '+field);
    assert.ok(plan.sections.some(s=>s.key===r.key||s.sectionKey===r.key),'Section is absent from the plan');
    assert.equal(f.key,r.key);assert.equal(f.number,r.number);assert.equal(f.text,r.renderedHtml,'Do not reconstruct a different candidate');
    assert.equal(f.mechanicalPassed,!!r.quality?.mechanicalPassed);
    assert.ok(typeof r.renderedHtml==='string'&&r.renderedHtml.trim(),'Frozen rendered section missing');
    if(!r.quality?.mechanicalPassed)assert.equal(r.renderedHtml,r.canonicalHtml,'A non-passing section must retain its canonical original');
  }
  return draft;
}
function compareWpsTableCounts(sections,tables){
  const counts=sections.map(s=>({number:s.number,bookmark:s.bookmark,expected:s.tablesExpected,word:s.tablesWord,wps:tables.filter(t=>t.sectionBookmark===s.bookmark).length}));
  const unknownTables=tables.filter(t=>!sections.some(s=>s.bookmark===t.sectionBookmark));
  return {counts,unknownTables,matches:!unknownTables.length&&counts.every(s=>s.expected===s.wps&&s.word===s.wps)};
}

await fs.mkdir(allowed,{recursive:true});
const out=path.join(allowed,'full-docx-'+stamp());await fs.mkdir(out);
const save=(file,data)=>fs.writeFile(path.join(out,file),typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2),{flag:'wx'});
const audit={at:new Date().toISOString(),out,scope:'all 43 frozen sections; offline QA only',qaOnly:true,selfTest,
  factsVerified:false,financialConclusionCertified:false,readyForPublication:false,visualAcceptance:false,
  dependencyRoot:bundle,docxLibrary:JSON.parse(await fs.readFile(path.join(bundle,'docx','package.json'),'utf8')).version,
  productionTemplateVersion:build.templateVersion,templateScope:'Same bundled templates as the full-review builder; no published DB overrides',
  scripts:scripts.map(s=>({file:s.file,sha256:sha(s.text)})),templates:templateHashes,errors:[],pageGate:{status:'unverified',limit:120,reason:'Actual WPS pagination not run'}};
for(const file of ['docxgen.js','local-server/report-pagination.ps1','scripts/render-report-copy.ps1','scripts/check-report-full-docx.mjs'])audit.scripts.push({file,sha256:sha(await fs.readFile(path.join(root,file)))});
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  const page=await browser.newPage();await page.route('**/*',r=>r.abort('blockedbyclient'));
  page.on('pageerror',error=>audit.errors.push('Browser: '+error.message));
  await page.evaluate(local=>{window.fetch=async url=>{
    const key=String(url).replace(/^\.\//,'');
    if(Object.hasOwn(local,key))return {ok:true,json:async()=>structuredClone(local[key])};
    if(key.startsWith('/api/reporttables?'))return {ok:true,json:async()=>({ok:true,config:null})};
    throw Error('Offline QA blocked network: '+key);
  };},templates);
  await page.addScriptTag({content:frozenCompositionContentEqual.toString()});
  for(const script of scripts)await page.addScriptTag({content:script.text});
  await page.evaluate(async()=>{window.reportTableProjectType=()=> 'gaibao-housing';await ReportTableTemplates.load('gaibao-housing');});
  let input;
  if(selfTest){
    input=path.join(allowed,'full-review-selftest-'+stamp());await fs.mkdir(input);
    const fixture=await page.evaluate(()=>{
      const chapters=[{name:'隔离测试章',cn:'一',sections:Array.from({length:43},(_,i)=>({t:'隔离核验小节'+(i+1),content:'独立段落'+(i+1)+'：冻结原稿不得丢失。\n\n第二段'+(i+1)+'须逐节核对。'+(i%5===0?'\n\n| | 项目 | 值 | |\n| --- | --- | --- | --- |\n| | 单元'+(i+1)+' | '+(100+i)+' | |':'')}))}];
      const source={state:{draft:{project:{name:'[系统测试]全篇导出'},chapters}}},draft=source.state.draft;
      const template=ReportTableTemplates.current('gaibao-housing').templates.find(t=>t.segments.some(s=>s.rows.some(r=>r.cells.some(c=>Number(c.colSpan)>1))));
      if(!template)throw Error('Fixture requires a real merged-cell template');
      chapters[0].sections[2].editedHtml=MD.renderHtml(chapters[0].sections[2].content)+ReportTableTemplates.renderTemplate(template);
      const figureDocument=new DOMParser().parseFromString(chapters[0].sections[2].editedHtml,'text/html'),figure=figureDocument.querySelector('figure');
      figure.querySelector('figcaption').insertAdjacentHTML('afterend','<p>独立表前说明必须保留。</p>');
      figure.insertAdjacentHTML('beforeend','<div><p>独立表后说明必须保留。</p><p>【待补：独立表格口径仍待签认。】</p></div>');
      chapters[0].sections[2].editedHtml=figureDocument.body.innerHTML;
      chapters[0].sections[3].editedHtml=MD.renderHtml(chapters[0].sections[3].content)+'<figure class="rpt-template-card" data-template-id="isolated-merged-grid"><figcaption><b>表：隔离合并结构核验</b></figcaption><div class="rpt-template-segment"><div class="rpt-template-segment-title">隔离合并结构核验</div><table><tr><th rowspan="2" colspan="2">合并主格</th><th>列三</th></tr><tr><td>后行数值</td></tr><tr><td></td><td></td><td>末行数值</td></tr></table></div><p>合并表下注不能丢失。</p></figure>';
      const entries=chapters[0].sections.map((s,si)=>({key:chapters[0].name+' / '+s.t,html:s.editedHtml||MD.renderHtml(s.content),context:{type:'gaibao-housing',chapter:chapters[0].name,section:s.t,number:'1.'+(si+1)}}));
      const html=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
      const plan={planId:'isolated-full-docx-fixture',sections:entries.map(e=>({key:e.key}))};
      const results=entries.map((e,si)=>({ci:0,si,key:e.key,title:chapters[0].sections[si].t,chapter:chapters[0].name,number:e.context.number,
        originalHtml:e.html,canonicalHtml:html[si],renderedHtml:html[si],after:si===1?'不得导出的失败候选错误内容':chapters[0].sections[si].content,
        status:si===1?'blocked':'unverified',quality:{mechanicalPassed:si!==1,factsVerified:false}}));
      return {source,plan,results,sidecar:results.map(r=>({key:r.key,number:r.number,text:r.renderedHtml,status:r.status,mechanicalPassed:r.quality.mechanicalPassed}))};
    });
    const sourcePath=path.join(input,'fixture-source.json'),sourceBytes=JSON.stringify(fixture.source,null,2),sourceHash=sha(JSON.stringify(fixture.source.state.draft));
    const identity={sourcePath,sourceFileHash:sha(sourceBytes),sourceHash,sourceName:'[系统测试]全篇导出'};
    const candidate={...identity,planId:fixture.plan.planId,sourceUnchanged:true,readyForPublication:false,results:fixture.results,
      scripts:audit.scripts,templateScope:audit.templateScope};
    const fixtureFiles={'fixture-source.json':sourceBytes,'source-identity.json':identity,'candidate.json':candidate,'plan.json':fixture.plan,
      'composed-audit-sections.json':fixture.sidecar,'review.html':'<!doctype html>'+fixture.results.map(r=>'<section><h2>'+escape(r.number+' '+r.key)+'</h2>'+r.renderedHtml+'</section>').join('\n')};
    for(const [name,value] of Object.entries(fixtureFiles))await fs.writeFile(path.join(input,name),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});
    audit.selfTests=[];
    const bad=structuredClone(candidate);bad.results[1].renderedHtml='<p>替换原稿</p>';const badSide=structuredClone(fixture.sidecar);badSide[1].text=bad.results[1].renderedHtml;
    assert.throws(()=>validate(bad,fixture.plan,identity,fixture.source,badSide),/retain its canonical original/);audit.selfTests.push('Non-passing original replacement rejected');
    const duplicate=structuredClone(candidate);duplicate.results[1].key=duplicate.results[0].key;
    assert.throws(()=>validate(duplicate,fixture.plan,identity,fixture.source,fixture.sidecar),/Duplicate/);audit.selfTests.push('Duplicate identity rejected');
    assert.throws(()=>validate({...candidate,sourceHash:'forged'},fixture.plan,identity,fixture.source,fixture.sidecar));audit.selfTests.push('Forged source hash rejected');
    const tableScope=[{number:'1.1',bookmark:'a',tablesExpected:2,tablesWord:2},{number:'1.2',bookmark:'b',tablesExpected:1,tablesWord:1}];
    assert.equal(compareWpsTableCounts(tableScope,[{sectionBookmark:'a'},{sectionBookmark:'a'},{sectionBookmark:'b'}]).matches,true);
    assert.equal(compareWpsTableCounts(tableScope,[{sectionBookmark:'a'},{sectionBookmark:'b'},{sectionBookmark:'b'}]).matches,false);
    assert.equal(compareWpsTableCounts(tableScope,[{sectionBookmark:'a'},{sectionBookmark:'a'},{sectionBookmark:'b'},{sectionBookmark:'unknown'}]).matches,false);
    audit.selfTests.push('WPS per-section redistribution and unassigned tables rejected despite global totals');
  }else input=await inside(path.resolve(inputArg));
  assert.ok(path.basename(input).startsWith('full-review-'),'Only full-review-* directories are accepted');
  audit.input=input;
  const candidate=await guarded(path.join(input,'candidate.json')),plan=await guarded(path.join(input,'plan.json'));
  const identity=await guarded(path.join(input,'source-identity.json')),sidecar=await guarded(path.join(input,'composed-audit-sections.json'));
  const reviewHtml=await guarded(path.join(input,'review.html'),false),sourcePath=await inside(identity.sourcePath);
  assert.equal(path.resolve(candidate.sourcePath),path.resolve(identity.sourcePath));
  const source=await guarded(sourcePath);assert.equal(guards.get(sourcePath),identity.sourceFileHash,'Source bytes have changed');
  const draft=validate(candidate,plan,identity,source,sidecar);
  const reviewMatch=await page.evaluate(({html,rows})=>{
    const doc=new DOMParser().parseFromString(html,'text/html'),sections=[...doc.querySelectorAll('body > section')];
    return {count:sections.length,match:sections.length===rows.length&&sections.every((s,i)=>s.querySelector('h2')?.textContent===rows[i].number+' '+rows[i].key&&s.innerHTML.includes(rows[i].renderedHtml))};
  },{html:reviewHtml,rows:candidate.results});
  assert.equal(reviewMatch.count,43);assert.equal(reviewMatch.match,true,'Review HTML and frozen candidate must agree');
  for(const s of scripts){const prepared=candidate.scripts?.find(v=>v.file===s.file);if(prepared)assert.equal(prepared.sha256,sha(s.text),'Rendering module drift since review creation: '+s.file);}
  if(candidate.template){const t=templateHashes.find(t=>t.file===candidate.template.file);assert.ok(t,'Unknown frozen template set');assert.equal(t.sha256,candidate.template.sha256,'Template drift since review creation');}
  audit.source={path:sourcePath,fileSha256:identity.sourceFileHash,draftSha256:identity.sourceHash};audit.planId=plan.planId;
  audit.candidateQuality={mechanicalPassed:candidate.mechanicalPassed===true,documentReview:candidate.documentReview||null,
    passedSections:candidate.results.filter(r=>r.quality?.mechanicalPassed).length,retainedOriginalSections:candidate.results.filter(r=>!r.quality?.mechanicalPassed).length};
  audit.inputs=[...guards].map(([file,sha256])=>({file,sha256}));
  audit.sectionStatus=candidate.results.map(r=>({number:r.number,key:r.key,status:r.status,mechanicalPassed:!!r.quality?.mechanicalPassed,
    afterSha256:sha(r.after||''),renderedSha256:sha(r.renderedHtml),canonicalSha256:sha(r.canonicalHtml),originalRetained:!r.quality?.mechanicalPassed?r.renderedHtml===r.canonicalHtml:null}));
  const rendered=await page.evaluate(({draft,rows,QA,CAVEAT})=>{
    const dom=html=>new DOMParser().parseFromString(html,'text/html');
    function figureTexts(document){
      const tables=[...document.querySelectorAll('table')];
      return [...document.querySelectorAll('figure')].flatMap((figure,index)=>{
        const ownTables=tables.filter(t=>t.closest('figure')===figure),out=[];
        // Catalogue captions can move to their native table. Compare each true
        // table/continuation title at that table, not at its editor UI position.
        for(const table of ownTables){
          const heading=table.closest('.rpt-template-segment')?.querySelector('.rpt-template-segment-title')||figure.querySelector('figcaption b')||figure.querySelector('figcaption');
          if(!heading)continue;
          const copy=heading.cloneNode(true);
          copy.querySelectorAll('span').forEach(n=>{if(/标准模板\s*v\S+\s*·\s*项目数据待填/.test(n.textContent))n.remove();});
          const text=copy.textContent.trim().replace(/^表[：:]\s*/,'');
          if(text)out.push({figure:index,kind:'caption',text,tablesBefore:tables.indexOf(table)});
        }
        function visit(node){
          if(![1,3].includes(node.nodeType)||!node.textContent.trim())return;
          if(node.nodeType===1&&(node.matches('table,button,figure,figcaption,.rpt-template-segment-title')||node.tagName==='SUMMARY'&&/按原报告年度容量分段/.test(node.textContent)))return;
          if(node.nodeType===1&&node.querySelector('table,figure,figcaption,.rpt-template-segment-title,p,h1,h2,h3,h4,h5,h6,blockquote,li,div')){
            node.childNodes.forEach(visit);return;
          }
          // Preserve note order and its boundary relative to preceding/following
          // tables. Moving a note across a table must never pass this gate.
          const tablesBefore=tables.filter(t=>t.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING).length;
          out.push({figure:index,kind:'note',text:node.textContent.trim(),tablesBefore});
        }
        figure.childNodes.forEach(visit);
        return out;
      });
    }
    const entries=rows.map(r=>({key:r.key,html:r.renderedHtml,context:{type:'gaibao-housing',chapter:r.chapter,section:r.title,number:r.number}}));
    const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
    const again=ReportSectionLayout.composeDocument(entries.map((e,i)=>({...e,html:composed[i]})),ReportTableTemplates);
    const records=rows.map((r,i)=>{
      const blocks=htmlToBlocks(r.renderedHtml),afterHtml=MD.renderHtml(r.after||''),document=dom(r.renderedHtml),outsideTables=document.body.cloneNode(true);
      outsideTables.querySelectorAll('table,button').forEach(n=>n.remove());
      return {number:r.number,key:r.key,ci:r.ci,si:r.si,mechanicalPassed:!!r.quality?.mechanicalPassed,frozenHtml:r.renderedHtml,
        afterHtml,composedHtml:composed[i],composedUnchanged:composed[i]===r.renderedHtml,
        composedContentEquivalent:frozenCompositionContentEqual(r.renderedHtml,composed[i]),
        idempotent:again[i]===composed[i],idempotentContentEquivalent:frozenCompositionContentEqual(composed[i],again[i]),blocks,
        sourceParagraphs:[...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,blockquote,li')].filter(n=>!n.closest('table,figure')&&!n.querySelector('p,li,blockquote')).map(n=>n.textContent),
        sourceFigureTexts:figureTexts(document),
        sourceOutsideTableText:outsideTables.textContent,
        tables:[...dom(r.renderedHtml).querySelectorAll('table')].map(t=>({html:t.outerHTML,cells:[...t.querySelectorAll('td,th')].map(c=>c.textContent.trim())})),
        warnings:[...dom(r.renderedHtml).querySelectorAll('.rpt-table-conflict,.rpt-layout-warning')].map(e=>e.textContent.trim())};
    });
    const chapters=[];
    for(const [i,r] of rows.entries()){
      let c=chapters.find(c=>c.num===r.ci+1);if(!c){c={num:r.ci+1,cn:draft.chapters[r.ci].cn,name:r.chapter,sections:[]};chapters.push(c);}
      const boundary='【待补：QA审阅边界：'+(r.quality?.mechanicalPassed?'机械检查通过，事实与全篇成稿仍待人工核验。':'本节未通过，以下完整保留原稿，不代表已精简或财务可行。')+'】';
      const blocks=[{type:'p',text:boundary},...records[i].blocks];
      if(!/依据/.test(r.key)&&/财务|盈利|项目可行性结论/.test(r.key))blocks.unshift({type:'p',text:'【待补：'+CAVEAT+'】'});
      records[i].exportBlocks=blocks;records[i].bookmark='_tc'+chapters.indexOf(c)+'_'+c.sections.length;
      c.sections.push({num:r.si+1,title:r.title,blocks});
    }
    return {records,payload:{project:{...draft.project,name:(draft.project?.name||'完整报告')+'（未审定 QA 副本）'},signed:false,docNo:'QA-FULL-REVIEW',versionNote:QA,unsignedNote:QA+' '+CAVEAT,chapters}};
  },{draft,rows:candidate.results,QA,CAVEAT});
  await save('composition.json',rendered);
  audit.composition={comparison:'Exact ordered top-level DOM nodes; ignore only whitespace-only top-level text nodes',
    byteChangedSections:rendered.records.filter(r=>!r.composedUnchanged).map(r=>r.number),
    contentChangedSections:rendered.records.filter(r=>!r.composedContentEquivalent).map(r=>r.number),
    byteNonIdempotentSections:rendered.records.filter(r=>!r.idempotent).map(r=>r.number),
    contentNonIdempotentSections:rendered.records.filter(r=>!r.idempotentContentEquivalent).map(r=>r.number)};
  if(rendered.records.some(r=>!r.composedContentEquivalent||!r.idempotentContentEquivalent))audit.errors.push('Frozen HTML content is not composition-idempotent; the export keeps frozen HTML rather than silently rewriting it');
  await save('review.html','<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'"><title>完整 QA 副本</title><style>body{max-width:1050px;margin:auto;line-height:1.6}.qa{color:#b40000;border:2px solid #b40000;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #777}</style><h1>完整报告：未审定 QA 副本</h1><p class="qa">'+escape(QA+' '+CAVEAT)+'</p>'+rendered.records.map(r=>'<section><h2>'+escape(r.number+' '+r.key)+'</h2><p class="qa">'+escape(r.mechanicalPassed?'机械通过；事实未审签':'未通过，原稿完整保留')+'</p>'+r.frozenHtml+'</section>').join('\n'));
  const bytes=await D.Packer.toBuffer(build(D,rendered.payload)),docxFile=path.join(out,'full-review.docx');await save('full-review.docx',bytes);
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
  const detail=await page.evaluate(({xml,records,selfTest})=>{
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',p=new DOMParser(),d=p.parseFromString(xml,'application/xml');
    if(d.querySelector('parsererror'))throw Error('DOCX XML malformed');
    const norm=v=>ReportOutputPolicy.cleanText(String(v||'')).replace(/\s/g,''),text=n=>[...n.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join('');
    const direct=(n,name)=>[...n.children].filter(c=>c.localName===name),attr=(n,name)=>n?.getAttributeNS(ns,name)||n?.getAttribute('w:'+name);
    function htmlGrid(html){const t=p.parseFromString(html,'text/html').querySelector('table'),grid=[];
      for(const [ri,row] of [...t.rows].entries()){grid[ri]||=[];let col=0;for(const cell of row.cells){while(grid[ri][col]!==undefined)col++;
        for(let dr=0;dr<(cell.rowSpan||1);dr++){grid[ri+dr]||=[];for(let dc=0;dc<(cell.colSpan||1);dc++)grid[ri+dr][col+dc]=norm(cell.textContent);}col+=cell.colSpan||1;}}
      return grid;
    }
    function wordGrid(table){const grid=[];for(const [ri,row] of direct(table,'tr').entries()){grid[ri]=[];let col=0;for(const cell of direct(row,'tc')){
      const pr=direct(cell,'tcPr')[0],span=Number(attr(pr&&direct(pr,'gridSpan')[0],'val')||1),merge=pr&&direct(pr,'vMerge')[0];
      const value=merge&&attr(merge,'val')!=='restart'?(grid[ri-1]?.[col]??''):norm(text(cell));
      for(let j=0;j<span;j++)grid[ri][col++]=value;}}return grid;}
    function htmlGeometry(html){
      const table=p.parseFromString(html,'text/html').querySelector('table'),occupied=[],cells=[];
      for(const [row,tr] of [...table.rows].entries()){
        occupied[row]||=[];let col=0;
        for(const cell of tr.cells){
          while(occupied[row][col])col++;
          const colSpan=Math.max(1,cell.colSpan||1),rowSpan=Math.min(table.rows.length-row,cell.rowSpan===0?table.rows.length-row:Math.max(1,cell.rowSpan||1));
          cells.push({row,col,rowSpan,colSpan});
          for(let dr=0;dr<rowSpan;dr++){occupied[row+dr]||=[];for(let dc=0;dc<colSpan;dc++)occupied[row+dr][col+dc]=true;}
          col+=colSpan;
        }
      }
      return {rows:table.rows.length,cells,physicalCells:cells.reduce((n,c)=>n+c.rowSpan,0)};
    }
    function wordGeometry(table){
      const rows=direct(table,'tr'),cells=[],issues=[];let prior=new Map(),physicalCells=0;
      for(const [row,tr] of rows.entries()){
        let col=Number(attr(direct(direct(tr,'trPr')[0]||tr,'gridBefore')[0],'val')||0);const next=new Map();
        for(const cell of direct(tr,'tc')){
          physicalCells++;const pr=direct(cell,'tcPr')[0],colSpan=Number(attr(pr&&direct(pr,'gridSpan')[0],'val')||1),merge=pr&&direct(pr,'vMerge')[0];
          if(merge&&attr(merge,'val')!=='restart'){
            const anchor=prior.get(col);
            if(!anchor||anchor.colSpan!==colSpan||Array.from({length:colSpan},(_,i)=>prior.get(col+i)).some(c=>c!==anchor))issues.push({row,col,reason:'Invalid vertical merge continuation'});
            else{anchor.rowSpan++;for(let dc=0;dc<colSpan;dc++)next.set(col+dc,anchor);}
          }else{
            const anchor={row,col,rowSpan:1,colSpan};cells.push(anchor);
            if(merge)for(let dc=0;dc<colSpan;dc++)next.set(col+dc,anchor);
          }
          col+=colSpan;
        }
        prior=next;
      }
      return {geometry:{rows:rows.length,cells,physicalCells},issues};
    }
    function missingFigureItems(items,paragraphs){
      const missing=[];
      for(const kind of ['caption','note']){
        const cursors=new Map();
        for(const item of items.filter(item=>item.kind===kind)){
          const value=norm(item.text);if(!value)continue;
          const joined=paragraphs.filter(p=>p.tablesBefore===item.tablesBefore).map(p=>p.text).join(''),cursor=cursors.get(item.tablesBefore)||0;
          const found=joined.indexOf(value,cursor);if(found<0)missing.push(item);else cursors.set(item.tablesBefore,found+value.length);
        }
      }
      return missing;
    }
    const occurrences=(text,value)=>value?text.split(value).length-1:0;
    function repeatedFigureNotes(items,sourceText,wordText){
      return [...new Set(items.filter(i=>i.kind==='note').map(i=>norm(i.text)).filter(Boolean))].flatMap(text=>{
        const source=occurrences(norm(sourceText),text),word=occurrences(wordText,text);
        return word>source?[{text,source,word}]:[];
      });
    }
    const selfTests=[];
    if(selfTest){
      const check=(condition,message)=>{if(!condition)throw Error('QA self-test: '+message);selfTests.push(message);};
      const tableXml=body=>p.parseFromString('<w:tbl xmlns:w="'+ns+'">'+body+'</w:tbl>','application/xml').documentElement;
      const cell=(properties='',value='')=>'<w:tc><w:tcPr>'+properties+'</w:tcPr><w:p><w:r><w:t>'+value+'</w:t></w:r></w:p></w:tc>';
      const merged=tableXml('<w:tr>'+cell('<w:gridSpan w:val="2"/>')+'</w:tr>');
      const split=tableXml('<w:tr>'+cell()+cell()+'</w:tr>');
      check(JSON.stringify(wordGrid(merged))===JSON.stringify(wordGrid(split))&&JSON.stringify(wordGeometry(merged).geometry)!==JSON.stringify(wordGeometry(split).geometry),'Equal logical grids cannot hide lost horizontal merges');
      const vertical=tableXml('<w:tr>'+cell('<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>','锚点')+cell('','右上')+'</w:tr><w:tr>'+cell('<w:gridSpan w:val="2"/><w:vMerge/>')+cell('','右下')+'</w:tr>');
      const sourceGeometry=htmlGeometry('<table><tr><td colspan="2" rowspan="2">锚点</td><td>右上</td></tr><tr><td>右下</td></tr></table>');
      check(JSON.stringify(wordGeometry(vertical).geometry)===JSON.stringify(sourceGeometry)&&!wordGeometry(vertical).issues.length,'Combined row and column merges preserve physical geometry');
      const invalid=tableXml('<w:tr>'+cell('<w:vMerge/>')+'</w:tr>');
      check(wordGeometry(invalid).issues.length===1,'Orphan vertical merge continuation rejected');
      const notes=[{kind:'caption',text:'表格标题',tablesBefore:0},{kind:'note',text:'说明必须保留',tablesBefore:0},{kind:'note',text:'待确认口径',tablesBefore:0}];
      check(!missingFigureItems(notes,[{text:'说明必须保留待确认口径表格标题',tablesBefore:0}]).length&&missingFigureItems(notes,[{text:'表格标题待确认口径',tablesBefore:0}]).length===1,'Native caption relocation allowed but missing figure notes rejected');
      check(missingFigureItems(notes,[{text:'表格标题待确认口径说明必须保留',tablesBefore:0}]).length===1,'Reordered substantive figure notes rejected');
      check(missingFigureItems(notes,[{text:'表格标题说明必须保留',tablesBefore:0},{text:'待确认口径',tablesBefore:1}]).length===1,'Figure note moved across a table rejected');
      check(repeatedFigureNotes(notes,'表格标题说明必须保留待确认口径','表格标题说明必须保留待确认口径待确认口径').length===1,'Unexpected repeated figure note rejected');
    }
    const sections=new Map(records.map(r=>[r.bookmark,{paragraphs:[],paragraphPositions:[],tables:[],geometry:[],geometryIssues:[]}])) ;let active=null;
    const body=d.getElementsByTagNameNS(ns,'body')[0];
    for(const node of body.children){
      const starts=[...node.getElementsByTagNameNS(ns,'bookmarkStart')].map(n=>attr(n,'name'));
      const begin=starts.find(n=>sections.has(n));if(begin)active=begin;
      if(active){const s=sections.get(active);if(node.localName==='tbl'){s.tables.push(wordGrid(node));const shape=wordGeometry(node);s.geometry.push(shape.geometry);s.geometryIssues.push(...shape.issues.map(issue=>({table:s.tables.length-1,...issue})));}else if(node.localName==='p'&&!begin&&norm(text(node))){s.paragraphs.push(norm(text(node)));s.paragraphPositions.push({text:norm(text(node)),tablesBefore:s.tables.length});}}
      if(starts.some(n=>/^_rp_end_\d+_\d+$/.test(n)))active=null;
    }
    const rows=records.map(r=>{
      const s=sections.get(r.bookmark),expected=[];
      for(const b of r.exportBlocks){if(b.type==='table'||b.type==='templateTable')continue;const v=norm(b.text);if(v)expected.push(v);}
      let cursor=0;const missing=[];for(const value of expected){const found=s.paragraphs.indexOf(value,cursor);if(found<0)missing.push(value);else cursor=found+1;}
      const joined=s.paragraphs.join('');cursor=0;const sourceMissing=[];
      for(const value of r.sourceParagraphs.map(norm).filter(Boolean)){const found=joined.indexOf(value,cursor);if(found<0)sourceMissing.push(value);else cursor=found+value.length;}
      const missingFigureTexts=missingFigureItems(r.sourceFigureTexts,s.paragraphPositions),repeatedFigureTexts=repeatedFigureNotes(r.sourceFigureTexts,r.sourceOutsideTableText,joined);
      const tables=r.tables.map(t=>htmlGrid(t.html)),geometry=r.tables.map(t=>htmlGeometry(t.html));return {number:r.number,bookmark:r.bookmark,paragraphsExpected:expected.length,paragraphsWord:s.paragraphs.length,
        sourceParagraphs:r.sourceParagraphs.length,missingSourceParagraphs:sourceMissing,
        sourceFigureTexts:r.sourceFigureTexts.length,missingFigureTexts,repeatedFigureTexts,
        missingParagraphs:missing,tablesExpected:tables.length,tablesWord:s.tables.length,cellsExpected:tables.reduce((n,t)=>n+t.reduce((a,row)=>a+row.length,0),0),
        cellsWord:s.tables.reduce((n,t)=>n+t.reduce((a,row)=>a+row.length,0),0),tableGridsMatch:JSON.stringify(tables)===JSON.stringify(s.tables),
        tableGeometryMatch:!s.geometryIssues.length&&JSON.stringify(geometry)===JSON.stringify(s.geometry),tableGeometryIssues:s.geometryIssues,
        physicalCellsExpected:geometry.reduce((n,t)=>n+t.physicalCells,0),physicalCellsWord:s.geometry.reduce((n,t)=>n+t.physicalCells,0),
        expectedGeometry:geometry,wordGeometry:s.geometry,expectedTables:tables,wordTables:s.tables};
    });
    const qaRuns=[...d.getElementsByTagNameNS(ns,'r')].filter(n=>text(n).includes('【待补：QA审阅边界：'));
    const qaRed=qaRuns.every(n=>[...n.getElementsByTagNameNS(ns,'color')].some(c=>attr(c,'val')==='C62828'));
    return {sections:rows,selfTests,wordTableCount:d.getElementsByTagNameNS(ns,'tbl').length,wordParagraphCount:d.getElementsByTagNameNS(ns,'p').length,
      qaBoundaries:{count:qaRuns.length,allRed:qaRed},physicalCells:d.getElementsByTagNameNS(ns,'tc').length,
      documentText:text(d),unresolvedMarkers:/\[\[\/?TABLE\]\]|@@TABLE_\d+@@/.test(text(d))};
  },{xml,records:rendered.records,selfTest});
  await save('word-content.json',detail);
  audit.docx={file:docxFile,sha256:sha(bytes),bytes:bytes.length,sections:detail.sections.length,tables:detail.wordTableCount,
    paragraphs:detail.wordParagraphCount,cells:detail.sections.reduce((n,s)=>n+s.cellsWord,0),cellCountBasis:'Logical grid slots, including merged-cell expansion',
    physicalCells:detail.physicalCells,qaBoundaries:detail.qaBoundaries,unresolvedMarkers:detail.unresolvedMarkers,
    integrity:detail.sections.map(({expectedTables,wordTables,expectedGeometry,wordGeometry,...rest})=>rest)};
  if(detail.sections.some(r=>r.missingParagraphs.length||r.missingSourceParagraphs.length||r.missingFigureTexts.length||r.repeatedFigureTexts.length||!r.tableGridsMatch||!r.tableGeometryMatch)||detail.wordTableCount!==detail.sections.reduce((n,s)=>n+s.tablesExpected,0)||detail.unresolvedMarkers)
    audit.errors.push('Per-section Word paragraph/table/cell completeness failed; see word-content.json');
  if(detail.qaBoundaries.count!==43||!detail.qaBoundaries.allRed)audit.errors.push('Every section must retain a visible red QA boundary in the actual DOCX');
  if(selfTest){
    assert.ok(!detail.documentText.includes('不得导出的失败候选错误内容'));assert.equal(detail.sections.length,43);
    for(const note of ['独立表前说明必须保留。','独立表后说明必须保留。','独立表格口径仍待签认。','合并表下注不能丢失。'])assert.ok(detail.documentText.includes(note),'Fixture figure note missing: '+note);
    assert.ok(detail.sections[2].sourceFigureTexts>=4&&detail.sections[3].sourceFigureTexts>=2,'Fixture notes and captions must be included in independent source checks');
    audit.selfTests.push(...detail.selfTests,'43 sections exported; figure notes and merged cells preserved; failed after excluded; canonical original retained');
  }
  if(renderFlag){
    assert.equal(process.platform,'win32','Actual pagination requires this WPS adapter');
    const layout=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'local-server/report-pagination.ps1'),'-InputDocx',docxFile],{timeout:240000,windowsHide:true,maxBuffer:4*1024*1024});
    audit.layout={...JSON.parse(layout.stdout.trim().replace(/^\uFEFF/,'')),documentSha256:sha(bytes),scope:'Full QA copy, including visible QA notices'};
    assert.ok(Number.isInteger(audit.layout.pages)&&audit.layout.pages>0);
    const ranges=audit.layout.diagnostics?.sections||[],tableRanges=audit.layout.diagnostics?.tables||[];
    audit.sectionPageRanges=rendered.records.map(r=>({number:r.number,bookmark:r.bookmark,...ranges.find(s=>s.bookmark===r.bookmark)}));
    if(ranges.length!==43||audit.sectionPageRanges.some(s=>!s.startPage||!s.endPage||s.endPage<s.startPage||s.endPage>audit.layout.pages)||tableRanges.length!==detail.wordTableCount)
      audit.errors.push('WPS section/table page-range coverage incomplete');
    const tableCoverage=compareWpsTableCounts(detail.sections,tableRanges);audit.sectionTableCounts=tableCoverage.counts;
    if(!tableCoverage.matches)
      audit.errors.push('WPS per-section table counts differ from the frozen HTML / OOXML');
    audit.tablePageRanges=tableRanges;
    audit.pageGate={status:audit.layout.pages<=120?'passed':'overlimit',limit:120,pages:audit.layout.pages,
      doesNotCertifyContent:true,note:'Exact QA document hash only; QA notices count toward pages. No truncation or font shrinking.'};
    const pdfFile=path.join(out,'full-review.pdf'),render=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/render-report-copy.ps1'),'-InputDocx',docxFile,'-OutputPdf',pdfFile],{timeout:240000,windowsHide:true,maxBuffer:2*1024*1024});
    const poppler=path.resolve(popplerArg),info=await execute(path.join(poppler,'pdfinfo.exe'),[pdfFile],{timeout:20000,windowsHide:true});
    audit.pdf={file:pdfFile,sha256:sha(await fs.readFile(pdfFile)),renderLog:render.stdout.trim(),pages:Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1])};
    assert.equal(audit.pdf.pages,audit.layout.pages,'PDF and WPS physical page counts disagree');
    const textBinary=path.join(poppler,'pdftotext.exe');
    let hasTextBinary=true;try{await fs.access(textBinary);}catch(error){if(error.code!=='ENOENT')throw error;hasTextBinary=false;}
    if(hasTextBinary){
      await execute(textBinary,['-layout',pdfFile,path.join(out,'full-review.txt')],{timeout:30000,windowsHide:true});
      audit.pdf.textExtractor='poppler-pdftotext-layout';
    }else{
      // The desktop Poppler bundle contains pdfinfo/pdftoppm, but not always
      // pdftotext. Keep text inspection available without another installation.
      const pdfjs=await import(pathToFileURL(bundledRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
      const pdf=await pdfjs.getDocument({data:new Uint8Array(await fs.readFile(pdfFile)),useSystemFonts:true}).promise;
      try{
        assert.equal(pdf.numPages,audit.pdf.pages,'Text extraction and rendered page counts disagree');
        const pageTexts=[];
        for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
          const pdfPage=await pdf.getPage(pageNumber),content=await pdfPage.getTextContent();
          pageTexts.push(content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join(''));
        }
        await save('full-review.txt',pageTexts.join('\n\f\n'));
        audit.pdf.textExtractor='pdfjs-text-content-not-layout';
      }finally{await pdf.destroy();}
    }
    await execute(path.join(poppler,'pdftoppm.exe'),['-r','100','-png',pdfFile,path.join(out,'page')],{timeout:300000,windowsHide:true,maxBuffer:2*1024*1024});
    audit.pdf.images=(await fs.readdir(out)).filter(f=>/^page-\d+\.png$/.test(f)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
    assert.equal(audit.pdf.images.length,audit.pdf.pages);audit.pdf.dpi=100;
    audit.visualReviewRequired=audit.pdf.images; // Rendering every page is not visual acceptance.
  }
}catch(error){audit.errors.push(error.stack||error.message);process.exitCode=1;}
finally{
  if(browser)await browser.close();audit.sourcesUnchanged=true;
  for(const [file,before] of guards)if(sha(await fs.readFile(file))!==before)audit.sourcesUnchanged=false;
  if(!audit.sourcesUnchanged)audit.errors.push('A guarded input changed while auditing');
  audit.technicalIntegrityPassed=audit.errors.length===0;if(audit.errors.length)process.exitCode=1;
  await save('audit.json',audit);console.log(JSON.stringify({out,selfTests:audit.selfTests,sections:audit.docx?.sections,tables:audit.docx?.tables,
    pageGate:audit.pageGate,technicalIntegrityPassed:audit.technicalIntegrityPassed,readyForPublication:false,errors:audit.errors}));
}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
