/* ============================================================
   aireport.js —— AI可研生成（对话式）· 第五大功能模块
   定位：用户一句话描述项目 → AI抽取信息 → 从历史案例库推荐~40个测算参数初值 →
   人工只确认7个关键参数 → 复用现有测算引擎+逐章生成逻辑，实时流式写入右侧报告预览 →
   复用现有导出/审查/存档

   设计红线（详见 实施方案.md）：
   - IRR等财务数字永远来自确定性引擎（RentCalc/SaleCalc/NRCalc），AI绝不直接给数字
   - 每个自动填入的参数都标来源与置信度，不做"看不出来路"的填空
   - 测算与生成阶段直接复用 calc.js / report.js 里已经跑通的逻辑，不重写
   ============================================================ */

const AI_TYPE_CN = { rent:"出租类（长期持有经营）", sale:"出售类（配售/出售为主）", gaibao:"非居改保" };
const AI_DOMAIN_OF = { rent:"baozhang_xinjian", sale:"baozhang_xinjian", gaibao:"baozhang_gaibao" };
// 快速开始：不是范例句子，是"选类型"——点了只代表选中这个类型（用彩色标签记进对话里，
// 不冒充用户说过这句话），随后弹出的是空白信息表，要用户自己填真实项目信息，不会拿假数据直接开跑
const AI_CATEGORY_OPTIONS = [
  { key:"rent", label:"出租类（公租房/保租房）" },
  { key:"sale", label:"出售类（配售/出售）" },
  { key:"gaibao", label:"非居改保" },
];

let aiReportChat = [];        // 对话记录 [{role, kind, content, id, ...}]
let aiReportMsgSeq = 0;
let aiReportBusy = false;     // 是否有请求在途，防止重复提交
let aiReportExtracted = null; // 阶段①抽取结果（可编辑，支持多轮口语修正）
let aiReportSuggested = null; // 阶段②推荐结果 {params, sources, keyFields}
let aiReportProgressMsg = null;  // 阶段⑤生成进度卡片的引用（原地更新，不重复插入消息）
let aiReportPendingTasks = null; // 尚未生成的子节任务队列，供"停止/继续生成"复用
let aiReportStopFlag = false;
let aiReportChatLoaded = false;  // 本次页面会话是否已尝试从云端恢复过
let aiReportHasDoc = false;      // 本轮是否已经有可预览的报告内容（生成开始过一次即为true）
let aiReportDocVisible = false;  // 报告预览面板当前是否展开（用户可关/开）
let aiReportPendingCalcChange = null; // AgentCore只生成预演，用户确认后才写入
let aiReportAgentRegistered = false;
let aiReportParamsConfirmed = false; // 只表示本次AI可研会话已通过人工确认；不得复用其他测算模块的全局calcParams

function airCurrentStage(){
  const state={chat:aiReportChat,extracted:aiReportExtracted,suggested:aiReportSuggested,hasDoc:aiReportHasDoc,
    paramsConfirmed:aiReportParamsConfirmed,calcParams:aiReportSuggested&&aiReportParamsConfirmed&&calcParams||null,calcSummary:aiReportSuggested&&aiReportParamsConfirmed&&calcResult&&calcResult.summary||null};
  return window.ProjectWorkflow?ProjectWorkflow.aiReportStage(state):(calcParams&&calcResult?"calculated":aiReportSuggested?"suggested":aiReportExtracted?"info":"empty");
}
function airStageAtLeast(stage){
  const rank=window.ProjectWorkflow?ProjectWorkflow.aiReportStageRank:(s=>({empty:0,info:1,suggested:2,calculated:3,generating:4,paused:4,delivered:5}[s]||0));
  return rank(airCurrentStage())>=rank(stage);
}
function airLocalStateKey(){return "fs_aireport_state_"+(currentProjectId||"unsaved");}
function airSaveLocalState(state){try{localStorage.setItem(airLocalStateKey(),JSON.stringify(state||airSerializableState()));}catch(e){}}
function airLoadLocalState(){try{const raw=localStorage.getItem(airLocalStateKey());return raw?JSON.parse(raw):null;}catch(e){return null;}}
function airClearLocalState(){try{localStorage.removeItem(airLocalStateKey());}catch(e){}}

function airSwitchProjectSession(){
  aiReportStopFlag=true;aiReportChat=[];aiReportExtracted=null;aiReportSuggested=null;aiReportProgressMsg=null;aiReportPendingTasks=null;
  aiReportHasDoc=false;aiReportDocVisible=false;aiReportPendingCalcChange=null;aiReportBusy=false;aiReportChatLoaded=false;aiReportParamsConfirmed=false;
}

function airDocPaneEmptyHtml(){
  return '<div class="air-doc-empty-tip"><span class="ic">📄</span>报告预览会在这里出现——确认参数、开始测算后，AI撰写的每一节都会实时显示在这里，可随时点大纲跳转阅读，也可以点右上角收起。</div>';
}

function renderAiReportModule(){
  return '<div class="air-shell solo">'
    +'<div class="air-chat-pane">'
    +'<div class="air-restart-row"><button type="button" class="btn ghost air-restart-btn" id="airRestartBtn">🔄 重新开始</button></div>'
    +'<div class="doc-eyebrow">AI可研生成 · 对话式</div>'
    +'<h1 class="doc-title">AI可研生成</h1>'
    +'<div class="step-desc">一句话描述项目，AI会自动抽取信息、从历史案例库推荐一整套测算参数初值；'
    +'你只需要确认<b>7个真正影响结论的关键参数</b>，其余系统自动填好。测算数字仍然全部来自确定性引擎，AI不会替你编造IRR。'
    +'开始测算后会弹出报告预览，实时显示AI正在撰写的内容，随时可以收起或展开。</div>'
    +'<div id="airMsgs" style="min-height:80px; margin-top:14px;"></div>'
    +'<div id="airDocToggle" class="air-doc-toggle"></div>'
    +'<div id="airChips"></div>'
    +'<div class="air-composer">'
    +'<textarea id="airInput" class="air-textarea" rows="1" placeholder="描述项目地块、性质、大致情况…（Enter发送，Shift+Enter换行）"></textarea>'
    +'<button class="btn" id="airSend">发送</button></div>'
    +'</div>'
    +'<div class="air-doc-pane empty" id="airDocPane">' + airDocPaneEmptyHtml() + '</div>'
    +'</div>';
}

/* 半路想重来：清掉对话记录、抽取信息、参数推荐、生成进度和右侧预览，回到最初的状态。
   若生成还在跑，先把停止标记打上，避免worker之后还在往一个已经清空的DOM里写东西。
   云端存档也一并清掉，不然下次进来又把这轮已经放弃的内容恢复回来。 */
function airRestartChat(){
  if(aiReportChat.length && !confirm("确定要重新开始吗？当前的对话记录、已确认的参数和测算结果都会清空（如果正在生成报告，会先停止）。已经生成的正文仍保留在「可研生成」模块的草稿里，不会丢。")) return;
  aiReportStopFlag = true;
  aiReportChat = [];
  aiReportExtracted = null;
  aiReportSuggested = null;
  aiReportProgressMsg = null;
  aiReportPendingTasks = null;
  aiReportHasDoc = false;
  aiReportParamsConfirmed = false;
  const pane = document.getElementById("airDocPane");
  if(pane){ pane.className = "air-doc-pane empty"; pane.innerHTML = airDocPaneEmptyHtml(); }
  airSetDocVisible(false);
  airSetBusy(false);
  renderAiReportMsgs();
  airClearLocalState();
  try{ fetch("/api/aireport"+(currentProjectId?"?projectId="+encodeURIComponent(currentProjectId):""), {method:"DELETE", headers: authHeaders()}); }catch(e){ /* 清云端存档失败不影响本地已经重置 */ }
}

function bindAiReportEvents(){
  const s = id=>document.getElementById(id);
  if(s("airRestartBtn")) s("airRestartBtn").onclick = airRestartChat;
  if(s("airSend")) s("airSend").onclick = aiReportSend;
  if(s("airInput")){
    const inp = s("airInput");
    inp.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); aiReportSend(); } });
    inp.addEventListener("input", ()=>airAutosize(inp));
  }
  const docPane = s("airDocPane");
  if(docPane && !docPane.__airBound){
    docPane.__airBound = true;
    // 事件委托绑定在常驻的面板容器上，innerHTML整体刷新也不会失效，不用每次重绑
    docPane.addEventListener("click", e=>{
      const retry = e.target.closest(".air-retry-btn");
      if(retry){ airRetrySection(retry.dataset.cn, +retry.dataset.si); return; }
      const close = e.target.closest(".air-doc-close");
      if(close){ airSetDocVisible(false); return; }
      const chip = e.target.closest(".air-doc-outline .chip");
      if(chip) airScrollToChapter(chip.dataset.cn);
    });
  }
  renderAiReportMsgs();
  airRenderDocToggle();
  airLoadState();
  airRestoreDocPaneIfNeeded();
}

/* 报告预览面板：只在真正开始生成时才弹出来（不然一开始聊天区就被挤窄了），
   之后用户可以随时用右上角"✕"收起、再用聊天区里的小按钮展开——不影响后台继续生成。 */
function airSetDocVisible(v){
  aiReportDocVisible = v;
  const shell = document.querySelector(".air-shell");
  if(shell) shell.classList.toggle("solo", !v);
  airRenderDocToggle();
}
function airRenderDocToggle(){
  const el = document.getElementById("airDocToggle");
  if(!el) return;
  if(aiReportHasDoc && !aiReportDocVisible){
    el.innerHTML = '<button type="button" class="air-doc-reopen" id="airDocReopenBtn">📄 查看报告预览</button>';
    const btn = document.getElementById("airDocReopenBtn");
    if(btn) btn.onclick = ()=>airSetDocVisible(true);
  }else{
    el.innerHTML = "";
  }
}

