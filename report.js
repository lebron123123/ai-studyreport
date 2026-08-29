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
let projectWorkflow = window.ProjectWorkflow ? window.ProjectWorkflow.ensureState({}) : {calcSnapshots:[],reportVersions:[]};


/* ---------- 草稿自动存档（浏览器本地，防刷新丢失） ---------- */
const DRAFT_KEY = "fs_draft_v1";
function buildDraftData(){
  return {
    ts: Date.now(), appMode, aiReportSession:typeof aiReportExtracted!=="undefined"&&!!aiReportExtracted, domainKey, currentStep, signed, docNo,
    project: project, calcParams: calcParams, kb: kbEntries, workflow: projectWorkflow,
    chapters: chapters.map(c=>({cn:c.cn, name:c.name, checked:c.checked,
      sections:c.sections.map(s=>({t:s.t, numeric:s.numeric, content:s.content, editedHtml:s.editedHtml||null,
        locked:!!s.locked,syncStatus:s.syncStatus||"current",staleReason:s.staleReason||"",staleKeys:s.staleKeys||[],
        pendingRevision:s.pendingRevision||null,undoStack:s.undoStack||[],prov:s.prov||null}))}))
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
function restoreDraft(d, options){
  options=options||{};
  // 浏览器刷新时只恢复项目数据，不替用户决定要进入哪个功能模块。
  // “我的项目→打开”及草稿栏的人工恢复仍沿用原模式，保持完整工作现场恢复能力。
  appMode = options.openHome ? null
    : (window.ProjectWorkflow?ProjectWorkflow.resumeAppMode(d.appMode,!!d.aiReportSession):(d.aiReportSession?"aireport":"report"));
  domainKey = d.domainKey; signed = !!d.signed; docNo = d.docNo||null;
  Object.assign(project, d.project||{});
  calcParams = d.calcParams||null;
  projectWorkflow = window.ProjectWorkflow ? window.ProjectWorkflow.ensureState(d.workflow||{}) : (d.workflow||{calcSnapshots:[],reportVersions:[]});
  kbEntries = d.kb||[];
  if(domainKey){ loadDomain(domainKey); Object.assign(project, d.project||{}); }
  if(d.chapters && chapters.length){
    d.chapters.forEach((dc,i)=>{
      if(!chapters[i]) return;
      chapters[i].checked = dc.checked;
      dc.sections.forEach((ds,j)=>{
        if(chapters[i].sections[j]){ Object.assign(chapters[i].sections[j],{
          content:ds.content||"",editedHtml:ds.editedHtml||null,locked:!!ds.locked,syncStatus:ds.syncStatus||"current",
          staleReason:ds.staleReason||"",staleKeys:ds.staleKeys||[],pendingRevision:ds.pendingRevision||null,
          undoStack:ds.undoStack||[],prov:ds.prov||null}); }
      });
    });
  }
  if(calcParams){
    try{
      const t=(projectWorkflow.calcSnapshots||[]).find(x=>x.id===projectWorkflow.currentCalcSnapshotId)?.calcType
        ||(domainKey==="baozhang_gaibao"?"gaibao":rptCtype||"rent");
      calcType=t;rptCtype=t==="sale"?"sale":"rent";calcResult=runCalcEngine(t,calcParams);calcResult.__ctype=t;scParams=calcParams;scResult=calcResult;
      if(t==="gaibao")calcResult.sens=computeSensitivity(calcParams);
    }catch(e){calcResult=null;}
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
      if(Object.keys(map).length){
        dynamicOutlines = map; return map;
      }
    }
  }catch(e){}
  dynamicOutlines = window.OUTLINES || {};
  return dynamicOutlines;
}
function getOutlines(){ return dynamicOutlines || window.OUTLINES || {}; }

function reportLoadDomainSource(key,src){
  domainKey = key;
  if(!src)throw new Error("未找到可研大纲："+key);
  project.industry = src.label;
  chapters = src.chapters.map(ch=>({
    cn: ch.cn, name: ch.name, checked: true,
    sections: ch.sections.map(s=>({ t: s.t, numeric: !!s.numeric, content: "" }))
  }));
}
function loadDomain(key){ reportLoadDomainSource(key,getOutlines()[key]); }


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
    calcParams = rptCtype === "sale" ? readSaleForm() : readRentForm();
    calcResult = runCalcEngine(rptCtype, calcParams);
    calcResult.__ctype = rptCtype;
    scParams = calcParams; scResult = calcResult;   // 供共享部件读取
    if(window.ProjectWorkflow) window.ProjectWorkflow.createCalcSnapshot(projectWorkflow,rptCtype,calcParams,calcResult,{reason:"财务测算确认",confirmedBy:typeof getUser==="function"?getUser():""});
    saveDraft();
    document.getElementById("calcResultBox").innerHTML = calcResultHtml() + modeCompareHtml();
    animateCountUps();
    document.getElementById("toStep3c").textContent = "下一步：选择章节 →";
  }catch(e){ alert("测算失败："+e.message); }
}

