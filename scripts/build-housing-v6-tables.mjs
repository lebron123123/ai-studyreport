// Reproducible schema-only templates: no project facts or sample prices.
import fs from 'node:fs';
const path='data/report-table-templates-gaibao-housing-v1.json';
const data=JSON.parse(fs.readFileSync(path,'utf8'));
function table(n,title,chapter,match,headers,labels=['','','','']){
 const id=`gaibao-housing-table-${String(n).padStart(2,'0')}`;
 const cell=(text,col,header=false)=>({text,col,colSpan:1,vMerge:'',fill:header?'E2EFDA':'',align:header?'center':'left',role:header||text?'static':'value'});
 const rows=[{cells:headers.map((s,i)=>cell(s,i,true))},...labels.map(s=>({cells:headers.map((_,i)=>cell(i===0?s:'',i))}))];
 const t={id,title,projectType:'gaibao-housing',businessScenario:'housing_conversion',version:3,chapter,match,placement:'紧随对应分析；实际填充注明来源、统计期与单位，缺失待补',appendix:false,longPeriod:false,sourceTableNumbers:[],segments:[{sourceTableNumber:0,gridWidths:headers.map(()=>Math.floor(15000/headers.length)),rows}]};
 const i=data.templates.findIndex(x=>x.id===id);if(i<0)data.templates.push(t);else data.templates[i]=t;
}
const one='第一章 项目总论',three='第三章 项目市场分析';
table(1,'项目基本情况表',one,['项目本体情况'],['房源名称及地址','面积（㎡）','楼层分布','规划用途','现状用途','土地使用年限','竣工验收时间','交通配套']);
table(2,'改造前户型及物业现状表',one,['项目本体情况'],['房型','层高（m）','套数','建筑面积（㎡）','得房率'],['','合计']);
table(3,'法定改建条件符合性研判表',one,['政策符合性','改造情况'],['条件','适用性及有效依据','本项目核验情况'],['权属、验收及用途','查封、异议及违法情况','更新、收储与征收计划','实施范围及规模条件','权利人同意','其他适用条件']);
table(4,'改造后户型及房源表',one,['改造目标'],['房型','层高（m）','套数','建筑面积（㎡）','得房率'],['','合计']);
table(5,'软硬装投资估算表',one,['投资估算与经济效益'],['科目','成本（万元）','单方（元/㎡）','单房（元/套）','释义及计费依据'],['设计费','委托咨询费','硬装','软装','机电','配套','不可预见费','代建费','合计']);
data.templates.find(t=>t.id.endsWith('-07')).match=['人口、就业与租赁市场基础'];
data.templates.find(t=>t.id.endsWith('-08')).match=['竞品与租金水平分析'];
data.templates.find(t=>t.id.endsWith('-09')).match=['目标客群画像','客群定位'];
table(15,'合作单位企业信息表',one,['合作模式及合作期限'],['信息','详情'],['企业名称','法定代表人','注册资本','实缴资本','成立日期','统一社会信用代码','经营范围']);
table(16,'市区宏观经济与人口指标表',three,['宏观经济环境'],['指标','全市','项目所在区','统计期及来源'],['GDP','GDP增速','产业结构','财政预算收入','居民收入与消费','常住人口','人口净流入']);
table(17,'客群来源表',three,['目标客群画像'],['产业园或写字楼','工作人口及估算依据','人群特点','租住需求','来源']);
table(18,'项目周边房源情况表',three,['住房租赁供给分析'],['板块','项目数','房间数','出租率','平均租金（元/㎡·月）','统计期及来源']);
table(19,'项目3公里内房源情况表',three,['住房租赁供给分析'],['项目','房间数','距离','开间租金（元/月）','开业时间','出租率','来源']);
for(const [n,title] of [[20,'散租市区历史成交租金表'],[21,'散租板块历史成交租金表'],[22,'集中式长租市区历史成交租金表'],[23,'集中式长租板块历史成交租金表']])table(n,title,three,['竞品与租金水平分析'],['地域','统计期','成交租金（元/㎡·月）','累计变化','年均变化','样本口径及来源']);
table(24,'所选案例租金汇总表',three,['竞品与租金水平分析'],['比较案例','租金单价（元/㎡·月）','交通修正','环境修正','新旧修正','装修家私修正','修正价格','权重','依据']);
table(25,'产品定位表',three,['产品定位分析'],['对标内容','本项目','可比竞品一','可比竞品二','可比竞品三','结论及依据'],['交通','生活配套','环境','户型','装修','室内配置','公区']);
table(26,'年龄学历收入分布表',three,['职住关系与产业分析'],['地域范围','维度','分组','人数或比例','统计期及来源'],['街道','3公里范围','','']);
// Source-faithful structures are reviewed independently of display/publishing.
// The snapshot contains blank schemas only, never the source report's project facts.
const schemas=JSON.parse(fs.readFileSync('data/report-table-housing-v6-source-schemas.json','utf8'));
for(const entry of schemas.templates){
 const target=data.templates.find(t=>t.id===entry.id);
 Object.assign(target,{segments:entry.segments,sourceTableNumbers:entry.sourceTableNumbers,version:4});
}
for(const t of data.templates){
 t.version=4;
 if(!t.sourceTableNumbers.length)t.schemaOrigin='依据经理文字要求补充设计（源Word无实体表）';
 else t.schemaOrigin='源Word原始表模：保留列宽、表头、固定行及合并结构';
}
data.version=4;data.source={fileName:schemas.fileName,sha256:schemas.sha256,physicalTableCount:new Set(schemas.templates.flatMap(t=>t.sourceTableNumbers)).size,logicalTemplateCount:data.templates.length,note:'源Word表模与依据文字要求补充设计的表分别标注；仅去除示例数据，固定标签与汇总行保留。'};
fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n');console.log({templates:data.templates.length});
