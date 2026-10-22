import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parseArgs,stableResumeJson,validateSourcePreconditions,validateRestorePrecondition,summarizeResumeCompletion,resumeActionExitCode} from '../scripts/report-resume-execute.mjs';

test('resume needs one explicit scope; ordinary mode cannot enable paid generation',()=>{
  assert.equal(parseArgs([]).mode,null);
  assert.equal(parseArgs(['--review','x.json','--normalize-reviewed-schema']).mode,'review');
  assert.throws(()=>parseArgs(['--review','x.json','--missing','tax:1.2']));
  assert.throws(()=>parseArgs(['--missing','tax']));
  assert.throws(()=>parseArgs(['--missing','tax:1.2,tax:1.2']));
  assert.throws(()=>parseArgs(['--revalidate','tax:7.2','--normalize-reviewed-schema']));
  assert.throws(()=>parseArgs(['--review','x.json','--base-url','http://example.com']));
});

test('source recovery binds actual body, preserved candidate and original task before any edit',()=>{
  const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
  const key='tax:3.2',projectId='f4395f64-af1b-43bd-b809-580b5ec9406b';
  const states={[key]:{projectId,taskId:null,actual:'',selected:'<p>未采用候选</p>'}};
  const proposal={sectionPreconditions:[{key,taskId:null,actualBodySha256:hash(''),candidateSha256:hash(states[key].selected)}],corrections:[{key,taskId:null,bodySha256:hash(states[key].selected)}]};
  assert.equal(validateSourcePreconditions(proposal,states),1);
  const changed=structuredClone(states);changed[key].selected+='<p>新段落</p>';
  assert.throws(()=>validateSourcePreconditions(proposal,changed),/candidate changed/);
  changed[key]=structuredClone(states[key]);changed[key].actual='<p>新正文</p>';
  assert.throws(()=>validateSourcePreconditions(proposal,changed),/actual body changed/);
  changed[key]=structuredClone(states[key]);changed[key].taskId='another-task';
  assert.throws(()=>validateSourcePreconditions(proposal,changed),/task changed/);
  assert.throws(()=>validateSourcePreconditions({...proposal,sectionPreconditions:[]},states),/every section/);
  const actualOnly={sectionPreconditions:[{key,taskId:null,actualBodySha256:hash('')}],corrections:[{key}]};
  assert.throws(()=>validateSourcePreconditions(actualOnly,states),/candidate changed/);
});

test('saved-state comparison tolerates JSONB key order, never content changes',()=>{
  const stringify=value=>JSON.stringify(stableResumeJson(value));
  const a=[{name:'章',sections:[{t:'节',content:'<p>完整正文</p>',n:0,flags:{a:true,b:null}}]}];
  const b=[{sections:[{flags:{b:null,a:true},n:0,content:'<p>完整正文</p>',t:'节'}],name:'章'}];
  assert.equal(stringify(a),stringify(b));
  const changed=structuredClone(b);changed[0].sections[0].content='<p>删过的正文</p>';
  assert.notEqual(stringify(a),stringify(changed));
  const missing=structuredClone(b);delete missing[0].sections[0].n;
  assert.notEqual(stringify(a),stringify(missing));
  assert.notEqual(stringify([1,2]),stringify([2,1]));
});

async function captureSavedState(remoteChapters,loadedChapters){
  const source=await fs.readFile(new URL('../scripts/report-resume-execute.mjs',import.meta.url),'utf8');
  const canonical=source.slice(source.indexOf('export function stableResumeJson('),source.indexOf('\nconst safeError=')).replace(/^export /gm,'');
  const fn=source.slice(source.indexOf('async function saveActualState('),source.indexOf('\n// The legacy module'));
  const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
  let captured;const reads=[];
  const context=vm.createContext({sha:hash,OUT:'no-files-written',path:{join:(...parts)=>parts.join('/')},draftOf:data=>data,validateProject:()=>true,exclusive:async(file,value)=>{captured=value;return {file,sha256:hash(value),bytes:0};}});
  const capture=vm.runInContext(canonical+'\n'+fn+'\nsaveActualState',context);
  const h={key:'tax',target:{id:'retained-project'},page:{evaluate:async()=>({projectId:'retained-project',chapters:structuredClone(loadedChapters),persistableChapters:structuredClone(loadedChapters),workflow:{},inputIdentity:'unchanged-input'})}};
  const isolation={sessions:{tax:{request:async url=>{reads.push(url);return {project:{data:{chapters:structuredClone(remoteChapters)}}};}}}};
  const result=await capture(h,isolation,{},'test-run','start');
  assert.deepEqual(reads,['/api/projects?id=retained-project']);
  return {result,captured,hash};
}

