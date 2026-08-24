const clean=(value,max=500)=>String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);
const asArray=value=>Array.isArray(value)?value:[];

function contentItems(slide={}){
  const content=slide.content||{};
  if(asArray(content.metrics).length)return content.metrics;
  if(asArray(content.steps).length)return content.steps;
  if(asArray(content.columns).length)return content.columns;
  if(asArray(content.items).length)return content.items;
  if(asArray(content.rows).length)return content.rows;
  return asArray(slide.bullets);
}

export function slideContentProfile(slide={}){
  const text=[slide.title,slide.subtitle,slide.claim,slide.takeaway,...asArray(slide.bullets)].map(value=>clean(value)).join(" ");
  const content=slide.content||{},layoutId=slide.layoutId||slide.type||"bullets",items=contentItems(slide);
  const tags=new Set([layoutId]);
  if(/时间|阶段|里程碑|进度|工期|年度|季度/.test(text))tags.add("timeline");
  if(/流程|路径|步骤|闭环|推进/.test(text))tags.add("process");
  if(/问题|不足|挑战|风险/.test(text))tags.add("problem");
  if(/方案|对策|建议|决策/.test(text))tags.add("solution");
  if(/对比|比较|优劣|差异/.test(text))tags.add("comparison");
  if(/业绩|指标|数据|增长|占比|完成率/.test(text))tags.add("metric");
  const images=asArray(content.images).length+(content.image?1:0)+(slide.assetPlan&&slide.assetPlan.dataUrl?1:0);
  return{
    layoutId,itemCount:items.length,textChars:text.length,images,
    needsImage:layoutId==="image-hero"||images>0,
    needsChart:/^chart-/.test(layoutId)||asArray(content.series).length>1,
    needsTable:layoutId==="table"||(asArray(content.headers).length&&asArray(content.rows).length),
    tags:[...tags]
  };
}

export function buildTemplateContract(pageMeta={}){
  const slots=asArray(pageMeta.slotContract&&pageMeta.slotContract.slots).length?pageMeta.slotContract.slots:asArray(pageMeta.geometry&&pageMeta.geometry.slots);
  const roleCounts=slots.reduce((out,slot)=>{out[slot.role]=(out[slot.role]||0)+1;return out;},{});
  const itemCapacity=Math.max(1,Math.min(12,(roleCounts.label||0)+(roleCounts.body||0)+(roleCounts.metric||0)));
  return{
    contractId:(pageMeta.id||"page")+":slots-v1",templateId:pageMeta.templateId||"uploaded-template",page:pageMeta.page,
    name:pageMeta.name||("模板页 "+pageMeta.page),role:pageMeta.role||"analysis",layoutId:pageMeta.layoutId||"bullets",
    slots,roleCounts,itemCapacity,hasImage:!!pageMeta.hasImage,hasChart:!!pageMeta.hasChart,hasTable:!!pageMeta.hasTable,
    preserveGeometry:true,preserveZOrder:true,fillMode:"shape-id-first",fallbackMode:"semantic-role",tags:asArray(pageMeta.tags)
  };
}

export function scoreTemplateContract(contract,slide={},options={}){
  const profile=slideContentProfile(slide),used=options.usedPages||new Set();
  let score=0;
  if(contract.layoutId===profile.layoutId)score+=45;
  if(contract.role===profile.layoutId)score+=20;
  if(contract.tags.some(tag=>profile.tags.includes(tag)))score+=18;
  score+=Math.max(0,18-Math.abs((contract.itemCapacity||1)-Math.max(1,profile.itemCount))*4);
  if(profile.needsImage)score+=contract.hasImage?22:-35;
  if(profile.needsChart)score+=contract.hasChart?25:-40;
  if(profile.needsTable)score+=contract.hasTable?25:-40;
  if(!profile.needsImage&&contract.hasImage)score-=4;
  if(used.has(contract.page))score-=30;
  return Math.round(score);
}

export function selectTemplateContract(contracts,slide={},options={}){
  return asArray(contracts).map(contract=>({contract,score:scoreTemplateContract(contract,slide,options)}))
    .sort((a,b)=>b.score-a.score||a.contract.page-b.contract.page)[0]||null;
}

function valueText(value){
  if(typeof value==="string"||typeof value==="number")return clean(value);
  return clean(value&&(value.value||value.label||value.title||value.text||value.detail));
}

function imageValue(value){
  if(typeof value==="string")return value.trim();
  if(value&&typeof value==="object")return String(value.dataUrl||value.url||value.value||"").trim();
  return"";
}

