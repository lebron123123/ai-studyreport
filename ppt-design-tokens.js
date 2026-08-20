/* AI PPT 设计令牌：浏览器与Node共用，来源可追溯到模板主题。 */
(function(root){
  "use strict";
  const TOKENS={
    "anju-blue":{
      id:"anju-blue",name:"安居蓝图｜项目汇报",version:2,source:"深安居品牌视觉与现有产品界面",sourceType:"brand-system",
      colors:{accent:"2387C7",secondary:"70C5DE",light:"A8DDEE",pale:"DDECF7",dark:"173F63",muted:"65839A",background:"F4F9FD",surface:"FFFFFF",border:"C9DEED",link:"176FA8"},
      fonts:{title:"Microsoft YaHei",body:"Microsoft YaHei",fallback:"DengXian"},chartColors:["2387C7","70C5DE","173F63","8EB6D1","A8DDEE","4E9CC9"],
      typography:{cover:38,title:27,section:34,body:15,kpi:31,caption:10,source:8},spacing:{pageX:.72,pageTop:.42,gap:.28,cardGap:.18,footerY:7.12},shape:{radius:.08,borderWidth:.8,shadow:"soft"},motif:"蓝图网格、建筑轮廓、轻盈卡片",rules:{minBodyPt:12,minCaptionPt:9,maxTitleChars:34,dominantColorRatio:.58}
    },
    "gov-clean":{
      id:"gov-clean",name:"政务简洁｜审查汇报",version:2,source:"政务审议与公司审查汇报规范",sourceType:"department-system",
      colors:{accent:"1F4E78",secondary:"A77728",light:"B9C9D5",pale:"E5EEF5",dark:"1E2F3D",muted:"61778A",background:"FFFFFF",surface:"FFFFFF",border:"CBD6DE",link:"1F4E78"},
      fonts:{title:"FangSong",body:"Microsoft YaHei",fallback:"SimSun"},chartColors:["1F4E78","6D8FA8","A77728","B9C9D5","425E72","D7BA83"],
      typography:{cover:36,title:26,section:32,body:15,kpi:28,caption:10,source:8},spacing:{pageX:.82,pageTop:.48,gap:.32,cardGap:.2,footerY:7.08},shape:{radius:.02,borderWidth:1,shadow:"none"},motif:"细线、编号、审议结论条",rules:{minBodyPt:12,minCaptionPt:9,maxTitleChars:32,dominantColorRatio:.72}
    },
    "data-light":{
      id:"data-light",name:"数据浅色｜经营分析",version:2,source:"经营分析和数据看板页面规范",sourceType:"department-system",
      colors:{accent:"167D8D",secondary:"E09F3E",light:"8BC3C8",pale:"DCECEE",dark:"20384B",muted:"668397",background:"F3F8F9",surface:"FFFFFF",border:"C9DDDF",link:"167D8D"},
      fonts:{title:"DengXian",body:"Microsoft YaHei",fallback:"Arial"},chartColors:["167D8D","49A6B1","E09F3E","8BC3C8","31566B","F2C879"],
      typography:{cover:37,title:26,section:33,body:14,kpi:34,caption:9,source:8},spacing:{pageX:.66,pageTop:.38,gap:.24,cardGap:.14,footerY:7.14},shape:{radius:.06,borderWidth:.7,shadow:"subtle"},motif:"指标矩阵、数据刻度、强调色标记",rules:{minBodyPt:11,minCaptionPt:8,maxTitleChars:36,dominantColorRatio:.5}
    },
    "business-blue-160":{
      id:"business-blue-160",name:"高级商务蓝｜组件汇报",version:1,source:"160页高级商务蓝配色.pptx",sourceType:"ppt-theme",
      colors:{accent:"003591",secondary:"5385C5",light:"80AACD",pale:"BBCEE5",dark:"383535",muted:"9EA0A0",background:"FEFFFF",surface:"F6F6F7",border:"D7E1EA",link:"467886"},
      fonts:{title:"DengXian Light",body:"DengXian",fallback:"Microsoft YaHei"},
      chartColors:["003591","5385C5","80AACD","BBCEE5","467886","9EA0A0"],
      typography:{cover:40,title:28,section:36,body:15,kpi:30,caption:10,source:8},
      spacing:{pageX:.72,pageTop:.42,gap:.3,cardGap:.18,footerY:7.12},shape:{radius:.04,borderWidth:.8,shadow:"subtle"},motif:"高密度商务组件、深蓝色块、细线分区",
      rules:{minBodyPt:12,minCaptionPt:9,maxTitleChars:34,dominantColorRatio:.65}
    }
  };
  function get(id){return TOKENS[id]||TOKENS["business-blue-160"];}
  function toTemplatePreset(id="business-blue-160"){
    const t=get(id),c=t.colors;
    return{id:t.id,name:t.name,accent:c.accent,secondary:c.secondary,background:c.background,text:c.dark,description:"来自160页商务蓝模板的可追溯组件化风格",design:{motif:"高密度商务蓝组件系统",density:"high",titleFont:t.fonts.title,bodyFont:t.fonts.body,chartColors:t.chartColors.slice(),source:t.source}};
  }
  const api={TOKENS,get,toTemplatePreset};root.PptDesignTokens=api;if(root.document){root.document.documentElement.dataset.pptDesignTokens="loaded";root.document.documentElement.dataset.pptDesignTokenCount=String(Object.keys(TOKENS).length);}if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
