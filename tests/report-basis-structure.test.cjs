const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js'),B=require('../report-business-structure.js'),L=require('../report-length-plan.js');
const key='项目总论 / 编制依据与编制说明',chapters=[{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}];
const categories=['国家层面依据','市区层面依据','集团层面依据','项目专属依据'];
const rules=categories.map((text,i)=>({chapter:'第一章 项目总论',section:'1.1编制依据与编制说明',subsection:'1.1.'+(i+1)+text,status:'published'}));
const structure=(overrides={})=>B.resolve({chapterName:'项目总论',sectionTitle:'编制依据与编制说明',projectType:'gaibao',rules,...overrides});
const base=(value=structure())=>C.createPlan(chapters,{structures:{[key]:value},budgets:{[key]:{proseTarget:1200,proseMax:1560,reason:'固定依据目录验收样本'}}}).sections[0];
const file=(index,overrides={})=>({title:'实际登记文件'+index,ownerKey:key,status:'received',required:true,evidence:{sourceId:'file-'+index,sourceHash:String(index+1).repeat(64).slice(0,64),locator:'原件'},verification:{},...overrides});
const refs=c=>JSON.stringify({blocks:c.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))});
const classified=()=>categories.map((text,index)=>file(index,{groups:[{level:3,text}]}));
const has=(q,code)=>q.issues.some(x=>x.code===code);

test('新项目无旧正文，已发布分类进入计划身份，真实分类目录由程序渲染而非模型创设',async()=>{
  const c=await C.bindBasisCatalog(base(),{items:classified()},'new-project-snapshot'),out=C.decodeStructured(refs(c),c),q=C.inspect(out.text,c);
  assert.deepEqual(out.issues,[]);assert.deepEqual(C.headingOutline(out.text),categories.map(text=>({level:3,text})));
  assert.deepEqual(c.requiredHeadings,structure().requiredHeadings);assert.equal(c.structureBinding.sourceHash,structure().sourceHash);
  assert.equal(q.status,'unverified');assert.ok(!q.issues.some(x=>x.severity==='error'));assert.ok(!has(q,'basis-classification-unconfirmed'));
  assert.ok(!/适用性分析|旧项目面积|模型新增/.test(out.text));assert.ok(C.structuredPrompt(c).includes('分类建议由程序分别保留'));
  assert.notEqual(C.createPlan(chapters,{structures:{[key]:structure({rules:rules.slice(0,1)})}}).planId,C.createPlan(chapters,{structures:{[key]:structure()}}).planId);
});

test('无发布或历史标题时，仅真实目录的显式分类能够生成分类，不依赖旧正文',async()=>{
  const bare=C.createPlan(chapters).sections[0],c=await C.bindBasisCatalog(bare,{items:classified()},'catalog-only'),out=C.decodeStructured(refs(c),c);
  assert.deepEqual(C.headingOutline(out.text),categories.map(text=>({level:3,text})));assert.deepEqual(out.issues,[]);
  assert.ok(!C.inspect(out.text,c).issues.some(x=>x.severity==='error'));
});

