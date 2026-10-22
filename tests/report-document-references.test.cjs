const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const C=require('../report-completion-contract.js');
const sha=text=>createHash('sha256').update(text).digest('hex');
const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
const hash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
const rule={title:'规模表',headers:['项目','面积'],terms:[]};
function fixture(){
 const plan=C.createPlan([{name:'总论',sections:[{t:'规模台账'},{t:'结论摘要'}]}]);
 const [target,source]=plan.sections;
 const reference='<span class="rpt-table-reference" data-report-ref-section="'+target.sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节规模台账。</span>';
 source.requiredTables=[rule];
 return {plan,contract:source,reference,entries:[{key:target.sectionKey,number:'1.1',text:table},{key:source.sectionKey,number:'1.2',text:'<p>摘要。</p>'+reference}]};
}

test('绑定当前节既有引用和整篇快照，实际目标满足必要表才减免；不改原表或预算',async()=>{
 const f=fixture(),before=JSON.stringify(f),c=await C.bindDocumentReferences(f.contract,f.entries),m=c.documentReferences;
 assert.equal(JSON.stringify(f),before);assert.equal(m.version,C.DOCUMENT_REFERENCE_VERSION);assert.equal(m.sourceDigest,sha(f.entries[1].text));
 assert.equal(m.references[0].targetDigest,sha(table));assert.deepEqual(m.references[0].tables,[table]);assert.deepEqual(m.references[0].tableHashes,[hash]);
 assert.deepEqual(c.requiredTables,[]);assert.deepEqual(m.originalRequiredTables,[rule]);assert.deepEqual(c.requirements,f.contract.requirements);
 assert.deepEqual(C.normalize(c),c);assert.deepEqual(await C.verifyDocumentReferences(c),c);assert.deepEqual(await C.verifyDocumentReferences(c,f.entries),c);
 assert.deepEqual(await C.bindDocumentReferences(c,f.entries),c);assert.match(m.references[0].html,/^<p class="rpt-table-reference"/);
 const other={title:'收入表',headers:['年度','营业收入'],terms:[]};f.contract.requiredTables.push(other);
 assert.deepEqual((await C.bindDocumentReferences(f.contract,f.entries)).requiredTables,[other]);
});

test('目标缺失、节号错位、逐格哈希变化、同名身份重复都在生成前拒绝',async()=>{
 const f=fixture();
 for(const mutate of [e=>e.splice(0,1),e=>{e[1].text=e[1].text.replace('第1.1节','第1.8节');},e=>{e[0].text=e[0].text.replace('5973','7973');},e=>e.push({...e[0]}),e=>e.push({...e[0],key:'同名不同身份'})]){
  const entries=structuredClone(f.entries);mutate(entries);await assert.rejects(C.bindDocumentReferences(f.contract,entries));
 }
 const noTable=structuredClone(f.entries);noTable[0].text='没有原表';await assert.rejects(C.bindDocumentReferences(f.contract,noTable),/未包含实际表格/);
 const unrelated=structuredClone(f.entries);unrelated[1].text='<p>只有正文，无引用。</p>';
 const unbound=await C.bindDocumentReferences(f.contract,unrelated);assert.equal(unbound.documentReferences,undefined);assert.deepEqual(unbound.requiredTables,[rule]);
});

test('结构化解码由程序保留绑定引用，模型不能提供新引用块；真实目标变化最终复核阻断',async()=>{
 const f=fixture(),c=await C.bindDocumentReferences(f.contract,f.entries),raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'规模以原表为准。'}]}),out=C.decodeStructured(raw,c);
 assert.deepEqual(out.issues,[]);assert.equal(out.raw,raw);assert.ok(out.text.endsWith(c.documentReferences.references[0].html));
 assert.equal(C.measure(out.text).tableCount,0);assert.equal(C.inspect(out.text,c).status,'passed');
 const actual=structuredClone(f.entries);actual[1].text=out.text;assert.equal(C.reviewDocument(actual,f.plan).status,'passed');
 actual[0].text=actual[0].text.replace('5973','7973');assert.equal(C.reviewDocument(actual,f.plan).status,'blocked');
 const forged=C.decodeStructured(JSON.stringify({blocks:[{kind:'document-ref',id:c.documentReferences.references[0].id}]}),c);
 assert.ok(forged.issues.some(i=>i.code==='structured-block-kind'));assert.ok(forged.text.includes(c.documentReferences.references[0].html));
 assert.match(C.structuredPrompt(c),/由程序原样附加/);assert.match(C.structuredPrompt(c),/不代表表中事实已核实/);
});

test('持久清单自身校验绑定内容、身份、节号、来源与必要表清单；live校验拒绝快照变更',async()=>{
 const f=fixture(),c=await C.bindDocumentReferences(f.contract,f.entries);
 for(const mutate of [x=>{x.documentReferences.sourceDigest='0'.repeat(64);},x=>{x.documentReferences.references[0].targetDigest='0'.repeat(64);},x=>{x.documentReferences.references[0].targetKey='其他小节';},x=>{x.documentReferences.references[0].targetNumber='2.1';},x=>{x.documentReferences.references[0].tables[0]=table.replace('5973','7973');},x=>{x.documentReferences.originalRequiredTables=[];},x=>{x.documentReferences.referenceCount=2;}]){
  const changed=structuredClone(c);mutate(changed);await assert.rejects(C.verifyDocumentReferences(changed));
 }
 const changed=structuredClone(f.entries);changed[0].text='<p>前言改变。</p>'+table;await assert.rejects(C.verifyDocumentReferences(c,changed),/当前整篇快照/);
 const unrelated=structuredClone(f.entries);unrelated[1].text+='<p>正文变更。</p>';await assert.rejects(C.verifyDocumentReferences(c,unrelated),/当前整篇快照/);
 const invalidRule=structuredClone(c);invalidRule.requiredTables=[rule];assert.throws(()=>C.normalize(invalidRule),/不能免除/);
});

test('旧引用升级为安全明确身份；不从隐藏内容取引用，HTML不能执行或偷免必要表',async()=>{
 const f=fixture();f.entries[1].text='<p class="rpt-table-reference" onclick="attack()">详见第1.1节规模台账。</p>';
 const c=await C.bindDocumentReferences(f.contract,f.entries);assert.doesNotMatch(c.documentReferences.references[0].html,/onclick/);assert.match(c.documentReferences.references[0].html,/data-report-ref-table-hash=/);
 const hidden=structuredClone(f.entries);hidden[1].text='<!--'+f.reference+'--><script>'+f.reference+'</script><p>无有效引用。</p>';
 assert.deepEqual((await C.bindDocumentReferences(f.contract,hidden)).requiredTables,[rule]);
 const malicious=structuredClone(f.entries);malicious[0].text=table.replace('<td>甲','<td onclick="attack()">甲');await assert.rejects(C.bindDocumentReferences(f.contract,malicious));
 const removed=structuredClone(f.entries);removed[1].text='<p>取消引用。</p>';const restored=await C.bindDocumentReferences(c,removed);assert.equal(restored.documentReferences,undefined);assert.deepEqual(restored.requiredTables,[rule]);
});
