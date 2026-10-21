const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const helper=source.slice(source.indexOf('function reportCurrentAssumptionsContext('),source.indexOf('async function generateSection(',source.indexOf('function reportCurrentAssumptionsContext(')));
const api=require('../report-financial-tables.js');
const C=require('../report-completion-contract.js');
const result={__ctype:'gaibao',allYears:[2027,2028],resiOccupancy:{2027:0.5583333333333333,2028:.85},monthDict:{2027:6,2028:12},summary:{totalOperateMonths:54}};
const params={rent:45,operateStartMonth:'2027-07',operateEndMonth:'2031-12',occupancyMode:'monthly-phases',rampOcc:.15,rampRates:[.15,.3,.5,.7],stableOcc:.85,rampStartMonth:'2027-07',rampEndMonth:'2027-10',stableStartMonth:'2027-11'};
const assumptions=api.buildCurrentAssumptions({params,result});
const run=params=>{const ctx={calcParams:params,calcResult:result,ReportFinancialTables:api};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(helper,ctx);return ctx.reportCurrentAssumptionsContext();};
test('所有章节获得当前情景，区分原材料旧值与当前输入且不宣称已核实',()=>{
  const p={area:5621.15,units:51,rent:45,operateStartMonth:'2027-07',mode:'rent-percent',collect:25,collectRentPct:20,operateCostMode:'rent-percent',operateRentPct:15.7};
  const before=JSON.stringify(p),text=run(p);assert.match(text,/起始租金（元\/㎡\/月）：45/);assert.match(text,/运营开始月：2027-07/);assert.match(text,/实收租金 × 20%/);assert.match(text,/实收租金 × 15.7%/);assert.doesNotMatch(text,/固定单价 25/);assert.match(text,/不等于已经核实/);assert.match(text,/不替用户改参数/);assert.equal(JSON.stringify(p),before);
});
test('固定单价分支不引用未生效比例，空测算不编造输入',()=>{
  const text=run({mode:'lease',collect:25,collectRentPct:20});assert.match(text,/固定单价 25 元/);assert.doesNotMatch(text,/× 20%/);assert.equal(run({}),'');assert.equal(run(null),'');
});
test('生产生成入口确实给普通章节同一份当前假设',()=>{
  const body=source.slice(source.indexOf('async function generateSection('),source.indexOf('async function reportDurableSectionCall('));assert.match(body,/user\+reportCurrentAssumptionsContext\(\)\+summaryContext/);
});
test('月度爬坡与年度均值均来自引擎，不能将首月15%称首年',()=>{
  assert.equal(assumptions.firstPhasePercent,15);assert.ok(Math.abs(assumptions.annualOccupancy[0].percent-55.83333333333333)<1e-10);assert.equal(assumptions.totalOperateMonths,54);
  const text=api.currentAssumptionsPrompt(assumptions);assert.match(text,/首个阶段 15%/);assert.match(text,/2027年 55.8333%（6个运营月）/);assert.match(text,/不是首年出租率/);
  for(const text of ['本次首年出租率15%。','<table><tr><td>首年出租率</td><td>15%</td></tr></table>','2027年出租率70.4%。']){
    assert.equal(api.inspectCurrentAssumptions(text,assumptions)[0]?.code,'current-assumption-conflict',text);
  }
  assert.deepEqual(api.inspectCurrentAssumptions('本次首月出租率15%，2027年平均出租率55.83%。',assumptions),[]);
});
test('旧材料与当前输入分开，保留比较，不改数字',()=>{
  const text='原方案首年出租率70.4%；本次首年出租率55.83%。原方案租金42.44元，当前起始租金45元。';
  assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[]);
  assert.equal(api.inspectCurrentAssumptions('原方案首年出租率70.4%，本次首年出租率15%。',assumptions).length,1);
  assert.equal(api.inspectCurrentAssumptions('当前平均租金42.44元/㎡/月。',assumptions).length,1);
  assert.equal(api.inspectCurrentAssumptions('各点位实际租金水平已在收入测算中按小区分别取值。',assumptions).length,1);
});
test('带年月的爬坡阶段不是年度均值，同句正确年均值保留',()=>{
  const texts=[
    '本项目爬坡期（2027年7月至10月，出租率依次按15%、30%、50%、70%推进），2027年当年平均出租率55.8333%的测算结果对爬坡节奏高度敏感。',
    '2027年7月首月出租率15%，当年平均出租率55.8333%。',
    '2027年爬坡期出租率15%，本次2027年平均出租率55.83%。',
    '2028年7月出租率15%，2028年全年平均出租率85%。'
  ];
  for(const text of texts)assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
});
test('出现月度范围不能掩盖同句真正错误的全年出租率',()=>{
  for(const text of [
    '本次2027年7月起但全年出租率15%。',
    '本次2027年7月起运营，全年平均出租率15%。',
    '2027年7月至10月，出租率依次按15%、30%、50%、70%推进，但2027年全年出租率15%。',
    '本次2027年平均出租率15%，7月为首月。',
    '本次2028年7月运营，全年出租率15%。',
    '原方案2027年平均出租率70.4%，本次2027年全年出租率15%。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});
test('租金角色绑定到实际金额位置，允许当前45与旧42.44比较',()=>{
  for(const text of [
    '本次测算45元/平方米/月的起始租金与材料原方案42.44元/平方米/月的加权租金之间的口径差异尚未确认。',
    '当前起始租金45元，与原方案起始租金42.44元比较。',
    '材料原方案平均租金42.44元，本次平均租金45元。',
    '原方案租金42.44元，本次也为45元。',
    '当前起始租金45元，与材料原方案42.44元比较，当前平均租金45元。'
  ])assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
});
test('同句旧值不能为当前错误租金开脱，隐式沿用仍须拦截',()=>{
  for(const text of [
    '原方案租金42.44元，但本次起始租金也为42.44元。',
    '原方案租金42.44元，但本次也42.44元。',
    '原方案租金42.44元，当前仍为42.44元。',
    '当前起始租金42.44元，与原方案租金42.44元比较。',
    '原方案平均租金42.44元，当前平均租金42.44元。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});

test('真实材料、立项阶段及市场调研值按捕获位置归属，不冒充当前输入',()=>{
  const references=[
    '立项请示及研究报告按市场租金9折、平均租金42.44元/平方米/月、稳定期出租率85%测算，与本次起始租金45元存在差异。',
    '上述收益指标为立项阶段的测算结果，其假设包括稳定期出租率85%、平均租金42.44元/平方米/月且不设增幅。',
    '研究报告对主力户型的初步研判为市场租金约45.12元/平方米/月、9折后约40.61元/平方米/月，项目整体9折后平均租金预计约40元/平方米/月。',
    '立项请示中第一批房源平均租金约42.44元/平方米/月。',
    '上述价格与《关于项目投资立项的请示》中平均租金约42.44元/平方米/月的预估口径不一致，本次起始租金45元。',
    '项目投资立项请示中预计首年出租率70.4%、平均租金42.44元/平方米/月，属于原方案或材料值，与当前测算起始租金45元存在差异。',
    '该组数据对应研究报告设定的起始租金42.44元/平方米/月，属于原方案测算值。',
    '市场调研预估首年平均出租率70.4%、次年起85%，本次首年平均出租率55.8333%，两者存在差异。'
  ];
  for(const text of references)assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
  const lg={...assumptions,rent:75,totalOperateMonths:144,annualOccupancy:[{year:2023,percent:75,operatingMonths:12}]};
  assert.deepEqual(api.inspectCurrentAssumptions('该指标为材料测算结果，其假设（起始租金90元/㎡/月、运营期6年）与本次报告口径（起始租金75元/㎡/月、运营144个月）不一致，不能直接作为当前结论。',lg),[]);
  assert.deepEqual(api.inspectCurrentAssumptions('市场调研预估首年平均出租率76.25%、次年起90%，本次测算假设2023年75%、2024年起95%，两者存在差异。',lg),[]);
  assert.equal(api.inspectCurrentAssumptions('市场调研预估首年平均出租率76.25%，本次首年平均出租率也为76.25%。',lg).length,1);
});

test('同句租金比较不跨逗号把前置数值的标签绑定到下一个旧金额',()=>{
  for(const text of [
    '该租金水平高于收入预估中42.44元/平方米/月的整体平均租金，两者差异需说明：45元为测算假设的起始租金，42.44元为按分点位单价加权计算的整体平均租金。',
    '三是测算假设起始租金45元/平方米/月与收入预估整体平均租金42.44元/平方米/月之间的口径差异尚未统一。'
  ])assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
  for(const text of [
    '本次起始租金45元与收入预估平均租金42.44元差异尚未统一，但本次也采用42.44元。',
    '本次起始租金45元与原方案42.44元存在差异，当前收入预估平均租金42.44元。',
    '本次起始租金45元与原方案42.44元存在差异，本次采用收入预估平均租金42.44元。',
    '本研究报告平均租金42.44元。',
    '当前研究报告平均租金42.44元。',
    '本次平均租金42.44元，与立项请示的42.44元一致。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});

test('新增历史金额来源不能豁免同句当前54个月被写成5年',()=>{
  for(const text of [
    '按当前测算假设，起始租金45元/平方米/月、运营期5年，与研究报告平均租金42.44元/平方米/月存在差异。',
    '当前测算以起始租金45元、运营期2027年7月至2031年12月为输入，测算运营年限5年。',
    '本次报告财务测算采用的运营年限为5年，与协议草案的12年首期合作期限存在差异。',
    '该组数据来自原方案测算，与当前租金45元和运营期限5年不一致。'
  ])assert.ok(api.inspectCurrentAssumptions(text,assumptions).some(i=>/实际运营54个月/.test(i.message)),text);
  assert.deepEqual(api.inspectCurrentAssumptions('研究报告平均租金42.44元，当前起始租金45元，运营期限54个月，跨五个年度。',assumptions),[]);
});
test('旧投运月可比较，当前投运月不可混用，出租出售不受此规则影响',()=>{
  assert.equal(api.inspectCurrentAssumptions('当前计划于2027年6月完成改造正式运营。',assumptions).length,1);
  assert.deepEqual(api.inspectCurrentAssumptions('原方案预计2027年6月入市；当前从2027年7月正式运营。',assumptions),[]);
  assert.equal(api.inspectCurrentAssumptions('本次运营期共5年。',assumptions).length,1);
  assert.deepEqual(api.inspectCurrentAssumptions('首年出租率15%。',{...assumptions,projectType:'rent'}),[]);
  assert.equal(api.currentAssumptionsPrompt({...assumptions,projectType:'sale'}),'');
});
test('合同固定JSON情景快照并复用同一角色检查，不能漏传、悄改或伪造验证',()=>{
  const base=C.createPlan([{name:'市场分析',sections:[{t:'需求分析'}]}]).sections[0],input={...base,currentAssumptions:structuredClone(assumptions)},c=C.normalize(input);
  assert.deepEqual(c.currentAssumptions,assumptions);assert.notEqual(c.currentAssumptions,assumptions);
  input.currentAssumptions.annualOccupancy[0].percent=0;assert.equal(c.currentAssumptions.annualOccupancy[0].percent,assumptions.annualOccupancy[0].percent);
  assert.match(C.structuredPrompt(c),/不是首年出租率/);
  assert.ok(C.inspect('本次首年出租率15%。',c).issues.some(i=>i.code==='current-assumption-conflict'));
  assert.ok(!C.inspect('原方案首年出租率70.4%；本次首年出租率55.83%。',c).issues.some(i=>i.code==='current-assumption-conflict'));
  for(const bad of [[],new Date(),{bad:undefined},{bad:Infinity},{bad:()=>1}])assert.throws(()=>C.normalize({...base,currentAssumptions:bad}));
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>C.normalize({...base,currentAssumptions:cyclic}),/JSON/);
});

test('真实6.1两段六运营月解释不跨逗号误取下一分句的15%',()=>{
  const paragraphs=[
    '原投资立项请示预计改造完成后可提供51套保障性租赁住房，总建筑面积5621.15平方米，预计2027年6月入市，按市场租金9折标准对外出租，平均租金约42.44元/平方米/月，平均每套约4678元/月，稳定期出租率85%。原投资立项请示预计首年出租率70.4%。原投资立项请示中的租金按第一批房源平均租金42.44元/平方米/月考虑，不设增幅。上述租金和出租率数据来源于项目投资立项请示中的测算，当前测算情景采用起始租金45元/平方米/月、运营期2027年7月至2031年12月、稳定出租率85%等假设，两者口径存在差异，最终以经确认的测算说明书为准。按当前测算情景，运营期2027年7月至2031年12月共54个运营月，出租率采用月度爬坡，首个运营月为15%，其后各阶段为30%、50%、70%，稳定期自2027年11月起为85%；据此计算的2027年（6个运营月）平均出租率为55.8333%，2028年至2031年各年（均为12个运营月）平均出租率为85%。需注意，15%仅为首个运营月的出租率，55.8333%为2027年运营月加权平均出租率，15%不等同于首年平均出租率，55.8333%不是完整12个月的平均出租率，二者均不等同于稳定期出租率。改造效果表达方面，现有资料中仅包含参考鹏瑞尚府一房、高新花园两房、鸿栖台三房等同类项目的拎包入住效果图，本项目正式效果图尚未提供，需补充改造前后对比视角的正式设计资料后方可形成确定性表达。',
    '改造效果预测应区分当前测算情景与历史材料口径。按当前测算情景，运营期2027年7月至2031年12月共54个运营月，出租率采用月度爬坡，首个运营月为15%，其后各阶段为30%、50%、70%，稳定期自2027年11月起为85%；据此计算的2027年（6个运营月）平均出租率为55.8333%，2028年至2031年各年（均为12个运营月）平均出租率为85%。需注意，15%仅为首个运营月的出租率，不等同于首年平均出租率；55.8333%即本次测算2027年六个运营月的平均出租率，并非完整12个月的平均出租率；二者均不等同于稳定期出租率。原投资立项请示预计首年出租率70.4%、稳定期出租率85%；原投资立项请示中的租金按第一批房源平均租金42.44元/平方米/月考虑且不设增幅，上述均属于原请示历史方案值，与当前测算情景的起始租金45元/平方米/月、运营期2027年7月至2031年12月等假设存在口径差异，最终以经确认的测算说明书为准。改造效果预测的确定性结论尚需在正式设计资料和经确认的测算说明书基础上形成，当前不作夸大性承诺。'
  ];
  for(const text of paragraphs)assert.deepEqual(api.inspectCurrentAssumptions('<p>'+text+'</p>',assumptions),[]);
  assert.deepEqual(api.inspectCurrentAssumptions(paragraphs.map(text=>'<p>'+text+'</p>').join(''),assumptions),[]);
  for(const text of paragraphs)assert.equal(api.inspectCurrentAssumptions(text+'本次首年平均出租率15%。',assumptions).length,1);
});

test('年度出租率否定仅限直接断言，否定后的替代错误值仍拦截',()=>{
  for(const text of [
    '本次首年平均出租率并非15%，而为55.8333%。',
    '本次首年平均出租率不等于15%，应为55.8333%。',
    '当前首年平均出租率不是15%，实际为55.8333%。',
    '本次首年平均出租率不是15%。',
    '本次不是首年平均出租率15%，而是首月出租率15%。',
    '55.8333%为2027年运营月加权平均出租率，15%仅为首月。'
  ])assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
  for(const text of [
    '当前首年平均出租率不是55.8333%，而是15%。',
    '本次首年平均出租率并非55.8333%，仍采用15%。',
    '本次首年平均出租率不是15%，但本次首年平均出租率15%。',
    '本次首年平均出租率并非不是15%。',
    '当前首年平均出租率：15%。',
    '本次首年平均出租率，15%。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});

test('统一45租金的直接否定不误报，同句再次肯定分小区仍拦截',()=>{
  for(const text of [
    '当前统一起始租金45元/平方米/月，并不按各小区分别计租。',
    '本次测算采用统一起始租金45元，不分小区分别计租。',
    '当前测算统一起始租金45元，不按小区分别取值。',
    '原请示按各小区分别计租，当前统一起始租金45元。'
  ])assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
  for(const text of [
    '当前统一起始租金45元，不按各小区分别计租，但本次收入测算按各小区分别取值。',
    '当前不按各小区分别计租，实际按小区分别取值。',
    '本次不是不按各小区分别计租。',
    '当前测算按各小区分别计租，原请示采用统一租金。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});

test('原请示历史角色可比较，明确采用旧值不能借来源名豁免',()=>{
  for(const text of [
    '原请示首年平均出租率70.4%，当前首年平均出租率55.8333%。',
    '原请示平均租金42.44元，当前起始租金45元。',
    '当前起始租金45元，与原请示平均租金42.44元比较。',
    '原投资立项请示预计2027年6月正式运营，当前2027年7月正式运营。',
    '当前测算采用2027年1月至6月建设、2027年7月起运营，与原计划2027年6月投入运营存在时点差异。'
  ])assert.deepEqual(api.inspectCurrentAssumptions(text,assumptions),[],text);
  for(const text of [
    '本次沿用原投资立项请示首年出租率70.4%。',
    '当前起始租金沿用原投资立项请示平均租金42.44元。',
    '本次采用原请示平均租金42.44元。',
    '已采用原请示首年平均出租率70.4%。',
    '原请示预计2027年6月入市，但本次2027年6月正式运营。',
    '本次沿用原请示预计2027年6月正式运营。',
    '当前采用原计划2027年6月投入运营。'
  ])assert.equal(api.inspectCurrentAssumptions(text,assumptions).length,1,text);
});

