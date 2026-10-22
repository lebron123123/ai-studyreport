const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),B=require('../report-business-structure.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const production=source.slice(source.indexOf('function reportBusinessStructureBinding('),source.indexOf('async function reportBasisMaterialItems('));
function fixture(){
  const ctx={ReportCompletionContract:C,ReportBusinessStructure:B,calcParams:{},calcResult:null,project:{name:'[系统测试]表职责接线'},projectWorkflow:{reportVersions:[]},chapters:[{name:'财务评价',sections:[{t:'财务盈利分析',numeric:true,content:''}]}],rlProjectType:()=> 'gaibao',rlBusinessScenario:()=> 'housing',rlProjectText:()=>'',reportCompletionFacts:()=>[],sectionFormalTemplates:()=>[],reportGenerationRulesIdentity:()=>({version:'test'}),reportFinancialIdentity:()=>null};
  ctx.window=ctx;ctx.reportCompletionEntries=()=>ctx.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:s.editedHtml||s.content||''})));
  vm.createContext(ctx);vm.runInContext(production,ctx);return ctx;
}
const oldTable='<p><strong>职责与行动安排比较表</strong></p><table><tr><th>职责</th><th>核验行动</th></tr><tr><td>旧职责</td><td>旧行动</td></tr></table>';
test('生产计划合并业务旧表结构但保留财务默认职责，不复制旧数据',()=>{
  const ctx=fixture(),before=JSON.stringify(ctx.chapters);
  ctx.projectWorkflow.reportVersions=[{id:'accepted-v9',chapters:[{name:'财务评价',sections:[{t:'财务盈利分析',content:oldTable}]}]}];
  const plan=ctx.reportCompletionPlan(),contract=plan.sections[0];
  assert.deepEqual(contract.requiredTables.map(x=>x.title),['财务评价指标表','职责与行动安排比较表']);
  assert.deepEqual(contract.requiredTables[1].headers,['职责','核验行动']);
  assert.equal(JSON.stringify(ctx.chapters),before);assert.doesNotMatch(JSON.stringify(plan),/旧职责|旧行动/);
  assert.equal(plan.tableAllocation.status,'ready');assert.equal(plan.tableAllocation.sections[0].reserve.tableCount,2);
  assert.equal(ctx.reportCompletionPlan().planId,plan.planId);
  ctx.projectWorkflow.reportVersions[0].chapters[0].sections[0].content=oldTable.replaceAll('旧职责','变化事实').replaceAll('旧行动','变化行动');
  assert.equal(ctx.reportCompletionPlan().planId,plan.planId,'旧事实变化不应改变结构身份');
  ctx.projectWorkflow.reportVersions[0].chapters[0].sections[0].content=oldTable.replace('核验行动','后续行动');
  assert.notEqual(ctx.reportCompletionPlan().planId,plan.planId,'表头变化必须进入合同身份');
});
test('依据清单、空壳和旧财务表不会混入业务旧表职责',()=>{
  for(const [title,html] of [['编制依据',oldTable],['财务盈利分析','<p><strong>现金流量表</strong></p><table><tr><th>年度</th><th>净现金流</th></tr><tr><td>2027</td><td>100</td></tr></table>'],['财务盈利分析',oldTable.replace('旧职责','【待补：职责】').replace('旧行动','【待补：行动】')]]){
    const ctx=fixture();ctx.chapters[0].sections[0].t=title;ctx.projectWorkflow.reportVersions=[{chapters:[{name:'财务评价',sections:[{t:title,content:html}]}]}];
    const c=ctx.reportCompletionPlan().sections[0];assert.equal(c.requiredTables.some(x=>x.title==='职责与行动安排比较表'),false);
  }
});
