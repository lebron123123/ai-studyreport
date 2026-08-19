import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const input=process.argv[2]||path.join(ROOT,"outputs","ppt-template-inventory.json");
const jsonOut=process.argv[3]||path.join(ROOT,"outputs","ppt-template-design-library.json");
const mdOut=process.argv[4]||path.join(ROOT,"outputs","ppt-template-design-library.md");
const inventory=JSON.parse(fs.readFileSync(input,"utf8"));

const STYLE_SYSTEMS=[
  ["executive-blue","高管深蓝咨询","深蓝主导、强结论、低装饰","decision",["cover","statement","comparison","conclusion"]],
  ["architectural-editorial","建筑杂志蓝","大图、细线、非对称留白","context",["cover","image-story","section-statement"]],
  ["data-journalism","数据决策蓝","图表优先、数字主视觉、注释侧栏","evidence",["chart-insight","chart-table","cards-grid"]],
  ["swiss-grid","瑞士网格蓝","严格栅格、大字号、单一锚点色","analysis",["text-structure","cards-grid","diagram"]],
  ["government-clean","政务审查蓝","克制、可信、表格与规则清晰","review",["table","chart-table","process-timeline"]],
  ["digital-system","数字系统蓝","节点、关系、流程和轻科技层次","system",["diagram","process-timeline","cards-grid"]]
].map(([id,name,principle,primaryRole,families])=>({id,name,principle,primaryRole,families,source:"160页高级商务蓝配色.pptx",tokens:{accent:"003591",secondary:"5385C5",light:"80AACD",pale:"BBCEE5",dark:"24292F",background:"FEFFFF"}}));

const RECIPE_BLUEPRINTS=[
  ["cover","城市建筑封面","cover"],["cover","数字品牌封面","cover"],["cover","极简结论封面","cover"],
  ["section-statement","章节巨幕","section"],["section-statement","一句话结论","summary"],["section-statement","决策命题页","decision"],
  ["text-structure","结论侧栏","analysis"],["text-structure","编号洞察","analysis"],["text-structure","问题树","analysis"],
  ["cards-grid","三项洞察卡","summary"],["cards-grid","四项能力矩阵","analysis"],["cards-grid","六模块导航","agenda"],
  ["process-timeline","里程碑路线图","plan"],["process-timeline","递进实施路径","plan"],["process-timeline","泳道协同流程","system"],["process-timeline","阶段门禁流程","review"],["process-timeline","年度推进节奏","plan"],["process-timeline","闭环治理路径","decision"],
  ["diagram","中心辐射关系","system"],["diagram","上下游关系链","system"],["diagram","双层架构图","system"],["diagram","因果驱动图","analysis"],
  ["chart-insight","主图表加结论侧栏","evidence"],["chart-insight","趋势图加事件注释","trend"],["chart-insight","对比图加差异结论","comparison"],["chart-insight","瀑布图加驱动因素","evidence"],
  ["chart-table","图表表格联动","evidence"],["chart-table","指标达成看板","review"],["chart-table","测算结果总览","evidence"],
  ["table","审查清单表","review"],["table","参数溯源表","evidence"],["table","方案评分表","comparison"],
  ["image-story","建筑大图判断","context"],["image-story","区位图加结论","context"],
  ["closing","决策行动看板","decision"],["closing","结论与下一步","conclusion"]
];

const familyClusters=new Map();
for(const c of inventory.clusters||[]){if(!familyClusters.has(c.family))familyClusters.set(c.family,[]);familyClusters.get(c.family).push(c);}
const recipes=RECIPE_BLUEPRINTS.map(([family,name,role],i)=>{const pool=familyClusters.get(family)||inventory.clusters||[],hit=pool[i%Math.max(1,pool.length)]||{};return{id:`recipe_${String(i+1).padStart(2,"0")}`,name,family,role,sourcePages:(hit.pages||[hit.representativePage]).filter(Boolean).slice(0,8),representativePage:hit.representativePage||null,contentContract:{minItems:["cover","section-statement","closing"].includes(family)?1:2,maxItems:["table","chart-table"].includes(family)?8:6},status:"candidate"};});

