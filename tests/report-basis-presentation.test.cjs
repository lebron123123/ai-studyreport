const test=require('node:test'),assert=require('node:assert/strict');
require('../scripts/windows-browser-lockout-guard.cjs');
const A=require('../report-argument.js'),C=require('../report-completion-contract.js');
const key='项目总论 / 编制依据与编制说明';
const contract=(headings=[])=>({sectionKey:key,requirements:{basis:true},requiredHeadings:headings});
const item=(title,extras={})=>({title,documentNo:'',issuer:'',date:'',status:'received',ownerKey:key,required:true,evidence:{sourceId:'actual-'+title,sourceHash:'a'.repeat(64),locator:'实际原件文件名：'+title},verification:{by:'',at:'',note:''},...extras});
const catalog=items=>({sectionKey:key,items,diagnostics:[],coverage:'unconfirmed'});
const typed=()=>contract([{level:3,text:'编制依据'},{level:4,text:'法律法规层面'},{level:4,text:'政策文件层面'},{level:4,text:'技术标准与规范层面'},{level:4,text:'项目专项依据'},{level:3,text:'编制说明'}]);
const immutable=row=>{const {classification,...rest}=row;return rest;};

test('旧无分类目录完整兼容：仅新增建议，不改真实名称、来源、核验、顺序或输入',()=>{
  const input=catalog([item('某项目合作协议.docx'),item('深圳市保障性租赁住房项目认定办法（试行）'),item('未知资料摘录')]),before=JSON.stringify(input),out=A.basisPresentation(input,typed());
  assert.equal(JSON.stringify(input),before);assert.notEqual(out,input);assert.deepEqual(out.items.map(immutable),input.items);
  assert.equal(out.classificationVersion,A.BASIS_CLASSIFICATION_VERSION);assert.ok(out.items.every(row=>!row.groups&&row.status==='received'));
  assert.deepEqual(out.items.map(row=>row.classification.status),['suggested','suggested','unknown']);
  assert.deepEqual(out.items[0].classification.groups,[{level:3,text:'编制依据'},{level:4,text:'项目专项依据'}]);
  assert.deepEqual(out.items[1].classification.groups,[{level:3,text:'编制依据'},{level:4,text:'政策文件层面'},{level:5,text:'市级层面依据'}]);
  assert.match(out.items[2].classification.reason,/不足以确认/);assert.equal(out.items[2].classification.groups.length,0);
});

test('文种与地域分开：市/集团/国家税务局项目文件不误作政策、法律或集团制度',()=>{
  const titles=['国家税务局合作房源项目投资请示.doc','深圳市安居集团项目研究报告.pdf','龙岗区盈信大楼合作协议（草案） - 修订.docx','附件一：合作房源清单.xlsx'];
  const rows=A.basisPresentation(catalog(titles.map(title=>item(title))),typed()).items;
  for(const row of rows){assert.equal(row.classification.level,'project');assert.equal(row.classification.status,'suggested');assert.equal(row.classification.groups.at(-1).text,'项目专项依据');}
});

test('只有通用编制依据的旧龙岗目录保留7真实条目，建议分类不空铺国家/集团文件',()=>{
  const titles=['附件2.龙岗布吉盈信大楼改造保障性住房项目研究报告.pdf','律师改-【20260824】深圳市盈信利科技有限公司和龙岗安居协议.docx','中华人民共和国民法典','龙岗区言成盈信大楼非居改保项目委托运营服务协议','关于既有非居住房屋改建保障性租赁住房的通知','物业交付标准清单','深圳市盈信利科技有限公司、深圳市龙岗安居有限公司房屋租赁及委托运营管理协议'];
  const input=catalog(titles.map((title,index)=>item(title,{status:index<2?'received':'cited'}))),out=A.basisPresentation(input,contract([{level:3,text:'编制依据'},{level:3,text:'编制说明'}]));
  assert.equal(out.items.length,7);assert.deepEqual(out.items.map(immutable),input.items);assert.ok(out.items.every(row=>row.classification.status==='suggested'));
  assert.ok(out.items.every(row=>row.classification.groups[0].text==='编制依据'&&row.classification.groups.length===2));
  assert.equal(out.items[2].classification.groups[1].text,'国家层面依据');assert.equal(out.items[4].classification.groups[1].text,'政策文件依据（层级待核验）');
  assert.ok(!out.items.some(row=>row.classification.groups.some(group=>/集团|编制说明/.test(group.text))));
});

