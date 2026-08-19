import fs from "node:fs/promises";
import "../ppt-asset-layer.js";
import "../ppt-design-ir.js";
import "../ppt-visual-qa.js";
import "../ppt-components.js";
import "../ppt-core.js";
import "../ppt-qc.js";
import {buildPptxBuffer,validatePptxBuffer} from "../local-server/ppt-export.js";

const slides=[
  {layoutId:"cover",type:"cover",title:"保障性住房项目决策汇报",subtitle:"资产层与视觉质量闭环验证"},
  {layoutId:"agenda",title:"汇报结构",bullets:["项目判断","关键指标","实施路径","决策建议"]},
  {layoutId:"metric",title:"关键指标形成可追溯的决策证据",content:{metrics:[{label:"总投资",value:"43.5亿元"},{label:"资本金IRR",value:"5.6%"},{label:"建设工期",value:"16季度"},{label:"住房规模",value:"12万㎡"}]},sources:["项目测算表.xlsx"]},
  {layoutId:"timeline",title:"项目按四个关键阶段实施",content:{steps:[{label:"决策",text:"确认边界"},{label:"设计",text:"形成方案"},{label:"建设",text:"按季推进"},{label:"交付",text:"验收运营"}]}},
  {layoutId:"comparison",title:"两种实施方案形成清晰取舍",content:{columns:[{title:"方案A",items:["投资可控","周期更短"]},{title:"方案B",items:["品质更高","弹性更强"]}]},claim:"建议优先采用方案A"},
  {layoutId:"section",type:"conclusion",title:"形成可执行的决策与行动"}
];
let plan=globalThis.PptCore.buildDeckPlan({title:"保障性住房项目决策汇报",purpose:"项目决策",templateId:"anju-blue",slides});
plan=globalThis.PptQC.repair(plan).plan;
const buffer=await buildPptxBuffer(plan),validation=await validatePptxBuffer(buffer,plan);
await fs.mkdir("outputs",{recursive:true});
await fs.writeFile("outputs/ppt-asset-qa-smoke.pptx",buffer);
await fs.writeFile("outputs/ppt-asset-qa-report.json",JSON.stringify({assetCatalogSummary:plan.assetCatalogSummary,visualQa:plan.visualQa,validation},null,2));
if(!validation.ok)throw new Error(validation.errors.join("；"));
console.log(JSON.stringify({file:"outputs/ppt-asset-qa-smoke.pptx",size:buffer.length,assetCatalogSummary:plan.assetCatalogSummary,visualScore:plan.visualQa&&plan.visualQa.score,dimensions:plan.visualQa&&plan.visualQa.dimensions,validation},null,2));
