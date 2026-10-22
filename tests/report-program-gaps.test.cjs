const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const marker='【待补：项目市场统计】';
const reference={gapId:'gap-market',ownerSection:'市场 / 需求',text:'项目市场统计资料待核验，相关判断暂不作确定性结论。',critical:true};
function contract(){return C.normalize({...C.createPlan([{name:'市场',sections:[{t:'需求'}]}]).sections[0],gapRequirements:{version:C.GAP_REQUIREMENTS_VERSION,registryHash:'registry:1',sourceRevision:'source:1',primaryMarkers:[marker],references:[reference],forbiddenMarkers:['【待补：别节事项】']}});}
const raw=blocks=>JSON.stringify({blocks});
const paragraph=(text,slot='conditions')=>({kind:'paragraph',slot,text});
const count=(text,needle)=>text.split(needle).length-1;

test('approved registry notices are rendered exactly once before unchanged inspection',()=>{
  const c=contract(),before=JSON.stringify(c),source=raw([paragraph('配套不等于实际需求，资料核验前不能作肯定判断。','finding')]);
  const d=C.decodeStructured(source,c),q=C.inspect(d.text,c);
  assert.equal(d.raw,source);assert.equal(JSON.stringify(c),before);assert.equal(d.issues.length,0);
  assert.equal(count(d.text,marker),1);assert.equal(count(d.text,reference.text),1);
  assert.equal(q.status,'unverified');assert.equal(q.factsVerified,false);assert.equal(q.issues.filter(i=>i.severity==='error').length,0);
  assert.ok(C.inspect('无缺口说明的旧正文',c).issues.some(i=>i.code==='gap-reference-count'));
});
test('only exact registered copies and sentence-ending equivalents are replaced, other limitations survive',()=>{
  const c=contract(),source=raw([paragraph('市场变化不能据此确认。'+reference.text+reference.text.replace(/。$/,'；')+marker+'；不同口径的限制仍待核实。')]);
  const d=C.decodeStructured(source,c);assert.equal(d.raw,source);
  assert.equal(count(d.text,reference.text),1);assert.equal(count(d.text,marker),1);
  assert.match(d.text,/市场变化不能据此确认/);assert.match(d.text,/不同口径的限制仍待核实/);
  const paraphrase='统计资料尚未复核，不具备肯定判断依据。';
  assert.match(C.decodeStructured(raw([paragraph(paraphrase)]),c).text,new RegExp(paraphrase));
});
test('negated, embedded and forbidden notices are not deleted to conceal an invalid candidate',()=>{
  const c=contract();
  for(const text of ['不能认定'+reference.text,'“'+reference.text+'”并非事实认证。','【待补：别节事项】']){
    const d=C.decodeStructured(raw([paragraph(text)]),c),q=C.inspect(d.text,c);
    assert.ok(d.text.includes(text));assert.equal(q.status,'blocked');
  }
});
test('model lists deduplicate approved notices without removing other items or manufacturing facts',()=>{
  const c=contract(),d=C.decodeStructured(raw([{kind:'list',slot:'conditions',ordered:false,items:[reference.text,marker,'需求规模仍不得推断。']}]),c);
  assert.equal(count(d.text,reference.text),1);assert.equal(count(d.text,marker),1);assert.match(d.text,/<li>需求规模仍不得推断。<\/li>/);
  assert.equal(C.inspect(d.text,c).factsVerified,false);
});
test('program gap text occupies existing budget, never expands it or consumes another model slot twice',()=>{
  const c=contract(),fixed=[marker,reference.text].reduce((n,x)=>n+C.measure(x).proseCharacters,0),slots=C.outputSlots(c),budget=C.programProseBudget(c);
  assert.equal(budget.gapCharacters,fixed);
  assert.equal(slots.reduce((n,x)=>n+x.hardMax,0)+budget.reservedCharacters,c.requirements.proseMax);
  assert.ok(slots.reduce((n,x)=>n+x.target,0)+budget.reservedCharacters<=c.requirements.proseTarget);
  assert.match(C.structuredPrompt(c),/由程序各输出一次/);assert.match(C.structuredPrompt(c),/不写“本节需回答”/);
});
test('empty, malformed and fixed-notice-only responses stay blocked with original raw intact',()=>{
  const c=contract();
  for(const source of ['{broken',raw([]),raw([paragraph(reference.text+marker)])]){
    const d=C.decodeStructured(source,c);assert.equal(d.raw,source);assert.ok(d.issues.some(i=>i.severity==='error'));
  }
});
test('legacy contracts without bound gap registry retain their original marker responsibility and prose',()=>{
  const c=C.normalize({...C.createPlan([{name:'总论',sections:[{t:'概况'}]}]).sections[0],requiredMarkers:[marker]}),source=raw([paragraph('原有标点、与限制保持不变；')]),d=C.decodeStructured(source,c);
  assert.equal(d.text,'原有标点、与限制保持不变；');assert.ok(C.inspect(d.text,c).issues.some(i=>i.code==='missing-evidence-marker'));
});
test('已登记缺口引用留在明确主题，未知引用拒绝，未定位项使用独立边界组',()=>{
  const c=contract(),blocks=[{kind:'heading',slot:'finding',level:3,text:'需求基础'},paragraph('按已取得的区位条件划分客群。','finding'),{kind:'gap-ref',id:reference.gapId},{kind:'heading',slot:'conditions',level:3,text:'执行安排'},paragraph('取得申请台账后校核实际规模。')];
  const d=C.decodeStructured(raw(blocks),c);
  assert.deepEqual(d.issues,[]);assert.ok(d.text.indexOf(reference.text)<d.text.indexOf('执行安排'));
  assert.ok(d.text.indexOf(marker)>d.text.indexOf('report-gap-boundaries'));
  assert.equal(count(d.text,reference.text),1);assert.equal(count(d.text,marker),1);
  assert.ok(!C.inspect(d.text,c).issues.some(i=>i.severity==='error'));
  for(const ref of [{kind:'gap-ref',id:'unknown'},{kind:'gap-ref',id:reference.gapId,marker},{kind:'gap-ref',marker:'【待补：未登记】'}])assert.ok(C.decodeStructured(raw([...blocks,ref]),c).issues.some(i=>i.code==='structured-gap-ref-unknown'));
  const repeatedRaw=raw([...blocks,{kind:'gap-ref',id:reference.gapId}]),repeated=C.decodeStructured(repeatedRaw,c);
  assert.equal(repeated.raw,repeatedRaw);
  assert.ok(repeated.issues.some(i=>i.code==='structured-gap-ref-duplicate'&&i.severity==='warning'&&!i.repairable));
  assert.ok(!repeated.issues.some(i=>i.severity==='error'));
  assert.equal(repeated.text,d.text);
  assert.ok(!C.inspect(repeated.text,c).issues.some(i=>i.severity==='error'));
});

