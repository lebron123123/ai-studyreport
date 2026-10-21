'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const key='项目总论 / 编制依据与编制说明',version='basis-classification-20261010-v1';
const categories=['国家层面依据','市区层面依据','集团层面依据','项目专属依据'];
const base=(headings=categories.map(text=>({level:3,text})))=>C.normalize({...C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}],{budgets:{[key]:{proseTarget:1600,proseMax:2080,reason:'分类契约固定验收预算'}}}).sections[0],requiredHeadings:headings});
const file=(title,overrides={})=>({title,status:'received',ownerKey:key,evidence:{sourceId:'material-'+title,sourceHash:'a'.repeat(64),locator:'原件标题'},verification:{},...overrides});
const suggestion=(text,overrides={})=>({version,status:'suggested',level:'project',method:'material-title',reason:'按实际文件标题中的项目协议文种建议，归属待核验',groups:[{level:3,text}],...overrides});
const refs=c=>JSON.stringify({blocks:c.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))});
const has=(q,code)=>q.issues.some(x=>x.code===code);

test('真实目录的分类建议归一化、摘要绑定且逐项标待核验，不冒充人工groups或原件核验',async()=>{
  const raw=file('项目合作协议',{classification:suggestion(categories[3])}),before=JSON.stringify(raw),c=await C.bindBasisCatalog(base(),{items:[raw]},'[系统测试]suggestion');
  assert.equal(JSON.stringify(raw),before);assert.equal(c.basisCatalog.items[0].groups,undefined);assert.deepEqual(c.basisCatalog.items[0].classification,raw.classification);
  assert.equal(c.basisCatalog.items[0].status,'received');assert.deepEqual(c.basisCatalog.items[0].verification,{by:'',at:'',note:''});
  assert.deepEqual(await C.verifyBasisCatalog(c,{items:[raw]}),c);
  const decoded=C.decodeStructured(refs(c),c),q=C.inspect(decoded.text,c);
  assert.deepEqual(decoded.issues,[]);assert.deepEqual(C.headingOutline(decoded.text),[{level:3,text:categories[3]}]);
  assert.match(decoded.text,/分类建议：项目专属依据（待核验）/);assert.match(decoded.text,/状态：已接收，待核验/);assert.ok(!decoded.text.includes(raw.classification.reason));
  assert.ok(has(q,'basis-classification-unconfirmed'));assert.equal(q.status,'unverified');assert.equal(q.factsVerified,false);assert.ok(!q.issues.some(x=>x.severity==='error'));
  assert.ok(!decoded.text.includes('material-'));assert.ok(!decoded.text.includes('原件标题'));assert.ok(!decoded.text.includes('已确认分类'));
  for(const category of categories.slice(0,3))assert.ok(decoded.text.includes('【待补：'+category+'尚未登记可引用依据文件】'));
  const changed=structuredClone(c);changed.basisCatalog.items[0].classification.reason='另一分类规则';await assert.rejects(C.verifyBasisCatalog(changed),/摘要/);
  await assert.rejects(C.verifyBasisCatalog(c,{items:[{...raw,classification:suggestion(categories[0])}]}),/不一致/);
});

test('分类建议与辖域判断独立：未明辖域的真实政策文种可建议，已知city而不明文种仍待分类',async()=>{
  const c=await C.bindBasisCatalog(base([]),{items:[
    file('住房租赁管理办法',{classification:suggestion('政策文件依据',{level:'unclassified'})}),
    file('深圳市现有资料',{classification:suggestion('',{status:'unknown',level:'city',reason:'标题有明确地域但不能确定文种及目录职责',groups:[]})}),
  ]},'[系统测试]unknown');
  const out=C.decodeStructured(refs(c),c);assert.deepEqual(out.issues,[]);assert.deepEqual(C.headingOutline(out.text),[{level:3,text:'政策文件依据'},{level:3,text:'未登记分类的依据文件'}]);
  assert.match(out.text,/分类未确定，待核验/);assert.ok(!C.inspect(out.text,c).issues.some(x=>x.severity==='error'));
});

