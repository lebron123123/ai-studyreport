import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";
import { extractTemplateGeometry } from "../local-server/ppt-template-analyzer.js";

const XML_ENTITIES={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
const unescapeXml=value=>String(value||"").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key)=>{
  if(key[0]==="#")return String.fromCodePoint(key[1].toLowerCase()==="x"?parseInt(key.slice(2),16):parseInt(key.slice(1),10));
  return XML_ENTITIES[key.toLowerCase()]||_;
});
const count=(text,re)=>(String(text||"").match(re)||[]).length;
const all=(text,re)=>Array.from(String(text||"").matchAll(re));
const slideNumber=name=>Number((name.match(/slide(\d+)\.xml$/)||[])[1]||0);
const bucket=(value,steps)=>steps.findIndex(limit=>value<=limit)+1;
const top=(map,limit=12)=>Object.entries(map).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([value,total])=>({value,total}));
const bump=(map,key)=>{if(key)map[key]=(map[key]||0)+1;};

function textValues(xml){return all(xml,/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g).map(m=>unescapeXml(m[1]).replace(/\s+/g," ").trim()).filter(Boolean);}
function geometrySignature(xml){
  return all(xml,/<a:off x="(-?\d+)" y="(-?\d+)"\/>[\s\S]{0,260}?<a:ext cx="(\d+)" cy="(\d+)"\/>/g)
    .slice(0,80)
    .map(m=>m.slice(1).map((v,i)=>Math.round(Number(v)/(i<2?1219200:1219200))).join(","))
    .sort()
    .join("|");
}
function relTargets(xml){
  const out={};
  for(const m of all(xml,/<Relationship\b[^>]*Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g))out[m[1]]={type:m[2].split("/").pop(),target:m[3]};
  return out;
}
export function parseThemeXml(xml,name="theme"){
  const scheme=(xml.match(/<a:clrScheme\b[^>]*name="([^"]+)"/)||[])[1]||name,colors={};
  for(const m of all(xml,/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>[\s\S]*?<a:(?:srgbClr\b[^>]*val|sysClr\b[^>]*lastClr)="([0-9A-Fa-f]{6})"[\s\S]*?<\/a:\1>/g))colors[m[1]]=m[2].toUpperCase();
  const major=(xml.match(/<a:majorFont>[\s\S]*?<a:latin\b[^>]*typeface="([^"]*)"/)||[])[1]||"";
  const minor=(xml.match(/<a:minorFont>[\s\S]*?<a:latin\b[^>]*typeface="([^"]*)"/)||[])[1]||"";
  return{name:unescapeXml(scheme),colors,majorFont:unescapeXml(major),minorFont:unescapeXml(minor)};
}
function classifySlide(meta){
  const title=(meta.title||"")+" "+meta.textPreview;
  if(meta.page<=2)return"cover";
  if(/谢谢|thank|汇报完毕|结束/.test(title.toLowerCase()))return"closing";
  if(meta.chartCount>0&&meta.tableCount>0)return"chart-table";
  if(meta.chartCount>0&&meta.textRuns>=10)return"chart-insight";
  if(meta.chartCount>0)return"chart";
  if(meta.tableCount>0)return"table";
  if(meta.connectorCount>=3||/流程|路径|步骤|阶段|时间轴|进度|计划/.test(title))return"process-timeline";
  if(meta.pictureCount>0&&meta.textRuns<=5)return"cover";
  if(meta.pictureCount>0&&meta.textRuns<=12)return"image-story";
  if(meta.groupCount>=3&&meta.shapeCount>=12)return"diagram";
  if(meta.shapeCount>=16&&meta.textRuns>=8)return"cards-grid";
  if(meta.textRuns<=4&&meta.shapeCount<=8)return"section-statement";
  return"text-structure";
}

export function parseSlideXml(xml,{page=0,layout="unknown",relationshipXml=""}={}){
  const texts=textValues(xml),rels=relTargets(relationshipXml),colors={},schemeColors={},fonts={},fontSizes={},geometry=extractTemplateGeometry(xml);
  for(const m of all(xml,/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/g))bump(colors,m[1].toUpperCase());
  for(const m of all(xml,/<a:schemeClr\b[^>]*val="([^"]+)"/g))bump(schemeColors,m[1]);
  for(const m of all(xml,/<a:(?:latin|ea|cs)\b[^>]*typeface="([^"]+)"/g))bump(fonts,unescapeXml(m[1]));
  for(const m of all(xml,/<a:(?:rPr|defRPr|endParaRPr)\b[^>]*sz="(\d+)"/g))bump(fontSizes,String(Math.round(Number(m[1])/100)));
  const relationshipTypes={};Object.values(rels).forEach(r=>bump(relationshipTypes,r.type));
  const meta={
    page,layout,
    title:texts[0]||"",
    textPreview:texts.slice(0,8).join("｜").slice(0,300),
    textRuns:texts.length,textChars:texts.join("").length,
    shapeCount:count(xml,/<p:sp\b/g),pictureCount:count(xml,/<p:pic\b/g),groupCount:count(xml,/<p:grpSp\b/g),
    connectorCount:count(xml,/<p:cxnSp\b/g),graphicFrameCount:count(xml,/<p:graphicFrame\b/g),
    chartCount:count(xml,/<c:chart\b/g),tableCount:count(xml,/<a:tbl>/g),smartArtCount:count(xml,/<dgm:relIds\b/g),
    colors:top(colors,10),schemeColors:top(schemeColors,10),fonts:top(fonts,8),fontSizes:top(fontSizes,10),relationshipTypes,
    geometrySignature:geometrySignature(xml),geometry,
    slotContract:{slots:geometry.slots,minItems:Math.max(1,Math.min(3,geometry.slots.length)),maxItems:Math.max(1,Math.min(12,geometry.slots.length)),preserveGeometry:true,preserveZOrder:true}
  };
  meta.family=classifySlide(meta);
  meta.fingerprint=[meta.family,layout,bucket(meta.shapeCount,[4,8,14,22,35]),bucket(meta.textRuns,[3,6,10,18,30]),bucket(meta.pictureCount,[0,1,3,6]),bucket(meta.chartCount,[0,1,2,4]),bucket(meta.tableCount,[0,1]),bucket(meta.connectorCount,[0,2,6])].join("|");
  return meta;
}