test('重复已登记引用可归并，但不同缺口、未知身份和其他内容错误不能借此通过',()=>{
  const second={...reference,gapId:'gap-income',text:'收入证据尚未闭合，不能据此确定回款。'};
  const c=C.normalize({...contract(),gapRequirements:{...contract().gapRequirements,references:[reference,second]}});
  const base=[paragraph('市场资料不足与收入核验是两项不同限制。','finding'),{kind:'gap-ref',id:reference.gapId},{kind:'gap-ref',id:second.gapId},{kind:'gap-ref',id:reference.gapId},{kind:'gap-ref',id:second.gapId},{kind:'gap-ref',marker}];
  const d=C.decodeStructured(raw(base),c);
  assert.equal(count(d.text,reference.text),1);assert.equal(count(d.text,second.text),1);assert.equal(count(d.text,marker),1);
  assert.ok(!d.issues.some(i=>i.severity==='error'));
  assert.ok(!C.inspect(d.text,c).issues.some(i=>i.severity==='error'));
  for(const invalid of [{kind:'gap-ref',id:'gap-unknown'},{kind:'gap-ref',id:reference.gapId,extra:'不能吞掉'},{kind:'paragraph',slot:'unknown',text:'非法槽正文'}]){
    const out=C.decodeStructured(raw([...base,invalid]),c);
    assert.ok(out.issues.some(i=>i.severity==='error'));
    assert.ok(out.raw.includes(JSON.stringify(invalid)));
  }
  const onlyRefs=C.decodeStructured(raw(base.filter(b=>b.kind==='gap-ref')),c);
  assert.ok(onlyRefs.issues.some(i=>i.severity==='error'),'固定缺口说明不能充当业务正文');
});
test('旧模型显式写出的登记引用保持原业务主题而不是统一挪到最后',()=>{
  const c=contract(),blocks=[{kind:'heading',slot:'finding',level:3,text:'需求基础'},paragraph('现有清单不等于实际需求。'+reference.text,'finding'),{kind:'heading',slot:'conditions',level:3,text:'执行安排'},paragraph('取得申请台账后再核实。'+marker)];
  const d=C.decodeStructured(raw(blocks),c);
  assert.ok(d.text.indexOf(reference.text)<d.text.indexOf('执行安排'));
  assert.ok(!d.text.includes('report-gap-boundaries'));assert.equal(count(d.text,reference.text),1);
});

test('6.3旧正文固定说明作为原句末尾保留，重复说明去重不留下无标点残句',()=>{
  const notice='项目运营方案资料待核验，相关判断暂不作确定性结论。',c=C.normalize({...contract(),gapRequirements:{...contract().gapRequirements,references:[{...reference,text:notice}]}});
  const first='以上仅为安排方向，'+notice,second='岗位配置与服务标准均依赖尚未闭合的依据，'+notice;
  const source=raw([paragraph(first,'finding'),paragraph(second,'conditions')]),d=C.decodeStructured(source,c);
  assert.ok(d.text.includes(first),'首个末尾连接句不得拆开、删除或移到独立主题');
  assert.ok(d.text.includes('岗位配置与服务标准均依赖尚未闭合的依据。'),'重复固定说明去重后保留完整业务句和句末标点');
  assert.equal(count(d.text,notice),1);assert.equal(d.raw,source);assert.equal(d.issues.length,0);
  const list=C.decodeStructured(raw([{kind:'list',slot:'conditions',ordered:false,items:[first,second]}]),c);
  assert.ok(list.text.includes('<li>'+first+'</li>'));assert.ok(list.text.includes('<li>岗位配置与服务标准均依赖尚未闭合的依据。</li>'));
});
