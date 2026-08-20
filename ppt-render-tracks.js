(function(root){
  "use strict";
  const DATA=new Set(["chart-bar","chart-line","table","image-hero"]);
  function nativeEligible(slide={},plan={}){return plan.templateId==="business-blue-160"&&!DATA.has(slide.layoutId||slide.type);}
  function resolve(slide={},plan={}){const wanted=slide.renderTrack||"auto";if(wanted==="editable")return{track:"editable",reason:"人工指定可编辑组件轨"};if(wanted==="native")return nativeEligible(slide,plan)?{track:"native",reason:"人工指定真实模板轨"}:{track:"editable",reason:"该页含动态图表、表格或图片，自动保留可编辑组件"};if(plan.templateId==="business-blue-160"&&nativeEligible(slide,plan)&&(slide.layoutId||slide.type)==="agenda")return{track:"native",reason:"目录页已通过真实模板文字框安全性验证"};return{track:"editable",reason:"内容与数据优先保持可编辑；未验证安全的模板页不自动替换"};}
  function summarize(plan={}){const rows=(plan.slides||[]).map((s,i)=>({page:i+1,...resolve(s,plan)}));return{rows,native:rows.filter(x=>x.track==="native").length,editable:rows.filter(x=>x.track==="editable").length,hybrid:rows.some(x=>x.track==="native")&&rows.some(x=>x.track==="editable")};}
  function prepare(plan={}){const out=JSON.parse(JSON.stringify(plan)),summary=summarize(out);out.renderTrackSummary=summary;out.hybridTemplate=out.templateId==="business-blue-160"&&summary.hybrid;out.nativeTemplate=out.templateId==="business-blue-160"&&summary.native>0&&!summary.editable;return out;}
  const api={DATA,nativeEligible,resolve,summarize,prepare};root.PptRenderTracks=api;if(root.document)root.document.documentElement.dataset.pptRenderTracks="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
