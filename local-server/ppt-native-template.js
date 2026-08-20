import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,"..");
export const NATIVE_TEMPLATE_ID="business-blue-160";

const DEFAULT_TEMPLATE_CANDIDATES=[
  path.join(ROOT,"assets","ppt-templates","business-blue-160.pptx")
];
const DEFAULT_TEMPLATE_DIRS=[
  "C:\\Users\\HP\\Documents\\xwechat_files\\wxid_8342kac7tkzd22_f6c3\\msg\\file\\2026-08",
  "C:\\Users\\HP\\Documents\\xwechat_files\\wxid_8342kac7tkzd22_f6c3\\temp\\RWTemp\\2026-08\\9e20f478899dc29eb19741386f9343c8"
];

// 第一批原生母页：先覆盖最常用且不依赖动态图表数据的页面。
// 同一类准备多个源页，避免一份汇报中重复使用完全相同的构图。
const PAGE_POOLS={
  cover:[1,2,3,4,5],
  section:[6,7,10,11,12,13],
  statement:[57,58,59,60,61,62],
  agenda:[8,9],
  bullets:[57,58,59,60,61,62,63,64,65,66,67,68],
  // 85页的四指标结构比单一“90%”箭头页更适合项目指标，槽位也更稳定。
  metric:[85,77,78,79,80,81,82,83,84,100,101],
  "kpi-tower":[85,77,78,79,80,81,82,83,84],
  // 57页是规则化四栏结构，避免部分箭头页自带竖排页码/装饰文字难以替换。
  comparison:[57,58,59,60,61,62,72,73,74,75,76],
  "two-column":[57,58,59,60,61,62,72,73,74,75,76],
  "three-cards":[77,78,79,100,101,102,103],
  timeline:[28,29,30,31,32,33,34],
  process:[50,51,52,53,54,55,85,86,87],
  risk:[105,106,107,108,109],
  matrix:[105,106,107,108,109],
  "system-map":[72,75,91,92,93,94],
  conclusion:[159,160]
};

const DATA_LAYOUTS=new Set(["chart-bar","chart-line","table","image-hero"]);
const xmlEscape=value=>String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&apos;");
const xmlText=value=>String(value||"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
const clean=(value,max=220)=>String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);

export function resolveNativeTemplatePath(explicitPath=""){
  const candidates=[explicitPath,process.env.PPT_BUSINESS_BLUE_TEMPLATE,...DEFAULT_TEMPLATE_CANDIDATES].filter(Boolean);
  const direct=candidates.find(file=>{try{return fs.statSync(file).isFile();}catch{return false;}});
  if(direct)return direct;
  for(const directory of DEFAULT_TEMPLATE_DIRS){
    try{
      const found=fs.readdirSync(directory).find(name=>/160.*商务蓝.*\.pptx$/i.test(name));
      if(found)return path.join(directory,found);
    }catch{}
  }
  return"";
}

export function nativeTemplateEligible(plan={}){
  if(plan.templateId!==NATIVE_TEMPLATE_ID||plan.nativeTemplate!==true)return false;
  const slides=Array.isArray(plan.slides)?plan.slides:[];
  return slides.length>0&&slides.every(slide=>!DATA_LAYOUTS.has(slide.layoutId||slide.type));
}

function layoutOf(slide={}){
  const id=slide.layoutId||slide.type||"bullets";
  return PAGE_POOLS[id]?id:"bullets";
}

export function selectNativePages(plan={}){
  const used=new Set(),cursor={};
  return (plan.slides||[]).map(slide=>{
    const layout=layoutOf(slide),pool=PAGE_POOLS[layout]||PAGE_POOLS.bullets;
    let page=pool.find(n=>!used.has(n));
    if(!page){const i=cursor[layout]||0;page=pool[i%pool.length];cursor[layout]=i+1;}
    used.add(page);
    return{page,layout};
  });
}

