/* AI PPT 动态组件注册表。这里仅描述语义和预览；PPTX 导出器按同一 layoutId 实现对应原生组件。 */
(function(root){
  "use strict";
  const defs=[
    ["cover","封面","标题、场合与汇报对象"],["section","章节过渡","章节标题和一句过渡"],["statement","核心结论","单一重要判断"],
    ["bullets","要点说明","3至5条解释性要点"],["metric","关键指标","2至4个核心数字"],["comparison","方案对比","两组方案或前后状态"],
    ["two-column","双栏分析","并列的两组信息"],["timeline","时间轴","按时间推进的事项"],["process","流程","有先后关系的步骤"],
    ["matrix","二维矩阵","四象限或2×2分类"],["risk","风险与对策","风险、影响和应对"],["chart-bar","柱状图","分类数值比较"],
    ["chart-line","趋势图","连续时期变化"],["table","数据表","需要精确阅读的少量数据"],["conclusion","决策与行动","结论、待决策事项与下一步"]
  ].map(([id,name,use])=>({id,name,use}));
  const ids=new Set(defs.map(x=>x.id));
  function normalizeLayout(id,type){if(ids.has(id))return id;if(type==="cover")return"cover";if(type==="section")return"section";if(type==="conclusion")return"conclusion";return"bullets";}
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  const items=s=>Array.isArray(s.content&&s.content.items)?s.content.items:(s.bullets||[]).map((text,i)=>({label:"要点 "+(i+1),text}));
  function html(slide){
    const id=normalizeLayout(slide.layoutId,slide.type),data=slide.content||{},list=items(slide);
    if(id==="cover")return '<div class="pc-cover-band"></div><div class="pc-cover-copy"><small>SHENZHEN · HOUSING · DIGITAL</small><h2>'+esc(slide.title)+'</h2><p>'+esc(slide.subtitle||"")+'</p></div>';
    if(id==="section"||id==="statement")return '<div class="pc-statement"><span>'+esc(id==="section"?"SECTION":"KEY TAKEAWAY")+'</span><h2>'+esc(slide.title)+'</h2><p>'+esc(slide.subtitle||(slide.bullets||[])[0]||"")+'</p></div>';
    if(id==="metric")return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-metrics">'+(data.metrics||list).slice(0,4).map(x=>'<div><strong>'+esc(x.value||x.text||"—")+'</strong><span>'+esc(x.label||"")+'</span></div>').join("")+'</div>';
    if(id==="comparison"||id==="two-column")return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-columns">'+(data.columns||[{title:"要点一",items:list.slice(0,3)},{title:"要点二",items:list.slice(3)}]).slice(0,2).map(c=>'<section><b>'+esc(c.title||"")+'</b><ul>'+(c.items||[]).map(x=>'<li>'+esc(x.text||x)+'</li>').join("")+'</ul></section>').join("")+'</div>';
    if(id==="timeline"||id==="process")return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-steps">'+(data.steps||list).slice(0,6).map((x,i)=>'<div><em>'+String(i+1).padStart(2,"0")+'</em><b>'+esc(x.label||x.title||"")+'</b><span>'+esc(x.text||x.detail||"")+'</span></div>').join("")+'</div>';
    if(id==="risk"||id==="matrix")return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-grid">'+list.slice(0,4).map(x=>'<section><b>'+esc(x.label||"")+'</b><p>'+esc(x.text||x)+'</p></section>').join("")+'</div>';
    if(id==="chart-bar"||id==="chart-line"){const rows=(data.series||[]).slice(0,8),nums=rows.map(x=>Number(String(x.value).replace(/[^\d.-]/g,""))||0),max=Math.max(1,...nums.map(Math.abs));return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-chart">'+rows.map((x,i)=>'<div><span>'+esc(x.label)+'</span><i style="height:'+Math.max(6,Math.round(Math.abs(nums[i])/max*100))+'%"></i><b>'+esc(x.value)+'</b></div>').join("")+'</div>';}
    if(id==="table")return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><table class="pc-table">'+(data.headers?'<thead><tr>'+data.headers.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead>':"")+'<tbody>'+(data.rows||[]).slice(0,7).map(r=>'<tr>'+r.slice(0,6).map(x=>'<td>'+esc(x)+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
    const heading=id==="conclusion"?"决策建议":"内容要点";return '<div class="pc-title"><i></i><h2>'+esc(slide.title)+'</h2></div><div class="pc-bullets"><b>'+heading+'</b><ul>'+(slide.bullets||[]).slice(0,6).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>';
  }
  const api={definitions:defs,normalizeLayout,renderHtml:html};root.PptComponents=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
