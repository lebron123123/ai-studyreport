// Actual production Word composition and authenticated pagination, without AI,
// adoption, source-project writes, font changes, padding or a second template.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SOURCE_IDS,loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
import {installSavedFinancialBindingsReader} from './report-saved-financial-bindings.mjs';

const require=createRequire(import.meta.url);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ARTIFACT_ROOT=path.join(ROOT,'outputs/report-standardization');
const DEFAULT_SNAPSHOT='1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5';
const JSZip=createRequire(new URL('../local-server/server.js',import.meta.url))('jszip');
const policy=require('../report-output-policy.js');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const norm=value=>policy.cleanText(String(value??'')).replace(/\s/g,'');
const jsonRead=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const safe=error=>String(error?.message||error).replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]');
export const CURRENT_SAVED_TARGETS=Object.freeze({
  tax:Object.freeze({id:'f4395f64-af1b-43bd-b809-580b5ec9406b',name:'[系统测试]全量报告验收-tax-8c14644b'}),
  longgang:Object.freeze({id:'2884b7a3-960f-40c0-af89-5d19e0284836',name:'[系统测试]全量报告验收-longgang-d5470f22'})
});
export function stableWordJson(value){
  if(Array.isArray(value))return value.map(stableWordJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableWordJson(value[k])]));
  return value;
}
const canonical=value=>JSON.stringify(stableWordJson(value));
const objectSha=value=>sha(canonical(value));
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const isSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bodyOf=section=>String(section.editedHtml||section.content||'');
const taskOf=section=>section.executionTask||null;
const taskIdOf=section=>taskOf(section)?.id??null;
const noProjection=value=>!value?.intendedWorkingOnly&&!value?.diagnosticOnly&&!value?.intendedChapters&&!value?.intendedAcceptedBody;

// The manifest is an index, NEVER a review: each row must name a separately
// saved full-body review receipt and its byte SHA. It binds current adopted
// bytes/contract/task to the passed artifact. Nullable task IDs are explicit.
// version: current-saved-word-review-v1; projects[key]: {id,name,financial:{
// version,projectId,snapshotId,snapshotVersion,snapshotSha256,paramsSha256,
// sourceSignatureSha256}}; sources[key]: {sourceSha256,stateSha256}; rows: [{key,
// actualBodySha256,taskId,contractSha256,artifactSha256,
// reviewEvidence:{file,sha256}}]. Review files stay inside generation-runner.
export function validateCurrentSavedInput({key,opened,checkpoint,sources,manifest,artifacts,reviews}){
  const target=CURRENT_SAVED_TARGETS[key],remote=opened?.project,draft=remote?.data,source=sources?.[key];
  ensure(target&&remote?.id===target.id&&remote.name===target.name,'Exact saved test-project identity mismatch');
  ensure(noProjection(draft)&&noProjection(manifest),'Intended/candidate projection cannot certify current saved bodies');
  ensure(manifest?.version==='current-saved-word-review-v1','Missing supported independent review manifest');
  ensure(manifest.projects?.[key]?.id===target.id&&manifest.projects[key].name===target.name,'Review project identity mismatch');
  for(const sourceKey of ['tax','longgang']){
    const item=sources?.[sourceKey],identity=item?.sourceIdentity,binding=manifest.sources?.[sourceKey];
    ensure(identity&&(identity.projectId||identity.researchId)===SOURCE_IDS[sourceKey],'Formal source identity mismatch: '+sourceKey);
    ensure(binding?.sourceSha256===identity.sourceSha256&&binding.stateSha256===sha(JSON.stringify(item.state)),'Review source hash mismatch: '+sourceKey);
  }
  ensure(draft?.qaAcceptance?.version==='full-generation-acceptance-v1'&&draft.qaAcceptance.id===target.id&&draft.qaAcceptance.name===target.name,'Saved QA identity mismatch');
  ensure(draft.qaSourceStateSha256===sha(JSON.stringify(source.state))&&canonical(draft.qaSourceIdentity)===canonical(source.sourceIdentity),'Saved QA/source binding mismatch');
  ensure(checkpoint?.projects?.[key]?.name===target.name&&canonical(checkpoint.projects[key].sourceIdentity)===canonical(source.sourceIdentity),'Checkpoint QA/source identity mismatch');
  const state={...draft,projectId:target.id,sourceUnchanged:true,currentSaved:true,notIntendedProjection:true};
  const gate=generationGate(state,checkpoint,key,target,source.sourceIdentity.sourceSha256);
  ensure(gate.passed,'Current saved 43-section gate failed: '+gate.issues.join('; '));
  ensure(draft.chapters.length===checkpoint.projects[key].chapterCount&&draft.chapters.every(c=>c.checked!==false&&c.sections?.length)&&draft.chapters.flatMap(c=>c.sections||[]).length===43,'Saved directory is not the complete checked 43-section directory');
  ensure(Array.isArray(manifest.rows),'Missing independent review rows');
  const selectedRows=manifest.rows.filter(row=>String(row.key).startsWith(key+':'));
  ensure(selectedRows.length===43&&new Set(selectedRows.map(row=>row.key)).size===43,'Every saved section needs exactly one independent review');
  const audited=[];
  for(const row of gate.sections){
    const id=key+':'+row.number,reviewBinding=selectedRows.find(r=>r.key===id),entry=artifacts?.[id],artifact=entry?.value,section=row.section;
    ensure(reviewBinding,'Missing independent review: '+id);
    ensure(isSha(reviewBinding.artifactSha256)&&reviewBinding.artifactSha256===entry?.sha256,'Reviewed artifact SHA mismatch: '+id);
    ensure(checkpoint.sections[id].sectionKey===row.sectionKey&&artifact?.sectionKey===row.sectionKey&&artifact.key===key&&artifact.number===row.number&&artifact.status==='passed','Passed artifact/directory identity mismatch: '+id);
    ensure(!artifact.pendingRevision&&!artifact.error&&!(artifact.errors||[]).some(e=>e.severity!=='warning'),'Artifact has pending/unresolved technical errors: '+id);
    ensure(String(artifact.content||'')===String(section.content||'')&&String(artifact.editedHtml||'')===String(section.editedHtml||''),'Actual body differs from reviewed artifact: '+id);
    ensure(canonical(taskOf(artifact))===canonical(taskOf(section)),'Actual task differs from reviewed artifact: '+id);
    ensure(section.completionContract?.version&&canonical(artifact.completionContract)===canonical(section.completionContract),'Actual contract differs from reviewed artifact: '+id);
    const bodySha256=sha(bodyOf(section));
    ensure(reviewBinding.actualBodySha256===bodySha256&&reviewBinding.contractSha256===objectSha(section.completionContract),'Review body/contract SHA mismatch: '+id);
    ensure(owns(reviewBinding,'taskId')&&reviewBinding.taskId===taskIdOf(section),'Review task identity mismatch: '+id);
    const evidence=reviews?.[id],file=evidence?.value,evidenceBinding=reviewBinding.reviewEvidence;
    ensure(isSha(evidenceBinding?.sha256)&&evidenceBinding.sha256===evidence?.sha256&&noProjection(file),'Missing or changed independent full-body review: '+id);
    const matches=(file.rows||[]).filter(r=>r.key===id);
    ensure(matches.length===1,'Independent review must contain exactly one matching section: '+id);
    const review=matches[0];
    ensure((!file.projectId||file.projectId===target.id)&&(!review.projectId||review.projectId===target.id),'Independent review project mismatch: '+id);
    ensure(review.semanticStatus==='acceptable-full-body-at-bound-sha'&&review.exactActualMatch===true&&review.fullBodyRead===true&&review.semanticPassed===true&&review.technicalPassed===true&&review.conclusion==='acceptable'&&Array.isArray(review.findings)&&review.findings.length===0,'Not an independently read, acceptable full-body review: '+id);
    ensure(Number.isFinite(Date.parse(review.readAt||file.fullReadAt)),'Missing full-body review timestamp: '+id);
    ensure(review.actualBodySha256===bodySha256&&review.bodySha256===bodySha256&&review.sectionBodySha256===bodySha256&&owns(review,'taskId')&&review.taskId===taskIdOf(section),'Independent review body/task SHA mismatch: '+id);
    audited.push({key:id,sectionKey:row.sectionKey,actualBodySha256:bodySha256,taskId:taskIdOf(section),taskSha256:objectSha(taskOf(section)),contractSha256:reviewBinding.contractSha256,artifactSha256:entry.sha256,reviewEvidence:evidenceBinding,fullBodyRead:true,factsVerified:review.factsVerified===true});
  }
  const financial=manifest.projects[key].financial,snapshot=(draft.workflow?.calcSnapshots||[]).find(s=>s.id===draft.workflow.currentCalcSnapshotId);
  ensure(snapshot?.id&&snapshot.params&&snapshot.summary&&canonical(snapshot.params)===canonical(draft.calcParams),'Saved financial snapshot/parameters are missing or inconsistent');
  ensure((snapshot.projectId==null||snapshot.projectId===target.id)&&financial?.projectId===target.id&&financial.version==='calc-tables-v2'&&financial.snapshotId===snapshot.id&&financial.snapshotVersion===(snapshot.version??null)&&financial.snapshotSha256===objectSha(snapshot)&&financial.paramsSha256===objectSha(draft.calcParams)&&isSha(financial.sourceSignatureSha256),'Review financial version/identity mismatch');
  return {state,gate,financial,sections:audited};
}

