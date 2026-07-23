// 报告生成相关模块 —— 从 index.html 内联脚本拆分而来（领域/项目信息/章节生成/知识库检索/草稿存档等）
let domainKey = null;
let chapters = [];
let signed = false;
let genUsage = {inTok:0, outTok:0};
let kbEntries = [];   // 参考资料库 [{title, content}]
let rptCtype = "rent";   // 报告流程·非改保领域的测算类型
const PRICE_IN_PER_M = 2, PRICE_OUT_PER_M = 8;   // 元/百万tokens，按DeepSeek价目表估算，可调整
const EST_IN_PER_SEC = 1200, EST_OUT_PER_SEC = 700; // 每子节预估token
const project = { name:"", owner:"", industry:"", location:"", type:"", scale:"", desc:"" };


/* ---------- 草稿自动存档（浏览器本地，防刷新丢失） ---------- */
const DRAFT_KEY = "fs_draft_v1";
function buildDraftData(){
  return {
    ts: Date.now(), domainKey, currentStep, signed, docNo,
    project: project, calcParams: calcParams, kb: kbEntries,
    chapters: chapters.map(c=>({cn:c.cn, name:c.name, checked:c.checked,
      sections:c.sections.map(s=>({t:s.t, numeric:s.numeric, content:s.content, editedHtml:s.editedHtml||null}))}))
  };
}
function saveDraft(){
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(buildDraftData())); }catch(e){}
  scheduleCloudSave();
}
function loadDraft(){
  try{ const raw = localStorage.getItem(DRAFT_KEY); return raw? JSON.parse(raw): null; }catch(e){ return null; }
}
function clearDraft(){ try{ localStorage.removeItem(DRAFT_KEY); }catch(e){} }
function restoreDraft(d){
  appMode = "report";
  domainKey = d.domainKey; signed = !!d.signed; docNo = d.docNo||null;
  Object.assign(project, d.project||{});
  calcParams = d.calcParams||null;
  kbEntries = d.kb||[];
  if(domainKey){ loadDomain(domainKey); Object.assign(project, d.project||{}); }
  if(d.chapters && chapters.length){
    d.chapters.forEach((dc,i)=>{
      if(!chapters[i]) return;
      chapters[i].checked = dc.checked;
      dc.sections.forEach((ds,j)=>{
        if(chapters[i].sections[j]){ chapters[i].sections[j].content = ds.content||""; chapters[i].sections[j].editedHtml = ds.editedHtml||null; }
      });
    });
  }
  if(calcParams && window.NRCalc && domainKey==="baozhang_gaibao"){
    calcResult = window.NRCalc.calc(assembleCalcInput(calcParams), CALC_CFG.gaibao);
    calcResult.sens = computeSensitivity(calcParams);
  }
  currentStep = Math.min(d.currentStep||0, STEPS.length-1);
  renderTOC(); renderSheet();
}
function draftBarHtml(d){
  const t = new Date(d.ts);
  const when = t.toLocaleDateString("zh-CN")+" "+String(t.getHours()).padStart(2,"0")+":"+String(t.getMinutes()).padStart(2,"0");
  const name = (d.project&&d.project.name)? d.project.name : "未命名项目";
  return '<div id="draftBar" class="draft-bar">检测到 '+when+' 的未完成草稿「'+name+'」'
    +'<span><button class="btn" id="draftRestore" style="padding:6px 16px; font-size:12px;">恢复继续</button>'
    +'<button class="btn ghost" id="draftDiscard" style="padding:6px 16px; font-size:12px;">丢弃</button></span></div>';
}


let dynamicOutlines = null; // 从数据库加载的大纲（优先）或内置的
async function fetchOutlines(){
  if(dynamicOutlines) return dynamicOutlines;
  try{
    const r = await fetch("/api/outlines", {headers: authHeaders()});
    const d = await r.json();
    if(d.ok && d.list && d.list.length){
      const map = {};
      for(const item of d.list){
        const det = await fetch("/api/outlines?key="+encodeURIComponent(item.key), {headers: authHeaders()});
        const dd = await det.json();
        if(dd.ok) map[item.key] = {label:dd.outline.label, chapters:dd.outline.chapters};
      }
      if(Object.keys(map).length){ dynamicOutlines = map; return map; }
    }
  }catch(e){}
  dynamicOutlines = window.OUTLINES || {};
  return dynamicOutlines;
}
function getOutlines(){ return dynamicOutlines || window.OUTLINES || {}; }

function loadDomain(key){
  domainKey = key;
  const src = getOutlines()[key];
  project.industry = src.label;
  chapters = src.chapters.map(ch=>({
    cn: ch.cn, name: ch.name, checked: true,
    sections: ch.sections.map(s=>({ t: s.t, numeric: !!s.numeric, content: "" }))
  }));
}


