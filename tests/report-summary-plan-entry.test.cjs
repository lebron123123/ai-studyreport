const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const entryStart=source.indexOf('async function generateSection('),entryEnd=source.indexOf('async function reportDurableSectionCall(');
assert.ok(entryStart>=0&&entryEnd>entryStart,'实际生成入口截取边界必须有效');
const entry=source.slice(entryStart,entryEnd);
for(const [name,plan,strict] of [
  ['已确认完整计划',{lengthPlan:{confirmedAt:'2026-10-08T12:00:00Z',lengthScope:'full-report'}},true],
  ['历史未确认计划',{lengthPlan:{lengthScope:'full-report'}},false],
  ['已确认局部目录',{lengthPlan:{confirmedAt:'2026-10-08T12:00:00Z',lengthScope:'partial-outline'}},false],
  ['历史无篇幅计划',{},false]
])test(name+'的实际生成入口传递正确总结门禁',async()=>{
  const c={name:'项目研究结论及建议',sections:[]},s={t:'研究结论',content:'原正文'};c.sections.push(s);
  const stop=new Error('SUMMARY_TEST_STOP');let calls=0,observed;
  const box=vm.createContext({chapters:[c],window:{ReportCompletionContract:{}},ensureReportTableTemplates:async()=>{},reportCompletionPlan:()=>plan,ReportArgument:{summaryContext(rows,chapter,section,options){calls++;observed={rows,chapter,section,options};throw stop;}}});
  box.window.ReportArgument=box.ReportArgument;vm.runInContext(entry,box);
  await assert.rejects(box.generateSection(c,s),error=>error===stop);
  assert.equal(calls,1);assert.equal(observed.options.completionPlan,plan);assert.equal(observed.options.requireCurrentContracts,strict);assert.equal(s.content,'原正文');
});