export function validateCurrentSavedFinancial(expected,binding,issues=[]){
  ensure(binding?.version===expected.version&&binding.projectId===expected.projectId&&binding.snapshotId===expected.snapshotId&&binding.snapshotVersion===expected.snapshotVersion&&sha(binding.sourceSignature||'')===expected.sourceSignatureSha256,'Production financial identity differs from independent review binding');
  ensure(issues.length===0,'Saved financial tables/cross-references are stale: '+issues.map(row=>row.key).join(', '));
  return true;
}

// Reads only GET plus immutable local evidence. Dependencies make both capture
// and the post-render compare-and-swap guard testable without a server/browser.
export async function readCurrentSavedInput(snapshot,isolation,key,reviewManifest,dependencies={}){
  const read=dependencies.readFile||fs.readFile,realpath=dependencies.realpath||fs.realpath,sourceCheck=dependencies.checkSourceUnchanged||checkSourceUnchanged;
  const runner=path.join(snapshot.out,'generation-runner'),files=new Map(),reviewPaths=new Map();
  const locked=async file=>{
    file=path.resolve(file);const bytes=await read(file),digest=sha(bytes);
    if(files.has(file))ensure(files.get(file)===digest,'Evidence changed during capture: '+file);
    files.set(file,digest);return {value:JSON.parse(String(bytes)),sha256:digest};
  };
  const reviewRoot=await realpath(runner),manifestFile=path.resolve(reviewManifest);
  const evidenceFile=async file=>{
    ensure(typeof file==='string'&&file.length,'Missing independent review file');
    const requested=path.resolve(runner,file),resolved=await realpath(requested);
    ensure(resolved.startsWith(reviewRoot+path.sep)&&resolved!==await realpath(manifestFile),'Independent review must be a separate file inside generation-runner');
    reviewPaths.set(requested,resolved);
    return resolved;
  };
  // Keep the original frozen source files and manifest immutable as well.
  const originalManifest=(await locked(path.join(snapshot.out,'manifest.json'))).value;
  ensure(originalManifest.version==='full-generation-acceptance-snapshot-v1'&&(!snapshot.manifest||canonical(originalManifest)===canonical(snapshot.manifest)),'Frozen snapshot manifest changed');
  for(const sourceKey of ['tax','longgang']){
    const item=originalManifest.sources?.[sourceKey];
    const loaded=await locked(path.join(snapshot.out,sourceKey+'-source.json'));
    ensure(loaded.sha256===item?.fileSha256&&canonical(loaded.value)===canonical(snapshot.sources[sourceKey]),'Frozen source artifact changed: '+sourceKey);
    ensure(await sourceCheck(snapshot.sources[sourceKey].sourceIdentity),'Formal source changed: '+sourceKey);
  }
  const manifest=(await locked(manifestFile)).value,checkpoint=(await locked(path.join(runner,'checkpoint.json'))).value;
  const target=CURRENT_SAVED_TARGETS[key];
  ensure(target&&isolation.projects[key]?.id===target.id&&isolation.projects[key]?.name===target.name,'Exact isolated copy required');
  const get=()=>isolation.sessions[key].request('/api/projects?id='+encodeURIComponent(target.id),undefined,'GET');
  const opened=await get(),remoteSha256=objectSha(opened.project),artifacts={},reviews={};
  for(const row of manifest.rows||[]){
    if(!String(row.key).startsWith(key+':'))continue;
    ensure(/^(tax|longgang):\d+\.\d+$/.test(row.key),'Invalid review section key');
    const number=row.key.split(':')[1],file=path.join(runner,key,'sections',number+'.json');
    ensure(path.resolve(checkpoint.sections?.[row.key]?.file||'')===file,'Checkpoint artifact path mismatch: '+row.key);
    artifacts[row.key]=await locked(file);
    reviews[row.key]=await locked(await evidenceFile(row.reviewEvidence?.file));
  }
  const result=validateCurrentSavedInput({key,opened,checkpoint,sources:snapshot.sources,manifest,artifacts,reviews});
  const verifyUnchanged=async()=>{
    for(const [requested,resolved] of reviewPaths)ensure(await realpath(requested)===resolved,'Independent review path changed after capture');
    for(const [file,digest] of files)ensure(sha(await read(file))===digest,'Acceptance evidence changed after capture: '+file);
    for(const sourceKey of ['tax','longgang'])ensure(await sourceCheck(snapshot.sources[sourceKey].sourceIdentity),'Formal source changed after capture: '+sourceKey);
    ensure(objectSha((await get()).project)===remoteSha256,'Saved remote project changed during Word acceptance');
    return true;
  };
  return {...result,draft:opened.project.data,checkpoint,verifyUnchanged,audit:{version:'current-saved-word-input-v1',capturedAt:new Date().toISOString(),key,projectId:target.id,projectName:target.name,remoteSha256,reviewManifest:manifestFile,files:[...files].map(([file,sha256])=>({file,sha256})),financial:result.financial,sections:result.sections},actualSavedProject:opened.project};
}

