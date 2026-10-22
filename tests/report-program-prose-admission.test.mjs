import test from 'node:test';
import assert from 'node:assert/strict';
import {reportCandidateOutput,reportCandidateQuality,reportSlotRepairPlan,reportRepairPromptContext} from '../functions/api/reportexecution.js';
const C=globalThis.ReportCompletionContract;

test('后端真实解码/质量/定点修复均消费已扣程序标题与旁注的同一槽预算',async()=>{
  const base={version:C.VERSION,planId:'[系统测试]program-plan',sectionKey:'结论 / 建议',requirements:{proseTarget:700,proseMax:910},requiredFacts:[],requiredTables:[]};
  const canonical='<figure><h4>'+('题'.repeat(150))+'</h4></figure>',qa='<p>'+('注'.repeat(37))+'</p>';
  const contract=await C.bindProgramProse(base,canonical,qa),budget=C.programProseBudget(contract),slots=C.outputSlots(contract);
  assert.equal(budget.reservedCharacters,187);assert.equal(slots.reduce((n,s)=>n+s.hardMax,0),723);
  const blocks=slots.map(s=>({kind:'paragraph',slot:s.slot,text:'文'.repeat(s.hardMax)}));
  const snapshot={qualityContract:contract,outputFormat:C.OUTPUT_FORMAT},raw=JSON.stringify({blocks});
  const good=reportCandidateOutput(snapshot,raw),quality=reportCandidateQuality(snapshot,raw);
  assert.notEqual(quality.status,'blocked');assert.equal(C.measure(good.text+canonical+qa).proseCharacters,910);
  blocks[1].text+='字';const tooLong=JSON.stringify({blocks}),blocked=reportCandidateQuality(snapshot,tooLong);
  assert.equal(blocked.status,'blocked');assert.ok(blocked.issues.some(i=>i.code==='structured-slot-budget'));
  assert.ok(C.measure(reportCandidateOutput(snapshot,tooLong).text).proseCharacters<910);
  const prior={rawText:tooLong,structuredText:tooLong,quality:blocked},plan=reportSlotRepairPlan(prior,contract);
  assert.deepEqual(plan.targets.map(x=>[x.slot,x.hardMax]),[['evidence',slots[1].hardMax]]);
  const context=reportRepairPromptContext({system:'已有规则',user:'已有材料'},prior,contract);
  assert.equal(context.slotPatch.targets[0].hardMax,slots[1].hardMax);
  assert.equal(context.slotPatch.targets[0].target,slots[1].target);
  assert.ok(context.user.includes('"target":'+slots[1].target));
  assert.ok(!context.user.includes('"target":'+Math.floor(slots[1].target*0.6)));
});