function airAutosize(el){
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

function airPush(msg){
  if(msg.id==null) msg.id = ++aiReportMsgSeq;
  aiReportChat.push(msg);
  renderAiReportMsgs();
  return msg;
}
function airPushLoading(label){
  return airPush({role:"assistant", kind:"loading", content:label});
}
function airResolve(msg, patch){
  Object.assign(msg, patch);
  renderAiReportMsgs();
}
function airRemoveMsg(msg){
  aiReportChat = aiReportChat.filter(x=>x!==msg);
  renderAiReportMsgs();
}
function airSetBusy(b){
  aiReportBusy = b;
  const btn=document.getElementById("airSend"); if(btn) btn.disabled=b;
  const inp=document.getElementById("airInput"); if(inp) inp.disabled=b;
}

/* ================= 阶段① 采集：一句话 → 抽取信息卡片；再说一句 → 当作修正合并进已有信息 ================= */
async function aiReportSend(){
  if(aiReportBusy) return;
  const inp = document.getElementById("airInput");
  const text = (inp.value||"").trim();
  if(!text) return;
  if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);}
  inp.value = ""; airAutosize(inp);
  airPush({role:"user", kind:"text", content:text});
  const direct=window.ProjectWorkflow&&ProjectWorkflow.aiReportDirectAction(text);
  if(aiReportHasDoc&&direct==="review"){
    airPush({role:"assistant",kind:"text",content:"好的，正在带你进入「复核与签发」。你可以在那里查看待同步、人工锁定、AI修改差异以及报告版本。"});
    airSaveState();setTimeout(()=>airDeliverAction("review"),180);return;
  }
  airSetBusy(true);
  if(aiReportHasDoc || (calcParams&&calcResult)) await airRunAgent(text);
  else await airRunExtract(text);
  airSetBusy(false);
}

async function airRunExtract(text){
  const isCorrection = !!aiReportExtracted;
  const loading = airPushLoading(isCorrection? "正在理解你的补充/修正…" : "正在理解项目信息…");
  try{
    const r = await fetch("/api/aireport", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"extract", text, previous: aiReportExtracted||undefined})});
    const d = await r.json();
    if(!d.ok){
      airResolve(loading, {kind:"text", content:"没能理解这段描述："+(d.error||"未知错误")+"\n可以换个说法，或直接说明：地块所在区域/街道、做出租还是出售/改造、大概哪年开工。",
        retry:{type:"extract", text}});
      return;
    }
    if(isCorrection){
      // 只用AI这次明确给出的非空字段覆盖，其余保留原值——不会因为这句话没提到某字段就把它清空
      Object.keys(d.data).forEach(k=>{
        if(k==="missing") return;
        if(d.data[k]!=null && d.data[k]!=="") aiReportExtracted[k]=d.data[k];
      });
      aiReportExtracted.__manual = false;   // AI已经帮着填过了，信息卡不再是"从零手填"的框架
      airResolve(loading, {kind:"text", content:"已根据你的补充更新了上面的信息卡。"});
    }else{
      aiReportExtracted = Object.assign({ projectName:"", location:"", calcType:null, landArea:null, landPrice:null, startYear:null, owner:"", landNature:"", desc:text }, d.data);
      if(!aiReportExtracted.projectName) aiReportExtracted.projectName = (aiReportExtracted.location||"") + "项目";
      airResolve(loading, {kind:"infoCard"});
    }
    project.name=aiReportExtracted.projectName||project.name||"AI可研未命名项目";project.location=aiReportExtracted.location||project.location||"";
    saveDraft();airSaveState();
  }catch(e){
    airResolve(loading, {kind:"text", content:"网络异常，信息抽取失败："+e.message, retry:{type:"extract", text}});
  }
}

function airInfoCardHtml(){
  const v = aiReportExtracted || {};
  if(airStageAtLeast("suggested")) return '<div class="air-card air-step-done"><b>✓ 项目信息已确认</b><span>'+escapeHtml(v.projectName||"未命名项目")+'｜'+escapeHtml(v.location||"")+'｜'+escapeHtml(AI_TYPE_CN[v.calcType]||"")+'</span></div>';
  const opt = (val,label)=>'<option value="'+val+'" '+(v.calcType===val?"selected":"")+'>'+label+'</option>';
  const introText = v.__manual
    ? "请填写项目核心信息（都是真实信息，不是AI猜的）："
    : "AI已抽取以下信息，请核对/补充后继续（拿不准的字段AI没有瞎猜，需要你手动填）：";
  const btnLabel = v.__manual ? "信息填写完毕，生成参数建议 →" : "信息确认无误，生成参数建议 →";
  const hint = v.__manual ? "" : '<span style="font-size:11px; color:var(--ink-faint,#8A97A8);">信息不对？直接在下方输入框说一句就行，比如"不对，是2026年开工"</span>';
  return '<div class="air-card">'
    +'<div style="font-size:12.5px; color:var(--ink-soft); margin-bottom:8px;">'+introText+'</div>'
    +'<div class="grid2">'
    +'<div><label>项目名称</label><input id="air_name" type="text" value="'+escapeHtml(v.projectName||"")+'"></div>'
    +'<div><label>建设地点（区/街道）</label><input id="air_loc" type="text" value="'+escapeHtml(v.location||"")+'"></div>'
    +'</div><div class="grid2">'
    +'<div><label>测算类型</label><select id="air_ctype"><option value="">请选择…</option>'
      + opt("rent","出租类（公租房/保租房）") + opt("sale","出售类（配售/出售）") + opt("gaibao","非居改保") + '</select></div>'
    +'<div><label>建设/委托单位（选填）</label><input id="air_owner" type="text" value="'+escapeHtml(v.owner||"")+'"></div>'
    +'</div><div class="grid2">'
    +'<div><label>用地面积（㎡，选填）</label><input id="air_landarea" type="number" value="'+(v.landArea!=null?v.landArea:"")+'"></div>'
    +'<div><label>开工/建设起始年（选填）</label><input id="air_startyear" type="number" value="'+(v.startYear!=null?v.startYear:"")+'"></div>'
    +'</div><div class="grid2">'
    +'<div><label>土地性质（选填，如：出让/划拨、居住用地等）</label><input id="air_landnature" type="text" value="'+escapeHtml(v.landNature||"")+'"></div>'
    +'<div></div>'
    +'</div>'
    +'<div style="margin-top:8px;"><label>项目概况</label><textarea id="air_desc" style="min-height:56px;" placeholder="简单描述一下项目情况（选填）">'+escapeHtml(v.desc||"")+'</textarea></div>'
    +'<div style="margin-top:10px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">'
    +'<button class="btn" id="airConfirmInfo">'+btnLabel+'</button>'
    + hint
    +'</div></div>';
}

async function aiReportConfirmInfo(){
  if(aiReportBusy) return;
  const g = id=>document.getElementById(id);
  const calcType = g("air_ctype").value;
  if(!calcType){ alert("请先选择测算类型（出租类/出售类/非居改保）"); return; }
  const name = g("air_name").value.trim();
  const loc = g("air_loc").value.trim();
  if(!name || !loc){ alert("请至少填写项目名称和建设地点"); return; }
  aiReportExtracted = Object.assign({}, aiReportExtracted, {
    projectName: name,
    location: loc,
    calcType,
    owner: g("air_owner").value.trim(),
    landArea: g("air_landarea").value? parseFloat(g("air_landarea").value): null,
    startYear: g("air_startyear").value? parseInt(g("air_startyear").value): null,
    landNature: g("air_landnature").value.trim(),
    desc: g("air_desc").value,
    __manual: false,   // 已经走到确认这一步，后续走"多轮修正"逻辑时不用再当成空白表单处理
  });
  airSetBusy(true);
  await airRunSurvey();
  await airRunSuggest();
  airSetBusy(false);
}

/* 信息一确认，先自动跑一遍高德周边配套+竞品调研，不用像标准向导那样手动点"搜索位置"再
   从候选里挑一个——这里直接取相关度最高的第一个候选。复用的还是 poi.js 里那三个接口
   （/api/poi 的 search / 周边 / competitors），查到的 project.poiDesc / project.competitors
   跟标准向导写的是同一份字段，会被 surveyBrief() 自动带进后续生成的每一节里，不用额外接线。
   查不到、没配AMAP_KEY、接口挂了——都只是跳过，不能卡住后面的参数推荐和测算。 */