export async function verifyCurrentSavedInputs(inputs){
  ensure(Object.keys(inputs||{}).length>0,'No current saved captures to verify');
  for(const input of Object.values(inputs))ensure(await input.verifyUnchanged()===true,'Current saved capture was not verified');
  return true;
}

export function parseArgs(argv=process.argv.slice(2)){
  const o={snapshotDir:path.join(ARTIFACT_ROOT,DEFAULT_SNAPSHOT),key:'all',baseUrl:'http://localhost:8080',out:null,diagnostic:false,diagnosticState:null,selfTest:false,currentSaved:false,reviewManifest:null,retainPdf:false};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--diagnostic')o.diagnostic=true;
    else if(a==='--current-saved')o.currentSaved=true;
    else if(a==='--self-test')o.selfTest=true;
    else if(a==='--retain-pdf')o.retainPdf=true;
    else if(['--snapshot-dir','--key','--base-url','--out','--diagnostic-state','--review-manifest'].includes(a)){
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value: '+a);
      o[{'--snapshot-dir':'snapshotDir','--key':'key','--base-url':'baseUrl','--out':'out','--diagnostic-state':'diagnosticState','--review-manifest':'reviewManifest'}[a]]=argv[++i];
    }else throw Error('Unknown argument: '+a);
  }
  if(!['tax','longgang','all'].includes(o.key))throw Error('--key must be tax, longgang or all');
  const url=new URL(o.baseUrl);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Only a local HTTP acceptance server is allowed');
  o.baseUrl=url.origin;o.snapshotDir=path.resolve(o.snapshotDir);
  if(o.currentSaved){
    if(!o.reviewManifest||o.diagnostic||o.diagnosticState||o.selfTest)throw Error('--current-saved requires --review-manifest and cannot be diagnostic/self-test');
    o.reviewManifest=path.resolve(o.reviewManifest);
  }else if(o.reviewManifest)throw Error('--review-manifest requires --current-saved');
  if(o.diagnosticState){
    o.diagnosticState=path.resolve(o.diagnosticState);
    if(!o.diagnostic||o.key==='all'||!o.diagnosticState.startsWith(o.snapshotDir+path.sep))throw Error('An alternate diagnostic state requires --diagnostic, one project and a file inside the snapshot directory');
  }
  o.out=path.resolve(o.out||path.join(o.snapshotDir,'actual-word-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)));
  if(!o.out.startsWith(ARTIFACT_ROOT+path.sep))throw Error('Output must remain inside outputs/report-standardization');
  return o;
}

export function generationGate(state,checkpoint,key,target,sourceHash){
  const issues=[];
  if(!noProjection(state))issues.push('Intended/candidate projection is not an adopted saved report');
  if(checkpoint?.version!=='production-full-generation-v1')issues.push('Missing or unsupported generation checkpoint');
  if(checkpoint?.sourceHashes?.[key]!==sourceHash)issues.push('Checkpoint source hash mismatch');
  if(state?.projectId!==target.id||checkpoint?.projects?.[key]?.id!==target.id)issues.push('Isolated project identity mismatch');
  if(state?.sourceUnchanged!==true)issues.push('Runner did not confirm immutable source');
  const sections=(state?.chapters||[]).filter(c=>c.checked!==false).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>({number:(ci+1)+'.'+(si+1),sectionKey:c.name+' / '+(s.t||s.title||''),section:s})));
  if(sections.length!==43)issues.push('Expected exactly 43 active sections; got '+sections.length);
  const failed=sections.filter(row=>checkpoint?.sections?.[key+':'+row.number]?.status!=='passed'||!String(row.section.editedHtml||row.section.content||'').trim()||row.section.pendingRevision);
  if(failed.length)issues.push(failed.length+' sections are incomplete, blocked, empty or still candidates');
  return {passed:issues.length===0,expectedSections:43,activeSections:sections.length,failed:failed.map(r=>r.number),issues,sections};
}