function resolveLayoutTarget(rels){
  const hit=Object.values(relTargets(rels)).find(x=>x.type==="slideLayout");
  return hit?(hit.target.match(/slideLayout\d+\.xml$/)||[])[0]||hit.target:"unknown";
}
function aggregate(slides,zipNames){
  const familyCounts={},layoutCounts={},colorCounts={},schemeColorCounts={},fontCounts={},fontSizeCounts={};
  slides.forEach(s=>{
    bump(familyCounts,s.family);bump(layoutCounts,s.layout);
    s.colors.forEach(x=>{colorCounts[x.value]=(colorCounts[x.value]||0)+x.total;});
    s.schemeColors.forEach(x=>{schemeColorCounts[x.value]=(schemeColorCounts[x.value]||0)+x.total;});
    s.fonts.forEach(x=>{fontCounts[x.value]=(fontCounts[x.value]||0)+x.total;});
    s.fontSizes.forEach(x=>{fontSizeCounts[x.value]=(fontSizeCounts[x.value]||0)+x.total;});
  });
  return{
    slideCount:slides.length,
    layoutCount:zipNames.filter(x=>/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(x)).length,
    masterCount:zipNames.filter(x=>/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(x)).length,
    themeCount:zipNames.filter(x=>/^ppt\/theme\/theme\d+\.xml$/.test(x)).length,
    mediaCount:zipNames.filter(x=>x.startsWith("ppt/media/")&&!x.endsWith("/")).length,
    chartPartCount:zipNames.filter(x=>/^ppt\/charts\/chart\d+\.xml$/.test(x)).length,
    embeddingCount:zipNames.filter(x=>x.startsWith("ppt/embeddings/")&&!x.endsWith("/")).length,
    familyCounts,layoutCounts,topColors:top(colorCounts,18),topSchemeColors:top(schemeColorCounts,12),topFonts:top(fontCounts,16),topFontSizes:top(fontSizeCounts,18)
  };
}
function buildClusters(slides){
  const map=new Map();
  for(const slide of slides){if(!map.has(slide.fingerprint))map.set(slide.fingerprint,[]);map.get(slide.fingerprint).push(slide);}
  return Array.from(map.entries()).map(([fingerprint,items],index)=>({
    clusterId:"cluster_"+String(index+1).padStart(3,"0"),fingerprint,family:items[0].family,layout:items[0].layout,count:items.length,
    representativePage:items.slice().sort((a,b)=>Math.abs(a.textRuns-10)-Math.abs(b.textRuns-10))[0].page,
    pages:items.map(x=>x.page),average:{shapes:+(items.reduce((n,x)=>n+x.shapeCount,0)/items.length).toFixed(1),texts:+(items.reduce((n,x)=>n+x.textRuns,0)/items.length).toFixed(1),pictures:+(items.reduce((n,x)=>n+x.pictureCount,0)/items.length).toFixed(1),charts:+(items.reduce((n,x)=>n+x.chartCount,0)/items.length).toFixed(1)}
  })).sort((a,b)=>b.count-a.count||a.representativePage-b.representativePage).map((x,i)=>({...x,clusterId:"cluster_"+String(i+1).padStart(3,"0")}));
}
function candidateComponents(clusters){
  const priority={"chart-insight":1,"chart-table":1,"process-timeline":1,"cards-grid":1,"diagram":1,chart:2,table:2,"image-story":2,"section-statement":3,cover:3,closing:3,"text-structure":4};
  return clusters.map(c=>({
    candidateId:c.family.replace(/[^a-z-]/g,"")+"_p"+c.representativePage,
    chineseName:{cover:"封面",closing:"结尾页","chart-insight":"图表与洞察","chart-table":"图表与数据表",chart:"数据图表",table:"数据表","process-timeline":"流程与时间轴","image-story":"图片叙事",diagram:"关系图","cards-grid":"卡片矩阵","section-statement":"章节或结论页","text-structure":"结构化文字页"}[c.family]||c.family,
    family:c.family,priority:priority[c.family]||4,sourcePages:c.pages.slice(0,12),representativePage:c.representativePage,frequency:c.count,
    suggestedSlots:c.family.includes("chart")?["title","claim","series","commentary","sources"]:c.family==="table"?["title","headers","rows","sources"]:c.family==="process-timeline"?["title","steps","milestones","sources"]:["title","claim","items","sources"],
    sourceContract:{representativePage:c.representativePage,preserveGeometry:true,preserveZOrder:true,cloneMode:"native-ooxml-group"},
    status:"candidate"
  })).sort((a,b)=>a.priority-b.priority||b.frequency-a.frequency).slice(0,40);
}
function markdownReport(result){
  const a=result.summary,rows=result.clusters.slice(0,30).map(c=>`| ${c.clusterId} | ${c.family} | ${c.count} | ${c.representativePage} | ${c.pages.slice(0,12).join("、")} |`).join("\n");
  const candidates=result.candidateComponents.slice(0,25).map((c,i)=>`| ${i+1} | ${c.chineseName} | ${c.family} | ${c.frequency} | ${c.representativePage} | ${c.priority} |`).join("\n");
  return`# 160页高级商务蓝模板资产盘点\n\n> 自动生成时间：${result.generatedAt}\n> 来源：${result.sourceFile}\n\n## 结构总览\n\n| 项目 | 数量 |\n|---|---:|\n| 幻灯片 | ${a.slideCount} |\n| 版式 | ${a.layoutCount} |\n| 母版 | ${a.masterCount} |\n| 主题 | ${a.themeCount} |\n| 媒体文件 | ${a.mediaCount} |\n| 图表部件 | ${a.chartPartCount} |\n| 嵌入对象 | ${a.embeddingCount} |\n| 自动聚类 | ${result.clusters.length} |\n\n## 主题色方案\n\n${result.themeSchemes.map(t=>`- ${t.name}：${Object.entries(t.colors).map(([k,v])=>`${k}=#${v}`).join("，")}`).join("\n")}\n\n## 页面类型分布\n\n${Object.entries(a.familyCounts).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}：${v}页`).join("\n")}\n\n## 主要颜色\n\n${a.topColors.map(x=>`- #${x.value}：${x.total}次`).join("\n")}\n\n## 主要字体\n\n${a.topFonts.map(x=>`- ${x.value}：${x.total}次`).join("\n")}\n\n## 高频聚类（前30）\n\n| 聚类 | 类型 | 页数 | 代表页 | 页面 |\n|---|---|---:|---:|---|\n${rows}\n\n## 第一批候选组件（前25）\n\n| 序号 | 名称 | 类型 | 频次 | 代表页 | 优先级 |\n|---:|---|---|---:|---:|---:|\n${candidates}\n\n> 注意：候选组件只表示结构相似，不代表已经准入。进入正式组件库前仍需缩略图审查、槽位定义、容量测试和PPTX渲染验证。\n`;
}