function runCalc(){
  if(domainKey !== "baozhang_gaibao"){ return runRptCalcOther(); }
  calcParams = readCalcForm();
  calcResult = runCalcEngine("gaibao", calcParams);
  calcResult.__ctype = "gaibao";
  if(window.ProjectWorkflow) window.ProjectWorkflow.createCalcSnapshot(projectWorkflow,"gaibao",calcParams,calcResult,{reason:"财务测算确认",confirmedBy:typeof getUser==="function"?getUser():""});
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

// N个worker从共享队列里shift任务、await处理、直到队列空的通用并发原语。
// report.js(章节生成)/review.js(AI评审)/aireport.js(AI可研生成) 三处共用。
// shouldContinue 可选：每次shift前额外检查一次（比如"停止生成"标志），不满足时保留剩余任务在队列里不再处理。
function runWorkerPool(queue, workerFn, concurrency, shouldContinue){
  shouldContinue = shouldContinue || function(){ return true; };
  const n = Math.min(concurrency, queue.length);
  const workers = Array.from({length:n}, ()=>(async ()=>{
    while(queue.length && shouldContinue()){
      const t = queue.shift();
      await workerFn(t);
    }
  })());
  return Promise.all(workers);
}
// 一篇报告的生成以远端模型调用为主，4路能比原3路缩短约一成至两成墙钟时间，
// 同时保留全局覆盖口供本地/服务器按模型限流能力调低或调高（安全范围2~6）。
function reportGenerationConcurrency(total){
  const configured=Number((typeof window!=="undefined"&&window.REPORT_GENERATION_CONCURRENCY)||4);
  const safe=Number.isFinite(configured)?Math.max(2,Math.min(6,Math.round(configured))):4;
  return Math.max(1,Math.min(Number(total)||1,safe));
}
async function runGeneration(){
  await ensureReportTableTemplates();
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
      secEl.querySelector(".body").innerHTML = renderSectionContent(c,s,false);
      secEl.querySelector("h4").insertAdjacentHTML("beforeend", '<span class="done-stamp">已拟</span>' + provBadgeHtml(c.cn, si, s.prov));
      bindProvToggle(secEl);
      saveDraft();
    }catch(e){
      failed++;
      secEl.classList.remove("gen");
      secEl.querySelector(".body").innerHTML = '<span style="color:var(--seal-red);">生成失败：'+escapeHtml(e.message)+'</span> <button class="retry-btn btn ghost" data-cn="'+c.cn+'" data-si="'+si+'" style="padding:3px 12px; font-size:11px; margin-left:8px;">重试</button>';
    }
    done++;
    progressEl.textContent = reportGenerationConcurrency(total)+'路并行撰写中… 已完成 '+done+'/'+total + (failed? '（失败 '+failed+'）':'');
  }
  await runWorkerPool(tasks, handleOne, reportGenerationConcurrency(total));

  const cost = (genUsage.inTok*PRICE_IN_PER_M + genUsage.outTok*PRICE_OUT_PER_M)/1000000;
  let tail = '已完成 '+(total-failed)+'/'+total+' 个子标题的初稿起草' + (failed? '（'+failed+' 个失败，可在下方点击重试）':'。');
  if(genUsage.inTok||genUsage.outTok){
    tail += ' ｜ 实际消耗：输入 '+genUsage.inTok.toLocaleString()+' + 输出 '+genUsage.outTok.toLocaleString()+' tokens ≈ ¥'+cost.toFixed(2);
  }
  progressEl.textContent = tail;
  const chapterContainer=document.getElementById("chapterContainer");
  if(chapterContainer&&!document.getElementById("rentTableAppendixPreview")){
    const appendixHtml=renderReportTableAppendix();
    if(appendixHtml)chapterContainer.insertAdjacentHTML("beforeend",'<div id="rentTableAppendixPreview">'+appendixHtml+'</div>');
  }
  genBtn.style.display = "none";
  document.getElementById("toStep5r").style.display = "inline-block";
  if(window.ProjectWorkflow)window.ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta("完成初稿生成"));
  saveDraft();
  bindEvents();
}

async function updateStaleSections(){
  const tasks=[]; chapters.filter(c=>c.checked).forEach(c=>c.sections.forEach((s,si)=>{if(s.syncStatus==="stale"&&!s.locked)tasks.push({c,s,si});}));
  if(!tasks.length){alert("没有可自动更新的小节；锁定小节需要先解除锁定。");return;}
  const btn=document.getElementById("wfUpdateStale");if(btn){btn.disabled=true;btn.textContent="正在生成候选稿…";}
  let failed=0;
  await runWorkerPool(tasks,async t=>{try{const text=await reviseSection(t.c,t.s,"测算参数已经更新。请严格依据最新真实测算结果，只修改受影响的数字、判断和分析，其他内容尽量保留。");window.ProjectWorkflow.setCandidate(t.s,text,"同步最新测算");}catch(e){failed++;}},3);
  saveDraft();renderSheet();if(failed)alert(failed+"个小节候选稿生成失败，可单独重试。");
}