async function airRunSurvey(){
  const ex = aiReportExtracted;
  const kw = ((ex.location||"") + (ex.projectName||"")).trim();
  if(!kw) return;
  const loading = airPushLoading("正在检索项目周边配套与竞品（高德地图）…");
  try{
    const sr = await fetch("/api/poi", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"search", address: kw})});
    const sd = await sr.json();
    if(!sd.ok || !(sd.candidates||[]).length){
      airResolve(loading, {kind:"text", content:"没能在地图上自动定位到「"+(ex.projectName||kw)+"」，跳过周边检索，不影响后续测算（常见于地块尚未建成、地图上还查不到的新项目）。"});
      return;
    }
    const best = sd.candidates[0];
    project.poiLoc = best.location; project.poiLocLabel = best.name; project.poiKw = kw;

    const [poiRes, cpRes] = await Promise.all([
      fetch("/api/poi", {method:"POST", headers:Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body: JSON.stringify({location: best.location})}).then(r=>r.json()).catch(()=>({ok:false})),
      fetch("/api/poi", {method:"POST", headers:Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body: JSON.stringify({action:"competitors", location: best.location})}).then(r=>r.json()).catch(()=>({ok:false})),
    ]);

    const poiLines = [];
    if(poiRes.ok){
      Object.entries(poiRes.pois||{}).forEach(([lab, items])=>{
        if(items && items.length) poiLines.push(lab+"："+items.map(p=>p.name+(p.dist!=null?"（约"+p.dist+"km）":"")).join("、"));
      });
    }
    if(poiLines.length) project.poiDesc = poiLines.join("\n");

    let cpText = "";
    if(cpRes.ok && (cpRes.competitors||[]).length){
      project.competitors = cpRes.competitors.map(c=>({ name:c.name, dist:c.dist!=null?String(c.dist):"", rent:"", occ:"",
        note:"（地图抓取，租金/出租率须人工调研）" }));
      cpText = cpRes.competitors.slice(0,6).map(c=>c.name+(c.dist!=null?"（约"+c.dist+"km）":"")).join("、");
    }
    saveDraft();

    const msg = "📍 已按「"+best.name+"」自动检索周边情况（高德地图）：\n"
      + (poiLines.length? poiLines.join("\n") : "3公里内未检索到明显配套。") + "\n"
      + (cpText? "周边竞品公寓：" + cpText + "（名称/距离为地图实测，租金与出租率暂无公开数据，报告里会标注待人工调研）"
                : "3公里内未检索到同类竞品公寓。");
    airResolve(loading, {kind:"text", content: msg});

    await airRunDemandSurvey(ex, best);
  }catch(e){
    airResolve(loading, {kind:"text", content:"周边检索出了点问题（"+e.message+"），已跳过，不影响后续测算。", retry:{type:"survey"}});
  }
}

/* 人口 + 职住平衡：跟周边配套分开发一条消息，因为这两样的"能查到多少"差异很大——
   职住平衡用的是同一个高德接口，基本总能出个参考数；人口是自建参考表，很可能查无此地，
   混在一条消息里会让"查到的"和"没查到的"分不清楚。 */
async function airRunDemandSurvey(ex, best){
  try{
    const [popRes, balData] = await Promise.all([
      fetch("/api/population?lookup=1&location="+encodeURIComponent(ex.location||""), {headers: authHeaders()}).then(r=>r.json()).catch(()=>({ok:false})),
      fetch("/api/poi", {method:"POST", headers:Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body: JSON.stringify({action:"balance", location: best.location})}).then(r=>r.json()).catch(()=>({ok:false})),
    ]);

    const lines = [];
    if(popRes.ok && popRes.item){
      const it = popRes.item;
      const label = (it.street? it.city+it.district+it.street : it.city+it.district);
      project.populationText = label+"常住人口约"+it.population+"万人（"+it.year+"年，来源："+(it.source||"人工整理")+"）";
      lines.push("👥 人口参考："+project.populationText);
    }else{
      lines.push("👥 人口参考：本地未收录「"+(ex.location||"")+"」的人口数据，需求分析章节会标注「待人工核实统计部门最新数据」，不会编造人口数字。");
    }

    if(balData.ok && (balData.resiCount+balData.jobCount)>0){
      const total = balData.resiCount + balData.jobCount;
      const jobRatio = Math.round(balData.jobCount/total*100);
      project.balanceText = "3公里内住宅小区类POI "+balData.resiCount+"个，企业/写字楼/产业园类POI "+balData.jobCount+"个，岗位类POI占比约"+jobRatio+"%";
      lines.push("🏢 职住平衡参考（POI密度，非官方职住比）："+project.balanceText+"。");
    }

    if(lines.length) airPush({role:"assistant", kind:"text", content: lines.join("\n")});
    saveDraft();
  }catch(e){ /* 这一步失败不影响已经跑完的周边检索和后续参数推荐 */ }
}

/* ================= 阶段② 推参：纯数据查询，不调用AI ================= */
async function airRunSuggest(){
  const calcType = aiReportExtracted.calcType;
  const loading = airPushLoading("正在从历史项目案例库匹配参数…");
  try{
    const r = await fetch("/api/aireport", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"suggest", calcType, location: aiReportExtracted.location,
        explicitParams: aiReportExtracted.landArea!=null ? {landArea:aiReportExtracted.landArea} : {}})});
    const d = await r.json();
    if(!d.ok){
      airResolve(loading, {kind:"text", content:"参数推荐失败："+(d.error||"未知错误"), retry:{type:"suggest"}});
      return;
    }
    aiReportSuggested = { calcType, params:d.params, sources:d.sources, keyFields:d.keyFields, paramMeta:d.paramMeta||{}, sourceHierarchy:d.sourceHierarchy||[] };
    aiReportParamsConfirmed = false;
    const caseNote = d.caseCount? ("案例库中共有 "+d.caseCount+" 个「"+AI_TYPE_CN[calcType]+"」历史案例，其中 "+d.regionCaseCount+" 个与本项目同区域。")
      : "案例库中暂无「"+AI_TYPE_CN[calcType]+"」的已确认历史案例，以下参数为行业默认值，请务必人工核实。";
    airResolve(loading, {kind:"text", content:"已自动填好全套测算参数（约"+Object.keys(d.params).length+"项）。"+caseNote+" 下面这7项对结果影响最大，请重点确认（点「查看依据」能看到具体是哪几个历史项目）："});
    airPush({role:"assistant", kind:"confirmCard"});
    airSaveState();
  }catch(e){
    airResolve(loading, {kind:"text", content:"网络异常，参数推荐失败：" + e.message, retry:{type:"suggest"}});
  }
}

function airConfirmCardHtml(){
  const sug = aiReportSuggested;
  if(!sug) return "";
  const alreadyCalculated=airStageAtLeast("calculated");
  const confCls = c => c==="高"?"air-conf-hi":c==="中"?"air-conf-mid":"air-conf-lo";
  const rows = sug.keyFields.map(f=>{
    const src = sug.sources[f.key] || {};
    const shownParams=alreadyCalculated&&calcParams?calcParams:sug.params;
    const val = (shownParams[f.key]!=null? shownParams[f.key] : "");
    const disp = f.pct ? (val!==""? Math.round(val*100): "") : val;
    const evid = (src.evidence||[]).length
      ? '<details class="air-kf-evidence"><summary>查看依据</summary><div class="air-kf-evidence-body">'
        + src.evidence.map(e=>{const head=escapeHtml(e.label||e.name||"依据");if(e.value!==undefined)return head+'：'+(f.pct?Math.round(e.value*100)+'%':e.value);return head+escapeHtml([e.version,e.sourceRef].filter(Boolean).length?'｜'+[e.version,e.sourceRef].filter(Boolean).join('｜'):'');}).join('<br>')
        + '</div></details>'
      : '';
    return '<div class="air-kf-row">'
      +'<div><div class="air-kf-label">'+f.label+'</div><div class="air-kf-src">'+escapeHtml(src.from||"")+'</div>'+evid+'</div>'
      +'<input class="air-kf" data-key="'+f.key+'" data-pct="'+(f.pct?1:0)+'" type="number" step="any" value="'+disp+'" '+(alreadyCalculated?'disabled ':'')
        +(f.pct?' title="百分比，如90表示90%"':'')+'>'
      +'<span class="air-conf '+confCls(src.confidence||"低")+'">'+(src.confidence||"低")+'</span>'
      +(src.requiresManualConfirmation?(alreadyCalculated?'<span style="font-size:11px;color:var(--ok-green);">✓ 已人工确认</span>':'<label style="font-size:11px;white-space:nowrap;"><input class="air-kf-confirm" data-key="'+f.key+'" type="checkbox"> 人工确认</label>'):'<span style="font-size:11px;color:var(--ok-green);">资料已给定</span>')
      +'</div>';
  }).join("");
  const keySet = new Set(sug.keyFields.map(f=>f.key));
  const otherKeys = Object.keys(sug.params).filter(k=>!keySet.has(k));
  const otherManual = otherKeys.filter(k=>(sug.sources[k]||{}).requiresManualConfirmation);
  const sourceCounts = {};
  Object.values(sug.sources||{}).forEach(src=>{ const k=src.sourceCode||"unknown"; sourceCounts[k]=(sourceCounts[k]||0)+1; });
  const sourceNames={project_excel:"项目Excel",project_document:"项目正式资料",binding_rule:"适用硬规则",regional_case:"同区域案例",general_case:"其他案例",industry_fallback:"行业兜底",expert_default:"专家默认"};
  const sourceSummary=Object.entries(sourceCounts).map(([k,n])=>(sourceNames[k]||k)+" "+n+"项").join("｜");
  const otherDetails=otherKeys.length?'<details style="margin-top:10px;"><summary style="font-size:12px;cursor:pointer;">查看其余 '+otherKeys.length+' 项参数来源</summary><div style="max-height:220px;overflow:auto;margin-top:7px;">'
    +otherKeys.map(k=>{const s=sug.sources[k]||{},m=(sug.paramMeta&&sug.paramMeta[k])||{};return '<div style="display:grid;grid-template-columns:170px 1fr auto;gap:8px;padding:5px 0;border-bottom:1px dashed var(--line);font-size:11px;"><span><b>'+escapeHtml(m.label||k)+'</b><br><code>'+escapeHtml(k)+'</code></span><span>'+escapeHtml(s.from||"")+'</span><span>'+(s.requiresManualConfirmation?'待批量确认':'资料已给定')+'</span></div>';}).join("")+'</div></details>':'';
  return '<div class="air-card">'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">来源层级：'+escapeHtml((sug.sourceHierarchy||[]).join(" → "))+'</div>'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">本次全量来源：'+escapeHtml(sourceSummary)+'</div>'
    +(alreadyCalculated?'<div class="air-step-done"><b>✓ 参数已经人工确认，财务测算已完成</b><span>当前参数只读展示；如需调整，可在下方对话中直接说明要修改的参数和值，系统会先预演影响。</span></div>':'<div class="air-bulk-confirm"><div><b>已逐项核对数值和依据？</b><span>可一次勾选本卡片全部待人工确认项；不会自动开始测算。</span></div><button type="button" class="btn" id="airConfirmAll">批量人工确认全部</button><span id="airConfirmAllState"></span></div>')
    + rows
    + otherDetails
    +(!alreadyCalculated&&otherManual.length?'<label style="display:block;margin-top:10px;font-size:11.5px;"><input class="air-kf-confirm" data-key="__other_batch" type="checkbox"> 已批量核对其余 '+otherManual.length+' 项案例/兜底/默认参数（低影响项后续还会做联合扰动验证）</label>':'')
    +'<div style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'
    +(alreadyCalculated?'<span class="air-complete-pill">测算步骤已完成</span>':'<button class="btn" id="airConfirmParams">确认，开始测算 →</button>')
    +'<span style="font-size:11.5px; color:var(--ink-soft);">其余约'+(Object.keys(sug.params).length-sug.keyFields.length)+'项参数已按上方来源自动填好，不在此重复列出</span>'
    +'</div></div>';
}