test('明确材料引用的国家层级可追溯建议；文号、机关、日期和verified仍不自动补齐',async()=>{
  const input=await A.basisCatalog([{id:'actual-proposal',fileName:'投资立项请示.doc',content:'依据《关于加快发展保障性租赁住房的意见》（国办发〔2021〕22号）。'}],{sectionKey:key});
  const out=A.basisPresentation(input,typed()),row=out.items.find(x=>x.title==='关于加快发展保障性租赁住房的意见');
  assert.equal(row.classification.level,'national');assert.equal(row.classification.method,'explicit-citation');assert.equal(row.classification.groups.at(-1).text,'国家层面依据');
  assert.equal(row.status,'cited');assert.equal(row.documentNo,'');assert.equal(row.issuer,'');assert.equal(row.date,'');assert.equal(row.verification.by,'');
  assert.match(row.evidence.locator,/第1行，字符/);assert.deepEqual(out.items.map(immutable),input.items);
  assert.deepEqual(out.classificationDiagnostics.find(x=>x.title===row.title).evidence,row.evidence);
});

test('不把辖域未知当文种未知，也不把地域线索当可确认文种',()=>{
  const rows=A.basisPresentation(catalog([item('住房租赁管理办法'),item('深圳市现有资料')]),typed()).items;
  assert.equal(rows[0].classification.status,'suggested');assert.equal(rows[0].classification.level,'unclassified');assert.equal(rows[0].classification.groups.at(-1).text,'政策文件层面');
  assert.equal(rows[1].classification.status,'unknown');assert.equal(rows[1].classification.level,'city');assert.deepEqual(rows[1].classification.groups,[]);
});

test('原人工groups和旧group均优先且不伪造自动确认；旧自动字段不与人工路径并存',()=>{
  const manual=item('项目协议.docx',{groups:[{level:3,text:'人工登记专项依据'}],classification:{status:'suggested',groups:[{level:3,text:'旧建议'}]}}),legacy=item('实际政策办法',{group:'人工地方依据',level:3});
  const input=catalog([manual,legacy]),out=A.basisPresentation(input,typed());
  const {classification,...withoutOldSuggestion}=manual;
  assert.deepEqual(out.items,[withoutOldSuggestion,legacy]);assert.equal(out.classificationDiagnostics.length,0);assert.ok(manual.classification);
});

test('没有原件或引用锚不得制造可追溯建议，仍保留原条目待补',()=>{
  const input=catalog([item('中华人民共和国民法典',{status:'unlocated',evidence:{sourceId:'',sourceHash:'',locator:''}}),item('项目合作协议',{evidence:{sourceId:'actual',sourceHash:'a'.repeat(64),locator:''}})]);
  const out=A.basisPresentation(input,typed());assert.deepEqual(out.items.map(immutable),input.items);
  assert.ok(out.items.every(row=>row.classification.status==='unknown'&&!row.classification.groups.length));assert.ok(out.items.every(row=>/缺少完整可定位/.test(row.classification.reason)));
});

test('分类不唯一或没有匹配职责时保守未知，不猜测上级或归入编制说明',()=>{
  const input=catalog([item('中华人民共和国民法典')]);
  for(const headings of [[{level:3,text:'政策文件层面'}],[{level:3,text:'国家层面依据甲'},{level:3,text:'国家层面依据乙'}],[{level:3,text:'编制说明'}]]){
    const out=A.basisPresentation(input,contract(headings));assert.equal(out.items[0].classification.status,'unknown');assert.deepEqual(out.items[0].classification.groups,[]);
  }
});

test('混合目录缺法律类时，真实国家法律沿用唯一明确的国家分类而非丢入未知',()=>{
  const headings=[{level:3,text:'编制依据'},{level:4,text:'项目专属依据'},{level:4,text:'国家层面依据'},{level:4,text:'政策文件依据（层级待核验）'}];
  const input=catalog([item('中华人民共和国民法典',{status:'cited'}),item('关于既有非居住房屋改建保障性租赁住房的通知',{status:'cited'}),item('物业交付标准清单')]),before=JSON.stringify(input);
  const out=A.basisPresentation(input,contract(headings));
  assert.equal(out.items[0].classification.status,'suggested');assert.equal(out.items[0].classification.level,'national');
  assert.deepEqual(out.items[0].classification.groups,[{level:3,text:'编制依据'},{level:4,text:'国家层面依据'}]);
  assert.equal(out.items[1].classification.level,'unclassified');assert.equal(out.items[1].classification.groups.at(-1).text,'政策文件依据（层级待核验）');
  assert.equal(out.items[2].classification.groups.at(-1).text,'项目专属依据');
  assert.deepEqual(out.items.map(immutable),input.items);assert.equal(JSON.stringify(input),before);
  assert.deepEqual(A.basisPresentation(out,contract(headings)),out);
  for(const row of out.items){assert.equal(row.documentNo,'');assert.equal(row.issuer,'');assert.equal(row.date,'');assert.notEqual(row.status,'verified');}
});

