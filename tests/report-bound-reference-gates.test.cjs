const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');

const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
const hash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
const rule={title:'规模表',headers:['项目','面积'],terms:[]};
async function fixture(){
  const plan=C.createPlan([{name:'总论',sections:[{t:'规模台账'},{t:'结论摘要'}]}]);
  const [target,source]=plan.sections;source.requiredTables=[rule];
  const reference='<span class="rpt-table-reference" data-report-ref-section="'+target.sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节规模台账。</span>';
  const entries=[{key:target.sectionKey,number:'1.1',text:table},{key:source.sectionKey,number:'1.2',text:'<p>摘要。</p>'+reference}];
  const contract=await C.bindDocumentReferences(source,entries);plan.sections[1]=contract;
  const output=C.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'规模以登记台账为准。'}]}),contract);
  assert.deepEqual(output.issues,[]);entries[1].text=output.text;
  return {plan,contract,entries,reference:contract.documentReferences.references[0].html,originalReference:reference};
}
const has=(review,code)=>review.issues.some(issue=>issue.code===code)||review.reviews?.some(item=>item.issues.some(issue=>issue.code===code));

test('必要表减免后，删除引用不再通过单节或整篇检查，复制表不能偷免绑定义务',async()=>{
  const f=await fixture();assert.deepEqual(f.contract.requiredTables,[]);
  assert.equal(C.inspect(f.entries[1].text,f.contract).status,'passed');
  assert.equal(C.reviewDocument(f.entries,f.plan).status,'passed');
  for(const replacement of ['<p>压缩后的摘要。</p>','<p>改成本节复制表。</p>'+table]){
    const entries=structuredClone(f.entries);entries[1].text=replacement;
    const local=C.inspect(replacement,f.contract),whole=C.reviewDocument(entries,f.plan);
    assert.equal(local.status,'blocked');assert.ok(has(local,'bound-reference-missing'));
    assert.equal(whole.status,'blocked');assert.ok(has(whole,'bound-reference-missing'));
    assert.equal(local.issues.find(issue=>issue.code==='bound-reference-missing').repairable,false);
  }
});

test('身份校验允许 p/span、行内样式和正文精简，不要求候选 SHA 等于来源 SHA',async()=>{
  const f=await fixture();
  for(const ref of [f.originalReference,f.reference.replace('<p ','<p style="color:blue" ').replace('节规模台账。','节<strong>规模台账</strong>。'),'<p>'+f.reference.replace(/^<p /,'<span ').replace(/<\/p>$/,'</span>')+'</p>']){
    const entries=structuredClone(f.entries);entries[1].text='<p>新的简明摘要。</p>'+ref;entries[0].text='<p>目标正文也允许精简，不影响表格身份。</p>'+table;
    const local=C.inspect(entries[1].text,f.contract);assert.equal(local.status,'passed',JSON.stringify({ref,local}));
    const review=C.reviewDocument(entries,f.plan);assert.equal(review.status,'passed',JSON.stringify(review));assert.equal(review.factsVerified,false);
  }
});

test('变更标签、目标、节号、scope、hash 或重复引用均不能替换已绑定引用',async()=>{
  const f=await fixture();
  for(const ref of [f.reference.replace('规模台账','其他台账'),f.reference.replace('data-report-ref-section="','data-report-ref-section="不存在'),f.reference.replace('第1.1节','第99.9节'),f.reference.replace('scope="document"','scope="other"'),f.reference.replace(hash,'00000000'),f.reference+f.reference]){
    const review=C.inspect('<p>正文。</p>'+ref,f.contract);assert.equal(review.status,'blocked');
    assert.ok(has(review,'bound-reference-missing')||has(review,'bound-reference-unexpected'));
  }
  const legacy='<p class="rpt-table-reference">详见第1.1节规模台账。</p>';
  assert.ok(has(C.inspect(legacy,f.contract),'bound-reference-missing'),'已绑定清单不可降级为无稳定身份的旧引用');
});

test('注释或不渲染元素中的引用不能满足绑定义务，隐藏目标表也不算实际目标',async()=>{
  const f=await fixture();
  for(const wrapper of [text=>'<!--'+text+'-->',text=>'<script>'+text+'</script>',text=>'<style>'+text+'</style>',text=>'<textarea>'+text+'</textarea>',text=>'<template>'+text+'</template>']){
    const hidden=structuredClone(f.entries);hidden[1].text='<p>正文。</p>'+wrapper(f.reference);
    assert.ok(has(C.inspect(hidden[1].text,f.contract),'bound-reference-missing'));
    assert.equal(C.reviewDocument(hidden,f.plan).status,'blocked');
    const target=structuredClone(f.entries);target[0].text='<p>正文中没有表格。</p>'+wrapper(table);
    const review=C.reviewDocument(target,f.plan);assert.equal(review.status,'blocked');assert.ok(has(review,'reference-table-missing'));
  }
});

