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
function buildSaleWordWorkbook(X,R,p){
  const wb=X.utils.book_new(),E=R.saleEstimate,A=E.allocation||{},ys=R.allYears||[],sch=p.investSchedule||{},plan=R.saleInvestmentPlan||{years:[],rows:[]};
  const at=(obj,y)=>(obj&&obj[y])||{};
  const add=(name,rows,widths)=>{const ws=X.utils.aoa_to_sheet(rows);ws["!cols"]=(widths||[12,30,16,16,42]).map(w=>({wch:w}));ws["!freeze"]={xSplit:2,ySplit:1};X.utils.book_append_sheet(wb,ws,name);};
  const yearTable=(title,rows)=>[[title,"全周期合计"].concat(ys)].concat(rows.map(r=>{
    const vals=ys.map(y=>Number(r.get(y)||0));return [r.name,r.last?vals[vals.length-1]||0:vals.reduce((s,v)=>s+v,0)].concat(vals);
  }));
  add("1技术指标",[["序号","指标","数值","单位","公式/口径"]].concat((E.rows||[]).filter(x=>/^1(\.|$)/.test(x.no)).map(x=>[x.no,x.name,x.value,x.unit||"",x.formula||""])));
  add("2投资估算",[["序号","费用项目","金额（万元）","公式/口径"]].concat((E.rows||[]).filter(x=>{const n=parseInt(x.no,10);return n>=5&&n<=18;}).map(x=>[x.no,x.name,x.value,x.formula||""])),[12,34,18,64]);
  const ab=(side)=>[["公式序号","费用项目","金额（万元）","分摊依据"]].concat((E.allocationRows||[]).map(x=>[side==="a"?String(x.no).split("/")[0]:String(x.no).split("/")[1],x.name,x[side],side==="a"?"计入配售A":"不计入配售B"]));
  add("3计入配售部分",ab("a"));add("4不计入配售部分",ab("b"));
  add("5工期进度",[["序号","工作阶段"].concat((sch.periods||[]).map(x=>x.label))].concat((sch.tasks||[]).map((t,i)=>[i+1,t.name].concat((sch.periods||[]).map((_,q)=>InvestmentSchedule.activePeriods(t,sch.totalQuarters).includes(q)?"■":"")))),[8,22].concat((sch.periods||[]).map(()=>8)));
  add("6投资计划",[["序号","项目名称","合计（万元）"].concat((plan.years||[]).map(y=>y+"年"),["金额来源/公式口径"])].concat((plan.rows||[]).map(r=>[r.no,r.name,r.amount].concat((plan.years||[]).map(y=>(r.annual||{})[y]||0),[r.source||""]))),[12,30,18].concat((plan.years||[]).map(()=>14),[42]));
  const hp=E.housingPrice||{};add("7住房价格",[["序号","价格构成","元/㎡","公式口径"],["46.1","项目地价",hp.landUnit,"公式46"],["46.2","工程建设",hp.engineeringUnit,"公式46"],["46.3","其他工程建设",hp.otherUnit,"公式46"],["46.4","物业维修基金",hp.repairUnit,"公式46"],["46.5","财务成本",hp.financeUnit,"公式46"],["46.6","利润",hp.profitUnit,"公式46"],["46.7","增值税",hp.vatUnit,"公式46"],["46.8","城市维护建设税",hp.cityTaxUnit,"公式46"],["46.9","所得税",hp.incomeTaxUnit,"公式46"],["46","配售住房测算价格",hp.total,"以上各项之和"]]);
  add("8销售收入",yearTable("47~53 销售收入",[
    {name:"47 配保房销售收入",get:y=>at(R.income,y).sale},{name:"47.2 成本价移交收入",get:y=>at(R.income,y).transfer},{name:"48 销售回款",get:y=>(at(R.income,y).sale||0)+(at(R.income,y).transfer||0)},{name:"49 销售税金及附加",get:y=>at(R.cost,y).saleTax},{name:"52 销售费用",get:y=>at(R.cost,y).saleFee},{name:"53 销售净收入",get:y=>(at(R.income,y).sale||0)+(at(R.income,y).transfer||0)-(at(R.cost,y).saleTax||0)-(at(R.cost,y).saleFee||0)}
  ]),[32,16].concat(ys.map(()=>13)));
  add("9租赁收入",yearTable("54~58 租赁收入",[
    {name:"54 商业出租收入",get:y=>R.rental[y]&&R.rental[y].income},{name:"55 租赁税金",get:y=>R.rental[y]&&R.rental[y].taxTotal},{name:"56 租赁运营成本",get:y=>R.rental[y]&&R.rental[y].costTotal},{name:"57 租赁净收入",get:y=>R.rental[y]&&R.rental[y].netIncome},{name:"58 租赁净收益现值",get:y=>R.rental[y]&&R.rental[y].pv}
  ]),[32,16].concat(ys.map(()=>13)));
  add("10损益",yearTable("59~66 损益",[
    {name:"59 总收入",get:y=>at(R.income,y).total},{name:"61 总成本费用",get:y=>at(R.cost,y).total},{name:"62 利润总额",get:y=>at(R.profit,y).total},{name:"63 弥补以前年度亏损",get:y=>at(R.profit,y).makeup},{name:"64 应纳税所得额",get:y=>at(R.profit,y).taxable},{name:"65 所得税",get:y=>at(R.profit,y).incomeTax},{name:"66 净利润",get:y=>at(R.profit,y).net}
  ]),[32,16].concat(ys.map(()=>13)));
  add("11还本付息",yearTable("67 还本付息",[
    {name:"67.1 期初借款余额",get:y=>at(R.loan,y).begin},{name:"67.2 本期借款",get:y=>at(R.loan,y).borrow},{name:"67.3 本期利息",get:y=>at(R.loan,y).interest},{name:"67.4 本期还本",get:y=>at(R.loan,y).repay},{name:"67.5 还本付息合计",get:y=>at(R.loan,y).total},{name:"67.6 期末借款余额",get:y=>at(R.loan,y).end,last:true}
  ]),[32,16].concat(ys.map(()=>13)));
  add("12现金流",yearTable("68~76 全投资及资本金现金流",[
    {name:"68 全投资现金流入",get:y=>at(R.cf,y).inflow},{name:"69 全投资现金流出",get:y=>at(R.cf,y).outflow},{name:"70 全投资净现金流",get:y=>at(R.cf,y).net},{name:"71 累计净现金流",get:y=>at(R.cf,y).cumNet,last:true},{name:"72 年中折现净现值",get:y=>at(R.cf,y).npv},{name:"73 累计净现值",get:y=>at(R.cf,y).cumNpv,last:true},{name:"75 资本金现金流入",get:y=>at(R.capitalCf,y).inflow},{name:"75.2 资本金现金流出",get:y=>at(R.capitalCf,y).outflow},{name:"76 资本金净现金流",get:y=>at(R.capitalCf,y).net},{name:"76.1 累计资本金净现金流",get:y=>at(R.capitalCf,y).cumNet,last:true}
  ]),[34,16].concat(ys.map(()=>13)));
  return wb;
}
function buildCalcWorkbook(){
  const X = window.XLSX, R = scResult, ys = R.allYears, specs = calcSpecs(), K = calcEffK();
  if(calcType==="sale"&&R.saleEstimate)return buildSaleWordWorkbook(X,R,scParams||{});
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

  if(calcType==="sale"&&R.saleEstimate){
    const E=R.saleEstimate,A=E.allocation||{},hp=E.housingPrice||{};
    const fullRows=[["序号","指标","金额/数值","单位","公式/口径","来源"]].concat((E.rows||[]).map(x=>[x.no,x.name,x.value,x.unit||"万元",x.formula||"",x.source||"公式计算"]));
    fullRows.push([], ["A/B分摊恒等式","A部分",A.aBase,"万元"],["A/B分摊恒等式","B部分",A.bBase,"万元"],["A/B分摊恒等式","A+B",Number(A.aBase||0)+Number(A.bBase||0),"万元"],["A/B分摊恒等式","差额",E.reconciliation.totalVsAB,"万元"]);
    const wsF=X.utils.aoa_to_sheet(fullRows);wsF["!cols"]=[{wch:14},{wch:34},{wch:16},{wch:10},{wch:58},{wch:20}];X.utils.book_append_sheet(wb,wsF,"出售全量投资估算");
    const abRows=[["编号","费用类别","计入配售A（万元）","不计入配售B（万元）","合计（万元）","A+B差额"]].concat((E.allocationRows||[]).map(x=>[x.no,x.name,x.a,x.b,x.total,x.difference]));
    const wsAB=X.utils.aoa_to_sheet(abRows);wsAB["!cols"]=[{wch:12},{wch:28},{wch:20},{wch:22},{wch:18},{wch:14}];X.utils.book_append_sheet(wb,wsAB,"19-43配售与非配售分摊");
    const hpRows=[["46 配售住房价格构成","元/㎡"],["项目地价",hp.landUnit],["工程建设",hp.engineeringUnit],["其他工程建设",hp.otherUnit],["物业维修基金",hp.repairUnit],["财务成本",hp.financeUnit],["利润",hp.profitUnit],["增值税",hp.vatUnit],["城市维护建设税",hp.cityTaxUnit],["所得税",hp.incomeTaxUnit],["配售住房测算价格",hp.total]];
    const wsH=X.utils.aoa_to_sheet(hpRows);wsH["!cols"]=[{wch:30},{wch:18}];X.utils.book_append_sheet(wb,wsH,"46配售住房价格");
  }

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
  const sch=scParams&&scParams.investSchedule;
  if(sch&&Array.isArray(sch.periods)&&sch.periods.length){
    const taskRows=[["序号","工作阶段"].concat(sch.periods.map(p=>p.label))];
    (sch.tasks||[]).forEach((t,i)=>taskRows.push([i+1,t.name].concat(sch.periods.map((p,q)=>InvestmentSchedule.activePeriods(t,sch.totalQuarters).includes(q)?"■":""))));
    const wsG=X.utils.aoa_to_sheet(taskRows);wsG["!cols"]=[{wch:7},{wch:22}].concat(sch.periods.map(()=>({wch:8})));
    X.utils.book_append_sheet(wb,wsG,"工期横道图");
    const total=Number(sch.totalInvestment)||0,planRows=[["费用科目","合计（万元）"].concat(sch.periods.map(p=>p.label))];
    (sch.rows||[]).forEach(r=>planRows.push([r.name,r.amount].concat(r.amounts)));
    planRows.push(["季度投资合计",total].concat(sch.quarterTotals||[]));
    planRows.push(["季度投资比例",total?1:0].concat((sch.quarterTotals||[]).map(v=>total?v/total:0)));
    const wsI=X.utils.aoa_to_sheet(planRows);wsI["!cols"]=[{wch:24},{wch:15}].concat(sch.periods.map(()=>({wch:12})));
    X.utils.book_append_sheet(wb,wsI,"季度投资计划");
    const annualRows=[["年度","投资额（万元）","占总投资比例"]].concat(Object.entries(sch.annualPlan||{}).map(([y,v])=>[Number(y),v,total?v/total:0]));
    const wsA=X.utils.aoa_to_sheet(annualRows);wsA["!cols"]=[{wch:12},{wch:18},{wch:18}];X.utils.book_append_sheet(wb,wsA,"年度投资计划");
    if(calcType==="sale"){
      const cp=(scParams&&scParams.saleInvestmentCoefficients)||InvestmentSchedule.coefficientPlan(sch.tasks,sch.periods,isScheduleCfg("sale").coefficientRows,sch.totalQuarters);
      const coeffRows=[["序号","项目名称","合计"].concat(cp.years.map(y=>y+"年"))].concat(cp.rows.map(r=>[r.no,r.name,(r.annualPattern||[]).length?1:null].concat(cp.years.map(y=>r.annualCoefficients[y]||null))));
      const wsC=X.utils.aoa_to_sheet(coeffRows);wsC["!cols"]=[{wch:8},{wch:28},{wch:12}].concat(cp.years.map(()=>({wch:12})));X.utils.book_append_sheet(wb,wsC,"出售类投资计划系数");
      const plan=InvestmentSchedule.saleInvestmentPlan(scParams,scResult,cp),yearStart=3,sourceCol=yearStart+plan.years.length,planRows=[["序号","项目名称","合计（万元）"].concat(plan.years.map(y=>y+"年"),["金额来源/当前口径"])];
      plan.rows.forEach(r=>planRows.push([r.no,r.name,r.amount].concat(plan.years.map(y=>(r.annual||{})[y]||0),[r.source||""])));
      const ws45=X.utils.aoa_to_sheet(planRows),rowNo=Object.fromEntries(plan.rows.map((r,i)=>[r.no,i+2])),coeffRow=Object.fromEntries(cp.rows.map((r,i)=>[r.no,i+2])),coeffYear=Object.fromEntries(cp.years.map((y,i)=>[y,3+i]));
      plan.rows.forEach((r,i)=>{const excelRow=i+2,totalRef="C"+excelRow;if(r.children){ws45[totalRef].f="ROUND("+r.children.map(no=>"C"+rowNo[no]).join("+")+",4)";plan.years.forEach((y,yi)=>{const c=X.utils.encode_col(yearStart+yi)+excelRow;c in ws45&&(ws45[c].f="ROUND("+r.children.map(no=>X.utils.encode_col(yearStart+yi)+rowNo[no]).join("+")+",4)");});return;}
        plan.years.forEach((y,yi)=>{const ref=X.utils.encode_col(yearStart+yi)+excelRow;if(r.annualMode==="direct"){const yearIndex=ys.indexOf(y),loanRow=reg.l_int;if(yearIndex>=0&&loanRow)ws45[ref].f="'"+loanRow.sheet+"'!"+col(yearIndex)+loanRow.row;}
          else if(r.coeffNo&&coeffRow[r.coeffNo]&&coeffYear[y]!=null)ws45[ref].f="ROUND("+totalRef+"*'出售类投资计划系数'!"+X.utils.encode_col(coeffYear[y])+coeffRow[r.coeffNo]+",4)";
          else ws45[ref].f="0";
        });
      });
      ws45["!cols"]=[{wch:12},{wch:28},{wch:16}].concat(plan.years.map(()=>({wch:13})),[{wch:42}]);
      ws45["!freeze"]={xSplit:2,ySplit:1};
      X.utils.book_append_sheet(wb,ws45,"45出售类投资计划表");
    }
  }
  return wb;
}
if(typeof window!=="undefined")window.buildCalcWorkbook=buildCalcWorkbook;
if(typeof module==="object"&&module.exports)module.exports={buildSaleWordWorkbook};

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
      if((s.prov.excelSources||[]).length) parts.push("Excel单元格：" + s.prov.excelSources.map(x=>x.label).join("、"));
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
  gaibao: {
    i_rent : "住宅租金收入 = 收楼后按当年出租率对外出租取得的月租金收入之和",
    i_rat  : "租金收入（不含税）= 住宅租金收入 ÷ (1+销项税率)",
    c_col  : "收楼成本 = 收楼单价 × 面积 × 出租率 × 计租月数 ÷ 10000",
    c_eng  : "工程费用（装修摊销）= 首次装修与历次重装造价之和，按运营期总月数摊销到当年",
    c_op   : "运营费用 = 单套月运营成本 × 总套数 × 计租月数 ÷ 10000（首年另加开办费）",
    c_fin  : "财务费用 = 还本付息表当年本期利息",
    c_shr  : "合作分成支出 = 住宅租金收入 × 业主分成比例（仅「减租金合作分成」模式适用，整租模式为0）",
    c_tot  : "总成本费用 = 收楼成本 + 工程费用 + 运营费用 + 财务费用 + 合作分成支出",
    c_totAT: "总成本费用（不含税）= (收楼成本+工程费用)÷(1+销项税率) + 运营费用÷(1+运营税率) + 财务费用÷(1+运营税率，financeCost>0时)",
    l_beg  : "期初借款余额 = 上年期末借款余额",
    l_bor  : "本期借款 = 用户设定的当年借款投放额（默认全额计入建设期首年）",
    l_int  : "本期利息 = MAX((期初借款+本期借款÷2)×年利率÷100×利率折扣×计息本金÷总借款,0)〔计息本金/总借款用于按比例缩放实际计息基数〕",
    l_rep  : "本期还本 = 年均还款额（运营第2年起，用户设定的固定还款计划）",
    l_pay  : "还本付息合计 = 本期还本 + 本期利息",
    l_end  : "期末借款余额 = MAX(期初借款+本期借款−本期还本,0)",
    t_out  : "销项税额 = 住宅租金收入÷(1+销项税率)×销项税率",
    t_in   : "进项税额 = 工程费用×销项税率÷(1+销项税率) + (运营费用+财务费用)×运营税率÷(1+运营税率)",
    t_vat  : "增值税 = MAX(销项税额−进项税额,0)",
    t_sur  : "增值税附加 = 增值税 × 附加税率",
    t_stp  : "印花税",
    t_tot  : "税金及附加总和 = 增值税 + 增值税附加 + 印花税",
    p_iat  : "营业收入（不含税）= 租金收入（不含税）",
    p_cat  : "营业成本（不含税）= 总成本费用（不含税）",
    p_tot  : "利润总额 = 营业收入（不含税）− 营业成本（不含税）− 税金及附加",
    p_mk   : "弥补亏损：首次盈利年弥补此前5年亏损，其后按剩余亏损顺延，最长5年",
    p_tx   : "应纳税所得额 = 利润总额 + 弥补亏损",
    p_it   : "所得税 = 应纳税所得额 × 25%（应纳税所得额为负则取0）",
    p_net  : "净利润 = 利润总额 − 所得税",
    f_in   : "现金流入 = 住宅租金收入",
    f_out  : "现金流出 = 总成本费用 + 税金及附加 + 所得税",
    f_net  : "净现金流量 = 现金流入 − 现金流出",
    f_cum  : "累计净现金流量（由负转正之年即为静态投资回收期）",
    f_npv  : "净现值 = Σ 净现金流量 ÷ (1+折现率)^(n+0.5)",
    f_cnpv : "累计净现值",
  },
  sale: {
    i_sale : "配保房销售收入 = Σ 配保房销售面积 × 平均售价 × 当年销售率 ÷ 10000",
    i_pv   : "出租净收益现值（计入运营首年）= 全周期商业出租净收入逐年折现后的合计",
    i_oth  : "其他收入",
    i_tot  : "总收入 = 配保房销售收入 + 出租净收益现值 + 其他收入",
    i_comm : "商业出租收入（参考口径，不计入总收入，已体现在出租净收益现值中）",
    l_beg  : "期初借款余额 = 上年期末借款余额",
    l_bor  : "本期借款 = 用户设定的当年借款投放额",
    l_int  : "本期利息 = (期初借款+本期借款÷2) × 年利率 ÷ 100",
    l_rep  : "本期还本 = 用户设定的还款计划（还款开始年起，逐年固定还款额）",
    l_pay  : "还本付息合计 = 本期还本 + 本期利息",
    l_end  : "期末借款余额 = 期初借款 + 本期借款 − 本期还本",
    r_inc  : "商业出租收入 = Σ 商业面积 × 出租率 × 租金单价 × 12 ÷ 10000 + 车位个数×月租金×12÷10000",
    r_t1   : "房产税（从租）= 商业出租收入 × 从租税率 ÷ (1+销售增值税率)",
    r_t2   : "房产税（从价·空置）= (土地成本+建安工程费+基础设施费+工程建设其他费用+建安工程费×2%×商业占比)×70%×1.2%×(1-出租率)",
    r_mgC  : "管理费用（商业）= 商业出租收入 × 运营管理费率",
    r_mgP  : "管理费用（停车）= 车位个数 × 80 × 12 ÷ 10000",
    r_fund : "维修金 = 商业面积 × 出租率 × 租赁月数 × 0.25 ÷ 10000",
    r_rep  : "维修费 = 商业出租收入 × 维修费率",
    r_vac  : "空置服务费 = 出租面积 × (1−出租率) × 8% × 12 × 0.88 ÷ 10000",
    r_ins  : "保险费 = 出租面积 × 1.86 ÷ 10000",
    r_lnd  : "土地使用税 = 项目用地面积 × 商业出租面积占比 × 3 ÷ 10000",
    r_ct   : "出租营运成本合计 = 上列各项之和",
    r_out  : "销项税额 = 商业出租收入 × 9% ÷ (1+9%)",
    r_vat  : "增值税（一般计税）= 销项税额−进项税额>0 时取差额，否则为0",
    r_sur  : "增值税附加 = 增值税 × 附加税率",
    r_stp  : "印花税 = 商业出租收入 × 0.05%",
    r_tt   : "出租经营税金合计 = 增值税 + 增值税附加 + 印花税",
    r_net  : "出租净收入 = 商业出租收入 − 出租营运成本合计 − 出租经营税金合计",
    r_pv   : "出租净收益现值 = 各年出租净收入按折现规则折现后汇总",
    s_ds   : "累计开发成本（销售部分）= 总投资 − 建设期财务费用×配保房销售面积占比 − 配保房销售收入×1.5%，按销售率分摊",
    s_dd   : "累计开发成本（折旧摊销部分）= [非配售开发成本(含地价) − 建设期财务费用×商业占比] × 80%",
    s_dd2  : "折旧摊销 = 累计开发成本（折旧摊销部分）÷ 折旧年限（默认50年，用于现金流口径）",
    s_fee  : "销售费用 = 当年配保房销售收入 × 1.5%",
    s_ov   : "销项税额 = (当期销售款−地价抵减款×销售率) × 9% ÷ (1+9%)",
    s_iv   : "进项税额 = (工程建设其他费用+销售费用)×销售率×6%÷(1+6%) + (建安工程费+基础设施费)×销售率×9%÷(1+9%)",
    s_vat  : "增值税 = MAX(累计销项税额−累计进项税额,0)",
    s_sur  : "增值税附加 = 增值税 × 附加税率",
    s_tax  : "销售税金合计 = 增值税 + 增值税附加 + 印花税（印花税=当期销售款×税率÷(1+9%)）",
    s_fb   : "财务费用（建设期）= 建设期各年还本付息表本期利息，计入总投资口径",
    s_fo   : "财务费用（运营期）= 运营期各年还本付息表本期利息",
    s_tot  : "总成本费用 = 累计开发成本（销售部分）+ 累计开发成本（折旧摊销部分）+ 销售费用 + 销售税金合计 + 财务费用（建设期+运营期）",
    p_tot  : "利润总额 = 总收入 − 总成本费用（出售类不再单独扣税金及附加，已含在总成本费用内）",
    p_mk   : "弥补亏损：与出租类同规则，首次盈利年弥补此前5年亏损，最长顺延5年",
    p_tx   : "应纳税所得额 = 利润总额 + 弥补亏损",
    p_it   : "所得税 = 应纳税所得额 × 25%（应纳税所得额为负则取0）",
    p_net  : "净利润 = 利润总额 − 所得税",
    f_in   : "现金流入 = 配保房销售收入 + 其他收入 + 商业出租收入（参考） + 回收固定资产余值",
    f_rec  : "其中：回收固定资产余值 = [土地成本+开发成本−建设期财务费用×商业占比] × 20%，计入运营首年",
    f_inv  : "开发成本投资 = 总投资×配保房面积占比 − 建设期财务费用 − 销售费用",
    f_fee  : "销售费用（同出售成本表）",
    f_stx  : "销售税金（同出售成本表）",
    f_rtx  : "出租经营税金（同商业出租表）",
    f_rct  : "出租营运成本（同商业出租表）",
    f_adj  : "调整所得税 = MAX[(现金流入−回收固定资产余值−(累计开发成本销售部分+折旧摊销+销售费用+销售税金+出租营运成本+出租经营税金))×25%,0]",
    f_out  : "现金流出合计 = 开发成本投资 + 销售费用 + 销售税金 + 出租经营税金 + 出租营运成本 + 调整所得税",
    f_net  : "净现金流量 = 现金流入 − 现金流出合计",
    f_cum  : "累计净现金流量",
    f_npv  : "净现值 = 从首个非零现金流年起，按折现率逐年折现（该年记为第0期）",
    f_cnpv : "累计净现值（由负转正之年即为静态投资回收期）",
  },
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
    c_vac  : "空置期物业管理费 = Σ(各档面积×该档空置率) × 计租月数 × 单位标准 ÷ 10000 × 分档折扣（当年出租率≤50%打88折，50%~85%打98折，≥85%不打折）",
    c_rst  : "装修重置费 = 住宅装修造价 × 重置比率；公租房每20年、保租房每10年重置一次，按分摊年数摊入",
    c_dep  : "折旧摊销 = 总投资 ×(1 − 残值率) ÷ 折旧年限",
    c_op   : "经营成本合计 = 上列各项之和",
    l_beg  : "期初借款余额 = 上年期末借款余额",
    l_int  : "本期计息 =（期初借款 + 本期借款 ÷ 2）× 年利率〔期中借款生息法〕",
    l_rep  : "本期还本 = 总借款 × 首次还本比例，其后逐年按(1+递增率)^n 递增；最后一年还清余额",
    l_end  : "期末借款余额 = 期初 + 本期借款 + 本期计息 − 本期还本 − 本期付息",
    t_vat  : "增值税 = 住宅租金 × 1.5%÷(1+5%) + 车位租金 × 9%÷(1+9%)〔住宅按简易计税〕",
    t_stp  : "印花税 = 总收入 × 0.05% ÷ (1+9%)",
    t_cty  : "城镇维护建设税 = 增值税 × 7%",
    t_edu  : "教育附加及地方教育附加 = 增值税 × 5%",
    t_prp  : "房产税 = 从租〔Σ(各档租金×该档出租率)×4%÷(1+5%) + 车位×12%÷(1+9%)〕+ 从价〔建安费×70%×1.2%÷(1+9%)×空置率×月数÷12〕；前3年免征",
    t_lnd  : "城镇土地使用税 = 用地面积 × 单位税额 ÷ 10000",
    t_tot  : "税金及附加合计 = 上列各项之和",
    l_bor  : "本期借款 = 当年借款投放额（按借款分年计划取值，未分年则全额计入建设期首年）",
    l_pin  : "本期付息 = 本期计息（利息当期全额偿还，不滚入本金）",
    l_pay  : "还本付息合计 = 本期还本 + 本期付息",
    tc_op  : "经营成本 = 经营成本合计（不含折旧摊销以外的财务费用）",
    tc_fb  : "财务费用（建设期）= 建设期各年本期付息，计入总投资、不计入总成本费用",
    tc_fo  : "财务费用（运营期）= 运营期各年本期付息，计入总成本费用",
    tc_tot : "总成本费用（不含建设期财务费用、不含税金）= 经营成本 + 财务费用（运营期）",
    p_tot  : "利润总额 = 总收入 − 总成本费用 − 税金及附加",
    p_mk   : "弥补亏损：首次盈利年弥补此前5年亏损，其后按剩余亏损顺延，最长5年",
    p_tx   : "应纳税所得额 = 利润总额 + 弥补亏损",
    p_it   : "所得税 = 应纳税所得额 × 25%（应纳税所得额 = 利润总额 + 弥补亏损，为负则取0）",
    p_net  : "净利润 = 利润总额 − 所得税",
    f_in   : "现金流入 = 总收入",
    f_inv  : "其中：建设投资，按投资年度计划分年计入（未分年则全额计入建设期首年）",
    f_out  : "现金流出 = 建设投资 + 税金及附加 + 各项现金经营成本 + 所得税〔不含折旧与财务费用〕",
    f_net  : "净现金流量 = 现金流入 − 现金流出",
    f_npv  : "净现值 = Σ 净现金流量 ÷ (1+折现率)^(n+0.5)",
    f_cum  : "累计净现金流量（由负转正之年即为静态投资回收期）",
    f_cnpv : "累计净现值（由负转正之年即为动态投资回收期）",
    fu_op  : "经营活动现金来源 = 总收入",
    fu_fin : "筹资活动现金来源 = 银行借款（本期借款）",
    fu_rec : "余值回收：出租类项目长期持有运营，不设定期末资产处置，固定为0",
    fu_src : "资金来源合计 = 经营活动现金来源 + 筹资活动现金来源 + 余值回收",
    fu_inv : "其中：建设投资，与现金流量表口径一致",
    fu_use : "资金运用合计 = 建设投资 + 税金及附加 + 各项现金经营成本 + 所得税 + 借款本金偿还 + 借款利息支付",
    fu_sur : "盈余资金 = 资金来源合计 − 资金运用合计",
    pa_tot : "利润总额（调整）= 总收入 − 经营成本合计（全投资口径，不含任何财务费用）− 税金及附加",
    pa_mk  : "弥补亏损（调整）：与损益表同规则，但基于调整口径利润总额单独滚算，不与损益表共用状态",
    pa_tx  : "应纳税所得额（调整）= 利润总额（调整）+ 弥补亏损（调整）",
    pa_it  : "所得税（调整）= 应纳税所得额（调整）× 25%",
    pa_net : "净利润（调整）= 利润总额（调整）− 所得税（调整）",
    cc_in  : "现金流入 = 总收入（同全投资现金流量表）",
    cc_inv : "其中：总投资，按投资年度计划分年计入",
    cc_out : "现金流出（资本金）= 总投资 + 本期还款 + 本期付息 + 税金及附加 + 各项现金经营成本 + 所得税〔比全投资口径多算本期还本付息〕",
    cc_net : "净现金流量 = 现金流入 − 现金流出（资本金）",
    cc_npv : "净现值 = Σ 净现金流量 ÷ (1+折现率)^(n+0.5)〔同全投资口径的年中折现〕",
    cc_cum : "累计净现金流量（由负转正之年即为资本金静态投资回收期）",
    cc_cnpv: "累计净现值（由负转正之年即为资本金动态投资回收期）",
  },
};

