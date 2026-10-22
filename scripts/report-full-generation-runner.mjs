// Real production generation against existing, provenance-bound test copies only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged,buildIsolatedData} from './report-generation-acceptance.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_SNAPSHOT='outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5';
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const safe=value=>String(value?.message||value||'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]');
export function parseArgs(argv=process.argv.slice(2)){
  const o={snapshotDir:DEFAULT_SNAPSHOT,baseUrl:'http://localhost:8080',concurrency:4,probe:null,runAll:false,resume:false,selfTest:false,refreshStructure:false,retrySections:[]};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--run-all')o.runAll=true;
    else if(a==='--resume')o.resume=true;
    else if(a==='--self-test')o.selfTest=true;
    else if(a==='--refresh-structure')o.refreshStructure=true;
    else if(a==='--retry-section'){const value=argv[++i];if(!/^(tax|longgang):\d+\.\d+$/.test(value||''))throw Error('Retry section must name one isolated project section');o.retrySections.push(value);}
    else if(['--snapshot-dir','--base-url','--concurrency','--probe'].includes(a)){
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value: '+a);
      o[{'--snapshot-dir':'snapshotDir','--base-url':'baseUrl','--concurrency':'concurrency','--probe':'probe'}[a]]=argv[++i];
    }else throw Error('Unknown argument: '+a);
  }
  o.concurrency=Number(o.concurrency);
  if(!Number.isInteger(o.concurrency)||o.concurrency<1||o.concurrency>4)throw Error('Shared concurrency must be 1–4');
  const u=new URL(o.baseUrl);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Local HTTP only');o.baseUrl=u.origin;
  if(o.probe&&!/^(tax|longgang):\d+\.\d+$/.test(o.probe))throw Error('Probe must be tax:3.2 or longgang:3.2');
  if(o.probe&&o.runAll)throw Error('Choose probe or run-all');
  return o;
}
export async function pool(rows,limit,worker){let cursor=0;const results=[];await Promise.all(Array.from({length:Math.min(limit,rows.length)},async()=>{while(cursor<rows.length){const i=cursor++;results[i]=await worker(rows[i],i);}}));return results;}
export function incompleteDetailSections(rows,checkpoint,key){return rows.filter(r=>r.key===key&&!r.summary&&checkpoint.sections?.[r.key+':'+r.number]?.status!=='passed');}
export const BASIS_CLASSIFICATION_VERSION='runner-basis-file-type-v1';
function basisCanonical(value){
  const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,ordered(x[k])])):x;
  return JSON.stringify(ordered(value));
}
function basisPaths(contract){
  const stack=[],paths=[];
  for(const h of contract.requiredHeadings||[]){while(stack.length&&stack.at(-1).level>=h.level)stack.pop();stack.push({level:h.level,text:h.text});paths.push(stack.map(x=>({...x})));}
  return paths;
}
function basisFileType(title){
  const text=String(title||'').trim().replace(/\.(?:docx?|pdf|xlsx?|txt)\s*$/i,'').replace(/(?:[（(][^（）()]*[）)]|\s*[-—]\s*修订)+\s*$/g,'');
  // Only an explicit document genre in the actual title can choose this axis.
  // A city/group name is jurisdiction, not proof of law/policy/technical genre.
  if(/(?:协议|合同|报告|请示|清单)(?:书|表)?$/.test(text))return 'project';
  if(/(?:法|条例|民法典)$/.test(text)&&!/(?:办法|方法)$/.test(text))return 'legal';
  if(/(?:\bGB(?:\/T)?\s*\d|(?:技术|设计|建筑|工程|验收|安全|消防).*(?:标准|规范|规程)$)/i.test(text))return 'technical';
  if(/(?:意见|办法|通知|规划|制度|细则|规定|决定|指引)$/.test(text))return 'policy';
  return 'unclassified';
}
function basisHeadingType(text){
  if(/政策/.test(text))return 'policy';
  if(/法律|法规/.test(text))return 'legal';
  if(/技术|标准|规范/.test(text))return 'technical';
  if(/项目.*(?:依据|专项|专属)|(?:专项|专属).*依据/.test(text))return 'project';
  return null;
}
const BASIS_LEVEL_PATTERNS={national:/国家|全国|中央/,province:/省级|省域|省份/,city:/市级|市区|地方/,district:/区级|市区|地方/,group:/集团/,project:/项目|专属/,technical:/技术|标准|规范/};
export function classifyBasisCatalog({contract,catalog,coverage,replaceGroups=false}){
  if(!contract?.requirements?.basis||catalog?.sectionKey&&catalog.sectionKey!==contract.sectionKey||!Array.isArray(catalog?.items))throw Error('Basis classification requires the same basis section and actual catalog');
  const paths=basisPaths(contract),typed=paths.some(p=>['policy','legal','technical'].includes(basisHeadingType(p.at(-1).text))),diagnostics=[];
  const typePath=type=>{
    const found=paths.filter(p=>basisHeadingType(p.at(-1).text)===type&&!p.slice(0,-1).some(h=>basisHeadingType(h.text)===type));
    return found.length===1?found[0]:null;
  };
  const jurisdictionPath=(level,under=[])=>{
    const re=BASIS_LEVEL_PATTERNS[level];if(!re)return null;
    const found=paths.filter(p=>p.length>under.length&&basisCanonical(p.slice(0,under.length))===basisCanonical(under)&&re.test(p.at(-1).text));
    const roots=found.filter(p=>!found.some(q=>q.length<p.length&&basisCanonical(p.slice(0,q.length))===basisCanonical(q)));
    return roots.length===1?roots[0]:null;
  };
  const items=catalog.items.map(item=>{
    if(!replaceGroups&&(item.groups?.length||item.group!==undefined))return structuredClone(item);
    const type=basisFileType(item.title),level=coverage?.levels?.find(l=>l.items?.some(x=>x.title===item.title))?.key||'unclassified';
    let groups=null;
    if(type!=='unclassified'){
      if(typed){
        groups=typePath(type);
        if(groups&&type==='policy'&&['national','province','city','district','group'].includes(level)){
          groups=jurisdictionPath(level,groups)||(groups.at(-1).level<6?[...groups,{level:groups.at(-1).level+1,text:{national:'国家层面依据',province:'省级层面依据',city:'市级层面依据',district:'区级层面依据',group:'集团层面依据'}[level]}]:groups);
        }
      }else groups=jurisdictionPath(type==='project'?'project':level);
    }
    if(!groups)diagnostics.push({code:'basis-file-type-unconfirmed',title:item.title,message:'文件文种或对应分类未明确；未以地域猜测文种，须人工确认。'});
    const {group,level:oldLevel,...retained}=structuredClone(item);
    delete retained.groups;
    return {...retained,...(groups?{groups}:{})};
  });
  return {version:BASIS_CLASSIFICATION_VERSION,items,diagnostics};
}
export async function remapBasisReferences({raw,previousContract,nextContract}){
  if(!previousContract?.requirements?.basis||!nextContract?.requirements?.basis||previousContract.sectionKey!==nextContract.sectionKey)throw Error('Basis reference migration requires the same basis section');
  const {default:C}=await import('../report-completion-contract.js');
  await C.verifyBasisCatalog(previousContract);await C.verifyBasisCatalog(nextContract);
  const before=previousContract.basisCatalog?.items,after=nextContract.basisCatalog?.items;
  if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)throw Error('Basis evidence catalog changed; cannot remap references');
  const immutable=item=>{const {id,ordinal,groups,group,level,...evidence}=item;return basisCanonical(evidence);};
  const ids=new Map(),seen=new Set();
  for(const item of before){
    const matches=after.filter(next=>immutable(next)===immutable(item));
    if(matches.length!==1||seen.has(matches[0].id))throw Error('Basis evidence/status/locator changed or ambiguous; cannot remap references');
    seen.add(matches[0].id);ids.set(item.id,matches[0].id);
  }
  let data;try{data=JSON.parse(raw);}catch{throw Error('Basis reference migration requires the original structured JSON');}
  if(!data||Object.keys(data).some(k=>k!=='blocks')||!Array.isArray(data.blocks))throw Error('Basis reference migration accepts only the original reference blocks');
  if(C.decodeStructured(raw,previousContract).issues.length)throw Error('Original basis references do not pass their original contract; cannot repair the model response');
  const used=new Set();
  const blocks=data.blocks.map(block=>{
    if(!block||Object.keys(block).some(k=>!['kind','id'].includes(k))||block.kind!=='basis-ref'||!ids.has(block.id)||used.has(block.id))throw Error('Unknown, duplicate or non-reference basis block; original retained');
    used.add(block.id);return {kind:'basis-ref',id:ids.get(block.id)};
  });
  if(before.some(item=>item.required&&!used.has(item.id)))throw Error('Required original basis reference is missing; cannot repair by inventing it');
  const nextRaw=JSON.stringify({blocks});
  if(C.decodeStructured(nextRaw,nextContract).issues.length)throw Error('Remapped references do not pass the new basis contract; original retained');
  return nextRaw;
}
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}

