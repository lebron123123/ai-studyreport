// Recovery diagnostics for the exact, already-paid isolated acceptance run.
// This module never POSTs an AI task and never changes a task's immutable input.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Client}=require('../local-server/node_modules/pg');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const OUT=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner');
const IDS={tax:'f4395f64-af1b-43bd-b809-580b5ec9406b',longgang:'2884b7a3-960f-40c0-af89-5d19e0284836'};
function differences(before,after,prefix=''){
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)||Array.isArray(after))return [{path:prefix,before,after}];
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>differences(before[key],after[key],prefix?prefix+'.'+key:key));
}
export async function auditExistingSources(harnesses){
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000,query_timeout:30000});await client.connect();const report=[];
  try{
    await client.query('BEGIN READ ONLY');
    for(const [key,h]of Object.entries(harnesses)){
      if(IDS[key]!==h.target.id)throw Error('Exact isolated runner identity required');
      const state=await h.page.evaluate(()=>{
        if(!window.__qaDispatchPaused)throw Error('All new dispatch must remain paused');
        return {draft:buildDraftData(),rows:chapters.flatMap((c,ci)=>c.sections.flatMap((s,si)=>s.executionTask?.id?[{number:(ci+1)+'.'+(si+1),sectionKey:c.name+' / '+s.t,taskId:s.executionTask.id,hasBody:reportHasVisibleBody(s),pending:!!s.pendingRevision}]:[]))};
      });
      const rows=(await client.query('SELECT id,project_id,user_id,section_key,input_hash,rules_hash,input_json FROM report_section_tasks WHERE project_id=$1 AND id=ANY($2::text[])',[h.target.id,state.rows.map(x=>x.taskId)])).rows;
      if(rows.length!==state.rows.length)throw Error('An existing task does not belong to this exact isolated project');
      const source={project:hash(state.draft.project||{}),calculations:hash(state.draft.workflow?.calcSnapshots||state.draft.calcParams||{}),materials:hash(state.draft.kb||[])};
      const audited=[];
      for(const row of state.rows){
        const task=rows.find(x=>x.id===row.taskId),input=typeof task.input_json==='string'?JSON.parse(task.input_json):task.input_json;
        if(task.section_key!==row.sectionKey||input.sectionKey!==row.sectionKey)throw Error('Task section identity mismatch');
        const sourceMatches=Object.fromEntries(Object.keys(source).map(k=>[k,input.dependencies?.[k]===source[k]]));
        const currentContract=await h.page.evaluate(sectionKey=>reportCompletionPlan().sections.find(x=>x.sectionKey===sectionKey),row.sectionKey);
        const entry={...row,userId:task.user_id,originalSource:input.dependencies,currentSource:source,sourceMatches,contractDifferences:differences(input.qualityContract,currentContract)};
        const file=path.join(OUT,key,'recovery','original-task-'+row.number+'.json');await fs.mkdir(path.dirname(file),{recursive:true});
        const original={version:'immutable-existing-task-v1',taskId:task.id,projectId:task.project_id,sectionKey:task.section_key,inputHash:task.input_hash,rulesHash:task.rules_hash,input};
        try{await fs.writeFile(file,JSON.stringify(original,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const before=JSON.parse(await fs.readFile(file,'utf8'));if(hash(before)!==hash(original))throw Error('Immutable archived task changed');}
        entry.archive=file;audited.push(entry);
      }
      await fs.mkdir(path.join(OUT,key,'recovery'),{recursive:true});
      const file=path.join(OUT,key,'recovery','source-audit-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await fs.writeFile(file,JSON.stringify({at:new Date().toISOString(),projectId:h.target.id,sections:audited},null,2),{flag:'wx'});
      report.push({key,file,sections:audited.map(x=>({number:x.number,hasBody:x.hasBody,pending:x.pending,sourceMatches:x.sourceMatches,contractDifferencePaths:x.contractDifferences.map(d=>d.path)}))});
    }
    await client.query('ROLLBACK');return report;
  }finally{await client.end();}
}

// Explicit recovery of already-paid, successful non-financial tasks. This is
// an imported result with a fresh inspection, not a new AI generation receipt.
export async function recoverNonFinancial(harnesses,checkpoint){
  const h=harnesses.tax;if(h?.target?.id!==IDS.tax)throw Error('Exact tax test copy required');
  const report=[];
  for(const number of ['2.1','2.2','2.3','6.3']){
    const original=JSON.parse(await fs.readFile(path.join(OUT,'tax','recovery','original-task-'+number+'.json'),'utf8'));
    const result=await h.page.evaluate(async({number,original})=>{
      if(!window.__qaDispatchPaused||currentProjectId!==original.projectId||!projectCanEdit())throw Error('Paused isolated permission required');
      const [ci,si]=number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c?.sections[si];
      if(!s||c.name+' / '+s.t!==original.sectionKey||s.executionTask?.id!==original.taskId||s.locked||s.pendingRevision)throw Error('Original result identity/body/candidate changed');
      const response=await fetch('/api/reportexecution?id='+encodeURIComponent(original.taskId),{headers:authHeaders()}),data=await response.json(),task=data.task;
      if(!response.ok||task?.status!=='completed'||task.rulesChanged||!task.text||!task.quality||task.quality.status==='blocked'||task.quality.issues?.some(x=>x.severity==='error'))throw Error('Original backend result has not passed');
      if(reportHasVisibleBody(s)&&s.content!==task.text)throw Error('A different existing body cannot be overwritten');
      const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const draft=buildDraftData(),sources={project:await digest(draft.project||{}),calculations:await digest(draft.workflow?.calcSnapshots||draft.calcParams||{}),materials:await digest(draft.kb||[])};
      for(const [key,value]of Object.entries(sources))if(original.input.dependencies?.[key]!==value)throw Error('Original input source changed: '+key);
      const beforeInput=reportCandidateInputIdentity(),before=JSON.stringify(s),contract=reportSectionContract(c,s);
      if(ReportFinancialTables.hasFinancialTables(MD.renderHtml(task.text)))throw Error('Financial results require separate source-bound derivation');
      const quality=ReportCompletionContract.inspect(task.text,contract);
      if(quality.status==='blocked')throw Error('Current quality rejected old result: '+quality.issues.filter(x=>x.severity==='error').map(x=>x.code).join(','));
      const entries=reportCompletionEntries({sectionKey:original.sectionKey,html:renderContent(task.text)}),review=ReportCompletionContract.reviewDocument(entries,reportCompletionPlan()).reviews.find(x=>x.key===original.sectionKey);
      if(review?.issues?.some(x=>x.severity==='error'&&/^(?:bound-)?reference-/.test(x.code)))throw Error('Current cross-reference review rejected old result');
      if(beforeInput!==reportCandidateInputIdentity()||before!==JSON.stringify(s)||!projectCanEdit()||currentProjectId!==original.projectId)throw Error('Import identity changed during validation');
      reportCheckGeneratedDraft(c,s,task.text);
      s.content=task.text;s.editedHtml=null;s.generated=true;
      s.qaRecovery={version:'existing-paid-task-current-inspection-v1',at:new Date().toISOString(),taskId:original.taskId,originalInputHash:original.inputHash,originalContract:original.input.qualityContract,sourceMatches:sources,currentInputIdentity:beforeInput,currentContract:contract,quality,notNewAiReceipt:true};
      const persisted=await persistReportDraft();if(!persisted.ok||!persisted.remote)throw Error('Recovered body retained but remote persistence failed');
      return {number,sectionKey:original.sectionKey,chapterIndex:ci,sectionIndex:si,key:'tax',status:'passed',at:new Date().toISOString(),content:s.content,editedHtml:null,completionContract:s.completionContract,executionTask:s.executionTask,task:{httpStatus:response.status,...data},pendingRevision:null,generationFailure:null,error:null,persisted,qaRecovery:s.qaRecovery};
    },{number,original});
    const file=path.join(OUT,'tax','sections',number+'.json'),backup=file+'.before-recovery-'+Date.now()+'.json';
    try{await fs.copyFile(file,backup,fs.constants?.COPYFILE_EXCL||1);}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(file,JSON.stringify(result,null,2));checkpoint.sections['tax:'+number]={status:'passed',at:result.at,sectionKey:result.sectionKey,file,taskId:original.taskId,error:null,recoveredExistingTask:true};
    report.push({number,status:'passed',taskId:original.taskId,chars:result.content.length,notNewAiReceipt:true});
  }
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));return report;
}

