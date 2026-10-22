import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {stripTax94KnownMetadata,browserCaptureTax94IdentityInputs} from '../scripts/report-tax94-paid-protocol-recovery.mjs';

test('import under legacy argv and default CLI cannot dispatch, write or adopt',()=>{
  const url=new URL('../scripts/report-tax94-paid-protocol-recovery.mjs',import.meta.url).href;
  const script=`import fs from 'node:fs'; import fsp from 'node:fs/promises'; globalThis.fetch=()=>{throw Error('network forbidden')}; for(const name of ['writeFile','appendFile','unlink','rename','mkdir'])fsp[name]=()=>{throw Error('write forbidden')}; for(const name of ['writeFileSync','appendFileSync','unlinkSync','renameSync','mkdirSync'])fs[name]=()=>{throw Error('write forbidden')}; process.argv=['node','other.mjs','--run']; await import(${JSON.stringify(url)}); console.log('inert');`;
  const imported=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout.trim(),'inert');
  const direct=spawnSync(process.execPath,[new URL('../scripts/report-tax94-paid-protocol-recovery.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8'});
  assert.equal(direct.status,0,direct.stderr);assert.equal(JSON.parse(direct.stdout).projectWrites,0);assert.equal(JSON.parse(direct.stdout).newPaidAiCalls,0);
});

test('only exact known top-level metadata is removed without changing nested bytes',()=>{
  const response={type:'json_object',replacements:[{id:'slot',text:'保留原文'}],additions:[],tables:[]},before=JSON.stringify(response),out=stripTax94KnownMetadata(response);
  assert.equal(JSON.stringify(response),before);assert.deepEqual(out.response,{replacements:response.replacements,additions:[],tables:[]});assert.deepEqual(out.normalizations,[{kind:'known-top-level-metadata-removal',pointer:'/type',value:'json_object'}]);
  for(const value of [null,[],{...response,type:'text'},{...response,type:{type:'json_object'}},{...response,unknown:true},{replacements:[],additions:[],tables:[]}])assert.throws(()=>stripTax94KnownMetadata(value));
});

test('browser capture refuses unloaded logic and always restores the real fingerprint hook on success/failure',()=>{
  const original=value=>JSON.stringify(value),ctx={currentProjectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',__qaDispatchPaused:true,projectCanEdit:()=>true,rlProjectType:()=> 'gaibao',ReportLogicCore:{current:()=>null},ReportCompletionContract:{fingerprint:original},projectWorkflow:{reportCompletion:{lengthPlan:{planId:'kept'}}}};
  ctx.window=ctx;vm.createContext(ctx);
  const run=()=>vm.runInContext('('+browserCaptureTax94IdentityInputs.toString()+')()',ctx);
  assert.throws(run,/Await the published v7 logic/);assert.equal(ctx.ReportCompletionContract.fingerprint,original);
  ctx.ReportLogicCore.current=()=>({version:7});ctx.reportCandidateInputIdentity=()=>{ctx.ReportCompletionContract.fingerprint({generationRules:{},directory:[],logic:{},undefinedMember:undefined});return 'test-identity';};
  const capture=run();assert.equal(capture.fields.undefinedMember,'undefined');assert.equal(ctx.ReportCompletionContract.fingerprint,original);
  ctx.reportCandidateInputIdentity=()=>{ctx.ReportCompletionContract.fingerprint({generationRules:{},directory:[],logic:{}});throw Error('capture failure');};
  assert.throws(run,/capture failure/);assert.equal(ctx.ReportCompletionContract.fingerprint,original);
});
