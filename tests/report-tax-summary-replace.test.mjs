import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReplacementArgs,runTaxSummaryReplacements,replacementRequest,dispatchReplacementOnce,validateAdditional37Evidence,replacementIntentName} from '../scripts/report-tax-summary-replace.mjs';

test('import/default execution is inert; explicit exact section authorization only',async()=>{
  assert.deepEqual(await runTaxSummaryReplacements(),{status:'not-executed',newPaidAiCalls:0,projectWrites:0});
  assert.deepEqual(parseReplacementArgs([]),{execute:false,sections:[]});
  assert.deepEqual(parseReplacementArgs(['--execute','--sections','3.7,12.1']).sections,['3.7','12.1']);
  for(const args of [['--execute'],['--execute','--sections','1.7'],['--execute','--sections','3.7,3.7']])assert.throws(()=>parseReplacementArgs(args));
});
test('request retains exact original system/query without prompt/idempotency mutation',()=>{
  const payload={projectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',system:'exact original system',query:'exact original query',maxTokens:4000};
  const request=replacementRequest(payload,payload.projectId);
  assert.equal(request.system,payload.system);assert.equal(request.messages[0].content,payload.query);assert.equal(request.max_tokens,4000);assert.equal(request.idempotencyKey,undefined);
  assert.throws(()=>replacementRequest({...payload,projectId:'other'},payload.projectId));
});
test('two-section execution rejects reverse order before I/O, with no extra 12.1 permission',async()=>{
  for(const extra of [[],['--additional-37-once']])assert.throws(()=>parseReplacementArgs(['--execute','--sections','12.1,3.7',...extra]),/3.7 before 12.1/);
  for(const additional37Once of [false,true])await assert.rejects(runTaxSummaryReplacements({execute:true,sections:['12.1','3.7'],additional37Once}),/3.7 before 12.1/);
  assert.deepEqual(parseReplacementArgs(['--execute','--sections','12.1']),{execute:true,sections:['12.1']});
  assert.throws(()=>parseReplacementArgs(['--execute','--sections','12.1','--additional-37-once']),/only to 3.7/);
});
function harness(){const files=new Map(),events=[];let calls=0;return {files,events,get calls(){return calls;},writeExclusive:async(file,value)=>{if(files.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});files.set(file,value);events.push(file);return {file,sha256:'retained'};},fetchImpl:async()=>{calls++;events.push('POST');return {ok:true,status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({content:[{type:'text',text:'{"blocks":[]}'}],usage:{output_tokens:20}}))};}};}
test('intent precedes exactly one POST, raw precedes decoded result, duplicate intent refuses POST',async()=>{
  const h=harness(),args={intentFile:'once.json',intent:{number:'3.7'},request:{system:'a'},token:'test',baseUrl:'http://localhost:8080',writeExclusive:h.writeExclusive,fetchImpl:h.fetchImpl};
  const result=await dispatchReplacementOnce(args);assert.equal(result.text,'{"blocks":[]}');assert.deepEqual(h.events,['once.json','POST','once.raw.json']);assert.equal(h.calls,1);
  await assert.rejects(dispatchReplacementOnce(args),/exists/);assert.equal(h.calls,1);
});
test('unknown response consumes permit forever, retaining stop evidence without automatic retry',async()=>{
  const h=harness();let calls=0;const args={intentFile:'once.json',intent:{number:'12.1'},request:{},token:'test',baseUrl:'http://localhost:8080',writeExclusive:h.writeExclusive,fetchImpl:async()=>{calls++;throw Error('outcome unknown');}};
  await assert.rejects(dispatchReplacementOnce(args),/outcome unknown/);assert.equal(calls,1);assert.equal(h.files.get('once.uncertain.json').repeatForbidden,true);
  await assert.rejects(dispatchReplacementOnce(args),/exists/);assert.equal(calls,1);
});
test('non-JSON or empty/error response is retained before rejection; never retried',async()=>{
  for(const body of ['not-json','{"content":[]}']){const h=harness();let calls=0;await assert.rejects(dispatchReplacementOnce({intentFile:'once.json',intent:{number:'3.7'},request:{},token:'test',baseUrl:'http://localhost:8080',writeExclusive:h.writeExclusive,fetchImpl:async()=>{calls++;return {ok:true,status:200,arrayBuffer:async()=>Buffer.from(body)};}}));assert.equal(calls,1);assert.ok(h.files.has('once.raw.json'));assert.ok(h.files.has('once.uncertain.json'));}
});
test('additional 3.7 authorization is explicit, exact and uses a separate immutable permit',()=>{
  assert.deepEqual(parseReplacementArgs(['--execute','--sections','3.7,12.1','--additional-37-once']),{execute:true,sections:['3.7','12.1'],additional37Once:true});
  assert.throws(()=>parseReplacementArgs(['--execute','--sections','12.1','--additional-37-once']),/only to 3.7/);
  assert.throws(()=>parseReplacementArgs(['--execute','--sections','3.7','--additional-37-once','--additional-37-once']));
  const old=replacementIntentName('3.7'),additional=replacementIntentName('3.7',{additional37Once:true});
  assert.notEqual(old,additional);assert.match(additional,/additional-37-once/);
  assert.throws(()=>replacementIntentName('12.1',{additional37Once:true}),/only to 3.7/);
  assert.throws(()=>replacementIntentName('1.7'));
});
test('additional authorization cannot accept absent, synthetic, changed or unknown first failure evidence',()=>{
  for(const bytes of [Buffer.from('{}'),Buffer.from('{"httpStatus":502,"bodyBase64":"Insufficient Balance"}'),Buffer.from('{"status":"outcome_unknown"}')]){
    assert.throws(()=>validateAdditional37Evidence({intentBytes:bytes,rawBytes:bytes,stopBytes:bytes}),/evidence changed/);
  }
});
test('new additional permit does not modify old failed permit and permits only one POST',async()=>{
  const h=harness(),old=replacementIntentName('3.7'),additional=replacementIntentName('3.7',{additional37Once:true});
  const oldEvidence={repeatForbidden:true,oldCharge:'unknown'};h.files.set(old,oldEvidence);
  const args={intentFile:additional,intent:{number:'3.7',separateAdditionalPermit:true},request:{system:'same'},token:'test',baseUrl:'http://localhost:8080',writeExclusive:h.writeExclusive,fetchImpl:h.fetchImpl};
  await dispatchReplacementOnce(args);assert.equal(h.calls,1);assert.deepEqual(h.files.get(old),oldEvidence);
  await assert.rejects(dispatchReplacementOnce(args),/exists/);assert.equal(h.calls,1);assert.deepEqual(h.files.get(old),oldEvidence);
});
test('balance or unknown result consumes the single additional permit; dispatch has no automatic retry',async()=>{
  for(const uncertain of [false,true]){
    const h=harness(),file=replacementIntentName('3.7',{additional37Once:true});let calls=0;
    const args={intentFile:file,intent:{number:'3.7'},request:{},token:'test',baseUrl:'http://localhost:8080',writeExclusive:h.writeExclusive,fetchImpl:async()=>{calls++;if(uncertain)throw Error('external outcome unknown');return {ok:false,status:502,arrayBuffer:async()=>Buffer.from('{"error":"Insufficient Balance"}')};}};
    await assert.rejects(dispatchReplacementOnce(args));assert.equal(calls,1);assert.ok(h.files.has(file.replace(/\.json$/,'.uncertain.json')));
    await assert.rejects(dispatchReplacementOnce(args),/exists/);assert.equal(calls,1);assert.equal(h.files.has(replacementIntentName('12.1')),false);
  }
});
