const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
const contract=()=>C.normalize({version:C.VERSION,planId:'[系统测试]plan',sectionKey:'总论 / 摘要',requirements:{proseTarget:300,proseMax:400,tableMax:3,tableRowsMax:20,cellCharsMax:100,tableCharsMax:1000},requiredFacts:[],requiredTables:[]});
const figure='<figure data-template-id="a"><div class="rpt-table-caption">规模标题</div>'+table+'<p>原表说明不得删。</p></figure>';

test('canonical 外标题/说明只计一次、表格不计正文、普通旧文不误计、QA只显式登记',async()=>{
  const source='<p>旧正文'.repeat(20)+'</p>'+figure+'<div class="rpt-table-context">口径说明</div>';
  const qa='<p data-report-review-annotation="full-review-v1">旧测算待重核，不得认定财务可行。</p>';
  const original=contract(),c=await C.bindProgramProse(original,source),q=await C.bindProgramProse(original,source,qa);
  assert.deepEqual(c.requirements,original.requirements);
  const expected=C.measure(figure).proseCharacters+4;
  assert.equal(C.programProseBudget(c).artifactCharacters,expected);
  assert.equal(C.programProseBudget(q).artifactCharacters,expected+C.measure(qa).proseCharacters);
  assert.equal(C.outputSlots(c).reduce((n,s)=>n+s.hardMax,0)+expected,400);
  assert.equal(C.outputSlots(c).reduce((n,s)=>n+s.target,0)+expected,300);
  assert.deepEqual(await C.bindProgramProse(c,source),c);
  assert.deepEqual(await C.verifyProgramProse(c,source),c);
  assert.deepEqual(await C.verifyProgramProse(c),c);
  assert.equal(original.programProse,undefined);
});

test('绑定引用按实际程序可见字数预留，不与 figure 内相同引用重复计数',async()=>{
  const original=contract(),targetKey='明细 / 规模',hash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]),reference='<p class="rpt-table-reference" data-report-ref-section="'+targetKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第2.1节规模表。</p>';
  const source='<figure><h4>标题</h4>'+reference+'</figure>';
  const refs=await C.bindDocumentReferences(original,[{key:original.sectionKey,number:'1.1',text:source},{key:targetKey,number:'2.1',text:table}]);
  const c=await C.bindProgramProse(refs,source),budget=C.programProseBudget(c);
  assert.equal(budget.referenceCharacters,11);assert.equal(budget.artifactCharacters,2);assert.equal(budget.reservedCharacters,13);
  assert.equal(C.outputSlots(c).reduce((n,s)=>n+s.hardMax,0),387);
  const decoded=C.decodeStructured(JSON.stringify({blocks:C.outputSlots(c).map(s=>({kind:'paragraph',slot:s.slot,text:'字'.repeat(s.hardMax)}))}),c);
  assert.deepEqual(decoded.issues,[]);assert.equal(C.measure(decoded.text).proseCharacters,398);
  assert.equal(C.measure(decoded.text+'<h4>标题</h4>').proseCharacters,400);
});

test('服务端与最终渲染同一固定上限：满槽正文加真实图注/旁注恰好不超限',async()=>{
  let c=await C.bindFrozenTables(contract(),figure,'[系统测试]snapshot');
  const qa='<p data-report-review-annotation="full-review-v1">仍待人工审签。</p>';
  c=await C.bindProgramProse(c,figure,qa);
  const blocks=C.outputSlots(c).map(s=>({kind:'paragraph',slot:s.slot,text:'字'.repeat(s.hardMax)}));
  blocks.push({kind:'table-ref',id:c.frozenTables.tables[0].id});
  const decoded=C.decodeStructured(JSON.stringify({blocks}),c);assert.deepEqual(decoded.issues,[]);
  const final=decoded.text.replace(table,figure)+qa;
  assert.equal(C.measure(final).proseCharacters,400);assert.notEqual(C.inspect(final,c).status,'blocked');
  blocks[0].text+='字';const exceeded=C.decodeStructured(JSON.stringify({blocks}),c);
  assert.ok(exceeded.issues.some(i=>i.code==='structured-slot-budget'));
  // A formerly valid full-size slot is not silently grandfathered into the new contract.
  const legacy=contract(),old=C.outputSlots(legacy)[0];blocks[0].text='字'.repeat(old.hardMax);
  assert.ok(C.decodeStructured(JSON.stringify({blocks}),c).issues.some(i=>i.code==='structured-slot-budget'));
});

test('缺口完整保留；预留耗尽固定预算时前置阻止而非负预算或抬高上限',async()=>{
  const original={...contract(),requiredMarkers:['【待补：协议审批结论】']};
  const c=await C.bindProgramProse(original,figure),slots=C.outputSlots(c),conditions=slots.find(s=>s.slot==='conditions');
  assert.ok(conditions.hardMax>original.requiredMarkers[0].length);assert.deepEqual(c.requiredMarkers,original.requiredMarkers);
  await assert.rejects(C.bindProgramProse(original,'<figure>'+('字'.repeat(320))+'</figure>'),/占满固定正文预算/);
  assert.equal(original.requirements.proseMax,400);
});

test('manifest 绑定身份与完整源摘要，篡改/不同源码/不同旁注明确拒绝',async()=>{
  const c=await C.bindProgramProse(contract(),figure,'<p>旁注</p>');
  for(const field of ['sectionKey','planId']){const bad=structuredClone(c);bad.programProse[field]+='changed';assert.throws(()=>C.normalize(bad));}
  const bad=structuredClone(c);bad.programProse.entries[0].text+='伪造';await assert.rejects(C.verifyProgramProse(bad),/摘要不匹配/);
  await assert.rejects(C.verifyProgramProse(c,figure.replace('5973','7973'),'<p>旁注</p>'),/完整来源不一致/);
  await assert.rejects(C.verifyProgramProse(c,figure,'<p>不同旁注</p>'),/完整来源不一致/);
  await assert.rejects(C.bindProgramProse(contract(),'<figure>未闭合'),/未闭合/);
  const extra=structuredClone(c);extra.programProse.reservedCharacters=0;assert.throws(()=>C.normalize(extra));
});

test('旧合同只读检查兼容，依据目录不加入旁注，清单无执行/原稿写入副作用',async()=>{
  const old=contract();assert.deepEqual(await C.verifyProgramProse(old),old);assert.equal(C.programProseBudget(old).reservedCharacters,0);
  const source='<script>throw Error("execute")</script>'+figure,bound=await C.bindProgramProse(old,source);
  assert.equal(bound.programProse.entries.some(e=>e.text.includes('execute')),false);
  const basis={...old,requirements:{...old.requirements,basis:true}};
  assert.equal((await C.bindProgramProse(basis,'<p>依据清单</p>')).programProse,undefined);
  await assert.rejects(C.bindProgramProse(basis,figure),/依据目录不能/);
});
