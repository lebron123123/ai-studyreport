import fs from "node:fs";
import path from "node:path";
import { buildNativeTemplatePptx, resolveNativeTemplatePath } from "../local-server/ppt-native-template.js";
import { validatePptxBuffer } from "../local-server/ppt-export.js";

const output=path.resolve(process.argv[2]||"outputs/ppt-native-smoke.pptx");
const plan={
  title:"保障房项目决策汇报",
  audience:"项目决策与审查人员",
  purpose:"验证160页商务蓝真实模板母页",
  templateId:"business-blue-160",
  nativeTemplate:true,
  designSpec:{brandName:"深安居"},
  slides:[
    {type:"cover",layoutId:"cover",title:"保障房项目决策汇报",subtitle:"从测算模型到投资决策"},
    {type:"agenda",layoutId:"agenda",title:"汇报结构",content:{items:[{text:"项目背景与目标"},{text:"关键测算指标"},{text:"建设计划"},{text:"风险与应对"},{text:"决策事项"},{text:"下一步行动"}]}},
    {type:"content",layoutId:"metric",title:"核心指标与项目判断",content:{metrics:[{value:"42元",label:"建议租金"},{value:"6.8%",label:"项目IRR"},{value:"24季",label:"建设及运营周期"},{value:"95%",label:"稳定出租率"}]}},
    {type:"content",layoutId:"timeline",title:"项目实施时间安排",content:{steps:[{label:"资料归集",text:"完成项目基础资料整理"},{label:"参数确认",text:"复核关键参数及来源"},{label:"财务测算",text:"完成投资与现金流测算"},{label:"报告生成",text:"形成可研报告初稿"},{label:"复核审议",text:"完成审查并提交决策"}]}},
    {type:"content",layoutId:"process",title:"可研生成与审查闭环",content:{steps:[{label:"数据",text:"正式资料入库"},{label:"规则",text:"审核口径匹配"},{label:"测算",text:"白箱模型计算"},{label:"报告",text:"章节自动生成"},{label:"复核",text:"差异与风险审查"}]}},
    {type:"content",layoutId:"comparison",title:"方案比较与推荐",content:{items:[{label:"方案A",text:"稳健口径，风险较低"},{label:"方案B",text:"收益较高，需强化去化"},{label:"方案C",text:"投资节奏更匹配工期"},{label:"推荐方案",text:"综合采用方案C"}]}},
    {type:"content",layoutId:"risk",title:"关键风险及控制措施",content:{items:[{label:"数据风险",text:"数字必须完成来源溯源"},{label:"参数风险",text:"关键参数需要人工确认"},{label:"工期风险",text:"横道图与投资计划联动"},{label:"市场风险",text:"通过场景分析验证边界"}]}},
    {type:"conclusion",layoutId:"conclusion",title:"下一步行动",bullets:["确认核心参数","完成正式资料复核","提交项目审议"]}
  ]
};

const templatePath=resolveNativeTemplatePath();
if(!templatePath)throw new Error("未找到160页商务蓝模板");
const buffer=await buildNativeTemplatePptx(plan,{templatePath}),qa=await validatePptxBuffer(buffer,plan);
if(!qa.ok)throw new Error(qa.errors.join("；"));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buffer);
console.log(JSON.stringify({ok:true,output,templatePath,bytes:buffer.length,qa},null,2));
