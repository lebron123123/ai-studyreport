import JSZip from "jszip";
import { createHash } from "node:crypto";

const stripXml=s=>String(s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const textNodes=xml=>Array.from(String(xml||"").matchAll(/<a:t>([\s\S]*?)<\/a:t>/g),m=>stripXml(m[1]).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")).filter(Boolean);
const emu=n=>Math.round((Number(n)||0)/914400*1000)/1000;
function slotRole(text,pt,y){if(pt>=24&&y<2.2)return"title";if(/来源|数据源|资料|注[:：]/.test(text))return"source";if(/%|万元|亿元|㎡|年|个|宗/.test(text)&&text.length<24)return"metric";if(/结论|判断|建议|推荐/.test(text))return"claim";if(text.length>30)return"body";return"label";}
export function extractTemplateGeometry(xml=""){
  const blocks=Array.from(String(xml).matchAll(/<(p:sp|p:pic|p:graphicFrame)\b[\s\S]*?<\/\1>/g),m=>m[0]),shapes=[];
  blocks.forEach((block,z)=>{const off=block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/),ext=block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/),text=textNodes(block).join(" "),sizes=Array.from(block.matchAll(/\bsz="(\d+)"/g),m=>Number(m[1])/100),type=block.startsWith("<p:pic")?"picture":block.startsWith("<p:graphicFrame")?(/<a:tbl\b/.test(block)?"table":/chart/.test(block)?"chart":"graphic"):"shape",pt=sizes.length?Math.max(...sizes):0,x=emu(off&&off[1]),y=emu(off&&off[2]),w=emu(ext&&ext[1]),h=emu(ext&&ext[2]);shapes.push({id:"shape_"+(z+1),z,type,x,y,w,h,text:text.slice(0,500),fontPt:pt,slot:text?slotRole(text,pt,y):type,replaceable:!!text||type==="picture",groupId:null});});
  const groups=Array.from(String(xml).matchAll(/<p:grpSp\b[\s\S]*?<\/p:grpSp>/g),m=>({id:"group_"+(m.index||0),shapeCount:(m[0].match(/<p:(?:sp|pic|graphicFrame)\b/g)||[]).length,text:textNodes(m[0]).join(" ").slice(0,300)}));
  const slots=shapes.filter(x=>x.replaceable).map(x=>({shapeId:x.id,role:x.slot,type:x.type,capacity:x.type==="picture"?1:Math.max(8,Math.round((x.w||2)*(x.h||.5)*18)),required:x.slot==="title"}));
  return{canvas:{width:13.333,height:7.5},shapes,groups,slots,editableShapeCount:shapes.length,visualObjectCount:shapes.filter(x=>x.type!=="shape"||!x.text).length};
}
function classify(text,index,total,shape){
  if(index===0)return"cover";if(/目录|CONTENTS|AGENDA/i.test(text))return"agenda";if(index===total-1&&/谢谢|THANK|结束/i.test(text))return"closing";
  if(/风险|问题|挑战|对策/.test(text))return"risk";if(/时间|阶段|里程碑|计划|路径|进度/.test(text))return"plan";
  if(/对比|比较|方案|优劣/.test(text))return"comparison";if(/结论|建议|决策|行动/.test(text))return"decision";
  if(shape.chartCount)return"evidence";if(shape.tableCount)return"detail";if(shape.pictureCount)return"visual";return"analysis";
}
function layoutOf(role,shape){if(role==="cover")return"cover";if(role==="agenda")return"agenda";if(role==="plan")return"timeline";if(role==="comparison")return"comparison";if(role==="risk")return"risk";if(shape.chartCount)return"chart-bar";if(shape.tableCount)return"table";if(shape.pictureCount)return"image-hero";return"bullets";}
export async function analyzeTemplateBuffer(input,name="reference.pptx"){
  const buffer=Buffer.isBuffer(input)?input:Buffer.from(input),fingerprint=createHash("sha256").update(buffer).digest("hex"),zip=await JSZip.loadAsync(buffer);
  const slideNames=Object.keys(zip.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(!slideNames.length)throw new Error("文件中没有可识别的PPT页面");
  const pages=[];
  for(let i=0;i<slideNames.length;i++){
    const xml=await zip.file(slideNames[i]).async("string"),texts=textNodes(xml),joined=texts.join(" "),geometry=extractTemplateGeometry(xml),shape={pictureCount:(xml.match(/<p:pic[ >]/g)||[]).length,chartCount:(xml.match(/graphicData[^>]+chart/g)||[]).length,tableCount:(xml.match(/<a:tbl[ >]/g)||[]).length,shapeCount:(xml.match(/<p:sp[ >]/g)||[]).length,textCount:texts.length,charCount:joined.length};
    const role=classify(joined,i,slideNames.length,shape),layoutId=layoutOf(role,shape),capacity=Math.max(1,Math.min(12,shape.textCount-1||shape.shapeCount-1||4));
    pages.push({id:"ref:"+fingerprint.slice(0,12)+":"+(i+1),page:i+1,name:texts[0]||("参考页 "+(i+1)),role,roles:[role],layoutId,capacity,hasImage:shape.pictureCount>0,hasChart:shape.chartCount>0,hasTable:shape.tableCount>0,shape,geometry,slotContract:{slots:geometry.slots,minItems:Math.max(1,Math.min(3,geometry.slots.length)),maxItems:Math.max(1,Math.min(12,geometry.slots.length)),preserveGeometry:true,preserveZOrder:true},sourcePages:[i+1],fingerprint,status:"draft",version:2});
  }
  const themeFiles=Object.keys(zip.files).filter(x=>/^ppt\/theme\/theme\d+\.xml$/.test(x)),themeXml=themeFiles[0]?await zip.file(themeFiles[0]).async("string"):"",colors=Array.from(themeXml.matchAll(/(?:srgbClr val|sysClr lastClr)="([0-9A-Fa-f]{6})"/g),m=>m[1].toUpperCase()).slice(0,16),fonts=Array.from(themeXml.matchAll(/typeface="([^"]+)"/g),m=>m[1]).filter(Boolean).slice(0,12);
  return{ok:true,name,size:buffer.length,fingerprint,slideCount:pages.length,analyzedAt:Date.now(),designTokens:{colors:[...new Set(colors)],fonts:[...new Set(fonts)]},pages};
}
