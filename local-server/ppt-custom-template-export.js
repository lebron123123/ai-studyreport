import { buildShapeFillPlan, buildTemplateContract, selectTemplateContract } from "./ppt-template-contract.js";

const asArray=value=>Array.isArray(value)?value:[];
const clean=(value,max=200)=>String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);

function reviewStatus(page={}){
  return clean(page.review&&page.review.status||page.status,20)||"candidate";
}

export function usableTemplatePages(profile={},options={}){
  const pages=asArray(profile.pages).filter(page=>Number(page.page)>0),published=options.published===true;
  if(!published)return pages.filter(page=>reviewStatus(page)!=="rejected");
  const accepted=pages.filter(page=>reviewStatus(page)==="accepted"||page.status==="approved");
  // 兼容历史上先发布、后增加页面准入字段的模板；新模板一旦存在审核结果，只使用正式准入页。
  const reviewed=pages.some(page=>["accepted","rejected"].includes(reviewStatus(page)));
  return accepted.length||reviewed?accepted:pages.filter(page=>reviewStatus(page)!=="rejected");
}

export function enrichCustomTemplatePlan(plan={},record={},options={}){
  const pages=usableTemplatePages(record.profile||{}, {published:record.status==="published"});
  if(!pages.length)throw new Error("真实模板没有可用于生成的准入页面");
  const contracts=pages.map(page=>buildTemplateContract({
    ...page,
    templateId:record.id,
    name:page.name||record.name||("模板页 "+page.page)
  }));
  const byPage=new Map(contracts.map(contract=>[Number(contract.page),contract])),usedPages=new Set(),slides=[];
  for(const sourceSlide of asArray(plan.slides)){
    const slide={...sourceSlide};
    const requested=Number(slide.templatePage||slide.nativeTemplatePage||0);
    let contract=requested&&byPage.get(requested);
    if(!contract){
      const available=contracts.filter(item=>!usedPages.has(Number(item.page)));
      const selected=selectTemplateContract(available.length?available:contracts,slide,{usedPages});
      contract=selected&&selected.contract;
    }
    if(!contract)throw new Error("没有找到与“"+clean(slide.title||"未命名页面",80)+"”匹配的真实模板页");
    if(usedPages.has(Number(contract.page)))throw new Error("真实模板准入页数量不足，无法为每个输出页保留独立模板页面");
    usedPages.add(Number(contract.page));
    const fill=buildShapeFillPlan(contract,slide,plan);
    slides.push({
      ...slide,
      templateRecordId:record.id,
      templatePage:Number(contract.page),
      nativeTemplatePage:Number(contract.page),
      templateCandidateId:slide.templateCandidateId||contract.contractId,
      templateFillMode:"strict-shape-id",
      templateFillPlan:fill,
      realTemplate:true,
      realTemplateName:record.name||"真实模板"
    });
  }
  return{
    ...plan,
    slides,
    templateId:"custom:"+record.id,
    realTemplateRecordId:record.id,
    realTemplateName:record.name||"真实模板",
    nativeTemplate:true,
    nativeTemplateMode:"explicit-pages",
    templateExportMode:"source-slide-clone",
    templateExportMeta:{recordId:record.id,status:record.status,pageCount:slides.length,legacyReviewFallback:record.status==="published"&&!pages.some(page=>reviewStatus(page)==="accepted")}
  };
}

export const PptCustomTemplateExport={usableTemplatePages,enrichCustomTemplatePlan};
