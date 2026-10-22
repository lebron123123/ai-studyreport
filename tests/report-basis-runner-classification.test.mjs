import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../report-completion-contract.js';
import B from '../report-business-structure.js';
import A from '../report-argument.js';
import {BASIS_CLASSIFICATION_VERSION,classifyBasisCatalog,remapBasisReferences} from '../scripts/report-full-generation-runner.mjs';

const sectionKey='项目总论 / 编制依据与编制说明';
const chapters=[{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}];
const source='### 编制依据\n#### 法律法规层面\n#### 政策文件层面\n#### 技术标准与规范层面\n#### 项目专项依据\n### 编制说明';
const base=(text=source)=>C.createPlan(chapters,{structures:{[sectionKey]:B.resolve({chapterName:'项目总论',sectionTitle:'编制依据与编制说明',currentSource:text})},budgets:{[sectionKey]:{proseTarget:1600,proseMax:2080,reason:'真实标题与证据状态重放，不含历史正文'}}}).sections[0];
const policyPath=[{level:3,text:'编制依据'},{level:4,text:'政策文件层面'}];
const projectPath=[{level:3,text:'编制依据'},{level:4,text:'项目专项依据'}];
const titles=[
  '【参考】市税务局第一批合作房源改造为保障性租赁住房项目合作协议（草案） - 修订.doc',
  '2、关于罗湖公司申请市税务局第一批合作房源改造为保租房项目投资立项的请示.doc',
  '附件3：市税务局第一批合作房源改造为保障性租赁住房项目可行性研究报告.pdf',
  '附件一：合作房源清单.xlsx',
  '保障性租赁住房项目合作框架协议','委托协议书',
  '深圳市保障性租赁住房项目认定办法（试行）',
  '深圳市保障性租赁住房项目认定办法（征求意见稿）',
  '深圳市安居集团有限公司市场化住房租赁项目拓展管理办法（试行）',
  '关于加快发展保障性租赁住房的意见',
];
const levelOf=i=>i<6?'project':i<8?'city':i===8?'group':'national';
const makeCatalog=()=>({sectionKey,items:titles.map((title,i)=>({title,documentNo:'',issuer:'',date:'',ownerKey:sectionKey,required:true,status:i<4?'received':'cited',evidence:{sourceId:'actual-material-'+i,sourceHash:(i+1).toString(16).repeat(64).slice(0,64),locator:'原始资料文本定位 '+i},verification:{}}))});
const coverageOf=catalog=>({levels:['project','city','group','national'].map(key=>({key,items:catalog.items.filter((x,i)=>levelOf(i)===key)}))});
const refs=c=>JSON.stringify({blocks:c.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))});
const evidenceOnly=item=>{const {id,ordinal,groups,group,level,...rest}=item;return rest;};
const assertIndependentMissingCategories=text=>{
  for(const category of ['法律法规层面','技术标准与规范层面']){
    assert.ok(text.includes('【待补：编制依据 / '+category+'尚未登记可引用依据文件】'));
    assert.ok(!C.headingOutline(text).some(x=>x.text===category));
  }
  assert.equal((text.match(/尚未登记可引用依据文件/g)||[]).length,2);
};

