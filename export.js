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

// HTML → 结构块（段落/表格/标题/列表），供docx构建
// 注意：renderContent 现在会产出标题(div带font-weight)、ul/ol列表，
// 若这里不认识就会被压成普通段落、层级全丢，所以要同步识别
function htmlToBlocks(htmlStr){
  const blocks = [];
  const dom = new DOMParser().parseFromString("<div>"+htmlStr+"</div>", "text/html");
  const rootEl = dom.body.firstChild;
  rootEl.childNodes.forEach(node=>{
    if(node.nodeType===3){ const t=node.textContent.trim(); if(t) blocks.push({type:"p", text:t}); return; }
    if(node.nodeType!==1) return;
    const tag = node.tagName;
    if(tag==="TABLE"){
      const rows = [...node.querySelectorAll("tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim()));
      if(rows.length) blocks.push({type:"table", rows});
    }else if(tag==="UL" || tag==="OL"){
      const ordered = tag==="OL";
      [...node.querySelectorAll("li")].forEach((li,idx)=>{
        const t = li.textContent.trim();
        if(t) blocks.push({type:"p", text:(ordered ? (idx+1)+". " : "· ") + t});
      });
    }else if(/^H[1-6]$/.test(tag)){
      const t = node.textContent.trim();
      if(t) blocks.push({type:"h", text:t});
    }else if(tag==="HR"){
      blocks.push({type:"p", text:""});
    }else if(tag==="DIV" && /font-weight:\s*600/.test(node.getAttribute("style")||"")){
      // md.js 产出的标题是带 font-weight:600 的 div
      const t = node.textContent.trim();
      if(t) blocks.push({type:"h", text:t});
    }else if(tag==="BLOCKQUOTE"){
      const t = node.textContent.trim();
      if(t) blocks.push({type:"p", text:t});
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

  // 溯源清单：逐节记录生成依据与置信度，作为附录随报告一并交付（满足可追溯审计要求）
  const provRows = [["章节", "小节", "置信度", "主要依据"]];
  let provCount = 0;
  active.forEach(c=>{
    c.sections.forEach(s=>{
      if(!s.prov || !s.prov.confidence) return;
      provCount++;
      const cf = s.prov.confidence;
      const parts = [];
      if(s.prov.hasCalcData) parts.push("内置公式测算数据");
      if((s.prov.kbDocs||[]).length) parts.push("资料库：" + s.prov.kbDocs.map(d=>d.title).join("、"));
      if((s.prov.rag||[]).length) parts.push("知识库：" + s.prov.rag.map(r=>r.title+"("+r.tier+r.score+")"
        + (r.lifecycle && r.lifecycle!=="valid" ? "⚠"+(r.lifecycleNote||"") : "")).join("；"));
      if((s.prov.examples||[]).length) parts.push("范例：" + s.prov.examples.map(e=>e.title).join("、"));
      if(!parts.length) parts.push("项目信息与模型通用知识");
      provRows.push(["第"+c.cn+"章 "+c.name, s.title||s.t, cf.label+"("+Math.round(cf.score*100)+"分)", parts.join("；")]);
    });
  });
  const provenance = provCount ? { rows: provRows,
    note: "本表记录报告各小节的生成依据与置信度评级，供复核与审计追溯。置信度按素材构成计算：引用内置公式测算数据者最高，有高匹配知识库依据者次之，仅凭项目信息生成者最低。标注⚠的资料存在时效问题，须人工核实后方可作为依据。" } : null;

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
  return { project: project, signed: signed, docNo: getDocNo(), chapters: chs, appendix, provenance };
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

/* ================= 测算说明书 Word 导出 =================
   目的：让复核人看懂"这个数是怎么算出来的"。
   因此每一行输出三样：科目名称、文字公式、全周期合计值。
   只出全周期合计，不逐年铺开——逐年数据看Excel即可，此处重在讲清算法。
*/
const CALC_FORMULA_TEXT = {
  rent: {
    i_resi : "Σ各年（租赁面积 × 租金单价 × 出租率 × 计租月数 ÷ 10000）",
    i_resi1: "住宅租金收入 = 面积 × 单价 × 出租率 × 计租月数 ÷ 10000",
    i_resi2: "政府补贴租金收入 = 补贴面积 × 补贴单价 × 补贴出租率 × 计租月数 ÷ 10000",
    i_park : "车位收入 = 车位数 × 月租金 × 出租率 × 计租月数 × 车位收入系数 ÷ 10000",
    i_oth  : "其他收入（含邮政支局成本回购 = 面积 × 回购单价 ÷ 10000），计入运营首年",
    i_tot  : "总收入 = 住宅租金收入 + 车位收入 + 其他收入",
    c_mgH  : "管理费用（住房）= Σ(各档面积×该档出租率) × 12 × 单位管理费 × 管理系数 ÷ 10000",
    c_mgP  : "管理费用（停车位）= 车位收入 × 车位管理费比率",
    c_ins  : "保险费 = 总建筑面积 × 单位保险费 ÷ 10000（每年一致，不随租赁月数变动）",
    c_rep  : "维修费用 = 住宅租金收入 × 维修费率",
    c_fund : "日常物业维修基金 = Σ(各档面积×该档出租率) × 计租月数 × 单位标准 ÷ 10000",
    c_vac  : "空置期物业管理费 = Σ(各档面积×该档空置率) × 计租月数 × 单位标准 ÷ 10000",
    c_rst  : "装修重置费 = 住宅装修造价 × 重置比率；公租房每20年、保租房每10年重置一次，按分摊年数摊入",
    c_dep  : "折旧摊销 = 总投资 ×(1 − 残值率) ÷ 折旧年限",
    c_op   : "经营成本合计 = 上列各项之和",
    l_beg  : "期初借款余额 = 上年期末借款余额",
    l_int  : "本期计息 =（期初借款 + 本期借款 ÷ 2）× 年利率〔期中借款生息法〕",
    l_rep  : "本期还本 = 总借款 × 首次还本比例，其后逐年按(1+递增率)^n 递增；最后一年还清余额",
    l_end  : "期末借款余额 = 期初 + 本期借款 + 本期计息 − 本期还本 − 本期付息",
    t_vat  : "增值税 = 住宅租金 × 1.5%÷(1+5%) + 车位租金 × 9%÷(1+9%)〔住宅按简易计税〕",
    t_stamp: "印花税 = 总收入 × 0.05% ÷ (1+9%)",
    t_city : "城镇维护建设税 = 增值税 × 7%",
    t_edu  : "教育附加及地方教育附加 = 增值税 × 5%",
    t_prop : "房产税 = 从租〔Σ(各档租金×该档出租率)×4%÷(1+5%) + 车位×12%÷(1+9%)〕+ 从价〔建安费×70%×1.2%÷(1+9%)×空置率×月数÷12〕；前3年免征",
    t_land : "城镇土地使用税 = 用地面积 × 单位税额 ÷ 10000",
    t_tot  : "税金及附加合计 = 上列各项之和",
    p_tot  : "利润总额 = 总收入 − 总成本费用 − 税金及附加",
    p_mk   : "弥补亏损：首次盈利年弥补此前5年亏损，其后按剩余亏损顺延，最长5年",
    p_tax  : "所得税 = 应纳税所得额 × 25%（应纳税所得额 = 利润总额 + 弥补亏损，为负则取0）",
    p_net  : "净利润 = 利润总额 − 所得税",
    f_in   : "现金流入 = 总收入",
    f_out  : "现金流出 = 建设投资 + 税金及附加 + 各项现金经营成本 + 所得税〔不含折旧与财务费用〕",
    f_net  : "净现金流量 = 现金流入 − 现金流出",
    f_npv  : "净现值 = Σ 净现金流量 ÷ (1+折现率)^(n+0.5)",
    f_cum  : "累计净现金流量（由负转正之年即为静态投资回收期）",
  },
};

async function exportCalcWord(){
  // 注意：scResult 在 calc.js 中以 let 声明，不会挂到 window 上，
  // 因此必须直接引用变量名，不能写 window.scResult（恒为 undefined）
  if(!scResult){ alert("请先完成测算"); return; }
  await ensureDocxLib();
  const D = window.docx, R = scResult, P = scParams||{}, type = calcType;
  const specs = calcSpecs(type, R);
  const FT = CALC_FORMULA_TEXT[type] || {};
  const TYPE_CN = {rent:"出租类", gaibao:"非居改保", sale:"出售类"}[type] || type;

  const run=(t,o)=>new D.TextRun(Object.assign({text:String(t), font:"仿宋_GB2312", size:22}, o||{}));
  const para=(t,o,po)=>new D.Paragraph(Object.assign({children:[run(t,o)], spacing:{line:340,lineRule:"exact"}}, po||{}));
  const kids=[];

  kids.push(new D.Paragraph({children:[run(TYPE_CN+"项目财务测算说明书",{font:"方正小标宋简体", size:36})],
    alignment:D.AlignmentType.CENTER, spacing:{line:520,lineRule:"exact", after:120}}));
  kids.push(new D.Paragraph({children:[run("生成时间："+new Date().toLocaleString("zh-CN")+"　｜　本说明书列示各科目的计算公式与全周期合计值，供复核使用",
    {font:"楷体_GB2312", size:19, color:"808080"})],
    alignment:D.AlignmentType.CENTER, spacing:{line:340,lineRule:"exact", after:240}}));

  // ---- 一、主要输入参数 ----
  kids.push(para("一、主要输入参数",{font:"黑体",size:24},{spacing:{line:380,lineRule:"exact",before:160,after:60}}));
  const PL = {buildStart:"建设期起始年", buildYears:"建设期年数", operateYears:"运营期年数",
    firstMonths:"运营首年计租月数", area:"住宅面积（㎡）", rent:"起始租金（元/㎡/月）",
    rentDiscount:"租金折扣系数", subsidyArea:"政府补贴对应面积（㎡）", subsidyPrice:"补贴单价（元/㎡/月）",
    subsidyDiscount:"补贴折扣系数", subsidyStableOcc:"补贴部分出租率",
    rentSpan:"租金递增跨度（年）", rentRate:"租金递增率（%）", rampOcc:"首年出租率", stableOcc:"稳定期出租率",
    parkCount:"车位个数", parkPrice:"车位月租金（元）", parkRatio:"车位收入系数",
    areaPostOffice:"邮政支局面积（㎡）", postOfficePrice:"邮政支局回购单价（元/㎡）",
    otherTotal:"其他收入（万元）", totalBuildArea:"总建筑面积（㎡）", manageCoeff:"管理系数",
    decorationCost:"住宅装修造价（万元）", houseType:"房源类型", totalInvestment:"总投资（万元）",
    landArea:"用地面积（㎡）", constructionCost:"建安工程费（万元）", loanAmount:"总借款额（万元）",
    loanRate:"贷款年利率（%）", firstRepayRatio:"首次还本比例（%）", repayIncreaseRate:"还本递增率（%）",
    loanTotalYears:"借款总年数", discountPct:"折现率（%）"};
  Object.keys(PL).forEach(k=>{
    const v=P[k];
    if(v===undefined || v===null || v==="" || v===0) return;   // 未填或为0的参数不列出，避免干扰阅读
    kids.push(para("　"+PL[k]+"："+v,null,{spacing:{line:320,lineRule:"exact"}}));
  });

  // ---- 二、各科目计算公式与合计 ----
  const CN=["二","三","四","五","六","七","八","九","十"];
  specs.forEach((t,ti)=>{
    kids.push(para((CN[ti]||"")+"、"+t.title,{font:"黑体",size:24},
      {spacing:{line:380,lineRule:"exact",before:200,after:60}}));
    t.rows.forEach(r=>{
      const vals = R.allYears.map(y=>{ try{ return r.g(R,y); }catch(e){ return null; } });
      let total;
      if(r.t==="none") total=null;
      else if(r.t==="last"){ const nn=vals.filter(v=>v!=null); total=nn.length?nn[nn.length-1]:null; }
      else total=vals.reduce((s,v)=>s+(typeof v==="number"&&isFinite(v)?v:0),0);
      const name=String(r.l).replace(/^　+/,"");
      const f = r.id && FT[r.id];
      let tail;
      if(total!=null){
        tail = "　合计：" + Number(total).toLocaleString("zh-CN",{maximumFractionDigits:2})
             + (r.f==="pct"?"":"万元");
      }else{
        // 出租率、单价这类比率/单价行没有"合计"概念，改为列示运营期首末取值，便于核对
        const ops=R.operateArr.map(y=>{ try{ return r.g(R,y); }catch(e){ return null; } })
                              .filter(v=>typeof v==="number"&&isFinite(v));
        if(ops.length){
          const sh=v=> r.f==="pct" ? (v*100).toFixed(1)+"%" : Number(v).toLocaleString("zh-CN",{maximumFractionDigits:2});
          const a=ops[0], b=ops[ops.length-1];
          tail = "　运营期：" + sh(a) + (Math.abs(a-b)>1e-9 ? "（首年）→ "+sh(b)+"（末年）" : "");
        }else tail = "";
      }
      // 科目名 + 全周期合计（或首末取值）
      kids.push(new D.Paragraph({children:[
        run("● "+name, {bold:true}),
        run(tail, {bold:true, color:"1F4E79"}),
      ], spacing:{line:340,lineRule:"exact", before:60}}));
      // 公式说明
      if(f) kids.push(para("　　" + f, {font:"楷体_GB2312", size:21, color:"404040"},
        {spacing:{line:320,lineRule:"exact"}}));
    });
  });

  // ---- 财务指标 ----
  kids.push(para("十一、主要财务指标",{font:"黑体",size:24},{spacing:{line:380,lineRule:"exact",before:200,after:60}}));
  const S=R.summary||{};
  const fmt=v=>Number(v).toLocaleString("zh-CN",{maximumFractionDigits:2});
  const put=(k,v,u)=>{ if(v===undefined||v===null) return;
    kids.push(para("　"+k+"："+(typeof v==="number"?fmt(v):v)+(u||""),null,{spacing:{line:320,lineRule:"exact"}})); };
  put("全周期总收入", S.totalIncome, " 万元");
  put("全周期总成本费用", S.totalCost, " 万元");
  put("全周期税金及附加", S.totalTax, " 万元");
  put("全周期净利润", S.totalNetProfit, " 万元");
  put("全周期利息支出", S.totalInterest, " 万元");
  put("财务净现值（NPV）", S.totalNpv, " 万元");
  put("全投资内部收益率（IRR）", S.irr, "%");
  put("利息保障倍数", S.icr);
  const SPayback = S.payback || S.paybackInfo;
  put("静态投资回收期", SPayback && SPayback.index, " 年（第 "+((SPayback&&SPayback.year)||"—")+" 年转正）");

  kids.push(para("本说明书由系统依据测算引擎自动生成，公式与引擎实际计算逻辑一致；具体逐年数据详见同步导出的Excel测算表。",
    {font:"楷体_GB2312", size:20, color:"808080"}, {spacing:{line:340,lineRule:"exact", before:300}}));

  const doc=new D.Document({sections:[{properties:{page:{size:{width:11906,height:16838},
    margin:{top:1500,right:1400,bottom:1500,left:1400}}}, children:kids}]});
  const blob=await D.Packer.toBlob(doc);
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url;
  a.download=TYPE_CN+"测算说明书-"+Date.now()+".docx"; a.click();
  URL.revokeObjectURL(url);
}