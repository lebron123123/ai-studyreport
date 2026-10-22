// Offline integration audit only. No DB, AI, app bootstrap, or source writes.
// Usage: node scripts/audit-report-root-contract.mjs [--export] [--candidate FILE]
//        node scripts/audit-report-root-contract.mjs --source FILE --label NAME
//               [--type gaibao-housing|gaibao-commercial|rent|sale] [--export]
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2),options={export:false};
for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--export')options.export=true;
  else if(key==='--help')options.help=true;
  else if(['--source','--label','--type','--candidate'].includes(key)&&args[i+1]&&!args[i+1].startsWith('--'))options[key.slice(2)]=args[++i];
  else throw Error('Unknown/incomplete argument: '+key);
}
if(options.help){
  console.log('Offline snapshots only; never changes DB, sources, candidates or project state.\n'+
    '--source FILE --label NAME [--type TYPE] : audit one source; default audits tax + Longgang snapshots.\n'+
    '--candidate FILE : also audit this candidate against Longgang (or --source), verifying source hash.\n'+
    '--export : emit unapproved QA DOCX copies; no actual page-count or visual acceptance is claimed.\n'+
    'Every run creates outputs/report-standardization/root-contract-<timestamp>-<random>/.');
  process.exit(0);
}
if(options.type&&!['gaibao-housing','gaibao-commercial','rent','sale'].includes(options.type))throw Error('Unsupported project type');
if(options.label&&!/^[a-zA-Z0-9_-]{1,60}$/.test(options.label))throw Error('Label must be a safe ASCII file stem');
const inputs=options.source?[{label:options.label||'snapshot',file:options.source,type:options.type}]:[
  {label:'tax',file:'outputs/report-standardization/tax-source.json',type:'gaibao-housing'},
  {label:'longgang',file:'outputs/report-standardization/longgang-source.json',type:'gaibao-housing'}
];
const guards=new Map();
async function readJson(file){
  const absolute=path.resolve(root,file),bytes=await fs.readFile(absolute);
  guards.set(absolute,hash(bytes));
  return {value:JSON.parse(bytes.toString('utf8')),file:absolute,sha256:hash(bytes)};
}
const loaded=[];
for(const input of inputs){
  const source=await readJson(input.file),state=source.value.state||source.value,draft=state.draft||state;
  if(!Array.isArray(draft.chapters))throw Error('Snapshot has no chapter array: '+input.file);
  const type=input.type||(draft.project?.businessScenario==='commercial_renovation'?'gaibao-commercial':'gaibao-housing');
  loaded.push({...input,...source,draft,type});
}
if(options.candidate){
  const source=loaded.at(-1),candidate=await readJson(options.candidate);
  if(candidate.value.sourceHash!==hash(JSON.stringify(source.draft)))throw Error('Candidate does not match the exact source draft');
  if(!Array.isArray(candidate.value.results))throw Error('Candidate has no result array');
  const statuses=new Set(['reviewed','protected','unverified','blocked','failed','pending','draft','qa-only']),seen=new Set();
  for(const result of candidate.value.results){
    const section=Number.isInteger(result.ci)&&Number.isInteger(result.si)&&source.draft.chapters[result.ci]?.sections?.[result.si],key=result.ci+'/'+result.si;
    if(!section||seen.has(key))throw Error('Candidate section is invalid or duplicated: '+key);
    seen.add(key);
    if(result.chapter!==source.draft.chapters[result.ci].name||result.title!==section.t)throw Error('Candidate section identity mismatch: '+key);
    if(!statuses.has(result.status))throw Error('Unknown candidate status: '+result.status);
    if(result.status!=='protected'&&(typeof result.after!=='string'||!result.after.trim()))throw Error('Candidate has no renderable text: '+key);
    if(result.tables!==undefined&&!Array.isArray(result.tables))throw Error('Candidate frozen tables must be an array: '+key);
  }
  loaded.push({...source,label:source.label+'-candidate',candidate});
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),outDir=path.join(root,'outputs','report-standardization','root-contract-'+stamp+'-'+randomBytes(3).toString('hex'));
await fs.mkdir(path.dirname(outDir),{recursive:true});
await fs.mkdir(outDir); // No reuse or overwrite of a previous run.
const scriptFiles=['md.js','report-output-policy.js','report-table-templates.js','report-section-layout.js','export.js','report-length-plan.js','report-completion-contract.js'];
const scripts=await Promise.all(scriptFiles.map(async file=>({file,text:await fs.readFile(path.join(root,file),'utf8')})));
const templates={};
for(const type of ['rent','gaibao-housing','gaibao-commercial']){
  const file='data/report-table-templates-'+type+'-v1.json';
  templates[file]=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
}
const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
const audit={createdAt:new Date().toISOString(),outputDirectory:outDir,scope:'offline snapshot integration audit',
  network:'blocked; local template JSON only; no DB, AI or app bootstrap',templateScope:'bundled baseline; published DB overrides are NOT loaded',
  semanticFactsVerified:false,paginationVerified:false,visualAcceptance:false,
  notes:['This checks source preservation hints and structural budgets, not factual correctness or final page count.',
    'Raw counts and composed counts are separate; a source-cell coverage hint is not proof that a business fact was lost.',
    'Exports are isolated, unapproved QA copies. Existing drafts and candidates remain unchanged.'],
  scripts:scripts.map(s=>({file:s.file,sha256:hash(s.text)})),documents:[]};
