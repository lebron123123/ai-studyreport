import test from 'node:test';
import assert from 'node:assert/strict';
import {investmentDeviation,constructionDelay,effectiveDeadline,calendarDate} from '../functions/api/_investment-rule-engine.mjs';
const rule={id:'r1',version:1,status:'published',basis:'制度条款待真实接入',applicable:true,operator:'gt',thresholdBps:2000,years:2,calendar:'gregorian-clamp-feb28'};
const baseline={id:'b1',version:1,kind:'original',currentValid:true,amount:'1000000.00',currency:'CNY',amountBasis:'含税',scope:'项目整体'};
test('金额使用精确整数比较：恰好20%不触发，多一分触发，保留原批准依据',()=>{
  const run=amount=>investmentDeviation({rule,baseline,forecast:{...baseline,amount}});
  assert.equal(run('1200000.00').status,'clear');
  const result=run('1200000.01');assert.equal(result.status,'triggered');assert.equal(result.classification,'forecast');assert.equal(result.violation,false);assert.equal(result.baselineId,'b1');
  assert.equal(run('900000.00').status,'clear');
  assert.equal(investmentDeviation({rule:{...rule,operator:'gte'},baseline,forecast:{...baseline,amount:'1200000'}}).status,'triggered');
});
test('缺失、失效、零基线和口径冲突均未知，未发布规则不得给绿色',()=>{
  for(const patch of [{currentValid:false},{amount:'0'},{kind:'adjustment'},{amount:100}])assert.equal(investmentDeviation({rule,baseline:{...baseline,...patch},forecast:baseline}).status,'unknown');
  for(const key of ['currency','amountBasis','scope'])assert.equal(investmentDeviation({rule,baseline,forecast:{...baseline,[key]:'不同'}}).status,'unknown');
  assert.equal(investmentDeviation({rule:{...rule,status:'draft'},baseline,forecast:baseline}).status,'unknown');
});
test('日期按日历两年，闰日阈值当天与次日不同，普通逾期独立显示',()=>{
  const run=asOf=>constructionDelay({rule,plannedStart:'2024-02-29',asOf});
  assert.equal(run('2026-02-28').status,'overdue');
  assert.equal(run('2026-03-01').status,'triggered');
  assert.equal(run('2024-03-01').status,'overdue');
  assert.equal(run('2024-02-29').status,'clear');
  assert.equal(run('2024-02-30').status,'unknown');
  assert.throws(()=>calendarDate('2024-13-01'));
});
const context={eventId:'meeting-1',round:1,originalDue:'2026-09-10',asOf:'2026-09-09'};
const approval={id:'pause-1',kind:'pause',eventId:'meeting-1',round:1,currentValid:true,approvalId:'decision-1',sourceHash:'hash',start:'2026-09-01',end:'2026-09-03'};
test('批准暂停合并重叠日期不重复计时，原期限与依据保留',()=>{
  const result=effectiveDeadline({...context,changes:[approval,{...approval,id:'pause-2',start:'2026-09-02',end:'2026-09-04'}]});
  assert.equal(result.pausedDays,3);assert.equal(result.effectiveDue,'2026-09-13');assert.equal(result.originalDue,'2026-09-10');
  assert.equal(effectiveDeadline({...context,changes:[]}).effectiveDue,'2026-09-10');
});
test('未批准、跨事项、跨轮次、重复事件、无来源和叠加口径不明不能延缓预警',()=>{
  for(const patch of [{currentValid:false},{eventId:'other'},{round:2},{sourceHash:''},{approvalId:''}])assert.equal(effectiveDeadline({...context,changes:[{...approval,...patch}]}).status,'unknown');
  assert.equal(effectiveDeadline({...context,changes:[approval,approval]}).status,'unknown');
  const extension={...approval,id:'extension',kind:'extension',newDue:'2026-09-20'};
  assert.equal(effectiveDeadline({...context,changes:[extension]}).effectiveDue,'2026-09-20');
  assert.equal(effectiveDeadline({...context,changes:[extension,approval]}).status,'unknown');
});
test('延期冲突不依赖输入次序，暂停不能越过起点，未来实际开工不计入',()=>{
 const a={...approval,id:'a',kind:'extension',newDue:'2026-09-20'},b={...a,id:'b',newDue:'2026-09-21'};
 for(const changes of [[a,b],[b,a]])assert.equal(effectiveDeadline({...context,changes}).status,'unknown');
 assert.equal(effectiveDeadline({...context,clockStart:'2026-09-02',changes:[approval]}).status,'unknown');
 assert.equal(effectiveDeadline({...context,changes:[a,approval],stacking:'extension-plus-pauses'}).effectiveDue,'2026-09-22');
 assert.equal(constructionDelay({rule,plannedStart:'2024-01-01',actualStart:'2026-10-01',asOf:'2026-09-09'}).status,'unknown');
});
