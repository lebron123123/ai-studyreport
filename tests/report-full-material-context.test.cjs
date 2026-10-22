const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../report.js'),'utf8');
function load(entries){
  const ctx={kbEntries:entries,window:{ReportCompletionContract:true},ReportCompletionContract:{evidenceWindows:()=>[]}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function kbRetrieve('),source.indexOf('// 把HTML稿转回')),ctx);return ctx;
}
test('complete report includes all small dossier material including unmatched titles and late clauses',()=>{
  const late='不可删的末尾合同条款：第六年后按净收益分成，不是固定收楼租金';
  const entries=[{title:'协议',content:'原文'.repeat(4000)+late},{title:'附件',content:'整份附件'},{title:'另一个文件',content:'完整末尾'}];
  const ctx=load(entries),collector={kbDocs:[]},text=ctx.kbRetrieve('市场分析','人口',collector,{fullReport:true});
  assert.ok(text.includes(late));assert.ok(text.includes('整份附件'));assert.ok(text.includes('完整末尾'));
  assert.equal(collector.kbDocs.length,3);assert.equal(collector.kbDocs[0].excerpt,entries[0].content);assert.equal(collector.kbDocs[0].offset,0);assert.equal(collector.kbDocs[0].coverage,'complete-parsed-text');
});
test('large dossiers disclose incomplete search and inventory rather than claiming files are absent',()=>{
  const ctx=load([{title:'超量协议',content:'甲'.repeat(60001)}]);
  const text=ctx.kbRetrieve('市场分析','人口',null,{fullReport:true});
  assert.ok(text.includes('不是完整资料审查'));assert.ok(text.includes('超量协议'));assert.ok(!text.includes('甲'.repeat(60001)));
});
test('local edit retains its narrow retrieval and cannot expand input by default',()=>{
  const ctx=load([{title:'无关附件',content:'原文'.repeat(5000)}]);
  assert.equal(ctx.kbRetrieve('市场分析','人口'), '');
});