// 界面渲染：统一走 md.js（支持标题/列表/表格/引用/分隔线/行内样式，并兼容旧的[[TABLE]]语法）
// 保留降级分支：万一 md.js 未加载，仍能按老逻辑显示，不至于整页空白
function renderContent(text){
  if(window.MD && typeof window.MD.renderHtml === "function"){
    return window.MD.renderHtml(text).replace(/【待补：([^】]+)】/g,'<span class="rpt-missing-placeholder">【待补：$1】</span>');
  }
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

function reportTableProjectType(){
  const type=(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"");
  return type==="rent"?"rent":null;
}
async function ensureReportTableTemplates(){
  const type=reportTableProjectType();
  if(!type||!window.ReportTableTemplates)return null;
  try{return await window.ReportTableTemplates.load(type);}catch(e){console.warn("出租类标准表格模板加载失败",e);return null;}
}
function sectionFormalTemplates(c,s){
  const type=reportTableProjectType();
  return type&&window.ReportTableTemplates?window.ReportTableTemplates.forSection(type,c.name,s.t):[];
}
function renderSectionContent(c,s,useEdited){
  const base=useEdited&&s.editedHtml?s.editedHtml:renderContent(s.content||"");
  if(/data-template-id=/.test(base))return base;
  const type=reportTableProjectType();
  const tables=type&&window.ReportTableTemplates?window.ReportTableTemplates.renderSection(type,c.name,s.t):"";
  return base+tables;
}
function renderReportTableAppendix(){
  const type=reportTableProjectType();
  if(!type||!window.ReportTableTemplates)return "";
  const html=window.ReportTableTemplates.renderAppendix(type);
  return html?'<details class="rpt-template-appendix"><summary>附：出租类标准财务附表（7套，点击查看；70年表按年度区间续表）</summary>'+html+'</details>':"";
}

function reportBodyContainsInternalLogic(text){
  return /【(?:逐小节生成逻辑|内部生成约束)/.test(String(text||""))
    || /(?:^|\n)\s*(?:材料状态|所需材料摘要|写作逻辑|输出形式)：/.test(String(text||""))
    || /本节重点按照以下逻辑展开/.test(String(text||""));
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


// 溯源徽章：小节标题后显示置信度，点击展开依据详情
function provBadgeHtml(cn, si, prov){
  if(!prov || !prov.confidence) return "";
  const cf = prov.confidence;
  return '<span class="prov-badge" data-prov="'+cn+'_'+si+'" title="点击查看本节生成依据" '
    +'style="cursor:pointer; font-family:var(--mono); font-size:9.5px; letter-spacing:.5px; padding:1px 7px; '
    +'border:1px solid '+cf.color+'; color:'+cf.color+'; border-radius:2px; margin-left:6px;">依据 '+cf.label+'</span>'
    +'<div class="prov-detail" data-provbox="'+cn+'_'+si+'" style="display:none; margin-top:8px; padding:10px 12px; '
    +'background:#F7FAFD; border:1px solid var(--line); border-radius:6px; font-size:11.5px; line-height:1.75; color:var(--ink-soft); font-weight:400;">'
    + provDetailHtml(prov) + '</div>';
}
function provDetailHtml(p){
  const cf = p.confidence || {};
  let h = '<div style="color:'+(cf.color||"#666")+'; font-weight:600; margin-bottom:6px;">本节生成依据（置信度 '+(cf.label||"")+'，'+Math.round((cf.score||0)*100)+'分）</div>';
  h += '<div style="margin-bottom:6px;">' + (cf.basis||[]).map(b=>"· "+escapeHtml(b)).join("<br>") + '</div>';
  if(p.hasCalcData) h += '<div>📊 <b>财务数据来源</b>：本项目内置公式实时测算结果（非AI生成，可在财务测算页复算核对）</div>';
  if((p.kbDocs||[]).length) h += '<div>📎 <b>引用资料</b>：' + p.kbDocs.map(d=>escapeHtml(d.title)).join("、") + '</div>';
  if((p.rag||[]).length){
    h += '<div>📚 <b>知识库检索命中</b>：<br>' + p.rag.map(r=>{
      const life = (r.lifecycle && r.lifecycle!=="valid") ? ' <span style="color:var(--seal-red);">⚠'+escapeHtml(r.lifecycleNote||r.lifecycle)+'</span>' : '';
      return '　《'+escapeHtml(r.title)+(r.section?" · "+escapeHtml(r.section):"")+'》 '+r.tier+' '+r.score+life;
    }).join("<br>") + '</div>';
  }
  if((p.examples||[]).length) h += '<div>✍ <b>参照范例</b>：' + p.examples.map(e=>escapeHtml(e.title)).join("、") + '</div>';
  if((p.projectFields||[]).length) h += '<div>📁 <b>使用的项目信息</b>：' + p.projectFields.join("、") + '</div>';
  h += '<div style="margin-top:6px; padding-top:6px; border-top:1px dashed var(--line); font-size:10.5px;">'
    + '🤖 生成模型：' + escapeHtml(p.model||"-") + '　⏱ 生成时间：' + (p.generatedAt ? new Date(p.generatedAt).toLocaleString("zh-CN") : "-") + '</div>';
  return h;
}
// 报告版本只绑定各输入快照的标识/哈希，不复制知识库与联网正文，兼顾追溯和存储体积。
function currentReportVersionMeta(reason){
  const provs=[];(chapters||[]).forEach(c=>(c.sections||[]).forEach(s=>{if(s.prov)provs.push(s.prov);}));
  const models=[...new Set(provs.map(p=>p.model).filter(Boolean))];
  return {reason:reason||"报告保存",projectData:project,parameterSet:calcParams||null,calcEngineVersion:"whitebox-2026-08",
    knowledgeSnapshot:{localFiles:(kbEntries||[]).map(x=>({title:x.title,length:String(x.content||"").length})),rag:provs.flatMap(p=>p.rag||[]).map(x=>({title:x.title,section:x.section,score:x.score,lifecycle:x.lifecycle}))},
    evidenceSnapshot:provs.map((p,i)=>({section:i,excel:p.excelSources||[],web:p.webEvidence||p.web||[],projectFields:p.projectFields||[]})),
    workflowVersion:"ai-studyreport-workflow-2026-08-28",promptVersion:"report-generation-2026-08-28",model:models.join(",")||null,
    reviewSnapshot:projectWorkflow&&projectWorkflow.reviewSnapshot||null};
}

function bindProvToggle(scope){
  (scope||document).querySelectorAll(".prov-badge").forEach(b=>{
    if(b.__bound) return; b.__bound = true;
    b.onclick = ()=>{
      const box = (scope||document).querySelector('[data-provbox="'+b.dataset.prov+'"]');
      if(box) box.style.display = box.style.display === "none" ? "block" : "none";
    };
  });
}

/* ===== 多级溯源体系 =====
   L1 数据溯源：财务数字来自哪次测算（确定性引擎，非AI生成）
   L2 素材溯源：本节生成时注入了哪些知识库文档/范例/项目资料
   L3 模型溯源：用什么模型、什么时间生成
   置信度：按素材构成加权，让人一眼看出"这节有多少真凭实据"
*/
function projectExcelSources(){ try{return JSON.parse(sessionStorage.getItem("projectExcelSources")||"[]")||[];}catch(e){return [];} }
function excelSourceRetrieve(collector){
  const xs=projectExcelSources(); if(!xs.length) return "";
  if(collector) collector.excelSources.push(...xs);
  return "\n\n【已确认的 Excel 数字来源】\n"+xs.map((x,i)=>(i+1)+". "+x.label+" = "+x.displayValue+(x.formula?"（公式："+x.formula+"）":"")+(x.sourceRef?"；原始依据："+x.sourceRef:"")).join("\n")+"\n只能引用与当前章节直接相关的数字；不确定时不要使用。";
}
async function mappedExcelSourceRetrieve(collector){
  try{
    const ct=(typeof calcType!=="undefined"?calcType:"")||"";
    const r=await fetch("/api/materials",{method:"POST",headers:authHeaders(),body:JSON.stringify({action:"resolveMappings",projectType:(project&&project.type)||"",calcType:ct})});
    const d=await r.json(), xs=d.values||[]; if(!d.ok||!xs.length){ try{sessionStorage.removeItem("resolvedExcelMappings");}catch(e){} return ""; }
    try{sessionStorage.setItem("resolvedExcelMappings",JSON.stringify(xs));}catch(e){}
    if(collector) collector.excelSources.push(...xs.map(x=>({label:"《"+x.workbook_title+"》→"+x.sheet_name+"!"+x.cell_address,displayValue:x.display_value,formula:x.formula||"",sourceRef:x.source_ref||""})));
    return "\n\n【项目字段自动映射（Excel 原始单元格）】\n"+xs.map(x=>"- "+(x.field_label||x.field_key)+"："+x.display_value+"［《"+x.workbook_title+"》→"+x.sheet_name+"!"+x.cell_address+"］").join("\n")+"\n仅在字段含义明确匹配时引用；不得自行换算或编造。";
  }catch(e){return "";}
}
function provStart(){ return { rag:[], examples:[], kbDocs:[], excelSources:[], hasCalcData:false, projectFields:[] }; }

// 置信度：有真实测算数据 > 有高匹配知识库依据 > 仅项目信息 > 纯AI发挥
function provConfidence(p){
  if(!p) return { score:0.5, label:"一般", color:"#8A6D1B", basis:["无溯源记录"] };
  const basis = [];
  let score = 0.55;   // 基线：仅凭项目信息与模型常识生成
  if(p.hasCalcData){ score = Math.max(score, 0.95); basis.push("引用了内置公式计算的真实测算数据"); }
  if((p.excelSources||[]).length){ score = Math.max(score, 0.92); basis.push("引用了"+(p.excelSources||[]).length+"项可定位到单元格的 Excel 数据"); }
  const hiRag = p.rag.filter(r=>r.score >= 0.85);
  const midRag = p.rag.filter(r=>r.score >= 0.70 && r.score < 0.85);
  if(hiRag.length){ score = Math.max(score, 0.85); basis.push("有"+hiRag.length+"条高匹配知识库依据"); }
  else if(midRag.length){ score = Math.max(score, 0.72); basis.push("有"+midRag.length+"条中匹配知识库依据"); }
  else if(p.rag.length){ basis.push("仅有低匹配知识库参考"); }
  if(p.kbDocs.length){ score = Math.max(score, 0.80); basis.push("引用了"+p.kbDocs.length+"份人工上传的项目资料"); }
  if(p.examples.length) basis.push("参照了"+p.examples.length+"篇黄金范例的结构");
  // 有过期资料则扣分并提示
  const expired = p.rag.filter(r=>r.lifecycle && r.lifecycle !== "valid");
  if(expired.length){ score = Math.max(0.5, score - 0.1); basis.push("⚠含"+expired.length+"条时效异常资料，需人工核实"); }
  if(!basis.length) basis.push("主要依据项目信息与模型通用知识，无外部资料支撑");
  const label = score >= 0.9 ? "高" : score >= 0.75 ? "较高" : score >= 0.6 ? "中" : "偏低";
  const color = score >= 0.9 ? "#3E7A53" : score >= 0.75 ? "#1F7A3D" : score >= 0.6 ? "#8A6D1B" : "#C24A42";
  return { score: Math.round(score*100)/100, label, color, basis };
}

// 相似度分层策略（参考行业实践：不同匹配度的资料，可信程度不同，应区别使用）
// 分层阈值：默认值如下，实际以后端返回的配置为准（后台"⚖️检索调优"可调）
const RAG_TIER = {
  HIGH: 0.85,    // 高匹配：内容高度相关，可直接借鉴论述结构
  MID:  0.70,    // 中匹配：主题相关，需甄别后借鉴
  LOW:  0.55,    // 低匹配：仅作思路启发，不宜照搬
  MIN:  0.55,    // 低于此值不返回（避免噪音干扰生成）
};
// 后端每次检索会返回当前生效的阈值配置，同步过来保证前后端判定一致
function syncRagTier(tier){
  if(!tier) return;
  if(typeof tier.high === "number") RAG_TIER.HIGH = tier.high;
  if(typeof tier.mid  === "number") RAG_TIER.MID  = tier.mid;
  if(typeof tier.min  === "number"){ RAG_TIER.MIN = tier.min; RAG_TIER.LOW = tier.min; }
}
function ragTierOf(score){
  const s = Number(score) || 0;
  if(s >= RAG_TIER.HIGH) return { key:"high", label:"高匹配" };
  if(s >= RAG_TIER.MID)  return { key:"mid",  label:"中匹配" };
  return { key:"low", label:"低匹配·仅供参考" };
}
async function ragRetrieve(chapterName, secTitle, collector){
  if(ragAvailable === false) return "";
  try{
    const q = (project.industry||"") + " " + String(chapterName||"") + " " + String(secTitle||"");
    const r = await fetch("/api/rag", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"query", query:q, topK:2})});
    const d = await r.json();
    if(!d.ok){ if(/未绑定|不可用/.test(d.error||"")) ragAvailable = false; return ""; }
    ragAvailable = true;
    syncRagTier(d.tier);   // 同步后台配置的分层阈值，保证前后端判定一致
    // 相似度分层：不同置信度的参考资料，给AI的使用指引不同（避免把勉强沾边的当权威用）
    const hits = (d.matches||[]).filter(m=>m.text && m.score >= RAG_TIER.MIN);
    if(!hits.length) return "";
    const hasWiki = hits.some(m=>String(m.title||"").startsWith("【Wiki】"));
    let out = hasWiki
      ? "\n\n【公司知识 Wiki 与资料依据】（其中标有“公司 Wiki”的内容已经人工审核发布，可作为内部编制/审核口径；仍须遵守其原始依据、适用范围与时效限制。历史报告只可借鉴结构和论证方式，项目名称与数据不得照抄）\n"
      : "\n\n【历史报告参考】（语义检索自本单位存量优秀报告，供借鉴结构与论证方式；其中项目名称与数据不得照抄）\n";
    out += "注：每条参考标注了匹配度等级。高匹配的已发布 Wiki 可按其适用范围执行；其他资料仍需甄别，低匹配仅作思路启发。\n\n";
    let budget = 2200;
    hits.forEach(m=>{
      if(budget<=200) return;
      const tier = ragTierOf(m.score);
      if(collector) collector.rag.push({ title:m.title||"历史报告", section:m.section||m.chapter||"",
        score:m.score, tier:tier.label, lifecycle:m.lifecycle||"valid", lifecycleNote:m.lifecycleNote||"",
        docNo:m.docNo||"", issuer:m.issuer||"", sourceRef:m.sourceRef||"", exact:!!m.exact, exactReason:m.exactReason||"" });
      const c = String(m.text).slice(0, Math.min(1400, budget));
      budget -= c.length;
      const lifeTag = (m.lifecycle && m.lifecycle !== "valid") ? "⚠该文件"+(m.lifecycleNote||"时效异常")+"，不得作为现行依据引用；" : "";
      const precise = (m.docNo?"文号："+m.docNo+"；":"")+(m.issuer?"发布机关："+m.issuer+"；":"")+(m.sourceRef?"原始定位："+m.sourceRef+"；":"")+(m.exact?"“"+(m.exactReason||"精确命中")+"”；":"");
      out += "《"+(m.title||"历史报告")+"·"+(m.section||m.chapter||"")+"》【"+lifeTag+(precise||"")+tier.label+"·匹配度"+m.score+"】\n"+c+"\n\n";
    });
    return out;
  }catch(e){ return ""; }
}