try{
  for(const item of loaded){
    const page=await browser.newPage();
    try{
      await page.route('**/*',route=>route.abort('blockedbyclient'));
      await page.evaluate(local=>{window.fetch=async url=>{
        const key=String(url).replace(/^\.\//,'');
        if(Object.hasOwn(local,key))return {ok:true,json:async()=>structuredClone(local[key])};
        if(key.startsWith('/api/reporttables?'))return {ok:true,json:async()=>({ok:true,config:null})};
        throw Error('Offline audit blocked fetch: '+key);
      };},templates);
      for(const script of scripts)await page.addScriptTag({content:script.text});
      const draft=item.draft;
      const result=await page.evaluate(async({draft,name,type,candidate})=>{
        if(type!=='sale')await ReportTableTemplates.load(type);
        window.reportTableProjectType=()=>type;
        const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const parser=new DOMParser(),text=html=>parser.parseFromString(html,'text/html').body.textContent.replace(/\s/g,'');
        const active=draft.chapters.map((chapter,ci)=>({chapter,ci})).filter(x=>x.chapter.checked!==false),entries=[],candidateApplication=[];
        for(const {chapter:c,ci} of active)for(const [si,s] of c.sections.entries()){
          let html=s.editedHtml||MD.renderHtml(ReportOutputPolicy.normalize(s.content||''));
          if(candidate){
            const hits=candidate.results.filter(r=>r.ci===ci&&r.si===si);
            if(hits.length>1||(!hits.length&&candidate.partial!==true))throw Error('Candidate does not uniquely cover section '+ci+'/'+si);
            const r=hits[0];
            candidateApplication.push({number:(ci+1)+'.'+(si+1),status:r?.status||'not-in-partial-candidate',applied:!!r&&r.status!=='protected',sourcePreserved:!r||r.status==='protected',qaOnly:true});
            if(r&&r.status!=='protected'){
            if(r.title!==s.t||r.chapter!==c.name)throw Error('Candidate section identity mismatch');
            html=MD.renderHtml(r.after);
            for(let i=0;i<(r.tables||[]).length;i++)html=html.replace(new RegExp('<p>\\s*@@TABLE_'+i+'@@\\s*</p>|@@TABLE_'+i+'@@'),()=>r.tables[i]);
            if(/@@TABLE_/.test(html))throw Error('Unresolved candidate table placeholder');
            const actual=[...parser.parseFromString(html,'text/html').querySelectorAll('table')].map(t=>t.outerHTML);
            if(JSON.stringify(actual)!==JSON.stringify(r.tables||[]))throw Error('Frozen candidate table changed: '+r.title);
            }
          }
          entries.push({key:c.name+' / '+s.t,ci,si,html,context:{type,chapter:c.name,section:s.t,number:(ci+1)+'.'+(si+1)}});
        }
        const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
        const second=ReportSectionLayout.composeDocument(entries.map((entry,i)=>({...entry,html:composed[i]})),ReportTableTemplates);
        const tableShapes={};
        for(const entry of entries){
          const ts=type==='sale'?[]:ReportTableTemplates.forSection(type,entry.context.chapter,entry.context.section);
          tableShapes[entry.key]={tables:ts.reduce((n,t)=>n+(t.segments||[]).length,0),rows:ts.reduce((n,t)=>n+(t.segments||[]).reduce((a,g)=>a+(g.rows||[]).length,0),0)};
        }
        const p=draft.calcParams||{},inputs={name:draft.project?.name,area:p.area,units:p.units,operateYears:p.operateYears,mode:p.mode};
        // Mirror reportCompletionFacts/Plan: derived conflicts and input identity
        // must not disappear just because this run is an isolated QA export.
        const facts=Array.isArray(draft.workflow?.reportCompletion?.facts)?draft.workflow.reportCompletion.facts.map(f=>{
          const inputValue=inputs[f.key],numeric=['area','units','operateYears'].includes(f.key)&&String(f.value).trim()!==''&&Number.isFinite(Number(f.value))&&Number.isFinite(Number(inputValue));
          const different=inputValue!=null&&(numeric?Number(inputValue)!==Number(f.value):String(inputValue)!==String(f.value));
          return {...f,inputValue:inputValue==null?null:String(inputValue),...(different?{status:'conflict',source:f.source+'；与当前项目/测算输入 '+inputValue+' 不一致，未自动改参数'}:{})};
        }):[['name','项目名称',inputs.name],['area','面积（㎡）',p.area],['units','套数',p.units],['operateYears','运营年限',p.operateYears],['mode','经营模式',p.mode]].filter(x=>x[2]!==undefined&&x[2]!==null&&x[2]!=='').map(([key,label,value])=>({key,label,value:String(value),status:'pending',source:'当前项目输入/测算假设，尚未与材料原件逐项核对',owner:'',required:false,inputValue:String(value)}));
        const projectType=type.startsWith('gaibao')?'gaibao':type;
        const inputVersion=ReportCompletionContract.fingerprint({projectName:draft.project?.name,params:p,type:projectType});
        const plan=ReportCompletionContract.createPlan(draft.chapters,{projectType,tableShapes,facts,budgets:draft.workflow?.reportCompletion?.budgets||{},inputVersion});
        const compactMetrics=html=>{const m=ReportCompletionContract.measure(html);delete m.tables;delete m.proseText;return m;};
        const fullText=text(composed.join('\n')),coverageHints=[];
        for(const entry of entries){
          const cells=[...parser.parseFromString(entry.html,'text/html').querySelectorAll('td,th')].map(c=>c.textContent.trim()).filter(Boolean);
          for(const cell of new Set(cells))if(!fullText.includes(cell.replace(/\s/g,'')))coverageHints.push({section:entry.key,cell,kind:'source-cell-not-exactly-visible'});
        }
        const firstDifference=(a,b)=>{if(a===b)return null;let at=0;while(at<Math.min(a.length,b.length)&&a[at]===b[at])at++;return {offset:at,first:a.slice(Math.max(0,at-100),at+500),second:b.slice(Math.max(0,at-100),at+500)};};
        const sections=entries.map((entry,i)=>({key:entry.key,source:compactMetrics(entry.html),composed:compactMetrics(composed[i]),secondCompose:compactMetrics(second[i]),idempotent:composed[i]===second[i],firstDifference:firstDifference(composed[i],second[i]),warnings:[...parser.parseFromString(composed[i],'text/html').querySelectorAll('.rpt-table-conflict,.rpt-layout-warning')].map(x=>x.textContent)}));
        const sourceReview=ReportCompletionContract.reviewDocument(entries.map(e=>({key:e.key,number:e.context.number,text:e.html})),plan);
        const composedReview=ReportCompletionContract.reviewDocument(entries.map((e,i)=>({key:e.key,number:e.context.number,text:composed[i]})),plan);
        const payload={project:{...draft.project,name},signed:draft.signed,docNo:draft.docNo,
          versionNote:'QA-only 离线结构验收副本 · 未审定 · 未覆盖工作稿/候选/历史版本 · 未完成事实与排版验收',
          chapters:active.map(({chapter:c,ci})=>({cn:c.cn,num:ci+1,name:c.name,sections:c.sections.map((s,si)=>{const at=entries.findIndex(e=>e.ci===ci&&e.si===si);return {num:si+1,title:s.t,blocks:htmlToBlocks(composed[at])};})}))};
        const html='<!doctype html><meta charset="utf-8"><title>'+escape(name)+' 离线结构验收</title><style>body{max-width:1000px;margin:32px auto;font:16px SimSun;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px}figure{margin:20px 0}figcaption span{display:none}.audit-heading{margin-top:36px}</style><h1>'+escape(name)+'</h1><p>离线结构验收副本；不是最终报告或事实审签结果。</p>'+entries.map((e,i)=>'<h2 class="audit-heading">'+escape(e.context.number+' '+e.key)+'</h2>'+composed[i]).join('\n');
        return {html,payload,sections,plan,inputVersion,candidateApplication,sourceReview,composedReview,coverageHints,idempotent:JSON.stringify(composed)===JSON.stringify(second)};
      },{draft:{chapters:draft.chapters,project:draft.project,calcParams:draft.calcParams,workflow:draft.workflow,signed:draft.signed,docNo:draft.docNo},name:item.value.name||draft.project?.name||item.label,type:item.type,candidate:item.candidate?.value});
      await fs.writeFile(path.join(outDir,item.label+'.html'),result.html,{flag:'wx'});
      const document={label:item.label,qaOnly:true,source:{path:item.file,sha256:item.sha256,draftSha256:hash(JSON.stringify(item.draft))},candidate:item.candidate?{path:item.candidate.file,sha256:item.candidate.sha256,partial:item.candidate.value.partial===true,statusesPreserved:true,application:result.candidateApplication,factLedger:item.candidate.value.facts||null,factLedgerStatus:'candidate QA metadata only; not adopted into source workflow or independently verified'}:null,
        projectType:item.type,inputVersion:result.inputVersion,idempotent:result.idempotent,sourceReview:result.sourceReview,composedReview:result.composedReview,plan:result.plan,sections:result.sections,coverageHints:result.coverageHints};
      if(options.export){
        const D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
        const bytes=await D.Packer.toBuffer(build(D,result.payload));
        await fs.writeFile(path.join(outDir,item.label+'.docx'),bytes,{flag:'wx'});
        const xml=await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
        document.docx={file:item.label+'.docx',bytes:bytes.length,sha256:hash(bytes),tables:(xml.match(/<w:tbl>/g)||[]).length,rows:(xml.match(/<w:tr>/g)||[]).length,unresolvedTableMarkers:/\[\[\/?TABLE\]\]|@@TABLE_\d+@@/.test(xml),templateVersion:build.templateVersion,actualPages:null};
      }
      audit.documents.push(document);
      console.log(JSON.stringify({label:item.label,idempotent:document.idempotent,sourceStatus:result.sourceReview.status,composedStatus:result.composedReview.status,totals:result.composedReview.totals,coverageHints:result.coverageHints.length,docx:document.docx||null}));
    }finally{await page.close();}
  }
}finally{
  await browser.close();
  audit.sourcesUnchanged=true;
  for(const [file,before] of guards)if(hash(await fs.readFile(file))!==before){audit.sourcesUnchanged=false;break;}
  await fs.writeFile(path.join(outDir,'audit.json'),JSON.stringify(audit,null,2),{flag:'wx'});
}
console.log('Isolated audit: '+outDir);
if(!audit.sourcesUnchanged)throw Error('A source changed during audit; results are not a consistent snapshot');
if(audit.documents.some(d=>!d.idempotent))process.exitCode=2;