function stepDomain(){
  const outlines = getOutlines();
  if(!outlines || !Object.keys(outlines).length){
    return '<div class="doc-eyebrow">STEP 01</div><h1 class="doc-title">加载领域大纲中…</h1><div class="step-desc">正在从云端读取大纲数据…</div>';
  }
  return stepDomainInner(outlines);
}
function stepDomainInner(outlines){
  const keys = Object.keys(outlines);
  return '<div class="doc-eyebrow">STEP 01 · 选择报告领域</div>'
    +'<h1 class="doc-title">选择要生成的可研报告类型</h1>'
    +'<div class="step-desc">不同领域使用不同的专属章节大纲。以下大纲结构参照真实可研报告提炼，每章包含多个子标题，逐层生成，篇幅与深度贴近正式报告。</div>'
    + heroDraftHtml()
    +'<div class="domain-grid">'
    + keys.map(k=>{
        const d = outlines[k];
        const subCount = d.chapters.reduce((n,c)=>n+c.sections.length,0);
        return '<div class="domain-card '+(domainKey===k?'sel':'')+'" data-key="'+k+'">'
          + domainIcon(k)
          +'<div class="dn">'+d.label+'</div>'
          +'<div class="dd">共 '+d.chapters.length+' 个一级章节</div>'
          +'<div class="dc">'+subCount+' 个子标题 · 逐层生成</div></div>';
      }).join("")
    +'</div>'
    +'<div class="note-box">升级说明：本版本相比旧版，把"一章一段"改为"一章按多个子标题逐层撰写"，单份报告的结构颗粒度和篇幅大幅提升；数据类子标题会自动生成表格框架并标注"待填真实数据"。</div>'
    +'<div class="actions"><button class="btn" id="toStep1" '+(domainKey?'':'disabled')+'>下一步：录入项目信息 →</button></div>';
}