export async function installAndMigrateBindings(harnesses){
  const source=await fs.readFile('report.js','utf8'),business=await fs.readFile('report-business-structure.js','utf8'),financial=await fs.readFile('report-financial-tables.js','utf8');
  const cut=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<a)throw Error('Current production function boundary missing');return source.slice(a,b);};
  const functions=cut('function reportCompletionEntries(','function reportSectionContract(')+'\n'+cut('async function reportDurableSectionCall(','async function callGen(');
  const M=await import('./report-full-generation-runner.mjs?basis-migration='+Date.now()),reports=[];
  for(const [key,h]of Object.entries(harnesses)){
    if(h.target.id!==IDS[key])throw Error('Exact isolated binding migration required');
    const before=await h.page.evaluate(()=>{if(!window.__qaDispatchPaused||chapters.some(c=>c.sections.some(s=>['queued','running','retrying'].includes(s.executionTask?.status))))throw Error('Quiescent paused generation required');return {draft:buildDraftData(),inputIdentity:reportCandidateInputIdentity(),projectId:currentProjectId};});
    if(before.projectId!==h.target.id)throw Error('Isolated page switched');
    const archive=path.join(OUT,key,'recovery','before-binding-migration-'+Date.now()+'.json');await fs.writeFile(archive,JSON.stringify(before,null,2),{flag:'wx'});
    await h.page.addScriptTag({content:business});await h.page.addScriptTag({content:financial});
    await h.page.evaluate(functions=>window.eval(functions),functions);
    const requests=await h.page.evaluate(async()=>{
      const rows=[];
      for(const contract of reportCompletionPlan().sections.filter(x=>x.requirements.basis)){
        const saved=projectWorkflow.reportCompletion?.basisCatalogs?.[contract.sectionKey];
        if(!saved)throw Error('A registered basis catalog is required');
        if(!/^\[系统测试\]现有材料原文定位/.test(saved.reason||''))throw Error('Manual basis registration cannot be changed automatically');
        rows.push({contract,catalog:await reportBasisCatalogFor(contract),saved,coverage:ReportArgument.basisCoverage(await reportBasisMaterialCatalog(contract.sectionKey)),materialIdentity:JSON.stringify(kbEntries)});
      }return rows;
    });
    const migrations=[];
    for(const request of requests){
      const classified=M.classifyBasisCatalog({...request,replaceGroups:true});
      const preparation=await h.page.evaluate(async({request,classified,version})=>{
        if(!window.__qaDispatchPaused||JSON.stringify(kbEntries)!==request.materialIdentity||JSON.stringify(projectWorkflow.reportCompletion.basisCatalogs[request.contract.sectionKey])!==JSON.stringify(request.saved))throw Error('Basis source changed during migration');
        const state=projectWorkflow.reportCompletion;
        state.history=[...(state.history||[]),{at:new Date().toISOString(),kind:'basis-classification-migration',sectionKey:request.contract.sectionKey,before:request.saved,notFactVerification:true}];
        state.basisCatalogs[request.contract.sectionKey]={...request.saved,items:classified.items,classificationVersion:version,classificationDiagnostics:classified.diagnostics,changedAt:new Date().toISOString(),reason:'[系统测试]现有材料原文定位；显式文件类型分类迁移，未核实效力'};
        const c=chapters.find(c=>c.sections.some(s=>c.name+' / '+s.t===request.contract.sectionKey)),s=c.sections.find(s=>c.name+' / '+s.t===request.contract.sectionKey);
        return {taskId:s.executionTask?.id||null,hasBody:reportHasVisibleBody(s),number:(chapters.indexOf(c)+1)+'.'+(c.sections.indexOf(s)+1),currentContract:reportSectionContract(c,s),inputIdentity:reportCandidateInputIdentity()};
      },{request,classified,version:M.BASIS_CLASSIFICATION_VERSION});
      if(preparation.hasBody){
        const original=JSON.parse(await fs.readFile(path.join(OUT,key,'recovery','original-task-'+preparation.number+'.json'),'utf8'));
        const payload=await h.page.evaluate(async({original,classified,currentContract})=>{
          const response=await fetch('/api/reportexecution?id='+encodeURIComponent(original.taskId),{headers:authHeaders()}),data=await response.json();
          if(!response.ok||data.task?.status!=='completed'||!data.task.rawText)throw Error('Original basis raw result unavailable');
          const nextContract=await ReportCompletionContract.bindBasisCatalog(currentContract,{sectionKey:currentContract.sectionKey,items:classified.items},original.input.qualityContract.basisCatalog.sourceSnapshotId);
          return {task:data.task,nextContract};
        },{original,classified,currentContract:preparation.currentContract});
        const raw=await M.remapBasisReferences({raw:payload.task.rawText,previousContract:original.input.qualityContract,nextContract:payload.nextContract});
        const derived=await h.page.evaluate(({raw,contract})=>{const decoded=ReportCompletionContract.decodeStructured(raw,contract),quality=ReportCompletionContract.inspect(decoded.text,contract);if(decoded.issues.some(i=>i.severity==='error')||quality.status==='blocked')throw Error('Derived basis classification did not pass current checks');return {raw,text:decoded.text,contract,quality};},{raw,contract:payload.nextContract});
        const file=path.join(OUT,key,'recovery','basis-derived-'+preparation.number+'-'+Date.now()+'.json');
        const artifact={version:'explicit-basis-classification-derivation-v1',notNewAiReceipt:true,originalTask:original,originalResult:payload.task,originalCatalog:request.saved,nextCatalog:classified,transformationVersion:M.BASIS_CLASSIFICATION_VERSION,oldRawHash:hash(payload.task.rawText),newRawHash:hash(raw),currentInputIdentity:preparation.inputIdentity,...derived};
        await fs.writeFile(file,JSON.stringify(artifact,null,2),{flag:'wx'});
        await h.page.evaluate(({number,derived,original,file,inputIdentity})=>{
          if(!window.__qaDispatchPaused||reportCandidateInputIdentity()!==inputIdentity||currentProjectId!==original.projectId)throw Error('Basis derivation source changed before admission');
          const [ci,si]=number.split('.').map(x=>Number(x)-1),s=chapters[ci].sections[si];
          if(s.executionTask?.id!==original.taskId||s.pendingRevision||s.locked)throw Error('Basis task/candidate changed');
          s.content=derived.text;s.editedHtml=null;s.completionContract=derived.contract;s.completionQuality=derived.quality;
          s.qaRecovery={version:'explicit-basis-classification-derivation-v1',originalTaskId:original.taskId,originalInputHash:original.inputHash,artifact:file,currentInputIdentity:inputIdentity,notNewAiReceipt:true};
        },{number:preparation.number,derived,original,file,inputIdentity:preparation.inputIdentity});
        migrations.push({number:preparation.number,bodyDerived:true,file,chars:derived.text.length});
      }else migrations.push({sectionKey:request.contract.sectionKey,catalogMigrated:true,bodyDerived:false});
    }
    const saved=await h.page.evaluate(()=>persistReportDraft());if(!saved.ok||!saved.remote)throw Error('Binding migration remote save failed; archived state retained');
    reports.push({key,archive,migrations,saved,paidAiCalls:0});
  }
  return reports;
}

