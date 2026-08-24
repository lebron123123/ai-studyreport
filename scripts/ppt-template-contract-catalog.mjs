import fs from "node:fs";
import path from "node:path";
import { buildTemplateContract, BUSINESS_BLUE_160_PROFILES, YOUTH_HOUSING_PROFILES } from "../local-server/ppt-template-contract.js";

const [inventoryPath,templateId,jsonOut,mdOut]=process.argv.slice(2);
if(!inventoryPath||!templateId||!jsonOut||!mdOut)throw new Error("用法：node scripts/ppt-template-contract-catalog.mjs <inventory.json> <templateId> <out.json> <out.md>");

const inventory=JSON.parse(fs.readFileSync(inventoryPath,"utf8"));
const curated=templateId==="business-blue-160"?BUSINESS_BLUE_160_PROFILES:YOUTH_HOUSING_PROFILES;
const curatedByPage=new Map(curated.map(item=>[item.page,item]));
const contracts=inventory.slides.map(slide=>{
  const profile=curatedByPage.get(slide.page)||{};
  const contract=buildTemplateContract({...slide,templateId,tags:profile.tags||[],role:profile.role||slide.family,layoutId:profile.layoutId||slide.family});
  const dynamicReasons=[];
  if(slide.chartCount)dynamicReasons.push("原生图表需绑定真实数据");
  if(slide.tableCount)dynamicReasons.push("表格行列可能变化");
  if((contract.roleCounts.picture||0)>0)dynamicReasons.push("图片需匹配素材槽位");
  return{
    ...contract,family:slide.family,title:slide.title,textPreview:slide.textPreview,shapeCount:slide.shapeCount,
    editableShapeCount:slide.geometry&&slide.geometry.editableShapeCount||0,
    itemCapacity:profile.itemCapacity||contract.itemCapacity,tags:profile.tags||[],
    recommendedTrack:slide.chartCount||slide.tableCount?"dynamic-or-hybrid":"native-placeholder",
    dynamicReasons,status:"visual-reviewed/slot-auto-detected",manualSlotReviewRequired:true
  };
});
const result={schemaVersion:1,generatedAt:new Date().toISOString(),templateId,sourceInventory:inventoryPath,slideCount:contracts.length,contracts};
fs.mkdirSync(path.dirname(jsonOut),{recursive:true});
fs.writeFileSync(jsonOut,JSON.stringify(result,null,2),"utf8");
const rows=contracts.map(item=>`| ${item.page} | ${String(item.title||item.name).replace(/\|/g,"/").slice(0,28)} | ${item.family} | ${item.tags.join("、")||"—"} | ${item.itemCapacity} | ${item.slots.length} | ${item.recommendedTrack} |`).join("\n");
const md=`# ${templateId} 模板逐页合同目录\n\n> 共 ${contracts.length} 页；已完成视觉复核和自动槽位识别，业务槽位仍需在正式准入前人工确认。\n\n| 页码 | 页面标题 | 结构家族 | 语义标签 | 建议容量 | 槽位数 | 推荐轨道 |\n|---:|---|---|---|---:|---:|---|\n${rows}\n`;
fs.writeFileSync(mdOut,md,"utf8");
console.log(JSON.stringify({ok:true,templateId,slides:contracts.length,jsonOut,mdOut},null,2));