test('最终整篇核对 live 目标内容、物理合并关系、目标与来源节号，格式不改变逐格身份',async()=>{
  const f=await fixture();
  for(const [mutate,code] of [
    [entries=>{entries.splice(0,1);},'reference-target-missing'],
    [entries=>{entries[0].text='<p>原表被删除。</p>';},'reference-table-missing'],
    [entries=>{entries[0].text=table.replace('5973','7973');},'reference-table-mismatch'],
    [entries=>{entries[0].text=table.replace('<td>甲','<td rowspan="2">甲');},'reference-table-mismatch'],
    [entries=>{entries[0].number='2.1';},'reference-number-mismatch'],
    [entries=>{entries[1].number='1.9';},'bound-reference-source'],
    [entries=>{entries.push({...entries[0]});},'reference-target-ambiguous']
  ]){
    const entries=structuredClone(f.entries);mutate(entries);const review=C.reviewDocument(entries,f.plan);
    assert.equal(review.status,'blocked');assert.ok(has(review,code),code+' '+JSON.stringify(review));
  }
  const styled=structuredClone(f.entries);styled[0].text=table.replace('<table>','<table class="layout">').replace('<td>5973','<td><strong>5973</strong>');
  assert.equal(C.reviewDocument(styled,f.plan).status,'passed');
});

test('无绑定清单的历史引用保持兼容；明确重新绑定取消引用后恢复原必要表',async()=>{
  const f=await fixture(),unbound=structuredClone(f.contract);delete unbound.documentReferences;unbound.requiredTables=[rule];
  const oldPlan={...f.plan,sections:[f.plan.sections[0],unbound]},oldEntries=structuredClone(f.entries);
  oldEntries[1].text='<p class="rpt-table-reference">详见第1.1节规模台账。</p>';
  assert.equal(C.reviewDocument(oldEntries,oldPlan).status,'passed');
  oldEntries[1].text='<p>取消跨节引用。</p>';
  const restored=await C.bindDocumentReferences(f.contract,oldEntries);assert.equal(restored.documentReferences,undefined);assert.deepEqual(restored.requiredTables,[rule]);
  assert.ok(has(C.inspect(oldEntries[1].text,restored),'missing-table'));
});

test('生成依赖复核只检查绑定引用，不因无关兄弟正文或表格完成而失效',async()=>{
  const f=await fixture(),entries=structuredClone(f.entries);
  entries.push({key:'总论 / 无关说明',number:'1.3',text:'<p>初稿。</p>'+table.replace('5973','100')});
  assert.doesNotThrow(()=>C.verifyDocumentReferenceDependencies(f.contract,entries));
  entries[2].text='<p>兄弟节正常完成。</p>'+table.replace('5973','200');
  entries[0].text='<p>目标正文正常完善。</p>'+table.replace('<table>','<table class="layout">');
  entries[1].text='<p>来源正文允许完善。</p>'+f.reference;
  assert.doesNotThrow(()=>C.verifyDocumentReferenceDependencies(f.contract,entries));
  entries.pop();assert.doesNotThrow(()=>C.verifyDocumentReferenceDependencies(f.contract,entries));
});

test('生成依赖复核拒绝缺失或重复身份、引用改写及目标数值/合并关系变化',async()=>{
  const f=await fixture();
  for(const mutate of [
    entries=>entries.splice(0,1),
    entries=>entries.splice(1,1),
    entries=>entries.push({...entries[0]}),
    entries=>{entries[0].text='<p>表格已删除。</p>';},
    entries=>{entries[0].text=table.replace('5973','7973');},
    entries=>{entries[0].text=table.replace('<td>甲','<td rowspan="2">甲');},
    entries=>{entries[0].number='1.9';},
    entries=>{entries[1].number='1.9';},
    entries=>{entries[1].text=f.reference+f.reference;},
    entries=>{entries[1].text=f.reference.replace(hash,'00000000');}
  ]){
    const entries=structuredClone(f.entries);mutate(entries);
    assert.throws(()=>C.verifyDocumentReferenceDependencies(f.contract,entries));
  }
  const unbound=structuredClone(f.contract);delete unbound.documentReferences;
  assert.doesNotThrow(()=>C.verifyDocumentReferenceDependencies(unbound,[]));
});

test('生成依赖复核按实际表格份数消费重复哈希，不能一表满足两次绑定',async()=>{
  const f=await fixture(),entries=structuredClone(f.entries);
  entries[0].text=table+table;
  entries[1].text=f.originalReference.replace(hash,hash+' '+hash);
  const contract=await C.bindDocumentReferences(f.contract,entries);
  assert.doesNotThrow(()=>C.verifyDocumentReferenceDependencies(contract,entries));
  entries[0].text=table;
  assert.throws(()=>C.verifyDocumentReferenceDependencies(contract,entries),/目标表格已缺失/);
});