/* ================= 阶段③④ 确认→测算：读7个字段，合并成完整参数，跑确定性引擎 ================= */
function airIrrTakeaway(irr){
  if(irr==null) return "现金流全周期内没有出现正负切换，IRR无法计算，建议先检查投资与收入是否匹配。";
  if(irr < 0) return "IRR为负，说明项目自身经营现金流不足以覆盖投资成本，通常需要财政补贴或土地政策支持才能落地，建议重点核查租金/售价与融资成本这两个参数。";
  if(irr < 3) return "IRR低于保障房项目常见的资金成本基准（约3%~4%），财务自平衡能力偏弱，建议关注出租率/去化速度与运营成本假设。";
  if(irr < 6) return "IRR处于保障房项目的常见区间，财务基本可平衡，仍建议结合敏感性分析复核关键参数。";
  return "IRR高于保障房项目的常见水平，建议核实参数是否偏乐观（尤其是租金/售价与出租率假设）。";
}

async function aiReportConfirmParams(){
  if(aiReportBusy || !aiReportSuggested) return;
  const sug = aiReportSuggested;
  const pending=[...document.querySelectorAll(".air-kf-confirm:not(:checked)")];
  if(pending.length){ alert("还有 "+pending.length+" 个案例/兜底来源参数未勾选人工确认。请核对依据和值后再继续。"); return; }
  const edited = {};
  document.querySelectorAll(".air-kf").forEach(inp=>{
    const key = inp.dataset.key;
    let v = parseFloat(inp.value);
    if(!isFinite(v)) return;
    if(inp.dataset.pct==="1") v = v/100;
    edited[key] = v;
  });
    const finalParams = Object.assign({}, sug.params, edited);
  const ex = aiReportExtracted || {};
  if(ex.startYear) finalParams.buildStart = ex.startYear;

  airSetBusy(true);
  try{
    calcType = sug.calcType;   // calc.js 的全局测算类型
    calcParams = finalParams;
    // 人工确认后的值就是本项目正式参数。同步回推荐对象，保证刷新后的只读卡、测算快照和引擎口径一致。
    sug.params = Object.assign({}, finalParams);
    calcResult = runCalcEngine(calcType, calcParams);
    calcResult.__ctype = calcType;
    if(calcType === "gaibao"){
      try{ calcResult.sens = computeSensitivity(calcParams); }catch(e){}
      try{ calcResult.modeCompare = computeModeCompare(calcParams); }catch(e){}
    }
    scParams = calcParams; scResult = calcResult;   // 供导出/审查等共享部件读取
    aiReportParamsConfirmed = true;
    if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);}
    if(window.ProjectWorkflow)window.ProjectWorkflow.createCalcSnapshot(projectWorkflow,calcType,calcParams,calcResult,{reason:"AI可研参数人工确认",confirmedBy:typeof getUser==="function"?getUser():""});
    saveDraft();
    const s = calcResult.summary;
    const fmt = x=> (x==null? "—": Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2}));
    airPush({role:"assistant", kind:"text", content:"✅ 财务测算完成：全投资IRR "+(s.irr==null?"无法计算":s.irr+"%")+"，全周期总收入 "+fmt(s.totalIncome)+" 万元，净利润合计 "+fmt(s.totalNetProfit)+" 万元，累计净现值 "+fmt(s.totalNpv)+" 万元。\n数字均由确定性引擎计算得出，可在导出的Excel/测算说明书中复核。\n"+airIrrTakeaway(s.irr)});
    // 测算和"起草报告"是两件事——测算完先停在这里，让人看一眼数字对不对，
    // 确认要继续了再点下面这个按钮去跑40次AI调用，不要测算一完事就自动开始写报告
    airPush({role:"assistant", kind:"genConfirm"});
    airSaveState();
  }catch(e){
    airPush({role:"assistant", kind:"text", content:"测算失败："+e.message+"。可以返回上面调整参数后重新点击「确认，开始测算」。"});
  }
  airSetBusy(false);
}

function airSyncConfirmButtonState(){
  const btn=document.getElementById("airConfirmParams");if(!btn)return;
  const pending=document.querySelectorAll(".air-kf-confirm:not(:checked)").length;
  btn.disabled=pending>0;btn.title=pending?"请先完成人工确认（尚有 "+pending+" 项）":"全部参数已确认，可以开始测算";
}

async function aiReportStartGenerate(){
  if(aiReportBusy) return;
  if(!aiReportParamsConfirmed || !calcResult){ alert("请先完成人工确认并成功生成财务测算，再开始可研生成。"); return; }
  airSetBusy(true);
  try{ await aiReportRunGenerate(); }
  catch(e){ airPush({role:"assistant",kind:"text",content:"可研生成未能启动："+e.message+"。按钮已恢复，可检查参数或稍后重试。"}); }
  finally{ airSetBusy(false); }
}

/* ================= 阶段⑤ 生成：复用 report.js 的 generateSection()（接上流式），实时写入右侧预览面板 ================= */
async function aiReportRunGenerate(){
  const ex = aiReportExtracted || {};
  const sug = aiReportSuggested;
  const domainKey_ = AI_DOMAIN_OF[sug.calcType];
  await fetchOutlines();
  loadDomain(domainKey_);
  rptCtype = sug.calcType === "sale" ? "sale" : "rent";

  const today = new Date().toLocaleDateString("zh-CN");
  const who = (typeof getUser==="function" && getUser()) || "当前用户";
  Object.assign(project, {
    name: ex.projectName || "未命名项目",
    owner: ex.owner || "",
    location: ex.location || "",
    type: AI_TYPE_CN[sug.calcType] || "",
    scale: calcParams && (calcParams.totalInvestment || calcParams.invest || calcParams.loan) || "",
    desc: (ex.desc||"") + "\n\n【参数说明】本报告关键测算参数由系统依据历史项目类比自动推荐并计算，经"+who+"于"+today+"确认；如需复核请以导出的《测算说明书》与Excel为准。",
  });
  appMode = "report";
  saveDraft();

  airBuildDocPane();

  const active = chapters.filter(c=>c.checked);
  const tasks = [];
  active.forEach(c=>c.sections.forEach((s,si)=>tasks.push({c,s,si})));
  aiReportPendingTasks = tasks;
  aiReportStopFlag = false;
  aiReportProgressMsg = { role:"assistant", kind:"genProgress", total:tasks.length, done:0, failed:0, active:true };
  airPush(aiReportProgressMsg);

  await airRunGenTasks();
}

async function airRunGenTasks(){
  const tasks = aiReportPendingTasks || [];
  const p = aiReportProgressMsg;
  await runWorkerPool(tasks, async (t)=>{
    await airGenOneSection(t);
    p.done++;
    renderAiReportMsgs();
  }, 3, ()=>!aiReportStopFlag);
  saveDraft();

  if(aiReportStopFlag && tasks.length){
    p.active = false; p.stopped = true;
    renderAiReportMsgs();
    return;
  }
  p.active = false; p.stopped = false;
  renderAiReportMsgs();
  airPush({role:"assistant", kind:"text", content:"🎉 可研报告已经生成啦！已完成 "+(p.total-p.failed)+"/"+p.total+" 个子标题的初稿起草"+(p.failed? "（"+p.failed+" 个失败，可在右侧预览里逐节点「重试」）。":"。")+"\n\n接下来你可以继续和我对话修改测算或报告，也可以点击下方「复核与人工审查」，或者直接给我发送“复核”，我会带你进入复核与签发。"});
  airPush({role:"assistant", kind:"deliver"});
  if(window.ProjectWorkflow)window.ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:"AI可研初稿生成完成"});
  saveDraft();
  airSaveState();
}

/* 首次生成(airGenOneSection)和失败重试(airRetrySection)驱动的是同一套"跑generateSection+刷新该节DOM"
   流程，唯一区别是：重试要先清空上一次的失败提示、失败文案不同、成功/失败后的计数联动不同。
   共用这一个核心，两处调用只传各自需要的差异部分，不必维护两份近乎相同的DOM操作代码。 */