function slideItems(slide={}){
  const data=slide.content||{},out=[];
  const push=(label,text="")=>{label=clean(label,70);text=clean(text,180);if(label||text)out.push({label:label||text,text:text||label});};
  if(Array.isArray(data.metrics))data.metrics.forEach(x=>push(x.value||x.label,x.label||x.text));
  else if(Array.isArray(data.steps))data.steps.forEach(x=>push(x.label||x.title,x.text||x.detail));
  else if(Array.isArray(data.columns))data.columns.forEach(x=>push(x.title,(x.items||[]).map(v=>typeof v==="string"?v:v.text).join("；")));
  else if(Array.isArray(data.items))data.items.forEach(x=>push(typeof x==="string"?x:(x.label||x.title),typeof x==="string"?x:x.text));
  else (slide.bullets||[]).forEach((x,i)=>push("要点"+(i+1),x));
  return out.slice(0,10);
}

function replaceTextRuns(block,value){
  let first=true;
  return block.replace(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g,match=>{
    const next=first?xmlEscape(value):"";first=false;return match.replace(/>([\s\S]*?)<\/a:t>/,">"+next+"</a:t>");
  });
}

function shapeMeta(block,index){
  const texts=Array.from(block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map(m=>xmlText(m[1]));
  const sizes=Array.from(block.matchAll(/\bsz="(\d+)"/g)).map(m=>Number(m[1])/100);
  const off=block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  return{index,text:clean(texts.join(""),500),pt:sizes.length?Math.max(...sizes):0,x:off?Number(off[1])/914400:0,y:off?Number(off[2])/914400:0};
}

function isMarker(text){return /^(?:0?\d{1,3}|\d{1,3}%|[A-Z]|[a-z]\.|[①②③④⑤⑥⑦⑧⑨⑩])$/.test(text);}
function isDecorative(text){return /^(?:Powerpoint|Template|Work Arrangement|WORK RESULT|CONTENTS)$/i.test(text);}
function looksPlaceholder(text){return /Here you can|品牌策划就是|统一品牌策略|项目建设进度安排|项目可行性研究|所谓|工作任务\d*|工作完成情况|工作计划|公司业绩提升|市场人员储备|项目流程管理|部门提升计划|步骤\d+|品牌调研|品牌策划|品牌设计|品牌升级|项目概述|解决方案|关键成果|未来展望|项目目标|背景介绍|实施步骤|创新方式|主要成果|数据支持|未来计划|持续改进|感谢合作|市场化名词|要点\d+/i.test(text);}

export function fillNativeSlideXml(xml,slide={},plan={},sourcePage=0){
  const blocks=Array.from(xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)).map(m=>m[0]);
  const metas=blocks.map(shapeMeta).filter(x=>x.text);
  const items=slideItems(slide),labels=items.map(x=>x.label),descriptions=items.map(x=>x.text),subtitle=clean(slide.subtitle||slide.claim||slide.takeaway||plan.purpose,220),layout=layoutOf(slide);
  let labelIndex=0,descriptionIndex=0,subtitleUsed=false,metricValueIndex=0,metricLabelIndex=0;
  const majors=metas.filter(x=>x.pt>=22&&!isMarker(x.text)&&!/^LOGO$/i.test(x.text)).sort((a,b)=>a.y-b.y||a.x-b.x);
  const majorValues=[];
  if(sourcePage===1||layout==="cover")majorValues.push(clean(plan.title||slide.title,120),clean(slide.subtitle||plan.purpose,150));
  else if(layout==="agenda")majorValues.push(clean(slide.title,120));
  else if(majors.length>1)majorValues.push(clean(plan.title,100),clean(slide.title,120));
  else majorValues.push(clean(slide.title,120));
  const replacements=new Map();
  majors.slice(0,majorValues.length).forEach((m,i)=>replacements.set(m.index,majorValues[i]));

  for(const meta of metas){
    if(replacements.has(meta.index))continue;
    if(["metric","kpi-tower"].includes(layout)&&/^\d+(?:\.\d+)?%$/.test(meta.text)&&metricValueIndex<labels.length){replacements.set(meta.index,labels[metricValueIndex++]);continue;}
    if(isMarker(meta.text))continue;
    if(/^LOGO$/i.test(meta.text)){replacements.set(meta.index,clean(plan.designSpec&&plan.designSpec.brandName||"深安居",40));continue;}
    if(/^THANK YOU$/i.test(meta.text)){replacements.set(meta.index,clean(slide.title||"谢谢",80));continue;}
    if(/^Work Arrangement$/i.test(meta.text)){replacements.set(meta.index,clean(plan.audience||"项目汇报",60));continue;}
    if(/汇报人/.test(meta.text)){replacements.set(meta.index,"汇报人：项目团队");continue;}
    if(/8888年|88月|88日/.test(meta.text)){replacements.set(meta.index,new Date().toLocaleDateString("zh-CN"));continue;}
    if(isDecorative(meta.text))continue;
    if(["metric","kpi-tower"].includes(layout)&&looksPlaceholder(meta.text)&&metricLabelIndex<descriptions.length){replacements.set(meta.index,descriptions[metricLabelIndex++]);continue;}
    if(meta.pt>=16&&meta.text.length<=35&&labelIndex<labels.length){replacements.set(meta.index,labels[labelIndex++]);continue;}
    if((looksPlaceholder(meta.text)||meta.text.length>=18)&&descriptionIndex<descriptions.length){replacements.set(meta.index,descriptions[descriptionIndex++]);continue;}
    if(looksPlaceholder(meta.text)&&labels.length){replacements.set(meta.index,meta.pt>=14?labels[labelIndex++%labels.length]:descriptions[descriptionIndex++%descriptions.length]);continue;}
    if(looksPlaceholder(meta.text)&&subtitle&&!subtitleUsed){replacements.set(meta.index,subtitle);subtitleUsed=true;continue;}
    if(looksPlaceholder(meta.text))replacements.set(meta.index,"");
  }
  if(subtitle&&!subtitleUsed){
    const candidate=metas.find(x=>!replacements.has(x.index)&&x.pt>=11&&x.pt<22&&x.y<2.5&&!isDecorative(x.text));
    if(candidate)replacements.set(candidate.index,subtitle);
  }
  let blockIndex=0;
  return xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g,block=>{
    const current=blockIndex++;
    return replacements.has(current)?replaceTextRuns(block,replacements.get(current)):block;
  });
}