test('人工已登记分类不混自动状态；旧目录与unknown混排不遗漏任何真实文件，空分类不生成业务标题',async()=>{
  const c=await C.bindBasisCatalog(base(),{items:[
    file('旧目录未分类文件'),
    file('实际人工登记项目协议',{groups:[{level:3,text:categories[3]}]}),
    file('待明确资料',{classification:suggestion('',{status:'unknown',level:'unclassified',reason:'实际标题不能确定依据目录归属',groups:[]})}),
  ]},'[系统测试]mixed');
  const out=C.decodeStructured(refs(c),c);assert.equal(c.basisCatalog.items[1].classification,undefined);assert.deepEqual(c.basisCatalog.items[1].groups,[{level:3,text:categories[3]}]);
  for(const item of c.basisCatalog.items)assert.equal(out.text.split('《'+item.title+'》').length-1,1);
  assert.deepEqual(C.headingOutline(out.text),[{level:3,text:categories[3]},{level:3,text:'未登记分类的依据文件'}]);assert.ok(!C.inspect(out.text,c).issues.some(x=>x.severity==='error'));
  const unknownOnly=await C.bindBasisCatalog(base([]),{items:[file('前置旧文件'),file('后置未分类',{classification:suggestion('',{status:'unknown',groups:[],reason:'文种归属不明确'})})]},'[系统测试]mixed-legacy');
  const oldOut=C.decodeStructured(refs(unknownOnly),unknownOnly);assert.match(oldOut.text,/《前置旧文件》/);assert.match(oldOut.text,/《后置未分类》/);assert.ok(!C.inspect(oldOut.text,unknownOnly).issues.some(x=>x.severity==='error'));
});

test('未定位建议、非法字段、伪核验状态、人工与自动冲突、主动标记拒绝；模型不能改建议归属',async()=>{
  for(const classification of [
    suggestion(categories[3],{verified:true}),suggestion(categories[3],{status:'verified'}),suggestion(categories[3],{level:'invented'}),suggestion(categories[3],{version:'old'}),
    suggestion(categories[3],{reason:'<script>执行</script>'}),suggestion(categories[3],{groups:[{level:4,text:'猜测父级'}]}),suggestion(categories[3],{groups:[]}),
    suggestion(categories[3],{status:'unknown'}),suggestion(categories[3],{reason:'甲'.repeat(501)}),
  ])await assert.rejects(C.bindBasisCatalog(base(),{items:[file('实际文件',{classification})]},'[系统测试]bad'));
  await assert.rejects(C.bindBasisCatalog(base(),{items:[file('人工目录',{groups:[{level:3,text:categories[3]}],classification:suggestion(categories[3])})]},'[系统测试]conflict'));
  await assert.rejects(C.bindBasisCatalog(base(),{items:[file('原件未定位',{status:'unlocated',evidence:{},classification:suggestion(categories[3])})]},'[系统测试]unlocated'));
  const c=await C.bindBasisCatalog(base(),{items:[file('实际文件',{classification:suggestion(categories[3])})]},'[系统测试]guard'),text=C.decodeStructured(refs(c),c).text;
  assert.equal(C.inspect(text.replace('（待核验）','（已确认）'),c).status,'blocked');assert.equal(C.inspect(text.replace('### 项目专属依据','### 国家层面依据'),c).status,'blocked');
  const injected=C.decodeStructured(JSON.stringify({blocks:[{kind:'basis-ref',id:c.basisCatalog.items[0].id,classification:suggestion(categories[0])}]}),c);assert.ok(has(injected,'structured-extra-fields'));
});

test('部分空嵌套分类只显示独立完整路径缺口，保留有真实文件的父子标题，普通主题门禁仍有效',async()=>{
  const headings=[{level:3,text:'地方依据'},{level:4,text:'深圳市依据'},{level:4,text:'罗湖区依据'},{level:3,text:'集团层面依据'}],c=await C.bindBasisCatalog(base(headings),{items:[file('深圳市住房租赁文件',{classification:suggestion('地方依据',{level:'city',groups:headings.slice(0,2)})})]},'[系统测试]nested');
  const out=C.decodeStructured(refs(c),c);assert.deepEqual(C.headingOutline(out.text),headings.slice(0,2));assert.match(out.text,/【待补：地方依据 \/ 罗湖区依据尚未登记可引用依据文件】/);assert.match(out.text,/【待补：集团层面依据尚未登记可引用依据文件】/);assert.ok(!C.inspect(out.text,c).issues.some(x=>x.severity==='error'));
  const ordinary=C.normalize({...C.createPlan([{name:'运营',sections:[{t:'管理方案'}]}]).sections[0],requiredHeadings:[{level:3,text:'组织分工'}]});assert.ok(has(C.inspect('实际正文但没有标题。',ordinary),'heading-structure-missing'));
});