async function airDriveSectionGen(chapter, section, si, opts){
  opts = opts || {};
  const cn = chapter.cn;
  const secId = 'sec_'+cn+'_'+si;
  const secEl = document.getElementById(secId);
  if(secEl){
    if(opts.clearFirst) secEl.querySelector(".body").innerHTML = "";
    secEl.dataset.status = "gen";
    secEl.classList.add("gen");
  }
  airUpdateChapterChipStatus(cn);
  try{
    const text = await generateSection(chapter, section, (partial)=>{
      const el = document.getElementById(secId);
      if(el) el.querySelector(".body").textContent = partial;
    });
    section.content = text;
    if(secEl){
      secEl.dataset.status = "done";
      secEl.classList.remove("pending"); secEl.classList.remove("gen");
      secEl.querySelector(".body").innerHTML = renderContent(text);
      secEl.querySelector("h4").insertAdjacentHTML("beforeend", '<span class="done-stamp">已拟</span>');
    }
    if(opts.onDone) opts.onDone();
  }catch(e){
    if(secEl){
      secEl.dataset.status = "failed";
      secEl.classList.remove("gen");
      secEl.querySelector(".body").innerHTML = '<span style="color:var(--seal-red);">'+(opts.failLabel||"生成失败")+'：'+escapeHtml(e.message)+'</span> '
        +'<button class="air-retry-btn" data-cn="'+cn+'" data-si="'+si+'">重试</button>';
    }
    if(opts.onFail) opts.onFail();
  }
  airUpdateChapterChipStatus(cn);
}

async function airGenOneSection(t){
  await airDriveSectionGen(t.c, t.s, t.si, {
    onFail: ()=>{ aiReportProgressMsg.failed++; },
  });
}

async function airRetrySection(cn, si){
  const info = findChapterSection(cn, si);
  if(!info) return;
  await airDriveSectionGen(info.chapter, info.section, si, {
    clearFirst: true,
    failLabel: "仍然失败",
    onDone: ()=>{
      if(aiReportProgressMsg && aiReportProgressMsg.failed>0){ aiReportProgressMsg.failed--; renderAiReportMsgs(); }
      saveDraft();
    },
  });
}

/* ================= 右侧报告预览面板 ================= */
function airBuildDocPane(){
  const pane = document.getElementById("airDocPane");
  if(!pane) return;
  pane.classList.remove("empty");
  const active = chapters.filter(c=>c.checked);
  const totalSec = active.reduce((n,c)=>n+c.sections.length,0);
  const outline = active.map(c=>'<span class="chip" data-cn="'+c.cn+'">'+c.cn+'·'+c.name+'</span>').join("");
  const body = active.map(c=>'<div class="chapter-block" id="block_'+c.cn+'"><h3><span class="cn">'+c.cn+'</span>'+c.name+'</h3>'
    + c.sections.map((s,si)=>'<div class="section-block pending" id="sec_'+c.cn+'_'+si+'" data-status="pending"><h4>'+s.t+(s.numeric?' ⚠数据':'')+'</h4>'
      +'<div class="body"><span class="skel" style="width:94%"></span><span class="skel" style="width:99%"></span><span class="skel" style="width:70%"></span></div></div>').join("")
    +'</div>').join("");
  pane.innerHTML = '<div class="air-doc-head"><button type="button" class="air-doc-close" title="收起预览">✕</button>'
    +'<div class="air-doc-title">'+escapeHtml(project.name||"未命名项目")+'</div>'
    +'<div class="air-doc-meta">'+escapeHtml(project.industry||"")+' · 共 '+active.length+' 章 / '+totalSec+' 个子标题</div></div>'
    +'<div class="air-doc-outline">'+outline+'</div>'
    +'<div class="air-doc-scroll" id="airDocScroll">'+body+'</div>';
  aiReportHasDoc = true;
  airSetDocVisible(true);
}
function airUpdateChapterChipStatus(cn){
  const chip = document.querySelector('.air-doc-outline .chip[data-cn="'+cn+'"]');
  if(!chip) return;
  const blocks = document.querySelectorAll('#block_'+cn+' .section-block');
  let done=0, failed=0, gen=0;
  blocks.forEach(b=>{ const st=b.dataset.status; if(st==="done") done++; else if(st==="failed") failed++; else if(st==="gen") gen++; });
  chip.classList.remove("state-gen","state-done","state-failed");
  if(failed>0 && done+failed===blocks.length) chip.classList.add("state-failed");
  else if(done===blocks.length && blocks.length) chip.classList.add("state-done");
  else if(gen>0 || done>0) chip.classList.add("state-gen");
}
function airScrollToChapter(cn){
  const el = document.getElementById("block_"+cn);
  if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
}
// 从首页/其它模块切回本模块时，如果本轮已经生成过内容（chapters里有正文），把预览面板重建为"已完成"态
function airRestoreDocPaneIfNeeded(){
  if(!aiReportSuggested || !chapters.length) return;
  const hasContent = chapters.some(c=>c.sections.some(s=>s.content));
  if(!hasContent) return;
  airBuildDocPane();
  chapters.filter(c=>c.checked).forEach(c=>{
    c.sections.forEach((s,si)=>{
      const el = document.getElementById('sec_'+c.cn+'_'+si);
      if(!el || !s.content) return;
      el.dataset.status = "done";
      el.classList.remove("pending");
      el.querySelector(".body").innerHTML = renderContent(s.content);
      el.querySelector("h4").insertAdjacentHTML("beforeend", '<span class="done-stamp">已拟</span>');
    });
    airUpdateChapterChipStatus(c.cn);
  });
}

function airProgressCardHtml(m){
  const pct = m.total? Math.round(m.done/m.total*100) : 0;
  let actions = "";
  if(m.active) actions = '<button class="btn ghost air-progress-btn air-stop-btn">⏸ 停止生成</button>';
  else if(m.stopped) actions = '<button class="btn air-progress-btn air-resume-btn">▶ 继续生成剩余 '+(m.total-m.done)+' 节</button>';
  const label = m.active? "⏳ 正在起草，可在右侧实时查看…" : (m.stopped? "⏸ 已暂停" : "✅ 本轮生成已完成");
  return '<div class="air-progress-card"><div style="flex:1; min-width:180px;">'
    +'<div class="air-progress-text">'+label+'　已完成 '+m.done+'/'+m.total+(m.failed?'（失败 '+m.failed+'）':'')+'</div>'
    +'<div class="air-progress-bar"><div class="air-progress-bar-fill" style="width:'+pct+'%;"></div></div>'
    +'</div><div class="air-progress-actions">'+actions+'</div></div>';
}

/* 测算和起草报告是两步：这张卡片是测算和生成之间的停顿点，人工确认数字没问题了再往下点。 */
function airGenConfirmHtml(){
  if(airStageAtLeast("generating")) return '<div class="air-card air-step-done"><b>✓ 已进入可研生成阶段</b><span>请查看当前生成进度或右侧报告预览，无需再次启动。</span></div>';
  return '<div class="air-card"><button class="btn" id="airStartGen">确认，开始可研生成 →</button>'
    +'<div style="margin-top:8px; font-size:11.5px; color:var(--ink-soft);">测算结果已经在上面，确认无误后再点这里——会逐章撰写报告正文（约40次AI调用，需要一点时间，可随时停止）。</div></div>';
}

/* ================= 阶段⑥ 交付：全部复用现成的导出/审查/存档逻辑 ================= */
function airDeliverHtml(){
  return '<div class="air-card air-deliver-card">'
    +'<div class="air-deliver-guide"><div class="air-deliver-title">下一步想做什么？</div>'
    +'<div class="air-deliver-copy">你可以先复核签发，也可以继续在下方和我对话。我能预演参数变化、判断受影响章节，或者生成某一小节的候选修改稿；正式内容不会未经确认就被覆盖。</div>'
    +'<div class="air-deliver-prompts"><button type="button" class="air-prompt" data-prompt="把租金调整为42元，看看影响">把租金调整为42元，看看影响</button>'
    +'<button type="button" class="air-prompt" data-prompt="你觉得这个项目整体怎么样？请做一次综合诊断">评价这个项目</button>'
    +'<button type="button" class="air-prompt" data-prompt="这个项目还有哪些地方可以提升？请按优先级给建议">寻找提升点</button>'
    +'<button type="button" class="air-prompt" data-prompt="哪些章节会受当前参数影响？">查看参数影响章节</button>'
    +'<button type="button" class="air-prompt" data-prompt="帮我修改项目建设必要性这一节，先给候选稿">修改某一章节文字</button></div></div>'
    +'<div class="air-deliver-actions">'
    +'<button class="btn ghost air-act air-act-btn" data-act="exportWord">📄 导出可研报告（Word）</button>'
    +'<button class="btn ghost air-act air-act-btn" data-act="exportExcel">📊 导出测算表（Excel）</button>'
    +'<button class="btn ghost air-act air-act-btn" data-act="exportCalcWord">📋 导出测算说明书（Word）</button>'
    +'<button class="btn air-act air-act-btn air-review-primary" data-act="review">🔍 进入复核与签发 →</button>'
    +'<button class="btn ghost air-act air-act-btn" data-act="saveCase">📁 存入历史项目案例库</button>'
    +'</div><div class="air-deliver-tip">也可以直接在对话框发送“复核”，我会自动带你进入。</div></div>';
}
async function airDeliverAction(act){
  if(act==="exportWord") return exportWord();
  if(act==="exportExcel") return exportCalcExcel();
  if(act==="exportCalcWord") return exportCalcWord();
  if(act==="review"){ appMode="report"; currentStep=5; renderTOC(); renderSheet(); return; }
  if(act==="saveCase"){
    try{
      const r = await fetch("/api/calccases", {method:"POST",
        headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body: JSON.stringify({ name: project.name, location: project.location, calc_type: calcType,
          params: calcParams, summary: (calcResult&&calcResult.summary)||{} })});
      const d = await r.json();
      alert(d.ok? (d.message||"已提交，等待管理员确认") : (d.error||"提交失败"));
    }catch(e){ alert("网络错误，存入案例库失败"); }
  }
}

