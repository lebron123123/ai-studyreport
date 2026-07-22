// 导出相关模块 —— 从 index.html 内联脚本拆分而来（测算Excel导出、报告Word导出、图表转PNG嵌入）
async function exportCalcExcel(){
  const btn = document.getElementById("scExcel");
  if(btn){ btn.disabled=true; btn.textContent="生成 Excel…"; }
  try{
    if(!window.XLSX) await loadScript("xlsx.full.min.js");
    const wb = buildCalcWorkbook();
    const name = (calcType==="gaibao"?"非居改保":calcType==="rent"?"出租类":"出售类")+"测算_"+new Date().toISOString().slice(0,10)+".xlsx";
    window.XLSX.writeFile(wb, name);
  }catch(e){ alert("导出失败："+e.message); }
  if(btn){ btn.disabled=false; btn.textContent="导出 Excel"; }
}
function buildCalcWorkbook(){
  const X = window.XLSX, R = scResult, ys = R.allYears, specs = calcSpecs(), K = calcEffK();
  const wb = X.utils.book_new();
  const col = i => X.utils.encode_col(2+i);   // C 起为年份列

  // 参数页（供公式引用）
  const paramCell = {};
  const pRows = [["参数","键","值","说明"]];
  const pushP = (label,key,val,note)=>{ pRows.push([label,key,val,note||""]); paramCell[key] = "'参数'!$C$"+pRows.length; };
  Object.entries(scParams||{}).forEach(([k,v])=>{ if(typeof v==="number") pushP("输入参数",k,v); else pRows.push(["输入参数",k,String(v),""]); });
  Object.entries(K).forEach(([k,v])=>pushP("计算系数",k,v,"引擎口径/后台配置"));
  pRows.push(["说明","","","本工作簿由可研报告工坊导出：蓝色区域为公式单元格（双击可见引用），修改'参数'页数值后Excel将自动重算；灰底数值来自过程性计算（如弥补亏损、增值税迭代），以导出时引擎结果为准。公式重算与缓存值在小数第4位可能存在±0.0001量级差异。"]);
  const wsP = X.utils.aoa_to_sheet(pRows);
  wsP["!cols"] = [{wch:10},{wch:20},{wch:14},{wch:60}];
  X.utils.book_append_sheet(wb, wsP, "参数");

  // 预登记所有行位置（sheet名+行号），跨表引用需要
  const reg = {};
  specs.forEach(t=>{ t.rows.forEach((r,ri)=>{ if(r.id) reg[r.id] = {sheet:t.sheet, row: ri+2}; }); });
  const ctx = {
    cell:(id,i)=>{ const p=reg[id]; return "'"+p.sheet+"'!"+col(i)+p.row; },
    param:(k)=>{ if(!paramCell[k]) throw new Error("公式引用了未登记参数:"+k); return paramCell[k]; },
  };

  specs.forEach(t=>{
    const ws = {};
    ws["A1"]={t:"s",v:"指标"}; ws["B1"]={t:"s",v:"全周期合计"};
    ys.forEach((y,i)=>{ ws[col(i)+"1"]={t:"s",v:String(y)}; });
    t.rows.forEach((r,ri)=>{
      const row = ri+2;
      ws["A"+row]={t:"s",v:r.l};
      const vals = ys.map(y=>{ try{ return r.g(R,y); }catch(e){ return null; } });
      ys.forEach((y,i)=>{
        const v = vals[i];
        const cellRef = col(i)+row;
        const c = { t:"n", v: (typeof v==="number"&&isFinite(v))? v : 0 };
        if(v===null||v===undefined){ ws[cellRef]={t:"s",v:""}; return; }
        if(r.xf){
          try{
            if(r.xf.sum) c.f = "ROUND("+r.xf.sum.map(id=>ctx.cell(id,i)).join("+")+",4)";
            else if(r.xf.cum){ const p=reg[r.xf.cum]; c.f = "ROUND(SUM('"+p.sheet+"'!$C$"+p.row+":"+col(i)+p.row+"),4)"; }
            else if(r.xf.expr) c.f = r.xf.expr(ctx, i);
          }catch(e){}
        }
        ws[cellRef]=c;
      });
      // 合计列
      if(r.t==="none") ws["B"+row]={t:"s",v:"—"};
      else if(r.t==="last") ws["B"+row]={t:"n", v: vals.filter(v=>v!=null).slice(-1)[0]||0, f: col(ys.length-1)+row};
      else{
        const tot = vals.reduce((s,v)=>s+((typeof v==="number"&&isFinite(v))?v:0),0);
        ws["B"+row]={t:"n", v:tot, f:"ROUND(SUM(C"+row+":"+col(ys.length-1)+row+"),4)"};
      }
    });
    ws["!ref"]="A1:"+col(ys.length-1)+(t.rows.length+1);
    ws["!cols"]=[{wch:30},{wch:14}].concat(ys.map(()=>({wch:12})));
    X.utils.book_append_sheet(wb, ws, t.sheet);
  });
  return wb;
}