function stepProjectInfo(){
  return '<div class="doc-eyebrow">STEP 02 · 项目基础信息 · '+project.industry+'</div>'
    +'<h1 class="doc-title">可行性研究报告 · 生成任务单</h1>'
    +'<div class="step-desc">录入项目基础事实。信息越具体，逐章生成的贴合度越高。</div>'
    +'<div class="grid2">'
    +'<div><label>项目名称</label><input id="f_name" type="text" placeholder="例：XX保障性住房改造升级项目" value="'+project.name+'"></div>'
    +'<div><label>建设/委托单位</label><input id="f_owner" type="text" placeholder="例：XX安居集团有限公司" value="'+project.owner+'"></div></div>'
    +'<div class="grid2">'
    +'<div><label>项目类型</label><input id="f_type" type="text" placeholder="例：改造升级 / 新建" value="'+project.type+'"></div>'
    +'<div><label>建设地点</label><input id="f_location" type="text" placeholder="例：深圳市龙华区XX片区" value="'+project.location+'"></div></div>'
    +'<div><label>投资规模（万元，估算）</label><input id="f_scale" type="text" placeholder="例：5240" value="'+project.scale+'"></div>'
    +'<label>项目概况（建筑面积、现状、改造/建设内容、周边情况等，越详细越好）</label>'
    +'<textarea id="f_desc" placeholder="例：项目总建筑面积21300㎡，含集中商业与街区商业，已运营11年，现出租率下滑至70%，拟通过系统性改造升级重构业态与动线...">'+project.desc+'</textarea>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px;"><b style="font-size:14px;">周边调研与产品定位（选填，驱动市场分析与定位章节）</b><button type="button" class="btn ghost" id="aiPosBtn" style="padding:5px 14px;font-size:12px;">AI定位建议</button></div>'
    +'<div id="aiPosBox"></div>'
    +'<div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">'
    +'<input id="poiKw" type="text" placeholder="项目/小区全名，可加城市，如：深圳 安居华越龙苑" value="'+escapeHtml(project.poiKw || project.name || "")+'" style="flex:1; min-width:240px; font-size:12.5px; padding:6px 10px;">'
    +'<button type="button" class="btn ghost" id="poiBtn" style="padding:5px 14px;font-size:12px;">📍 搜索位置并抓取周边</button></div>'
    +'<div id="poiStatus" style="font-size:12px; color:var(--ink-soft); margin-top:6px;"></div>'
    +'<div><label style="margin-top:10px;">周边配套（自动抓取自地图，可手动增删修改，将注入区位与市场章节）</label><textarea id="f_poiDesc" style="min-height:72px;" placeholder="点上方按钮自动抓取，或手动填写">'+escapeHtml(project.poiDesc||"")+'</textarea></div>'
    +'<div class="step-desc" style="margin:6px 0 0;">竞品数据须来自真实调研——AI只负责把这些真实数据组织成市场分析论述，不会自行编造周边情况。</div>'
    +'<div id="cpList">'
    + (project.competitors||[]).map((cp,i)=>cpRowHtml(cp,i)).join("")
    +'</div>'
    +'<button type="button" class="btn ghost" id="cpAdd" style="padding:5px 14px;font-size:12px;margin-top:8px;">＋ 添加竞品</button>'
    +'<button type="button" class="btn ghost" id="cpFetch" style="padding:5px 14px;font-size:12px;margin-top:8px;margin-left:8px;">📍 抓取周边公寓项目</button>'
    +'<span id="cpFetchSt" style="font-size:12px; color:var(--ink-soft); margin-left:8px;"></span>'
    +'<div id="cpChartBox" style="margin-top:12px;"></div>'
    +'<div class="grid2" style="margin-top:14px;">'
    +'<div><label>主力客群</label><select id="f_targetGroup">'+["新市民/青年人","园区产业职工","混合客群","家庭型租户"].map(o=>'<option '+((project.targetGroup||"新市民/青年人")===o?"selected":"")+'>'+o+'</option>').join("")+'</select></div>'
    +'<div><label>周边产业/就业特征（选填）</label><input id="f_industryDesc" type="text" placeholder="例：周边3公里聚集电子信息产业园，从业人员约5万人" value="'+escapeHtml(project.industryDesc||"")+'"></div>'
    +'<div><label>户型策略</label><select id="f_unitPlan">'+["小户型为主（≤70㎡）","中小户型混合","大中小全覆盖"].map(o=>'<option '+((project.unitPlan||"小户型为主（≤70㎡）")===o?"selected":"")+'>'+o+'</option>').join("")+'</select></div>'
    +'<div><label>租金策略</label><select id="f_rentPlan">'+["市场价9折以内","市场价7-9折","显著低于市场价（≤7折）"].map(o=>'<option '+((project.rentPlan||"市场价9折以内")===o?"selected":"")+'>'+o+'</option>').join("")+'</select></div>'
    +'</div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px;"><b style="font-size:14px;">参考资料库（可选）</b><span style="display:flex;gap:8px;"><button type="button" class="btn ghost" id="kbUpload" style="padding:5px 14px;font-size:12px;">上传文件</button><button type="button" class="btn ghost" id="kbAdd" style="padding:5px 14px;font-size:12px;">＋ 粘贴文本</button></span></div>'
    +'<input type="file" id="kbFile" accept=".pdf,.docx,.txt,.md" multiple style="display:none;">'
    +'<div id="kbParsing" style="display:none; font-size:12px; color:var(--bp-navy); margin-top:8px;">正在解析文件…</div>'
    +'<div class="step-desc" style="margin:6px 0 0;">粘贴政策文件、区域市场数据、项目批复等真实资料。生成时系统按章节自动匹配相关资料注入AI，并要求引用处标注来源——让市场分析、必要性论证有真实依据。</div>'
    +'<div id="kbList">'
    + kbEntries.map((e,i)=>'<div class="kb-entry" style="border:1px solid var(--line); padding:10px 12px; margin-top:10px; background:#fff;">'
        +'<div style="display:flex; gap:8px; align-items:center;"><input class="kb-title" placeholder="资料标题（如：深圳市住房发展十四五规划要点）" value="'+escapeHtml(e.title||"")+'" style="flex:1;"><button type="button" class="btn ghost kb-del" data-ki="'+i+'" style="padding:4px 10px;font-size:11px;">删除</button></div>'
        +'<textarea class="kb-content" placeholder="粘贴资料正文…" style="margin-top:8px; min-height:70px;">'+escapeHtml(e.content||"")+'</textarea></div>').join("")
    +'</div>'
    +'<div class="note-box">边界提示：涉及投资估算、经营收入、财务指标等具体数字的子章节，系统只生成结构与表格框架，并标注"待填真实数据"，不会编造看似权威的精确数字。这些必须由专业测算填入后方可正式使用。</div>'
    +'<div class="actions"><button class="btn ghost" id="backStep0">← 上一步</button><button class="btn" id="toStep2">下一步：选择章节 →</button></div>';
}



// 领域绑定测算类型:改保领域只跑改保、出租领域只跑出租;其余领域自由选择
function domainCalcLock(){
  if(domainKey === "baozhang_gaibao") return "gaibao";
  const k = String(domainKey||"");
  let label = "";
  try{ const o = getOutlines()[domainKey]; label = (o && o.label) || ""; }catch(e){}
  if(/rent|chuzu/i.test(k) || label.includes("出租")) return "rent";
  return null;
}