async function exportCalcWord(){
  // 注意：scResult 在 calc.js 中以 let 声明，不会挂到 window 上，
  // 因此必须直接引用变量名，不能写 window.scResult（恒为 undefined）
  if(!scResult){ alert("请先完成测算"); return; }
  await ensureDocxLib();
  const D = window.docx, R = scResult, P = scParams||{}, type = calcType;
  const specs = calcSpecs(type, R);
  // 管理员在后台「AI审核规则、逻辑 → 可研测算逻辑」编辑过的说明文字优先生效，未编辑的科目退回代码内置默认文案
  const FT = Object.assign({}, CALC_FORMULA_TEXT[type]||{}, (CALC_CFG&&CALC_CFG.calclogic&&CALC_CFG.calclogic[type])||{});
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
  const PL = {buildStart:"建设期起始年", buildStartQuarter:"建设期起始季度", buildYears:"建设期年数", operateYears:"运营期年数",
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
  if(P.investSchedule&&P.investSchedule.periods){
    const sch=P.investSchedule,total=Number(sch.totalInvestment)||0;
    kids.push(para("二、工期进度与投资计划",{font:"黑体",size:24},{spacing:{line:380,lineRule:"exact",before:200,after:60}}));
    (sch.tasks||[]).forEach(t=>{const qs=InvestmentSchedule.activePeriods(t,sch.totalQuarters).map(q=>sch.periods[q]&&sch.periods[q].label).filter(Boolean);kids.push(para("　"+t.name+"："+(qs.length?qs.join("、"):"未安排"),null,{spacing:{line:320,lineRule:"exact"}}));});
    Object.entries(sch.annualPlan||{}).forEach(([y,v])=>kids.push(para("　"+y+"年投资："+Number(v).toLocaleString("zh-CN",{maximumFractionDigits:2})+"万元（"+(total?v/total*100:0).toFixed(1)+"%）",null,{spacing:{line:320,lineRule:"exact"}})));
    kids.push(para("　季度、年度与映射费用合计校验："+(sch.validation&&sch.validation.ok?"通过":"存在待核查问题"),{bold:true,color:sch.validation&&sch.validation.ok?"27734A":"A23B2A"}));
  }

  // ---- 各科目计算公式与合计 ----
  const CN=["三","四","五","六","七","八","九","十","十一"];
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
  kids.push(para("十二、主要财务指标",{font:"黑体",size:24},{spacing:{line:380,lineRule:"exact",before:200,after:60}}));
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

/* ---- 导出「AI审核规则、逻辑」两份标准的Word版，供不打开网页也能看/存档 ----
   刻意从传入的当前内存态列表(可能含未保存的编辑)实时生成，不是转换某份静态原始文件的快照——
   这样每次下载都和后台当前实际生效的规则一致，改了不保存也能预览效果，保存后下载自然跟着更新。
   两个导出函数结构高度相似，没有抽公共函数是因为字段结构不同(match/rule vs category/item/standard/...)，
   硬抽反而让每个函数都要塞一堆条件分支，不如各自保持直白。 */
async function exportAiRulesWord(list){
  if(!list || !list.length){ alert("当前没有可导出的规则"); return; }
  await ensureDocxLib();
  const D = window.docx;
  const run=(t,o)=>new D.TextRun(Object.assign({text:String(t), font:"仿宋_GB2312", size:22}, o||{}));
  const para=(t,o,po)=>new D.Paragraph(Object.assign({children:[run(t,o)], spacing:{line:340,lineRule:"exact"}}, po||{}));
  const kids=[];
  kids.push(new D.Paragraph({children:[run("AI可研审核规则与业务逻辑",{font:"方正小标宋简体", size:36})],
    alignment:D.AlignmentType.CENTER, spacing:{line:520,lineRule:"exact", after:120}}));
  kids.push(new D.Paragraph({children:[run("导出时间："+new Date().toLocaleString("zh-CN")+"　｜　共"+list.length+"条　｜　与后台「AI审核规则、逻辑」页面当前状态一致（含未保存的编辑）",
    {font:"楷体_GB2312", size:19, color:"808080"})], alignment:D.AlignmentType.CENTER, spacing:{line:340,lineRule:"exact", after:240}}));
  list.forEach((e,i)=>{
      kids.push(new D.Paragraph({children:[run((e.id||("KY-"+String(i+1).padStart(3,"0")))+"　匹配关键词："+(e.match||"*"),{bold:true})],
        spacing:{line:340,lineRule:"exact", before:180}}));
      kids.push(para("　　"+(e.rule||""), null, {spacing:{line:320,lineRule:"exact"}}));
      if(e.reason) kids.push(para("　　为什么这样规定："+e.reason, {font:"楷体_GB2312",size:20,color:"555555"}, {spacing:{line:300,lineRule:"exact"}}));
      if(e.evidenceRefs&&e.evidenceRefs.length) kids.push(para("　　关联Wiki依据："+e.evidenceRefs.map(x=>(x.title||x.id)+(x.version?" v"+x.version:"")).join("；"), {font:"楷体_GB2312",size:19,color:"1F4E79"}, {spacing:{line:300,lineRule:"exact"}}));
  });
  const doc=new D.Document({sections:[{properties:{page:{size:{width:11906,height:16838},
    margin:{top:1500,right:1400,bottom:1500,left:1400}}}, children:kids}]});
  const blob=await D.Packer.toBlob(doc);
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url;
  a.download="AI可研审核规则与业务逻辑-"+Date.now()+".docx"; a.click();
  URL.revokeObjectURL(url);
}
const CS_CHECK_TYPE_LABELS = {exact:"精确匹配", max:"不超过", min:"不低于", tier:"分档(按项目属性选档)", formula:"公式核对", info:"仅供参考(非硬规则)"};
async function exportCalcStdWord(list){
  if(!list || !list.length){ alert("当前没有可导出的标准"); return; }
  await ensureDocxLib();
  const D = window.docx;
  const run=(t,o)=>new D.TextRun(Object.assign({text:String(t), font:"仿宋_GB2312", size:22}, o||{}));
  const para=(t,o,po)=>new D.Paragraph(Object.assign({children:[run(t,o)], spacing:{line:340,lineRule:"exact"}}, po||{}));
  const kids=[];
  kids.push(new D.Paragraph({children:[run("测算审核标准",{font:"方正小标宋简体", size:36})],
    alignment:D.AlignmentType.CENTER, spacing:{line:520,lineRule:"exact", after:120}}));
  kids.push(new D.Paragraph({children:[run("导出时间："+new Date().toLocaleString("zh-CN")+"　｜　共"+list.length+"条　｜　与后台「测算审核标准」页面当前状态一致（含未保存的编辑）",
    {font:"楷体_GB2312", size:19, color:"808080"})], alignment:D.AlignmentType.CENTER, spacing:{line:340,lineRule:"exact", after:240}}));
  const cats = []; list.forEach(e=>{ const c=e.category||"未分类"; if(!cats.includes(c)) cats.push(c); });
  cats.forEach(cat=>{
    kids.push(para(cat, {font:"黑体",size:24}, {spacing:{line:380,lineRule:"exact", before:200, after:60}}));
    list.filter(e=>(e.category||"未分类")===cat).forEach(e=>{
      kids.push(new D.Paragraph({children:[
          run("● "+(e.id?e.id+"　":"")+(e.item||"（未命名）"), {bold:true}),
        run("　["+(CS_CHECK_TYPE_LABELS[e.checkType]||e.checkType||"info")+"　适用："+(e.calcType||"all")+(e.value!=null&&e.value!==""?"　参考值："+e.value:"")+"]", {bold:true, color:"1F4E79", size:19}),
      ], spacing:{line:340,lineRule:"exact", before:80}}));
        if(e.standard) kids.push(para("　　"+e.standard, {font:"楷体_GB2312", size:21, color:"262626"}, {spacing:{line:320,lineRule:"exact"}}));
        if(e.reason) kids.push(para("　　为什么这样规定："+e.reason, {font:"楷体_GB2312", size:19, color:"555555"}, {spacing:{line:300,lineRule:"exact"}}));
        if(e.evidenceRefs&&e.evidenceRefs.length) kids.push(para("　　关联Wiki依据："+e.evidenceRefs.map(x=>(x.title||x.id)+(x.version?" v"+x.version:"")).join("；"), {font:"楷体_GB2312", size:19, color:"1F4E79"}, {spacing:{line:300,lineRule:"exact"}}));
      if(e.note) kids.push(para("　　备注："+e.note, {font:"楷体_GB2312", size:19, color:"808080"}, {spacing:{line:300,lineRule:"exact"}}));
    });
  });
  const doc=new D.Document({sections:[{properties:{page:{size:{width:11906,height:16838},
    margin:{top:1500,right:1400,bottom:1500,left:1400}}}, children:kids}]});
  const blob=await D.Packer.toBlob(doc);
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url;
  a.download="测算审核标准-"+Date.now()+".docx"; a.click();
  URL.revokeObjectURL(url);
}