/* ================= 消息渲染 ================= */
function airRenderChips(){
  const el = document.getElementById("airChips");
  if(!el) return;
  if(aiReportChat.length){ el.innerHTML = ""; return; }
  el.innerHTML = '<div class="air-chips"><div class="air-chips-label">或者直接选测算类型，自己手动填项目信息：</div>'
    + AI_CATEGORY_OPTIONS.map(c=>'<button type="button" class="air-chip-ex air-chip-'+c.key+'" data-type="'+c.key+'">'+c.label+'</button>').join("")
    + '</div>';
  el.querySelectorAll(".air-chip-ex").forEach(b=>{
    b.onclick = ()=>airPickCategory(b.dataset.type);
  });
}

/* 点类型标签：只记一条"已选择类型"的彩色标签消息（不是冒充用户说了一句话），
   然后弹出一张空白信息表——项目名称/地点/土地性质等都要用户自己填，不会拿AI猜的假数据往下走。 */
function airPickCategory(calcType){
  if(aiReportBusy) return;
  const opt = AI_CATEGORY_OPTIONS.find(c=>c.key===calcType);
  if(!opt) return;
  if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);project.name="AI可研未命名项目";saveDraft();}
  airPush({role:"assistant", kind:"typeTag", content:opt.label, calcType});
  aiReportExtracted = { projectName:"", location:"", calcType, landArea:null, landPrice:null, startYear:null, owner:"", landNature:"", desc:"", __manual:true };
  airPush({role:"assistant", kind:"infoCard"});
  airSaveState();
}