test('当前分类残缺时恢复本项目相容历史分类，但目录元数据及文件不从旧正文迁移',async()=>{
  const old=categories.map(text=>'### '+text).join('\n')+'\n旧项目面积5000平方米。',resolved=structure({rules:[],currentSource:'### 国家层面依据',history:[{source:old,status:'accepted'}]});
  assert.deepEqual(resolved.requiredHeadings,categories.map(text=>({level:3,text})));assert.ok(!JSON.stringify(resolved).includes('5000'));
  const c=await C.bindBasisCatalog(base(resolved),{items:classified()},'own-history'),out=C.decodeStructured(refs(c),c);
  assert.ok(!out.text.includes('5000'));assert.deepEqual(C.headingOutline(out.text),resolved.requiredHeadings);assert.ok(!has(C.inspect(out.text,c),'heading-structure-missing'));
});
test('V12式结论建议污染不能继续生成依据标题，恢复V9分类后按真实登记目录渲染',async()=>{
  const damaged='### 结论\n【待补：本分类尚未登记可引用依据文件】\n### 建议\n【待补：本分类尚未登记可引用依据文件】\n### 未登记分类的依据文件\n《项目协议》';
  const resolved=structure({rules:[],currentSource:damaged,history:[{id:'v9',status:'accepted',source:categories.map(text=>'### '+text).join('\n')}]});
  const c=await C.bindBasisCatalog(base(resolved),{items:classified()},'v12-regeneration'),out=C.decodeStructured(refs(c),c),q=C.inspect(out.text,c);
  assert.deepEqual(C.headingOutline(out.text),categories.map(text=>({level:3,text})));assert.ok(!/### (?:结论|建议|未登记分类)/.test(out.text));assert.ok(!q.issues.some(x=>x.severity==='error'));
  assert.equal(c.structureBinding.version,B.VERSION);assert.equal(c.basisCatalog.items.length,4);
});

test('缺分类与缺文件不补造：保留明确分类、显示待补，未分类文件中性单列可操作提示',async()=>{
  const c=await C.bindBasisCatalog(base(),{items:[file(0)]},'unclassified'),out=C.decodeStructured(refs(c),c),q=C.inspect(out.text,c);
  assert.deepEqual(out.issues,[]);assert.deepEqual(C.headingOutline(out.text),[{level:3,text:'未登记分类的依据文件'}]);
  for(const category of categories)assert.ok(out.text.includes('【待补：'+category+'尚未登记可引用依据文件】'));
  assert.match(out.text,/### 未登记分类的依据文件\n\n《实际登记文件0》/);assert.ok(has(q,'basis-classification-unconfirmed'));assert.ok(!q.issues.some(x=>x.severity==='error'));
  assert.equal((out.text.match(/《/g)||[]).length,1);assert.ok(!/民法典|集团制度/.test(out.text));
  const empty=await C.bindBasisCatalog(base(),{items:[]},'no-files');assert.ok(has(C.inspect(C.decodeStructured('{"blocks":[]}',empty).text,empty),'basis-catalog-empty'));
});

test('旧未分类目录无业务标题保持原清单，不因文件名机关猜测分类或法定完整性',async()=>{
  const bare=C.createPlan(chapters).sections[0],c=await C.bindBasisCatalog(bare,{items:[file(0,{title:'国家政策与集团项目协议',issuer:'市级机关'})]},'legacy');
  const out=C.decodeStructured(refs(c),c);assert.deepEqual(C.headingOutline(out.text),[]);assert.equal(C.inspect(out.text,c).status,'unverified');assert.deepEqual(out.issues,[]);
});

test('group/level旧接口归一化为显式路径，允许真实嵌套；孤立层级、双字段和主动标记拒绝',async()=>{
  const bare=C.createPlan(chapters).sections[0],c=await C.bindBasisCatalog(bare,{items:[file(0,{group:'国家层面依据',level:3}),file(1,{groups:[{level:3,text:'市区层面依据'},{level:4,text:'已登记市级依据'}]})]},'nested');
  assert.deepEqual(c.basisCatalog.items[0].groups,[{level:3,text:'国家层面依据'}]);assert.equal(c.basisCatalog.items[0].group,undefined);
  assert.deepEqual(C.headingOutline(C.decodeStructured(refs(c),c).text),[{level:3,text:'国家层面依据'},{level:3,text:'市区层面依据'},{level:4,text:'已登记市级依据'}]);
  for(const invalid of [{group:'市级',level:4},{level:3},{groups:[{level:4,text:'孤立'}]},{groups:[{level:3,text:'<b>指令</b>'}]},{group:'国家',groups:[{level:3,text:'国家'}]}])await assert.rejects(C.bindBasisCatalog(bare,{items:[file(0,invalid)]},'bad'));
});

test('依据分类属于来源摘要与条目身份，分类改动必须重新绑定快照而非绕过hash',async()=>{
  const c=await C.bindBasisCatalog(base(),{items:classified()},'hash');assert.deepEqual(await C.verifyBasisCatalog(c),c);
  const changed=structuredClone(c);changed.basisCatalog.items[0].groups[0].text='其他国家分类';await assert.rejects(C.verifyBasisCatalog(changed),/摘要/);
  await assert.rejects(C.verifyBasisCatalog(c,{items:classified().map((x,i)=>i?x:{...x,groups:[{level:3,text:'其他分类'}]})}),/不一致/);
});

test('模型新增分类、自由分析、文件信息和重复引用均拒收；程序分类不能被静默改写',async()=>{
  const c=await C.bindBasisCatalog(base(),{items:classified()},'injection'),good=JSON.parse(refs(c));
  const added={blocks:[{kind:'heading',slot:'references',level:3,text:'模型虚构分类'},...good.blocks]},out=C.decodeStructured(JSON.stringify(added),c);
  assert.ok(has(out,'structured-basis-catalog-only'));assert.ok(has(C.inspect(out.text,c),'basis-catalog-content'));
  const text=C.decodeStructured(refs(c),c).text;for(const changed of [text.replace('国家层面依据','错误归属'),text+'\n\n### 未登记的新分类',text+'\n\n本项目符合所有政策。'])assert.equal(C.inspect(changed,c).status,'blocked');
});

test('资料构建只转发独立登记的分类元数据，不把kb知识标签或文件名作为依据分类',async()=>{
  const records=[{fileId:'file-0',contentHash:'a'.repeat(64),fileName:'国家文件',group:'知识标签',content:'原件文字'}];
  const unknown=await C.catalogFromMaterials(records,{sectionKey:key});assert.equal(unknown.items[0].groups,undefined);
  const known=await C.catalogFromMaterials(records,{sectionKey:key,metadataBySourceId:{'file-0':{groups:[{level:3,text:'国家层面依据'}]}}});assert.deepEqual(known.items[0].groups,[{level:3,text:'国家层面依据'}]);
  assert.equal(known.items[0].status,'received');assert.equal(known.items[0].date,'');assert.deepEqual(known.items[0].verification,{by:'',at:'',note:''});
});

test('普通业务标题与旧严格预算不受依据分类影响；仅真确认篇幅计划使用警戒模式',()=>{
  const ordinaryChapters=[{name:'运营',sections:[{t:'管理方案'}]}],ordinary=C.createPlan(ordinaryChapters).sections[0];assert.equal(ordinary.lengthPolicy,undefined);
  const selected=L.createPlan(ordinaryChapters),pending=C.createPlan(ordinaryChapters,{lengthPlan:selected}).sections[0];assert.equal(pending.lengthPolicy,undefined);
  const confirmed={...selected,confirmedAt:'2026-10-08T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}},updated=C.createPlan(ordinaryChapters,{lengthPlan:confirmed}).sections[0];assert.equal(updated.lengthPolicy,'advisory-v1');
  assert.ok(C.inspect('甲'.repeat(ordinary.requirements.proseMax+1),ordinary).issues.some(x=>x.code==='budget-proseCharacters'&&x.severity==='error'));
  assert.ok(C.inspect('甲'.repeat(updated.requirements.proseMax+1),updated).issues.some(x=>x.code==='budget-proseCharacters'&&x.severity==='warning'));
  const out=C.decodeStructured('{"blocks":[{"kind":"heading","slot":"finding","level":3,"text":"职责分工"},{"kind":"paragraph","slot":"finding","text":"按已确认责任执行。"}]}',ordinary);assert.deepEqual(out.issues,[]);assert.deepEqual(C.headingOutline(out.text),[{level:3,text:'职责分工'}]);
});

const migratedBasis='<h3>1.1.1 编制依据</h3><h4>法律法规层面</h4><p>【待补：本分类尚未登记可引用依据文件】</p><h4>政策文件层面</h4>'+['市级','集团','国家'].map((name,i)=>'<h5>'+name+'层面依据</h5><p>《实际文件'+i+'》；状态：原件待核验。</p>').join('')+'<h4>技术标准与规范层面</h4><p>【待补：本分类尚未登记可引用依据文件】</p><h4>项目专项依据</h4><p>《项目协议》</p>';
const obsoleteBasis=['市级','集团','国家'].map((name,i)=>'<h3>1.1.'+(i+2)+' '+name+'</h3><p style="margin:0"><span class="rpt-missing-placeholder">【待补：本分类尚未登记可引用依据文件】</span></p>').join('');
test('明确迁入嵌套目录的程序空根不从当前、已接受历史或发布目录重复加入',()=>{
 const current=migratedBasis+obsoleteBasis,old=current,options={rules:['市级','集团','国家'].map((name,i)=>({chapter:'项目总论',section:'1.1编制依据与编制说明',subsection:'1.1.'+(i+2)+name,status:'published'})),currentSource:current,history:[{source:old,status:'accepted'}]};
 const resolved=structure(options),labels=resolved.requiredHeadings.map(x=>x.text);
 assert.deepEqual(labels,['编制依据','法律法规层面','政策文件层面','市级层面依据','集团层面依据','国家层面依据','技术标准与规范层面','项目专项依据']);
 assert.equal(options.currentSource,current);assert.equal(options.history[0].source,old);assert.equal((current.match(/《/g)||[]).length,4);
 assert.equal(B.BASIS_VERSION,'business-structure-basis-v4');
});
test('迁移去空根不删真实缺项、不同分类或有内容的根',()=>{
 const source=migratedBasis+obsoleteBasis.replace('<h3>1.1.3 集团</h3>','<h3>1.1.3 区级</h3>')+'<h3>市级</h3><p>《独立市级文件》</p>',resolved=structure({rules:[],currentSource:source}),labels=resolved.requiredHeadings.map(x=>x.text);
 for(const name of ['法律法规层面','技术标准与规范层面','区级','市级'])assert.ok(labels.includes(name),name);
 assert.ok(!labels.includes('国家'));assert.equal(source.includes('《独立市级文件》'),true);
});
test('同名多个嵌套分类、没有文件或没有精确程序空提示时不推断迁移',()=>{
 for(const source of [migratedBasis.replace('<h5>市级层面依据</h5>','<h5>市级层面依据</h5><p>《另一文件》</p><h5>市级依据</h5>')+obsoleteBasis,migratedBasis.replace('《实际文件0》','无原件')+obsoleteBasis,migratedBasis+obsoleteBasis.replace('【待补：本分类尚未登记可引用依据文件】','尚待核验')]){
  assert.ok(structure({rules:[],currentSource:source}).requiredHeadings.some(x=>x.level===3&&x.text==='市级'));
 }
});
test('已接受来源中同名根有实质内容时保护原根，候选历史不构成迁移证据',()=>{
 const source=migratedBasis+obsoleteBasis,protectedResult=structure({rules:[],currentSource:source,history:[{status:'accepted',source:'<h3>市级</h3><p>《独立文件》</p>'}]});
 assert.ok(protectedResult.requiredHeadings.some(x=>x.level===3&&x.text==='市级'));
 const pending=structure({rules:[],currentSource:obsoleteBasis,history:[{status:'candidate',source}]});assert.deepEqual(pending.requiredHeadings.map(x=>x.text),['市级','集团','国家']);
});
test('普通业务分类不应用依据迁移规则',()=>{
 const resolved=B.resolve({chapterName:'市场分析',sectionTitle:'需求分析',currentSource:migratedBasis+obsoleteBasis,rules:[]});assert.ok(resolved.requiredHeadings.some(x=>x.level===3&&x.text==='市级'));
});