let docxLibLoading = null;
function loadScript(src){
  return new Promise((ok,err)=>{
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = ()=>err(new Error("加载失败:"+src));
    document.head.appendChild(s);
  });
}
async function ensureDocxLib(){
  if(window.docx && window.buildDocxDocument) return;
  if(!docxLibLoading){
    docxLibLoading = Promise.all([loadScript("docx.umd.js"), loadScript("docxgen.js")]);
  }
  await docxLibLoading;
}

// HTML → 结构块（段落/表格），供docx构建
function htmlToBlocks(htmlStr){
  const blocks = [];
  const dom = new DOMParser().parseFromString("<div>"+htmlStr+"</div>", "text/html");
  const rootEl = dom.body.firstChild;
  rootEl.childNodes.forEach(node=>{
    if(node.nodeType===3){ const t=node.textContent.trim(); if(t) blocks.push({type:"p", text:t}); return; }
    if(node.nodeType!==1) return;
    if(node.tagName==="TABLE"){
      const rows = [...node.querySelectorAll("tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim()));
      if(rows.length) blocks.push({type:"table", rows});
    }else{
      // 段内<br>视为换行拆段
      node.innerHTML.split(/<br\s*\/?>/i).forEach(seg=>{
        const t = seg.replace(/<[^>]+>/g,"").trim();
        if(t) blocks.push({type:"p", text:t});
      });
    }
  });
  return blocks;
}

function buildExportPayload(){
  const active = chapters.filter(c=>c.checked);
  const secEls = document.querySelectorAll("#sheet .section-block");
  const elMap = {};
  secEls.forEach(el=>{ const b = el.querySelector(".body"); if(el.dataset.cn!==undefined) elMap[el.dataset.cn+'_'+el.dataset.si] = b; });

  const chs = active.map(c=>({ cn:c.cn, name:c.name, num: chapters.indexOf(c)+1,
    sections: c.sections.map((s,si)=>{
      const el = elMap[c.cn+'_'+si];
      const htmlStr = el? el.innerHTML : (s.editedHtml || renderContent(s.content||""));
      return { title:s.title||s.t, blocks: htmlToBlocks(htmlStr) };
    })
  }));

  let appendix = null;
  if(calcResult){
    const r = calcResult, s = r.summary;
    const fmt = x=> x===null? "—" : Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
    const mainRows = [["年份","租金收入","总成本","税金","净利润","净现金流","累计净现金流"]];
    r.allYears.forEach(y=> mainRows.push([y, fmt(r.income[y].rent), fmt(r.cost[y].total), fmt(r.tax[y].total), fmt(r.profit[y].netProfit), fmt(r.cf[y].net), fmt(r.cf[y].cumNet)]));
    let sensRows = null;
    if(r.sens){
      sensRows = [["变动因素","IRR","累计净现值（万元）"]];
      r.sens.forEach(x=> sensRows.push([x.label, x.irr===null?"—":x.irr+" %", fmt(x.npv)]));
    }
    appendix = {
      summaryLine: "全周期总收入 "+fmt(s.totalIncome)+"｜总成本 "+fmt(s.totalCost)+"｜净利润合计 "+fmt(s.totalNetProfit)+"｜累计净现值 "+fmt(s.totalNpv)+"｜IRR "+(s.irr===null?"—":s.irr+"%"),
      mainRows, sensRows,
    };
  }
  return { project: project, signed: signed, docNo: getDocNo(), chapters: chs, appendix };
}

/* ===== 图表转PNG(嵌入Word用) ===== */
const CHART_EXPORT_CSS = ".cfaxis{stroke:#B9B29E;stroke-width:1;stroke-dasharray:3 3;}"
 +".cfbar{fill:#1E3A5C;opacity:.78;}.cfbar.neg{fill:#B7302B;opacity:.6;}"
 +".cfline{fill:none;stroke:#7FB3C8;stroke-width:2.2;stroke-linejoin:round;stroke-dasharray:none !important;stroke-dashoffset:0 !important;animation:none !important;}"
 +".cfx{font-family:Consolas,monospace;font-size:8.5px;fill:#66707A;}"
 +".cfpay{fill:#B7302B;}.cfpay-t{font-family:Consolas,monospace;font-size:9px;fill:#B7302B;}"
 +"text{font-family:'Microsoft YaHei',sans-serif;}";
const CSS_VAR_MAP = {"--bp-navy":"#1E3A5C","--seal-red":"#B7302B","--bp-cyan":"#7FB3C8",
  "--ink":"#1F262B","--ink-soft":"#66707A","--line-strong":"#B9B29E",
  "--mono":"Consolas,monospace","--sans":"'Microsoft YaHei',sans-serif"};
function svgForExport(svgStr){
  let s = svgStr.replace(/var\((--[\w-]+)\)/g, (m,v)=> CSS_VAR_MAP[v] || "#333");
  s = s.replace(/<svg([^>]*)>/, '<svg$1><style>'+CHART_EXPORT_CSS+'</style>');
  if(!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}
function svgToPng(svgStr, w, h){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgForExport(svgStr));
    img.onload = ()=>{
      try{
        const scale = 2;
        const cv = document.createElement("canvas");
        cv.width = w*scale; cv.height = h*scale;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/png").split(",")[1]);   // 纯base64
      }catch(e){ reject(e); }
    };
    img.onerror = ()=>reject(new Error("SVG渲染失败"));
    img.src = url;
  });
}
async function collectReportImages(){
  const imgs = [];
  try{
    // 附图1:现金流走势
    if(calcResult){
      const htmlStr = cashflowChartHtml();
      const m = htmlStr.match(/<svg[\s\S]*?<\/svg>/);
      if(m) imgs.push({title:"附图一　全周期现金流量走势图", b64: await svgToPng(m[0], 700, 200), w:620, h:177});
    }
    // 附图2/3:竞品对比
    const cps = (project.competitors||[]).filter(c=>c.name);
    const rentItems = cps.filter(c=>parseFloat(c.rent)).map(c=>({name:c.name, val:parseFloat(c.rent)}));
    if(calcParams && parseFloat(calcParams.rent)) rentItems.push({name:"本项目", val:parseFloat(calcParams.rent), hl:1});
    const occItems = cps.filter(c=>parseFloat(c.occ)).map(c=>({name:c.name, val:parseFloat(c.occ)}));
    if(rentItems.length >= 2) imgs.push({title:"附图二　周边竞品租金对比（元/㎡/月）", b64: await svgToPng(cpBarSvg(rentItems,"","#1E3A5C"), 520, 210), w:520, h:210});
    if(occItems.length >= 2) imgs.push({title:"附图"+(imgs.length>=2?"三":"二")+"　周边竞品出租率对比（%）", b64: await svgToPng(cpBarSvg(occItems,"%","#C99A2E"), 520, 210), w:520, h:210});
  }catch(e){ console.warn("图表导出失败,跳过:", e.message); }
  return imgs;
}

async function exportWord(){
  const btn = document.getElementById("exportWordBtn");
  if(btn){ btn.disabled = true; btn.textContent = "正在生成 .docx…"; }
  try{
    await ensureDocxLib();
    const payload = buildExportPayload();
    payload.images = await collectReportImages();
    const doc = window.buildDocxDocument(window.docx, payload);
    const blob = await window.docx.Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (project.name||"可行性研究报告")+".docx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){
    alert("导出失败："+e.message);
  }
  if(btn){ btn.disabled = false; btn.textContent = "导出 Word"; }
}


