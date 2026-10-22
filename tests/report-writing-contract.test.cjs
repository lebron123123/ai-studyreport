const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),W=require('../report-writing-standard.js');
function base(title='市场分析',type='gaibao'){return C.normalize({version:C.VERSION,planId:'[系统测试]writing-plan',projectType:type,sectionKey:'第三章 / '+title,requirements:{basis:title==='编制依据',proseTarget:600,proseMax:780,tableMax:2,tableRowsMax:20,cellCharsMax:100,tableCharsMax:1500},requiredFacts:[],requiredTables:[]});}
function bound(title,type){return C.normalize({...base(title,type),writingStandard:{config:W.defaults(),context:{title:title||'市场分析',chapter:'第三章'}}});}
const paragraph=(slot,text)=>({kind:'paragraph',slot,text});
const decode=(c,blocks)=>C.decodeStructured(JSON.stringify({blocks}),c);

test('关键数值只兼容正确千分位，不容忍错位、变值、单位换算或隐藏文本',()=>{
  const c=C.normalize({...base(),requiredFacts:[{key:'area',label:'面积',value:'5621.15',status:'confirmed',required:true}]});
  const missing=text=>C.inspect(text,c).issues.some(i=>i.code==='missing-fact');
  for(const text of ['面积5621.15㎡。','面积5,621.15㎡。','<p>面积5,621.15平方米</p>'])assert.equal(missing(text),false,text);
  for(const text of ['56,21.15','15621.15','5621.150','-5621.15','5621.15%','5621.16','<!--5621.15-->','<script>5621.15</script>'])assert.equal(missing(text),true,text);
  const percent=C.normalize({...c,requiredFacts:[{key:'ratio',label:'比例',value:'100.00%',status:'confirmed',required:true}]});
  assert.ok(C.inspect('100%',percent).issues.some(i=>i.code==='missing-fact'));
  assert.ok(!C.inspect('100.00%',percent).issues.some(i=>i.code==='missing-fact'));
});
test('财务基础假设与评价指标责任分开，显式已配置表要求不被覆盖',()=>{
  const outline=[{name:'财务评价',sections:[{t:'财务评价基础数据和假设'},{t:'财务评价指标'}]}],plan=C.createPlan(outline);
  assert.equal(plan.sections[0].requiredTables[0].title,'财务测算参数与假设表');assert.equal(plan.sections[1].requiredTables[0].title,'财务评价指标表');
  const requirements=[{title:'用户自定',headers:[],terms:['合同']}],custom=C.createPlan(outline,{requiredTables:{'财务评价 / 财务评价基础数据和假设':requirements}});assert.deepEqual(custom.sections[0].requiredTables,requirements);
});

