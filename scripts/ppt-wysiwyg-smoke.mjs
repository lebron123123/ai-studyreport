import fs from "node:fs";
import path from "node:path";
import { buildPptxBuffer, validatePptxBuffer } from "../local-server/ppt-export.js";

const output=path.resolve(process.argv[2]||"outputs/ppt-wysiwyg-smoke.pptx");
const plan={
  title:"投资及保障房项目：智能测算与决策",
  audience:"项目决策与审查人员",
  purpose:"验证网页预览与PPT导出的时间轴结构一致",
  templateId:"business-blue-160",
  exportMode:"preview",
  nativeTemplate:false,
  slides:[{
    id:"timeline-smoke",order:1,type:"content",layoutId:"timeline",recipeId:"timeline-milestone",
    title:"投资比例设置：灵活分摊，精准匹配",subtitle:"",
    content:{steps:[
      {label:"一次性投入",text:"土地成本、竣工阶段费用"},
      {label:"平均分摊",text:"如4个季度各25%"},
      {label:"前高后低",text:"如40%、30%、20%、10%"},
      {label:"后高前低",text:"如10%、20%、30%、40%"},
      {label:"S型分摊",text:"如5%、15%、30%、30%、15%、5%"}
    ]},sources:[]
  }]
};

const buffer=await buildPptxBuffer(plan),qa=await validatePptxBuffer(buffer,plan);
if(!qa.ok)throw new Error(qa.errors.join("；"));
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,buffer);
console.log(JSON.stringify({ok:true,output,bytes:buffer.length,qa},null,2));
