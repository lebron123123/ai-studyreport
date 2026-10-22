const test=require('node:test'),assert=require('node:assert/strict'),{createHash,webcrypto}=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js');
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const first='<table class="rpt" style="border-collapse:collapse;width:100%"><tbody><tr><th rowspan="2">项目</th><th colspan="2">金额</th></tr><tr><td>含税</td><td>不含税</td></tr><tr><td><strong>收入</strong><br>【待补：时点】</td><td>109</td><td>100</td></tr></tbody></table>';
const second='<table class="rpt"><tr><th>指标</th><th>值</th></tr><tr><td>IRR</td><td>25.79%</td></tr><tr><td>净现值</td><td>-880.47万元</td></tr></table>';
const source='<p>当前工作稿，并非事实认证。</p>'+first+'<p>口径待确认。</p>'+second;
function contract(basis=false){const c=C.createPlan([{name:'总论',sections:[{t:basis?'编制依据':'项目结论',numeric:true}]}]).sections[0];return {...c,requirements:{...c.requirements,proseTarget:700,proseMax:910}};}
function refs(c){return c.frozenTables.tables.map(t=>({kind:'table-ref',id:t.id}));}
const paragraph={kind:'paragraph',slot:'conditions',text:'原工作稿财务口径待确认；不能据此认定财务可行。'};
const decode=(c,blocks)=>C.decodeStructured(JSON.stringify({blocks}),c);
const has=(value,code)=>value.issues.some(issue=>issue.code===code&&issue.severity==='error');

test('冻结绑定完整源快照、section和SHA256，原HTML/合并单元格/预算不变',async()=>{
  const original=contract(),before=JSON.stringify(original),c=await C.bindFrozenTables(original,source,'snapshot-v9');
  assert.equal(JSON.stringify(original),before);assert.equal(c.planId,original.planId);assert.deepEqual(c.requirements,original.requirements);
  const m=c.frozenTables;assert.equal(m.version,'frozen-tables-v1');assert.equal(m.sectionKey,c.sectionKey);assert.equal(m.sourceDigest,sha(source));
  assert.deepEqual(m.tables.map(t=>t.html),[first,second]);assert.deepEqual(m.tables.map(t=>t.sha256),[sha(first),sha(second)]);
  assert.deepEqual(C.normalize(c),c);assert.deepEqual(await C.verifyFrozenTables(c,source,'snapshot-v9'),c);
  assert.deepEqual(await C.bindFrozenTables(original,source,'snapshot-v9'),c);assert.notEqual(C.fingerprint(c),C.fingerprint(original));
  for(const other of [await C.bindFrozenTables(original,source,'snapshot-v10'),await C.bindFrozenTables({...original,sectionKey:'其他 / 小节'},source,'snapshot-v9'),await C.bindFrozenTables(original,source+' ', 'snapshot-v9')])assert.notEqual(other.frozenTables.tables[0].id,m.tables[0].id);
});

test('严格table-ref roundtrip原表各一次，真实MD与测量后span数值完整',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'snapshot-v9'),out=decode(c,[paragraph,...refs(c)]);
  assert.deepEqual(out.issues,[]);assert.equal(out.raw,JSON.stringify({blocks:[paragraph,...refs(c)]}));assert.ok(out.text.includes('\n\n'+first+'\n\n'+second));
  assert.equal(C.measure(out.text).tableCount,2);assert.equal(C.measure(out.text).malformedTables,0);
  const quality=C.inspect(out.text,c);assert.equal(quality.status,'unverified');assert.equal(quality.factsVerified,false);assert.ok(!quality.issues.some(i=>i.code.startsWith('frozen-table-')));
  const context={ReportCompletionContract:C};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../md.js'),'utf8'),context);
  const html=context.MD.renderHtml(out.text);assert.ok(html.includes(first));assert.ok(html.includes(second));assert.equal(C.measure(html).tableCount,2);
});

test('缺失/重复/未知/跨快照/乱序引用都阻断，错误输入raw完整保留',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'snapshot-v9'),foreign=await C.bindFrozenTables(contract(),source,'snapshot-v10'),rs=refs(c);
  for(const [blocks,code] of [[rs.slice(0,1),'structured-table-ref-missing'],[[rs[0],rs[0],rs[1]],'structured-table-ref-duplicate'],[[{kind:'table-ref',id:'unknown'},...rs],'structured-table-ref-unknown'],[[...refs(foreign)],'structured-table-ref-unknown'],[[rs[1],rs[0]],'structured-table-ref-order']]){
    const raw=JSON.stringify({blocks}),out=C.decodeStructured(raw,c);assert.ok(has(out,code),code);assert.equal(out.raw,raw);assert.ok(out.issues.every(i=>i.repairable));
  }
  const changed=decode(c,[{...rs[0],html:second},rs[1]]);assert.ok(has(changed,'structured-extra-fields'));assert.ok(changed.raw.includes('html'));assert.ok(changed.text.includes(first));
});