// Rebind program-produced tables in an independent derivation. Original task
// inputs/raw and the accepted body remain intact; semantic findings are not
// repaired by silently substituting numbers in prose.
export async function inspectRecoveryBatch(harnesses,checkpoint){
  const h=harnesses.tax;if(h?.target?.id!==IDS.tax)throw Error('Exact tax test copy required');
  const clientSource=await fs.readFile('report-orchestration-client.js','utf8'),financialSource=await fs.readFile('report-financial-tables.js','utf8');
  for(const live of Object.values(harnesses)){
    if(live.target.id!==IDS[live.key])throw Error('Exact paused isolated project required');
    await live.page.evaluate(()=>{if(!window.__qaDispatchPaused||chapters.some(c=>c.sections.some(s=>['queued','running','retrying'].includes(s.executionTask?.status))))throw Error('Quiescent paused generation required');});
    await live.page.addScriptTag({content:clientSource});await live.page.addScriptTag({content:financialSource});
  }
  const findings={
    '4.1':{code:'pricing-scope-conflict',message:'分小区分别计租与当前统一45元/平方米/月测算的关系未说明',patterns:['分别','定价','租金']},
    '5.2':{code:'stale-first-year-occupancy',message:'首年70.4%为旧口径，须按当前测算确认，不自动替换',patterns:['70.4']},
    '6.1':{code:'empty-business-headings',message:'4个标题下缺少分析正文；保留原文待定点补写',patterns:[]},
    '8.1':{code:'investment-basis-ambiguity',message:'材料545.21万元与当前工程480万元口径不同，须分别说明，不把工程额当批准总投资',patterns:['545.21','480']},
    '9.1':{code:'monthly-occupancy-called-first-year',message:'15%为首月出租率，不能标为首年出租率',patterns:['15%','15％']},
    '9.2':{code:'monthly-occupancy-called-first-year',message:'15%为首月出租率，不能标为首年出租率',patterns:['15%','15％']},
    '9.3':{code:'monthly-occupancy-called-first-year',message:'15%为首月出租率，不能标为首年出租率',patterns:['15%','15％']},
    '4.2':{code:'current-assumptions-conflict',message:'42.44元/平方米/月、2027年6月入市与当前45元、2027年7月运营冲突；不可仅删限制放行',patterns:['42.44','2027年6','2027-06']}
  };
  const results=[];
  for(const number of ['3.1','8.1','8.2','9.2','9.3']){
    const original=JSON.parse(await fs.readFile(path.join(OUT,'tax','recovery','original-task-'+number+'.json'),'utf8'));
    const result=await h.page.evaluate(async({number,original,semantic})=>{
      if(!window.__qaDispatchPaused||currentProjectId!==original.projectId||!projectCanEdit())throw Error('Paused isolated permission required');
      const [ci,si]=number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si];
      if(c.name+' / '+s.t!==original.sectionKey||s.executionTask?.id!==original.taskId||s.locked)throw Error('Original task identity changed');
      const beforeSection=JSON.stringify(s),inputIdentity=reportCandidateInputIdentity();
      const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const draft=buildDraftData(),sources={project:await digest(draft.project||{}),calculations:await digest(draft.workflow?.calcSnapshots||draft.calcParams||{}),materials:await digest(draft.kb||[])};
      for(const [key,value]of Object.entries(sources))if(original.input.dependencies?.[key]!==value)throw Error('Original immutable source changed: '+key);
      const response=await fetch('/api/reportexecution?id='+encodeURIComponent(original.taskId),{headers:authHeaders()}),payload=await response.json(),task=payload.task;
      if(!response.ok||task?.status!=='completed'||task.rulesChanged||!task.rawText||!task.text)throw Error('Completed original raw result unavailable');
      let contract=reportSectionContract(c,s),text=task.text,financialBinding=null,preparedCount=0,entries;
      if(number!=='3.1'){
        const prep={context:reportFinancialContext(),sectionKey:original.sectionKey,requiredTables:contract.requiredTables};
        entries=reportCompletionEntries({sectionKey:original.sectionKey,html:renderContent(text)},prep);
        text=entries.find(x=>x.key===original.sectionKey).text;financialBinding=prep.binding||ReportFinancialTables.bindSource(prep.context);preparedCount=prep.updatedCount;
        contract=await ReportCompletionContract.bindDocumentReferences(contract,entries);
        if(/<table\b/i.test(text))contract=await ReportCompletionContract.bindFrozenTables(contract,text,'qa-recovery-derived:'+original.projectId+':'+number+':financial='+encodeURIComponent(JSON.stringify(reportFinancialIdentity())));
        contract=await ReportCompletionContract.bindProgramProse(contract,text);
      }else entries=reportCompletionEntries({sectionKey:original.sectionKey,html:renderContent(text)});
      const quality=ReportCompletionContract.inspect(text,contract),financialIssues=number==='3.1'?[]:reportFinancialCandidateIssues({after:text,completionContract:contract,completionFinancialSource:financialBinding,completionInputPlanId:inputIdentity});
      const review=ReportCompletionContract.reviewDocument(entries,{...reportCompletionPlan(),sections:reportCompletionPlan().sections.map(x=>x.sectionKey===original.sectionKey?contract:x)});
      const sectionReview=review.reviews.find(x=>x.key===original.sectionKey),referenceIssues=(sectionReview?.issues||[]).filter(x=>x.severity==='error'&&/^(?:bound-)?reference-/.test(x.code));
      if(inputIdentity!==reportCandidateInputIdentity()||beforeSection!==JSON.stringify(s)||currentProjectId!==original.projectId||!projectCanEdit())throw Error('Recovery input changed during current inspection');
      return {version:'qa-existing-raw-derived-current-inspection-v1',at:new Date().toISOString(),number,sectionKey:original.sectionKey,projectId:original.projectId,notNewAiReceipt:true,originalTask:original,originalResult:task,originalSection:JSON.parse(beforeSection),currentInputIdentity:inputIdentity,sourceMatches:sources,text,currentContract:contract,financialBinding,preparedCount,quality,financialIssues,referenceIssues,globalReviewIssues:review.issues,semanticFindings:semantic?[semantic]:[],technicalPassed:quality.status!=='blocked'&&!financialIssues.length&&!referenceIssues.length,professionallyPassed:false};
    },{number,original,semantic:findings[number]||null});
    const file=path.join(OUT,'tax','recovery','current-derived-'+number+'-'+Date.now()+'.json');await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
    results.push({number,file,technicalPassed:result.technicalPassed,chars:result.quality.metrics.proseCharacters,tableCount:result.quality.metrics.tableCount,preparedCount:result.preparedCount,errors:[...result.quality.issues,...result.financialIssues,...result.referenceIssues].filter(x=>x.severity==='error').map(x=>({code:x.code,message:x.message})),semanticFindings:result.semanticFindings});
  }
  const state=await h.page.evaluate(()=>({at:new Date().toISOString(),draft:buildDraftData(),chapters,plan:reportCompletionPlan(),inputIdentity:reportCandidateInputIdentity(),workflow:projectWorkflow,financialContext:reportFinancialContext()}));
  const matrix=Object.entries(findings).map(([number,issue])=>{
    const [ci,si]=number.split('.').map(x=>Number(x)-1),section=state.chapters[ci].sections[si],derived=results.find(x=>x.number===number);
    let content=String(section.editedHtml||section.content||section.pendingRevision?.after||'');
    const taskFile=derived?.file;
    return {key:'tax',number,sectionKey:state.chapters[ci].name+' / '+section.t,...issue,hasAcceptedBody:!!(section.content||section.editedHtml),taskId:section.executionTask?.id||null,sourceArtifact:taskFile||path.join(OUT,'tax','sections',number+'.json'),excerpts:issue.patterns.flatMap(pattern=>{const at=content.indexOf(pattern);return at<0?[]:[content.slice(Math.max(0,at-80),at+pattern.length+110)];}),status:'needs-targeted-revision',originalBodyUnchanged:true};
  });
  for(const issue of matrix){const id='tax:'+issue.number,previous=checkpoint.sections[id];checkpoint.sections[id]={...previous,status:'failed',at:state.at,semanticFinding:{code:issue.code,message:issue.message},error:{code:'real-content-review-blocked',message:issue.message,previous:previous?.error||null},bodyRetained:true};}
  state.errors=h.errors;state.ledger=h.ledger;state.checkpoint=checkpoint;
  await fs.writeFile(path.join(OUT,'tax','paused-live-state.json'),JSON.stringify(state,null,2));
  const matrixFile=path.join(OUT,'tax','recovery','content-findings-'+Date.now()+'.json');await fs.writeFile(matrixFile,JSON.stringify({at:state.at,projectId:IDS.tax,findings:matrix,derivations:results,newPaidAiCalls:0},null,2),{flag:'wx'});
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
  const persisted=await h.page.evaluate(()=>persistReportDraft());if(!persisted.ok||!persisted.remote)throw Error('Paused originals retained; remote save failed');
  return {matrixFile,results,findings:matrix.map(({number,code,hasAcceptedBody})=>({number,code,hasAcceptedBody})),bodyCount:state.chapters.flatMap(c=>c.sections).filter(s=>s.content||s.editedHtml).length,persisted,newPaidAiCalls:0};
}