function stepCalc(){
  const lock = domainCalcLock();
  const isGaibao = lock==="gaibao";
  if(lock==="rent") rptCtype = "rent";   // 锁定出租,防旧值串型
  return '<div class="doc-eyebrow">STEP 03 · 财务测算 · '+project.industry+'</div>'
    +'<h1 class="doc-title">财务测算（可选）</h1>'
    +'<div class="step-desc">'
    +'填入真实测算参数后点击"执行测算"，系统将用与内部测算器完全一致的公式，当场算出收入、成本、税金、损益、现金流、IRR与净现值，并把<b>真实测算结果自动写入报告的财务章节</b>。也可以点"跳过测算"，财务章节将以"待填"框架生成。'
    +'</div>'
    + (isGaibao ? calcFormHtml()
       : lock==="rent" ? '<div class="note-box" style="margin-bottom:12px;">本领域绑定<b>出租类（长期持有经营）</b>测算模型。</div>' + rentFormHtml()
       : '<div class="grid2"><div><label>测算类型</label><select id="rptCtype"><option value="rent" '+(rptCtype==="rent"?"selected":"")+'>出租类（长期持有经营）</option><option value="sale" '+(rptCtype==="sale"?"selected":"")+'>出售类（配售/出售为主）</option></select></div><div></div></div>'
         + (rptCtype==="sale"? saleFormHtml() : rentFormHtml()))
    +'<div id="calcResultBox">'+(calcResult? calcResultHtml():'')+'</div>'
    +'<div class="actions">'
    +'<button class="btn ghost" id="backStep1c">← 上一步</button>'
    +'<button class="btn ghost" id="runCalcBtn">执行测算</button>'
    +'<button class="btn" id="toStep3c">'+(calcResult?'下一步：选择章节 →':'跳过测算，下一步 →')+'</button>'
    +'</div>';
}

function runRptCalcOther(){
  try{
    if(rptCtype === "sale"){
      calcParams = readSaleForm();
      const p = calcParams;
      const opStart = p.buildStart + p.buildYears;
      const ramp = {}; if(p.rate1) ramp[opStart]=p.rate1; if(p.rate2) ramp[opStart+1]=p.rate2; if(p.rate3) ramp[opStart+2]=p.rate3;
      const repay = {}; for(let i=0;i<p.repayYears;i++) repay[p.repayStart+i]=p.repayAmount;
      calcResult = window.SaleCalc.calc(Object.assign({}, p, {saleRamp:ramp, customRepay:repay}), CALC_CFG.sale);
    }else{
      calcParams = readRentForm();
      calcResult = window.RentCalc.calc(calcParams, CALC_CFG.rent);
    }
    calcResult.__ctype = rptCtype;
    scParams = calcParams; scResult = calcResult;   // 供共享部件读取
    saveDraft();
    document.getElementById("calcResultBox").innerHTML = calcResultHtml() + modeCompareHtml();
    animateCountUps();
    document.getElementById("toStep3c").textContent = "下一步：选择章节 →";
  }catch(e){ alert("测算失败："+e.message); }
}

function runCalc(){
  if(domainKey !== "baozhang_gaibao"){ return runRptCalcOther(); }
  calcParams = readCalcForm();
  calcResult = window.NRCalc.calc(assembleCalcInput(calcParams), CALC_CFG.gaibao);
  calcResult.__ctype = "gaibao";
  calcResult.sens = computeSensitivity(calcParams);
  try{ calcResult.modeCompare = computeModeCompare(calcParams); }catch(e){ calcResult.modeCompare = null; }
  document.getElementById("calcResultBox").innerHTML = calcResultHtml() + modeCompareHtml();
  animateCountUps();
  const nextBtn = document.getElementById("toStep3c");
  if(nextBtn) nextBtn.textContent = "下一步：选择章节 →";
  saveDraft();
}



function stepChapters(){
  return '<div class="doc-eyebrow">STEP 03 · 章节范围 · '+project.industry+'</div>'
    +'<h1 class="doc-title">选择本次生成的章节</h1>'
    +'<div class="step-desc">每个章节含多个子标题，生成时逐个撰写。取消勾选可跳过整章。</div>'
    +'<div class="chapter-list">'
    + chapters.map((c,i)=>'<div class="chapter-row"><span class="num">'+c.cn+'</span>'
        +'<input type="checkbox" data-idx="'+i+'" class="chk" '+(c.checked?'checked':'')+'>'
        +'<span>'+c.name+'</span><span class="subcount">'+c.sections.length+' 子节</span></div>').join("")
    +'</div>'
    +'<div class="ch-tools"><button class="ub-btn" id="chAll">全选</button><button class="ub-btn" id="chNone">全不选</button><span class="ch-range">第 <input id="chFrom" type="number" min="1" max="'+chapters.length+'" value="1"> 至 <input id="chTo" type="number" min="1" max="'+chapters.length+'" value="'+chapters.length+'"> 章 <button class="ub-btn" id="chRange">仅选此区间</button></span></div>'
    +'<div class="actions"><button class="btn ghost" id="backStep2ch">← 上一步</button><button class="btn" id="toStep4g">下一步：开始生成 →</button></div>';
}

