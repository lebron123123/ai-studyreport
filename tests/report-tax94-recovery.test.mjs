import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {TAX94_RECOVERY as p,browserPrepareTax94Analysis} from '../scripts/report-tax94-recovery.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
test('browser preparation matches production type marker without relaxing financial source checks',async()=>{
  for(const changedAmount of [false,true]){
    const oldCandidate='retained candidate',source=JSON.stringify({amount:123,__ctype:'gaibao',sens:['s'],modeCompare:['m']}),policy={...p,candidateSha256:sha(oldCandidate),financialSourceSha256:sha(source)};
    const section={content:'',pendingRevision:{after:oldCandidate,completionFinancialSource:{sourceSignature:source}}},chapters=Array.from({length:9},()=>({sections:[]}));chapters[8].sections[3]=section;
    const params={amount:123},original=JSON.stringify({section,params}),cells=[p.headers,...p.rows],table={outerHTML:'<table>program</table>',rows:cells.map(row=>({cells:row.map(textContent=>({textContent}))}))};
    let boundResult;
    const sandbox={crypto:crypto.webcrypto,TextEncoder,currentProjectId:p.projectId,window:{__qaDispatchPaused:true},projectCanEdit:()=>true,chapters,calcParams:params,reportCandidateInputIdentity:()=> 'stable-input',
      runCalcEngine:(type,input)=>{assert.equal(type,'gaibao');assert.notEqual(input,params);return {amount:changedAmount?124:input.amount};},computeSensitivity:()=>['s'],computeModeCompare:()=>['m'],reportFinancialContext:()=>({}),
      ReportFinancialTables:{bindSource:({result})=>{boundResult=result;return {snapshotId:p.snapshotId,snapshotVersion:p.snapshotVersion,sourceSignature:JSON.stringify(result)};},prepare:()=>({updatedCount:1,entries:[{html:table.outerHTML}]})},
      document:{createElement:()=>({innerHTML:'',querySelector:()=>table,querySelectorAll:()=>[table]})}};
    const run=vm.runInNewContext('('+browserPrepareTax94Analysis.toString()+')',sandbox);
    if(changedAmount)await assert.rejects(run(policy),/Current adopted financial source changed/);
    else assert.equal((await run(policy)).notWritten,true);
    assert.equal(boundResult.__ctype,'gaibao');assert.equal(JSON.stringify({section,params}),original);
  }
});
