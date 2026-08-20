/* 部门汇报场景预设：只提供可修改的故事线起点，不强制锁定用户大纲。 */
(function(root){
  "use strict";
  const PRESETS={
    "project-progress":{name:"项目进展汇报",keywords:["项目进展","工程进度","建设进展","需协调"],templateId:"anju-blue",density:"medium",chartPreference:["timeline","chart-bar","risk"],outline:[
      ["项目目标与总体进展","metric","summary"],["关键节点完成情况","timeline","progress"],["投资与计划执行情况","chart-bar","finance"],["当前问题与风险","risk","risk"],["需协调事项","bullets","decision"],["下一阶段行动计划","timeline","action"]]},
    "business-review":{name:"经营分析汇报",keywords:["经营分析","经营情况","同比","环比","运营分析"],templateId:"data-light",density:"high",chartPreference:["metric","chart-line","chart-bar"],outline:[
      ["核心经营指标","metric","finance"],["收入成本与趋势变化","chart-line","finance"],["目标完成与同比对照","chart-bar","analysis"],["主要问题与原因分析","risk","risk"],["改进措施与下期目标","timeline","action"]]},
    "leadership-review":{name:"领导审议汇报",keywords:["审议","请示","决策","领导汇报","方案比选"],templateId:"business-blue-160",density:"high",chartPreference:["comparison","metric","risk"],outline:[
      ["项目背景与审议事项","bullets","context"],["核心判断与依据","metric","summary"],["方案比较与推荐意见","comparison","decision"],["财务测算与关键指标","metric","finance"],["主要风险与控制措施","risk","risk"],["提请审议事项","conclusion","decision"]]},
    "party-building":{name:"党建工作汇报",keywords:["党建","党支部","学习教育","主题党日"],templateId:"gov-clean",density:"medium",chartPreference:["timeline","bullets"],outline:[
      ["工作总体情况","bullets","summary"],["理论学习与组织建设","timeline","progress"],["重点活动与工作成效","bullets","evidence"],["存在问题与不足","risk","risk"],["下一步工作计划","timeline","action"]]},
    "performance-report":{name:"述职述廉汇报",keywords:["述职","述廉","履职","年度总结"],templateId:"gov-clean",density:"medium",chartPreference:["metric","timeline","bullets"],outline:[
      ["年度履职总体情况","metric","summary"],["重点工作完成情况","timeline","progress"],["主要成效与经验","bullets","evidence"],["廉洁从业情况","bullets","governance"],["问题不足与改进方向","risk","risk"],["下一年度工作计划","timeline","action"]]}
  };
  const clean=v=>String(v==null?"":v).trim();
  function list(){return Object.entries(PRESETS).map(([id,x])=>({id,name:x.name,templateId:x.templateId,density:x.density}));}
  function recommend(text=""){const t=clean(text),rank=Object.entries(PRESETS).map(([id,p])=>({id,p,score:p.keywords.reduce((n,k)=>n+(t.includes(k)?3:0),0)})).sort((a,b)=>b.score-a.score);return rank[0]&&rank[0].score?{id:rank[0].id,name:rank[0].p.name,score:rank[0].score}:null;}
  function buildOutline(sceneId,total=8){const p=PRESETS[sceneId];if(!p)return[];const body=p.outline.map((x,i)=>({id:"scene_"+sceneId+"_"+(i+1),order:i+2,title:x[0],layoutId:x[1],role:x[2],claim:"",locked:false,sceneGenerated:true}));const out=[{id:"scene_"+sceneId+"_cover",order:1,title:p.name,layoutId:"cover",role:"cover",claim:"",locked:false,sceneGenerated:true},...body];if(out[out.length-1].layoutId!=="conclusion")out.push({id:"scene_"+sceneId+"_end",title:"结论与下一步",layoutId:"conclusion",role:"conclusion",claim:"",locked:false,sceneGenerated:true});while(out.length<Math.max(5,total))out.splice(out.length-1,0,{id:"scene_"+sceneId+"_extra_"+out.length,title:"补充分析",layoutId:"bullets",role:"analysis",claim:"",locked:false,sceneGenerated:true});return out.slice(0,Math.max(5,total)).map((x,i)=>({...x,order:i+1}));}
  function apply(plan={},sceneId,opts={}){const p=PRESETS[sceneId];if(!p)return plan;const out=JSON.parse(JSON.stringify(plan));out.sceneId=sceneId;out.scenePreset={id:sceneId,name:p.name,density:p.density,chartPreference:p.chartPreference.slice(),appliedAt:Date.now()};if(opts.applyTemplate!==false)out.templateId=p.templateId;if(opts.replaceOutline)out.outline=buildOutline(sceneId,Number(out.slideCount)||8);out.updatedAt=Date.now();return out;}
  const api={PRESETS,list,recommend,buildOutline,apply};root.PptScenePresets=api;if(root.document)root.document.documentElement.dataset.pptScenePresets="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
