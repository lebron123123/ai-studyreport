import fs from "node:fs";
import path from "node:path";
import { buildPptxBuffer,validatePptxBuffer } from "../local-server/ppt-export.js";
const output=path.resolve("outputs/ppt-design-ir-smoke.pptx");
const slides=[
  {id:"s1",layoutId:"cover",title:"保障性住房项目决策汇报",subtitle:"从项目证据、财务测算到实施决策",sources:[]},
  {id:"s2",layoutId:"agenda",title:"汇报结构：从证据到决策",bullets:["项目背景与政策目标","核心指标与投资测算","需求与职住平衡","实施路径与工期计划","风险及应对措施","决策事项与下一步"],sources:["项目正式材料"]},
  {id:"s3",layoutId:"statement",title:"项目具备推进基础，但核心参数仍需在决策前完成最终锁定",subtitle:"政策目标、供需判断与白箱测算共同构成项目决策依据",sources:["审查规则第12条"]},
  {id:"s4",layoutId:"metric",title:"四项指标共同决定项目财务可承受能力",content:{metrics:[{label:"总投资",value:"43.5亿元",text:"含建设期财务费用"},{label:"项目IRR",value:"5.62%",text:"满足分档审查要求"},{label:"建设工期",value:"16季度",text:"与横道图保持一致"},{label:"保障房规模",value:"12.4万㎡",text:"以正式批复为准"}]},sources:["测算表-关键指标"]},
  {id:"s5",layoutId:"timeline",title:"项目按照五个关键阶段形成闭环推进",content:{steps:[{label:"立项决策",text:"锁定边界和参数"},{label:"设计报建",text:"完成方案与审批"},{label:"施工建设",text:"按季度控制投资"},{label:"竣工验收",text:"完成专项验收"},{label:"交付运营",text:"进入销售或出租"}]},sources:["项目横道图"]},
  {id:"s6",layoutId:"comparison",title:"两种实施方案需要在资金压力与长期价值之间取舍",content:{columns:[{title:"方案 A｜稳健推进",items:["前期投入较低","工期相对可控","资金压力较小"]},{title:"方案 B｜品质优先",items:["前期投入较高","长期运营价值更强","实施协同要求更高"]}]},claim:"建议优先采用方案A，并保留品质提升弹性",sources:["方案比选记录"]}
];
const plan={schemaVersion:4,title:"保障性住房项目决策汇报",purpose:"项目决策",audience:"项目决策与审查人员",templateId:"business-blue-160",exportMode:"preview",designSpec:{brandName:"深圳市安居集团",accent:"003591",secondary:"5385C5",background:"F7F9FC",text:"24292F",titleFont:"Microsoft YaHei",bodyFont:"Microsoft YaHei"},slides};
const buffer=await buildPptxBuffer(plan),qa=await validatePptxBuffer(buffer,plan);if(!qa.ok)throw new Error(qa.errors.join("；"));fs.writeFileSync(output,buffer);console.log(JSON.stringify({output,bytes:buffer.length,qa},null,2));
