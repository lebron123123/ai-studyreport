// Canonical migration builder. Never touches database or existing project reports.
import fs from 'node:fs';
const file='data/report-logic-gaibao-v1.json';
const seed=JSON.parse(fs.readFileSync(file,'utf8'));
const review=JSON.parse(fs.readFileSync('data/report-logic-housing-v6-review.json','utf8'));
const scope='housing_conversion';
const get=n=>seed.rules.find(r=>r.id===`gaibao-v1-${String(n).padStart(3,'0')}`);
const update=(n,logic,section,subsection)=>{
  const r=get(n),v=r.scenarioVariants[scope];
  v.writingLogic=logic;
  if(section)v.section=section;
  if(subsection)v.subsection=v.displayTitle=subsection;
  v.changeReason='V6经理批示转化为通用逻辑';
};
const c=review.chapterOne;
update(3,c.basis);update(4,c.background);update(5,c.cooperation);
update(6,c.property);update(7,'改造前户型及物业现状表紧随现状描述，列房型、层高、套数、建筑面积、得房率及合计；与改造后房源表采用可核对的口径。');
update(8,'先简述改造目标，不重复房源现状。'+c.beforeAfter);
update(9,c.compliance);update(10,c.investment+'经济效益仅引用已确认测算，面积和套数与房源表一致。');
update(11,c.summary);
seed.globalRequirements[scope]=review.globalRequirements+c.length;
const marketIds=[[75],[16,17],[22],[21],[19,24,27],[29,76,77],[26],[78]];
const focused={
16:['比较行政区、街道和项目3公里内的常住人口、就业人口及租住需求基础，说明同一统计时点和区域口径。净流入变化由下一子节说明，不重复。',['住房租赁供需分层分析表']],
17:['只分析人口净流入和租赁需求的历年变化；引用上一子节人口基数，不重抄现状。常住人口增量不等于净流入，缺少细尺度数据明确待补。',[]],
19:['仅分析住宅新房、二手房成交价格及趋势，比较项目所在区与3公里范围；不重复公寓租赁供给。',[]],
24:['汇总项目周边板块公寓项目数、房间数、出租率及租金，重叠范围去重，均值说明权重。3公里项目明细在下一子节展示。',['项目周边房源情况表']],
27:['仅列项目3公里内房源明细、距离、房间数、开间租金、开业时间与出租率，并解释与周边板块的差异。',['项目3公里内房源情况表']],
29:['仅分析历史租金表现：区分散租和集中式长租，各自比较市区与周边板块同口径成交租金、累计和年均变化。不在此重复竞品筛选或定价修正。',['散租市区历史成交租金表','散租板块历史成交租金表','集中式长租市区历史成交租金表','集中式长租板块历史成交租金表']],
76:['仅分析3公里范围内的竞争格局，说明可比项目选择依据、产品租金及竞争定位。历史趋势引用前节，修正计算留给定价子节。',['住房租赁竞品比较表']],
77:['仅进行项目定价：保留比较案例、交通配套、外部环境、新旧程度、装修家私修正以及修正价格和比较权重；按各案例修正价格乘权重求和取整，保留汇总与结论行。系数须有依据、权重合计为一，缺失数据不计算。政策折扣单列依据，不套用示例价格或折扣。',['所选案例租金汇总表']]
};
for(let i=0;i<review.marketSections.length;i++){
  const s=review.marketSections[i],ids=marketIds[i];
  for(let j=0;j<ids.length;j++){
    let r=get(ids[j]);
    if(!r){r=structuredClone(get(16));r.id=`gaibao-v1-${String(ids[j]).padStart(3,'0')}`;r.sourceNo=ids[j];r.sourceRow=0;r.scenarios=[scope];r.scenarioVariants={[scope]:structuredClone(r.scenarioVariants[scope])};seed.rules.push(r);}
    const subtitles=i===5?['历史租金表现','3公里范围内竞品分析','项目定价分析']:i===4?['住宅市场情况','项目周边租赁市场情况','项目3公里内租赁市场情况']:i===1?['人口就业基础','人口净流入与租赁市场变化']:[s.title];
    const [logic,tables]=focused[ids[j]]||[s.logic,s.tables];
    update(ids[j],logic+`需要表格：${tables.join('、')||'引用前表，不重复制表'}。`,s.number+s.title,`${s.number}.${j+1} ${subtitles[j]}`);
    const v=r.scenarioVariants[scope];
    v.requiredSources='政府统计公报、原始发布机构、已审核资料库及真实市场调研；注明统计期、地域范围、计量单位、样本与来源；项目内部事实取已确认材料。';
    v.sourceKinds=['knowledge_base','web_search','manual_upload'];
    v.missingPolicy='缺失或口径冲突标待补，不虚构人口、比例、租金、权重和修正系数；图表仅消费可核验数据。';
    v.outputForm=s.tables.length?'文字＋表格':'文字';
    if(ids[j]>=75){Object.assign(r,v);r.scenarioVariants={[scope]:structuredClone(v)};}
  }
}
update(32,'统一描述所有房源所在地的区位、四至、交通与通勤条件，重要差异在同一表或同一段比较，不按主次房源分段，不使用POI指标。');
update(33,'汇总产权、建筑及出租面积、楼层、用途、竣工运营时间、现状设施和改造实施条件，项目事实取已核验材料；不混入商业底商或示例地名。');
update(40,'采用第三章已确认的市场比较结果，结合客群承受力、适用价格政策和财务测算给出建议区间；市场参考租金、政策折扣和测算假设分别注明，不以财务目标倒推市场租金。');
seed.logicVersions[scope]='4.0';
seed.structure.ruleCount=seed.rules.length;
seed.structure.scenarioCounts[scope]=seed.rules.filter(r=>r.scenarios.includes(scope)).length;
seed.structure.scenarioStructures[scope].frameworkVersion=review.revisionId;
seed.source={...seed.source,baselineId:review.revisionId+'-table-fix',fileName:review.sourceFile,changeBasis:'V6表模逐表复原、子节边界与编号修正；商业场景保持不变',scopedMigration:scope};
seed.name='改造项目逐小节生成逻辑（住房改造V6 / 商业自持兼容）';
fs.writeFileSync(file,JSON.stringify(seed,null,2)+'\n');
console.log(JSON.stringify({rules:seed.rules.length,housingRules:seed.structure.scenarioCounts[scope],revision:review.revisionId}));
