import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedSha,validateRetainedSummary,saveRetainedTaxSummaries,initializeRetainedHarness} from '../scripts/report-tax-summary-retained-save.mjs';
const ID='f4395f64-af1b-43bd-b809-580b5ec9406b';
function fixture(){
  const text='{"blocks":[]}',payload={content:[{type:'text',text}],usage:{input_tokens:1,output_tokens:2},provider:'test',model:'test'},bytes=Buffer.from(JSON.stringify(payload));
  const candidate={number:'3.7',projectId:ID,sourceIdentity:'exact-source',notAccepted:true,semanticReviewRequired:true,oldTaskId:'old',oldRunId:'run',oldInputHash:'input',intentReceipt:{sha256:'intent-sha'},structuredText:text,structuredTextSha256:retainedSha(text),usage:payload.usage,provider:'test',model:'test'};
  return {candidate,raw:{httpStatus:200,ok:true,number:'3.7',intentReceipt:{sha256:'intent-sha'},bodyBase64:bytes.toString('base64'),bodySha256:retainedSha(bytes)},intent:{projectId:ID,number:'3.7',oldTask:{id:'old',runId:'run',inputHash:'input'}},context:{number:'3.7',projectId:ID,sourceIdentity:'exact-source',section:{content:'',executionTask:{id:'old',runId:'run'}}}};
}
test('import and no explicit mode perform no I/O, generation or writes',async()=>assert.deepEqual(await saveRetainedTaxSummaries(),{status:'not-executed',newPaidAiCalls:0,projectWrites:0}));
test('complete retained response binds source, original task/run/input and paid usage',()=>{const f=fixture();assert.equal(validateRetainedSummary(f.candidate,f.raw,f.intent,f.context),true);});
test('read-only bootstrap restores once and both modes await restore before current logic/templates',async()=>{
  for(const execute of [false,true]){
    const calls=[],h={page:{evaluate:async(fn,arg)=>{calls.push({kind:'evaluate',source:String(fn),arg});},waitForFunction:async(fn,options)=>{calls.push({kind:'wait',source:String(fn),options});}}};
    await initializeRetainedHarness(h,{execute});
    assert.match(calls[0].source,/__qaDispatchPaused=true/);
    const open=calls.filter(x=>x.source.includes('openAiReportProject'));assert.equal(open.length,execute?0:1);if(open.length)assert.equal(open[0].arg,ID);
    const wait=calls.findIndex(x=>x.kind==='wait'),ready=calls.findIndex(x=>x.source.includes('ReportLogicCore.load'));
    assert.ok(wait>0&&ready>wait);assert.match(calls[wait].source,/aiReportChatLoaded&&!aiReportRestoreLoading/);assert.match(calls[ready].source,/ensureReportTableTemplates/);
  }
});
test('changed target/source/task/input or existing body/pending are refused without mutation',()=>{
  for(const change of [f=>f.context.projectId='other',f=>f.context.number='1.7',f=>f.context.sourceIdentity='new',f=>f.context.section.executionTask.id='new',f=>f.context.section.executionTask.runId='new',f=>f.intent.oldTask.inputHash='new',f=>f.context.section.content='saved',f=>f.context.section.pendingRevision={after:'candidate'},f=>f.candidate.semanticReviewRequired=false]){
    const f=fixture();change(f);const before=structuredClone(f);assert.throws(()=>validateRetainedSummary(f.candidate,f.raw,f.intent,f.context));assert.deepEqual(f,before);
  }
});
test('uncertain/error/raw changes and usage/provider mismatch never become acceptable',()=>{
  for(const change of [f=>f.raw.ok=false,f=>f.raw.httpStatus=502,f=>f.raw.number='12.1',f=>f.raw.intentReceipt.sha256='other',f=>f.raw.bodySha256='other',f=>f.candidate.structuredText='other',f=>f.candidate.structuredTextSha256='other',f=>f.candidate.usage.output_tokens=3,f=>f.candidate.provider='other',f=>f.candidate.model='other']){
    const f=fixture();change(f);assert.throws(()=>validateRetainedSummary(f.candidate,f.raw,f.intent,f.context));
  }
});