function stepGenerate(){
  const active = chapters.filter(c=>c.checked);
  const totalSec = active.reduce((n,c)=>n+c.sections.length,0);
  let inner = active.map(c=>'<div class="chapter-block" id="block_'+c.cn+'"><h3><span class="cn">'+c.cn+'</span>'+c.name+'</h3>'
    + c.sections.map((s,si)=>'<div class="section-block pending" id="sec_'+c.cn+'_'+si+'"><h4>'+s.t+(s.numeric?' ⚠数据':'')+'</h4><div class="body"><span class="skel" style="width:94%"></span><span class="skel" style="width:99%"></span><span class="skel" style="width:88%"></span><span class="skel" style="width:56%"></span></div></div>').join("")
    +'</div>').join("");
  return '<div class="doc-eyebrow">STEP 04 · 逐章生成</div>'
    +'<h1 class="doc-title">起草中：'+(project.name||"（未命名项目）")+'</h1>'
    +'<div class="progress-line" id="progressLine">共 '+active.length+' 章 / '+totalSec+' 个子标题待生成'+(kbEntries.length?'｜已挂载参考资料 '+kbEntries.length+' 篇（自动匹配注入）':'')+' ｜ 预计消耗约 '+((totalSec*(EST_IN_PER_SEC+EST_OUT_PER_SEC))/10000).toFixed(1)+' 万 tokens（约 ¥'+((totalSec*EST_IN_PER_SEC*PRICE_IN_PER_M + totalSec*EST_OUT_PER_SEC*PRICE_OUT_PER_M)/1000000).toFixed(2)+'，按标准价估算）</div>'
    +'<div id="chapterContainer">'+inner+'</div>'
    +'<div class="actions"><button class="btn ghost" id="backStep3g">← 上一步</button>'
    +'<button class="btn" id="startGen">开始逐章生成</button>'
    +'<button class="btn" id="toStep5r" style="display:none;">下一步：人工复核 →</button></div>';
}

async function runGeneration(){
  const active = chapters.filter(c=>c.checked);
  const genBtn = document.getElementById("startGen");
  genBtn.disabled = true; genBtn.textContent = "生成中…";
  const progressEl = document.getElementById("progressLine");
  genUsage = {inTok:0, outTok:0};
  const tasks = [];
  active.forEach(c=>c.sections.forEach((s,si)=>tasks.push({c,s,si})));
  const total = tasks.length;
  let done = 0, failed = 0;

  async function handleOne(t){
    const {c,s,si} = t;
    const secEl = document.getElementById('sec_'+c.cn+'_'+si);
    secEl.classList.add("gen");
    try{
      const text = await generateSection(c, s);
      s.content = text;
      secEl.classList.remove("pending"); secEl.classList.remove("gen");
      secEl.querySelector(".body").innerHTML = renderContent(text);
      secEl.querySelector("h4").insertAdjacentHTML("beforeend", '<span class="done-stamp">已拟</span>');
      saveDraft();
    }catch(e){
      failed++;
      secEl.classList.remove("gen");
      secEl.querySelector(".body").innerHTML = '<span style="color:var(--seal-red);">生成失败：'+escapeHtml(e.message)+'</span> <button class="retry-btn btn ghost" data-cn="'+c.cn+'" data-si="'+si+'" style="padding:3px 12px; font-size:11px; margin-left:8px;">重试</button>';
    }
    done++;
    progressEl.textContent = '3路并行撰写中… 已完成 '+done+'/'+total + (failed? '（失败 '+failed+'）':'');
  }
  const CONCURRENCY = 3;
  const workers = Array.from({length:Math.min(CONCURRENCY,total)}, ()=>(async ()=>{
    while(tasks.length){ const t = tasks.shift(); await handleOne(t); }
  })());
  await Promise.all(workers);

  const cost = (genUsage.inTok*PRICE_IN_PER_M + genUsage.outTok*PRICE_OUT_PER_M)/1000000;
  let tail = '已完成 '+(total-failed)+'/'+total+' 个子标题的初稿起草' + (failed? '（'+failed+' 个失败，可在下方点击重试）':'。');
  if(genUsage.inTok||genUsage.outTok){
    tail += ' ｜ 实际消耗：输入 '+genUsage.inTok.toLocaleString()+' + 输出 '+genUsage.outTok.toLocaleString()+' tokens ≈ ¥'+cost.toFixed(2);
  }
  progressEl.textContent = tail;
  genBtn.style.display = "none";
  document.getElementById("toStep5r").style.display = "inline-block";
  saveDraft();
  bindEvents();
}