test('行文标准可选绑定并参与合同指纹，旧合同不改版本或旧槽位',()=>{
  const old=base(),c=bound(),snapshot=JSON.stringify(c);assert.equal(C.normalize(old).writingStandard,undefined);assert.equal(c.version,C.VERSION);assert.notEqual(C.fingerprint(old),C.fingerprint(c));assert.deepEqual(C.outputSlots(old).map(s=>s.slot),['finding','evidence','conditions','decision']);assert.deepEqual(C.normalize(c),c);assert.equal(JSON.stringify(c),snapshot);
  const changed=structuredClone(c);changed.writingStandard.config.globalInstructions+='\n新增已审批标准';assert.notEqual(C.fingerprint(c),C.fingerprint(C.normalize(changed)));
});
test('三类项目采用不同小节职责，连续段落与总预算不受材料数量影响',()=>{
  for(const type of ['gaibao','rent','sale'])for(const title of ['市场分析','客群需求','租金定价','财务评价','风险分析','项目概况','实施进度','结论与建议']){
    const c=bound(title,type),slots=C.outputSlots(c);assert.equal(slots.reduce((n,s)=>n+s.hardMax,0),780);assert.equal(slots.reduce((n,s)=>n+s.target,0),600);assert.ok(slots.every(s=>s.target<=s.hardMax));assert.ok(slots.some(s=>s.slot==='conditions'));assert.equal(c.writingStandard.context.projectType,type);
    const out=decode(c,[paragraph(slots[0].slot,'有效事实。'),paragraph(slots[0].slot,'另一项直接相关事实。')]);assert.deepEqual(out.issues,[]);assert.equal(out.text,'有效事实。\n\n另一项直接相关事实。');
  }
});
test('同一职责多段共享预算，不以重复slot扩张可生成篇幅',()=>{
  const c=bound(),slot=C.outputSlots(c)[0],text='字'.repeat(Math.floor(slot.hardMax/2)+1),out=decode(c,[paragraph(slot.slot,text),paragraph(slot.slot,text)]);
  assert.ok(out.issues.some(i=>i.code==='structured-slot-budget'));assert.equal(out.text,text+'\n\n'+text);
  const tooMany=decode(c,Array.from({length:4},()=>paragraph(slot.slot,'短段。')));assert.ok(tooMany.issues.some(i=>i.code==='structured-slot-count'));
  const ordered=C.outputSlots(c),wrong=decode(c,[paragraph(ordered[1].slot,'第二职责'),paragraph(ordered[0].slot,'第一职责')]);assert.ok(wrong.issues.some(i=>i.code==='structured-slot-order'));
});
test('已登记待补预留到实际conditions槽，所有职责仍不删缺口',()=>{
  const marker='【待补：同一统计期及项目所在街道的就业数据。】';
  for(const title of ['项目概况','租金定价','市场分析','财务评价','风险分析']){
    const c=C.normalize({...bound(title),requiredMarkers:[marker]}),slots=C.outputSlots(c),condition=slots.find(s=>s.slot==='conditions');assert.ok(condition.hardMax>=marker.length);assert.equal(slots.reduce((n,s)=>n+s.hardMax,0),780);
    assert.ok(C.inspect('有用的分析。',c).issues.some(i=>i.code==='missing-evidence-marker'));const out=decode(c,[paragraph('conditions',marker)]);assert.deepEqual(out.issues,[]);assert.ok(!C.inspect(out.text,c).issues.some(i=>i.code==='missing-evidence-marker'));assert.equal(C.inspect(out.text,c).factsVerified,false);
  }
});
test('仅绑定新行文标准才阻止元叙述，不静默删原文且提供段落定位',()=>{
  const source='项目现状明确。\n本节聚焦市场分析，为后续决策提供参考。';
  assert.equal(C.inspect(source,base()).status,'passed');const q=C.inspect(source,bound());assert.equal(q.status,'blocked');const issue=q.issues.find(i=>i.code==='writing-metanarration');assert.equal(issue.paragraph,2);assert.equal(issue.repairable,true);assert.equal(issue.severity,'error');assert.match(issue.message,/第2段/);assert.equal(q.factsVerified,false);
  assert.equal(C.inspect('装修差异影响可比性，不能直接照搬可比项目租金。',bound()).status,'passed');
});
test('新结构提示词不夹带旧四段固定写法，缺口与业务限制仍明确',()=>{
  const p=C.structuredPrompt(bound('客群需求'));assert.match(p,/需求和产品匹配/);assert.match(p,/同一职责槽可连续输出最多3个paragraph/);assert.match(p,/共同使用该槽hardMax总预算/);assert.doesNotMatch(p,/finding用一至两句|evidence最多选|decision只写下一项/);assert.match(p,/required=true事实与决策限制须在完整小节保留/);assert.match(p,/不得写已财务可行/);assert.match(p,/不因证据片段有限断言原件不存在/);
  assert.match(C.structuredPrompt(base()),/finding用一至两句/);
});
test('依据清单职责不能被风格覆盖，仍只有references单段协议',()=>{
  const c=bound('编制依据');assert.deepEqual(C.outputSlots(c),[{slot:'references',target:600,hardMax:780}]);assert.match(C.structuredPrompt(c),/本节仅用references槽/);assert.doesNotMatch(C.structuredPrompt(c),/最多3个paragraph/);
  const doubled=decode(c,[paragraph('references','《第一文件》'),paragraph('references','《第二文件》')]);assert.ok(doubled.issues.some(i=>i.code==='structured-slot-duplicate'));
  assert.throws(()=>C.normalize({...base(),writingStandard:{context:{profileId:'basis'}}}),/不能改变/);
});
test('非法行文配置不能静默降级，真实项目类型与依据标记从合同取值',()=>{
  const c=C.normalize({...base('项目概况','sale'),writingStandard:{context:{basis:true,projectType:'rent'}}});assert.equal(c.writingStandard.context.basis,false);assert.equal(c.writingStandard.context.projectType,'sale');
  for(const binding of [{config:{version:'old'}},{context:{title:'a'.repeat(501)}},{context:{arbitrary:true}},{context:{profileId:'unknown'}},{config:{globalInstructions:''}}])assert.throws(()=>C.normalize({...base(),writingStandard:binding}));
});
test('表格冻结、原值与程序文字预算保护不因行文升级失效',async()=>{
  const html='<table><tr><th>项目</th><th>值</th></tr><tr><td>净现值</td><td>-500万元</td></tr></table>',source='<figure><h4>指标标题</h4>'+html+'<p>测算口径尚待确认。</p></figure>';
  const frozen=await C.bindFrozenTables(bound('财务评价'),source,'[系统测试]writing-v1'),c=await C.bindProgramProse(frozen,source),budget=C.programProseBudget(c),slots=C.outputSlots(c);
  assert.equal(slots.reduce((n,s)=>n+s.hardMax,0)+budget.reservedCharacters,780);assert.deepEqual(c.frozenTables.tables.map(t=>t.html),[html]);
  const out=decode(c,[paragraph('conditions','口径待确认。'),{kind:'table-ref',id:c.frozenTables.tables[0].id}]);assert.deepEqual(out.issues,[]);assert.ok(out.text.includes(html));assert.ok(!C.inspect(out.text,c).issues.some(i=>i.code.startsWith('frozen-table-')));
  const missing=decode(c,[paragraph('operating','保留业务事实。')]);assert.ok(missing.issues.some(i=>i.code==='structured-table-ref-missing'));
});
test('浏览器缺依赖明确阻止新合同，加载依赖后真实检查可用，旧稿仍兼容',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../report-completion-contract.js'),'utf8'),context);assert.equal(context.ReportCompletionContract.inspect('旧正文',base()).status,'passed');assert.throws(()=>context.ReportCompletionContract.normalize(bound()),/模块未加载/);
  vm.runInNewContext(fs.readFileSync(require.resolve('../report-writing-standard.js'),'utf8'),context);const json=JSON.stringify(bound());assert.equal(vm.runInNewContext('ReportCompletionContract.inspect("本节聚焦市场分析。",'+json+').status',context),'blocked');
});

