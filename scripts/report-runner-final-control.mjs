// One already-running, isolated acceptance runner only; no second browser/run.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const OUT=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner');
const IDS={tax:'f4395f64-af1b-43bd-b809-580b5ec9406b',longgang:'2884b7a3-960f-40c0-af89-5d19e0284836'};
const KNOWN_TAX_SEMANTIC=['1.1','2.1','2.2','2.3','4.1','5.2','6.1','7.1','7.2','8.1','8.2','9.1','9.2','9.3','11.2','11.3','11.5','11.6'];
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function artifact(key,name,data){const file=path.join(OUT,key,'recovery',name+'-'+Date.now()+'.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data,null,2),{flag:'wx'});return file;}
function extract(source,name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));if(start<0)throw Error('Missing production function '+name);const tail=source.slice(start),next=tail.slice(tail.indexOf('\n')+1).search(/^(?:async )?function \w+\(/m);const code=next<0?tail:tail.slice(0,tail.indexOf('\n')+1+next);new vm.Script(code);return code;}
export async function hotloadAndVerify(harnesses,checkpoint){
  const source=await fs.readFile('report.js','utf8'),calc=await fs.readFile('calc.js','utf8');
  const names=['reportBusinessStructureBinding','reportBusinessHeadings','reportCompletionPlan','reportCompletionEntries','reportGenerationRulesIdentity','reportFinancialContext','reportFinancialIdentity','reportCandidateInputIdentity','reportFinancialCandidateIssues','reportSectionContract','reportCurrentAssumptionsContext','reportSummarySourceSnapshot','generateSection','reviseSection','reportDurableSectionCall'];
  const code=names.map(name=>extract(source,name)).join('\n')+'\n'+extract(calc,'buildCalcDigest');
  const reports=[];globalThis.__qaFinalizationHeld=true;
  for(const [key,h]of Object.entries(harnesses)){
    if(h.target.id!==IDS[key])throw Error('Exact live test copy required');
    const before=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused)throw Error('Paused exact test copy required');const {ts,...data}=buildDraftData();return JSON.stringify(data);},IDS[key]);
    for(const file of ['report-completion-contract.js','report-business-structure.js','report-orchestration-client.js','report-financial-tables.js'])await h.page.addScriptTag({content:await fs.readFile(file,'utf8')});
    await h.page.evaluate(code=>window.eval(code),code);
    const validation=await h.page.evaluate(({expected,before})=>{
      const {ts,...data}=buildDraftData();if(currentProjectId!==expected||JSON.stringify(data)!==before)throw Error('Hotload must not mutate any source/body/task');
      if(!ReportCompletionContract.verifyDocumentReferenceDependencies||!reportDurableSectionCall.toString().includes('verifyDocumentReferenceDependencies'))throw Error('Final document dependency guard not installed');
      let plan=null,sourceError=null;try{plan=reportCompletionPlan();reportAssertCompletionPlan(plan);}catch(e){if(e.code!=='REPORT_FINANCIAL_SOURCE_INVALID')throw e;sourceError={code:e.code,message:e.message};}return {projectId:currentProjectId,inputIdentity:reportCandidateInputIdentity(),planId:plan?.planId,proseTotal:plan?.proseTotal,sections:plan?.sections.length,sourceError,financeVersion:ReportFinancialTables.version||ReportFinancialTables.VERSION,paused:window.__qaDispatchPaused};
    },{expected:IDS[key],before});
    if(!h.__qaCloseHeld){h.__qaCloseHeld=true;const original=h.close.bind(h);h.close=async()=>{globalThis.__qaOriginalLoopFinished=true;while(globalThis.__qaFinalizationHeld)await new Promise(r=>setTimeout(r,250));return original();};}
    if(!h.__qaCheckpointGate){h.__qaCheckpointGate=true;await h.page.exposeFunction('__qaIncompleteCurrentDetails',async()=>{
      const rows=await h.page.evaluate(()=>chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary}))));
      return rows.filter(r=>!r.summary&&checkpoint.sections[key+':'+r.number]?.status!=='passed').map(r=>r.number);
    });}
    await h.page.evaluate(()=>{if(!window.__qaCheckpointAirDrive){window.__qaCheckpointAirDrive=window.__qaOriginalAirDrive;window.__qaOriginalAirDrive=async(c,s,si,opts)=>{if(ReportArgument.contract(c.name,s.t).summary){const incomplete=await window.__qaIncompleteCurrentDetails();if(incomplete.length){const e=Object.assign(new Error('本轮仍有'+incomplete.length+'个明细小节未通过，未调用汇总AI'),{code:'detail-sections-incomplete'});opts?.onFail?.(e);return false;}}return window.__qaCheckpointAirDrive(c,s,si,opts);};}});
    reports.push({key,...validation,sourceBodyUnchanged:true,checkpointOnlySummaryBarrier:true});
  }
  const h=harnesses.tax,checks=[];
  for(const number of ['6.3','9.3']){
    const original=JSON.parse(await fs.readFile(path.join(OUT,'tax','recovery','original-task-'+number+'.json'),'utf8'));
    const checked=await h.page.evaluate(async({number,original})=>{
      if(!window.__qaDispatchPaused||currentProjectId!==original.projectId)throw Error('Exact paused test copy required');
      const [ci,si]=number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si],contract=reportSectionContract(c,s);
      if(s.executionTask?.id!==original.taskId)throw Error('Original paid task identity changed');
      const response=await fetch('/api/reportexecution?id='+encodeURIComponent(original.taskId),{headers:authHeaders()}),payload=await response.json(),task=payload.task;
      if(!response.ok||task?.status!=='completed'||!task.rawText)throw Error('Original completed raw unavailable');
      if(number==='6.3'){
        const decoded=ReportCompletionContract.decodeStructured(task.rawText,original.input.qualityContract),quality=ReportCompletionContract.inspect(decoded.text,contract);
        return {number,originalTaskId:original.taskId,originalRaw:task.rawText,originalContract:original.input.qualityContract,originalSection:s,derivedText:decoded.text,currentContract:contract,quality,decodeIssues:decoded.issues,fullGrammarRestored:/安排方向，/.test(decoded.text)&&/均依赖尚未闭合的依据，/.test(decoded.text),notNewAiReceipt:true};
      }
      const preparation={context:reportFinancialContext(),sectionKey:contract.sectionKey,requiredTables:contract.requiredTables};
      const entries=reportCompletionEntries({sectionKey:contract.sectionKey,html:renderContent(task.text)},preparation),text=entries.find(e=>e.key===contract.sectionKey).text;
      let bound=await ReportCompletionContract.bindDocumentReferences(contract,entries);bound=await ReportCompletionContract.bindFrozenTables(bound,text,'qa-final-no-paid-check:'+original.taskId+':financial='+encodeURIComponent(JSON.stringify(reportFinancialIdentity())));bound=await ReportCompletionContract.bindProgramProse(bound,text);
      const quality=ReportCompletionContract.inspect(text,bound);
      return {number,originalTaskId:original.taskId,sourceBinding:preparation.binding,quality,tableBudget:contract.budget,requiredTables:contract.requiredTables,derivedText:text,currentContract:bound,notNewAiReceipt:true};
    },{number,original});
    const file=await artifact('tax','final-hotload-check-'+number,checked);
    checks.push({number,file,fullGrammarRestored:checked.fullGrammarRestored,metrics:checked.quality.metrics,budget:checked.tableBudget,errors:[...(checked.decodeIssues||[]),...(checked.quality.issues||[])].filter(i=>i.severity==='error').map(i=>({code:i.code,message:i.message})),originalTaskId:original.taskId});
    if(number==='6.3'&&checked.fullGrammarRestored&&!checked.decodeIssues.some(i=>i.severity==='error')&&checked.quality.status!=='blocked'){
      await h.page.evaluate(async({checked,file})=>{
        const [ci,si]=checked.number.split('.').map(x=>Number(x)-1),s=chapters[ci].sections[si];if(!window.__qaDispatchPaused||JSON.stringify(s)!==JSON.stringify(checked.originalSection))throw Error('6.3 source changed before deterministic recovery');
        s.content=checked.derivedText;s.editedHtml=null;s.qaRecoveryDerived={version:'fixed-gap-grammar-current-inspection-v1',artifact:file,originalTaskId:checked.originalTaskId,notNewAiReceipt:true,technicalPassed:true,factsVerified:false};
        const saved=await persistReportDraft();if(!saved.ok||!saved.remote)throw Error('6.3 recovered body retained but remote save failed');
      },{checked,file});
      const sectionFile=path.join(OUT,'tax','sections','6.3.json'),previous=JSON.parse(await fs.readFile(sectionFile,'utf8'));await artifact('tax','before-final-6.3',previous);
      const result={...previous,content:checked.derivedText,editedHtml:null,qaRecoveryDerived:{artifact:file,notNewAiReceipt:true},at:new Date().toISOString()};await fs.writeFile(sectionFile,JSON.stringify(result,null,2));
      checkpoint.sections['tax:6.3']={...checkpoint.sections['tax:6.3'],status:'passed',file:sectionFile,error:null,derivedArtifact:file};
    }
  }
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
  const receipt={at:new Date().toISOString(),serverPid:3104,smokeLog:'outputs/report-standardization/1010-final-service-20261010-015226.stdout.log',reports,checks,newPaidAiCalls:0};const receiptFile=await artifact('tax','final-hotload-receipt',receipt);return {receiptFile,...receipt};
}
export async function inspectorCall(expression){const list=await(await fetch('http://127.0.0.1:9229/json/list')).json();if(list.length!==1||!String(list[0].url).includes('report-full-generation-runner.mjs'))throw Error('Exact unique runner inspector required');const socket=new WebSocket(list[0].webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});return new Promise((resolve,reject)=>{socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.id!==1)return;socket.close();if(data.error||data.result?.exceptionDetails)reject(Error(JSON.stringify(data.error||data.result.exceptionDetails)));else resolve(data.result?.result?.value);};socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});}
export async function pauseAndReloadCurrentContracts(harnesses){
  if(globalThis.__qaTargetedBatchRunning)throw Error('Do not reload while the targeted batch is active');
  const receipts=[];
  for(const [key,h]of Object.entries(harnesses)){
    const before=await h.page.evaluate(expected=>{if(currentProjectId!==expected)throw Error('Exact isolated project required');window.__qaDispatchPaused=true;const {ts,...draft}=buildDraftData();return JSON.stringify(draft);},IDS[key]);
    for(const file of ['report-completion-contract.js','report-argument.js','report-business-structure.js','report-financial-tables.js'])await h.page.addScriptTag({content:await fs.readFile(file,'utf8')});
    const reportSource=await fs.readFile('report.js','utf8');
    const names=['reportBusinessStructureBinding','reportBusinessHeadings','reportCompletionPlan','reportCompletionEntries','reportGenerationRulesIdentity','reportFinancialContext','reportFinancialIdentity','reportCandidateInputIdentity','reportFinancialCandidateIssues','reportSectionContract','reportBasisCatalogFor','reportVerifyBasisMaterials','reportCurrentAssumptionsContext','reportSummarySourceSnapshot','generateSection','reviseSection','reportDurableSectionCall'];
    await h.page.evaluate(code=>window.eval(code),names.map(name=>extract(reportSource,name)).join('\n'));
    const result=await h.page.evaluate(({expected,before})=>{const {ts,...draft}=buildDraftData();if(currentProjectId!==expected||JSON.stringify(draft)!==before)throw Error('Contract hotload mutated data');const plan=reportCompletionPlan();reportAssertCompletionPlan(plan);const section=plan.sections.find(x=>x.sectionNumber==='9.3'||x.sectionKey.includes(' / 财务评价指标'));return {projectId:currentProjectId,paused:true,inputIdentity:reportCandidateInputIdentity(),planId:plan.planId,financeVersion:ReportFinancialTables.VERSION||ReportFinancialTables.version,section93:section?.requirements};},{expected:IDS[key],before});
    const file=await artifact(key,'c5-finance6-pure-hotload',result);receipts.push({key,file,...result});
  }
  return {newPaidAiCalls:0,receipts};
}
export async function freezeWorkingSnapshot(harnesses,checkpoint){
  const {loadSnapshots,checkSourceUnchanged}=await import('./report-generation-acceptance.mjs');
  const snapshot=await loadSnapshots(path.dirname(OUT)),receipts=[];
  for(const [key,h]of Object.entries(harnesses)){
    const data=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused)throw Error('Exact paused isolated working copy required');return {projectId:currentProjectId,project,calcType,calcParams,financialContext:reportFinancialContext(),plan:reportCompletionPlan(),chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),materialSummary:kbEntries.map(x=>({id:x.id,name:x.name||x.title,characters:String(x.text||x.content||'').length})),inputIdentity:reportCandidateInputIdentity()};},IDS[key]);
    const intended=JSON.parse(JSON.stringify(data.chapters)),selections=[],recoveryFiles=await fs.readdir(path.join(OUT,key,'recovery'));
    for(let ci=0;ci<data.chapters.length;ci++)for(let si=0;si<data.chapters[ci].sections.length;si++){
      const s=data.chapters[ci].sections[si],number=(ci+1)+'.'+(si+1),sectionKey=data.chapters[ci].name+' / '+s.t,contract=data.plan.sections.find(x=>x.sectionKey===sectionKey),row=checkpoint.sections[key+':'+number],summary=await h.page.evaluate(({ci,si})=>ReportArgument.contract(chapters[ci].name,chapters[ci].sections[si].t).summary,{ci,si});
      let text='',selector='not-generated',artifactFile=null;
      if(row?.status==='passed'&&(s.editedHtml||s.content)){text=s.editedHtml||s.content;selector=s.editedHtml?'passed.editedHtml':'passed.content';}
      else if(!summary){
        const file=recoveryFiles.filter(x=>x.startsWith('free-protocol-'+number+'-')).sort().at(-1),derived=file?JSON.parse(await fs.readFile(path.join(OUT,key,'recovery',file),'utf8')):null;
        if(s.qaBoundedAiRevision?.currentInputIdentity===data.inputIdentity&&s.qaBoundedAiRevision.technicalPassed&&s.content){text=s.content;selector='qaBoundedAiRevision.current-inspected.content';artifactFile=s.qaBoundedAiRevision.afterFile||s.qaBoundedAiRevision.beforeFile;}
        else if(s.qaBoundedAiRevision?.currentInputIdentity===data.inputIdentity&&s.qaBoundedAiRevision.candidateText){text=s.qaBoundedAiRevision.candidateText;selector='qaBoundedAiRevision.unpassed.candidateText';artifactFile=s.qaBoundedAiRevision.afterFile||s.qaBoundedAiRevision.beforeFile;}
        else if(derived?.technicalPassed&&derived.originalSection?.executionTask?.id===s.executionTask?.id){text=derived.text;selector='current-inspected-derived.text';artifactFile=path.join(OUT,key,'recovery',file);}
        else if(s.pendingRevision?.after){text=s.pendingRevision.after;selector='pendingRevision.after';}
        else if(s.editedHtml||s.content){text=s.editedHtml||s.content;selector=s.editedHtml?'unpassed.editedHtml':'unpassed.content';}
        else{const file=path.join(OUT,key,'sections',number+'.json');try{const a=JSON.parse(await fs.readFile(file,'utf8'));text=String(a.error?.candidateText||a.task?.task?.text||'');selector=text?(a.error?.candidateText?'artifact.error.candidateText':'artifact.task.task.text'):'not-generated';artifactFile=text?file:null;}catch(e){if(e.code!=='ENOENT')throw e;}}
      }
      const metrics=await h.page.evaluate(text=>ReportCompletionContract.measure(text),text),textSha256=crypto.createHash('sha256').update(text).digest('hex');
      selections.push({number,sectionKey,summary,checkpointStatus:row?.status||'not-started',selector,artifactFile,textSha256,proseCharacters:metrics.proseCharacters,target:contract?.requirements.proseTarget||0,tableCount:metrics.tableCount,body:text,notAccepted:row?.status!=='passed'});
      intended[ci].sections[si].content=text;intended[ci].sections[si].editedHtml=null;
    }
    data.at=new Date().toISOString();data.sourceUnchanged=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);if(!data.sourceUnchanged)throw Error('Formal source changed');
    data.intendedAcceptedBody=selections;data.intendedChapters=intended;data.intendedWorkingOnly=true;data.noFinalCertification=true;
    data.lengthProjection={detailProse:selections.filter(x=>!x.summary).reduce((n,x)=>n+x.proseCharacters,0),summaryProse:selections.filter(x=>x.summary).reduce((n,x)=>n+x.proseCharacters,0),summaryReserve:selections.filter(x=>x.summary).reduce((n,x)=>n+x.target,0),totalTarget:selections.reduce((n,x)=>n+x.target,0)};data.lengthProjection.predictedProse=data.lengthProjection.detailProse+Math.max(data.lengthProjection.summaryProse,data.lengthProjection.summaryReserve);
    const file=await artifact(key,'working-final',data),intendedFile=await artifact(key,'working-pagination',{...data,acceptedChapters:data.chapters,chapters:intended,diagnosticOnly:true});
    const finalFile=path.join(OUT,key,'final.json');try{await artifact(key,'before-working-final',JSON.parse(await fs.readFile(finalFile,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(finalFile,JSON.stringify(data,null,2));
    receipts.push({key,file,intendedFile,finalFile,at:data.at,sourceUnchanged:true,lengthProjection:data.lengthProjection,selectors:Object.fromEntries([...new Set(selections.map(x=>x.selector))].map(x=>[x,selections.filter(y=>y.selector===x).length])),newPaidAiCalls:0});
  }
  const file=await artifact('tax','working-snapshot-batch',{at:new Date().toISOString(),receipts,newPaidAiCalls:0});return {file,receipts};
}
// Protocol-only recovery: immutable paid responses stay untouched. Current
// inspection and any production financial synchronization are separate evidence.
export async function inspectFreeProtocolBatch(harnesses,checkpoint){
  const backend=await import('../functions/api/reportexecution.js?free-recovery='+Date.now());
  const {Client}=createRequire(import.meta.url)('../local-server/node_modules/pg');
  const rows=[],receipts=[];
  for(const [key,h]of Object.entries(harnesses)){
    const live=await h.page.evaluate(()=>chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary}))));
    for(const row of live)if(!row.summary&&checkpoint.sections[key+':'+row.number]?.status!=='passed')rows.push([key,row.number]);
  }
  for(const [key,number]of rows){
    try{
    const h=harnesses[key],saved=JSON.parse(await fs.readFile(path.join(OUT,key,'sections',number+'.json'),'utf8'));
    const originalContract=saved.error?.candidateContract||saved.pendingRevision?.completionContract||saved.completionContract;
    const source=await h.page.evaluate(async({expected,number,originalContract})=>{
      if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable isolated copy required');
      const [ci,si]=number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si],before=JSON.stringify(s),identity=reportCandidateInputIdentity(),id=s.executionTask?.id;
      if(!id||s.locked)throw Error('Unlocked original paid task required');
      const response=await fetch('/api/reportexecution?id='+encodeURIComponent(id),{headers:authHeaders()}),payload=await response.json();
      if(!response.ok||payload.task?.id!==id||payload.task.status!=='completed'||!payload.task.rawText)throw Error('Exact original completed response unavailable');
      let contract=reportSectionContract(c,s);
      // Reuse old source-bound table/basis references only for decoding the old
      // raw. They are never presented as a current AI input receipt.
      if(identity!==reportCandidateInputIdentity()||before!==JSON.stringify(s))throw Error('Recovery inspection raced with changes');
      return {projectId:expected,number,sectionKey:c.name+' / '+s.t,originalSection:JSON.parse(before),currentInputIdentity:identity,currentContract:contract,originalContract:originalContract||s.pendingRevision?.completionContract||s.completionContract,task:payload.task};
    },{expected:IDS[key],number,originalContract});
    const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000,query_timeout:30000});
    try{await db.connect();await db.query('BEGIN READ ONLY');const q=await db.query('SELECT id,project_id,section_key,input_hash,input_json FROM report_section_tasks WHERE id=$1 AND project_id=$2',[source.task.id,IDS[key]]);if(q.rowCount!==1||q.rows[0].section_key!==source.sectionKey)throw Error('Original immutable task ownership/section mismatch');source.originalInput=q.rows[0];source.originalContract=q.rows[0].input_json.qualityContract||source.originalContract;await db.query('ROLLBACK');}finally{await db.end();}
    let structured=source.task.structuredText||source.task.rawText,transformation='current-decoder-only',patchPlan=null,patchIssues=[];
    if(/^\s*\{\s*"additions"\s*:/.test(source.task.rawText)){
      const base=source.task.structuredText;
      if(!base||base===source.task.rawText)throw Error('Structure patch missing immutable base for '+key+':'+number);
      const prior=await h.page.evaluate(({base,contract})=>{const decoded=ReportCompletionContract.decodeStructured(base,contract);return {rawText:base,structuredText:base,quality:ReportCompletionContract.inspect(decoded.text,contract)};},{base,contract:source.currentContract});
      patchPlan=backend.reportStructureRepairPlan(prior,source.currentContract);
      if(patchPlan){const patched=backend.reportApplyStructurePatch(source.task.rawText,patchPlan);structured=patched.structuredText;patchIssues=patched.issues;transformation='current-derived-structure-plan-original-additions';}
      else patchIssues=[{code:'qa-structure-plan-unavailable',severity:'error',message:'Current contract does not authorize the original additions; no content changed'}];
    }else if(key==='tax'&&number==='11.5'&&!/^\s*[\[{]/.test(source.task.rawText)){
      const raw=source.task.rawText,slot=await h.page.evaluate(contract=>ReportCompletionContract.outputSlots(contract)[0].slot,source.currentContract),blocks=[];
      for(const part of raw.replace(/\r\n/g,'\n').split(/\n\s*\n/).filter(x=>x.trim())){
        const heading=part.match(/^(#{3,4})\s+([^\n]+)$/);
        if(heading)blocks.push({kind:'heading',slot,level:heading[1].length,text:heading[2]});
        else {if(/(?:^|\n)\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s)|<[^>]+>|\[\[\/?TABLE\]\]|\|/.test(part))throw Error('Ambiguous Markdown block; original raw retained');blocks.push({kind:'paragraph',slot,text:part.split('\n').join(' ')});}
      }
      if(!blocks.some(x=>x.kind==='heading')||!blocks.some(x=>x.kind==='paragraph'))throw Error('Incomplete Markdown, no protocol guess allowed');
      structured=JSON.stringify({blocks});transformation='lossless-markdown-heading-paragraph-envelope';
    }
    const derived=await h.page.evaluate(async({source,structured,transformation,patchIssues,patchPlan})=>{
      const [ci,si]=source.number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si];
      if(currentProjectId!==source.projectId||!window.__qaDispatchPaused||JSON.stringify(s)!==JSON.stringify(source.originalSection)||reportCandidateInputIdentity()!==source.currentInputIdentity)throw Error('Exact original changed before deriving');
      const decodeContract=transformation==='current-decoder-only'?source.originalContract:source.currentContract;
      // Legacy tasks without a bound structured contract are re-inspected as
      // their preserved rendered body, never decoded against a fabricated input.
      if(!decodeContract&&!source.task.text)throw Error('Immutable legacy body and decode contract missing');
      const decoded=decodeContract?ReportCompletionContract.decodeStructured(structured,decodeContract):{text:source.originalSection.pendingRevision?.after||source.originalSection.editedHtml||source.originalSection.content||source.task.text,issues:[],legacyRenderedBodyOnly:true},prep={context:reportFinancialContext(),sectionKey:source.sectionKey,requiredTables:source.currentContract.requiredTables};
      const entries=reportCompletionEntries({sectionKey:source.sectionKey,html:renderContent(decoded.text)},prep),text=entries.find(x=>x.key===source.sectionKey).text;
      let contract=await ReportCompletionContract.bindDocumentReferences(source.currentContract,entries);
      if(/<table\b/i.test(text))contract=await ReportCompletionContract.bindFrozenTables(contract,text,'qa-free-protocol-derived:'+source.task.id+':financial='+encodeURIComponent(JSON.stringify(reportFinancialIdentity())));
      contract=await ReportCompletionContract.bindProgramProse(contract,text);
      const quality=ReportCompletionContract.inspect(text,contract),financialBinding=prep.binding||null,financialIssues=reportFinancialCandidateIssues({after:text,completionContract:contract,completionFinancialSource:financialBinding,completionInputPlanId:source.currentInputIdentity});
      const plan=reportCompletionPlan(),review=ReportCompletionContract.reviewDocument(entries,{...plan,sections:plan.sections.map(x=>x.sectionKey===source.sectionKey?contract:x)}),referenceIssues=(review.reviews.find(x=>x.key===source.sectionKey)?.issues||[]).filter(x=>x.severity==='error'&&/^(?:bound-)?reference-/.test(x.code));
      const errors=[...decoded.issues,...patchIssues,...quality.issues,...financialIssues,...referenceIssues].filter(x=>x.severity==='error');
      if(currentProjectId!==source.projectId||JSON.stringify(s)!==JSON.stringify(source.originalSection)||reportCandidateInputIdentity()!==source.currentInputIdentity||!projectCanEdit())throw Error('Current guard changed during protocol review');
      return {version:'qa-free-protocol-current-review-v1',at:new Date().toISOString(),...source,transformation:decoded.legacyRenderedBodyOnly?'legacy-preserved-body-current-inspection':transformation,structured,patchPlan,decodeIssues:decoded.issues,patchIssues,text,currentContract:contract,financialBinding,quality,financialIssues,referenceIssues,errors,technicalPassed:errors.length===0,notNewAiReceipt:true,originalAiReceiptUnchanged:true,factsVerified:false};
    },{source,structured,transformation,patchIssues,patchPlan});
    const file=await artifact(key,'free-protocol-'+number,derived);receipts.push({key,number,file,taskId:source.task.id,transformation,technicalPassed:derived.technicalPassed,proseCharacters:derived.quality.metrics.proseCharacters,errors:derived.errors.map(x=>({code:x.code,message:x.message})),newPaidAiCalls:0});
    console.log(JSON.stringify({event:'free-protocol-inspected',...receipts.at(-1)}));
    }catch(e){const failure={key,number,technicalPassed:false,newPaidAiCalls:0,errors:[{code:e.code||'free-protocol-inspection-failed',message:String(e.message||e)}],originalAiReceiptUnchanged:true};const file=await artifact(key,'free-protocol-error-'+number,failure);receipts.push({...failure,file});console.log(JSON.stringify({event:'free-protocol-inspected',...receipts.at(-1)}));}
  }
  const result={at:new Date().toISOString(),newPaidAiCalls:0,receipts};const file=await artifact('tax','all-detail-free-protocol-batch',result);return {file,...result};
}
export async function currentLengthAndFailureMatrix(harnesses,checkpoint){
  const results=[];
  for(const [key,h]of Object.entries(harnesses)){
    const live=await h.page.evaluate(expected=>{
      if(currentProjectId!==expected||!window.__qaDispatchPaused)throw Error('Exact paused copy required');
      const plan=reportCompletionPlan(),sections=chapters.flatMap((c,ci)=>c.sections.map((s,si)=>{const contract=plan.sections.find(x=>x.sectionKey===c.name+' / '+s.t),body=String(s.editedHtml||s.content||''),candidate=String(s.pendingRevision?.after||''),quality=s.pendingRevision?.quality||s.executionTask?.quality||{};return {number:(ci+1)+'.'+(si+1),sectionKey:contract.sectionKey,summary:ReportArgument.contract(c.name,s.t).summary,taskId:s.executionTask?.id,bodyCharacters:ReportCompletionContract.measure(body).proseCharacters,candidateCharacters:ReportCompletionContract.measure(candidate).proseCharacters,bodyPresent:!!body,candidatePresent:!!candidate,target:contract.requirements.proseTarget,max:contract.requirements.proseMax,errors:(quality.issues||[]).filter(x=>x.severity==='error'),warnings:(quality.issues||[]).filter(x=>x.severity==='warning')};}));
      return {at:new Date().toISOString(),projectId:expected,planId:plan.planId,planProseTarget:plan.proseTotal,sections};
    },IDS[key]);
    const directory=path.join(OUT,key,'recovery'),files=await fs.readdir(directory),rows=[];
    for(const row of live.sections){
      const checkpointRow=checkpoint.sections[key+':'+row.number],lastFile=files.filter(x=>x.startsWith('free-protocol-'+row.number+'-')).sort().at(-1),derived=lastFile?JSON.parse(await fs.readFile(path.join(directory,lastFile),'utf8')):null;
      let rawProse=0;try{const a=JSON.parse(await fs.readFile(path.join(OUT,key,'sections',row.number+'.json'),'utf8'));rawProse=String(a.task?.task?.text||'').replace(/\s/g,'').length;}catch{}
      const effective=row.candidateCharacters||row.bodyCharacters||derived?.quality?.metrics?.proseCharacters||rawProse;
      rows.push({...row,checkpointStatus:checkpointRow?.status||'not-started',semanticFinding:checkpointRow?.semanticFinding||null,latestDerived:derived?{file:path.join(directory,lastFile),technicalPassed:derived.technicalPassed,proseCharacters:derived.quality.metrics.proseCharacters,errors:derived.errors}:null,effectiveWorkingProseCharacters:effective,workingTextNotFinal:true});
    }
    const counts={freeProtocol:[],missingContent:[],factualCorrection:[],notStarted:[],passed:[]};
    for(const row of rows){if(row.checkpointStatus==='passed')counts.passed.push(row.number);else if(row.semanticFinding||KNOWN_TAX_SEMANTIC.includes(row.number)&&key==='tax'||key==='longgang'&&row.number==='8.2')counts.factualCorrection.push(row.number);else if(row.latestDerived?.technicalPassed)counts.freeProtocol.push(row.number);else if(row.checkpointStatus==='not-started')counts.notStarted.push(row.number);else counts.missingContent.push(row.number);}
    const result={...live,sections:rows,counts,totalWorkingProseCharacters:rows.reduce((n,x)=>n+x.effectiveWorkingProseCharacters,0),totalAcceptedBodyProseCharacters:rows.reduce((n,x)=>n+x.bodyCharacters,0),totalTarget:rows.reduce((n,x)=>n+x.target,0),noActualPaginationYet:true,newPaidAiCalls:0};
    const file=await artifact(key,'current-length-failure-matrix',result);results.push({key,file,...Object.fromEntries(['totalWorkingProseCharacters','totalAcceptedBodyProseCharacters','totalTarget','counts'].map(x=>[x,result[x]]))});
  }
  return {at:new Date().toISOString(),results};
}
export async function adoptCurrentLonggang(harnesses){
  const h=harnesses.longgang;if(h.target.id!==IDS.longgang)throw Error('Exact isolated Longgang required');
  const snapshotDir=path.dirname(OUT),source=JSON.parse(await fs.readFile(path.join(snapshotDir,'longgang-source.json'),'utf8')),draft=source.state.draft||source.state;
  const engineSha256=crypto.createHash('sha256').update(await fs.readFile('nrcalc.js')).digest('hex');
  const before=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||chapters.some(c=>c.sections.some(s=>s.executionTask||s.content||s.editedHtml)))throw Error('Pristine paused exact test copy required');return buildDraftData();},IDS.longgang);
  const backup=await artifact('longgang','before-explicit-current-engine-adoption',before);
  const adopted=await h.page.evaluate(async({expected,params,engineSha256,backup})=>{
    if(currentProjectId!==expected||!window.__qaDispatchPaused||JSON.stringify(calcParams)!==JSON.stringify(params)||!projectCanEdit())throw Error('Adoption exact identity/params/permission mismatch');
    const oldSnapshots=JSON.stringify(projectWorkflow.calcSnapshots),old=projectWorkflow.calcSnapshots.find(x=>x.id===projectWorkflow.currentCalcSnapshotId),body=JSON.stringify(chapters),result=runCalcEngine(calcType,calcParams);result.__ctype=calcType;
    if(calcType==='gaibao'){result.sens=computeSensitivity(calcParams);result.modeCompare=computeModeCompare(calcParams);}
    calcResult=result;scParams=calcParams;scResult=result;aiReportCalculationMode='full';aiReportParamsConfirmed=true;
    const snap=ProjectWorkflow.createCalcSnapshot(projectWorkflow,calcType,calcParams,result,{reason:'[系统测试]按完全相同用户参数以当前生产引擎重建；不代表原协议/正式来源测算',confirmedBy:'[系统测试]本轮用户授权实际生成验收'});
    snap.inputMode='full';snap.qaEngineRebuild={version:'isolated-current-engine-v1',engineSha256,priorSnapshotId:old.id,priorSnapshotHash:old.hash,sourceBackup:backup,identicalParameters:true,originalProjectUntouched:true};
    if(JSON.stringify(projectWorkflow.calcSnapshots.slice(0,-1))!==oldSnapshots||JSON.stringify(chapters)!==body||JSON.stringify(calcParams)!==JSON.stringify(params))throw Error('Adoption altered old snapshots/body/params');
    const binding=ReportFinancialTables.bindSource(reportFinancialContext());reportAssertCompletionPlan(reportCompletionPlan());
    const saved=await persistReportDraft();if(!saved?.ok||!saved.remote)throw Error('New isolated snapshot retained; remote save failed, do not generate');
    return {projectId:currentProjectId,oldSnapshot:old,newSnapshot:snap,params:calcParams,resultSummary:result.summary,sourceBinding:binding,remoteSaved:true,oldSnapshotsRetained:true,bodyUnchanged:true};
  },{expected:IDS.longgang,params:draft.calcParams,engineSha256,backup});
  const receipt={at:new Date().toISOString(),...adopted,paramsSha256:sha(adopted.params),oldSnapshotSha256:sha(adopted.oldSnapshot),newSnapshotSha256:sha(adopted.newSnapshot),engineSha256,backup,originalSource:source.sourceIdentity,originalSourceStateSha256:sha(source.state),newPaidAiCalls:0};
  const file=await artifact('longgang','current-engine-adoption-receipt',receipt);return {file,...receipt};
}
export async function diagnoseTaxBudget(harnesses){const result=await harnesses.tax.page.evaluate(()=>{const c=chapters[8],s=c.sections[2],plan=reportCompletionPlan(),contract=plan.sections.find(x=>x.sectionKey===c.name+' / '+s.t),stored=projectWorkflow.reportCompletion,preparation={context:reportFinancialContext(),sections:[{sectionKey:contract.sectionKey,requiredTables:contract.requiredTables}]},entries=reportCompletionEntries(null,preparation),entry=entries.find(e=>e.key===contract.sectionKey),allocated=ReportCompletionContract.allocateTableBudgets(plan,entries);return {at:new Date().toISOString(),sectionKey:contract.sectionKey,contract,planSection:contract,workflowBudgets:stored?.budgets,workflow:stored,section:s,programSource:{binding:preparation.binding,updatedCount:preparation.updatedCount,entry,metrics:ReportCompletionContract.measure(entry.text)},tableAllocation:plan.tableAllocation,allocatedAgain:{planId:allocated.planId,row:allocated.tableAllocation.sections.find(x=>x.sectionKey===contract.sectionKey),status:allocated.tableAllocation.status,issues:allocated.tableAllocation.issues}};});const file=await artifact('tax','9.3-budget-exact',result);return {file,at:result.at,planId:result.contract.planId,requirements:result.contract.requirements,programMetrics:result.programSource.metrics,allocationRow:result.tableAllocation.sections.find(x=>x.sectionKey===result.sectionKey),allocationStatus:result.tableAllocation.status,allocationIssues:result.tableAllocation.issues,allocatedAgain:result.allocatedAgain};}
export async function archiveFailureMatrix(harnesses,checkpoint){const projects=[];for(const [key,h]of Object.entries(harnesses)){const live=await h.page.evaluate(()=>({projectId:currentProjectId,sections:chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),title:s.t,bodyChars:(s.content||s.editedHtml||'').length,pending:s.pendingRevision,task:s.executionTask,failure:s.generationFailure,currentContract:reportSectionContract(c,s)})))}));const counts={},rows=[];for(const s of live.sections){const record=checkpoint.sections[key+':'+s.number];if(record?.status!=='failed')continue;const quality=s.pending?.quality||s.task?.quality||{};const issues=quality.issues||[];const errors=issues.filter(i=>i.severity==='error'),warnings=issues.filter(i=>i.severity!=='error');const codes=[...new Set(errors.map(i=>i.code))];if(!codes.length)codes.push(record.error?.code||s.failure?.code||'generation-failed');for(const code of codes)counts[code]=(counts[code]||0)+1;rows.push({number:s.number,title:s.title,taskId:s.task?.id,checkpointError:record.error,bodyChars:s.bodyChars,failure:s.failure,errors,warnings,pending:!!s.pending,currentContract:s.currentContract});}const file=await artifact(key,'failed-section-matrix',{at:new Date().toISOString(),projectId:live.projectId,counts,rows});projects.push({key,file,failedSections:rows.length,counts,representatives:Object.fromEntries(Object.keys(counts).map(code=>[code,rows.filter(r=>r.errors.some(i=>i.code===code)||!r.errors.length).slice(0,2).map(r=>({number:r.number,taskId:r.taskId,errors:r.errors,warnings:r.warnings,checkpointError:r.checkpointError}))]))});}return {at:new Date().toISOString(),projects};}
export async function archiveTaxAssumptionFailure(harnesses){const result=await harnesses.tax.page.evaluate(async()=>{const c=chapters[10],s=c.sections[0],id=s.executionTask?.id;if(!id)throw Error('11.1 task missing');const response=await fetch('/api/reportexecution?id='+encodeURIComponent(id),{headers:authHeaders()}),payload=await response.json();if(!response.ok)throw Error('11.1 receipt unavailable');return {projectId:currentProjectId,sectionNumber:'11.1',section:s,currentContract:reportSectionContract(c,s),task:payload.task};});const file=await artifact('tax','11.1-current-assumption-exact',result);return {file,taskId:result.task.id,quality:result.task.quality,currentAssumptions:result.currentContract.currentAssumptions};}
export async function hotloadFinance(harnesses){
  const source=await fs.readFile('report-financial-tables.js','utf8'),receipts=[];
  for(const [key,h]of Object.entries(harnesses)){
    const before=await h.page.evaluate(expected=>{if(currentProjectId!==expected)throw Error('Exact test project required');const {ts,...data}=buildDraftData();return JSON.stringify(data);},IDS[key]);
    await h.page.addScriptTag({content:source});
    const result=await h.page.evaluate(({expected,before})=>{const {ts,...data}=buildDraftData();if(currentProjectId!==expected||JSON.stringify(data)!==before)throw Error('Pure module reload changed data');const s=chapters[10]?.sections[0],candidate=s?.pendingRevision;return {projectId:currentProjectId,financeVersion:ReportFinancialTables.VERSION||ReportFinancialTables.version,sourceBinding:ReportFinancialTables.bindSource(reportFinancialContext()),assumptionIssues:candidate?ReportFinancialTables.inspectCurrentAssumptions(candidate.after,reportSectionContract(chapters[10],s).currentAssumptions):[]};},{expected:IDS[key],before});
    const file=await artifact(key,'finance5-pure-hotload',result);receipts.push({key,file,assumptionIssues:result.assumptionIssues});
  }
  return {newPaidAiCalls:0,receipts};
}
async function persistArtifact(key,number,result,checkpoint){
  const file=path.join(OUT,key,'sections',number+'.json');let previous=null;try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous)await artifact(key,'before-recovery-'+number,previous);
  await fs.writeFile(file,JSON.stringify({...previous,...result,number,at:new Date().toISOString()},null,2));
  checkpoint.sections[key+':'+number]={...checkpoint.sections[key+':'+number],status:result.status,at:new Date().toISOString(),file,taskId:result.executionTask?.id||result.error?.taskId||null,error:result.error||null};
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));return file;
}
export async function recoverSavedBodies(harnesses,checkpoint){
  const receipts=[];
  for(const [key,h]of Object.entries(harnesses)){
    const numbers=Object.entries(checkpoint.sections).filter(([id,row])=>id.startsWith(key+':')&&row.status==='failed'&&row.error?.code==='generation-save-failed'&&!(key==='tax'&&KNOWN_TAX_SEMANTIC.includes(id.split(':')[1]))).map(([id])=>id.split(':')[1]);
    for(const number of numbers){
      const result=await h.page.evaluate(async({expected,number})=>{
        if(currentProjectId!==expected)throw Error('Exact test project required');const [ci,si]=number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si];
        const before=JSON.stringify(s);let error=null,status='failed';
        if(s.pendingRevision||!reportHasVisibleBody(s))return {status,error:{code:'recovery-needs-candidate-review',message:'Not an unchanged generated body'},originalSection:s};
        try{reportCheckGeneratedDraft(c,s,s.editedHtml||s.content);status='passed';}catch(e){error={code:e.code||'recovery-inspection-failed',message:e.message,quality:e.quality||null};}
        const persisted=await persistReportDraft();if(!persisted.ok||!persisted.remote){status='failed';error={code:'generation-save-failed',message:'Retained body could not be saved',previous:error};}
        return {status,error,content:s.content||'',editedHtml:s.editedHtml||null,completionContract:s.completionContract,executionTask:s.executionTask,pendingRevision:s.pendingRevision||null,persisted,qaRecoveryDerived:{version:'same-body-current-production-reinspection-v1',newPaidAiCalls:0,sourceUnchangedBeforeInspection:JSON.stringify(s)===before,notNewAiReceipt:true}};
      },{expected:IDS[key],number});
      const file=await persistArtifact(key,number,result,checkpoint);receipts.push({key,number,status:result.status,file,error:result.error});
    }
  }
  return {newPaidAiCalls:0,receipts};
}
export async function retainKnownSemanticBlocks(harnesses,checkpoint){
  const affected=[];
  for(const number of KNOWN_TAX_SEMANTIC){const id='tax:'+number,row=checkpoint.sections[id];if(!row||row.status==='running'||row.status==='semantic-review-pending')continue;if(row.status==='passed'){row.status='failed';row.error={code:'real-content-review-blocked',message:'Independent source/semantic review identified unresolved content; technical checks do not certify this body'};affected.push(id);}}
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));return {affected,newPaidAiCalls:0};
}
export async function targetedSemanticBatch(harnesses,checkpoint){
  if(globalThis.__qaTargetedBatchRunning)throw Error('Only one paid targeted batch may run');
  globalThis.__qaTargetedBatchRunning=true;
  const rows=[
    {key:'tax',number:'11.2',instruction:'仅定点修订：1）碧波花园1套、愉天小区2套、梅兴苑1套合计应为4套、366.86平方米，不能写3套，依据M1房源基本情况表及M3对应房源行。2）2万元/套为翻新部分，不能与2500元/平方米全成本直接比较5倍；如需比较，按M2第10页同口径476.25元/平方米与2500元/平方米阐明范围差异，禁止将翻新单价等同总工程成本。3）现有末尾“工程风险与对策”业务标题必须保留并补有材料依据的工程风险优先序及责任措施，不留空标题。未涉及段落、数值、层级和表格完整保留。'},
    {key:'tax',number:'11.5',instruction:'仅定点修订：1）原文称5个点位同时受套数不足10套和户型偏大约束不准确，5点位均不足10套；愉天2套每套65.3平方米、合计130.6平方米，不应列为大户型约束。其他点位的户型风险按实际材料分别描述。10套要求仅为当时拟修订征求意见，不能写已生效。2）当前模型2027-07至2031-12为54个月，横跨五个日历年，不等于五整年运营；与12年合作期限分开。材料认定期限原则不少于6年，取证日期和实际有效期未核实，不能断言本期54个月模型必需续期；12年合作的到期续期风险另述为条件风险。其余结构、分析深度及表格不变。'},
    {key:'tax',number:'11.6',instruction:'仅修正材料身份混淆：M0合作协议草案第5.1条为乙方享有全部实际租金，第4.2条为临时用房上限；“租金覆盖改造成本、运营管理成本及合理利润后剩余收益按比例分配”仅出自M1请示第三（一）初步思路，且最终以协议为准，不是M0已约定。将本节三处把初步思路当协议约定的句子改成两个版本分别列示及待签约核准边界，不能假装已经一致，不改变当前财务模型。保持其余论证、业务分类和必要表格，缺口引用按契约每个精确一次。'},
    {key:'longgang',number:'8.2',instruction:'仅修正文中将总工程3900万元两次均分的错误推导，程序冻结资金表不改：当前已确认测算情景首次工程付款3000万元、当期借款2400万元、工程付款减借款600万元；后续工程900万元由情景自筹。不能写首次1950万元、贷款1560万元、资本金390万元；600仅工程资金差额，不冒充包含全部运营垫资和其他投资的全口径资本金。不得重新计算或修改表格。保留原协议5973平方米/195套/6年收益分成与当前20000平方米/500套/12年固定收楼25元情景之间的未决差异，不能混入原702万元或旧15.4%/25.79%。其余正文、结构和表格不变。'}
  ];
  const receipts=[];
  try{await Promise.all(rows.map(async row=>{
    const h=harnesses[row.key];if(h.target.id!==IDS[row.key])throw Error('Exact isolated target required');
    const previous=await h.page.evaluate(number=>{const [ci,si]=number.split('.').map(n=>Number(n)-1);return chapters[ci].sections[si];},row.number);
    const beforeFile=await artifact(row.key,'before-paid-targeted-'+row.number,previous);
    checkpoint.sections[row.key+':'+row.number]={...checkpoint.sections[row.key+':'+row.number],status:'running',startedAt:new Date().toISOString(),targetedInstruction:row.instruction,beforeArtifact:beforeFile};
    await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
    const result=await h.page.evaluate(async({expected,number,instruction,beforeFile})=>{
      if(currentProjectId!==expected||window.__qaDispatchPaused)throw Error('Exact enabled isolated target required');
      const [ci,si]=number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si],mutation=airCaptureReportMutation({chapter:c,section:s}),oldCandidate=s.pendingRevision,token=ProjectWorkflow.candidateToken(oldCandidate);
      const originalText=oldCandidate?.after||(s.editedHtml?blocksToSource(s.editedHtml):s.content||'');if(!originalText)throw Error('Targeted revision requires preserved complete original');
      let error=null,status='failed',newText=null;
      try{
        await airGuardReportMutation(mutation);
        if(oldCandidate){
          const sys='你是资深工程咨询报告编辑。本次仅修正用户精确指出的问题，输出完整替换候选。未涉及段落尽量原样保留；保留分析深度、所有业务层级与必要表格，不精简成摘要、不编造事实。不改变任何程序冻结表。'+ReportOutputPolicy.prompt+ReportOutputPolicy.sectionPrompt(chapters,c,s);
          const user='【本次定点修订要求】\n'+instruction+'\n【原完整候选，未涉及内容保留】\n'+originalText+'\n'+reportCurrentAssumptionsContext()+'\n'+buildCalcDigest()+'\n'+kbRetrieve(c.name,s.t);
          newText=await reportDurableSectionCall(c,s,sys,user,null,{candidateRegeneration:token,autoRepair:true});
        }else newText=await reviseSection(c,s,instruction,null,{autoRepair:true});
        await airGuardReportMutation(mutation);
        const meta={outputPolicyVersion:ReportOutputPolicy.contentVersion};
        const candidate=oldCandidate?ProjectWorkflow.replaceCandidate(s,newText,instruction,meta,token):ProjectWorkflow.setCandidate(s,newText,instruction,meta);
        if(!candidate)throw Error('Original candidate/body changed; result retained in task only');
        const quality=reportReviewCandidate(c,s);if(quality?.status==='blocked')throw Object.assign(Error('Current candidate remains blocked'),{code:'targeted-quality-blocked',quality});
        if(!ProjectWorkflow.acceptCandidate(s))throw Error('Production candidate acceptance refused');
        s.qaTargetedRevision={version:'actual-ai-targeted-review-v1',instruction,beforeArtifact:beforeFile,taskId:s.executionTask?.id,semanticReviewRequired:true,factsVerified:false};
        status='semantic-review-pending';
      }catch(e){
        error={code:e.code||'targeted-revision-failed',message:String(e.message||e),taskId:e.taskId||s.executionTask?.id,quality:e.quality||e.resultQuality||null,candidateText:e.candidateText||null,candidateContract:e.candidateContract||null};
        if(e.code==='REPORT_CANDIDATE_QUALITY_BLOCKED'&&e.candidateText&&oldCandidate){
          await airGuardReportMutation(mutation);const candidate=ProjectWorkflow.replaceCandidate(s,e.candidateText,instruction,{outputPolicyVersion:ReportOutputPolicy.contentVersion},token);
          if(candidate){if(e.candidateContract)candidate.completionContract=ProjectWorkflow.clone(e.candidateContract);if(e.resultQuality){candidate.serverQuality=ProjectWorkflow.clone(e.resultQuality);candidate.quality=ProjectWorkflow.clone(e.resultQuality);}candidate.repairError=e.message;}
        }
      }
      const persisted=await persistReportDraft();if(!persisted.ok||!persisted.remote){status='failed';error={code:'generation-save-failed',message:'Targeted candidate/body retained, remote save failed',previous:error};}
      let task=null;if(s.executionTask?.id){try{const response=await fetch('/api/reportexecution?id='+encodeURIComponent(s.executionTask.id),{headers:authHeaders()});task={httpStatus:response.status,...await response.json()};}catch(e){task={readError:e.message};}}
      return {status,content:s.content||'',editedHtml:s.editedHtml||null,completionContract:s.completionContract,executionTask:s.executionTask,pendingRevision:s.pendingRevision||null,error,task,persisted,qaTargetedRevision:s.qaTargetedRevision||null};
    },{...row,expected:IDS[row.key],beforeFile});
    const file=await persistArtifact(row.key,row.number,result,checkpoint);receipts.push({key:row.key,number:row.number,file,status:result.status,taskId:result.executionTask?.id,error:result.error&&{code:result.error.code,message:result.error.message}});
    console.log(JSON.stringify({event:'targeted-finish',...receipts.at(-1)}));
  }));}finally{globalThis.__qaTargetedBatchRunning=false;}
  return {at:new Date().toISOString(),receipts};
}
async function callController(method){return inspectorCall(`(async()=>{const vm=process.getBuiltinModule('vm'),specifier=process.getBuiltinModule('url').pathToFileURL(process.cwd()+'/scripts/report-runner-final-control.mjs').href+'?control='+Date.now();const M=await vm.runInThisContext('import('+JSON.stringify(specifier)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});globalThis.__qaFinalController=M;return M.${method}(__qaRecoveryHarnesses,__qaRecoveryCheckpoint);})()`);}
if(process.argv[2]==='--adopt-longgang')console.log(JSON.stringify(await callController('adoptCurrentLonggang')));
if(process.argv[2]==='--budget-tax')console.log(JSON.stringify(await callController('diagnoseTaxBudget')));
if(process.argv[2]==='--failure-matrix')console.log(JSON.stringify(await callController('archiveFailureMatrix')));
if(process.argv[2]==='--assumption-tax')console.log(JSON.stringify(await callController('archiveTaxAssumptionFailure')));
if(process.argv[2]==='--finance5')console.log(JSON.stringify(await callController('hotloadFinance')));
if(process.argv[2]==='--recover-saved')console.log(JSON.stringify(await callController('recoverSavedBodies')));
if(process.argv[2]==='--retain-semantic-blocks')console.log(JSON.stringify(await callController('retainKnownSemanticBlocks')));
if(process.argv[2]==='--targeted-semantic')console.log(JSON.stringify(await callController('targetedSemanticBatch')));
if(process.argv[2]==='--reload-contracts')console.log(JSON.stringify(await callController('pauseAndReloadCurrentContracts')));
if(process.argv[2]==='--inspect-free')console.log(JSON.stringify(await callController('inspectFreeProtocolBatch')));
if(process.argv[2]==='--current-matrix')console.log(JSON.stringify(await callController('currentLengthAndFailureMatrix')));
if(process.argv[2]==='--freeze-working')console.log(JSON.stringify(await callController('freezeWorkingSnapshot')));
if(process.argv[2]==='--hotload'){
  const expression=`(async()=>{const vm=process.getBuiltinModule('vm'),specifier=process.getBuiltinModule('url').pathToFileURL(process.cwd()+'/scripts/report-runner-final-control.mjs').href+'?final='+Date.now();const M=await vm.runInThisContext('import('+JSON.stringify(specifier)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});globalThis.__qaFinalController=M;return M.hotloadAndVerify(__qaRecoveryHarnesses,__qaRecoveryCheckpoint);})()`;
  console.log(JSON.stringify(await inspectorCall(expression)));
}
if(process.argv[2]==='--resume-tax'){
  console.log(JSON.stringify(await inspectorCall(`(async()=>{const h=__qaRecoveryHarnesses.tax;const state=await h.page.evaluate(expected=>{if(currentProjectId!==expected)throw Error('Exact isolated tax copy required');reportAssertCompletionPlan(reportCompletionPlan());window.__qaDispatchPaused=false;return {projectId:currentProjectId,paused:window.__qaDispatchPaused,at:new Date().toISOString()};},'${IDS.tax}');return state;})()`)));
}
if(process.argv[2]==='--resume-longgang')console.log(JSON.stringify(await inspectorCall(`(async()=>{const h=__qaRecoveryHarnesses.longgang;return h.page.evaluate(expected=>{if(currentProjectId!==expected)throw Error('Exact isolated Longgang required');const snap=projectWorkflow.calcSnapshots.find(x=>x.id===projectWorkflow.currentCalcSnapshotId);if(!snap?.qaEngineRebuild?.identicalParameters)throw Error('Authorized test rebuild required');ReportFinancialTables.bindSource(reportFinancialContext());reportAssertCompletionPlan(reportCompletionPlan());window.__qaDispatchPaused=false;return {projectId:currentProjectId,snapshotId:snap.id,paused:false,at:new Date().toISOString()};},'${IDS.longgang}');})()`)));
if(process.argv[2]==='--compact-status')console.log(JSON.stringify(await inspectorCall(`(async()=>({at:new Date().toISOString(),originalLoopFinished:!!globalThis.__qaOriginalLoopFinished,projects:await Promise.all(Object.entries(__qaRecoveryHarnesses).map(async([key,h])=>({key,checkpoint:Object.fromEntries(['passed','failed','running'].map(status=>[status,Object.entries(__qaRecoveryCheckpoint.sections).filter(([k,v])=>k.startsWith(key+':')&&v.status===status).length])),...await h.page.evaluate(()=>({paused:window.__qaDispatchPaused,bodies:chapters.flatMap(c=>c.sections).filter(s=>s.content||s.editedHtml).length,tasks:chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),id:s.executionTask?.id,status:s.executionTask?.status,errors:s.executionTask?.quality?.issues?.filter(x=>x.severity==='error').map(x=>x.code)}))).filter(x=>x.id)}))}))) }))()`)));
if(process.argv[2]==='--status'){
  console.log(JSON.stringify(await inspectorCall(`(async()=>({at:new Date().toISOString(),originalLoopFinished:!!globalThis.__qaOriginalLoopFinished,checkpoint:__qaRecoveryCheckpoint.sections,live:await Promise.all(Object.entries(__qaRecoveryHarnesses).map(async([key,h])=>({key,...await h.page.evaluate(()=>({projectId:currentProjectId,paused:window.__qaDispatchPaused,sections:chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),task:s.executionTask,status:s.qaRecoveryDerived?.technicalPassed,chars:(s.content||'').length}))) }))}))) }))()`)));
}
