const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const make=type=>C.createPlan([{name:'运营方案',sections:[{t:'运营管理'}]}],{projectType:type}).sections[0];
test('多类型：标题进入结构化协议，删标题的返修不再通过，标题与正文共用硬预算',()=>{
  for(const type of ['rent','sale','gaibao','gaibao-commercial']){
    const c=C.normalize({...make(type),requiredHeadings:[{level:3,text:'收楼安排'},{level:4,text:'合同约定'},{level:3,text:'运营职责'}]});
    const blocks=[{kind:'heading',slot:'finding',level:3,text:'收楼安排'},{kind:'paragraph',slot:'finding',text:'按已签署条款执行。'},{kind:'heading',slot:'finding',level:4,text:'合同约定'},{kind:'paragraph',slot:'finding',text:'缺项须先核实。'},{kind:'heading',slot:'finding',level:3,text:'运营职责'},{kind:'paragraph',slot:'finding',text:'按责任分工落实。'}];
    const out=C.decodeStructured(JSON.stringify({blocks}),c);
    assert.deepEqual(out.issues,[]);assert.deepEqual(C.headingOutline(out.text),c.requiredHeadings);
    assert.ok(!C.inspect(out.text,c).issues.some(i=>i.code==='heading-structure-missing'));
    assert.equal(C.inspect('按已签署条款执行。',c).status,'blocked');
    assert.match(C.structuredPrompt(c),/业务结构不可压平/);assert.match(C.repairPrompt({issues:[]},c),/不能删除业务标题/);
    blocks.at(-1).text='字'.repeat(C.outputSlots(c)[0].hardMax);
    assert.ok(C.decodeStructured(JSON.stringify({blocks}),c).issues.some(i=>i.code==='structured-slot-budget'));
  }
});
test('旧稿的数字/中文/Markdown/HTML混合标题保持原顺序及下级层级，金额与表头不是标题',()=>{
  const source='### 一、收楼安排\n\n<h4>1.1.1.1 合同约定</h4>\n\n### 二、运营职责\n\n12.56万元\n\n[[TABLE]]\n|指标|值|\n|一、面积|12|\n[[/TABLE]]';
  assert.deepEqual(C.headingOutline(source),[{level:3,text:'收楼安排'},{level:4,text:'合同约定'},{level:3,text:'运营职责'}]);
  assert.deepEqual(C.headingOutline('<p>12.56万元</p>'),[]);
  assert.deepEqual(C.headingOutline('<div data-report-heading-level="5" style="font-weight:600">条件</div><div data-report-heading-level="6" style="font-weight:600">执行</div>'),[{level:3,text:'条件'},{level:4,text:'执行'}]);
});
test('空/短单主题节不凑标题；依据分类由程序保留，模型分析与非法层级仍拒收',async()=>{
  assert.deepEqual(C.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'条件尚未落实。'}]}),make('rent')).issues,[]);
  const basis=C.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]).sections[0];
  const declared=C.normalize({...basis,requiredHeadings:[{level:3,text:'国家层面依据'}]});
  const item={title:'实际登记文件',ownerKey:basis.sectionKey,status:'received',required:true,evidence:{sourceId:'basis-file',sourceHash:'a'.repeat(64),locator:'原件'},groups:[{level:3,text:'国家层面依据'}]};
  const bound=await C.bindBasisCatalog(declared,{items:[item]},'classification-snapshot'),refs=[{kind:'basis-ref',id:bound.basisCatalog.items[0].id}],output=C.decodeStructured(JSON.stringify({blocks:refs}),bound);
  assert.deepEqual(output.issues,[]);assert.deepEqual(C.headingOutline(output.text),declared.requiredHeadings);
  assert.ok(!C.inspect(output.text,bound).issues.some(i=>i.severity==='error'));
  const analysis=C.decodeStructured(JSON.stringify({blocks:[{kind:'heading',slot:'references',level:3,text:'依据分析'},...refs]}),bound);
  assert.ok(analysis.issues.some(i=>i.code==='structured-basis-catalog-only'));
  assert.equal(C.inspect(output.text+'\n\n本项目符合所有政策。',bound).status,'blocked');
  assert.throws(()=>C.normalize({...basis,requiredHeadings:[{level:4,text:'孤立下级分类'}]}),/不能跳级/);
  const invalidGroups=[
    [{level:4,text:'孤立分类'}],
    [{level:3,text:'国家层面依据'},{level:5,text:'跳级分类'}],
    [{level:3,text:'<b>错误分类</b>'}]
  ];
  for(const groups of invalidGroups)await assert.rejects(C.bindBasisCatalog(declared,{items:[{...item,groups}]},'invalid-classification'));
  for(const level of [2,7,3.5])assert.ok(C.decodeStructured(JSON.stringify({blocks:[{kind:'heading',slot:'finding',level,text:'标题'}]}),make('rent')).issues.length);
  assert.ok(C.decodeStructured(JSON.stringify({blocks:[{kind:'heading',slot:'finding',level:5,text:'跳级'}]}),make('rent')).issues.some(i=>i.code==='structured-heading-level'));
  assert.ok(C.decodeStructured(JSON.stringify({blocks:[{kind:'heading',slot:'references',level:3,text:'依据分析'}]}),basis).issues.some(i=>i.code==='structured-heading'));
});
test('V9整行加粗的编号业务分类须保留，表名、提示和金额不当分类',()=>{
  const labels=['分析口径与数据基础','区域人口与就业基础','租赁需求分层分析','客群来源与典型画像','事实、判断与行动含义'];
  const source=labels.map((text,i)=>'**'+'一二三四五'[i]+'、'+text+'**').join('\n\n');
  const expected=labels.map(text=>({level:3,text}));
  assert.deepEqual(C.headingOutline(source),expected);
  assert.deepEqual(C.headingOutline('**一、需求分层**\n__（一）整租__\n**1.1.1.1.1 家庭客群**\n**二、产品匹配**'),[
    {level:3,text:'需求分层'},{level:4,text:'整租'},{level:5,text:'家庭客群'},{level:3,text:'产品匹配'}
  ]);
  for(const text of ['**住房租赁供需分层分析表**','**资料待补提示**','**12.56万元**','**一、请核实事实。**','**一、《协议.docx》**','- **一、名单**','|**一、金额**|12|'])assert.deepEqual(C.headingOutline(text),[],text);
  const contract=C.normalize({...make('gaibao'),requiredHeadings:expected});
  assert.ok(C.inspect('### 人口就业基础\n需核实。',contract).issues.some(issue=>issue.code==='heading-structure-missing'));
});
test('必需主题不能仅有空标题、固定缺口或泛化核验句，具体受限原因和行动可保留',()=>{
  const c=C.normalize({...make('gaibao'),requiredHeadings:[{level:3,text:'需求分析'},{level:3,text:'行动条件'}]});
  const inspect=body=>C.inspect('### 需求分析\n'+body+'\n### 行动条件\n需先取得实际入住名单，再按家庭人数校核户型匹配。',c);
  for(const body of ['', '资料待核验，相关判断暂不作确定性结论。','尚待核验，不能作确定性结论。','待核实。请进一步核验。','【待补：需求资料】','<table><tr><td>需求</td><td>待核验</td></tr></table>'])assert.ok(inspect(body).issues.some(i=>i.code==='heading-analysis-missing'&&i.heading.text==='需求分析'),body);
  for(const body of ['现有材料只有房源清单，无法据此判断入住需求；取得入住申请台账后再分家庭规模复核。','<ul><li>先按通勤范围划分客群，取得实际申请名单后再校核产品匹配。</li></ul>'])assert.ok(!inspect(body).issues.some(i=>i.code==='heading-analysis-missing'),body);
});
test('父主题可由下级主题实际分析支撑，其他主题及未定位缺口不能填补空分类',()=>{
  const c=C.normalize({...make('gaibao'),requiredHeadings:[{level:3,text:'需求分析'},{level:4,text:'家庭客群'},{level:3,text:'行动条件'}]});
  const good='### 需求分析\n#### 家庭客群\n按家庭人数及通勤半径分类，取得申请台账后再判断对应产品规模。\n### 行动条件\n先核实房屋交付条件，再落实验收责任人。';
  assert.ok(!C.inspect(good,c).issues.some(i=>i.code==='heading-analysis-missing'));
  const bad='### 需求分析\n#### 家庭客群\n<div class="report-gap-boundaries"><p>资料核验边界（未定位到具体主题）</p><p>需要取得登记资料。</p></div>\n### 行动条件\n先核实房屋交付条件，再落实验收责任人。';
  assert.equal(C.inspect(bad,c).issues.filter(i=>i.code==='heading-analysis-missing').length,2);
});