function renderContent(text){
  const tableRe = /\[\[TABLE\]\]([\s\S]*?)\[\[\/TABLE\]\]/g;
  let html = text.replace(tableRe, function(m, inner){
    const rows = inner.trim().split("\n").filter(r=>r.trim());
    let t = '<table class="rpt">';
    rows.forEach((r,ri)=>{
      const cells = r.split("|").map(x=>x.trim());
      const tag = ri===0 ? "th" : "td";
      t += "<tr>" + cells.map(c=>'<'+tag+'>'+escapeHtml(c)+'</'+tag+'>').join("") + "</tr>";
    });
    return t + "</table>";
  });
  html = html.split(/\n{2,}/).map(p=>{
    if(p.includes("<table")) return p;
    return p.trim()? '<p style="margin:0 0 10px;">'+escapeHtml(p).replace(/\*\*([^*\n]+)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>")+'</p>' : "";
  }).join("");
  return html;
}
async function kbHandleFiles(files){
  const parsing = document.getElementById("kbParsing");
  if(parsing) parsing.style.display = "block";
  readKbFromDom();
  for(const f of files){
    try{
      const name = f.name.replace(/\.[^.]+$/, "");
      const ext = (f.name.split(".").pop()||"").toLowerCase();
      let text = "";
      if(ext==="txt" || ext==="md"){
        text = await f.text();
      }else if(ext==="docx"){
        if(!window.mammoth) await loadScript("mammoth.min.js");
        const buf = await f.arrayBuffer();
        const r = await window.mammoth.extractRawText({arrayBuffer: buf});
        text = r.value || "";
      }else if(ext==="pdf"){
        if(!window.pdfjsLib) await loadScript("pdf.min.js");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({data: buf}).promise;
        const parts = [];
        for(let p=1; p<=pdf.numPages; p++){
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          parts.push(tc.items.map(it=>it.str).join(""));
        }
        text = parts.join("\n");
      }else{
        alert("暂不支持 ."+ext+" 格式，请使用 PDF / docx / txt");
        continue;
      }
      text = text.replace(/\n{3,}/g, "\n\n").trim();
      if(!text){ alert("《"+f.name+"》未能提取到文字（可能是扫描件PDF，无文字层）"); continue; }
      const MAX = 20000;
      if(text.length > MAX) text = text.slice(0, MAX) + "\n…（超长已截断，保留前2万字）";
      kbEntries.push({title: name, content: text});
    }catch(e){
      alert("解析《"+f.name+"》失败："+e.message);
    }
  }
  if(parsing) parsing.style.display = "none";
  renderSheet();
}



// 全量RAG：语义检索存量报告库（未部署Vectorize时静默跳过）
let ragAvailable = null;
// 相似度分层策略（参考行业实践：不同匹配度的资料，可信程度不同，应区别使用）
const RAG_TIER = {
  HIGH: 0.85,    // 高匹配：内容高度相关，可直接借鉴论述结构
  MID:  0.70,    // 中匹配：主题相关，需甄别后借鉴
  LOW:  0.55,    // 低匹配：仅作思路启发，不宜照搬
  MIN:  0.55,    // 低于此值不返回（避免噪音干扰生成）
};
function ragTierOf(score){
  const s = Number(score) || 0;
  if(s >= RAG_TIER.HIGH) return { key:"high", label:"高匹配" };
  if(s >= RAG_TIER.MID)  return { key:"mid",  label:"中匹配" };
  return { key:"low", label:"低匹配·仅供参考" };
}
async function ragRetrieve(chapterName, secTitle){
  if(ragAvailable === false) return "";
  try{
    const q = (project.industry||"") + " " + String(chapterName||"") + " " + String(secTitle||"");
    const r = await fetch("/api/rag", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"query", query:q, topK:2})});
    const d = await r.json();
    if(!d.ok){ if(/未绑定|不可用/.test(d.error||"")) ragAvailable = false; return ""; }
    ragAvailable = true;
    // 相似度分层：不同置信度的参考资料，给AI的使用指引不同（避免把勉强沾边的当权威用）
    const hits = (d.matches||[]).filter(m=>m.text && m.score >= RAG_TIER.MIN);
    if(!hits.length) return "";
    let out = "\n\n【历史报告参考】（语义检索自本单位存量优秀报告，供借鉴结构与论证方式；其中项目名称与数据不得照抄）\n";
    out += "注：每条参考标注了匹配度等级，请按等级区别对待——高匹配可直接借鉴其论述结构；中匹配需甄别后借鉴；低匹配仅作思路启发，不要照搬其具体表述。\n\n";
    let budget = 2200;
    hits.forEach(m=>{
      if(budget<=200) return;
      const tier = ragTierOf(m.score);
      const c = String(m.text).slice(0, Math.min(1400, budget));
      budget -= c.length;
      out += "《"+(m.title||"历史报告")+"·"+(m.section||m.chapter||"")+"》【"+tier.label+"·匹配度"+m.score+"】\n"+c+"\n\n";
    });
    return out;
  }catch(e){ return ""; }
}

// 黄金范例库：按章节标题匹配范文（管理员在后台维护）
function exampleRetrieve(chapterName, secTitle){
  const exs = CALC_CFG.examples||[];
  if(!exs.length) return "";
  const q = String(chapterName||"") + String(secTitle||"");
  const hits = exs.filter(e=>{
    if(e.domain && domainKey && e.domain!=="all" && e.domain!==domainKey) return false;
    return String(e.match||"").split(/[,，、\s]+/).filter(Boolean).some(k=>q.includes(k));
  }).slice(0,2);
  if(!hits.length) return "";
  let out = "\n\n【优秀范例】（以下为同类项目的优秀章节范文，请学习其结构层次、论证深度与专业表述方式来撰写本节；范文中的具体项目名称、数据一律不得照抄）\n";
  let budget = 3000;
  hits.forEach(e=>{
    if(budget<=200) return;
    const c = String(e.content||"").slice(0, Math.min(1800, budget));
    budget -= c.length;
    out += "《"+(e.title||"范文")+"》：\n"+c+"\n\n";
  });
  return out;
}