test('混合目录已有法律类优先；法律类歧义时不得借国家分类绕过',()=>{
  const input=catalog([item('中华人民共和国民法典')]),base=[{level:3,text:'编制依据'},{level:4,text:'国家层面依据'},{level:4,text:'政策文件依据（层级待核验）'}];
  const one=A.basisPresentation(input,contract([...base,{level:4,text:'法律法规依据'}]));
  assert.equal(one.items[0].classification.groups.at(-1).text,'法律法规依据');
  const ambiguous=A.basisPresentation(input,contract([...base,{level:4,text:'法律法规依据甲'},{level:4,text:'法律法规依据乙'}]));
  assert.equal(ambiguous.items[0].classification.status,'unknown');assert.deepEqual(ambiguous.items[0].classification.groups,[]);
});

test('混合目录仅国家回退：无国家、多个国家、政策内国家及未定位法律均保持未知',()=>{
  const title='中华人民共和国民法典',base=[{level:3,text:'编制依据'},{level:4,text:'政策文件依据（层级待核验）'}];
  const cases=[base,[...base,{level:4,text:'国家层面依据甲'},{level:4,text:'国家层面依据乙'}],[...base,{level:5,text:'国家层面依据'}],[...base,{level:4,text:'市级层面依据'}]];
  for(const headings of cases){const row=A.basisPresentation(catalog([item(title)]),contract(headings)).items[0];assert.equal(row.classification.status,'unknown');assert.deepEqual(row.classification.groups,[]);}
  const unlocated=A.basisPresentation(catalog([item(title,{status:'unlocated'})]),contract([...base,{level:4,text:'国家层面依据'}])).items[0];
  assert.equal(unlocated.classification.status,'unknown');assert.deepEqual(unlocated.classification.groups,[]);
  const unknownLaw=A.basisPresentation(catalog([item('住房租赁条例')]),contract([...base,{level:4,text:'国家层面依据'}])).items[0];
  assert.equal(unknownLaw.classification.level,'unclassified');assert.equal(unknownLaw.classification.status,'unknown');assert.deepEqual(unknownLaw.classification.groups,[]);
});

test('空目录始终为空，未知分类无补造依据；重复调用稳定且不污染来源目录',()=>{
  assert.equal(A.basisPresentation(catalog([]),typed()).items.length,0);
  const input=catalog([item('无明确文种的材料')]),first=A.basisPresentation(input,typed()),second=A.basisPresentation(first,typed());
  assert.deepEqual(second,first);assert.equal(second.items.length,1);assert.deepEqual(second.items[0].classification.groups,[]);
});

test('建议只能绑定同一依据合同，拒绝跨小节与不安全职责标题',()=>{
  const input=catalog([item('项目协议')]);
  assert.throws(()=>A.basisPresentation(input,{sectionKey:key,requirements:{basis:false}}),/同一依据小节/);
  assert.throws(()=>A.basisPresentation(input,contract([{level:3,text:'<script>指令</script>'}])) ,/有效的职责标题/);
  assert.throws(()=>A.basisPresentation(input,{...typed(),sectionKey:'其他 / 依据'}),/同一依据小节/);
});

test('原目录生成保持无groups旧契约：建议仅在显式展示准备时加入',async()=>{
  const input=await A.basisCatalog([{id:'real-agreement',fileName:'项目合作协议.docx',content:'真实材料'}],{sectionKey:key});
  assert.ok(input.items.every(row=>!row.groups&&!row.classification));
  const first=A.basisPresentation(input,typed());assert.ok(first.items[0].classification);assert.equal(input.items[0].classification,undefined);
  const plan=C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}]).sections[0],bound=await C.bindBasisCatalog(plan,first,'isolated-basis-presentation');
  assert.equal(bound.basisCatalog.items[0].classification.status,'suggested');assert.deepEqual(await C.verifyBasisCatalog(bound),bound);
  const rendered=C.decodeStructured(JSON.stringify({blocks:bound.basisCatalog.items.map(row=>({kind:'basis-ref',id:row.id}))}),bound);
  assert.deepEqual(rendered.issues,[]);assert.match(rendered.text,/分类建议.*待核验/);assert.match(rendered.text,/项目合作协议.docx/);
});