// Expectations are derived from the SAME repaired blocks consumed by docxgen,
// not from old AI text and not from an alternative report layout.
export function expectedSections(payload){
  function walk(blocks,out){
    for(const b of policy.repairBlocks(blocks||[])){
      if(b.type==='list'){
        for(const item of b.items||[])walk(typeof item==='string'?[{type:'p',text:item}]:item?.blocks||[{type:'p',text:item?.text||''}],out);
      }else if(b.type==='table'){
        const width=Math.max(0,...(b.rows||[]).map(r=>r.length));
        out.tables.push((b.rows||[]).map(r=>Array.from({length:width},(_,i)=>norm(r[i]??''))));
      }
      else if(b.type==='templateTable'){
        for(const [index,segment] of (b.template?.segments||[]).entries()){
          out.paragraphs.push(norm(b.template.title+(index?'（续表'+index+'）':'')));
          const grid=[];
          for(const [ri,row] of (segment.rows||[]).entries()){
            grid[ri]=[];
            for(const cell of row.cells||[]){
              const col=Number(cell.col)||0,span=Math.max(1,Number(cell.colSpan)||1);
              const value=cell.vMerge==='continue'?(grid[ri-1]?.[col]??''):norm(cell.text||'');
              for(let dc=0;dc<span;dc++)grid[ri][col+dc]=value;
            }
          }
          out.tables.push(grid);
        }
      }else if(norm(b.text)){
        out.paragraphs.push(norm(b.text));
        if(b.type==='h')out.headings.push({text:norm(b.text),level:Math.min(6,Math.max(3,Number(b.level)||3))});
      }
    }
  }
  return (payload.chapters||[]).flatMap((c,ci)=>(c.sections||[]).map((s,si)=>{
    const result={number:(c.num||ci+1)+'.'+(s.num||si+1),title:s.title,bookmark:'_tc'+ci+'_'+si,paragraphs:[],headings:[],tables:[]};walk(s.blocks,result);return result;
  }));
}

