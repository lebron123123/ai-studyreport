const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),B=require('../report-business-structure.js'),L=require('../report-length-plan.js');
const context={chapterName:'项目总论',sectionTitle:'项目概况',projectType:'gaibao'};
const rules=[
  {chapter:'第一章 项目总论',section:'1.2项目概况',subsection:'1.2.1项目区位',displayTitle:'1.2.1项目区位',writingLogic:'（1）旧项目面积5000平方米'},
  {chapter:'第一章 项目总论',section:'1.2项目概况',subsection:'1.2.2项目现状'},
  {chapter:'第一章 项目总论',section:'1.2项目概况',subsection:'1.2.2.1使用条件'},
  {chapter:'第一章 项目总论',section:'1.2项目概况',subsection:'1.2.3项目定位'}
];
test('新项目从发布目录的明确下级标题绑定分类，不把写作指令或旧项目事实转成分类',()=>{
  const result=B.resolve({...context,rules});
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'项目区位'},{level:3,text:'项目现状'},{level:4,text:'使用条件'},{level:3,text:'项目定位'}]);
  assert.deepEqual(Object.keys(result).sort(),['requiredHeadings','sourceHash','version']);assert.ok(!JSON.stringify(result).includes('5000'));
  assert.deepEqual(B.resolve({...context,rules:[{...rules[0],status:'draft'},{...rules[1],scenarios:['commercial_renovation']},{...rules[2],chapter:'其他章'}]}).requiredHeadings,[]);
  assert.deepEqual(B.resolve({...context,rules:[{section:'1.2项目概况',writingLogic:'1、国家政策\n2、市区政策'}]}).requiredHeadings,[]);
});
test('残缺当前稿用同项目相容历史补齐，保留自定义分类；候选与分歧历史不被采用',()=>{
  const rich='### 合同安排\n#### 权责边界\n### 运营职责';
  const result=B.resolve({...context,currentSource:'### 合同安排',history:[{id:'pending',status:'candidate',source:'### 捏造主题'},{id:'recent',source:'### 合同安排'},{id:'old-accepted',source:rich},{id:'divergent',source:'### 合同安排\n### 无关旧方案\n### 其他\n### 分歧'}]});
  assert.deepEqual(result.requiredHeadings,C.headingOutline(rich));
  const changed=B.resolve({...context,currentSource:'### 新业务边界',history:[{id:'old',source:rich}]});
  assert.deepEqual(changed.requiredHeadings,[{level:3,text:'新业务边界'}]);
  assert.equal(B.resolve({...context,currentSource:'没有业务标题的简短内容。'}).requiredHeadings.length,0);
  assert.equal(result.sourceHash,B.resolve({...context,currentSource:rich+'\n已确认面积100平方米。',history:[{id:'new-save',source:rich}]}).sourceHash);
});

test('更丰富历史必须保留标题层级与父路径，不能把原子题升格或移到其他父类',()=>{
  const currentSource='### 市场风险\n#### 应对措施',expected=C.headingOutline(currentSource);
  for(const source of ['### 市场风险\n### 应对措施\n### 工程风险','### 市场风险\n### 工程风险\n#### 应对措施']){
    assert.deepEqual(B.resolve({...context,currentSource,history:[{status:'accepted',source}]}).requiredHeadings,expected);
  }
  const rich='### 市场风险\n#### 应对措施\n#### 实施条件\n### 工程风险\n#### 应对措施';
  assert.deepEqual(B.resolve({...context,currentSource,history:[{status:'accepted',source:rich}]}).requiredHeadings,C.headingOutline(rich));
});