/* 联网证据只消费用户已经人工采用的记录；候选搜索结果不会悄悄进入正文。 */
function webEvidenceRetrieve(chapterName,secTitle,collector){
  return window.WebResearch?.contextForSection?.(chapterName,secTitle,collector)||"";
}

// 黄金范例库：按章节标题匹配范文（管理员在后台维护）
function exampleRetrieve(chapterName, secTitle, collector){
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
    if(collector) collector.examples.push({ title: e.title||"范文" });
    const c = String(e.content||"").slice(0, Math.min(1800, budget));
    budget -= c.length;
    out += "《"+(e.title||"范文")+"》：\n"+c+"\n\n";
  });
  return out;
}

// 编制审查标准：生成阶段就按签发前"AI深度审核"用的同一份标准写，而不是等审核环节才发现不达标。
// 文本部分复用 CALC_CFG.airules（和 review.js 的 aiRulesFor 完全同一套匹配逻辑，两处代码分别维护是因为
// report.js/review.js 是各自独立注入 <script> 的模块，没有共享的工具文件，保持逻辑一致比硬合并两个文件更重要）。
function stdTextRetrieve(chapterName, secTitle){
  const rules = CALC_CFG.airules||[];
  if(!rules.length) return [];
  const q = String(chapterName||"") + String(secTitle||"");
  return rules.filter(r=> r.match==="*" || String(r.match||"").split(/[,，、\s]+/).filter(Boolean).some(k=>q.includes(k)));
}
// 测算部分（calcstd）按大类关键词映射到章节标题做粗匹配——calcstd条目本身没有存match字段，
// 因为它是结构化标准（供硬规则核对用），匹配关键词维护在代码里，后台改标准内容不用连带改匹配规则。
const CS_CATEGORY_KEYWORDS = {
  "通用假设":"测算假设,折现率,贷款利率,财务评价,融资",
  "出租假设-运营成本":"运营成本,运营费用,经营成本,费用假设,测算假设",
  "收入假设-销售":"收入假设,销售价格,去化,售价",
  "收入假设-出租(住宅)":"收入假设,租金,出租率,住宅",
  "收入假设-出租(商业)":"收入假设,租金,出租率,商业",
  "收入假设-车位":"收入假设,车位,停车",
  "总控计划":"工期,进度计划,总控",
  "成本假设-建安费":"投资估算,建安,成本假设",
  "成本假设-期间费":"投资估算,期间费,成本假设",
  "规划指标核对":"投资估算,规划指标",
  "资金筹措核对":"资金筹措,融资方案",
  "地价核对":"投资估算,土地成本,地价",
  "财务结果核对":"财务评价,财务指标,财务测算结果",
  "敏感性分析/附表":"敏感性分析,附表",
};
function stdCalcRetrieve(chapterName, secTitle){
  const items = CALC_CFG.calcstd||[];
  if(!items.length) return [];
  const q = String(chapterName||"") + String(secTitle||"");
  return items.filter(e=>{
    const kw = CS_CATEGORY_KEYWORDS[e.category||""] || "";
    return kw.split(",").some(k=>k && q.includes(k));
  }).slice(0,8);   // 数字类小节prompt本来就大，标准最多取8条，太多会挤占测算结果本身的篇幅
}
function stdRetrieve(chapterName, secTitle, numeric){
  const textHits = stdTextRetrieve(chapterName, secTitle);
  let out = "";
  if(textHits.length){
    out += '\n\n【审查标准】（签发前"AI深度审核"会按同一份公司编制审查标准逐条复核本节，请撰写时直接满足，不要等审核环节再补）\n'
      + textHits.map((r,i)=>"["+(r.id||("KY-"+String(i+1).padStart(3,"0")))+"] "+r.rule+(r.reason?"（依据摘要："+r.reason+"）":"")).join("\n");
  }
  if(numeric){
    const calcHits = stdCalcRetrieve(chapterName, secTitle);
    if(calcHits.length){
      out += '\n\n【测算取值标准】（以下为公司《可研报告编制与审查指引》里本节涉及的取值标准，须优先遵循；缺项目属性信息（如项目性质分类/所在区域）无法判断具体应适用哪一档时，须在正文标注"以下按XX档估算，具体以主管部门/相关部门意见为准"，不得凭空选一个档次冒充确定结论）\n'
        + calcHits.map((e,i)=>"["+(e.id||("CS-"+String(i+1).padStart(3,"0")))+"] "+(e.item?e.item+"：":"")+(e.standard||"")+(e.reason?"（依据摘要："+e.reason+"）":"")).join("\n");
    }
  }
  return out;
}