// This function is evaluated inside an isolated Chromium DOMParser. It receives
// only document XML, styles and canonical expectations; no token or user profile.
export function inspectXmlInBrowser({xml,stylesXml,expected}){
  const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parser=new DOMParser(),doc=parser.parseFromString(xml,'application/xml'),styles=parser.parseFromString(stylesXml||'<styles/>','application/xml');
  if(doc.querySelector('parsererror')||styles.querySelector('parsererror'))throw Error('Malformed Word XML');
  const nodes=(n,name)=>[...n.getElementsByTagNameNS(NS,name)];
  const direct=(n,name)=>[...(n?.children||[])].filter(c=>c.localName===name);
  const attr=(n,name)=>n?.getAttributeNS(NS,name)||n?.getAttribute('w:'+name)||'';
  const text=n=>nodes(n,'t').map(t=>t.textContent).join('');
  const normal=v=>String(v??'').replace(/\s/g,'');
  const styleMap=new Map(nodes(styles,'style').map(s=>[attr(s,'styleId'),s]));
  function styleProperty(id,name,seen=new Set()){
    if(!id||seen.has(id))return '';seen.add(id);const s=styleMap.get(id);if(!s)return '';
    const value=attr(nodes(s,name)[0],'val');
    return value||styleProperty(attr(direct(s,'basedOn')[0],'val'),name,seen);
  }
  function heading(p){
    const pr=direct(p,'pPr')[0],style=attr(pr&&direct(pr,'pStyle')[0],'val');
    const outline=attr(pr&&direct(pr,'outlineLvl')[0],'val')||styleProperty(style,'outlineLvl');
    if(outline!==''&&Number(outline)<6)return Number(outline)+1;
    const name=styleProperty(style,'name')||style,match=/heading\s*([1-6])/i.exec(name);return match?Number(match[1]):null;
  }
  function grid(table){
    const result=[];
    for(const [ri,row] of direct(table,'tr').entries()){
      result[ri]=[];let col=Number(attr(direct(direct(row,'trPr')[0],'gridBefore')[0],'val')||0);
      for(const cell of direct(row,'tc')){
        const pr=direct(cell,'tcPr')[0],span=Number(attr(pr&&direct(pr,'gridSpan')[0],'val')||1),merge=pr&&direct(pr,'vMerge')[0];
        const value=merge&&attr(merge,'val')!=='restart'?(result[ri-1]?.[col]??''):normal(text(cell));
        for(let i=0;i<span;i++)result[ri][col++]=value;
      }
    }
    return result;
  }
  function geometry(table){
    const rows=direct(table,'tr'),cells=[],issues=[];let prior=new Map();
    for(const [ri,row] of rows.entries()){
      let col=Number(attr(direct(direct(row,'trPr')[0],'gridBefore')[0],'val')||0);const next=new Map();
      for(const cell of direct(row,'tc')){
        const pr=direct(cell,'tcPr')[0],span=Number(attr(pr&&direct(pr,'gridSpan')[0],'val')||1),merge=pr&&direct(pr,'vMerge')[0];
        if(merge&&attr(merge,'val')!=='restart'){
          const anchor=prior.get(col);
          if(!anchor||anchor.colSpan!==span)issues.push({row:ri,col,reason:'Orphan or mismatched vertical merge'});
          else {anchor.rowSpan++;for(let dc=0;dc<span;dc++)next.set(col+dc,anchor);}
        }else{
          const anchor={row:ri,col,rowSpan:1,colSpan:span};cells.push(anchor);
          if(merge)for(let dc=0;dc<span;dc++)next.set(col+dc,anchor);
        }
        col+=span;
      }
      prior=next;
    }
    return {rows:rows.length,cells,issues};
  }
  const sections=new Map(expected.map(row=>[row.bookmark,{paragraphs:[],headings:[],tables:[],geometry:[]}])) ;
  const body=nodes(doc,'body')[0];let active=null,bodyStarted=false,bodyText='',colorText='',colors=[],seen=[];
  for(const node of body.children){
    const bookmarks=node.localName==='bookmarkStart'?[node]:nodes(node,'bookmarkStart');
    const starts=bookmarks.map(n=>attr(n,'name'));
    if(starts.includes('_tc0'))bodyStarted=true;
    // WPS can legally move a zero-width end bookmark to the beginning of the
    // following heading paragraph. Respect XML order instead of clearing the
    // NEW section merely because that paragraph also ends the preceding one.
    const firstText=nodes(node,'t').find(n=>n.textContent);
    for(const mark of bookmarks){
      if(!firstText||(mark.compareDocumentPosition(firstText)&4)){
        if(/^_rp_end_\d+_\d+$/.test(attr(mark,'name')))active=null;
      }
    }
    const begin=starts.find(n=>sections.has(n));if(begin){active=begin;seen.push(begin);}
    if(bodyStarted){
      bodyText+=text(node);
      for(const r of nodes(node,'r')){
        const value=text(r);if(!value)continue;
        const pr=direct(r,'rPr')[0],rstyle=attr(pr&&direct(pr,'rStyle')[0],'val'),p=r.closest('p'),pstyle=p?attr(direct(direct(p,'pPr')[0],'pStyle')[0],'val'):'';
        const color=(attr(pr&&direct(pr,'color')[0],'val')||styleProperty(rstyle,'color')||styleProperty(pstyle,'color')||'000000').toUpperCase();
        colorText+=value;colors.push({start:colorText.length-value.length,end:colorText.length,color});
      }
    }
    if(active){
      const s=sections.get(active);
      if(node.localName==='tbl'){s.tables.push(grid(node));s.geometry.push(geometry(node));}
      else if(node.localName==='p'&&!begin&&normal(text(node))){s.paragraphs.push(normal(text(node)));if(heading(node))s.headings.push({text:normal(text(node)),level:heading(node)});}
    }
    for(const mark of bookmarks){
      if(firstText&&(firstText.compareDocumentPosition(mark)&4)&&/^_rp_end_\d+_\d+$/.test(attr(mark,'name')))active=null;
    }
  }
  const gapRanges=[...colorText.matchAll(/【待补\s*(?:：|:)?[^】]*】/g)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0]}));
  const badGaps=gapRanges.filter(g=>colors.some(r=>r.start<g.end&&r.end>g.start&&r.color!=='C62828'));
  const badOrdinary=colors.filter(r=>!['000000','AUTO'].includes(r.color)&&!gapRanges.some(g=>r.start>=g.start&&r.end<=g.end));
  const rows=expected.map(row=>{
    const actual=sections.get(row.bookmark);
    return {number:row.number,title:row.title,bookmark:row.bookmark,expectedParagraphs:row.paragraphs.length,actualParagraphs:actual.paragraphs.length,
      paragraphsMatch:JSON.stringify(row.paragraphs)===JSON.stringify(actual.paragraphs),
      headingsMatch:JSON.stringify(row.headings)===JSON.stringify(actual.headings),expectedHeadings:row.headings,actualHeadings:actual.headings,
      expectedTables:row.tables.length,actualTables:actual.tables.length,tablesMatch:JSON.stringify(row.tables)===JSON.stringify(actual.tables),
      geometry:actual.geometry,paragraphDiff:row.paragraphs.filter((v,i)=>v!==actual.paragraphs[i]).slice(0,3).map(v=>v.slice(0,180))};
  });
  return {sections:rows,sectionBookmarks:seen,bodyText,bodyTextCharacters:bodyText.length,tableCount:nodes(body,'tbl').length,
    gapMarkers:{count:gapRanges.length,allRed:badGaps.length===0,failures:badGaps},ordinaryBlack:badOrdinary.length===0,nonBlackRuns:badOrdinary.slice(0,20),
    unresolvedTableMarkers:/\[\[\s*\/?TABLE\s*\]\]|@@TABLE_\d+@@/.test(bodyText),
    passed:seen.length===expected.length&&new Set(seen).size===expected.length&&rows.every(r=>r.paragraphsMatch&&r.headingsMatch&&r.tablesMatch&&r.geometry.every(g=>!g.issues.length))&&badGaps.length===0&&badOrdinary.length===0&&!/\[\[\s*\/?TABLE\s*\]\]|@@TABLE_\d+@@/.test(bodyText)};
}

async function inspectDocx(page,bytes,expected){
  const zip=await JSZip.loadAsync(bytes),file=zip.file('word/document.xml');
  if(!file)throw Error('Missing word/document.xml');
  return page.evaluate(inspectXmlInBrowser,{xml:await file.async('string'),stylesXml:await zip.file('word/styles.xml')?.async('string'),expected});
}

