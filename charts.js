// 图表相关模块 —— 从 index.html 内联脚本拆分而来（现金流图表、竞品价格对比条形图）
function cashflowChartHtml(){
  if(!calcResult) return "";
  const r = calcResult, ys = r.allYears;
  const W=700, H=200, padL=46, padR=16, padT=18, padB=32;
  const nets = ys.map(y=>r.cf[y].net);
  const cums = ys.map(y=>r.cf[y].cumNet);
  const maxV = Math.max(...nets.map(Math.abs), ...cums.map(Math.abs), 1);
  const iw = (W-padL-padR)/ys.length;
  const midY = padT + (H-padT-padB)/2;
  const scaleY = v => midY - (v/maxV)*(H-padT-padB)/2;
  let bars="", labels="", pts=[];
  ys.forEach((y,i)=>{
    const v = nets[i];
    const x = padL + i*iw + iw*0.2, w = iw*0.6;
    const y1 = scaleY(Math.max(v,0)), h = Math.abs(scaleY(v)-midY);
    bars += '<rect class="cfbar'+(v<0?' neg':'')+'" x="'+x.toFixed(1)+'" y="'+y1.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(h,0.5).toFixed(1)+'" style="animation-delay:'+(i*0.05)+'s"/>';
    if(ys.length<=16 || i%2===0){
      labels += '<text class="cfx" x="'+(padL+i*iw+iw/2).toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle">'+y+'</text>';
    }
    pts.push((padL+i*iw+iw/2).toFixed(1)+","+scaleY(cums[i]).toFixed(1));
  });
  let payback="";
  if(r.summary.paybackInfo){
    const pi = ys.indexOf(r.summary.paybackInfo.year);
    if(pi>=0){
      const px=(padL+pi*iw+iw/2).toFixed(1), py=scaleY(cums[pi]).toFixed(1);
      payback = '<path class="cfpay" d="M'+px+' '+(py-9)+' l6 9 l-6 9 l-6 -9 Z"/>'
        +'<text class="cfpay-t" x="'+px+'" y="'+(parseFloat(py)-14)+'" text-anchor="middle">回正</text>';
    }
  }
  return '<div class="cf-chart">'
    +'<div class="cf-head"><span>现金流量走势（万元）</span><span class="cf-legend"><i class="lg-bar"></i>年度净现金流　<i class="lg-line"></i>累计净现金流</span></div>'
    +'<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">'
    +'<line class="cfaxis" x1="'+padL+'" y1="'+midY+'" x2="'+(W-padR)+'" y2="'+midY+'"/>'
    +'<text class="cfx" x="'+(padL-8)+'" y="'+(midY+3)+'" text-anchor="end">0</text>'
    + bars
    +'<polyline class="cfline" points="'+pts.join(" ")+'"/>'
    + payback + labels
    +'</svg></div>';
}

function cpBarSvg(items, unit, color){
  // items: [{name, val}] 简洁柱状图
  const W = 520, H = 210, padL = 34, padR = 10, padT = 26, padB = 44;
  const maxV = Math.max(...items.map(i=>i.val), 1) * 1.15;
  const iw = (W - padL - padR) / items.length;
  const bw = Math.min(iw * 0.52, 64);
  let bars = "", labels = "";
  items.forEach((it, i)=>{
    const h = (it.val / maxV) * (H - padT - padB);
    const x = padL + iw * i + (iw - bw) / 2;
    const y = H - padB - h;
    bars += '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+(it.hl? "var(--seal-red)" : color)+'" opacity="0.88"/>';
    bars += '<text x="'+(x+bw/2).toFixed(1)+'" y="'+(y-6).toFixed(1)+'" text-anchor="middle" style="font-family:var(--mono); font-size:11px; fill:var(--ink);">'+it.val+unit+'</text>';
    const nm = it.name.length>7? it.name.slice(0,6)+"…" : it.name;
    labels += '<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-padB+16)+'" text-anchor="middle" style="font-size:11px; fill:var(--ink-soft);">'+escapeHtml(nm)+(it.hl?'（本项目）':'')+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:auto;">'
    +'<line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-padR)+'" y2="'+(H-padB)+'" stroke="var(--line-strong)" stroke-width="1"/>'
    + bars + labels + '</svg>';
}
function renderCpChart(){
  const box = document.getElementById("cpChartBox");
  if(!box) return;
  readCpFromDom();
  const cps = (project.competitors||[]).filter(c=>c.name);
  const rentItems = cps.filter(c=>parseFloat(c.rent)).map(c=>({name:c.name, val:parseFloat(c.rent)}));
  const occItems = cps.filter(c=>parseFloat(c.occ)).map(c=>({name:c.name, val:parseFloat(c.occ)}));
  // 本项目租金参考(若已做过测算)
  if(calcParams && parseFloat(calcParams.rent)) rentItems.push({name:"本项目", val:parseFloat(calcParams.rent), hl:1});
  if(!rentItems.length && !occItems.length){ box.innerHTML = ""; return; }
  let out = '<div class="grid2" style="gap:14px;">';
  if(rentItems.length) out += '<div class="cf-chart" style="margin:0;"><div class="cf-head"><span>竞品租金对比（元/㎡/月）</span></div>'+cpBarSvg(rentItems, "", "var(--bp-navy)")+'</div>';
  if(occItems.length) out += '<div class="cf-chart" style="margin:0;"><div class="cf-head"><span>竞品出租率对比（%）</span></div>'+cpBarSvg(occItems, "%", "#C99A2E")+'</div>';
  out += '</div>';
  box.innerHTML = out;
}

function cpRowHtml(cp,i){
  return '<div class="cp-row" style="display:flex; gap:6px; margin-top:8px; align-items:center;">'
    +'<input class="cp-name" placeholder="竞品名称" value="'+escapeHtml(cp.name||"")+'" style="flex:1.4;">'
    +'<input class="cp-dist" placeholder="距离(km)" value="'+escapeHtml(cp.dist||"")+'" style="flex:.7;">'
    +'<input class="cp-rent" placeholder="租金(元/㎡/月)" value="'+escapeHtml(cp.rent||"")+'" style="flex:1;">'
    +'<input class="cp-occ" placeholder="出租率(%)" value="'+escapeHtml(cp.occ||"")+'" style="flex:.8;">'
    +'<input class="cp-note" placeholder="备注(户型/特点)" value="'+escapeHtml(cp.note||"")+'" style="flex:1.4;">'
    +'<button type="button" class="btn ghost cp-del" data-ci="'+i+'" style="padding:4px 10px;font-size:11px;">删</button></div>';
}
function readCpFromDom(){
  const names=[...document.querySelectorAll(".cp-name")];
  if(!names.length) return;
  const g=(cls)=>[...document.querySelectorAll(cls)].map(e=>e.value.trim());
  const d=g(".cp-dist"), r=g(".cp-rent"), o=g(".cp-occ"), nt=g(".cp-note");
  project.competitors = names.map((n,i)=>({name:n.value.trim(), dist:d[i], rent:r[i], occ:o[i], note:nt[i]}));
}