test('模型不能用新表/原HTML/待确认矩阵替代冻结表；失败仍可审计',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'snapshot-v9');
  const block={kind:'table',title:'待确认矩阵',headers:['事项','状态'],rows:[['数值','待确认']]};
  const out=decode(c,[block]);assert.ok(has(out,'structured-frozen-table-rewrite'));assert.ok(has(out,'structured-table-ref-missing'));assert.match(out.text,/待确认矩阵/);assert.equal(C.measure(out.text).tableCount,0);
  const copied=decode(c,[{kind:'paragraph',slot:'evidence',text:first},...refs(c)]);assert.ok(has(copied,'structured-paragraph-markup'));assert.equal(C.measure(copied.text).tableCount,2);
});

test('inspect重新核对原文，改数、改span、删表、重复、新造和乱序不可因二次验收丢错误',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'snapshot-v9');
  for(const [text,code] of [[first,'frozen-table-missing'],[source.replace('25.79%','25.80%'),'frozen-table-missing'],[source.replace('rowspan="2"','rowspan="1"'),'frozen-table-missing'],[source+second,'frozen-table-unexpected'],[source+'\n\n[[TABLE]]\n|指标|值|\n|---|---|\n|新表|1|\n[[/TABLE]]','frozen-table-unexpected'],[second+first,'frozen-table-order']]){
    const q=C.inspect(text,c);assert.equal(q.status,'blocked');assert.ok(has(q,code),code);
  }
});

test('后端异步复验拒绝内容/hash/id/ordinal/快照篡改，不把清单当可信认证',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'snapshot-v9');
  for(const mutate of [x=>x.frozenTables.tables[0].html=x.frozenTables.tables[0].html.replace('109','110'),x=>x.frozenTables.tables[0].sha256='0'.repeat(64),x=>x.frozenTables.tables[0].id='ft-'+'0'.repeat(64),x=>x.frozenTables.sourceDigest='0'.repeat(64),x=>x.frozenTables.sourceSnapshotId='other',x=>x.frozenTables.tables[0].ordinal=2,x=>x.frozenTables.sectionKey='other']){
    const bad=structuredClone(c);mutate(bad);await assert.rejects(C.verifyFrozenTables(bad));
  }
  await assert.rejects(C.verifyFrozenTables(c,source+' '));await assert.rejects(C.verifyFrozenTables(c,undefined,'snapshot-v10'));
  const missing=structuredClone(c);missing.frozenTables.tables.pop();await assert.rejects(C.verifyFrozenTables(missing));await assert.rejects(C.verifyFrozenTables(missing,source,'snapshot-v9'));
  missing.frozenTables.tableCount=missing.frozenTables.tables.length;await assert.rejects(C.verifyFrozenTables(missing));
});

test('严限HTML标签/属性/CSS、完整网格和根节点；攻击不会被清洗成“合法原表”',async()=>{
  assert.equal(C.safeFrozenTableHtml(first),first);
  const attacks=[
    first.replace('<td>109</td>','<td><script>alert(1)</script>109</td>'),
    first.replace('<table ','<table onclick="alert(1)" '),first.replace('<td>109','<td onmouseover="alert(1)">109'),
    first.replace('<td>109','<td><img src=x onerror=alert(1)>109'),first.replace('<td>109','<td><svg onload=alert(1)>109'),
    first.replace('<td>109','<td><a href="javascript:alert(1)">109</a>'),first.replace('<td>109','<td><!--comment-->109'),
    first.replace('border-collapse:collapse;width:100%','width:expression(alert(1))'),first.replace('border-collapse:collapse;width:100%','background-image:url(javascript:alert(1))'),
    first.replace('border-collapse:collapse;width:100%','width:&#101;xpression(alert(1))'),first.replace('border-collapse:collapse;width:100%','-moz-binding:url(x)'),
    first.replace('class="rpt"','class="rpt" class="x"'),first.replace('rowspan="2"','rowspan="0"'),first.replace('rowspan="2"','rowspan="501"'),
    first.replace('<td>100</td>',''),first.replace('</table>',''),
    first.replace('<td>109','<td>'+second+'109'),first.replace('<tbody>','<tbody><!DOCTYPE x>'),first.replace('<td>109','<td><iframe>109'),
  ];
  for(const html of attacks){assert.throws(()=>C.safeFrozenTableHtml(html));await assert.rejects(C.bindFrozenTables(contract(),html,'unsafe'));}
  for(const multipleRoots of [first+'<p>尾部HTML</p>',first+second])assert.throws(()=>C.safeFrozenTableHtml(multipleRoots));
  const inert='<table><tr><td>&lt;script&gt;并非脚本&lt;/script&gt;</td><td>100 &amp; 20</td></tr></table>';assert.equal(C.safeFrozenTableHtml(inert),inert);
});

