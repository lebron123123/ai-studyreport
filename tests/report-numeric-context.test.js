const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(summary={totalNpv:100,totalIncome:200}){
  const ctx={window:{ReportEvidenceGraph:require('../report-evidence-graph.js'),ReportNumericAudit:require('../report-numeric-audit.js')},projectWorkflow:{currentCalcSnapshotId:'calc1',calcSnapshots:[{id:'calc1',version:2,calcType:'rent',params:{a:1},summary}]},calcParams:{a:1},calcResult:{summary},chapters:[]};
  Object.assign(ctx,ctx.window);vm.createContext(ctx);vm.runInContext(fs.readFileSync('review.js','utf8'),ctx);return ctx;
}
const sections=text=>[{cn:1,name:'财务',checked:true,sections:[{t:'核对',content:text}]}];
test('复核入口扫描全文的累计指标并标注快照，不把年收入混入总额',()=>{
  const c=context();const a=c.currentReportNumericAudit(sections('累计净现值100万元。年度收入50万元。总收入200万元。'));
  assert.equal(a.checked.length,2);assert.equal(a.declaredNumbersPassed,true);assert.equal(a.checked[0].sourceRef,'calc1');assert.equal(a.checked[0].version,2);assert.equal(a.semanticAccuracyVerified,false);
});
test('摘要与正文累计数值冲突经实际复核入口成为阻断',()=>{
  const c=context();const a=c.preSubmitAuditForCurrentReport(sections('累计净现值100万元。\n总收入200万元。\n累计净现值99万元。'));
  assert.equal(a.ready,false);assert.ok(a.issues.some(x=>x.code==='NUMERIC_value_mismatch'));assert.ok(a.issues.some(x=>x.code==='NUMERIC_conflicting_occurrences'));
});
test('快照缺失、数据改变和空指标不以零通过',()=>{
  const c=context({totalNpv:null});let a=c.currentReportNumericAudit(sections('累计净现值0万元。'));assert.equal(a.declaredNumbersPassed,false);
  c.calcParams={a:2};a=c.currentReportNumericAudit(sections('累计净现值0万元。'));assert.equal(a.findings[0].severity,'error');
  c.projectWorkflow.calcSnapshots=[];a=c.currentReportNumericAudit(sections('累计净现值0万元。'));assert.equal(a.checked.length,0);assert.match(a.findings[0].message,/没有可核对/);
});