export async function parsePaginationResponse(response,{requirePdf=false}={}){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('multipart/form-data')){
    const data=await response.json().catch(()=>({}));throw Error(data.error||'Pagination did not return a prepared Word document');
  }
  const form=await response.formData();let data;
  try{data=JSON.parse(form.get('receipt'));}catch{throw Error('Unreadable pagination receipt');}
  const document=form.get('document');
  if(!document?.arrayBuffer||document.size<1)throw Error('Pagination did not return a prepared Word document');
  const prepared=Buffer.from(await document.arrayBuffer());
  if(data.receipt?.tocUpdated!==true||data.receipt?.preparedDocumentSha256!==sha(prepared))throw Error('Prepared document or updated TOC does not match its receipt');
  let pdf;
  if(requirePdf){
    const file=form.get('pdf'),proof=data.receipt?.pdf;
    if(!file?.arrayBuffer||file.type!=='application/pdf'||file.size<5)throw Error('Pagination did not return the requested PDF');
    pdf=Buffer.from(await file.arrayBuffer());
    if(pdf.subarray(0,5).toString('ascii')!=='%PDF-'||proof?.sha256!==sha(pdf)||proof?.bytes!==pdf.length||proof?.preparedDocumentSha256!==sha(prepared)||proof?.preparedDocumentSha256After!==sha(prepared)||!Number.isInteger(data.pages)||data.pages<1||proof?.pagesBeforeExport!==data.pages||proof?.pagesAfterExport!==data.pages||proof?.scope!=='same-prepared-document-render-only')throw Error('PDF does not match the prepared Word document and actual page-count receipt');
  }
  return {data,prepared,...(pdf?{pdf}:{})};
}