test('缺失发布节点按同父公共锚点插入，保留自定义节点及其孩子的原顺序',()=>{
  const entry=(number,text)=>({chapter:'项目总论',section:'1.2项目概况',subsection:number+' '+text});
  const currentSource='### 自定义前置\n### 区位条件\n#### 既有核查\n#### 权责条件\n### 物业条件\n### 自定义尾项';
  const published=[entry('1.2.1','区位条件'),entry('1.2.1.1','既有核查'),entry('1.2.1.2','资料边界'),entry('1.2.1.3','权责条件'),entry('1.2.2','交通条件'),entry('1.2.3','物业条件'),entry('1.2.4','交付条件')];
  const result=B.resolve({...context,currentSource,rules:published});
  assert.deepEqual(result.requiredHeadings,C.headingOutline('### 自定义前置\n### 区位条件\n#### 既有核查\n#### 资料边界\n#### 权责条件\n### 交通条件\n### 物业条件\n### 自定义尾项\n### 交付条件'));
  assert.equal(currentSource,'### 自定义前置\n### 区位条件\n#### 既有核查\n#### 权责条件\n### 物业条件\n### 自定义尾项');
});

test('当前与发布的共同兄弟相互逆序时明确阻止，不静默重排或删除分类',()=>{
  const entry=(number,text)=>({chapter:'项目总论',section:'1.2项目概况',subsection:number+' '+text});
  const currentSource='### 物业条件\n### 区位条件\n### 自定义分类';
  assert.throws(()=>B.resolve({...context,currentSource,rules:[entry('1.2.1','区位条件'),entry('1.2.2','交通条件'),entry('1.2.3','物业条件')]}),/业务标题顺序冲突/);
  const nested='### 市场风险\n#### 应对措施\n#### 实施条件';
  assert.throws(()=>B.resolve({...context,currentSource:nested,rules:[entry('1.2.1','市场风险'),entry('1.2.1.1','实施条件'),entry('1.2.1.2','应对措施')]}),/业务标题顺序冲突/);
});

test('相同结构键的历史和发布标题只补结构，不覆盖当前原名或宽松合并近义分类',()=>{
  const currentSource='### 核心客群：职住平衡家庭',entry=(number,text)=>({chapter:'项目总论',section:'1.2项目概况',subsection:number+' '+text});
  const result=B.resolve({...context,currentSource,history:[{source:'### 核心客群职住平衡家庭\n#### 产品匹配'}],rules:[entry('1.2.1','核心客群职住平衡家庭'),entry('1.2.1.1','产品匹配'),entry('1.2.2','机会客群')]});
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'核心客群：职住平衡家庭'},{level:4,text:'产品匹配'},{level:3,text:'机会客群'}]);
  assert.deepEqual(B.resolve({...context,currentSource:'### 区域人口与就业基础',rules:[entry('1.2.1','人口就业基础')]}).requiredHeadings,[{level:3,text:'区域人口与就业基础'},{level:3,text:'人口就业基础'}]);
});