export async function admitInspectedRecoveries(harnesses,checkpoint){
  const h=harnesses.tax;if(h?.target?.id!==IDS.tax)throw Error('Exact test copy required');
  const directory=path.join(OUT,'tax','recovery'),files=await fs.readdir(directory),out=[];
  for(const number of ['3.1','8.2']){
    const file=files.filter(x=>x.startsWith('current-derived-'+number+'-')).sort().at(-1);if(!file)throw Error('Current independent inspection artifact required');
    const full=path.join(directory,file),derived=JSON.parse(await fs.readFile(full,'utf8'));
    if(!derived.technicalPassed||derived.semanticFindings.length||derived.projectId!==IDS.tax||derived.notNewAiReceipt!==true)throw Error('Blocked/semantic derivation cannot be admitted');
    const result=await h.page.evaluate(async({derived,file})=>{
      if(!window.__qaDispatchPaused||currentProjectId!==derived.projectId||!projectCanEdit()||reportCandidateInputIdentity()!==derived.currentInputIdentity)throw Error('Current source/permission changed after derivation');
      const [ci,si]=derived.number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si];
      if(JSON.stringify(s)!==JSON.stringify(derived.originalSection)||s.locked||s.executionTask?.id!==derived.originalTask.taskId)throw Error('Body/candidate/task changed after independent inspection');
      const quality=ReportCompletionContract.inspect(derived.text,derived.currentContract),financialIssues=reportFinancialCandidateIssues({after:derived.text,completionContract:derived.currentContract,completionFinancialSource:derived.financialBinding,completionInputPlanId:derived.currentInputIdentity});
      const entries=reportCompletionEntries({sectionKey:derived.sectionKey,html:renderContent(derived.text)}),plan=reportCompletionPlan(),review=ReportCompletionContract.reviewDocument(entries,{...plan,sections:plan.sections.map(x=>x.sectionKey===derived.sectionKey?derived.currentContract:x)}),references=(review.reviews.find(x=>x.key===derived.sectionKey)?.issues||[]).filter(x=>x.severity==='error'&&/^(?:bound-)?reference-/.test(x.code));
      if(quality.status==='blocked'||financialIssues.length||references.length)throw Error('Fresh current inspection rejected archived derivation');
      if(derived.currentInputIdentity!==reportCandidateInputIdentity()||currentProjectId!==derived.projectId||!projectCanEdit()||JSON.stringify(s)!==JSON.stringify(derived.originalSection))throw Error('Admission source changed during fresh inspection');
      s.content=derived.text;s.editedHtml=null;s.generated=true;s.completionContract=derived.currentContract;s.completionQuality=quality;
      s.qaRecoveryDerived={version:derived.version,artifact:file,originalTaskId:derived.originalTask.taskId,originalInputHash:derived.originalTask.inputHash,currentInputIdentity:derived.currentInputIdentity,financialBinding:derived.financialBinding,notNewAiReceipt:true,technicalPassed:true,factsVerified:false};
      delete s.pendingRevision;delete s.generationFailure;
      const persisted=await persistReportDraft();if(!persisted.ok||!persisted.remote)throw Error('Derived body retained but remote persistence failed');
      return {key:'tax',number:derived.number,chapterIndex:ci,sectionIndex:si,sectionKey:derived.sectionKey,status:'passed',at:new Date().toISOString(),content:s.content,editedHtml:null,completionContract:s.completionContract,executionTask:s.executionTask,pendingRevision:null,error:null,persisted,task:{httpStatus:200,task:derived.originalResult},qaRecoveryDerived:s.qaRecoveryDerived,technicalPassed:true,factsVerified:false};
    },{derived,file:full});
    const sectionFile=path.join(OUT,'tax','sections',number+'.json');try{await fs.copyFile(sectionFile,sectionFile+'.before-current-admission-'+Date.now()+'.json',1);}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.writeFile(sectionFile,JSON.stringify(result,null,2));checkpoint.sections['tax:'+number]={status:'passed',at:result.at,sectionKey:result.sectionKey,file:sectionFile,taskId:derived.originalTask.taskId,error:null,recoveredExistingTask:true,derivedArtifact:full,factsVerified:false};
    out.push({number,status:'passed-current-technical-inspection',factsVerified:false,chars:result.content.length,artifact:full});
  }
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));return out;
}