export async function inventoryPptx(inputPath){
  const zip=await JSZip.loadAsync(fs.readFileSync(inputPath)),names=Object.keys(zip.files),slideNames=names.filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a,b)=>slideNumber(a)-slideNumber(b)),slides=[];
  for(const name of slideNames){
    const page=slideNumber(name),xml=await zip.file(name).async("string"),relsName=`ppt/slides/_rels/slide${page}.xml.rels`,relationshipXml=zip.file(relsName)?await zip.file(relsName).async("string"):"";
    slides.push(parseSlideXml(xml,{page,layout:resolveLayoutTarget(relationshipXml),relationshipXml}));
  }
  const clusters=buildClusters(slides),themeNames=names.filter(x=>/^ppt\/theme\/theme\d+\.xml$/.test(x)).sort(),themeSchemes=[];
  for(const name of themeNames)themeSchemes.push(parseThemeXml(await zip.file(name).async("string"),path.basename(name)));
  return{schemaVersion:1,generatedAt:new Date().toISOString(),sourceFile:path.basename(inputPath),sourcePath:inputPath,summary:aggregate(slides,names),themeSchemes,slides,clusters,candidateComponents:candidateComponents(clusters)};
}

async function main(){
  const input=process.argv[2],jsonOut=process.argv[3]||path.resolve("outputs/ppt-template-inventory.json"),mdOut=process.argv[4]||path.resolve("outputs/ppt-template-inventory.md");
  if(!input)throw new Error("用法：node scripts/ppt-template-inventory.mjs <模板.pptx> [输出.json] [输出.md]");
  const result=await inventoryPptx(input);fs.mkdirSync(path.dirname(jsonOut),{recursive:true});fs.mkdirSync(path.dirname(mdOut),{recursive:true});fs.writeFileSync(jsonOut,JSON.stringify(result,null,2),"utf8");fs.writeFileSync(mdOut,markdownReport(result),"utf8");
  console.log(JSON.stringify({ok:true,slides:result.summary.slideCount,clusters:result.clusters.length,candidates:result.candidateComponents.length,jsonOut,mdOut},null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