function renderAiReportMsgs(){
  const box = document.getElementById("airMsgs");
  if(!box) return;
  box.innerHTML = aiReportChat.map(m=>{
    // 类型标签：彩色小胶囊，不套用普通消息气泡（不带"AI："前缀，不是在冒充一句对话）
    if(m.kind==="typeTag"){
      return '<div class="air-typetag-row"><span class="air-typetag air-typetag-'+m.calcType+'">✓ 已选择测算类型：'+escapeHtml(m.content)+'</span></div>';
    }
    let body;
    if(m.kind==="infoCard") body = airInfoCardHtml();
    else if(m.kind==="confirmCard") body = airConfirmCardHtml();
    else if(m.kind==="genConfirm") body = airGenConfirmHtml();
    else if(m.kind==="deliver") body = airDeliverHtml();
    else if(m.kind==="genProgress") body = airProgressCardHtml(m);
    else if(m.kind==="calcPreview") body = airCalcPreviewHtml(m);
    else if(m.kind==="loading") body = '<div class="air-loading"><span class="air-dots"><span></span><span></span><span></span></span>'
      +'<span class="air-loading-label">'+escapeHtml(m.content)+'</span></div>';
    else body = (window.MD? window.MD.renderHtml(m.content||"") : escapeHtml(m.content||"").replace(/\n/g,"<br>"));
    const copyBtn = (m.role==="assistant" && m.kind==="text") ? '<button class="air-msg-copy" data-copy="'+m.id+'">复制</button>' : "";
    const retryBtn = m.retry ? '<div style="margin-top:8px;"><button class="btn ghost air-msg-retry" data-retry="'+m.id+'" style="padding:4px 12px; font-size:11.5px;">重试</button></div>' : "";
    return '<div class="air-msg '+(m.role==="user"?"user":"assistant")+'">'
      +(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+copyBtn+body+retryBtn+'</div>';
  }).join("");
  box.scrollTop = box.scrollHeight;
  const s = id=>document.getElementById(id);
  if(s("airConfirmInfo")) s("airConfirmInfo").onclick = aiReportConfirmInfo;
  if(s("airConfirmParams")) s("airConfirmParams").onclick = aiReportConfirmParams;
  document.querySelectorAll(".air-kf-confirm").forEach(box=>box.addEventListener("change",airSyncConfirmButtonState));
  if(s("airConfirmAll")) s("airConfirmAll").onclick = ()=>{
    const boxes=document.querySelectorAll(".air-kf-confirm");
    const result=window.ProjectWorkflow?window.ProjectWorkflow.bulkConfirm(boxes):(Array.from(boxes).forEach(x=>x.checked=true),{total:boxes.length,changed:boxes.length});
    const btn=s("airConfirmAll"),state=s("airConfirmAllState");
    btn.textContent="已批量确认 "+result.total+" 项";btn.classList.add("done");
    if(state)state.textContent=result.changed?"请最后点击下方“确认，开始测算”":"全部项目此前已经确认";
    airSyncConfirmButtonState();
  };
  airSyncConfirmButtonState();
  if(s("airStartGen")) s("airStartGen").onclick = aiReportStartGenerate;
  if(s("airApplyCalc"))s("airApplyCalc").onclick=airApplyCalcPreview;
  if(s("airRejectCalc"))s("airRejectCalc").onclick=()=>{aiReportPendingCalcChange=null;aiReportChat=aiReportChat.filter(m=>m.kind!=="calcPreview");airPush({role:"assistant",kind:"text",content:"已取消本次参数修改，当前正式测算和报告没有变化。"});airSaveState();};
  document.querySelectorAll(".air-act").forEach(b=>{ b.onclick = ()=>airDeliverAction(b.dataset.act); });
  document.querySelectorAll(".air-prompt").forEach(b=>{b.onclick=()=>{const inp=s("airInput");if(!inp)return;inp.value=b.dataset.prompt||"";airAutosize(inp);inp.focus();}});
  document.querySelectorAll(".air-msg-copy").forEach(b=>{
    b.onclick = ()=>{
      const m = aiReportChat.find(x=>x.id===+b.dataset.copy);
      if(!m) return;
      navigator.clipboard.writeText(m.content||"").then(()=>{
        b.textContent = "已复制"; setTimeout(()=>{ b.textContent = "复制"; }, 1200);
      }).catch(()=>{});
    };
  });
  document.querySelectorAll(".air-msg-retry").forEach(b=>{
    b.onclick = ()=>{
      const m = aiReportChat.find(x=>x.id===+b.dataset.retry);
      if(!m || !m.retry || aiReportBusy) return;
      airRemoveMsg(m);
      airSetBusy(true);
      const done = ()=>airSetBusy(false);
      if(m.retry.type==="extract") airRunExtract(m.retry.text).then(done, done);
      else if(m.retry.type==="suggest") airRunSuggest().then(done, done);
      else if(m.retry.type==="survey") airRunSurvey().then(done, done);
    };
  });
  document.querySelectorAll(".air-stop-btn").forEach(b=>{
    b.onclick = ()=>{ aiReportStopFlag = true; b.disabled = true; b.textContent = "正在停止…"; };
  });
  document.querySelectorAll(".air-resume-btn").forEach(b=>{
    b.onclick = ()=>{
      aiReportStopFlag = false;
      aiReportProgressMsg.active = true; aiReportProgressMsg.stopped = false;
      renderAiReportMsgs();
      airRunGenTasks();
    };
  });
  airRenderChips();
}

function airParamMeta(key){
  const m=aiReportSuggested&&aiReportSuggested.paramMeta&&aiReportSuggested.paramMeta[key];
  if(m)return m;
  const f=aiReportSuggested&&aiReportSuggested.keyFields&&aiReportSuggested.keyFields.find(x=>x.key===key);
  return {label:f&&f.label||key,unit:f&&f.pct?"%":""};
}
function airCalcPreviewHtml(){
  const p=aiReportPendingCalcChange;if(!p)return '<div class="air-card">预演已失效，请重新提出修改。</div>';
  const meta=airParamMeta(p.key),fmt=n=>Number(n).toLocaleString("zh-CN",{maximumFractionDigits:2});
  const rows=p.diff.slice(0,8).map(x=>'<tr><td>'+escapeHtml(x.label)+'</td><td>'+fmt(x.before)+'</td><td>'+fmt(x.after)+'</td><td class="'+(x.delta>=0?'pos':'neg')+'">'+(x.delta>=0?'+':'')+fmt(x.delta)+(x.deltaPct==null?'':'（'+(x.deltaPct>=0?'+':'')+x.deltaPct.toFixed(1)+'%）')+'</td></tr>').join("");
  const anomalies=p.anomalies||[];
  return '<div class="air-card"><b>测算修改预演（尚未写入）</b><div style="margin:8px 0;">'+escapeHtml(meta.label)+'：<b>'+fmt(p.before)+'</b> → <b>'+fmt(p.after)+'</b> '+escapeHtml(meta.unit||'')+'</div>'
    +(anomalies.length?'<div class="wf-preview-warn">异常检测：'+anomalies.map(x=>escapeHtml(x.label+'：'+x.message)).join('<br>')+'</div>':'<div style="color:var(--ok-green);font-size:12px;">硬规则异常检测通过</div>')
    +'<table class="rpt"><tr><th>指标</th><th>修改前</th><th>修改后</th><th>变化</th></tr>'+rows+'</table>'
    +'<div style="font-size:12px;margin-top:8px;">预计影响 '+p.impacted.length+' 个小节，其中 '+p.impacted.filter(x=>x.locked).length+' 个已人工锁定。</div>'
    +'<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn" id="airApplyCalc" '+(anomalies.some(x=>x.severity==="error")?'disabled':'')+'>确认采用并形成新版本</button><button class="btn ghost" id="airRejectCalc">取消</button></div></div>';
}
function airBuildCalcPreview(key,value){
  if(!calcParams||!calcResult)throw new Error("当前项目还没有可预演的正式测算");
  if(!(key in calcParams))throw new Error("当前测算不存在参数 "+key);
  const after=Number(value);if(!Number.isFinite(after))throw new Error("新值不是有效数字");
  const next=Object.assign({},calcParams,{[key]:after});
  const nextResult=runCalcEngine(calcType||calcResult.__ctype,next);nextResult.__ctype=calcType||calcResult.__ctype;
  const anomalies=window.ParamGovernance?ParamGovernance.anomalyChecks(calcType||calcResult.__ctype,next,pgParamDefs(calcType||calcResult.__ctype),CALC_CFG.paramrules&&CALC_CFG.paramrules[calcType||calcResult.__ctype]):[];
  return {calcType:calcType||calcResult.__ctype,key,before:calcParams[key],after:next[key],params:next,result:nextResult,diff:ProjectWorkflow.summaryDiff(calcResult.summary,nextResult.summary),anomalies,impacted:ProjectWorkflow.impactedSections(chapters,[key])};
}
function airApplyCalcPreview(){
  const p=aiReportPendingCalcChange;if(!p)return;
  calcType=p.calcType;calcParams=p.params;calcResult=p.result;calcResult.__ctype=p.calcType;scParams=calcParams;scResult=calcResult;
  const snap=ProjectWorkflow.createCalcSnapshot(projectWorkflow,p.calcType,calcParams,calcResult,{reason:"对话确认修改 "+airParamMeta(p.key).label,confirmedBy:typeof getUser==="function"?getUser():""});
  const hits=ProjectWorkflow.markImpacted(chapters,[p.key],airParamMeta(p.key).label+"已更新为 "+p.after+"；当前正文依据旧测算快照");
  aiReportChat=aiReportChat.filter(m=>m.kind!=="calcPreview");aiReportPendingCalcChange=null;
  airPush({role:"assistant",kind:"text",content:"已确认采用并形成测算V"+snap.version+"。共标记"+hits.length+"个受影响小节；锁定小节只提示复核，不会自动覆盖。请进入「可研生成→复核与签发」，点击“只更新未锁定的受影响章节”。"});
  saveDraft();airSaveState();renderAiReportMsgs();
}

function airRegisterAgentTools(){
  if(aiReportAgentRegistered||!window.AgentCore)return;aiReportAgentRegistered=true;const AC=window.AgentCore;
  AC.registerTool("get_current_feasibility_project",{schema:{type:"function",function:{name:"get_current_feasibility_project",description:"读取当前可研项目、当前测算版本和报告状态，不修改数据",parameters:{type:"object",properties:{}}}},run:()=>JSON.stringify({project,calcType:calcType||(calcResult&&calcResult.__ctype),params:calcParams,summary:calcResult&&calcResult.summary,calcVersion:(projectWorkflow.calcSnapshots||[]).length,reportVersion:(projectWorkflow.reportVersions||[]).length,stale:chapters.reduce((n,c)=>n+c.sections.filter(s=>s.syncStatus==="stale"||s.syncStatus==="locked-stale").length,0)})});
  AC.registerTool("diagnose_feasibility_project",{schema:{type:"function",function:{name:"diagnose_feasibility_project",description:"对当前可研项目做一次完整、只读、可追溯的综合诊断。用户问‘项目怎么样’‘测算是否合理’‘哪里可以提升’‘主要风险和优先改进项’时必须优先调用。工具统一汇总白箱财务指标、硬规则异常、敏感参数、参数来源质量、报告待同步/锁定状态、确定性审查问题，并检索知识库依据；不会修改任何数据。",parameters:{type:"object",properties:{focus:{type:"string",description:"用户关注方向，例如综合、财务、参数、报告、风险；默认综合"}},required:[]}}},label:a=>"🩺 运行项目综合诊断"+(a.focus?"（"+a.focus+"）":""),run:async a=>{
    const type=calcType||(calcResult&&calcResult.__ctype)||(aiReportSuggested&&aiReportSuggested.calcType)||null;
    const defs=type&&typeof pgParamDefs==="function"?pgParamDefs(type):[];
    const anomalies=window.ParamGovernance&&type&&calcParams?ParamGovernance.anomalyChecks(type,calcParams,defs,(CALC_CFG.paramrules&&CALC_CFG.paramrules[type])||[]):[];
    // 只有后台真实敏感性分析结果才进入诊断；规则优先级临时排序不能冒充敏感性结论。
    const sensCfg=type&&CALC_CFG.sensitivity&&CALC_CFG.sensitivity[type];
    const sensitivity=window.ParamGovernance&&sensCfg&&Array.isArray(sensCfg.table)&&sensCfg.table.length?ParamGovernance.classifyParameters(sensCfg.table):[];
    const sections=chapters.flatMap(c=>c.sections.map((s,si)=>({cn:c.cn,chapter:c.name,si,title:s.t,status:s.syncStatus||"current",locked:!!s.locked,pendingRevision:!!s.pendingRevision,hasContent:!!(s.content||s.editedHtml)})));
    let reviewIssues=[];try{reviewIssues=typeof runAudit==="function"?runAudit():[];}catch(e){}
    let knowledgeEvidence=[];
    try{
      const focus=String(a.focus||"综合").slice(0,40),q=[project.name,project.location,AI_TYPE_CN[type]||project.type,focus,"可行性 财务风险 优化建议"].filter(Boolean).join(" ");
      const rr=await fetch("/api/rag",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"query",query:q,topK:5})});
      const rd=await rr.json();if(rd.ok)knowledgeEvidence=(rd.matches||[]).map(m=>({title:m.title,chapter:m.chapter||"",score:Number(m.score)||0,matchTier:Number(m.score)>=0.85?"高":Number(m.score)>=0.7?"中":"低，仅供参考",lifecycle:m.lifecycle||"valid",excerpt:String(m.text||"").slice(0,260)}));
    }catch(e){}
    return JSON.stringify(ProjectWorkflow.buildProjectDiagnostic({project,calcType:type,params:calcParams,summary:calcResult&&calcResult.summary,anomalies,sensitivity,sources:aiReportSuggested&&aiReportSuggested.sources,paramMeta:aiReportSuggested&&aiReportSuggested.paramMeta,sections,reviewIssues,knowledgeEvidence}));
  }});
  AC.registerTool("preview_feasibility_parameter_change",{schema:{type:"function",function:{name:"preview_feasibility_parameter_change",description:"预演一个测算参数的新值。只计算差异和受影响章节，不会保存，参数名必须使用当前项目中的内部key",parameters:{type:"object",properties:{key:{type:"string",description:"参数内部key"},value:{type:"number",description:"候选新值；比例参数用0到1"}},required:["key","value"]}}},validate:a=>a&&typeof a.key==="string"&&Number.isFinite(a.value)?{ok:true}:{ok:false,error:"必须提供参数key和数字value"},run:a=>{aiReportPendingCalcChange=airBuildCalcPreview(a.key,a.value);return JSON.stringify({status:"preview_only",parameter:Object.assign({key:a.key},airParamMeta(a.key)),before:aiReportPendingCalcChange.before,after:aiReportPendingCalcChange.after,metricChanges:aiReportPendingCalcChange.diff.slice(0,10),anomalies:aiReportPendingCalcChange.anomalies,impactedSections:aiReportPendingCalcChange.impacted});},label:a=>"预演参数修改："+airParamMeta(a.key).label});
  AC.registerTool("find_feasibility_impacted_sections",{schema:{type:"function",function:{name:"find_feasibility_impacted_sections",description:"查询一个或多个测算参数会影响哪些可研章节，不修改报告",parameters:{type:"object",properties:{keys:{type:"array",items:{type:"string"}}},required:["keys"]}}},run:a=>JSON.stringify(ProjectWorkflow.impactedSections(chapters,a.keys||[]))});
  AC.registerTool("get_feasibility_section_status",{schema:{type:"function",function:{name:"get_feasibility_section_status",description:"查看当前报告每节的最新、待同步、人工锁定和候选修改状态",parameters:{type:"object",properties:{}}}},run:()=>JSON.stringify(chapters.flatMap(c=>c.sections.map((s,si)=>({cn:c.cn,chapter:c.name,si,title:s.t,status:s.syncStatus||"current",locked:!!s.locked,pendingRevision:!!s.pendingRevision}))))});
  AC.registerTool("get_feasibility_section_content",{schema:{type:"function",function:{name:"get_feasibility_section_content",description:"按小节标题读取当前可研正文，不修改内容",parameters:{type:"object",properties:{title:{type:"string"}},required:["title"]}}},run:a=>{const q=String(a.title||"");const hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t));return JSON.stringify(hits.slice(0,5).map(x=>({cn:x.c.cn,chapter:x.c.name,si:x.si,title:x.s.t,content:x.s.editedHtml?blocksToSource(x.s.editedHtml):x.s.content,locked:!!x.s.locked})));}});
  AC.registerTool("propose_feasibility_section_revision",{schema:{type:"function",function:{name:"propose_feasibility_section_revision",description:"为一个明确小节生成候选修改稿，不覆盖正式正文；用户之后到复核页接受或拒绝",parameters:{type:"object",properties:{title:{type:"string"},instruction:{type:"string"}},required:["title","instruction"]}}},validate:a=>a&&String(a.title||"").trim()&&String(a.instruction||"").trim()?{ok:true}:{ok:false,error:"必须提供小节标题和修改要求"},run:async a=>{const q=String(a.title),hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t));if(hits.length!==1)return JSON.stringify({ok:false,error:hits.length?"匹配到多个小节，请说完整标题":"没有找到该小节"});const x=hits[0];if(x.s.locked)return JSON.stringify({ok:false,error:"该小节已人工锁定，请先解除锁定"});const text=await reviseSection(x.c,x.s,String(a.instruction));ProjectWorkflow.setCandidate(x.s,text,String(a.instruction));saveDraft();return JSON.stringify({ok:true,status:"candidate_only",cn:x.c.cn,chapter:x.c.name,si:x.si,title:x.s.t,message:"候选稿已生成，正式正文尚未变化，请到复核页接受或拒绝"});},label:a=>"生成章节候选稿："+a.title});
}
async function airRunAgent(text){
  airRegisterAgentTools();const loading=airPushLoading("正在结合当前项目、测算和报告状态处理…");
  try{
    const meta=Object.entries(aiReportSuggested&&aiReportSuggested.paramMeta||{}).map(([k,m])=>k+"="+m.label+(m.unit?'('+m.unit+')':'')).join("；");
    const history=aiReportChat.filter(m=>m.kind==="text"&&(m.role==="user"||m.role==="assistant")).slice(-10).map(m=>({role:m.role,content:m.content}));
    const res=await AgentCore.run({system:"你是当前可研项目的持续协作助手。项目已有白箱测算和报告。用户问‘项目怎么样’‘测算是否合理’‘哪里可以提升’‘主要风险/改进优先级’等开放式综合判断时，必须首先调用diagnose_feasibility_project，并严格按诊断底稿回答：先给总体判断，再按高/中/提示列建议，每条说明依据类型；财务数字只能引用metrics，硬规则只能引用hardRuleAnomalies，行业比较只能引用knowledgeEvidence；数据缺失必须直说暂无，AI推断必须明确标为判断。用户要求修改测算参数时，必须调用preview_feasibility_parameter_change，只能预演，绝不能声称已修改。用户只问影响范围时调用find_feasibility_impacted_sections。用户明确要求修改某个小节文字时，先用get_feasibility_section_content核对，再调用propose_feasibility_section_revision生成候选稿；候选稿不等于已采用，必须提示用户到复核页接受或拒绝。不要自行计算IRR/NPV。参数中文与key目录："+meta+"。比例参数工具值必须用0到1，例如90%传0.9。",messages:history,tools:["diagnose_feasibility_project","get_current_feasibility_project","preview_feasibility_parameter_change","find_feasibility_impacted_sections","get_feasibility_section_status","get_feasibility_section_content","propose_feasibility_section_revision","get_calc_summary","search_knowledge_base","get_review_issues"],maxRounds:4,selfCheck:false,traceQuery:text});
    airResolve(loading,{kind:"text",content:res.text||"已处理。"});
    if(aiReportPendingCalcChange)airPush({role:"assistant",kind:"calcPreview"});
    airSaveState();
  }catch(e){airResolve(loading,{kind:"text",content:"处理失败："+e.message});}
}

