const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const B=require('../report-business-structure.js'),C=require('../report-completion-contract.js');
const context={projectType:'gaibao',chapterName:'市场分析',sectionTitle:'产品定位分析'};
const markdown='**产品定位表**\n\n| 定位维度 | 定位内容 | 定位依据 | 备注 |\n|---|---|---|---|\n| 产品属性 | 保障性租赁住房 | 旧政策甲 | 须核验 |\n| 定价策略 | 旧租金42.44元 | 旧项目协议 | 人工复核 |';
test('继承定性分析表的标题列名职责与真实行预算，不返回旧事实数值',()=>{
  const options={...context,history:[{id:'accepted-old',status:'accepted',source:markdown}]},result=B.tableDuties(options);
  assert.deepEqual(result.requiredTables,[{title:'产品定位表',headers:['定位维度','定位内容','定位依据','备注'],terms:[]}]);
  assert.deepEqual(result.duties,[{title:'产品定位表',headers:['定位维度','定位内容','定位依据','备注'],role:'产品定位表',rowCount:3}]);
  assert.deepEqual(result.tableShapes,{tables:1,rows:3});
  for(const fact of ['42.44','旧政策甲','旧项目协议','保障性租赁住房'])assert.ok(!JSON.stringify(result).includes(fact));
  assert.equal(options.history[0].source,markdown);
  assert.equal(result.sourceHash,B.tableDuties({...context,currentSource:markdown.replace('42.44','99.99').replace('旧政策甲','另一文件')}).sourceHash);
});
test('标准Markdown与TABLE标记免分隔线表、HTML caption及相邻标题同源',()=>{
  const table='|类别|条件|\n|甲|已具备|\n|乙|尚有约束|',expected=[{title:'实施条件比较表',headers:['类别','条件'],terms:[]}];
  const samples=['表4-1 实施条件比较表\n'+table,'[[TABLE]]\n表4-1 实施条件比较表\n'+table+'\n[[/TABLE]]','<table><caption>表4-1 实施条件比较表</caption><tr><th>类别</th><th>条件</th></tr><tr><td>甲</td><td>已具备</td></tr><tr><td>乙</td><td>尚有约束</td></tr></table>','<p>前一段说明。</p><h3>实施条件比较表</h3><table><tr><td>类别</td><td>条件</td></tr><tr><td>甲</td><td>已具备</td></tr><tr><td>乙</td><td>尚有约束</td></tr></table>'];
  const results=samples.map(currentSource=>B.tableDuties({...context,currentSource}));
  for(const result of results){assert.deepEqual(result.requiredTables,expected);assert.deepEqual(result.tableShapes,{tables:1,rows:3});assert.equal(result.sourceHash,results[0].sourceHash);}
});
test('真实V9形态允许业务表含数字观察值，排除随后四个全待补统计壳',()=>{
  const competitor='住房租赁竞品比较表\n|竞品项目|距离（km）|租金|出租率|备注|\n|---|---|---|---|---|\n|旧公寓甲|0.6|待补|待补|地图抓取，须人工调研|\n|旧公寓乙|0.7|待补|待补|地图抓取，须人工调研|';
  const shells=['散租市区历史成交租金表','集中式租赁租金表','区域出租率统计表','片区成交数据表'].map(caption=>caption+'\n|统计期|区域甲|区域乙|\n|---|---|---|\n|待补|待补：统计期|【待补：成交记录】|').join('\n\n');
  const result=B.tableDuties({...context,currentSource:competitor+'\n\n'+shells});
  assert.deepEqual(result.tableShapes,{tables:1,rows:3});assert.equal(result.requiredTables[0].title,'住房租赁竞品比较表');
  assert.ok(!JSON.stringify(result).includes('0.6'));assert.ok(!JSON.stringify(result).includes('旧公寓'));
});
test('依据、财务、程序表、无题表、全空壳、破表、代码块不继承',()=>{
  for(const source of ['|类别|条件|\n|甲|具备|','空壳比较表\n|项目|条件|\n|甲|待补|','序号条件表\n|序号|名称|条件|\n|1|甲|待补|','财务指标汇总表\n|财务指标|数值|\n|全周期总收入（万元）|21750.94|','方案比较表\n|方案|净现金流|\n|甲|10|','条件比较表\n|类别|条件|\n|甲|具备|多余|','```markdown\n'+markdown+'\n```','<table data-report-calc-table="income"><caption>经营比较表</caption><tr><th>项目</th><th>条件</th></tr><tr><td>甲</td><td>具备</td></tr></table>'])assert.equal(B.tableDuties({...context,currentSource:source}).tableShapes.tables,0,source);
  assert.equal(B.tableDuties({...context,sectionTitle:'编制依据与编制说明',currentSource:markdown}).tableShapes.tables,0);
  assert.equal(B.tableDuties({...context,basis:true,currentSource:markdown}).tableShapes.tables,0);
  assert.equal(B.tableDuties({...context,currentSource:'政策文件清单\n|文件名称|文号|发布机关|\n|旧政策|旧文号|某机关|'}).tableShapes.tables,0);
  assert.equal(B.tableDuties({...context,currentSource:'### 分析路径\n|类别|条件|\n|甲|具备|'}).tableShapes.tables,0);
});
test('同责表跨历史版本去重，资料多少不扩表；候选拒绝稿不参与',()=>{
  const options={...context,currentSource:markdown,history:[{status:'candidate',source:'候选比较表\n|项目|条件|\n|甲|具备|'},{accepted:false,source:'拒绝比较表\n|项目|条件|\n|甲|具备|'},...Array.from({length:20},(_,i)=>({id:'old-'+i,source:markdown.replace('产品定位表','表4-'+i+' 产品定位表')}))],materials:Array.from({length:100},()=>({text:'不参与预算'}))};
  assert.deepEqual(B.tableDuties(options),B.tableDuties({...context,currentSource:markdown}));
  const divergent=markdown.replace('| 定位维度 | 定位内容 | 定位依据 | 备注 |','| 维度 | 选项 | 依据 | 备注 |');
  assert.deepEqual(B.tableDuties({...context,currentSource:markdown,history:[{source:divergent}]}),B.tableDuties({...context,currentSource:markdown}));
  assert.deepEqual(B.tableDuties({...context,section:{content:markdown}}),B.tableDuties({...context,currentSource:markdown}));
});
test('独立表职责可与默认财务职责合并使用，不改变既有 resolve 接口',()=>{
  const result=B.tableDuties({...context,currentSource:markdown}),chapters=[{name:context.chapterName,sections:[{t:context.sectionTitle}]}],sectionKey=context.chapterName+' / '+context.sectionTitle;
  const defaults=C.createPlan(chapters).sections[0].requiredTables;
  const contract=C.createPlan(chapters,{requiredTables:{[sectionKey]:[...defaults,...result.requiredTables]},tableShapes:{[sectionKey]:result.tableShapes}}).sections[0];
  assert.ok(contract.requiredTables.some(x=>x.title==='产品定位表'));assert.ok(contract.requirements.tableRowsMax>=3);
  assert.deepEqual(Object.keys(B.resolve(context)).sort(),['requiredHeadings','sourceHash','version']);
  const box=vm.createContext({});for(const file of ['report-completion-contract.js','report-business-structure.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),box);
  assert.deepEqual(JSON.parse(JSON.stringify(box.ReportBusinessStructure.tableDuties({...context,currentSource:markdown}))),result);
});
test('超出合同支持范围明确报错而不静默截断职责或行预算',()=>{
  const table=i=>'比较'+i+'表\n|类别|条件|\n|甲|具备|';
  assert.throws(()=>B.tableDuties({...context,currentSource:Array.from({length:21},(_,i)=>table(i)).join('\n\n')}),/未截断表格/);
  assert.throws(()=>B.tableDuties({...context,currentSource:'条件比较表\n|类别|条件|\n'+Array.from({length:300},(_,i)=>'|甲'+i+'|具备|').join('\n')}),/未截断表格/);
});