// 按章节标题匹配最相关的参考资料（关键词2元组打分，无需向量库）
function kbRetrieve(chapterName, secTitle){
  if(!kbEntries.length) return "";
  const q = String(chapterName||"") + String(secTitle||"");
  const grams = new Set();
  for(let i=0;i<q.length-1;i++){
    const g = q.slice(i,i+2);
    if(/^[\u4e00-\u9fa5]{2}$/.test(g)) grams.add(g);
  }
  const scored = kbEntries.map(e=>{
    let s = 0;
    grams.forEach(g=>{
      if(e.title && e.title.includes(g)) s += 3;
      if(e.content && e.content.includes(g)) s += 1;
    });
    return {e, s};
  }).filter(x=>x.s>=2).sort((a,b)=>b.s-a.s).slice(0,2);
  if(!scored.length) return "";
  let out = "\n\n【参考资料】（以下为真实资料，请优先引用其中的事实、数据与政策表述，引用处以（来源：资料标题）标注；资料未覆盖的内容按原要求撰写，不得虚构资料里没有的内容）\n";
  let budget = 2600;
  scored.forEach(({e})=>{
    if(budget<=100) return;
    const c = String(e.content||"").slice(0, Math.min(1500, budget));
    budget -= c.length;
    out += "《"+(e.title||"未命名资料")+"》：\n"+c+"\n\n";
  });
  return out;
}


// 把HTML稿转回[[TABLE]]源格式（复用docx导出的解析器）
function blocksToSource(htmlStr){
  return htmlToBlocks(htmlStr).map(b=>{
    if(b.type==="table") return "[[TABLE]]\n"+b.rows.map(r=>r.join("|")).join("\n")+"\n[[/TABLE]]";
    return b.text;
  }).join("\n\n");
}

// 按用户修改意见改写小节
async function reviseSection(c, s, instruction, onChunk){
  const digest = s.numeric ? buildCalcDigest() : null;
  const current = s.editedHtml ? blocksToSource(s.editedHtml) : (s.content||"");
  let numRule;
  if(s.numeric && digest){
    numRule = '涉及财务数字时，严格引用下方【真实财务测算结果】中的数字，不得改动或另行编造。\n\n'+digest;
  }else if(s.numeric){
    numRule = '涉及具体金额、比率等数字时一律以"待填"标注，绝不编造精确数字。';
  }else{
    numRule = '不得编造项目未提及的具体事实与数字。';
  }
  const sys = '你是资深工程咨询报告编辑。用户对可研报告某一小节的现稿提出了修改意见，请输出修改后的完整替换稿：\n'
    +'1. 直接输出正文，不要任何说明、开场白或"修改后："之类字样；\n'
    +'2. 未被修改意见涉及的部分尽量保留原稿表述，不做无谓改写；\n'
    +'3. 严格按修改意见调整相应内容；\n'
    +'4. 保持正式公文文风；段落间用空行分隔；表格用[[TABLE]]与[[/TABLE]]包裹、表头在首行、单元格用竖线|分隔；\n'
    +'5. '+numRule;
  const user = '【报告章节】第'+c.cn+'章 '+c.name+' — '+s.t
    +'\n【项目名称】'+(project.name||"（未填写）")
    +'\n\n【当前稿件】\n'+current
    +'\n\n【修改意见】\n'+instruction
    +'\n\n请输出按意见修改后的完整小节正文。'
    + kbRetrieve(c.name, s.t);
  return callGen(sys, user, onChunk);
}