async function exportProject(snapshot,isolation,key,checkpoint,options){
  const output=path.join(options.out,key);await fs.mkdir(output,{recursive:false});
  const save=(name,value)=>fs.writeFile(path.join(output,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{flag:'wx'});
  const report={schemaVersion:'actual-production-word-acceptance-v1',key,startedAt:new Date().toISOString(),output,paidAiCalls:0,sourceWrites:0,
    target:{pages:120,min:110,max:130},technicalPassed:false,visualQa:{status:'pending',reason:'XML and pagination do not substitute for inspecting rendered pages.'},contentQualityCertified:false};
  let harness,current;
  try{
    const source=snapshot.sources[key],target=isolation.projects[key];
    let finalFile,state;
    if(options.currentSaved){
      current=options.currentInputs?.[key]||await readCurrentSavedInput(snapshot,isolation,key,options.reviewManifest);
      checkpoint=current.checkpoint;state=current.state;finalFile=path.join(output,'current-saved-input.json');
      await save('current-saved-input.json',{...current.audit,actualSavedProject:current.actualSavedProject,state});
      report.currentSaved={readOnly:true,independentReviews:current.sections.length,remoteSha256:current.audit.remoteSha256};
    }else{
      finalFile=options.diagnosticState||path.join(snapshot.out,'generation-runner',key,'final.json');state=await jsonRead(finalFile);
    }
    if(options.diagnosticState&&state.diagnosticOnly!==true)throw Error('Alternate state must be explicitly marked diagnosticOnly');
    report.input={file:finalFile,sha256:sha(await fs.readFile(finalFile)),projectId:target.id,sourceSha256:source.sourceIdentity.sourceSha256};
    const gate=generationGate(state,checkpoint,key,target,source.sourceIdentity.sourceSha256);
    report.generation={...gate,sections:undefined};
    if(!gate.passed&&!options.diagnostic)throw Error('Full-report export blocked: '+gate.issues.join('; ')+'. --diagnostic can export incomplete content but cannot certify it.');
    // Cross-check canonical final bodies against the passed runner artifacts.
    report.runnerBodiesMatch=true;
    for(const row of gate.sections){
      const record=checkpoint.sections?.[key+':'+row.number];if(record?.status!=='passed')continue;
      const artifact=await jsonRead(path.join(snapshot.out,'generation-runner',key,'sections',row.number+'.json'));
      if(artifact.status!=='passed'||artifact.sectionKey!==row.sectionKey||String(artifact.content||'')!==String(row.section.content||'')||String(artifact.editedHtml||'')!==String(row.section.editedHtml||'')){
        report.runnerBodiesMatch=false;throw Error('Runner body/artifact identity mismatch: '+key+':'+row.number);
      }
    }
    report.sourceUnchangedBefore=await checkSourceUnchanged(source.sourceIdentity);
    if(!report.sourceUnchangedBefore)throw Error('Source project changed since the immutable snapshot');
    harness=await openProductionHarness(isolation,key,{allowAi:false,readOnly:true});
    // The acceptance browser may read production configuration but cannot save,
    // generate, accept, publish or invoke any other mutating API after opening.
    await harness.context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.fallback();
      let body={};try{body=req.postDataJSON()||{};}catch{}
      const readonly={'/api/reportlogic':['adminCapability','adminList','evaluateRuleRevision'],'/api/reporttables':['list','get','resolve','effective','preview'],'/api/reportoutline':['list','get'],'/api/reportdataneeds':['list','get','resolve'],'/api/webresearch':['status','plan','listEvidence','listRequirementRefinements']};
      if(req.method()==='POST'&&readonly[url.pathname]?.includes(body.action))return route.fallback();
      report.blockedMutations||=[];report.blockedMutations.push({path:url.pathname,method:req.method()});
      return route.fulfill({status:403,json:{ok:false,error:'Word acceptance is read-only; no generation or project save is allowed.'}});
    });
    const sourceDraft=current?.draft||source.state.draft||source.state;
    const memory={...sourceDraft,project:state.project,calcType:state.calcType,calcParams:state.calcParams,chapters:state.chapters,workflow:state.workflow,appMode:'report',currentStep:4};
    if(current)await harness.page.evaluate(installSavedFinancialBindingsReader);
    const composed=await harness.page.evaluate(async ({draft,currentSaved})=>{
      // Explicit memory-only test guards; these do not change production files.
      saveDraft=()=>{};persistReportDraft=async()=>({ok:false,remote:false,acceptanceReadOnly:true});
      window.__qaDispatchPaused=true;
      restoreDraft(draft,{deferRender:true});appMode='report';currentStep=4;signed=false;
      const savedChapters=JSON.stringify(draft.chapters);
      if(currentSaved&&JSON.stringify(chapters)!==savedChapters)throw Error('Restoration changed saved chapters');
      if(currentSaved)await ReportLogicCore.load(rlProjectType());
      await ensureReportTableTemplates();
      let financial=null,financialIssues=[];
      if(currentSaved){
        const checked=await window.__qaReadSavedFinancialBindings({projectId:currentProjectId});
        financial=checked.binding;financialIssues=checked.issues;
        if(financialIssues.length)throw Error('Saved financial table binding is stale: '+financialIssues.map(x=>x.key).join(', '));
      }
      renderTOC();renderSheet();await ensureDocxLib();
      if(currentSaved&&JSON.stringify(chapters)!==savedChapters)throw Error('Read-only rendering changed saved chapters');
      const before=JSON.stringify({project,chapters,calcParams,projectWorkflow});
      const savedCompletionReview=currentSaved?await reportSavedCompletionReviewPlan():null;
      const payload=JSON.parse(JSON.stringify(buildExportPayload(currentSaved?{stateOnly:true,savedCompletionReview}:undefined)));payload.images=[];
      const blob=await window.docx.Packer.toBlob(window.buildDocxDocument(window.docx,payload));
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
      return {payload,base64:btoa(binary),financial,financialIssues,memoryUnchanged:before===JSON.stringify({project,chapters,calcParams,projectWorkflow}),versions:{rules:ReportOutputPolicy.contentVersion,template:window.buildDocxDocument.templateVersion},
        html:chapters.filter(c=>c.checked!==false).flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),title:s.t,html:s.editedHtml||renderContent(s.content||'')})))};
    },{draft:memory,currentSaved:!!current});
    if(!composed.memoryUnchanged)throw Error('Production composition mutated report memory');
    if(current){
      validateCurrentSavedFinancial(current.financial,composed.financial,composed.financialIssues);
      report.currentSaved.financialIdentityVerified=true;
      // No renderer call until the exact current bodies/evidence still match.
      await current.verifyUnchanged();
    }
    report.memoryUnchanged=true;report.versions=composed.versions;report.completionReview=composed.payload.completionReview;
    const input=Buffer.from(composed.base64,'base64'),expected=expectedSections(composed.payload);
    report.inputDocument={bytes:input.length,sha256:sha(input)};
    await save(key+'.docx',input);await save('payload.json',composed.payload);await save('section-html.json',composed.html);await save('expected-structure.json',expected);
    report.inputQa=await inspectDocx(harness.page,input,expected);
    const inputBody=report.inputQa.bodyText;delete report.inputQa.bodyText;
    await save('input-xml-qa.json',report.inputQa);
    const session=isolation.sessions[key];
    const response=await fetch(isolation.baseUrl+'/api/report-pagination',{method:'POST',headers:{authorization:'Bearer '+session.token,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',Accept:'multipart/form-data',...(options.retainPdf?{'X-Report-QA-Pdf':'1'}:{})},body:input,signal:AbortSignal.timeout(90000)});
    const {data,prepared,pdf}=await parsePaginationResponse(response,{requirePdf:options.retainPdf});
    await harness.page.evaluate(({data,status,ok,hash})=>exportReportPaginationValidate(data,{status,ok},hash),{data,status:response.status,ok:response.ok,hash:sha(input)});
    report.pagination={httpStatus:response.status,...data};await save('receipt.json',report.pagination);
    await save(key+'.prepared.docx',prepared);report.preparedDocument={bytes:prepared.length,sha256:sha(prepared)};
    if(pdf){await save(key+'.prepared.pdf',pdf);report.preparedPdf={file:path.join(output,key+'.prepared.pdf'),...data.receipt.pdf};}
    report.preparedQa=await inspectDocx(harness.page,prepared,expected);
    report.bodyTextPreserved=inputBody===report.preparedQa.bodyText;delete report.preparedQa.bodyText;
    report.tableGeometryPreserved=JSON.stringify(report.inputQa.sections.map(s=>s.geometry))===JSON.stringify(report.preparedQa.sections.map(s=>s.geometry));
    await save('prepared-xml-qa.json',report.preparedQa);
    report.pageGate={passed:Number.isInteger(data.pages)&&data.pages>=110&&data.pages<=130,pages:data.pages,min:110,max:130,
      protocolMax:data.maxPages,scope:'Actual server renderer; not a content-quality certificate.'};
    report.sourceUnchangedAfter=await checkSourceUnchanged(source.sourceIdentity);
    if(current)report.currentSaved.unchangedAfter=await current.verifyUnchanged();
    report.browserErrors=harness.errors;report.browserRequests=harness.ledger;
    report.technicalPassed=!options.diagnosticState&&gate.passed&&report.runnerBodiesMatch&&report.inputQa.passed&&report.preparedQa.passed&&report.bodyTextPreserved&&report.tableGeometryPreserved&&report.pageGate.passed&&report.sourceUnchangedAfter&&(!current||report.currentSaved.unchangedAfter===true)&&harness.errors.length===0&&!report.blockedMutations?.length;
    report.scope=gate.passed?'Complete 43-section generated report, technical acceptance only':'INCOMPLETE DIAGNOSTIC: not a complete-report acceptance';
    await harness.page.screenshot({path:path.join(output,'production-report-preview.png'),fullPage:false});
  }catch(error){report.failure=safe(error);}
  finally{
    report.finishedAt=new Date().toISOString();
    report.boundaries=['No paid AI, adoption, publication or source project save.','Production payload and docxgen template reused without typography/content padding.','Rendered-page visual QA and human fact review remain separate; no final quality certification.','Word/WPS versions and installed fonts can reflow the document on another computer.'];
    if(harness)await harness.close();
    if(!options.currentSaved)await save('acceptance.json',report);
  }
  return report;
}

async function selfTest(){
  const D=require('../docx.umd.js'),build=require('../docxgen.js');
  require('./windows-browser-lockout-guard.cjs');const {chromium}=require('playwright');
  const payload={project:{name:'[系统测试]实际Word验收工具小样'},chapters:[{cn:'一',name:'概况',sections:[{title:'项目条件',blocks:[{type:'h',level:3,text:'一、建设条件'},{type:'h',level:4,text:'1. 场地条件'},{type:'p',text:'必要事实【待补：权属文件】。'},{type:'list',ordered:true,items:['第一项',{blocks:[{type:'p',text:'第二项'},{type:'list',ordered:false,items:['子项']}]}]},{type:'table',rows:[['指标','值'],['面积','5973']]}]}]}]};
  payload.chapters[0].sections.push({title:'运营条件',blocks:[{type:'h',level:3,text:'实施安排'},{type:'p',text:'第二小节正文必须保留。'}]});
  const before=JSON.stringify(payload),bytes=await D.Packer.toBuffer(build(D,payload)),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),result=await inspectDocx(page,bytes,expectedSections(payload));
    assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.gapMarkers.count,1);assert.equal(result.sections[0].expectedHeadings.length,2);
    assert.equal(JSON.stringify(payload),before);assert.throws(()=>parseArgs(['--base-url','https://example.com']),/local HTTP/);
    assert.throws(()=>parseArgs(['--diagnostic-state',path.join(ARTIFACT_ROOT,'fake.json')]),/alternate diagnostic state/);
    const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),stylesXml=await zip.file('word/styles.xml').async('string');
    const moved=await page.evaluate(source=>{
      const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(source,'application/xml');
      const bookmarks=[...doc.getElementsByTagNameNS(ns,'bookmarkStart')],name=n=>n.getAttributeNS(ns,'name'),end=bookmarks.find(n=>name(n)==='_rp_end_0_0'),next=bookmarks.find(n=>name(n)==='_tc0_1');
      const paragraph=next.parentNode;paragraph.insertBefore(end,next);
      return new XMLSerializer().serializeToString(doc);
    },xml);
    assert.equal((await page.evaluate(inspectXmlInBrowser,{xml:moved,stylesXml,expected:expectedSections(payload)})).passed,true,'WPS zero-width previous end before next section must not erase the next section');
    const bad=structuredClone(payload);bad.chapters[0].sections[0].blocks[0].level=5;
    assert.equal((await inspectDocx(page,bytes,expectedSections(bad))).passed,false,'Lost heading levels must fail');
    const incomplete=generationGate({projectId:'test',sourceUnchanged:true,chapters:[]},{version:'production-full-generation-v1',sourceHashes:{tax:'hash'},projects:{tax:{id:'test'}}},'tax',{id:'test'},'hash');
    assert.equal(incomplete.passed,false);assert.match(incomplete.issues.join(';'),/43/);
    console.log(JSON.stringify({selfTest:'passed',checks:9,paidAiCalls:0,sourceWrites:0,actualLongReportAccepted:false,paginationCalled:false}));
  }finally{await browser.close();}
}