test('同父重复业务标题必须阻止，不同父类的同名子题及独立自定义标题保留',()=>{
  const c=C.normalize({...make('gaibao'),requiredHeadings:[{level:3,text:'市场风险'},{level:4,text:'应对措施'},{level:3,text:'工程风险'},{level:4,text:'应对措施'}]});
  const good='### 市场风险\n#### 应对措施\n按需求变化核对租赁去化条件。\n### 工程风险\n#### 应对措施\n按验收条件界定施工责任。\n### 自定义分类\n另行保留项目特定业务条件。';
  assert.ok(!C.inspect(good,c).issues.some(i=>/^heading-/.test(i.code)));
  for(const body of [good+'\n### 自定义分类\n同父再次重复不能作为新增职责。',good.replace('### 工程风险','#### 应对措施\n同父再次重复不能作为新增职责。\n### 工程风险'),'<h3>市场风险</h3><h4>应对措施</h4><p>核对需求条件。</p><h4>应对措施</h4><p>核对执行责任。</p><h3>工程风险</h3><h4>应对措施</h4><p>核对工程验收。</p>']){
    const result=C.inspect(body,c);assert.ok(result.issues.some(i=>i.code==='heading-structure-duplicate'&&i.severity==='error'));assert.equal(result.status,'blocked');
  }
});

test('必需子标题必须仍属于原父类，新增父标题不能让名称层级相同的错挂子题通过',()=>{
  const c=C.normalize({...make('gaibao'),requiredHeadings:[{level:3,text:'市场风险'},{level:4,text:'应对措施'},{level:3,text:'工程风险'}]});
  const wrong='### 市场风险\n按现有需求判断风险范围。\n### 自定义分类\n#### 应对措施\n按新增业务条件处理。\n### 工程风险\n核对施工和验收边界。';
  assert.ok(C.inspect(wrong,c).issues.some(i=>i.code==='heading-structure-missing'));
  const good='### 市场风险\n#### 应对措施\n按现有需求判断执行条件。\n### 自定义分类\n保留独立业务边界。\n### 工程风险\n核对施工和验收边界。';
  assert.ok(!C.inspect(good,c).issues.some(i=>/^heading-/.test(i.code)));
  const reversed='### 工程风险\n核对验收边界。\n### 市场风险\n#### 应对措施\n按需求条件执行。';
  assert.ok(C.inspect(reversed,c).issues.some(i=>i.code==='heading-structure-missing'));
});
