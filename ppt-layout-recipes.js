/* AI PPT整页配方层：同一layoutId可按页面角色、内容密度与数据形态选择不同构图。 */
(function(root){
  "use strict";
  const RECIPES=[
    {id:"cover-city",name:"城市品牌封面",layouts:["cover"],roles:["cover"],density:"low",sourcePages:[1,2]},
    {id:"statement-focus",name:"单结论聚焦",layouts:["statement","section"],roles:["section","decision","summary"],density:"low",sourcePages:[3,4,57]},
    {id:"agenda-modules",name:"模块化目录",layouts:["agenda"],roles:["agenda"],density:"medium",sourcePages:[7,8]},
    {id:"insight-sidebar",name:"结论侧栏要点",layouts:["bullets"],roles:["analysis","evidence","decision"],density:"medium",sourcePages:[9,10,57]},
    {id:"insight-numbered",name:"编号洞察清单",layouts:["bullets"],roles:["analysis","plan"],density:"high",sourcePages:[30,35]},
    {id:"metric-hero",name:"主指标带辅助指标",layouts:["metric","kpi-tower"],roles:["evidence","summary"],density:"medium",sourcePages:[24,119]},
    {id:"metric-dashboard",name:"四指标仪表板",layouts:["metric","kpi-tower"],roles:["evidence","comparison"],density:"high",sourcePages:[24,100]},
    {id:"compare-scorecard",name:"四方案决策卡",layouts:["comparison","two-column"],roles:["comparison","decision"],density:"medium",sourcePages:[19,28,30]},
    {id:"compare-dual",name:"双方案结论对比",layouts:["comparison","two-column"],roles:["comparison"],density:"high",sourcePages:[19,28]},
    {id:"cards-editorial",name:"三项编辑卡",layouts:["three-cards"],roles:["analysis","summary"],density:"medium",sourcePages:[77,100,101]},
    {id:"timeline-milestone",name:"里程碑路线图",layouts:["timeline"],roles:["plan"],density:"medium",sourcePages:[17,20,21]},
    {id:"process-stair",name:"递进式实施路径",layouts:["process"],roles:["plan","decision"],density:"medium",sourcePages:[50,67]},
    {id:"risk-register",name:"风险影响对策板",layouts:["risk"],roles:["risk","decision"],density:"high",sourcePages:[85,105]},
    {id:"matrix-quadrant",name:"四象限分析",layouts:["matrix"],roles:["analysis","comparison"],density:"medium",sourcePages:[72,75]},
    {id:"system-orbit",name:"中心辐射关系图",layouts:["system-map"],roles:["structure","analysis"],density:"medium",sourcePages:[67,91]},
    {id:"chart-commentary",name:"图表与结论侧栏",layouts:["chart-bar","chart-line"],roles:["evidence","trend","comparison"],density:"medium",sourcePages:[119,121,145]},
    {id:"table-insight",name:"数据表与发现",layouts:["table"],roles:["evidence","detail"],density:"high",sourcePages:[16,22,23,25]},
    {id:"decision-board",name:"决策行动看板",layouts:["conclusion"],roles:["conclusion","decision"],density:"medium",sourcePages:[159,160]}
  ];
  const byId=new Map(RECIPES.map(x=>[x.id,x]));
  function roleOf(slide={}){
    const text=[slide.title,slide.claim,slide.takeaway,...(slide.bullets||[])].filter(Boolean).join(" ");
    if(slide.type==="cover")return"cover";if(slide.type==="section")return"section";if(slide.type==="agenda")return"agenda";if(slide.type==="conclusion")return"conclusion";
    if(/风险|问题|难点|应对|对策/.test(text))return"risk";
    if(/对比|比较|方案.{0,8}(选择|比选)|差异|优劣/.test(text))return"comparison";
    if(/计划|进度|工期|阶段|节点|流程|步骤/.test(text))return"plan";
    if(/趋势|同比|环比|历年|逐年/.test(text))return"trend";
    if(/结论|建议|决策|行动|推荐/.test(text))return"decision";
    if(slide.content&&((slide.content.series||[]).length||(slide.content.metrics||[]).length||(slide.content.rows||[]).length))return"evidence";
    return"analysis";
  }
  function densityOf(slide={}){
    const values=[slide.title,slide.subtitle,slide.claim,slide.takeaway,...(slide.bullets||[])].filter(Boolean),chars=values.reduce((n,x)=>n+String(x).length,0),items=Math.max((slide.bullets||[]).length,(slide.content&&slide.content.items||[]).length,(slide.content&&slide.content.metrics||[]).length,(slide.content&&slide.content.series||[]).length,(slide.content&&slide.content.rows||[]).length);
    return chars>260||items>6?"high":chars<90&&items<=3?"low":"medium";
  }
  function score(recipe,slide,context={}){
    if(!recipe.layouts.includes(slide.layoutId))return-999;
    const role=roleOf(slide),density=densityOf(slide);let value=50;
    if(recipe.roles.includes(role))value+=28;if(recipe.density===density)value+=14;
    if(context.previousRecipeId===recipe.id)value-=18;
    if(recipe.id==="compare-scorecard"&&(slide.bullets||[]).length>=3&&!((slide.content||{}).columns||[]).length)value+=16;
    if(recipe.id==="compare-dual"&&((slide.content||{}).columns||[]).length===2)value+=18;
    if(recipe.id==="metric-hero"&&((slide.content||{}).metrics||[]).length<=3)value+=12;
    if(recipe.id==="metric-dashboard"&&((slide.content||{}).metrics||[]).length>=4)value+=14;
    return value;
  }
  function recommend(slide,context={}){
    const candidates=RECIPES.map(x=>({...x,score:score(x,slide,context)})).filter(x=>x.score>-100).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    return{selected:candidates[0]||null,candidates:candidates.slice(0,3),role:roleOf(slide),density:densityOf(slide)};
  }
  const api={recipes:RECIPES,get:id=>byId.get(id)||null,roleOf,densityOf,score,recommend};root.PptLayoutRecipes=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