function rlProjectType(){
  const type = (calcType||(calcResult&&calcResult.__ctype)||rptCtype||"");
  return type==="sale"?"sale":type==="gaibao"?"gaibao":"rent";
}
function rlProjectText(){
  return [project.name,project.type,project.location,project.desc].filter(Boolean).join(" ");
}
function rlRetrieve(chapterName, secTitle){
  if(!window.ReportLogicCore)return "";
  return ReportLogicCore.prompt(rlProjectType(),chapterName,secTitle,{projectText:rlProjectText(),context:typeof airMaterialContext==="function"?airMaterialContext():{hasCalculation:!!(calcParams&&calcResult)}});
}

// 按章节标题匹配最相关的参考资料（关键词2元组打分，无需向量库）
function kbRetrieve(chapterName, secTitle, collector){
  if(!kbEntries.length) return "";
  const q = String(chapterName||"") + String(secTitle||"");
  const grams = new Set();
  for(let i=0;i<q.length-1;i++){
    const g = q.slice(i,i+2);
    if(/^[\u4e00-\u9fa5]{2}$/.test(g)) grams.add(g);
  }
  const scored = kbEntries.map(e=>{
    let s = 0;
    if(e.chapter&&(String(chapterName||"").includes(e.chapter)||e.chapter.includes(String(chapterName||""))))s+=40;
    if(e.section&&(String(secTitle||"").includes(e.section)||e.section.includes(String(secTitle||""))))s+=80;
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
    if(collector) collector.kbDocs.push({ title: e.title||"未命名资料" });
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
    if(b.type==="templateTable") return "";
    return b.text;
  }).filter(Boolean).join("\n\n");
}