test('保留原表但不抬高预算，已超表格预算仍blocked且冻结未证明事实',async()=>{
  const original=contract();original.requirements.tableMax=1;original.requirements.tableRowsMax=2;
  const c=await C.bindFrozenTables(original,source,'over-budget'),out=decode(c,[paragraph,...refs(c)]),q=C.inspect(out.text,c);
  assert.deepEqual(c.requirements,original.requirements);assert.deepEqual(out.issues,[]);assert.equal(q.status,'blocked');assert.ok(has(q,'budget-tableCount'));assert.ok(has(q,'budget-tableRows'));assert.equal(q.factsVerified,false);
});

test('新生成无冻结表仍按必要表table块；numeric标记本身不要求新造表，依据节不带表',async()=>{
  const original=contract(),empty=await C.bindFrozenTables(original,'<p>没有原表</p>','empty');assert.equal(original.requiredTables.length,0);assert.equal(empty.frozenTables.tables.length,0);
  const table={kind:'table',title:'规模表',headers:['指标','值'],rows:[['面积','5973㎡']]};assert.deepEqual(decode(empty,[table]).issues,[]);
  const financial=C.createPlan([{name:'财务',sections:[{t:'现金流评价',numeric:true}]}]).sections[0];assert.equal(financial.requiredTables.length,1);
  await assert.rejects(C.bindFrozenTables(contract(true),source,'basis'),/依据类/);const basis=await C.bindFrozenTables(contract(true),'<p>《协议稿》</p>','basis');assert.equal(basis.frozenTables.tables.length,0);
  assert.ok(has(decode(basis,[{kind:'table-ref',id:'unknown'}]),'structured-basis-table'));
  assert.deepEqual(await C.verifyFrozenTables(original),C.normalize(original));assert.equal(C.inspect('旧自由正文',original).status,'passed');
});

test('prompt引用冻结表不要求模型重写，repair逐槽限额且依据节不复述范围/冲突',async()=>{
  const c=await C.bindFrozenTables(contract(),source,'prompt'),prompt=C.structuredPrompt(c),repair=C.repairPrompt({issues:[{repairable:true,message:'槽位超预算'}]},c);
  assert.match(prompt,/"kind":"table-ref"/);assert.doesNotMatch(prompt,/"kind":"table",/);assert.ok(!prompt.includes(first));assert.match(prompt,/不证明表中事实真实/);assert.match(prompt,/不要求每节复述/);
  assert.match(repair,/精准修复原JSON/);assert.match(repair,/逐槽|各slot/);assert.doesNotMatch(repair,/表格改为简明事实矩阵/);
  const basis=contract(true);basis.requiredFacts=[{key:'scope',value:'5973㎡',status:'conflict'}];const bp=C.structuredPrompt(basis);assert.ok(!bp.includes('5973㎡'));assert.doesNotMatch(bp,/"kind":"table/);assert.match(bp,/仅列依据文件清单/);
});

test('浏览器WebCrypto与Node哈希一致，缺少安全哈希能力时明确拒绝',async()=>{
  const code=fs.readFileSync(require.resolve('../report-completion-contract.js'),'utf8'),browser={crypto:webcrypto,TextEncoder};vm.runInNewContext(code,browser);
  const c=await browser.ReportCompletionContract.bindFrozenTables(contract(),source,'browser');assert.equal(c.frozenTables.sourceDigest,sha(source));assert.equal(c.frozenTables.tables[0].sha256,sha(first));
  const missing={TextEncoder};vm.runInNewContext(code,missing);await assert.rejects(missing.ReportCompletionContract.bindFrozenTables(contract(),source,'missing'),/SHA256/);
});

test('源快照外的注释/脚本不是正文表，表内注释/脚本必须拒绝而不能静默删除',async()=>{
  const c=await C.bindFrozenTables(contract(),'<!--'+second+'--><script>const x='+JSON.stringify(second)+'</script>'+first,'comments');assert.equal(c.frozenTables.tables.length,1);assert.equal(c.frozenTables.tables[0].html,first);
  await assert.rejects(C.bindFrozenTables(contract(),first.replace('<td>109','<td><!--x-->109'),'bad'));
  await assert.rejects(C.bindFrozenTables(contract(),first.replace('<td>109','<td><script>x</script>109'),'bad'));
});