// Read back the exact saved test copies without reloading the paused pages or
// issuing a generation request. Independent derivations remain separate from
// original model receipts, including in the on-disk section export artifact.
export async function archivePausedReadback(harnesses,checkpoint){
  const reports=[];
  for(const [key,h]of Object.entries(harnesses)){
    if(h.target.id!==IDS[key])throw Error('Exact isolated readback required');
    const state=await h.page.evaluate(async expected=>{
      if(!window.__qaDispatchPaused||currentProjectId!==expected||chapters.some(c=>c.sections.some(s=>['queued','running','retrying'].includes(s.executionTask?.status))))throw Error('Quiescent exact paused project required');
      const live=buildDraftData(),identity=reportCandidateInputIdentity(),before=JSON.stringify(chapters);
      const response=await fetch('/api/projects?id='+encodeURIComponent(expected),{headers:authHeaders()}),payload=await response.json();
      if(!response.ok||payload.project?.id!==expected||!payload.project.data)throw Error('Exact remote readback unavailable');
      if(currentProjectId!==expected||identity!==reportCandidateInputIdentity()||before!==JSON.stringify(chapters))throw Error('Readback raced with a live change');
      return {at:new Date().toISOString(),projectId:expected,live,remote:payload.project,inputIdentity:identity,chapters};
    },IDS[key]);
    const liveSections=state.chapters.flatMap((chapter,ci)=>chapter.sections.map((section,si)=>({number:(ci+1)+'.'+(si+1),sectionKey:chapter.name+' / '+section.t,section}))),remoteChapters=state.remote.data.chapters||[];
    const rows=liveSections.filter(x=>x.section.content||x.section.editedHtml).map(row=>{
      const [ci,si]=row.number.split('.').map(x=>Number(x)-1),saved=remoteChapters[ci]?.sections?.[si];
      return {number:row.number,sectionKey:row.sectionKey,contentSha256:hash(row.section.editedHtml||row.section.content),remoteContentSha256:saved?hash(saved.editedHtml||saved.content):null,bodyMatches:!!saved&&String(saved.editedHtml||saved.content||'')===String(row.section.editedHtml||row.section.content||''),taskMatches:!!saved&&saved.executionTask?.id===row.section.executionTask?.id,contractMatches:!!saved&&hash(saved.completionContract)===hash(row.section.completionContract),derivedEvidencePresent:!!(row.section.qaRecoveryDerived||row.section.qaRecovery),derivedEvidencePersisted:!!(saved?.qaRecoveryDerived||saved?.qaRecovery),checkpointStatus:checkpoint.sections[key+':'+row.number]?.status||null};
    });
    const file=path.join(OUT,key,'recovery','saved-body-readback-'+Date.now()+'.json');
    await fs.writeFile(file,JSON.stringify({version:'exact-paused-remote-readback-v1',at:state.at,projectId:IDS[key],remoteName:state.remote.name,remoteUpdatedAt:state.remote.updated_at,inputIdentity:state.inputIdentity,rows,paidAiCalls:0},null,2),{flag:'wx'});
    if(rows.some(x=>!x.bodyMatches||!x.taskMatches||!x.contractMatches))throw Error('Saved body/task/contract mismatch; readback evidence retained: '+file);
    if(key==='tax'){
      const basis=liveSections.find(x=>x.number==='1.1').section,basisFile=path.join(OUT,key,'sections','1.1.json'),artifact=JSON.parse(await fs.readFile(basisFile,'utf8'));
      if(String(artifact.content||'')!==String(basis.content||'')){
        if(!basis.qaRecovery?.artifact||basis.qaRecovery.notNewAiReceipt!==true)throw Error('Basis content change lacks independent derivation');
        const derivation=JSON.parse(await fs.readFile(basis.qaRecovery.artifact,'utf8'));
        if(derivation.notNewAiReceipt!==true||derivation.text!==basis.content||hash(derivation.contract)!==hash(basis.completionContract))throw Error('Basis independent artifact mismatch');
        await fs.copyFile(basisFile,basisFile+'.before-derived-artifact-sync-'+Date.now()+'.json',1);
        await fs.writeFile(basisFile,JSON.stringify({...artifact,content:basis.content,editedHtml:basis.editedHtml||null,completionContract:basis.completionContract,completionQuality:basis.completionQuality,qaRecovery:basis.qaRecovery,notNewAiReceipt:true,originalAiReceiptUnchanged:true},null,2));
      }
    }
    reports.push({key,file,bodies:rows.length,bodyTaskContractMatches:true,derivedEvidencePersisted:rows.filter(x=>x.derivedEvidencePresent&&x.derivedEvidencePersisted).length,derivedEvidenceMissing:rows.filter(x=>x.derivedEvidencePresent&&!x.derivedEvidencePersisted).map(x=>x.number),paidAiCalls:0});
  }
  return reports;
}

