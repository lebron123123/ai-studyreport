import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../report-completion-contract.js';
import F from '../report-financial-tables.js';
import {reportCandidateOutput,reportCandidateQuality,reportSlotRepairPlan,reportRepairPromptContext,reportApplySlotPatch,reportQualityRepairState} from '../functions/api/reportexecution.js';

function fixture(blocks){
  const assumptions=F.buildCurrentAssumptions({params:{rent:45,operateStartMonth:'2027-07',occupancyMode:'monthly-phases',rampOcc:.15,rampRates:[.15,.3,.5,.7],stableOcc:.85},result:{__ctype:'gaibao',allYears:[2027],resiOccupancy:{2027:0.5583333333333333},monthDict:{2027:6},summary:{totalOperateMonths:54}}});
  const contract=C.normalize({...C.createPlan([{name:'市场分析',sections:[{t:'需求分析'}]}]).sections[0],requiredTables:[],currentAssumptions:assumptions,lengthPolicy:'advisory-v1'});
  blocks=blocks||[{kind:'paragraph',slot:'finding',text:'当前首年出租率15%。周边配套仅能支持条件判断，不能替代实际需求台账。'},{kind:'paragraph',slot:'conditions',text:'资料核验和申请台账仍须补齐，不能认定需求已经验证。'}];
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:contract,outputFormat:C.OUTPUT_FORMAT};
  return {contract,blocks,raw,snapshot,prior:{structuredText:raw,quality:reportCandidateQuality(snapshot,raw)}};
}

test('当前情景冲突仅授权唯一原段纠错，邻段、结构及事实门槛不变',()=>{
  const {contract,blocks,raw,snapshot,prior}=fixture(),before=JSON.stringify(prior),plan=reportSlotRepairPlan(prior,contract);
  assert.equal(prior.quality.status,'blocked');assert.ok(prior.quality.issues.some(i=>i.code==='current-assumption-conflict'));
  assert.equal(prior.quality.failure.protocolRepairEligible,false);assert.equal(reportQualityRepairState(snapshot,prior.quality).canRetry,true);
  assert.equal(plan.purpose,'current-assumption-conflict');assert.equal(plan.version,'paragraph-patch-v2');assert.deepEqual(plan.targets.map(t=>t.blockIndex),[0]);
  const text='当前首年运营月平均出租率55.83%。周边配套仅能支持条件判断，不能替代实际需求台账。',patch=JSON.stringify({replacements:[{blockIndex:0,slot:'finding',text}]}),bound={...snapshot,qualitySlotPatch:plan};
  const output=reportCandidateOutput(bound,patch),quality=reportCandidateQuality(bound,patch),actual=JSON.parse(output.structuredText).blocks;
  assert.deepEqual(actual,[{...blocks[0],text},blocks[1]]);assert.deepEqual(output.issues,[]);assert.notEqual(quality.status,'blocked');assert.equal(quality.factsVerified,false);
  assert.equal(JSON.stringify(prior),before);assert.equal(raw,JSON.stringify({blocks}));
  const prompt=reportRepairPromptContext({user:'当前实收租金情景，旧材料不得替代当前输入。'},prior,contract);
  assert.equal(prompt.slotPatch.purpose,plan.purpose);assert.match(prompt.instruction,/不压缩、不总结、不重写整节/);assert.match(prompt.instruction,/只纠正明确列出的错误断言/);assert.ok(prompt.user.includes(JSON.stringify(contract.currentAssumptions)));
});

test('错误情景未修复继续阻断，越界、漏项、歧义及数值表不得借此通道改写',()=>{
  const f=fixture(),plan=reportSlotRepairPlan(f.prior,f.contract),unchanged=JSON.stringify({replacements:[{blockIndex:0,slot:'finding',text:f.blocks[0].text}]});
  assert.equal(reportCandidateQuality({...f.snapshot,qualitySlotPatch:plan},unchanged).status,'blocked');
  for(const replacements of [[],[{blockIndex:1,slot:'conditions',text:'不授权改写。'}],[{blockIndex:0,slot:'conditions',text:'不匹配。'}],[{blockIndex:0,slot:'finding',text:'合法形状。',extra:true}]]){
    const output=reportApplySlotPatch(JSON.stringify({replacements}),plan);assert.equal(output.structuredText,plan.base);assert.equal(output.issues[0].code,'structured-slot-patch');
  }
  const ambiguous=fixture([f.blocks[0],{...f.blocks[0],slot:'conditions'}]);assert.equal(reportSlotRepairPlan(ambiguous.prior,ambiguous.contract),null);
  const table=fixture([{kind:'table',title:'情景参数表',headers:['参数','当前采用值'],rows:[['首年出租率','15%']]}]);assert.equal(reportSlotRepairPlan(table.prior,table.contract),null);
  const mixed={...f.prior,quality:{...f.prior.quality,issues:[...f.prior.quality.issues,{code:'missing-fact',severity:'error',repairable:true}]}};assert.equal(reportSlotRepairPlan(mixed,f.contract),null);
  assert.equal(reportSlotRepairPlan({...f.prior,quality:{issues:[]}},f.contract),null);
  assert.equal(reportQualityRepairState({...f.snapshot,qualityRepair:{round:2}},f.prior.quality).canRetry,false);
});