test('实际十个依据标题按文种再按政策地域绑定，项目保持原路径，真实法律/技术缺口保留',async()=>{
  const catalog=makeCatalog(),before=structuredClone(catalog),contract=base();
  const result=classifyBasisCatalog({contract,catalog,coverage:coverageOf(catalog)});
  assert.equal(result.version,BASIS_CLASSIFICATION_VERSION);assert.deepEqual(result.diagnostics,[]);
  for(let i=0;i<6;i++)assert.deepEqual(result.items[i].groups,projectPath);
  for(let i=6;i<10;i++)assert.deepEqual(result.items[i].groups,[...policyPath,{level:5,text:i<8?'市级层面依据':i===8?'集团层面依据':'国家层面依据'}]);
  assert.deepEqual(result.items.map(evidenceOnly),catalog.items);assert.deepEqual(catalog,before);
  const bound=await C.bindBasisCatalog(contract,{items:result.items},'classification-replay'),out=C.decodeStructured(refs(bound),bound);
  assert.deepEqual(out.issues,[]);assertIndependentMissingCategories(out.text);
  assert.doesNotMatch(out.text,/#### 政策文件层面\n\n【待补|### 编制说明/);
  assert.equal((out.text.match(/《/g)||[]).length,10);
  assert.deepEqual(C.headingOutline(out.text).filter(x=>x.level===5).map(x=>x.text),['市级层面依据','集团层面依据','国家层面依据']);
  const quality=C.inspect(out.text,bound);assert.equal(quality.status,'unverified');assert.ok(!quality.issues.some(x=>x.severity==='error'));assert.equal(quality.factsVerified,false);
  assert.equal(bound.basisCatalog.items.filter(x=>x.status==='received').length,4);assert.equal(bound.basisCatalog.items.filter(x=>x.status==='cited').length,6);
});

test('生产分类建议完整保留真实十项文件与接收引用状态，不冒充人工目录或已核验',async()=>{
  const catalog=makeCatalog(),before=structuredClone(catalog),contract=base();
  const presentation=A.basisPresentation(catalog,contract);
  assert.deepEqual(catalog,before);assert.equal(presentation.items.length,10);
  assert.ok(presentation.items.every(x=>x.classification.status==='suggested'&&!x.groups));
  const bound=await C.bindBasisCatalog(contract,presentation,'production-suggestion-replay'),out=C.decodeStructured(refs(bound),bound),quality=C.inspect(out.text,bound);
  assert.deepEqual(out.issues,[]);assertIndependentMissingCategories(out.text);
  for(const item of catalog.items){assert.equal(out.text.split('《'+item.title+'》').length-1,1);}
  assert.equal((out.text.match(/分类建议：[^\n]*（待核验）/g)||[]).length,10);
  assert.equal(bound.basisCatalog.items.filter(x=>x.status==='received').length,4);
  assert.equal(bound.basisCatalog.items.filter(x=>x.status==='cited').length,6);
  assert.equal(quality.status,'unverified');assert.equal(quality.factsVerified,false);
  assert.ok(quality.issues.some(x=>x.code==='basis-classification-unconfirmed'));
  assert.ok(!quality.issues.some(x=>x.severity==='error'));
});

test('地域不代表文种；未明确资料仍由程序待确认，真实法律技术可路由但不虚构元数据',async()=>{
  const original=makeCatalog().items[0],catalog={sectionKey,items:[
    {...original,title:'深圳市项目背景资料'},
    {...original,title:'中华人民共和国民法典',evidence:{...original.evidence,sourceId:'law'}},
    {...original,title:'建筑防火设计规范 GB 50016',evidence:{...original.evidence,sourceId:'standard'}},
  ]};
  const result=classifyBasisCatalog({contract:base(),catalog,coverage:{levels:[{key:'city',items:catalog.items}]}});
  assert.equal(result.items[0].groups,undefined);assert.equal(result.diagnostics.length,1);
  assert.deepEqual(result.items[1].groups,[{level:3,text:'编制依据'},{level:4,text:'法律法规层面'}]);
  assert.deepEqual(result.items[2].groups,[{level:3,text:'编制依据'},{level:4,text:'技术标准与规范层面'}]);
  const bound=await C.bindBasisCatalog(base(),{items:result.items},'unknown-not-law'),out=C.decodeStructured(refs(bound),bound),q=C.inspect(out.text,bound);
  assert.match(out.text,/### 未登记分类的依据文件/);assert.ok(q.issues.some(x=>x.code==='basis-classification-unconfirmed'));assert.ok(result.items.every(x=>x.issuer===''&&x.date===''&&x.status==='received'));
});

test('既有明确人工分类不暗改，只有显式重分自动分类才替换；既有政策层级不重复创建',()=>{
  const catalog=makeCatalog();catalog.items[6].groups=[{level:3,text:'人工确认政策目录'}];
  const retained=classifyBasisCatalog({contract:base(),catalog,coverage:coverageOf(catalog)});
  assert.deepEqual(retained.items[6].groups,catalog.items[6].groups);
  const replaced=classifyBasisCatalog({contract:base(),catalog,coverage:coverageOf(catalog),replaceGroups:true});
  assert.deepEqual(replaced.items[6].groups,[...policyPath,{level:5,text:'市级层面依据'}]);
  const nested=base(source.replace('#### 政策文件层面','#### 政策文件层面\n##### 市级政策依据'));
  assert.deepEqual(classifyBasisCatalog({contract:nested,catalog:makeCatalog(),coverage:coverageOf(catalog)}).items[6].groups,[...policyPath,{level:5,text:'市级政策依据'}]);
});

test('纯地域依据目录仍按已接受目录走；相同文种的分歧目录不任意选第一项',()=>{
  const catalog=makeCatalog(),regional=base('### 国家层面依据\n### 市区层面依据\n### 集团层面依据\n### 项目专属依据');
  const out=classifyBasisCatalog({contract:regional,catalog,coverage:coverageOf(catalog)});
  assert.deepEqual(out.items[6].groups,[{level:3,text:'市区层面依据'}]);assert.deepEqual(out.items[0].groups,[{level:3,text:'项目专属依据'}]);
  const ambiguous=base('### 政策依据A\n### 政策依据B\n### 项目专属依据');
  const fail=classifyBasisCatalog({contract:ambiguous,catalog,coverage:coverageOf(catalog)});
  assert.equal(fail.items[6].groups,undefined);assert.ok(fail.diagnostics.some(x=>x.title===catalog.items[6].title));
});

async function migrationFixture(){
  const catalog=makeCatalog(),previousItems=catalog.items.map((item,i)=>({...item,groups:i<6?projectPath:[{level:3,text:levelOf(i)==='city'?'市级':levelOf(i)==='group'?'集团':'国家'}]}));
  const previousContract=await C.bindBasisCatalog(base(),{items:previousItems},'before-classification');
  const nextItems=classifyBasisCatalog({contract:base(),catalog:{sectionKey,items:previousItems},coverage:coverageOf(catalog),replaceGroups:true}).items;
  const nextContract=await C.bindBasisCatalog(base(),{items:nextItems},'after-classification');
  return {catalog,previousContract,nextContract,raw:refs(previousContract)};
}
test('原十项basis-ref可在证据完全不变时仅重映射ID重渲染，不生成/修改原始回执',async()=>{
  const fixture=await migrationFixture(),before=structuredClone(fixture),raw=await remapBasisReferences(fixture);
  assert.deepEqual(fixture,before);assert.notEqual(raw,fixture.raw);
  assert.deepEqual(fixture.previousContract.basisCatalog.items.map(evidenceOnly),fixture.nextContract.basisCatalog.items.map(evidenceOnly));
  const out=C.decodeStructured(raw,fixture.nextContract);assert.deepEqual(out.issues,[]);assert.ok(!C.inspect(out.text,fixture.nextContract).issues.some(x=>x.severity==='error'));
  assertIndependentMissingCategories(out.text);
});

test('来源、locator、状态、条数或原引用改变即拒绝确定性迁移，不能借迁移修复AI遗漏',async()=>{
  const fixture=await migrationFixture();
  for(const change of [item=>item.status='unlocated',item=>item.evidence.sourceHash='f'.repeat(64),item=>item.evidence.locator='另一处',item=>item.title+='新增']){
    const items=fixture.nextContract.basisCatalog.items.map(evidenceOnly);change(items[0]);
    const nextContract=await C.bindBasisCatalog(base(),{items},'changed-evidence');
    await assert.rejects(remapBasisReferences({...fixture,nextContract}),/changed|ambiguous/);
  }
  for(const blocks of [[],JSON.parse(fixture.raw).blocks.slice().reverse(),[JSON.parse(fixture.raw).blocks[0],JSON.parse(fixture.raw).blocks[0]],[{kind:'basis-ref',id:'unknown'}],[{kind:'paragraph',text:'新增内容'}]])await assert.rejects(remapBasisReferences({...fixture,raw:JSON.stringify({blocks})}));
  await assert.rejects(remapBasisReferences({...fixture,nextContract:{...fixture.nextContract,sectionKey:'其他 / 依据'}}));
  const tampered=structuredClone(fixture.nextContract);tampered.basisCatalog.items[0].evidence.locator='篡改';await assert.rejects(remapBasisReferences({...fixture,nextContract:tampered}));
  const less=await C.bindBasisCatalog(base(),{items:fixture.catalog.items.slice(1)},'less');await assert.rejects(remapBasisReferences({...fixture,nextContract:less}));
});