function presentationMaps(presentationXml,relsXml){
  const pageByRid=new Map();
  for(const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="slides\/slide(\d+)\.xml"[^>]*\/?>(?:<\/Relationship>)?/g))pageByRid.set(match[1],Number(match[2]));
  const nodeByPage=new Map();
  for(const match of presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/g)){const page=pageByRid.get(match[1]);if(page)nodeByPage.set(page,match[0]);}
  return nodeByPage;
}

export function replacePresentationSlideList(presentationXml,relsXml,pages){
  const nodeByPage=presentationMaps(presentationXml,relsXml),nodes=pages.map(page=>nodeByPage.get(page)).filter(Boolean);
  if(nodes.length!==pages.length)throw new Error("真实模板页面关系不完整：需要"+pages.length+"页，找到"+nodes.length+"页");
  return presentationXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,"<p:sldIdLst>"+nodes.join("")+"</p:sldIdLst>");
}

export async function buildNativeTemplatePptx(plan,{templatePath=""}={}){
  const source=resolveNativeTemplatePath(templatePath);
  if(!source)throw new Error("未找到160页高级商务蓝模板；请配置 PPT_BUSINESS_BLUE_TEMPLATE");
  if(!nativeTemplateEligible(plan))throw new Error("当前工程包含尚未完成原生数据绑定的图表、表格或图片页");
  const zip=await JSZip.loadAsync(fs.readFileSync(source)),selection=selectNativePages(plan),pages=selection.map(x=>x.page);
  const presentationName="ppt/presentation.xml",relsName="ppt/_rels/presentation.xml.rels";
  const presentationXml=await zip.file(presentationName).async("string"),relsXml=await zip.file(relsName).async("string");
  zip.file(presentationName,replacePresentationSlideList(presentationXml,relsXml,pages));
  for(let i=0;i<pages.length;i++){
    const name="ppt/slides/slide"+pages[i]+".xml",xml=await zip.file(name).async("string");
    zip.file(name,fillNativeSlideXml(xml,plan.slides[i],plan,pages[i]));
  }
  return Buffer.from(await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}}));
}