// 按用户修改意见改写小节
async function reviseSection(c, s, instruction, onChunk){
  if(window.ReportLogicCore){try{await ReportLogicCore.load(rlProjectType());}catch(e){}}
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
    + rlRetrieve(c.name,s.t)
    + kbRetrieve(c.name, s.t);
  return callGen(sys, user, onChunk);
}

// 仅改写用户在预览正文中拖选的片段；返回“替换片段”，完整小节的安全拼接由 ProjectWorkflow 完成。
async function reviseSectionExcerpt(c,s,selected,instruction,onChunk){
  if(window.ReportLogicCore){try{await ReportLogicCore.load(rlProjectType());}catch(e){}}
  const current=s.editedHtml?blocksToSource(s.editedHtml):(s.content||"");
  const sys='你是资深工程咨询报告编辑。请只改写用户指定的正文片段：\n'
    +'1. 只输出用于替换原片段的新文字，不要输出说明、引号、标题或“修改后”等字样；\n'
    +'2. 不改变片段中的项目事实、数字和政策口径，除非修改意见明确要求且上下文已有可靠依据；\n'
    +'3. 保持与完整小节一致的正式公文文风和上下文衔接；\n'
    +'4. 不得扩写到未被选中的其他段落。';
  const user='【报告位置】第'+c.cn+'章 '+c.name+' — '+s.t
    +'\n\n【完整小节（仅供理解上下文）】\n'+current
    +'\n\n【需要替换的原片段】\n'+String(selected||'')
    +'\n\n【修改意见】\n'+String(instruction||'请使表述更准确、正式、简洁')
    +'\n\n请只输出替换片段。'+rlRetrieve(c.name,s.t)+kbRetrieve(c.name,s.t);
  return callGen(sys,user,onChunk);
}