const primary='【待补：有效可比房源租金。】',other='【待补：实际合作期限。】';
const reference={gapId:'gap-reference',ownerSection:'第一章 / 合作期限',text:'合作期限尚未确认，详见合作期限；本节涉及该事项的判断暂不作确定性结论。',critical:true};
function gaps(extra={}){return {version:C.GAP_REQUIREMENTS_VERSION,registryHash:'registry-v1',sourceRevision:'source-v1',primaryMarkers:[primary],references:[reference],forbiddenMarkers:[other],...extra};}
test('缺口主说明和跨节限制绑定同一固定预算，身份变更使合同指纹变化',()=>{
  const c=C.normalize({...bound(),gapRequirements:gaps()}),slots=C.outputSlots(c),budget=C.programProseBudget(c);assert.equal(c.requiredMarkers.length,1);assert.deepEqual(c.requiredMarkers,[primary]);assert.equal(budget.gapCharacters,primary.length+reference.text.length);assert.equal(slots.reduce((n,s)=>n+s.hardMax,0)+budget.reservedCharacters,780);assert.deepEqual(C.normalize(c),c);assert.equal(base().gapRequirements,undefined);
  assert.notEqual(C.fingerprint(c),C.fingerprint(C.normalize({...c,gapRequirements:gaps({sourceRevision:'source-v2'})})));assert.match(C.structuredPrompt(c),/forbiddenMarkers的完整红字由其他小节承担/);
  const output=decode(c,[paragraph('conditions','核验前不能形成确定性判断。'+primary+'；'+reference.text)]);assert.deepEqual(output.issues,[]);const q=C.inspect(output.text,c);assert.equal(q.status,'unverified');assert.equal(q.factsVerified,false);assert.equal(q.issues.filter(i=>i.severity==='error').length,0);
});
test('缺口不能靠省略、重复、表内旧文字或隐藏注释过关，不自动删除原文',()=>{
  const c=C.normalize({...bound(),gapRequirements:gaps()});
  for(const text of [primary,reference.text,primary+primary+reference.text,primary+'<!--'+reference.text+'-->',primary+'<table><tr><td>'+reference.text+'</td></tr></table>']){
    const q=C.inspect(text,c);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>['gap-primary-count','gap-reference-count'].includes(i.code)));assert.equal(q.factsVerified,false);
  }
  const repeat=primary+reference.text+other;assert.ok(C.inspect(repeat,c).issues.some(i=>i.code==='gap-duplicate-primary'));assert.equal(repeat,primary+reference.text+other);
  const tableRepeat=primary+reference.text+'<table><tr><td>'+primary+'</td></tr></table>';assert.ok(C.inspect(tableRepeat,c).issues.some(i=>i.code==='gap-primary-count'));
});
test('缺口超预算、损坏版本、矛盾归属或依据目录中混入限制均前置拒绝',()=>{
  for(const g of [gaps({version:'unknown'}),gaps({primaryMarkers:[primary,primary]}),gaps({registryHash:''}),gaps({references:[reference,reference]}),gaps({references:[{...reference,ownerSection:''}]}),gaps({references:[{...reference,text:'<script>test</script>'}]}),gaps({forbiddenMarkers:[primary]}),gaps({references:[{...reference,text:'条'.repeat(701)}]})])assert.throws(()=>C.normalize({...bound(),gapRequirements:g}));
  assert.throws(()=>C.normalize({...bound('编制依据'),gapRequirements:gaps()}));assert.throws(()=>C.normalize({...bound(),requiredMarkers:[other],gapRequirements:gaps()}),/主位置冲突/);
});
test('未核验不等于缺失，主位置允许非红色短说明而不生成待补清单',()=>{
  const text='合作期限尚待核验；当前项目判断受该条件限制。',c=C.normalize({...bound(),gapRequirements:gaps({primaryMarkers:[],references:[{...reference,ownerSection:bound().sectionKey,text}],forbiddenMarkers:[]})});
  assert.equal(c.requiredMarkers,undefined);assert.deepEqual(c.gapRequirements.primaryMarkers,[]);const q=C.inspect(text,c);assert.equal(q.status,'unverified');assert.equal(q.issues.filter(i=>i.severity==='error').length,0);assert.equal(q.factsVerified,false);assert.equal(C.inspect('没有核验说明。',c).status,'blocked');
});
test('缺口与程序注入文字共同预留，超固定总预算不扩大预算或丢条件',async()=>{
  const c=C.normalize({...bound(),gapRequirements:gaps()}),html='<table><tr><th>指标</th><th>数值</th></tr><tr><td>规模</td><td>1</td></tr></table>',source='<figure><h4>'+('标题'.repeat(345))+'</h4>'+html+'</figure>';
  const frozen=await C.bindFrozenTables(c,source,'[系统测试]gaps');await assert.rejects(()=>C.bindProgramProse(frozen,source),/必要缺口已占满固定正文预算/);
});