const slotMap={"process-timeline":["title","steps","milestones","sources"],"chart-insight":["title","claim","series","commentary","sources"],"chart-table":["title","series","rows","commentary","sources"],diagram:["title","claim","nodes","links","sources"],"cards-grid":["title","claim","items","sources"],table:["title","headers","rows","sources"],cover:["title","subtitle","brand","hero"],closing:["title","actions","owner","deadline"],"image-story":["title","claim","image","caption","sources"],"section-statement":["sectionNo","title","subtitle"],"text-structure":["title","claim","items","sources"]};
const slideByPage=new Map((inventory.slides||[]).map(x=>[x.page,x]));
const components=(inventory.clusters||[]).slice(0,100).map((c,i)=>{const source=slideByPage.get(c.representativePage)||{};return{id:`tpl_${String(i+1).padStart(3,"0")}`,name:`${c.family}组件·源页${c.representativePage}`,family:c.family,sourcePages:c.pages,representativePage:c.representativePage,slots:slotMap[c.family]||["title","items","sources"],capacity:{items:Math.max(1,Math.min(12,Math.round((c.average&&c.average.texts||8)/4))),images:Math.min(6,c.average&&c.average.pictures||0),charts:Math.min(4,c.average&&c.average.charts||0)},geometry:source.geometry||null,slotContract:source.slotContract||null,sourceContract:{sourcePage:c.representativePage,layout:source.layout||c.layout,cloneMode:"native-ooxml-group",preserveGeometry:true,preserveZOrder:true},confidence:Math.min(95,45+c.count*8+(c.average&&c.average.pictures?5:0)+(c.average&&c.average.charts?8:0)),status:"visual-review-required"};});

const result={schemaVersion:1,generatedAt:new Date().toISOString(),source:inventory.source||"160页高级商务蓝配色.pptx",summary:{styleSystems:STYLE_SYSTEMS.length,recipes:recipes.length,componentCandidates:components.length,sourceSlides:inventory.summary&&inventory.summary.slides||160,rawClusters:(inventory.clusters||[]).length},styleSystems:STYLE_SYSTEMS,recipes,components};
const rows=(arr,fn)=>arr.map(fn).join("\n");
const md=`# 160页高级商务蓝模板·设计语言拆解库\n\n> 本文件由结构盘点自动生成候选，再进入人工缩略图审查；不是把160页逐页硬编码。\n\n## 结果\n\n- 视觉体系：${result.summary.styleSystems}套\n- 整页配方：${result.summary.recipes}个\n- 组件候选：${result.summary.componentCandidates}个\n- 原始聚类：${result.summary.rawClusters}类（已转成可治理候选库）\n\n## 视觉体系\n\n| ID | 名称 | 设计原则 | 主要用途 |\n|---|---|---|---|\n${rows(STYLE_SYSTEMS,x=>`| ${x.id} | ${x.name} | ${x.principle} | ${x.primaryRole} |`)}\n\n## 36个整页配方\n\n| ID | 名称 | 类型 | 角色 | 来源页 |\n|---|---|---|---|---|\n${rows(recipes,x=>`| ${x.id} | ${x.name} | ${x.family} | ${x.role} | ${x.sourcePages.join("、")||"待人工匹配"} |`)}\n\n## 组件候选（前100个）\n\n| ID | 类型 | 代表页 | 同类页面 | 槽位 | 置信度 |\n|---|---|---:|---|---|---:|\n${rows(components,x=>`| ${x.id} | ${x.family} | ${x.representativePage} | ${x.sourcePages.join("、")} | ${x.slots.join("、")} | ${x.confidence} |`)}\n\n## 准入规则\n\n组件必须经过缩略图审查、槽位定义、最小/最大容量测试、浏览器预览、PPTX渲染及溢出检测后，才能由 visual-review-required 升级为 active。\n`;
fs.mkdirSync(path.dirname(jsonOut),{recursive:true});fs.writeFileSync(jsonOut,JSON.stringify(result,null,2),"utf8");fs.writeFileSync(mdOut,md,"utf8");
console.log(JSON.stringify(result.summary));