export function buildShapeFillPlan(contract,slide={},plan={}){
  const profile=slideContentProfile(slide),items=contentItems(slide),content=slide.content||{};
  const queues={
    title:[slide.title||plan.title],subtitle:[slide.subtitle||plan.purpose],claim:[slide.claim||slide.takeaway],
    source:asArray(slide.sources).map(valueText),metric:asArray(content.metrics).flatMap(item=>[valueText(item.value),valueText(item.label)]),
    label:items.map(item=>valueText(item.label||item.title||item)),body:items.map(item=>valueText(item.text||item.detail||item)),
    picture:asArray(content.images).map(imageValue).filter(Boolean)
  };
  if(content.image)queues.picture.unshift(imageValue(content.image));
  if(slide.assetPlan&&slide.assetPlan.dataUrl)queues.picture.unshift(slide.assetPlan.dataUrl);
  const fallback=[...asArray(slide.bullets).map(valueText),slide.claim,slide.takeaway].map(valueText).filter(Boolean);
  const actions=[];
  for(const slot of asArray(contract&&contract.slots)){
    const queue=queues[slot.role]||[];
    let value=queue.shift();
    if(!value&&["label","body","claim"].includes(slot.role))value=fallback.shift();
    if(value)actions.push({shapeId:slot.shapeId,sourceId:slot.sourceId,nativeKey:slot.nativeKey,action:slot.role==="picture"?"replace-image":"replace-text",role:slot.role,value,capacity:slot.capacity});
    else actions.push({shapeId:slot.shapeId,sourceId:slot.sourceId,nativeKey:slot.nativeKey,action:slot.required?"needs-input":"keep",role:slot.role,value:"",capacity:slot.capacity});
  }
  return{contractId:contract&&contract.contractId,page:contract&&contract.page,layoutId:profile.layoutId,actions,complete:!actions.some(action=>action.action==="needs-input")};
}

const range=(start,end,tags,itemCapacity=6)=>Array.from({length:end-start+1},(_,index)=>({page:start+index,tags,itemCapacity}));
export const BUSINESS_BLUE_160_PROFILES=[
  ...range(1,5,["cover"],2),...range(6,10,["agenda"],6),...range(11,15,["section","statement"],2),
  ...range(16,25,["timeline","gantt","plan"],8),...range(26,35,["timeline","milestone"],6),
  ...range(36,50,["process","workflow"],6),...range(51,55,["problem","fishbone"],8),
  ...range(56,65,["metric","result","plan"],5),...range(66,69,["problem","solution"],6),
  ...range(70,82,["summary","logic","comparison","solution"],6),...range(83,101,["strategy","planning","comparison"],6),
  ...range(102,105,["model","swot","framework"],5),...range(106,145,["metric","chart","dashboard"],6),
  ...range(146,155,["summary","decision","framework"],6),...range(156,160,["closing"],2)
].map(profile=>({...profile,contractId:"business-blue-160:p"+profile.page,templateId:"business-blue-160",role:profile.tags[0],layoutId:profile.tags[0],slots:[],roleCounts:{},hasImage:profile.page<=10||profile.page>=156,hasChart:profile.page>=106&&profile.page<=145,hasTable:[19,20,44,105].includes(profile.page),preserveGeometry:true,preserveZOrder:true,fillMode:"shape-id-first",fallbackMode:"semantic-role"}));

export const YOUTH_HOUSING_PROFILES=[
  {pages:[1],tags:["cover"],cap:2,img:true},{pages:[2,16],tags:["agenda"],cap:2,img:true},
  {pages:[3,17,30,31],tags:["site","image-story"],cap:5,img:true},{pages:[4,18,21,32],tags:["map","comparison"],cap:4,img:true},
  {pages:[5,19,28,29,33],tags:["text","analysis"],cap:5},{pages:[6,20],tags:["comparison","analysis"],cap:6},
  {pages:[7],tags:["site","map","analysis"],cap:5,img:true},{pages:[8,22],tags:["table","plan"],cap:8,img:true,table:true},
  {pages:[9,23],tags:["analysis","image-story"],cap:5,img:true},{pages:[10,24],tags:["image-story","architecture"],cap:3,img:true},
  {pages:[11,12,13,25,26,27],tags:["map","evidence","analysis"],cap:6,img:true},{pages:[14],tags:["problem","risk"],cap:6},{pages:[15],tags:["closing","decision"],cap:5}
].flatMap(group=>group.pages.map(page=>({contractId:"youth-housing:p"+page,templateId:"youth-housing",page,name:"青年人才住房模板页 "+page,role:group.tags[0],layoutId:group.tags[0],tags:group.tags,itemCapacity:group.cap,slots:[],roleCounts:{},hasImage:!!group.img,hasChart:false,hasTable:!!group.table,preserveGeometry:true,preserveZOrder:true,fillMode:"shape-id-first",fallbackMode:"semantic-role"})));