async function generateSection(c, s, onChunk){
  const digest = s.numeric ? buildCalcDigest() : null;
  let tableHint = "";
  if(s.numeric && digest){
    tableHint = '\n本子标题涉及财务数字。下面提供了本项目由内置公式实际计算出的真实测算结果，请：①严格依据这些真实数字撰写分析（数字直接引用，不得改动、不得另行编造）；②在正文中生成1-2个数据表格支撑论述，表格用如下格式包裹（表头行在第一行，单元格用竖线|分隔）：\n[[TABLE]]\n列1|列2|列3\n行1|数值|数值\n[[/TABLE]]\n表格数据从测算结果中选取，允许按年份归并或取关键年份，但数值必须与测算结果一致。\n\n'+digest;
  } else if(s.numeric){
    tableHint = '\n本子标题涉及具体数字或测算，请：①用文字说明测算口径、方法与逻辑；②生成一个结构完整的数据表格，表格用如下格式包裹（表头行在第一行，单元格用竖线|分隔，每行一个换行）：\n[[TABLE]]\n列1|列2|列3\n项目A|待填|待填\n[[/TABLE]]\n表格中的具体数值一律填"待填"，绝不编造精确数字；但表格的行项目、列结构要专业完整、贴合真实可研报告。';
  }
  const sys = '你是一名资深工程咨询工程师，专门撰写政府投资项目和国企项目的可行性研究报告，尤其擅长保障性住房与商业配套改造类项目。请以正式、严谨的官方文书语言撰写，逻辑缜密、层次分明，术语准确，避免口语化和空洞套话。\n要求：\n1. 只依据用户提供的项目信息展开，不得编造项目未提及的具体事实（如虚构的地名、单位名、政策文号）。\n2. 涉及具体金额、比率、财务指标（回报率/IRR/NPV/坪效等）时：若用户消息中提供了【真实财务测算结果】，则严格引用其中的数字，不得改动或另行编造；若未提供，则绝不给出看似权威的精确数字，一律以"待填"标注。\n3. 参照真实可研报告的深度：有分点论述、有逻辑递进、有专业分析，不要泛泛而谈。篇幅约500-800字。\n4. 直接输出该子标题下的正文内容，不要重复子标题，不要客套语，不要"以下是"之类的开场白。'+tableHint;
  const user = '【项目信息】\n项目名称：'+(project.name||"（未填写）")+'\n建设/委托单位：'+(project.owner||"（未填写）")+'\n报告领域：'+project.industry+'\n项目类型：'+(project.type||"（未填写）")+'\n建设地点：'+(project.location||"（未填写）")+'\n投资规模：'+(project.scale?project.scale+"万元":"（未填写）")+'\n项目概况：'+(project.desc||"（未填写）")+ surveyBrief() +'\n\n【当前撰写位置】\n报告章节：'+c.cn+'、'+c.name+'\n本子标题：'+s.t+'\n\n请撰写"'+s.t+'"这一子标题下的正文。' + exampleRetrieve(c.name, s.t) + kbRetrieve(c.name, s.t) + await ragRetrieve(c.name, s.t);

  return callGen(sys, user, onChunk);
}

async function callGen(sys, user, onChunk){
  const resp = await fetch("/api/generate", {
    method:"POST",
    headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
    body: JSON.stringify({ system: sys, messages:[{role:"user", content:user}], stream: !!onChunk })
  });
  if(resp.status===401){ clearAuth(); showLoginModal("登录已过期，请重新登录后继续生成"); throw new Error("登录已过期"); }

  // 流式模式
  if(onChunk && resp.headers.get("content-type")?.includes("text/event-stream")){
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = "", buf = "", usage = null;
    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      buf += decoder.decode(value, {stream:true});
      const lines = buf.split("\n");
      buf = lines.pop();
      for(const line of lines){
        if(!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if(payload === "[DONE]") continue;
        try{
          const j = JSON.parse(payload);
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if(delta && delta.content){ full += delta.content; onChunk(full); }
          if(j.usage) usage = j.usage;
        }catch(e){}
      }
    }
    if(usage){ genUsage.inTok += usage.prompt_tokens||0; genUsage.outTok += usage.completion_tokens||0; }
    return full || "（未返回内容）";
  }

  // 非流式回退
  const data = await resp.json();
  if(data.error) throw new Error(data.error);
  if(data.usage){ genUsage.inTok += data.usage.prompt_tokens||0; genUsage.outTok += data.usage.completion_tokens||0; }
  const text = (data.content||[]).map(b=>b.text||"").join("").trim();
  return text || "（未返回内容）";
}


let docNo = null;
function getDocNo(){
  if(!docNo){
    const d = new Date();
    docNo = "FS-"+d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
  }
  return docNo;
}
function archiveCardHtml(){
  const today = new Date().toLocaleDateString("zh-CN");
  return '<div class="arch-card">'
    +'<div class="ac-cell ac-wide"><span class="ac-l">项目名称</span><span class="ac-v">'+(project.name||"—")+'</span></div>'
    +'<div class="ac-cell"><span class="ac-l">报告领域</span><span class="ac-v">'+(project.industry||"—")+'</span></div>'
    +'<div class="ac-cell"><span class="ac-l">文档编号</span><span class="ac-v ac-mono">'+getDocNo()+'</span></div>'
    +'<div class="ac-cell"><span class="ac-l">编制日期</span><span class="ac-v ac-mono">'+today+'</span></div>'
    +'<div class="ac-cell"><span class="ac-l">文档状态</span><span class="ac-v '+(signed?'ac-ok':'ac-draft')+'">'+(signed?'已复核签发':'AI初稿·待复核')+'</span></div>'
    +'</div>';
}




function readKbFromDom(){
  if(currentStep!==1) return;
  const rows = document.querySelectorAll(".kb-entry");
  kbEntries = [...rows].map(r=>({
    title: r.querySelector(".kb-title").value.trim(),
    content: r.querySelector(".kb-content").value
  })).filter(e=>e.title||e.content.trim());
}
