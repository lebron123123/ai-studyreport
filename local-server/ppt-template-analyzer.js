import JSZip from "jszip";
import { createHash } from "node:crypto";

const xmlDecode=value=>String(value||"")
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
  .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const stripXml=value=>xmlDecode(String(value||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
const textNodes=xml=>Array.from(String(xml||"").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),match=>stripXml(match[1])).filter(Boolean);
const emu=value=>Math.round((Number(value)||0)/914400*1000)/1000;

function attrs(tag=""){
  const out={};
  for(const match of String(tag).matchAll(/([\w:]+)="([^"]*)"/g))out[match[1]]=xmlDecode(match[2]);
  return out;
}

function slotRole(text,pt,y,type,placeholderType=""){
  if(type==="picture"||/pic|obj/i.test(placeholderType))return"picture";
  if(/title|ctrTitle/i.test(placeholderType)||(pt>=24&&y<2.2))return"title";
  if(/subTitle/i.test(placeholderType))return"subtitle";
  if(/来源|数据源|资料|注[:：]/.test(text))return"source";
  if(/%|万元|亿元|㎡|m²|年|个|人|户|公里|km/i.test(text)&&text.length<24)return"metric";
  if(/结论|判断|建议|推荐/.test(text))return"claim";
  if(text.length>30)return"body";
  return"label";
}

export function extractTemplateGeometry(xml=""){
  const blocks=Array.from(String(xml).matchAll(/<(p:sp|p:pic|p:graphicFrame)\b[\s\S]*?<\/\1>/g),match=>match[0]);
  const shapes=[];
  blocks.forEach((block,z)=>{
    const off=block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext=block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const text=textNodes(block).join(" ");
    const sizes=Array.from(block.matchAll(/\bsz="(\d+)"/g),match=>Number(match[1])/100);
    const type=block.startsWith("<p:pic")?"picture":block.startsWith("<p:graphicFrame")?(/<a:tbl\b/.test(block)?"table":/chart/i.test(block)?"chart":"graphic"):"shape";
    const pt=sizes.length?Math.max(...sizes):0,x=emu(off&&off[1]),y=emu(off&&off[2]),w=emu(ext&&ext[1]),h=emu(ext&&ext[2]);
    const nv=block.match(/<p:cNvPr\b[^>]*>/),nvAttrs=attrs(nv&&nv[0]);
    const ph=block.match(/<p:ph\b[^>]*\/?>(?:<\/p:ph>)?/),phAttrs=attrs(ph&&ph[0]);
    const sourceId=nvAttrs.id||String(z+1),sourceName=nvAttrs.name||("shape_"+(z+1));
    const placeholderType=phAttrs.type||"",placeholderIndex=phAttrs.idx||"";
    const role=slotRole(text,pt,y,type,placeholderType),replaceable=!!text||type==="picture"||!!placeholderType;
    shapes.push({
      id:"shape_"+sourceId,sourceId,sourceName,nativeKey:type+":"+sourceId,z,type,x,y,w,h,
      text:text.slice(0,500),fontPt:pt,slot:role,replaceable,
      placeholder:{type:placeholderType,index:placeholderIndex,isNative:!!ph},groupId:null
    });
  });
  const groups=Array.from(String(xml).matchAll(/<p:grpSp\b[\s\S]*?<\/p:grpSp>/g),match=>({
    id:"group_"+(match.index||0),
    shapeCount:(match[0].match(/<p:(?:sp|pic|graphicFrame)\b/g)||[]).length,
    text:textNodes(match[0]).join(" ").slice(0,300)
  }));
  const slots=shapes.filter(shape=>shape.replaceable).map(shape=>({
    shapeId:shape.id,sourceId:shape.sourceId,sourceName:shape.sourceName,nativeKey:shape.nativeKey,
    role:shape.slot,type:shape.type,placeholder:shape.placeholder,
    capacity:shape.type==="picture"?1:Math.max(8,Math.round((shape.w||2)*(shape.h||.5)*18)),
    required:shape.slot==="title"
  }));
  return{canvas:{width:13.333,height:7.5},shapes,groups,slots,editableShapeCount:shapes.length,visualObjectCount:shapes.filter(shape=>shape.type!=="shape"||!shape.text).length};
}

function classify(text,index,total,shape){
  if(index===0)return"cover";
  if(/目录|CONTENTS|AGENDA/i.test(text))return"agenda";
  if(index===total-1&&/谢谢|THANK|结束/i.test(text))return"closing";
  if(/风险|问题|挑战|对策/.test(text))return"risk";
  if(/时间|阶段|里程碑|计划|路径|进度/.test(text))return"plan";
  if(/对比|比较|方案|优劣/.test(text))return"comparison";
  if(/结论|建议|决策|行动/.test(text))return"decision";
  if(shape.chartCount)return"evidence";
  if(shape.tableCount)return"detail";
  if(shape.pictureCount)return"visual";
  return"analysis";
}

function layoutOf(role,shape){
  if(role==="cover")return"cover";
  if(role==="agenda")return"agenda";
  if(role==="plan")return"timeline";
  if(role==="comparison")return"comparison";
  if(role==="risk")return"risk";
  if(shape.chartCount)return"chart-bar";
  if(shape.tableCount)return"table";
  if(shape.pictureCount)return"image-hero";
  return"bullets";
}

function templateCategoryOf(name=""){
  const text=String(name);
  if(/青年人才|人才住房|保障房|住房专题/.test(text))return"talent-housing";
  if(/160页|商务蓝|高级商务/.test(text))return"business-premium";
  return"general-fixed";
}

export async function analyzeTemplateBuffer(input,name="reference.pptx"){
  const buffer=Buffer.isBuffer(input)?input:Buffer.from(input);
  const fingerprint=createHash("sha256").update(buffer).digest("hex"),zip=await JSZip.loadAsync(buffer);
  const slideNames=Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(!slideNames.length)throw new Error("文件中没有可识别的PPT页面");
  const pages=[];
  for(let i=0;i<slideNames.length;i++){
    const xml=await zip.file(slideNames[i]).async("string"),texts=textNodes(xml),joined=texts.join(" "),geometry=extractTemplateGeometry(xml);
    const shape={pictureCount:(xml.match(/<p:pic[ >]/g)||[]).length,chartCount:(xml.match(/graphicData[^>]+chart/g)||[]).length,tableCount:(xml.match(/<a:tbl[ >]/g)||[]).length,shapeCount:(xml.match(/<p:sp[ >]/g)||[]).length,textCount:texts.length,charCount:joined.length};
    const role=classify(joined,i,slideNames.length,shape),layoutId=layoutOf(role,shape),capacity=Math.max(1,Math.min(12,shape.textCount-1||shape.shapeCount-1||4));
    const roleCounts=geometry.slots.reduce((out,slot)=>{out[slot.role]=(out[slot.role]||0)+1;return out;},{});
    pages.push({
      id:"ref:"+fingerprint.slice(0,12)+":"+(i+1),page:i+1,name:texts[0]||("参考页 "+(i+1)),role,roles:[role],layoutId,capacity,
      hasImage:shape.pictureCount>0,hasChart:shape.chartCount>0,hasTable:shape.tableCount>0,shape,geometry,
      slotContract:{slots:geometry.slots,roleCounts,minItems:Math.max(1,Math.min(3,geometry.slots.length)),maxItems:Math.max(1,Math.min(12,geometry.slots.length)),preserveGeometry:true,preserveZOrder:true,fillMode:"shape-id-first",fallbackMode:"semantic-role"},
      sourcePages:[i+1],fingerprint,status:"draft",version:3
    });
  }
  const themeFiles=Object.keys(zip.files).filter(path=>/^ppt\/theme\/theme\d+\.xml$/.test(path));
  const themeXml=themeFiles[0]?await zip.file(themeFiles[0]).async("string"):"";
  const colors=Array.from(themeXml.matchAll(/(?:srgbClr val|sysClr lastClr)="([0-9A-Fa-f]{6})"/g),match=>match[1].toUpperCase()).slice(0,16);
  const fonts=Array.from(themeXml.matchAll(/typeface="([^"]+)"/g),match=>match[1]).filter(Boolean).slice(0,12);
  return{ok:true,name,templateCategory:templateCategoryOf(name),size:buffer.length,fingerprint,slideCount:pages.length,analyzedAt:Date.now(),designTokens:{colors:[...new Set(colors)],fonts:[...new Set(fonts)]},pages};
}
