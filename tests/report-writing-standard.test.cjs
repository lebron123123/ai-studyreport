const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../report-writing-standard.js');

test('三类项目共用可编辑行文要求，不带参考项目数字或业务口径',()=>{
  for(const projectType of ['gaibao','rent','sale']){
    const config=W.defaults();config.globalInstructions+='\n领导批准的简洁表述';config.profiles.market.instructions+='\n关注有效可比性';
    const prompt=W.prompt(config,{projectType,title:'宏观经济环境',chapter:'市场分析',writingLogic:'保留本类型业务要求'});
    assert.match(prompt,/领导批准的简洁表述/);assert.match(prompt,/关注有效可比性/);assert.match(prompt,/保留本类型业务要求/);assert.match(prompt,/不得凭文风合格宣称事实已核验/);assert.doesNotMatch(prompt,/航城|公安|6908|235|73元|38\.5/);
  }
});
test('配置往返兼容JSON且默认值互不污染',()=>{
  const a=W.defaults();a.profiles.market.instructions='修改';assert.notEqual(W.defaults().profiles.market.instructions,'修改');assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(a))),a);
  const b=W.normalize({profiles:{market:{example:''}}});assert.equal(b.profiles.market.example,'');assert.ok(b.profiles.financial.instructions);
});
test('拒绝过长、错误版本、未知字段、原型与控制字符配置，不执行配置内容',()=>{
  for(const bad of [{version:'old'},{globalInstructions:'a'.repeat(6001)},{globalInstructions:''},{profiles:{market:{instructions:'\u0000'}}},{profiles:{unknown:{}}},{profiles:{market:{example:'x'.repeat(1501)}}},JSON.parse('{"__proto__":{"admin":true}}'),{profiles:{market:{eval:'process.exit()'}}}])assert.throws(()=>W.normalize(bad));
  assert.throws(()=>W.normalize(Object.create({globalInstructions:'bad'})));assert.throws(()=>W.normalize({get globalInstructions(){throw new Error('getter executed');}}),/访问器/);
  const c=W.normalize({profiles:{market:{example:'<script>alert(1)</script>'}}});assert.equal(c.profiles.market.example,'<script>alert(1)</script>');assert.equal({}.admin,undefined);
});
test('小节按职责选择不同段落槽，不所有小节强制四段',()=>{
  const cases=[['编制依据','basis'],['项目概况','description'],['宏观经济环境','market'],['客群需求','demand'],['租金定价','pricing'],['财务评价','financial'],['风险及对策','risk'],['结论与建议','conclusion'],['实施进度','plan']];
  for(const [title,id]of cases){const p=W.sectionProfile({title});assert.equal(p.id,id);assert.equal(p.optionalSlots,true);assert.ok(p.slots.length);if(id!=='basis')assert.ok(p.slots.some(s=>s.slot==='conditions'));}
  assert.notDeepEqual(W.sectionProfile({title:'需求分析'}).slots,W.sectionProfile({title:'财务分析'}).slots);
  assert.equal(W.sectionProfile({title:'编制依据',profileId:'market'}).id,'basis');assert.equal(W.sectionProfile({title:'特殊小节',profileId:'risk'}).id,'risk');assert.throws(()=>W.sectionProfile({profileId:'arbitrary'}));
});
test('定位明显的写作介绍而不自动删改原文',()=>{
  const text='项目为现状改造。\n\n本节聚焦人口与就业，为后续客群分析提供依据。\n需求分析旨在回答三个递进问题：谁来住、为何来住、如何配置。';
  const before=text,q=W.inspect(text);assert.equal(q.status,'needs-review');assert.equal(q.issues.length,2);assert.equal(q.issues[0].paragraph,2);assert.equal(q.issues[0].line,3);assert.equal(text,before);assert.equal(q.factsVerified,false);assert.equal(q.semanticReviewed,false);
});
test('合法的业务原因、必要背景、计算依据及限制不视为论文风',()=>{
  const text='项目租金高于可比房源，主要原因是装修及配套差异。\n考虑改造工期，首年运营月份减少，导致首年收入下降。\n现有材料只说明潜在需求，尚不能认定能够全部出租。\n基于相同统计期比较供需，避免将不同时间口径直接相加。\n为后续施工提供依据，设计文件须完成审查。';
  assert.equal(W.inspect(text).status,'passed');assert.equal(W.inspect(text).factsVerified,false);assert.equal(W.inspect('').status,'unverified');
});

