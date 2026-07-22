// 评分/自定义指标模块 —— 从 index.html 内联脚本拆分而来（测算评分规则、自定义指标公式求值）
function safeEval(expr, scope){
  if(!/^[\w\s+\-*/().]+$/.test(expr)) return null;
  const ids = expr.match(/[A-Za-z_]\w*/g) || [];
  for(const id of ids){ if(!(id in scope)) return null; }
  try{
    const keys = Object.keys(scope);
    const fn = new Function(...keys, "return ("+expr+");");
    const v = fn(...keys.map(k=>scope[k]));
    return (typeof v==="number" && isFinite(v))? v : null;
  }catch(e){ return null; }
}
function metricScope(){
  const s = scResult.summary;
  return { totalIncome:s.totalIncome||0, totalCost:s.totalCost||0, totalTax:s.totalTax||0,
    totalNetProfit:s.totalNetProfit||0, totalNpv:s.totalNpv||0, irr:s.irr||0, icr:s.icr||0,
    totalSaleIncome:s.totalSaleIncome||0, rentalPvTotal:s.rentalPvTotal||0, totalInterest:s.totalInterest||0,
    paybackYears: s.payback? s.payback.index : 999 };
}

/* ================= 测算评分 ================= */
const DEFAULT_SCORE_RULES = [
  {name:"全投资IRR（%）", expr:"irr", dir:">=", goodV:6, midV:3, weight:30, scope:"all"},
  {name:"累计净现值（万元）", expr:"totalNpv", dir:">=", goodV:0, midV:"", weight:25, scope:"all"},
  {name:"利息保障倍数", expr:"icr", dir:">=", goodV:2, midV:1, weight:20, scope:"all"},
  {name:"现金流回正（年）", expr:"paybackYears", dir:"<=", goodV:10, midV:15, weight:15, scope:"all"},
  {name:"净利率（%）", expr:"totalNetProfit/totalIncome*100", dir:">=", goodV:10, midV:0, weight:10, scope:"all"},
];
function scoreRules(){
  const rules = (CALC_CFG.score && CALC_CFG.score.length)? CALC_CFG.score : DEFAULT_SCORE_RULES;
  return rules.filter(r=>!r.scope || r.scope==="all" || r.scope===calcType);
}
function evalScore(){
  const scope = metricScope();
  const rows = [];
  let wSum = 0, sSum = 0;
  scoreRules().forEach(r=>{
    const v = safeEval(String(r.expr||""), scope);
    if(v===null) return;
    const cmp = (a,b)=> r.dir==="<="? a<=b : a>=b;
    let band, score;
    const gv = parseFloat(r.goodV), mv = parseFloat(r.midV);
    if(isFinite(gv) && cmp(v, gv)){ band="优"; score=100; }
    else if(isFinite(mv) && cmp(v, mv)){ band="良"; score=60; }
    else{ band="差"; score=20; }
    const w = parseFloat(r.weight)||0;
    wSum += w; sSum += score*w;
    rows.push({name:r.name, v, band, score, w, dir:r.dir, gv:r.goodV, mv:r.midV});
  });
  const total = wSum? Math.round(sSum/wSum) : 0;
  const grade = total>=85? "优" : total>=60? "良" : total>=40? "中" : "差";
  return {total, grade, rows};
}
function scoreCardHtml(){
  const sc = evalScore();
  if(!sc.rows.length) return "";
  const dot = b=> b==="优"? "var(--ok-green)" : b==="良"? "#C99A2E" : "var(--seal-red)";
  const fmt = x=> Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  let rows = sc.rows.map(r=>
    '<tr><td style="text-align:left;">'+escapeHtml(r.name)+'</td>'
    +'<td>'+fmt(r.v)+'</td>'
    +'<td>'+r.dir+' '+r.gv+' 优'+(r.mv!==""&&r.mv!==undefined&&r.mv!==null?'｜'+r.dir+' '+r.mv+' 良':'')+'</td>'
    +'<td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+dot(r.band)+';margin-right:6px;"></span>'+r.band+'</td>'
    +'<td>'+r.score+'</td><td>'+r.w+'%</td></tr>').join("");
  return '<div class="cf-chart" style="margin-top:16px;">'
    +'<div class="cf-head"><span>测算评分（规则可在管理后台配置）</span></div>'
    +'<div style="display:flex; align-items:center; gap:18px; padding:10px 4px 14px;">'
    +'<div style="font-family:var(--mono); font-size:42px; font-weight:700; color:'+dot(sc.grade==="中"?"良":sc.grade)+';">'+sc.total+'</div>'
    +'<div><div style="font-size:15px; font-weight:700;">综合评级：'+sc.grade+'</div>'
    +'<div style="font-size:11px; color:var(--ink-soft);">加权得分（优=100 / 良=60 / 差=20）</div></div></div>'
    +'<table class="rpt"><tr><th style="text-align:left;">指标</th><th>实际值</th><th>达标线</th><th>档位</th><th>得分</th><th>权重</th></tr>'+rows+'</table></div>';
}

function customMetricTiles(){
  if(!scResult || !CALC_CFG.metrics || !CALC_CFG.metrics.length) return "";
  const scope = metricScope();
  let out = "";
  CALC_CFG.metrics.forEach(m=>{
    if(m.scope && m.scope!=="all" && m.scope!==calcType) return;
    const v = safeEval(String(m.expr||""), scope);
    if(v===null) return;
    out += '<div class="metric"><div class="mv">'+v.toLocaleString("zh-CN",{maximumFractionDigits:2})+'</div><div class="ml">'+escapeHtml(m.name||"自定义指标")+'（自定义）</div></div>';
  });
  return out;
}