export async function refreshSemanticFindings(harnesses,checkpoint){
  const h=harnesses.tax;if(h.target.id!==IDS.tax)throw Error('Exact isolated semantic audit required');
  const directory=path.join(OUT,'tax','recovery'),files=await fs.readdir(directory),previousFile=files.filter(x=>x.startsWith('content-findings-')).sort().at(-1);
  if(!previousFile)throw Error('Existing content findings required');
  const previous=JSON.parse(await fs.readFile(path.join(directory,previousFile),'utf8'));
  const known=[...previous.findings.filter(x=>!['1.1','8.2'].includes(x.number)),
    {number:'1.1',code:'empty-jurisdiction-root-headings',message:'文件类型分类后末尾仍有市级、集团、国家空分类；保留原文待当前依据规则定点复验',patterns:['市级','集团','国家']},
    {number:'8.2',code:'stale-investment-and-operation-duration',message:'正文13892万元旧口径与当前工程480.0012万元及借款384.001万元不符；2027-07至2031-12为54个月，不能称五年完整运营期',patterns:['13892','五年','5年','2027','2031']}
  ];
  const live=await h.page.evaluate(async({projectId,known})=>{
    if(!window.__qaDispatchPaused||currentProjectId!==projectId)throw Error('Paused exact project required');
    const before=JSON.stringify(chapters),identity=reportCandidateInputIdentity(),rows=[];
    for(const finding of known){
      const [ci,si]=finding.number.split('.').map(x=>Number(x)-1),c=chapters[ci],s=c.sections[si];let text=String(s.editedHtml||s.content||s.pendingRevision?.after||''),textKind=text?'saved-body-or-pending':'original-completed-task';
      if(!text&&s.executionTask?.id){const response=await fetch('/api/reportexecution?id='+encodeURIComponent(s.executionTask.id),{headers:authHeaders()}),data=await response.json();if(!response.ok||data.task?.status!=='completed')throw Error('Original semantic evidence unavailable');text=String(data.task.text||'');}
      rows.push({...finding,key:'tax',sectionKey:c.name+' / '+s.t,taskId:s.executionTask?.id||null,hasAcceptedBody:!!(s.content||s.editedHtml),text,textKind});
    }
    if(before!==JSON.stringify(chapters)||identity!==reportCandidateInputIdentity()||currentProjectId!==projectId)throw Error('Semantic evidence changed during inspection');
    return {at:new Date().toISOString(),inputIdentity:identity,rows,bodyCount:chapters.flatMap(c=>c.sections).filter(s=>s.content||s.editedHtml).length};
  },{projectId:IDS.tax,known});
  const findings=live.rows.map(({text,...row})=>({...row,bodySha256:hash(text),excerpts:row.patterns.flatMap(pattern=>{const at=text.indexOf(pattern);return at<0?[]:[text.slice(Math.max(0,at-100),at+pattern.length+140)];}),status:'needs-targeted-revision',originalBodyUnchanged:true}));
  for(const finding of findings){const id='tax:'+finding.number,old=checkpoint.sections[id];checkpoint.sections[id]={...old,status:'failed',at:live.at,semanticFinding:{code:finding.code,message:finding.message},error:{code:'real-content-review-blocked',message:finding.message,previous:old?.error||null},bodyRetained:finding.hasAcceptedBody};}
  const file=path.join(directory,'content-findings-'+Date.now()+'.json');await fs.writeFile(file,JSON.stringify({...previous,version:'current-content-findings-v2',at:live.at,inputIdentity:live.inputIdentity,previousArtifact:path.join(directory,previousFile),findings,bodyCount:live.bodyCount,newPaidAiCalls:0},null,2),{flag:'wx'});
  await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
  return {file,bodies:live.bodyCount,findings:findings.map(x=>({number:x.number,code:x.code,hasAcceptedBody:x.hasAcceptedBody,evidenceExcerpts:x.excerpts.length})),newPaidAiCalls:0};
}