test('直入业务规则不被旧的自定义全篇要求取代，保持旧配置可读',()=>{
  const old={version:W.VERSION,globalInstructions:'先交代本节主要分析什么。'};
  for(const projectType of ['rent','sale','gaibao'])assert.match(W.prompt(old,{projectType,title:'分析'}),/直接成稿硬要求[\s\S]*这个小节主要是讲/);
  assert.equal(W.normalize(old).version,'report-writing-standard-v1');
});

test('识别这个小节的同义内容预告，不误删必要业务事实与限制',()=>{
  for(const text of ['这个小节主要是讲项目需求。','这个小节主要是分析市场供给。','这一章节重点在于介绍运营方案。','该小节主要对工程实施进行分析。','本节将分析项目风险。','本章围绕人口与就业展开分析。','项目为现状改造；这部分首先是说明市场变化。']){
    assert.equal(W.inspect(text).issues[0]?.code,'writing-metanarration',text);
  }
  for(const text of ['项目主要分析指标为IRR和净现值。','本节涉及的合作期限尚未确认，相关结论不能确定。','本章数据取自已登记测算，统计期尚未统一。','当月运营成本按实收租金15.7%计算。','工程支出增加导致净现金流下降。'])assert.equal(W.inspect(text).status,'passed',text);
});
test('HTML段落有源位置且表格、注释、代码不误作普通分析段',()=>{
  const text='<p>实际情况。</p>\n<table><tr><td>本节旨在说明表格字段</td></tr></table>\n<p>本节将从市场变化展开分析。</p><!--本节旨在隐藏-->\n```\n本节旨在代码示例\n```';
  const q=W.inspect(text);assert.equal(q.issues.length,1);assert.equal(q.issues[0].paragraph,2);assert.equal(q.issues[0].line,3);assert.equal(text.slice(q.issues[0].offset).startsWith('本节将从'),true);
});
test('语义复核只收定位建议，不将无问题或检查通过当事实认证',()=>{
  const source='项目租金偏高，仍需补足可比证据。\n本节聚焦需求分析。';
  const response={version:W.REVIEW_VERSION,issues:[{code:'writing-metanarration',paragraph:2,quote:'本节聚焦需求分析。',reason:'介绍写作安排',suggestion:'直接写已确认的需求及其限制'}]};
  const q=W.validateReview(JSON.stringify(response),source);assert.equal(q.valid,true);assert.equal(q.status,'needs-review');assert.equal(q.factsVerified,false);assert.equal(q.issues[0].line,2);
  const empty=W.validateReview({version:W.REVIEW_VERSION,issues:[]},source);assert.equal(empty.status,'passed');assert.equal(empty.factsVerified,false);assert.equal(empty.semanticReviewed,true);
  const prompt=W.semanticPrompt(source);assert.match(prompt,/不能补造事实/);assert.match(prompt,/待审数据/);assert.match(prompt,/paragraph/);
});
test('语义响应伪造引用、越界段号、额外字段、错误JSON均不接收',()=>{
  const source='真实原文。',good={code:'weak-analysis',paragraph:1,quote:'真实原文',reason:'仅列现状',suggestion:'核对是否需要解释影响'};
  for(const value of ['not json','```json\n{}\n```',{version:W.REVIEW_VERSION,issues:[{...good,paragraph:2}]},{version:W.REVIEW_VERSION,issues:[{...good,quote:'不存在'}]},{version:W.REVIEW_VERSION,issues:[{...good,code:'verified-fact'}]},{version:W.REVIEW_VERSION,issues:[good],factsVerified:true},{version:W.REVIEW_VERSION,issues:[good,good]},{version:'old',issues:[]}]){const q=W.validateReview(value,source);assert.equal(q.valid,false);assert.deepEqual(q.issues,[]);assert.equal(q.factsVerified,false);}
});
test('空正文复核不冒充成功；超大输入有明确边界',()=>{
  assert.equal(W.validateReview({version:W.REVIEW_VERSION,issues:[]},'').status,'unverified');assert.throws(()=>W.inspect('x'.repeat(2*1024*1024+1)),/按小节/);assert.equal(W.validateReview('x'.repeat(65537),'正文').valid,false);
});
test('普通script加载与CommonJS提供相同API，不污染其他全局',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../report-writing-standard.js'),'utf8'),context);assert.equal(context.ReportWritingStandard.VERSION,W.VERSION);assert.equal(context.ReportWritingStandard.inspect('项目事实。').status,'passed');assert.deepEqual(Object.keys(context),['ReportWritingStandard']);
});