function savedStateFixture(){return [{cn:1,name:'章',checked:true,sections:[{t:'节',content:'<p>完整正文</p>',editedHtml:null,pendingRevision:{before:'旧正文',after:'未采用候选'},executionTask:{id:'原任务',graph:[{key:'context_snapshot',hash:'原上下文'}]},completionContract:{version:'原合同'},completionQuality:{passed:true},undoStack:['甲','乙']}]}];}

test('actual saved-state capture accepts only the two section failure fields missing versus null',async()=>{
  const remote=savedStateFixture(),loaded=structuredClone(remote);
  loaded[0].sections[0].generationFailure=null;
  loaded[0].sections[0].candidateGenerationFailure=null;
  const before={remote:JSON.stringify(remote),loaded:JSON.stringify(loaded)};
  const {result,captured,hash}=await captureSavedState(remote,loaded);
  assert.equal(result.remoteSaveVerified,true);
  assert.equal(captured.comparison,'full-state-canonical-keys-section-failure-null-v2');
  assert.equal(captured.remoteSavedChaptersSha256,hash(remote));
  assert.equal(captured.persistableChaptersSha256,hash(loaded));
  assert.notEqual(captured.remoteSavedChaptersSha256,captured.persistableChaptersSha256);
  assert.equal(captured.remoteComparableChaptersSha256,captured.persistableComparableChaptersSha256);
  assert.equal(JSON.stringify(remote),before.remote);
  assert.equal(JSON.stringify(loaded),before.loaded);
  assert.equal((await captureSavedState(loaded,remote)).result.remoteSaveVerified,true);
});

test('saved-state capture rejects non-null failure values and changed failure details',async()=>{
  for(const field of ['generationFailure','candidateGenerationFailure']){
    for(const value of [{},[],false,0,'',{code:'FAILED',message:'需重试',at:'2026-10-12'}]){
      const remote=savedStateFixture(),loaded=structuredClone(remote);loaded[0].sections[0][field]=value;
      assert.equal((await captureSavedState(remote,loaded)).result.remoteSaveVerified,false,field+': '+JSON.stringify(value));
    }
    const remote=savedStateFixture();remote[0].sections[0][field]={code:'FAILED',message:'原错误'};
    const loaded=structuredClone(remote);loaded[0].sections[0][field].message='另一个错误';
    assert.equal((await captureSavedState(remote,loaded)).result.remoteSaveVerified,false);
    assert.equal((await captureSavedState(remote,structuredClone(remote))).result.remoteSaveVerified,true);
  }
});

test('failure-null compatibility never masks body, candidate, task, contract, arrays or unrelated absent/null differences',async()=>{
  const mutations=[
    chapters=>{chapters[0].sections[0].content='<p>真实正文变化</p>';},
    chapters=>{chapters[0].sections[0].pendingRevision.after='另一个候选';},
    chapters=>{chapters[0].sections[0].executionTask.id='另一个任务';},
    chapters=>{chapters[0].sections[0].completionContract.version='另一个合同';},
    chapters=>{chapters[0].sections[0].undoStack.reverse();},
    chapters=>{delete chapters[0].sections[0].editedHtml;},
    chapters=>{chapters[0].sections[0].otherField=null;},
    chapters=>{chapters[0].generationFailure=null;},
    chapters=>{chapters[0].sections[0].pendingRevision.generationFailure=null;},
    chapters=>{chapters[0].sections[0].candidateGenerationError=null;}
  ];
  for(const mutate of mutations){
    const remote=savedStateFixture(),loaded=structuredClone(remote);
    loaded[0].sections[0].generationFailure=null;loaded[0].sections[0].candidateGenerationFailure=null;
    mutate(loaded);
    assert.equal((await captureSavedState(remote,loaded)).result.remoteSaveVerified,false,mutate.toString());
  }
});

