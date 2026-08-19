/* AI PPT 设计令牌：浏览器与Node共用，来源可追溯到模板主题。 */
(function(root){
  "use strict";
  const TOKENS={
    "business-blue-160":{
      id:"business-blue-160",name:"高级商务蓝｜组件汇报",version:1,source:"160页高级商务蓝配色.pptx",sourceType:"ppt-theme",
      colors:{accent:"003591",secondary:"5385C5",light:"80AACD",pale:"BBCEE5",dark:"383535",muted:"9EA0A0",background:"FEFFFF",surface:"F6F6F7",border:"D7E1EA",link:"467886"},
      fonts:{title:"DengXian Light",body:"DengXian",fallback:"Microsoft YaHei"},
      chartColors:["003591","5385C5","80AACD","BBCEE5","467886","9EA0A0"],
      typography:{cover:40,title:28,section:36,body:15,kpi:30,caption:10,source:8},
      spacing:{pageX:.72,pageTop:.42,gap:.3,cardGap:.18,footerY:7.12},
      rules:{minBodyPt:12,minCaptionPt:9,maxTitleChars:34,dominantColorRatio:.65}
    }
  };
  function get(id){return TOKENS[id]||TOKENS["business-blue-160"];}
  function toTemplatePreset(id="business-blue-160"){
    const t=get(id),c=t.colors;
    return{id:t.id,name:t.name,accent:c.accent,secondary:c.secondary,background:c.background,text:c.dark,description:"来自160页商务蓝模板的可追溯组件化风格",design:{motif:"高密度商务蓝组件系统",density:"high",titleFont:t.fonts.title,bodyFont:t.fonts.body,chartColors:t.chartColors.slice(),source:t.source}};
  }
  const api={TOKENS,get,toTemplatePreset};root.PptDesignTokens=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);

