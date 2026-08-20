import fs from "node:fs";
import path from "node:path";
import {buildPptxBuffer,validatePptxBuffer} from "../local-server/ppt-export.js";

const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#eef6fb"/><circle cx="1320" cy="140" r="260" fill="#d7e9f6"/><path d="M0 820L240 520l180 180 260-350 210 250 190-180 520 400z" fill="#9ec9e2"/><g fill="none" stroke="#176fa8" stroke-width="22"><path d="M100 820V430h170v390M330 820V310h220v510M620 820V480h150v340M840 820V250h260v570M1180 820V410h190v410M1430 820V530h120v290"/></g><text x="90" y="120" font-family="Microsoft YaHei" font-size="52" font-weight="700" fill="#173f63">保障性住房项目决策蓝图</text><text x="94" y="175" font-family="Arial" font-size="20" letter-spacing="6" fill="#65839a">HOUSING · INVESTMENT · DECISION</text></svg>`;
const image="data:image/svg+xml;base64,"+Buffer.from(svg,"utf8").toString("base64");
const slides=[
  {id:"s1",type:"cover",layoutId:"cover",renderTrack:"editable",title:"保障性住房项目决策汇报",subtitle:"白箱测算、建设计划与风险控制"},
  {id:"s2",type:"agenda",layoutId:"agenda",renderTrack:"native",title:"本次汇报回答五个决策问题",content:{items:["项目价值","核心指标","资金计划","实施路径","风险与行动"].map(text=>({text}))}},
  {id:"s3",type:"content",layoutId:"metric",renderTrack:"editable",title:"四项指标共同决定项目可持续性",claim:"财务指标可测算，关键参数仍需逐项确认",content:{metrics:[{label:"总投资",value:"43.5亿元"},{label:"项目IRR",value:"5.62%"},{label:"建设周期",value:"16季度"},{label:"保障房规模",value:"12.4万㎡"}]},sources:["白箱测算引擎｜测算快照A01"]},
  {id:"s4",type:"content",layoutId:"chart-bar",renderTrack:"editable",title:"建设期投资在中期形成峰值",claim:"2027—2028年是资金调度关键窗口",content:{series:[{label:"2026",value:18},{label:"2027",value:34},{label:"2028",value:31},{label:"2029",value:17}]},sources:["投资计划表｜年度分摊"]},
  {id:"s5",type:"content",layoutId:"table",renderTrack:"editable",title:"两种推进方案的边界与取舍清晰",content:{headers:["维度","稳健推进","品质增强"],rows:[["成本","锁定投资边界","增加前期品质投入"],["资金","分阶段落实","峰值压力较高"],["价值","实施确定性高","长期运营价值高"]]},sources:["方案比选纪要"]},
  {id:"s6",type:"content",layoutId:"timeline",renderTrack:"editable",title:"五个里程碑构成项目推进主路径",content:{steps:[{label:"立项决策",text:"确认边界"},{label:"设计报批",text:"完成专项"},{label:"施工准备",text:"落实招采"},{label:"主体建设",text:"控制成本"},{label:"验收运营",text:"完成复盘"}]},sources:["项目横道图"]},
  {id:"s7",type:"content",layoutId:"image-hero",renderTrack:"editable",title:"项目形象兼顾保障属性与城市品质",claim:"建筑界面和公共空间构成长期运营价值",content:{image},assetPlan:{status:"matched",kind:"illustration",assetId:"accepted-hero",dataUrl:image,sourceRef:"本地智能插图生成器",provider:"local-illustration",approvedAt:Date.now()},sources:["本地智能插图生成器｜人工采用"]},
  {id:"s8",type:"content",layoutId:"risk",renderTrack:"editable",title:"四类风险均配置责任动作",content:{items:[{label:"成本超支",text:"设置动态预警线"},{label:"工期延误",text:"关键工序前置协调"},{label:"融资波动",text:"复核利率与提款计划"},{label:"运营偏差",text:"滚动校准去化节奏"}]},sources:["项目风险清单"]},
  {id:"s9",type:"section",layoutId:"section",renderTrack:"editable",title:"从分析进入决策",subtitle:"把指标、计划和责任落实到行动"},
  {id:"s10",type:"conclusion",layoutId:"conclusion",renderTrack:"editable",title:"建议完成三项核实后进入下一阶段",bullets:["确认关键参数及其来源","落实资金峰值年份安排","锁定里程碑和责任部门"],sources:["本次汇报结论"]}
];
const plan={schemaVersion:5,designPipelineVersion:10,title:"保障性住房项目决策汇报｜三批升级验收",purpose:"经营班子项目决策与审查",audience:"经营班子与项目审查人员",templateId:"business-blue-160",hybridTemplate:true,nativeTemplate:false,designSpec:{brandName:"深安居",titleFont:"Microsoft YaHei",bodyFont:"Microsoft YaHei"},slides};
const output=path.resolve("outputs","PPT三批升级_双轨素材与测算联动验收.pptx"),buffer=await buildPptxBuffer(plan),qa=await validatePptxBuffer(buffer,plan);if(!qa.ok)throw new Error(qa.errors.join("；"));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buffer);console.log(JSON.stringify({output,bytes:buffer.length,qa},null,2));