test('lost receipt restoration is exact, candidate-preserving and never replaces an existing task',()=>{
  const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
  const state={projectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',actual:'<p>正式正文</p>',pendingRevision:{after:'旧候选'},executionTask:null};
  const row={key:'tax:3.3',projectId:state.projectId,actualBodySha256:hash(state.actual),pendingRevisionSha256:hash(state.pendingRevision),executionTaskSha256:hash(null),originalTaskId:'task-1',runId:'run-1',contextHash:'context-1',candidateEvidence:{},candidateSha256:hash('保留候选')};
  const task={id:'task-1',runId:'run-1',graph:[{key:'context_snapshot',hash:'context-1'}]};
  assert.equal(validateRestorePrecondition(row,state,task,'保留候选'),true);
  assert.throws(()=>validateRestorePrecondition(row,{...state,actual:'改过的正文'},task,'保留候选'),/changed/);
  assert.throws(()=>validateRestorePrecondition(row,state,task,'另一个候选'),/candidate evidence/);
  assert.throws(()=>validateRestorePrecondition(row,state,{...task,runId:'run-2'},'保留候选'),/task evidence/);
  const withTask={...state,executionTask:task},matching={...row,executionTaskSha256:hash(task)};
  assert.throws(()=>validateRestorePrecondition(matching,withTask,task,'保留候选'),/never replaces/);
  const absent={...state,pendingRevision:null},absentRow={...row,pendingRevisionSha256:hash(null),pendingRevisionPresent:false};
  assert.throws(()=>validateRestorePrecondition(absentRow,absent,task,'保留候选'),/explicit unaccepted/);
  assert.equal(validateRestorePrecondition({...absentRow,createNewPendingOnly:true},absent,task,'保留候选'),true);
  assert.throws(()=>validateRestorePrecondition({...row,createNewPendingOnly:true,pendingRevisionPresent:false},state,task,'保留候选'),/cannot replace/);
});

test('receipt restoration records each saved section without losing its project key',async()=>{
  const source=await fs.readFile(new URL('../scripts/report-resume-execute.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function restorePreservedReceipts('),source.indexOf('\nasync function legacyBoundedClear('));
  const rows=['tax:3.3','longgang:3.4'].map((key,i)=>({key,originalTaskId:'task-'+i,runId:'run-'+i,contextHash:'context-'+i,taskEvidence:{id:'task-'+i}}));
  const saved=[];
  const harnesses=Object.fromEntries(['tax','longgang'].map(key=>[key,{target:{id:key},page:{evaluate:async(fn,args)=>{
    if(!args.original)return {projectId:key,section:{content:'保留正文'},actual:'保留正文',executionTask:null,pendingRevision:null};
    saved.push({projectId:args.expected,number:args.number,original:args.original});
    return {taskId:args.task.id,bodyUnchanged:true,candidateRestored:false,persisted:{ok:true,remote:true}};
  }}}]));
  const isolation={sessions:Object.fromEntries(['tax','longgang'].map((key,i)=>[key,{request:async()=>({task:{id:'task-'+i,runId:'run-'+i,status:'completed',graph:[{key:'context_snapshot',hash:'context-'+i}]}})}]))};
  const context=vm.createContext({keyParts:key=>key.split(':'),readRestoreEvidence:async evidence=>({id:evidence.id,runId:'run-'+evidence.id.slice(-1),graph:[{key:'context_snapshot',hash:'context-'+evidence.id.slice(-1)}]}),validateRestorePrecondition:()=>true});
  const restore=vm.runInContext(fn+'\nrestorePreservedReceipts',context);
  const result=await restore(harnesses,isolation,{rows},'bound-proposal.json');
  assert.deepEqual(Array.from(result.receipts,r=>r.key),['tax','longgang']);
  assert.deepEqual(Array.from(result.receipts,r=>r.number),['3.3','3.4']);
  assert.equal(result.newPaidAiCalls,0);
  assert.equal(saved.length,2);
  assert.ok(saved.every(row=>row.original.content==='保留正文'));
});

test('completion confirms only one exact passed receipt for every requested section',()=>{
  const keys=['tax:1.2','longgang:3.4'],receipts=[{key:'longgang',number:'3.4',status:'passed'},{key:'tax',number:'1.2',status:'passed'}];
  const before=JSON.stringify({keys,receipts}),result=summarizeResumeCompletion(keys,receipts);
  assert.equal(result.status,'body-complete');
  assert.equal(result.contentComplete,true);
  assert.equal(result.completion.scope,'requested-sections');
  assert.equal(result.completion.complete,true);
  assert.equal(result.completion.passed,2);
  assert.equal(result.completion.remaining,0);
  assert.deepEqual(result.completion.outstanding,[]);
  assert.equal(resumeActionExitCode({ok:true,...result}),0);
  assert.equal(JSON.stringify({keys,receipts}),before);
});

test('blocked, failed, pending and metadata-only receipts never imply completed bodies',()=>{
  for(const status of ['quality-blocked','save-failed','failed','queued','semantic-review-pending','blocked','running','restored-metadata-only','already-applied','completed','unknown-status','PASSED','']){
    const result=summarizeResumeCompletion(['tax:1.2','tax:1.4'],[{key:'tax',number:'1.2',status:'passed'},{key:'tax',number:'1.4',status}]);
    assert.equal(result.status,'body-incomplete',status);
    assert.equal(result.completion.complete,false,status);
    assert.equal(result.completion.passed,1,status);
    assert.equal(result.completion.remaining,1,status);
    assert.equal(result.completion.outstanding[0].key,'tax:1.4');
    assert.equal(resumeActionExitCode({ok:true,...result}),2,status);
  }
});

test('missing, duplicate, foreign and malformed receipts fail closed without changing the receipts',()=>{
  const passed={key:'tax',number:'1.2',status:'passed'};
  for(const receipts of [[],[passed,passed],[passed,{key:'longgang',number:'1.2',status:'passed'}],[passed,null],[{key:'tax:1.2',status:'passed'}],[{key:'tax',number:1.2,status:'passed'}],null,{}]){
    const before=JSON.stringify(receipts),result=summarizeResumeCompletion(['tax:1.2'],receipts);
    assert.equal(result.completion.complete,false,JSON.stringify(receipts));
    assert.equal(result.status,'body-incomplete');
    assert.equal(resumeActionExitCode({ok:true,...result}),2);
    assert.equal(JSON.stringify(receipts),before);
  }
  assert.equal(summarizeResumeCompletion(['tax:1.2'],[]).completion.outstanding[0].status,'missing-receipt');
  assert.equal(summarizeResumeCompletion(['tax:1.2'],[passed,passed]).completion.outstanding[0].status,'duplicate-receipt');
});

test('controller failure overrides passed receipts and empty scope never claims body completion',()=>{
  const failed=summarizeResumeCompletion(['tax:1.2'],[{key:'tax',number:'1.2',status:'passed'}],false);
  assert.equal(failed.status,'execution-failed');
  assert.equal(failed.completion.complete,false);
  assert.equal(failed.completion.status,'unverified');
  assert.equal(resumeActionExitCode({ok:false,...failed}),1);
  const noAction=summarizeResumeCompletion([],[]);
  assert.equal(noAction.status,'no-action');
  assert.equal(noAction.completion.status,'not-requested');
  assert.equal(noAction.completion.complete,false);
  assert.equal(resumeActionExitCode({ok:true,...noAction}),0);
  assert.equal(resumeActionExitCode({ok:true}),2);
  assert.equal(resumeActionExitCode(undefined),1);
});

async function runControllerFixture(receipts,{endSaveVerified=true,helperError=null}={}){
  const source=await fs.readFile(new URL('../scripts/report-resume-execute.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('export async function runResumeAction('),source.indexOf('\nif(process.argv[1]')).replace(/^export /gm,'');
  const targets=Object.fromEntries(['tax','longgang'].map(key=>[key,{id:key+'-id',name:key+'-copy'}]));
  const snapshot={sources:Object.fromEntries(['tax','longgang'].map(key=>[key,{sourceIdentity:{sourceSha256:key+'-source'}}]))};
  const checkpoint={version:'production-full-generation-v1',sections:{},projects:targets,sourceHashes:{tax:'tax-source',longgang:'longgang-source'}};
  const events=[],saved=[],calls=[];let lock;
  const context=vm.createContext({
    ROOT:path.resolve('repo'),OUT:'out',SNAPSHOT:'snapshot',CHECKPOINT:'checkpoint',TARGETS:targets,MODES:['revalidate'],
    process:{cwd:()=> 'repo',pid:1},crypto,path,console:{log:()=>{}},parseArgs,keyParts:key=>key.split(':'),
    sha:value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex'),
    safeError:error=>String(error?.message||error),summarizeResumeCompletion,
    readScopedInput:async options=>({keys:options.keys}),loadSnapshots:async()=>snapshot,sourceChecks:async()=>({tax:true,longgang:true}),
    loadIsolation:async()=>({sessions:Object.fromEntries(['tax','longgang'].map(key=>[key,{target:targets[key],request:async()=>({project:{data:{chapters:[]}}})}]))}),
    validateProject:(key,project)=>project.data,sectionOf:()=>({section:{}}),
    fs:{readFile:async file=>file==='checkpoint'?JSON.stringify(checkpoint):JSON.stringify(lock),unlink:async()=>{}},
    exclusive:async(file,value)=>{if(file.endsWith('resume-execute.lock.json'))lock=value;if(file.includes('resume-action-'))saved.push(JSON.parse(JSON.stringify(value)));return {file,sha256:'retained-hash',bytes:1};},
    openProductionHarness:async(isolation,key)=>({key,target:targets[key],ledger:[],page:{evaluate:async()=>[],exposeFunction:async()=>{}},close:async()=>{calls.push('close:'+key);}}),
    pauseHarness:async()=>{},installPaidScope:async()=>{},
    saveActualState:async(h,isolation,snapshot,runId,phase)=>({file:phase,remoteSaveVerified:phase!=='end'||endSaveVerified}),
    repairFunctions:async()=>({revalidateRenderedCandidates:async()=>{calls.push('helper');if(helperError)throw helperError;return {file:'retained-helper-receipt',receipts,newPaidAiCalls:0};}}),
    emit:(stage,value)=>events.push({stage,...JSON.parse(JSON.stringify(value))})
  });
  const run=vm.runInContext(fn+'\nrunResumeAction',context);
  let result,error;try{result=await run({mode:'revalidate',value:'tax:1.2,tax:1.4'});}catch(caught){error=caught;}
  return {result,error,events,saved,calls};
}

test('real controller retains successful execution and raw receipts while reporting unfinished bodies',async()=>{
  const receipts=[{key:'tax',number:'1.2',status:'passed',file:'unchanged-a'},{key:'tax',number:'1.4',status:'semantic-review-pending',taskId:'original-task'}];
  const before=JSON.stringify(receipts),{result,error,events,saved,calls}=await runControllerFixture(receipts);
  assert.equal(error,undefined);
  assert.equal(result.ok,true);
  assert.equal(result.status,'body-incomplete');
  assert.equal(result.completion.complete,false);
  assert.equal(result.completion.passed,1);
  assert.equal(resumeActionExitCode(result),2);
  assert.deepEqual(saved[0].action.receipts,receipts);
  assert.equal(saved[0].status,'body-incomplete');
  assert.equal(saved[0].completion.complete,false);
  assert.equal(events.at(-1).stage,'finished');
  assert.equal(events.at(-1).ok,true);
  assert.equal(events.at(-1).status,'body-incomplete');
  assert.equal(events.at(-1).contentComplete,false);
  assert.deepEqual(calls,['helper','close:tax','close:longgang']);
  assert.equal(JSON.stringify(receipts),before);
});

test('real controller reports complete scope only after passed receipts and final remote-save verification',async()=>{
  const receipts=['1.2','1.4'].map(number=>({key:'tax',number,status:'passed'}));
  const complete=await runControllerFixture(receipts);
  assert.equal(complete.error,undefined);
  assert.equal(complete.result.status,'body-complete');
  assert.equal(complete.saved[0].completion.complete,true);
  assert.equal(resumeActionExitCode(complete.result),0);
  const unsaved=await runControllerFixture(receipts,{endSaveVerified:false});
  assert.match(unsaved.error.message,/not confirmed saved/);
  assert.equal(unsaved.saved[0].ok,false);
  assert.equal(unsaved.saved[0].status,'execution-failed');
  assert.equal(unsaved.saved[0].completion.complete,false);
  assert.equal(unsaved.events.at(-1).status,'execution-failed');
  const failed=await runControllerFixture(receipts,{helperError:new Error('retained helper failure')});
  assert.match(failed.error.message,/retained helper failure/);
  assert.equal(failed.saved[0].status,'execution-failed');
  assert.equal(failed.saved[0].completion.complete,false);
});

test('real CLI entry sets distinct exit codes for pending bodies, complete bodies and execution failure',async()=>{
  const source=await fs.readFile(new URL('../scripts/report-resume-execute.mjs',import.meta.url),'utf8');
  const cli=source.slice(source.indexOf('\nif(process.argv[1]'));
  for(const [status,complete,expected] of [['body-incomplete',false,2],['body-complete',true,0],['no-action',false,0],['execution-failed',false,1]]){
    const process={argv:['node',path.resolve('controller.mjs')]},errors=[];
    const context=vm.createContext({process,path,SELF:process.argv[1],parseArgs:()=>({}),resumeActionExitCode,safeError:error=>error.message,console:{error:value=>errors.push(JSON.parse(value))},runResumeAction:async()=>{if(status==='execution-failed')throw new Error('retained failure');return {ok:true,status,completion:{complete}};}});
    await vm.runInContext('(async()=>{'+cli+'\n})()',context);
    assert.equal(process.exitCode,expected,status);
    if(expected===1)assert.equal(errors[0].status,'execution-failed');
    else assert.deepEqual(errors,[]);
  }
});