function hybridTrack(slide={},plan={}){
  const wanted=slide.renderTrack||"auto",eligible=plan.templateId===NATIVE_TEMPLATE_ID&&!DATA_LAYOUTS.has(slide.layoutId||slide.type);
  if(wanted==="editable")return"editable";
  if(wanted==="native")return eligible?"native":"editable";
  return eligible&&["cover","section","agenda"].includes(slide.layoutId||slide.type)?"native":"editable";
}

async function nativeSlideRelationships(templateZip,sourcePage,editableZip,destPage){
  const name=`ppt/slides/_rels/slide${sourcePage}.xml.rels`,file=templateZip.file(name);
  if(!file)return{ok:true,xml:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'};
  let unsupported=false,xml=await file.async("string");const tags=[...xml.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)].map(x=>x[0]),replacements=new Map();
  for(const tag of tags){const type=(tag.match(/Type="([^"]+)"/)||[])[1]||"",target=(tag.match(/Target="([^"]+)"/)||[])[1]||"",external=/TargetMode="External"/.test(tag);if(type.endsWith("/slideLayout")){replacements.set(tag,tag.replace(/Target="[^"]+"/,'Target="../slideLayouts/slideLayout1.xml"'));continue;}if(type.endsWith("/notesSlide")){replacements.set(tag,"");continue;}if(external){replacements.set(tag,tag);continue;}const sourcePart=path.posix.normalize(path.posix.join("ppt/slides",target));if(sourcePart.startsWith("ppt/media/")&&templateZip.file(sourcePart)){const ext=path.posix.extname(sourcePart),destName=`native_s${destPage}_${sourcePage}_${path.posix.basename(sourcePart,ext)}${ext}`;editableZip.file("ppt/media/"+destName,await templateZip.file(sourcePart).async("nodebuffer"));replacements.set(tag,tag.replace(/Target="[^"]+"/,'Target="../media/'+destName+'"'));continue;}unsupported=true;}
  if(unsupported)return{ok:false,xml:""};replacements.forEach((value,key)=>{xml=xml.replace(key,value);});return{ok:true,xml};
}

export async function buildHybridTemplatePptx(plan,editableBuffer,{templatePath=""}={}){
  const source=resolveNativeTemplatePath(templatePath);if(!source)throw new Error("未找到160页高级商务蓝模板");const templateZip=await JSZip.loadAsync(fs.readFileSync(source)),editableZip=await JSZip.loadAsync(editableBuffer),selection=selectNativePages(plan);let nativePages=0;
  for(let i=0;i<(plan.slides||[]).length;i++){const item=plan.slides[i];if(hybridTrack(item,plan)!=="native")continue;const sourcePage=selection[i].page,sourceXmlFile=templateZip.file(`ppt/slides/slide${sourcePage}.xml`);if(!sourceXmlFile)continue;const rels=await nativeSlideRelationships(templateZip,sourcePage,editableZip,i+1);if(!rels.ok)continue;const sourceXml=await sourceXmlFile.async("string");editableZip.file(`ppt/slides/slide${i+1}.xml`,fillNativeSlideXml(sourceXml,item,plan,sourcePage));editableZip.file(`ppt/slides/_rels/slide${i+1}.xml.rels`,rels.xml);nativePages++;}
  if(!nativePages)throw new Error("没有符合真实模板轨条件的页面");return Buffer.from(await editableZip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}}));
}

export const NativeTemplate={PAGE_POOLS,DATA_LAYOUTS,hybridTrack};
