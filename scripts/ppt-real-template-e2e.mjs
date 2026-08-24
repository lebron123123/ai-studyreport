import fs from "node:fs";
import path from "node:path";
import { analyzeTemplateBuffer } from "../local-server/ppt-template-analyzer.js";
import { enrichCustomTemplatePlan } from "../local-server/ppt-custom-template-export.js";
import { buildNativeTemplatePptx } from "../local-server/ppt-native-template.js";
import { validatePptxBuffer } from "../local-server/ppt-export.js";

const source=process.argv[2]||"C:/Users/HP/Documents/xwechat_files/wxid_8342kac7tkzd22_f6c3/msg/file/2026-08/青年人才住房20260805(3)(2).pptx";
const output=process.argv[3]||path.resolve("outputs","青年人才住房_真实模板自动选页与图片替换_E2E.pptx");
const imagePath=process.argv[4]||path.resolve("outputs","160-template-contact-01.jpg");
if(!fs.existsSync(source))throw new Error("真实模板不存在："+source);
if(!fs.existsSync(imagePath))throw new Error("图片替换测试素材不存在："+imagePath);
const type=path.extname(imagePath).toLowerCase()===".png"?"png":"jpeg";
const imageData=`data:image/${type};base64,${fs.readFileSync(imagePath).toString("base64")}`;
const profile=await analyzeTemplateBuffer(fs.readFileSync(source),path.basename(source));
profile.pages.forEach(page=>{page.review={status:"accepted"};page.status="approved";});
const record={id:"pt_e2e_youth",name:"青年人才住房真实模板",status:"published",profile};
const plan=enrichCustomTemplatePlan({
  title:"青年人才住房项目决策汇报",purpose:"项目决策与审查",audience:"项目决策与审查人员",realTemplateRecordId:record.id,
  slides:[
    {title:"青年人才住房项目决策汇报",layoutId:"cover",templatePage:1,content:{image:imageData}},
    {title:"项目背景与目标",layoutId:"image-hero",templatePage:3,content:{items:[{label:"服务对象",text:"面向重点产业青年人才"},{label:"总体目标",text:"构建职住邻近、配套完善的安居社区"}]}},
    {title:"项目定位与实施路径",layoutId:"timeline",templatePage:7,claim:"统一规划、分期建设、专业运营",content:{steps:[{label:"前期",text:"落实规划与用地条件"},{label:"建设",text:"推动工程与配套同步实施"}]}},
    {title:"规划指标与建设规模",layoutId:"table",templatePage:8,content:{rows:[["总建筑面积","约6.2万平方米"],["主要功能","青年人才住房及配套"]]}},
    {title:"请示事项",layoutId:"conclusion",templatePage:15,bullets:["同意项目定位与建设规模","按计划推进前期工作","协调落实规划、用地和建设条件"]}
  ]
},record);
const buffer=await buildNativeTemplatePptx(plan,{templatePath:source}),qa=await validatePptxBuffer(buffer,plan);
if(!qa.ok)throw new Error("真实模板导出结构校验失败："+qa.errors.join("；"));
if(!buffer.includes(Buffer.from("custom_tpl_p1_s11_1")))throw new Error("图片占位符没有进入最终PPT媒体关系");
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buffer);
console.log(JSON.stringify({ok:true,source,output,slides:qa.slideCount,nativeTemplate:qa.nativeTemplate,warnings:qa.warnings,selectedPages:plan.slides.map(slide=>slide.templatePage),imageSlots:plan.slides.flatMap(slide=>(slide.templateFillPlan.actions||[]).filter(action=>action.action==="replace-image").map(action=>({page:slide.templatePage,sourceId:action.sourceId})))},null,2));
