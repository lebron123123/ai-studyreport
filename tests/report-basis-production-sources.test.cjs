'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../report-argument.js'),C=require('../report-completion-contract.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const entry=source.slice(source.indexOf('async function reportBasisMaterialItems('),source.indexOf('function reportBasisGroupOptions('));
const key='项目总论 / 编制依据与编制说明';
const basisContract=(sectionKey=key,requiredHeadings=[])=>C.normalize({version:C.VERSION,planId:'[系统测试]classified',sectionKey,requirements:{basis:true},requiredHeadings});
function fixture(){
  const material={fileId:'[系统测试]请示',title:'项目投资请示.docx',content:'根据《关于加快发展保障性租赁住房的意见》（国办发〔2021〕22号）和《深圳市保障性租赁住房项目认定办法（试行）》开展。依照《深圳市安居集团有限公司市场化住房租赁项目拓展管理办法（试行）》审核。'};
  const box={ReportArgument:A,ReportCompletionContract:C,kbEntries:[material],projectWorkflow:{reportCompletion:{basisCatalogs:{}}},reportCompletionPlan:()=>({sections:[{sectionKey:key,requirements:{basis:true}},{sectionKey:'政策 / 政策依据',requirements:{basis:true}}]})};
  box.window=box;vm.createContext(box);vm.runInContext(entry,box);return {box,material};
}
test('生产依据入口读取实际材料内部国家、市级、集团引用，而非仅列附件，不读取旧正文',async()=>{
  const {box,material}=fixture(),before=JSON.stringify(material);
  box.chapters=[{content:'旧AI生成《中华人民共和国民法典》'}];
  const catalog=await box.reportBasisCatalogFor(basisContract());
  assert.equal(catalog.items.length,4);assert.equal(catalog.items.filter(x=>x.status==='cited').length,3);
  assert.ok(!catalog.items.some(x=>x.title.includes('民法典')));
  assert.deepEqual(A.basisCoverage(catalog).levels.filter(x=>x.count).map(x=>x.key),['national','city','group','project']);
  assert.ok(catalog.items.every(x=>x.status!=='verified'&&!x.groups));
  assert.equal(JSON.stringify(material),before);
  assert.equal((await box.reportBasisCatalogFor(basisContract('政策 / 政策依据'))).items.length,0);
});
test('人工目录、分类和核验记录原样保留，其他小节归属不可重复获取',async()=>{
  const {box}=fixture(),catalog=await box.reportBasisCatalogFor(basisContract());
  const {classification,...original}=catalog.items[1],chosen={...original,groups:[{level:3,text:'政策文件依据'}]};
  box.projectWorkflow.reportCompletion.basisCatalogs[key]={items:[chosen]};
  const before=JSON.stringify(box.projectWorkflow),saved=await box.reportBasisCatalogFor(basisContract());
  assert.deepEqual(JSON.parse(JSON.stringify(saved.items)),[chosen]);saved.items[0].title='不会写回';
  assert.equal(JSON.stringify(box.projectWorkflow),before);
  assert.equal((await box.reportBasisMaterialCatalog('政策 / 政策依据')).items.length,0);
  box.projectWorkflow.reportCompletion.basisCatalogs['政策 / 政策依据']={items:[chosen]};
  await assert.rejects(box.reportBasisMaterialCatalog(key),/多个小节/);
});
test('生成前重新定位材料引用，移除、改名、源版本变化均不沿用旧凭据',async()=>{
  for(const change of ['removed','renamed','changed']){
    const {box}=fixture(),catalog=await box.reportBasisCatalogFor(basisContract());
    const contract=await C.bindBasisCatalog(C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}]).sections[0],catalog,'[系统测试]');
    await box.reportVerifyBasisMaterials(contract);
    if(change==='removed')box.kbEntries=[];
    if(change==='renamed')contract.basisCatalog.items[1].title='原文并不存在的政策意见';
    if(change==='changed')box.kbEntries[0].content+=' 新增原文';
    await assert.rejects(box.reportVerifyBasisMaterials(contract),/已移除、版本变化|摘要不匹配/);
  }
});
test('空材料可诊断但不伪造依据；缺少读取模块明确失败，不悄悄退回只列附件',async()=>{
  const {box}=fixture();box.kbEntries=[];
  assert.equal((await box.reportBasisMaterialCatalog(key)).items.length,0);
  box.ReportArgument=null;await assert.rejects(box.reportBasisMaterialCatalog(key),/模块未加载/);
});

test('实际依据可用绑定建议分类展示，未知状态保留；旧无状态条目和摘要篡改仍阻挡',async()=>{
  const {box}=fixture(),base=basisContract(key,[{level:3,text:'政策文件依据'}]),catalog=await box.reportBasisCatalogFor(base);
  const before=JSON.stringify(box.projectWorkflow),contract=await C.bindBasisCatalog(base,catalog,'[系统测试]');
  await box.reportVerifyBasisMaterials(contract);
  assert.ok(contract.basisCatalog.items.every(item=>item.classification));
  assert.ok(contract.basisCatalog.items.some(item=>item.classification.status==='unknown'));
  assert.ok(contract.basisCatalog.items.some(item=>item.classification.status==='suggested'));
  assert.ok(contract.basisCatalog.items.every(item=>item.status!=='verified'&&!item.groups));
  const legacy={...catalog,items:catalog.items.map(({classification,...item})=>item)};
  await assert.rejects(box.reportVerifyBasisMaterials(await C.bindBasisCatalog(base,legacy,'[系统测试]旧目录')),/未绑定分类状态/);
  contract.basisCatalog.items[0].classification.reason='被另行改动';
  await assert.rejects(box.reportVerifyBasisMaterials(contract),/摘要不匹配/);
  assert.equal(JSON.stringify(box.projectWorkflow),before);
});