async function prepareIsolatedRetry(isolation,keys,options,out){
  for(const key of keys){
    const session=isolation.sessions[key],opened=await session.request('/api/projects?id='+session.target.id),data=opened.project.data;
    if(data.qaAcceptance?.id!==session.target.id)throw Error('Isolated retry identity mismatch');
    let changed=false;
    for(const id of options.retrySections.filter(x=>x.startsWith(key+':'))){
      const number=id.split(':')[1],indexes=number.split('.').map(x=>Number(x)-1),section=data.chapters?.[indexes[0]]?.sections?.[indexes[1]];
      if(!section)throw Error('Retry section does not exist: '+id);
      if(String(section.content||section.editedHtml||'').trim())throw Error('Retry cannot replace accepted body: '+id);
      if(!section.pendingRevision)throw Error('Retry requires the previous blocked candidate: '+id);
      let artifact=null;try{artifact=JSON.parse(await fs.readFile(path.join(out,key,'sections',number+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      const archive=path.join(out,key,'archived-candidates',number+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)+'.json');
      await write(archive,{at:new Date().toISOString(),projectId:session.target.id,sectionKey:data.chapters[indexes[0]].name+' / '+section.t,reason:'Explicitly authorized isolated regeneration after current assumptions and fixed-gap renderer changed; original raw and task retained, not protocol repair.',section,artifact});
      const archived=JSON.parse(await fs.readFile(archive,'utf8'));if(sha(archived.section)!==sha(section)||sha(archived.artifact)!==sha(artifact))throw Error('Candidate archive readback failed');
      for(const field of ['pendingRevision','generationFailure','executionTask','completionContract','completionFinancialSource'])delete section[field];
      changed=true;console.log(JSON.stringify({event:'candidate-archived',id,archive}));
    }
    if(options.refreshStructure){
      if((data.chapters||[]).some(c=>(c.sections||[]).some(s=>String(s.content||s.editedHtml||'').trim()||s.executionTask||s.pendingRevision)))throw Error('Structure refresh only before active generation; existing body/task/candidate retained');
      const prepared=buildIsolatedData(isolation.snapshot.sources[key],session.target,data.workflow?.management||{});
      data.workflow={...data.workflow,reportVersions:prepared.workflow.reportVersions};
      changed=true;console.log(JSON.stringify({event:'structure-refreshed',key,sourceVersion:prepared.workflow.reportVersions[0]?.qaSourceVersion,headings:prepared.workflow.reportVersions.flatMap(v=>v.chapters.flatMap(c=>c.sections)).reduce((n,s)=>n+(s.content.match(/<h[3-6]>/g)||[]).length,0)}));
    }
    if(changed)await session.request('/api/projects',{id:session.target.id,name:session.target.name,expectedUpdatedAt:opened.project.updated_at,data});
  }
}

async function prepare(h,source){
  const expected={projectId:h.target.id,params:source.state.draft?.calcParams||source.state.calcParams||{},materials:(source.state.draft?.kb||source.state.kb||[]).map(x=>({title:x.title||x.fileName||x.name||'',content:x.content||''}))};
  const basisRequests=await h.page.evaluate(async ({expected,classificationVersion})=>{
    if(currentProjectId!==expected.projectId||!projectCanEdit())throw Error('Isolated identity/permission mismatch');
    if(JSON.stringify(calcParams||{})!==JSON.stringify(expected.params))throw Error('Original calculation parameters changed; no automatic reconciliation');
    if(kbEntries.length!==expected.materials.length||kbEntries.some((x,i)=>String(x.content||'')!==expected.materials[i].content))throw Error('Complete original materials are not present');
    await ReportLogicCore.load(rlProjectType());
    await ensureReportTableTemplates();
    const prior=projectWorkflow.reportCompletion||{};
    if(!Array.isArray(prior.facts)){
      const facts=reportCompletionFacts();
      const invalid=facts.filter(x=>x.allocationIssue);if(invalid.length)throw Error('Fact ownership requires explicit resolution: '+invalid.map(x=>x.label).join('、'));
      projectWorkflow.reportCompletion={...prior,facts:facts.map(({suggestedOwner,allocationIssue,inputValue,...x})=>({...x,source:String(x.source||'')+'；[系统测试]仅登记生产建议职责，原件待核实'})),version:(prior.version||0)+1};
    }
    const plan=reportCompletionPlan(),basis=plan.sections.filter(x=>x.requirements.basis),requests=[];
    for(const contract of basis){
      const existing=projectWorkflow.reportCompletion.basisCatalogs?.[contract.sectionKey];
      if(existing){
        if(/^\[系统测试\]现有材料原文定位/.test(existing.reason||'')&&existing.classificationVersion!==classificationVersion)throw Error('Existing automatic basis classification requires explicit quiescent migration; body, task and original references retained');
        continue;
      }
      const catalog=await reportBasisCatalogFor(contract);
      requests.push({contract,catalog,coverage:ReportArgument.basisCoverage(catalog)});
    }
    return requests;
  },{expected,classificationVersion:BASIS_CLASSIFICATION_VERSION});
  const registrations=basisRequests.map(request=>({sectionKey:request.contract.sectionKey,sourceItems:request.catalog.items,...classifyBasisCatalog(request)}));
  const initial=await h.page.evaluate(async ({expected,registrations})=>{
    if(currentProjectId!==expected.projectId||!projectCanEdit())throw Error('Isolated identity/permission mismatch after basis classification');
    for(const registration of registrations){
      const {sectionKey,items,sourceItems,version,diagnostics}=registration,contract=reportCompletionPlan().sections.find(x=>x.sectionKey===sectionKey);
      if(!contract||projectWorkflow.reportCompletion.basisCatalogs?.[sectionKey])throw Error('Basis registration changed while preparing; existing classification retained');
      if(JSON.stringify((await reportBasisCatalogFor(contract)).items)!==JSON.stringify(sourceItems))throw Error('Actual basis materials changed while preparing; registration not applied');
      await ReportCompletionContract.bindBasisCatalog(contract,{sectionKey:contract.sectionKey,items},'[系统测试]按实际资料及引用登记分类，未核实效力');
      projectWorkflow.reportCompletion.basisCatalogs={...(projectWorkflow.reportCompletion.basisCatalogs||{}),[contract.sectionKey]:{items,classificationVersion:version,classificationDiagnostics:diagnostics,changedAt:new Date().toISOString(),reason:'[系统测试]现有材料原文定位；received/cited不升级verified'}};
    }
    const gaps=reportGapState();if(gaps&&!gaps.active){projectWorkflow=ReportGapWorkflow.apply(projectWorkflow,gaps.registry,{projectKey:gaps.projectKey,sourceRevision:gaps.sourceRevision,confirmed:true,actorId:'[系统测试]已授权验收-仅登记待核实归属',sectionKeys:reportCompletionPlan().sections.map(x=>x.sectionKey)});}
    const saved=await persistReportDraft();if(!saved.ok||!saved.remote)throw Error('Production project persistence failed before paid AI');
    return {lengthCurrent:!!ReportLengthUI.savedPlan(),facts:reportCompletionFacts(),basis:Object.entries(projectWorkflow.reportCompletion.basisCatalogs||{}).map(([key,x])=>({key,count:x.items.length,statuses:[...new Set(x.items.map(i=>i.status))]})),gap:reportGapState()?.active};
  },{expected,registrations});
  if(!initial.lengthCurrent){
    await h.page.evaluate(()=>{window.__qaLengthConfirmation=ReportLengthUI.confirm({force:true,onlySave:true});});
    await h.page.waitForSelector('#reportLengthPlanModal',{timeout:30000});
    await h.page.locator('#reportLengthPriority').selectOption('pages');
    await h.page.locator('#reportLengthPages').fill('120');await h.page.locator('#reportLengthPages').dispatchEvent('change');
    const ack=h.page.locator('[data-length-budget-ack]');if(await ack.count())await ack.check();
    await h.page.locator('[data-length-confirm]').click();
    if(!await h.page.evaluate(()=>window.__qaLengthConfirmation))throw Error('Production length confirmation was not saved');
  }
  return h.page.evaluate(()=>{
    const plan=reportCompletionPlan();reportAssertCompletionPlan(plan);
    return {at:new Date().toISOString(),projectId:currentProjectId,plan,facts:reportCompletionFacts(),basisCatalogs:projectWorkflow.reportCompletion.basisCatalogs,gapState:reportGapState(),materialSummary:kbEntries.map(x=>({title:x.title||x.fileName||x.name||'',chars:String(x.content||'').length,hash:x.contentHash||null})),rows:chapters.filter(c=>c.checked!==false).flatMap(c=>c.sections.map((s,si)=>({chapterIndex:chapters.indexOf(c),sectionIndex:si,number:(chapters.indexOf(c)+1)+'.'+(si+1),sectionKey:c.name+' / '+s.t,summary:ReportArgument.contract(c.name,s.t).summary,hasBody:reportHasVisibleBody(s),pending:!!s.pendingRevision,taskId:s.executionTask?.id||null}))) };
  });
}

async function generate(h,row){
  return h.page.evaluate(async row=>{
    const c=chapters[row.chapterIndex],s=c?.sections[row.sectionIndex];
    if(!s||c.name+' / '+s.t!==row.sectionKey)throw Error('Section identity changed');
    const serialize=e=>({code:e?.code||'generation-failed',message:String(e?.message||e||''),taskId:e?.taskId||e?.task?.id||null,quality:e?.quality||null,candidateText:e?.candidateText||null,candidateContract:e?.candidateContract||null,task:e?.task||null,raw:e?.raw||null});
    let error=null,ok=false;
    if(s.pendingRevision)error={code:'existing-candidate-preserved',message:'A previous blocked candidate is retained; not overwritten or accepted automatically'};
    else if(reportHasVisibleBody(s)){
      try{reportCheckGeneratedDraft(c,s,s.editedHtml||s.content);ok=true;}catch(e){error=serialize(e);}
    }else{
      try{ok=await airDriveSectionGen(c,s,row.sectionIndex,{autoRepair:true,onFail:e=>{error=serialize(e);}});}catch(e){error=serialize(e);}
    }
    const persisted=await persistReportDraft();
    if(!persisted.ok||!persisted.remote){ok=false;error={code:'generation-save-failed',message:'Generated body/candidate is retained in browser; production remote save failed',previous:error};}
    let task=null;if(s.executionTask?.id){try{const response=await fetch('/api/reportexecution?id='+encodeURIComponent(s.executionTask.id),{headers:authHeaders()});const data=await response.json();task={httpStatus:response.status,...data};}catch(e){task={readError:String(e.message||e)};}}
    return {...row,status:ok?'passed':'failed',at:new Date().toISOString(),content:s.content||'',editedHtml:s.editedHtml||null,completionContract:s.completionContract||null,executionTask:s.executionTask||null,pendingRevision:s.pendingRevision||null,generationFailure:s.generationFailure||null,error,task,persisted};
  },row);
}

async function main(){
  const o=parseArgs();if(o.selfTest){const assert=(await import('node:assert/strict')).default;assert.throws(()=>parseArgs(['--concurrency','5']));assert.throws(()=>parseArgs(['--probe','source:1.1']));assert.equal(parseArgs(['--probe','tax:3.2']).probe,'tax:3.2');let active=0,max=0;await pool([1,2,3,4,5],2,async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;});assert.equal(max,2);console.log(JSON.stringify({selfTest:'passed',checks:4,paidAiCalls:0}));return;}
  const snapshot=await loadSnapshots(path.resolve(ROOT,o.snapshotDir)),isolation=await loadIsolation(snapshot,{baseUrl:o.baseUrl});
  if(!o.probe&&!o.runAll){console.log(JSON.stringify({mode:'dry-run',snapshot:snapshot.out,projects:isolation.projects,paidAiCalls:0}));return;}
  const out=path.join(snapshot.out,'generation-runner'),checkpointFile=path.join(out,'checkpoint.json');
  let checkpoint;try{checkpoint=JSON.parse(await fs.readFile(checkpointFile,'utf8'));if(!o.resume)throw Error('Checkpoint exists: use --resume; no successful section will be regenerated');}catch(e){if(e.code!=='ENOENT')throw e;checkpoint={version:'production-full-generation-v1',startedAt:new Date().toISOString(),sourceHashes:Object.fromEntries(Object.entries(snapshot.sources).map(([k,s])=>[k,s.sourceIdentity.sourceSha256])),projects:isolation.projects,sections:{}};}
  for(const [k,s] of Object.entries(snapshot.sources)){if(checkpoint.sourceHashes[k]!==s.sourceIdentity.sourceSha256||!await checkSourceUnchanged(s.sourceIdentity))throw Error('Immutable source identity changed: '+k);}
  let writing=Promise.resolve();const save=()=>{const value=structuredClone(checkpoint);writing=writing.then(()=>write(checkpointFile,value));return writing;};
  const keys=o.probe?[o.probe.split(':')[0]]:['tax','longgang'],harnesses={},preflights={};
  try{
    if(o.refreshStructure||o.retrySections.length)await prepareIsolatedRetry(isolation,keys,o,out);
    for(const key of keys){
      const h=harnesses[key]=await openProductionHarness(isolation,key,{allowAi:true});
      preflights[key]=await prepare(h,snapshot.sources[key]);await write(path.join(out,key,'preflight.json'),preflights[key]);
      console.log(JSON.stringify({event:'preflight',key,projectId:h.target.id,sectionCount:preflights[key].rows.length,planId:preflights[key].plan.planId,proseTotal:preflights[key].plan.proseTotal,materials:preflights[key].materialSummary}));
    }
    const rows=keys.flatMap(key=>preflights[key].rows.map(r=>({...r,key}))),selected=o.probe?rows.filter(r=>r.key+':'+r.number===o.probe):rows;
    if(!selected.length)throw Error('Requested section not found');
    const worker=async row=>{
      const id=row.key+':'+row.number;checkpoint.sections[id]={...(checkpoint.sections[id]||{}),status:'running',startedAt:new Date().toISOString(),sectionKey:row.sectionKey};await save();
      console.log(JSON.stringify({event:'section-start',id,summary:row.summary}));
      let result;try{result=await generate(harnesses[row.key],row);}catch(e){result={...row,status:'failed',error:{code:e.code||'runner-error',message:safe(e)},at:new Date().toISOString()};}
      const file=path.join(out,row.key,'sections',row.number+'.json');await write(file,result);checkpoint.sections[id]={status:result.status,at:result.at,sectionKey:row.sectionKey,file,taskId:result.executionTask?.id||result.error?.taskId||null,error:result.error};await save();
      console.log(JSON.stringify({event:'section-finish',id,status:result.status,chars:result.content?.length||0,taskId:checkpoint.sections[id].taskId,error:result.error&&{code:result.error.code,message:result.error.message}}));return result;
    };
    await pool(selected.filter(r=>!r.summary),o.concurrency,worker);
    const summaries=selected.filter(r=>r.summary),ready=[];
    for(const row of summaries){
      const failed=incompleteDetailSections(rows,checkpoint,row.key);
      if(failed.length){checkpoint.sections[row.key+':'+row.number]={status:'dependency-blocked',sectionKey:row.sectionKey,error:{code:'detail-sections-incomplete',message:failed.length+' detail sections have not passed; summary AI was not called'}};}
      else ready.push(row);
    }
    await save();await pool(ready,o.concurrency,worker);
    for(const key of keys){
      const h=harnesses[key],data=await h.page.evaluate(()=>({projectId:currentProjectId,project,calcType,calcParams,financialContext:reportFinancialContext(),authoritativeTables:chapters.flatMap(c=>c.sections.flatMap(s=>(s.completionContract?.frozenTables?.tables||[]).map(t=>({sectionKey:c.name+' / '+s.t,id:t.id,html:t.html,sourceSnapshotId:s.completionFinancialSource?.snapshotId||projectWorkflow.currentCalcSnapshotId,sourceSha256:s.completionFinancialSource?.sourceSignature||null})))),plan:reportCompletionPlan(),chapters,workflow:projectWorkflow,materialSummary:kbEntries.map(x=>({title:x.title||x.fileName||x.name||'',chars:String(x.content||'').length,hash:x.contentHash||null}))}));
      data.authoritativeTables=data.authoritativeTables.map(table=>({...table,sourceSignature:table.sourceSha256,sourceSha256:table.sourceSha256?sha(table.sourceSha256):null}));
      data.sourceUnchanged=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);data.at=new Date().toISOString();await write(path.join(out,key,'final.json'),data);await write(path.join(out,key,'browser-ledger.json'),{errors:h.errors,requests:h.ledger,taskIds:[...h.taskIds]});
      if(!data.sourceUnchanged)throw Error('Source changed during acceptance: '+key);
    }
    checkpoint.completedAt=new Date().toISOString();checkpoint.mode=o.probe?'probe':'full';checkpoint.counts=Object.values(checkpoint.sections).reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});await save();
    console.log(JSON.stringify({event:'run-finish',out,counts:checkpoint.counts,sourceUnchanged:true}));
    if(Object.values(checkpoint.sections).some(s=>s.status!=='passed'))process.exitCode=2;
  }finally{await writing;for(const h of Object.values(harnesses))await h.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(safe(e));process.exitCode=1;});
