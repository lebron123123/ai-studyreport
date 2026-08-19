/* AI PPT 锁定版式库：预览、AI 选型、容量控制与 PPTX 导出共享同一 layoutId。 */
(function(root){
  "use strict";

  const RAW=[
    ["cover","品牌封面","开场建立主题与品牌印象","cover",0,0,"brand"],
    ["section","章节幕","章节切换与节奏留白","section",1,80,"statement"],
    ["statement","一句话结论","只传达一个关键判断","statement",1,120,"statement"],
    ["agenda","目录导航","说明汇报结构与讨论顺序","structure",6,60,"index"],
    ["bullets","要点说明","3—5条非并列复杂要点","text",5,90,"list"],
    ["metric","核心数字","2—4个关键指标或结论数字","data",4,80,"metric"],
    ["kpi-tower","KPI塔","突出4项指标的高低差异","data",4,70,"metric"],
    ["comparison","双栏对比","方案、口径或前后状态对照","compare",6,80,"compare"],
    ["two-column","双栏信息","两组并列但不必比较的信息","compare",8,80,"compare"],
    ["three-cards","三项卡片","三个同层级判断或行动","structure",3,90,"cards"],
    ["timeline","时间轴","按时间推进的阶段与节点","process",6,80,"timeline"],
    ["process","流程路径","具有先后关系的3—6个步骤","process",6,80,"process"],
    ["matrix","四象限矩阵","两个维度形成的2×2分类","analysis",4,90,"matrix"],
    ["risk","风险与对策","风险、影响和应对措施","analysis",4,100,"risk"],
    ["system-map","系统关系图","主体、模块或因果关系","structure",6,80,"diagram"],
    ["chart-bar","原生柱状图","离散类别数值比较","chart",10,40,"chart"],
    ["chart-line","原生折线图","连续时期趋势变化","chart",12,40,"chart"],
    ["table","原生数据表","需要精确阅读的结构化数据","table",8,60,"table"],
    ["image-hero","大图判断","一张核心图片配一句结论","image",3,90,"image"],
    ["conclusion","决策与行动","结论、待决策事项和下一步","closing",5,100,"decision"]
  ];
  const defs=RAW.map(([id,name,use,family,maxItems,maxChars,visualType])=>({
    id,name,use,family,maxItems,maxChars,visualType,
    minBodyPt:["cover","section","statement"].includes(id)?18:14,
    slots:id==="image-hero"?[{id:"hero",ratio:"16:10",required:true}]:[],
    required:id.startsWith("chart-")?["content.series"]:id==="table"?["content.headers","content.rows"]:[]
  }));
  const byId=new Map(defs.map(x=>[x.id,x]));
  function normalizeLayout(id,type){
    if(byId.has(id))return id;
    if(type==="cover")return"cover";
    if(type==="section")return"section";
    if(type==="conclusion")return"conclusion";
    if(type==="agenda")return"agenda";
    return"bullets";
  }
  function contract(id){return byId.get(id)||byId.get("bullets");}
  function isMetricValue(value){
    const text=String(value==null?"":value).trim();
    return text.length>0&&text.length<=24&&/\d/.test(text)&&!/^[^\d]{8,}$/.test(text);
  }
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  const items=s=>Array.isArray(s.content&&s.content.items)?s.content.items:(s.bullets||[]).map((text,i)=>({label:"要点 "+(i+1),text}));
  function title(slide,kicker="PROJECT INSIGHT"){return '<div class="pc-title"><small>'+esc(kicker)+'</small><h2>'+esc(slide.title)+'</h2>'+(slide.subtitle?'<p>'+esc(slide.subtitle)+'</p>':"")+'</div>';}
  function cards(list,count=4){return '<div class="pc-grid">'+list.slice(0,count).map((x,i)=>'<section><em>'+String(i+1).padStart(2,"0")+'</em><b>'+esc(x.label||x.title||"")+'</b><p>'+esc(x.text||x.detail||x)+'</p></section>').join("")+'</div>';}
  function html(slide){
    const id=normalizeLayout(slide.layoutId,slide.type),data=slide.content||{},list=items(slide);
    if(id==="cover")return '<div class="pc-cover-copy"><small>SHENZHEN · HOUSING · DIGITAL</small><h2>'+esc(slide.title)+'</h2><p>'+esc(slide.subtitle||"")+'</p></div><div class="pc-cover-visual"><i></i><i></i><i></i></div>';
    if(id==="section"||id==="statement")return '<div class="pc-statement"><span>'+esc(id==="section"?"SECTION":"KEY TAKEAWAY")+'</span><h2>'+esc(slide.title)+'</h2><p>'+esc(slide.subtitle||(slide.bullets||[])[0]||"")+'</p></div>';
    if(id==="agenda")return title(slide)+'<div class="pc-agenda">'+list.slice(0,6).map((x,i)=>'<div><em>'+String(i+1).padStart(2,"0")+'</em><b>'+esc(x.text||x)+'</b></div>').join("")+'</div>';
    if(id==="metric"||id==="kpi-tower"){const rows=(data.metrics||list).slice(0,4);return title(slide,"KEY METRICS")+'<div class="pc-metrics '+(slide.recipeId==="metric-hero"?'hero ':'')+(id==="kpi-tower"?'tower':'')+'">'+rows.map((x,i)=>'<div><em>'+String(i+1).padStart(2,"0")+'</em><strong>'+esc(x.value||x.text||"—")+'</strong><span>'+esc(x.label||"")+'</span><small>'+esc(x.text&&x.value?x.text:"")+'</small></div>').join("")+'</div>';}
    if(id==="comparison"||id==="two-column"){
      if(slide.recipeId==="compare-scorecard"&&!Array.isArray(data.columns)){const shown=list.slice(0,4),explicit=Number.isInteger(data.recommendedIndex)?data.recommendedIndex:shown.findIndex(x=>/推荐|最优|更适合|更匹配|优先/.test(String(x.text||x)));return title(slide,"DECISION OPTIONS")+'<div class="pc-scorecards">'+shown.map((x,i)=>'<section class="'+(i===explicit?'recommended':'')+'"><em>'+String.fromCharCode(65+i)+'</em><b>'+esc(x.label||("方案"+(i+1)))+'</b><p>'+esc(x.text||x)+'</p>'+(i===explicit?'<small>推荐候选</small>':'')+'</section>').join("")+'</div><div class="pc-verdict"><b>'+(explicit>=0?'建议判断':'比较结论')+'</b><span>'+esc(slide.claim||slide.takeaway||"结合项目阶段、资金节奏和风险承受能力选择")+'</span></div>';}
      const cols=(data.columns||[{title:"方案A",items:list.slice(0,Math.ceil(list.length/2))},{title:"方案B",items:list.slice(Math.ceil(list.length/2))}]).slice(0,2);return title(slide,"DECISION COMPARE")+'<div class="pc-columns">'+cols.map((c,i)=>'<section><em>'+String.fromCharCode(65+i)+'</em><b>'+esc(c.title||("方案"+(i+1)))+'</b><ul>'+(c.items||[]).map(x=>'<li>'+esc(x.text||x)+'</li>').join("")+'</ul></section>').join("")+'</div>'+(slide.claim?'<div class="pc-compare-verdict">'+esc(slide.claim)+'</div>':'');}
    if(id==="three-cards")return title(slide)+cards(list,3);
    if(id==="timeline"||id==="process")return title(slide,id==="timeline"?"MILESTONE ROADMAP":"EXECUTION PATH")+'<div class="pc-steps '+(id==="process"?'stair':'')+'">'+(data.steps||list).slice(0,6).map((x,i)=>'<div><em>'+String(i+1).padStart(2,"0")+'</em><b>'+esc(x.label||x.title||"")+'</b><span>'+esc(x.text||x.detail||"")+'</span></div>').join("")+'</div>';
    if(id==="risk")return title(slide,"RISK CONTROL")+'<div class="pc-risk-grid">'+list.slice(0,4).map((x,i)=>'<section><em>R'+String(i+1).padStart(2,"0")+'</em><b>'+esc(x.label||("风险"+(i+1)))+'</b><p>'+esc(x.text||x)+'</p><small>影响评估 · 应对动作</small></section>').join("")+'</div>';
    if(id==="matrix")return title(slide,"ANALYSIS MATRIX")+cards(list,4);
    if(id==="system-map")return title(slide)+'<div class="pc-system"><strong>'+esc(slide.claim||"核心目标")+'</strong>'+list.slice(0,6).map(x=>'<span>'+esc(x.label||x.text||x)+'</span>').join("")+'</div>';
    if(id==="chart-bar"||id==="chart-line"){const rows=(data.series||[]).slice(0,10),nums=rows.map(x=>Number(String(x.value).replace(/[^\d.-]/g,""))||0),max=Math.max(1,...nums.map(Math.abs));return title(slide,"DATA EVIDENCE")+'<div class="pc-chart-shell"><div class="pc-chart">'+rows.map((x,i)=>'<div><span>'+esc(x.label)+'</span><i style="height:'+Math.max(6,Math.round(Math.abs(nums[i])/max*100))+'%"></i><b>'+esc(x.value)+'</b></div>').join("")+'</div><aside><small>SO WHAT</small><b>'+esc(slide.claim||slide.takeaway||"数据变化支持本页判断")+'</b><p>'+esc((slide.bullets||[]).slice(0,2).join("；"))+'</p></aside></div>';}
    if(id==="table")return title(slide)+'<table class="pc-table">'+(data.headers?'<thead><tr>'+data.headers.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead>':"")+'<tbody>'+(data.rows||[]).slice(0,8).map(r=>'<tr>'+r.slice(0,6).map(x=>'<td>'+esc(x)+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
    if(id==="image-hero")return '<div class="pc-image-hero">'+(data.image?'<img src="'+esc(data.image)+'" alt="">':'<div class="pc-image-placeholder">核心图片 16:10</div>')+'<section><small>VISUAL EVIDENCE</small><h2>'+esc(slide.title)+'</h2><p>'+esc(slide.claim||slide.subtitle||(slide.bullets||[])[0]||"")+'</p></section></div>';
    const heading=id==="conclusion"?"决策与行动":"核心要点";
    if(id==="bullets")return title(slide,"EXECUTIVE INSIGHT")+'<div class="pc-insight-layout"><aside><small>核心判断</small><b>'+esc(slide.claim||slide.takeaway||(slide.bullets||[])[0]||"本页结论待确认")+'</b><span>'+esc(slide.subtitle||"由材料证据与项目数据共同支撑")+'</span></aside><div>'+(slide.bullets||[]).slice(0,6).map((x,i)=>'<section><em>'+String(i+1).padStart(2,"0")+'</em><p>'+esc(x)+'</p></section>').join("")+'</div></div>';
    return title(slide)+'<div class="pc-bullets"><b>'+heading+'</b><ul>'+(slide.bullets||[]).slice(0,6).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>';
  }
  function inspect(slide,index=0){
    const d=contract(slide.layoutId),issues=[],list=items(slide),prefix="第"+(index+1)+"页";
    if(d.maxItems&&list.length>d.maxItems)issues.push({severity:"warning",code:"capacity",message:prefix+"超过“"+d.name+"”建议容量（"+d.maxItems+"项）"});
    if(d.maxChars&&list.some(x=>String(x.text||x).length>d.maxChars))issues.push({severity:"warning",code:"long_text",message:prefix+"存在过长内容，建议拆页或换版式"});
    if(d.required.includes("content.series")&&!Array.isArray(slide.content&&slide.content.series))issues.push({severity:"warning",code:"missing_series",message:prefix+"图表暂以文字占位，补充 series 数据后才会形成原生图表"});
    if(d.required.includes("content.headers")&&!Array.isArray(slide.content&&slide.content.headers))issues.push({severity:"warning",code:"missing_table",message:prefix+"表格暂以文字占位，补充 headers/rows 后才会形成原生表格"});
    if(d.slots.some(x=>x.required)&&!(slide.content&&slide.content.image))issues.push({severity:"warning",code:"missing_image",message:prefix+"大图版式尚未配置图片"});
    if(["metric","kpi-tower"].includes(d.id)){
      const metrics=((slide.content&&slide.content.metrics)||list).slice(0,4);
      if(metrics.filter(x=>isMetricValue(x&&x.value)).length<2)issues.push({severity:"warning",code:"metric_value_not_numeric",message:prefix+"核心数字版式至少需要2项真正的数字；当前内容更适合卡片或对比版式"});
    }
    return issues;
  }
  const api={definitions:defs,normalizeLayout,contract,isMetricValue,inspect,renderHtml:html};
  root.PptComponents=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