test('真实页面结构入口透传历史接受状态，旧无状态版本仍兼容且不改版本原件',()=>{
  const source=fs.readFileSync(require.resolve('../report.js'),'utf8'),start=source.indexOf('function reportBusinessStructureBinding('),end=source.indexOf('\nfunction reportBusinessHeadings(',start);
  assert.ok(start>=0&&end>start);
  const chapter={name:context.chapterName},section={t:context.sectionTitle,content:''};
  const invoke=flags=>{
    const version={id:'history',...flags,chapters:[{name:chapter.name,sections:[{t:section.t,content:'### 历史分类'}]}]},before=JSON.stringify(version);
    const box=vm.createContext({window:{ReportBusinessStructure:B,ReportLogicCore:{match:()=>[]}},ReportBusinessStructure:B,projectWorkflow:{reportVersions:[version]},rlProjectType:()=>context.projectType,rlProjectText:()=>'',rlBusinessScenario:()=>'',chapter,section});
    vm.runInContext(source.slice(start,end),box);
    const result=JSON.parse(JSON.stringify(vm.runInContext('reportBusinessStructureBinding(chapter,section)',box)));
    assert.equal(JSON.stringify(version),before);return result.requiredHeadings;
  };
  for(const flags of [{status:'candidate'},{status:'pending'},{status:'rejected'},{accepted:false}])assert.deepEqual(invoke(flags),[]);
  for(const flags of [{},{status:'accepted',accepted:true}])assert.deepEqual(invoke(flags),[{level:3,text:'历史分类'}]);
});
test('依据旧稿中的结论建议和程序未分类容器不冻结为分类，可恢复本项目已接受分类',()=>{
  const basis={...context,sectionTitle:'编制依据与编制说明'},categories=['国家层面依据','市区层面依据','集团层面依据','项目专属依据'];
  const current='<h3>1.1.1 结论</h3>【待补：本分类尚未登记可引用依据文件】<h3>1.1.2 建议</h3>【待补：本分类尚未登记可引用依据文件】<h3>1.1.3 未登记分类的依据文件</h3>《本项目协议》';
  const old=categories.map(text=>'### '+text).join('\n'),options={...basis,currentSource:current,history:[{id:'rejected',status:'rejected',source:'### 未经确认的其他分类'},{id:'v9',status:'accepted',source:old+'\n旧项目事实不能搬入结构合同。'}]};
  const result=B.resolve(options);assert.deepEqual(result.requiredHeadings,categories.map(text=>({level:3,text})));assert.equal(result.version,B.VERSION);
  assert.ok(!JSON.stringify(result).includes('旧项目事实'));assert.ok(!JSON.stringify(result).includes('待补'));assert.equal(options.currentSource,current);
  assert.deepEqual(B.resolve({...basis,currentSource:current}).requiredHeadings,[]);
  assert.deepEqual(B.resolve({...basis,currentSource:'### 结论性文件\n### 建议文件\n### 人工确认的合同依据'}).requiredHeadings.map(x=>x.text),['结论性文件','建议文件','人工确认的合同依据']);
});
test('依据发布目录排除重复父题与通用职责，保留明确下级分类和自定义嵌套',()=>{
  const basis={...context,sectionTitle:'编制依据与编制说明'},entry=text=>({chapter:'第一章 项目总论',section:'1.1编制依据与编制说明',status:'published',subsection:text});
  const result=B.resolve({...basis,rules:[entry('1.1.1编制依据与编制说明'),entry('1.1.2结论'),entry('1.1.3国家层面依据'),entry('1.1.4市区层面依据'),entry('1.1.4.1已确认市级规范')]});
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'国家层面依据'},{level:3,text:'市区层面依据'},{level:4,text:'已确认市级规范'}]);
  for(const projectType of ['rent','sale','gaibao','gaibao-commercial'])assert.deepEqual(B.resolve({...basis,projectType,currentSource:'### 建议',history:[{source:'### 国家依据\n### 项目依据'}]}).requiredHeadings,[{level:3,text:'国家依据'},{level:3,text:'项目依据'}]);
  const ordinary=B.resolve({...context,currentSource:'### 结论\n### 建议\n### 未登记分类的依据文件'});assert.equal(ordinary.version,B.VERSION);assert.equal(ordinary.requiredHeadings.length,3);
});
test('普通节单一发布包装标题不重复父题，历史真正下级标题仍独立恢复',()=>{
  // Heading metadata only: these four wrappers reproduce the affected
  // section positions without importing any report facts into a fixture.
  for(const [number,sectionTitle] of [['5.1','客群定位'],['6.1','改造实施计划及效果'],['8.1','投资估算'],['11.5','政策风险']]){
    const options={projectType:'gaibao',chapterName:'业务章',sectionTitle,rules:[{status:'published',projectType:'gaibao',chapter:'业务章',section:number+sectionTitle,subsection:number+'.1 1. '+sectionTitle}]};
    assert.deepEqual(B.resolve(options).requiredHeadings,[],sectionTitle+'不应强制重复父标题');
    const history='### 1. '+sectionTitle+'\n#### 实施范围\n#### 主要限制';
    assert.deepEqual(B.resolve({...options,history:[{id:'accepted-v9',source:history}]}).requiredHeadings,[{level:3,text:'实施范围'},{level:3,text:'主要限制'}]);
    assert.equal(options.rules[0].subsection,number+'.1 1. '+sectionTitle,'只读目录不得被归一化回写');
  }
});
test('普通节发布目录保留多业务子题、真实嵌套及结论建议，不因过滤包装而清空分类',()=>{
  const entry=(number,text)=>({status:'published',projectType:'gaibao',chapter:'业务章',section:'8.1投资估算',subsection:number+text});
  const options={projectType:'gaibao',chapterName:'业务章',sectionTitle:'投资估算',rules:[entry('8.1.1','投资估算范围'),entry('8.1.2','结论'),entry('8.1.2.1','适用条件'),entry('8.1.3','建议')]};
  assert.deepEqual(B.resolve(options).requiredHeadings,[{level:3,text:'投资估算范围'},{level:3,text:'结论'},{level:4,text:'适用条件'},{level:3,text:'建议'}]);
  assert.deepEqual(B.resolve({...options,rules:[entry('8.1.1','投资估算范围')]}).requiredHeadings,[{level:3,text:'投资估算范围'}]);
});
test('待补整段与写作过程标题不冻结为业务分类，正文和缺口提示原件不改',()=>{
  const source='### 本节业务问题与论证路径\n#### 需求基础\n### 分析路径\n### 客群分析框架与数据口径\n### 产品定位的分析框架与业务问题\n### 交付检查与待补事项\n### 【待补：投资测算、合作方资信调查】\n### 结论\n### 建议\n### 租金取值口径\n### 分析路径选择对收益的影响\n### 待补资料对决策的约束';
  const options={...context,currentSource:source},result=B.resolve(options);
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'需求基础'},{level:3,text:'结论'},{level:3,text:'建议'},{level:3,text:'租金取值口径'},{level:3,text:'分析路径选择对收益的影响'},{level:3,text:'待补资料对决策的约束'}]);
  assert.equal(options.currentSource,source);assert.ok(source.includes('【待补：投资测算、合作方资信调查】'));
  assert.equal(result.version,'business-structure-v2');
  const entry=(number,text)=>({status:'published',chapter:'项目总论',section:'1.2项目概况',subsection:number+' '+text});
  assert.deepEqual(B.resolve({...context,rules:[entry('1.2.1','交付检查'),entry('1.2.2','【待补：产权证明】'),entry('1.2.3','合作责任')]}).requiredHeadings,[{level:3,text:'合作责任'}]);
});
test('连续父子同名只要求一次并提升有效孩子，不误删不同父类的同名子题',()=>{
  const source='### 供需态势综合判断\n#### 供需态势综合判断\n##### 判断条件\n### 市场风险\n#### 应对措施\n### 工程风险\n#### 应对措施\n### 结论\n#### 分析路径\n##### 决策建议';
  const result=B.resolve({...context,currentSource:source});
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'供需态势综合判断'},{level:4,text:'判断条件'},{level:3,text:'市场风险'},{level:4,text:'应对措施'},{level:3,text:'工程风险'},{level:4,text:'应对措施'},{level:3,text:'结论'},{level:4,text:'决策建议'}]);
  const history=B.resolve({...context,currentSource:'### 供需态势综合判断',history:[{id:'accepted',source}]});
  assert.deepEqual(history.requiredHeadings,result.requiredHeadings);
  const entry=(number,text)=>({status:'published',chapter:'项目总论',section:'1.2项目概况',subsection:number+' '+text});
  assert.deepEqual(B.resolve({...context,rules:[entry('1.2.1','市场风险'),entry('1.2.1.1','市场风险'),entry('1.2.1.1.1','应对措施'),entry('1.2.2','工程风险'),entry('1.2.2.1','应对措施')]}).requiredHeadings,[{level:3,text:'市场风险'},{level:4,text:'应对措施'},{level:3,text:'工程风险'},{level:4,text:'应对措施'}]);
});
test('真实V9格式的父章、小节、中文分类混排可从V12式损坏标题恢复，保留原分类顺序层级',()=>{
  // Heading-only replay of the existing read-only 2026-10-09 tax project
  // snapshot; no historical facts or claimed document verification migrate.
  const old='一、项目总论\n\n1.1 编制依据与编制说明\n\n1.1.1 编制依据\n\n（一）法律法规层面\n\n（二）政策文件层面\n\n（三）技术标准与规范层面\n\n（四）项目专项依据\n\n1.1.2 编制说明';
  const result=B.resolve({...context,sectionTitle:'编制依据与编制说明',currentSource:'### 结论\n### 建议\n### 未登记分类的依据文件',history:[{id:'v9',source:old}]});
  assert.deepEqual(result.requiredHeadings,[{level:3,text:'编制依据'},{level:4,text:'法律法规层面'},{level:4,text:'政策文件层面'},{level:4,text:'技术标准与规范层面'},{level:4,text:'项目专项依据'}]);
  assert.deepEqual(C.normalize(C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}],{structures:{'项目总论 / 编制依据与编制说明':result}}).sections[0]).requiredHeadings,result.requiredHeadings);
});
test('V9整行加粗单级数字标题恢复业务分类，不改历史正文；等价HTML保持同一结构身份',()=>{
  const labels=['区位与交通条件','物业本体条件','改造实施条件'],source=labels.map((text,i)=>'**'+(i+1)+'. '+text+'**\n\n已收到资料另行核验。').join('\n\n');
  const options={...context,sectionTitle:'项目条件',currentSource:source},result=B.resolve(options),expected=labels.map(text=>({level:3,text}));
  assert.deepEqual(result.requiredHeadings,expected);assert.equal(options.currentSource,source);
  for(const html of [labels.map((t,i)=>'<p><strong>'+(i+1)+'. '+t+'</strong></p>').join(''),labels.map((t,i)=>'<div style="font-weight:700">'+(i+1)+'. '+t+'</div>').join('')]){
    const other=B.resolve({...options,currentSource:html});assert.deepEqual(other.requiredHeadings,expected);assert.equal(other.sourceHash,result.sourceHash);
  }
  assert.deepEqual(B.resolve({...options,currentSource:'### 区位与交通条件',history:[{id:'accepted-v9',source}]}).requiredHeadings,expected);
});
test('加粗中文分类、多级编号及下级层级与Markdown和HTML等价，依据排除规则不变',()=>{
  const source='**一、市场风险**\n__（一）需求条件__\n**1.1.1.1.1 应对措施**\n**二、工程风险**\n**（一）实施条件**',html='<p><strong>一、市场风险</strong></p><p><b>（一）需求条件</b></p><p><strong>1.1.1.1.1 应对措施</strong></p><p><strong>二、工程风险</strong></p><p><b>（一）实施条件</b></p>';
  const expected=[{level:3,text:'市场风险'},{level:4,text:'需求条件'},{level:5,text:'应对措施'},{level:3,text:'工程风险'},{level:4,text:'实施条件'}];
  for(const currentSource of [source,html])assert.deepEqual(B.resolve({...context,currentSource}).requiredHeadings,expected);
  for(const currentSource of ['**1.1.1 项目条件**\n**1.1.1.1 实施范围**','<p><b>1.1.1 项目条件</b></p><p><b>1.1.1.1 实施范围</b></p>'])assert.deepEqual(B.resolve({...context,currentSource}).requiredHeadings,[{level:3,text:'项目条件'},{level:4,text:'实施范围'}]);
  for(const currentSource of ['**1. 编制依据**\n**（一）国家层面依据**\n**2. 编制说明**\n**3. 结论**\n**4. 项目专属依据**','<p><strong>1. 编制依据</strong></p><p><strong>（一）国家层面依据</strong></p><p><strong>2. 编制说明</strong></p><p><strong>3. 结论</strong></p><p><strong>4. 项目专属依据</strong></p>'])assert.deepEqual(B.resolve({...context,sectionTitle:'编制依据与编制说明',currentSource}).requiredHeadings,[{level:3,text:'编制依据'},{level:4,text:'国家层面依据'},{level:3,text:'项目专属依据'}]);
});
test('加粗普通句子、金额、纯数字、文件及表格列表内容不得冻为业务标题',()=>{
  for(const currentSource of ['**1. 本项目需要核查实际条件。**','<p><strong>1. 本项目需要核查实际条件。</strong></p>','<p><b>1. 条件</b>仍需逐项核验。</p>','**1. 123**','**1.1.1 123**','<p><b>1.1.1 123</b></p>','**12.56万元**','**1. 12.56万元**','<p style="font-weight:bold">1. 12.56万元</p>','**一、《协议.docx》**','**一、附件.xlsx**','正文 **1. 物业条件** 仍需补充。','1. 普通段落并非整行加粗标题','|**1. 面积**|12|','[[TABLE]]\n**1. 面积**\n[[/TABLE]]','<table><tr><td><p><strong>1. 面积</strong></p></td></tr></table>','<ul><li><p><strong>1. 名单</strong></p></li></ul>','- **1. 名单**'])assert.deepEqual(B.resolve({...context,currentSource}).requiredHeadings,[],currentSource);
});
test('编制说明只在依据节排除为写作包装，不删旧正文或真正说明文件分类',()=>{
  const source='### 编制依据\n#### 政策文件层面\n### 编制说明\n原文保留。\n### 编制说明文件\n### 项目专属依据';
  const basis=B.resolve({...context,sectionTitle:'编制依据与编制说明',currentSource:source});
  assert.deepEqual(basis.requiredHeadings.map(x=>x.text),['编制依据','政策文件层面','编制说明文件','项目专属依据']);
  assert.ok(B.resolve({...context,currentSource:source}).requiredHeadings.some(x=>x.text==='编制说明'));
  assert.ok(source.includes('### 编制说明\n原文保留。'));
  assert.equal(B.BASIS_VERSION,'business-structure-basis-v4');
});
test('业务结构先进入计划身份，替换结构使旧计划失效，列表不承担结构合同',()=>{
  const chapters=[{name:'项目总论',sections:[{t:'项目概况'}]}],structure=B.resolve({...context,rules}),key='项目总论 / 项目概况';
  const p=C.createPlan(chapters,{structures:{[key]:structure}}),c=p.sections[0];
  assert.deepEqual(c.requiredHeadings,structure.requiredHeadings);assert.deepEqual(c.structureBinding,{version:B.VERSION,sourceHash:structure.sourceHash});
  const next=C.createPlan(chapters,{structures:{[key]:B.resolve({...context,rules:rules.slice(0,1)})}});
  assert.notEqual(p.planId,next.planId);assert.equal(C.inspect('项目位于已确认区域。',c).status,'blocked');
  assert.throws(()=>C.normalize({...c,requiredHeadings:[{level:4,text:'孤立下级'}]}),/不能跳级/);
  assert.throws(()=>C.normalize({...c,structureBinding:{...c.structureBinding,extra:'正文事实'}}),/结构绑定无效/);
});
test('普通script与CommonJS结构解析同源，无新增共享全局声明',()=>{
  const box=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../report-completion-contract.js'),'utf8'),box);vm.runInContext(fs.readFileSync(require.resolve('../report-business-structure.js'),'utf8'),box);
  assert.deepEqual(JSON.parse(JSON.stringify(box.ReportBusinessStructure.resolve({...context,rules}))),B.resolve({...context,rules}));
});
test('显式确认的新篇幅计划解除旧正文覆盖，保留表图预算；变化的旧预算必须再次确认',()=>{
  const chapters=[{name:'业务',sections:[{t:'经营判断'}]}],key='业务 / 经营判断',budgets={[key]:{proseTarget:800,proseMax:1200,tableRowsMax:35,imageMax:3,reason:'历史人工预算'}};
  const lengthPlan={...L.createPlan(chapters,{proseTotal:75000}),confirmedAt:'2026-10-08T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary(budgets).fingerprint}};
  const c=C.createPlan(chapters,{lengthPlan,budgets}).sections[0];
  assert.equal(c.requirements.proseTarget,lengthPlan.sections[0].target);assert.equal(c.requirements.proseMax,Math.ceil(lengthPlan.sections[0].target*1.3));assert.equal(c.requirements.tableRowsMax,35);assert.equal(c.requirements.imageMax,3);
  assert.throws(()=>C.createPlan(chapters,{lengthPlan,budgets:{[key]:{...budgets[key],proseTarget:900}}}),/重新确认/);
  const old={...lengthPlan};delete old.confirmedAt;
  assert.equal(C.createPlan(chapters,{lengthPlan:old,budgets}).sections[0].requirements.proseTarget,800);
});