async function main(){
  const options=parseArgs();if(options.selfTest)return selfTest();
  const snapshot=await loadSnapshots(options.snapshotDir),isolation=await loadIsolation(snapshot,{baseUrl:options.baseUrl});
  const checkpoint=await jsonRead(path.join(snapshot.out,'generation-runner/checkpoint.json'));
  await fs.mkdir(options.out,{recursive:false});
  const reports=[],keys=options.key==='all'?['tax','longgang']:[options.key];
  if(options.currentSaved){
    options.currentInputs={};
    for(const key of keys)options.currentInputs[key]=await readCurrentSavedInput(snapshot,isolation,key,options.reviewManifest);
  }
  for(const key of keys){
    const report=await exportProject(snapshot,isolation,key,checkpoint,options);reports.push(report);
  }
  if(options.currentSaved){
    // One barrier over BOTH captures: Tax cannot change while Longgang renders
    // and still leave an earlier immutable acceptance.json claiming success.
    let failure;
    try{await verifyCurrentSavedInputs(options.currentInputs);}catch(error){failure=safe(error);}
    for(const report of reports){
      report.currentSaved||={readOnly:true};report.currentSaved.allSelectedUnchangedAfter=!failure;
      if(failure){report.technicalPassed=false;report.failure=failure;}
      await fs.writeFile(path.join(report.output,'acceptance.json'),JSON.stringify(report,null,2),{flag:'wx'});
    }
  }
  for(const report of reports){
    const key=report.key;
    console.log(JSON.stringify({key,output:report.output,technicalPassed:report.technicalPassed,pages:report.pageGate?.pages,generationPassed:report.generation?.passed,visualQa:report.visualQa.status,failure:report.failure}));
  }
  await fs.writeFile(path.join(options.out,'summary.json'),JSON.stringify({at:new Date().toISOString(),technicalPassed:reports.every(r=>r.technicalPassed),contentQualityCertified:false,visualQa:'pending',projects:reports.map(r=>({key:r.key,output:r.output,technicalPassed:r.technicalPassed,pages:r.pageGate?.pages,failure:r.failure}))},null,2),{flag:'wx'});
  if(reports.some(r=>!r.technicalPassed))process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(safe(e));process.exitCode=1;});