/* ================= 云端存档：刷新页面不用从头再来（只覆盖对话进度，不含生成中的报告正文——
   报告正文走 report.js 自己那套草稿存档） ================= */
function airSerializableState(){
  const chat = [];
  aiReportChat.forEach(m=>{
    if(m.kind==="loading") return; // 瞬时态，不必存
    if(m.kind==="genProgress"){ chat.push({role:"assistant",kind:"genProgress",total:m.total,done:m.done,failed:m.failed,active:false,stopped:true}); return; }
    if(m.kind==="calcPreview")return;
    if(m.kind==="typeTag"){ chat.push({role:m.role, kind:"typeTag", content:m.content||"", calcType:m.calcType}); return; }
    chat.push({role:m.role, kind:m.kind, content:m.content||""});
  });
  return { savedAt:Date.now(),stage:airCurrentStage(),chat,extracted:aiReportExtracted,suggested:aiReportSuggested,hasDoc:aiReportHasDoc,paramsConfirmed:aiReportParamsConfirmed,
    calcType:calcType||(calcResult&&calcResult.__ctype)||null,calcParams:calcParams||null,calcSummary:calcResult&&calcResult.summary||null,
    currentCalcSnapshotId:projectWorkflow&&projectWorkflow.currentCalcSnapshotId||null,currentReportVersionId:projectWorkflow&&projectWorkflow.currentReportVersionId||null,
    pendingTaskKeys:(aiReportPendingTasks||[]).map(t=>({cn:t.c.cn,si:t.si})) };
}
function airSaveState(){
  const state=airSerializableState();
  airSaveLocalState(state); // 同步落本地，刚点击后立即刷新也不会倒退
  try{
    fetch("/api/aireport", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"saveState",projectId:currentProjectId||undefined,state})});
  }catch(e){ /* 保存失败不影响当前对话，下次关键节点会重试 */ }
}
function airRestoredConfirmation(state){
  if(!state)return false;
  if(state.paramsConfirmed===true)return true;
  if(state.paramsConfirmed===false)return false;
  const chat=Array.isArray(state.chat)?state.chat:[];
  return !!(state.calcParams&&chat.some(m=>m&&["genProgress","deliver"].includes(m.kind)));
}
async function airLoadState(){
  if(aiReportChatLoaded) return;
  aiReportChatLoaded = true;
  if(aiReportChat.length) return; // 本次会话已经有内容了，不覆盖
  try{
    const localState=airLoadLocalState();
    const q=currentProjectId?"?projectId="+encodeURIComponent(currentProjectId):"";
    const r = await fetch("/api/aireport"+q, {headers: authHeaders()});
    const d = await r.json();
    const serverState=(d.ok&&d.state)?d.state:null;
    // 若用户刚完成一步就刷新，网络保存可能还在途中；优先采用时间更新的本地即时状态。
    const state=localState&&Number(localState.savedAt)>Number(serverState&&serverState.savedAt||0)?localState:(serverState||localState);
    if(state && (state.extracted||state.suggested||state.calcParams||state.hasDoc||(Array.isArray(state.chat)&&state.chat.length))){
      aiReportChat = (Array.isArray(state.chat)?state.chat:[]).map(m=>Object.assign({id: ++aiReportMsgSeq}, m));
      aiReportExtracted = state.extracted || null;
      aiReportSuggested = state.suggested || null;
      aiReportHasDoc=!!state.hasDoc;
      aiReportParamsConfirmed=airRestoredConfirmation(state);
      if(state.calcType)calcType=state.calcType;
      if(aiReportParamsConfirmed&&state.calcParams){calcParams=state.calcParams;try{calcResult=runCalcEngine(calcType,calcParams);calcResult.__ctype=calcType;scParams=calcParams;scResult=calcResult;}catch(e){aiReportParamsConfirmed=false;}}
      airRepairFlowCards();
      aiReportProgressMsg=aiReportChat.find(m=>m.kind==="genProgress")||null;
      if(Array.isArray(state.pendingTaskKeys)&&state.pendingTaskKeys.length&&chapters.length){
        aiReportPendingTasks=state.pendingTaskKeys.map(k=>{const info=findChapterSection(k.cn,+k.si);return info?{c:info.chapter,s:info.section,si:+k.si}:null;}).filter(Boolean);
        if(aiReportProgressMsg){aiReportProgressMsg.active=false;aiReportProgressMsg.stopped=true;}
      }
      if(aiReportHasDoc&&chapters.length)airRestoreDocPaneIfNeeded();
      renderAiReportMsgs();
    }
  }catch(e){
    const state=airLoadLocalState();
    if(state){
      aiReportChat=(state.chat||[]).map(m=>Object.assign({id:++aiReportMsgSeq},m));aiReportExtracted=state.extracted||null;aiReportSuggested=state.suggested||null;aiReportHasDoc=!!state.hasDoc;aiReportParamsConfirmed=airRestoredConfirmation(state);
      if(state.calcType)calcType=state.calcType;if(aiReportParamsConfirmed&&state.calcParams){calcParams=state.calcParams;try{calcResult=runCalcEngine(calcType,calcParams);calcResult.__ctype=calcType;scParams=calcParams;scResult=calcResult;}catch(_){aiReportParamsConfirmed=false;} }
      airRepairFlowCards();renderAiReportMsgs();
    }
  }
}

/* 兼容历史存档：旧版本可能只存了参数/测算结果，没有存对应的“下一步”卡片。
   恢复时补齐唯一必要的动作卡，同时删除同类重复卡，避免刷新后倒退或重复执行。 */
function airRepairFlowCards(){
  const dedupe=kind=>{let seen=false;aiReportChat=aiReportChat.filter(m=>m.kind!==kind||(!seen&&(seen=true)));};
  ["infoCard","confirmCard","genConfirm","deliver"].forEach(dedupe);
  const has=kind=>aiReportChat.some(m=>m.kind===kind);
  if(aiReportExtracted&&!has("infoCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"infoCard"});
  if(aiReportSuggested&&!has("confirmCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"confirmCard"});
  const stage=airCurrentStage();
  if(stage==="calculated"&&!has("genConfirm"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"genConfirm"});
  if(stage==="delivered"&&!has("deliver"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"deliver"});
}