async function generateSection(c, s, onChunk){
  const collector=provStart();   // 每个并发任务独享，避免不同小节的溯源相互串写
  if(window.ReportLogicCore){try{await ReportLogicCore.load(rlProjectType());}catch(e){}}
  await ensureReportTableTemplates();
  const formalTemplates=sectionFormalTemplates(c,s);
  const digest = s.numeric ? buildCalcDigest() : null;
  if(digest) collector.hasCalcData = true;
  let tableHint = "";
  if(formalTemplates.length){
    tableHint='\n本节已由系统按公司出租类标准报告自动插入以下固定表格：'+formalTemplates.map(t=>'《'+t.title+'》').join('、')+'。正文只负责解释口径、分析结论和表格前后衔接，不得自行重画表格、重复罗列表头或改变表格结构；项目专属数值由资料与测算引擎后续填充。'+(digest?'\n\n【真实财务测算结果】\n'+digest:'');
  } else if(s.numeric && digest){
    tableHint = '\n本子标题涉及财务数字。下面提供了本项目由内置公式实际计算出的真实测算结果，请：①严格依据这些真实数字撰写分析（数字直接引用，不得改动、不得另行编造）；②在正文中生成1-2个数据表格支撑论述，表格用如下格式包裹（表头行在第一行，单元格用竖线|分隔）：\n[[TABLE]]\n列1|列2|列3\n行1|数值|数值\n[[/TABLE]]\n表格数据从测算结果中选取，允许按年份归并或取关键年份，但数值必须与测算结果一致。\n\n'+digest;
  } else if(s.numeric){
    tableHint = '\n本子标题涉及具体数字或测算，请：①用文字说明测算口径、方法与逻辑；②生成一个结构完整的数据表格，表格用如下格式包裹（表头行在第一行，单元格用竖线|分隔，每行一个换行）：\n[[TABLE]]\n列1|列2|列3\n项目A|待填|待填\n[[/TABLE]]\n表格中的具体数值一律填"待填"，绝不编造精确数字；但表格的行项目、列结构要专业完整、贴合真实可研报告。';
  }
  const sys = '你是一名资深工程咨询工程师，专门撰写政府投资项目和国企项目的可行性研究报告，尤其擅长保障性住房与商业配套改造类项目。请以正式、严谨的官方文书语言撰写，逻辑缜密、层次分明，术语准确，避免口语化和空洞套话。\n要求：\n1. 只依据用户提供的项目信息展开，不得编造项目未提及的具体事实（如虚构的地名、单位名、政策文号）。\n2. 材料不足时仍须先完成专业的分析框架、论证方法、逻辑链和表格结构，禁止整节只返回待补提示或空内容；只有项目专属事实、关键数字、批复、证照、合同等依据在对应位置简短标注“【待补：具体依据】”。\n3. 涉及具体金额、比率、财务指标（回报率/IRR/NPV/坪效等）时：若用户消息中提供了【真实财务测算结果】，则严格引用其中的数字，不得改动或另行编造；若未提供，则绝不给出看似权威的精确数字，一律以"待填"标注。\n4. 参照真实可研报告的深度：有分点论述、有逻辑递进、有专业分析，不要泛泛而谈。篇幅约500-800字。\n5. 直接输出该子标题下的正文内容，不要重复子标题，不要客套语，不要"以下是"之类的开场白。'+tableHint;
  // 记录本节用到了哪些项目信息字段（L2溯源的一部分）
  [["项目名称",project.name],["建设/委托单位",project.owner],["建设地点",project.location],
   ["投资规模",project.scale],["项目概况",project.desc]].forEach(([k,v])=>{
    if(v && String(v).trim()) collector.projectFields.push(k);
  });
  const excelContext=s.numeric?(excelSourceRetrieve(collector)+await mappedExcelSourceRetrieve(collector)):"";
  const logicRules=window.ReportLogicCore?ReportLogicCore.match(rlProjectType(),c.name,s.t,{projectText:rlProjectText()}):[];
  const user = '【项目信息】\n项目名称：'+(project.name||"（未填写）")+'\n建设/委托单位：'+(project.owner||"（未填写）")+'\n报告领域：'+project.industry+'\n项目类型：'+(project.type||"（未填写）")+'\n建设地点：'+(project.location||"（未填写）")+'\n投资规模：'+(project.scale?project.scale+"万元":"（未填写）")+'\n项目概况：'+(project.desc||"（未填写）")+ surveyBrief() +'\n\n【当前撰写位置】\n报告章节：'+c.cn+'、'+c.name+'\n本子标题：'+s.t+'\n\n请撰写"'+s.t+'"这一子标题下的正文。' + rlRetrieve(c.name,s.t) + stdRetrieve(c.name, s.t, s.numeric) + exampleRetrieve(c.name, s.t, collector) + kbRetrieve(c.name, s.t, collector) + webEvidenceRetrieve(c.name,s.t,collector) + excelContext + (typeof analysisReportContext==="function"?analysisReportContext(c.name,s.t):"") + await ragRetrieve(c.name, s.t, collector);

  let text = await callGen(sys, user, onChunk);
  if(!text || text === "（未返回内容）" || reportBodyContainsInternalLogic(text)){
    text = window.ReportLogicCore?.fallbackDraft
      ? ReportLogicCore.fallbackDraft(rlProjectType(),c.name,s.t,{projectText:rlProjectText(),numeric:!!s.numeric,context:typeof airMaterialContext==="function"?airMaterialContext():{hasCalculation:!!(calcParams&&calcResult)}})
      : (s.t+"应结合项目实际条件建立分析框架，并在取得正式资料后补充项目专属事实、关键数据和最终结论。\n\n【待补：与本节相关的正式依据】");
    if(onChunk) onChunk(text);
  }
  if(window.ReportLogicCore?.ensureMissingMarkers){
    text=ReportLogicCore.ensureMissingMarkers(text,logicRules,typeof airMaterialContext==="function"?airMaterialContext():{hasCalculation:!!(calcParams&&calcResult)});
    if(onChunk)onChunk(text);
  }
  // 生成完成：把溯源档案挂到该小节上（含模型与时间，即L3模型溯源）
  const prov = collector;
  if(prov){
    prov.model = "deepseek-v4-flash";
    prov.generatedAt = new Date().toISOString();
    if(projectWorkflow&&projectWorkflow.currentAnalysisSnapshotId){prov.analysisSnapshotId=projectWorkflow.currentAnalysisSnapshotId;prov.analysisSnapshotVersion=projectWorkflow.currentAnalysisSnapshotVersion||null;}
    prov.confidence = provConfidence(prov);
    prov.reportLogic = logicRules.map(r=>({id:r.id,sourceNo:r.sourceNo,version:(ReportLogicCore.current(rlProjectType())||{}).version||1}));
    s.prov = prov;
  }
  return text;
}

// 报告逐节生成与逐节AI评审属于"批量"负载（一篇报告约40次调用），
// 走独立的 batch 额度，不占用日常AI问答的额度
async function callGen(sys, user, onChunk){
  const resp = await fetch("/api/generate", {
    method:"POST",
    headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
    body: JSON.stringify({ system: sys, messages:[{role:"user", content:user}], stream: !!onChunk, kind:"batch" })
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
