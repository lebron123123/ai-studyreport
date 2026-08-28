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
let aiReportMaterialTarget = null; // 当前项目材料上传要补到哪一条规则/哪个小节
let aiReportBatchFiles = []; // 批量材料解析后的待确认映射，不确认不写入项目资料
let aiReportCanEnhanceLogic = false; // 仅控制管理员增强入口显示；真正发布仍由服务端校验密码
let aiReportLogicEnhanceState = null; // 当前逐项增强会话
let aiReportLocationCandidates = []; // 地图候选必须由用户确认，禁止默认取第一条
let aiReportLocationConfirmed = null; // {name,district,address,location,query}

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
  aiReportHasDoc=false;aiReportDocVisible=false;aiReportPendingCalcChange=null;aiReportBusy=false;aiReportChatLoaded=false;aiReportParamsConfirmed=false;aiReportMaterialTarget=null;aiReportBatchFiles=[];aiReportLogicEnhanceState=null;aiReportLocationCandidates=[];aiReportLocationConfirmed=null;
}

function airDocPaneEmptyHtml(){
  return '<div class="air-doc-empty-tip"><span class="ic">📄</span>报告预览会在这里出现——确认参数、开始测算后，AI撰写的每一节都会实时显示在这里，可随时点大纲跳转阅读，也可以点右上角收起。</div>';
}

function renderAiReportModule(){
  return '<div class="air-shell solo">'
    +'<div class="air-chat-pane">'
    +'<div class="air-restart-row"><button type="button" class="btn ghost air-back-btn" id="airBackStepBtn">← 返回上一步</button><button type="button" class="btn ghost air-restart-btn" id="airRestartBtn">🔄 重新开始</button></div>'
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
  aiReportLocationCandidates = [];
  aiReportLocationConfirmed = null;
  const pane = document.getElementById("airDocPane");
  if(pane){ pane.className = "air-doc-pane empty"; pane.innerHTML = airDocPaneEmptyHtml(); }
  airSetDocVisible(false);
  airSetBusy(false);
  renderAiReportMsgs();
  airClearLocalState();
  try{ fetch("/api/aireport"+(currentProjectId?"?projectId="+encodeURIComponent(currentProjectId):""), {method:"DELETE", headers: authHeaders()}); }catch(e){ /* 清云端存档失败不影响本地已经重置 */ }
}

/* 返回只撤销“流程确认状态”，不删除用户已经填写的信息、测算参数或已生成正文。
   重新进入下一步时会基于保留的数据重算/续写，因此比“重新开始”安全。 */
function airBackStep(){
  const stage=airCurrentStage(),prev=window.ProjectWorkflow&&ProjectWorkflow.previousAiReportStage?ProjectWorkflow.previousAiReportStage(stage):null;
  if(!prev){alert("当前已经是第一步，无需返回。");return;}
  if(["generating","paused","delivered"].includes(stage)){
    if(!confirm("返回测算确认步骤？正在生成的任务会暂停；已经生成的正文和测算结果都会保留。"))return;
    aiReportStopFlag=true;aiReportHasDoc=false;
    aiReportChat=aiReportChat.filter(m=>!["genProgress","deliver","materialCheck"].includes(m.kind));
    aiReportPendingTasks=null;aiReportProgressMsg=null;airSetDocVisible(false);
  }else if(stage==="calculated"){
    aiReportParamsConfirmed=false;
    aiReportChat=aiReportChat.filter(m=>!["genConfirm","materialCheck","calcPreview"].includes(m.kind));
  }else if(stage==="suggested"){
    aiReportSuggested=null;aiReportParamsConfirmed=false;
    aiReportChat=aiReportChat.filter(m=>!["confirmCard","genConfirm","materialCheck","calcPreview"].includes(m.kind));
  }else if(stage==="info"){
    aiReportLocationCandidates=[];aiReportLocationConfirmed=null;
    aiReportChat=aiReportChat.filter(m=>m.kind!=="locationCard");
  }
  airRepairFlowCards();renderAiReportMsgs();airSaveState();
}

function bindAiReportEvents(){
  const s = id=>document.getElementById(id);
  if(s("airRestartBtn")) s("airRestartBtn").onclick = airRestartChat;
  if(s("airBackStepBtn")){s("airBackStepBtn").onclick = airBackStep;s("airBackStepBtn").disabled=!(window.ProjectWorkflow&&ProjectWorkflow.previousAiReportStage(airCurrentStage()));}
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
      const rewrite=e.target.closest(".air-section-rewrite");
      if(rewrite){airRewriteSection(rewrite.dataset.cn,+rewrite.dataset.si,rewrite);return;}
      const revise=e.target.closest(".air-section-revise");
      if(revise){airOpenRevisionModal(revise.dataset.cn,+revise.dataset.si,"");return;}
      const accept=e.target.closest(".air-candidate-accept");
      if(accept){airResolveRevision(accept.dataset.cn,+accept.dataset.si,"accept");return;}
      const reject=e.target.closest(".air-candidate-reject");
      if(reject){airResolveRevision(reject.dataset.cn,+reject.dataset.si,"reject");return;}
      const undo=e.target.closest(".air-section-undo");
      if(undo){airResolveRevision(undo.dataset.cn,+undo.dataset.si,"undo");return;}
      const selectionEdit=e.target.closest(".air-selection-edit");
      if(selectionEdit&&aiReportSelectionState){
        const st=aiReportSelectionState;airHideSelectionAction();airOpenRevisionModal(st.cn,st.si,st.text);return;
      }
      const upload=e.target.closest(".air-material-upload");
      if(upload){airOpenMaterialUpload(upload);return;}
      const web=e.target.closest(".air-web-search");
      if(web){window.WebResearch?.searchFromButton(web,()=>{airApplyDocMaterialStatuses();airSaveState();}).catch(error=>alert(error.message));return;}
      const enhance=e.target.closest(".air-section-enhance");
      if(enhance){airOpenSectionLogicEnhancement(enhance.dataset.cn,+enhance.dataset.si);return;}
      const close = e.target.closest(".air-doc-close");
      if(close){ airSetDocVisible(false); return; }
      const chip = e.target.closest(".air-doc-outline .chip");
      if(chip) airScrollToChapter(chip.dataset.cn);
    });
    docPane.addEventListener("mouseup",airHandleTextSelection);
    docPane.addEventListener("scroll",airHideSelectionAction,true);
    docPane.addEventListener("change",e=>{if(e.target&&e.target.id==="airDocMaterialFile")airHandleMaterialFiles([...e.target.files]);});
  }
  renderAiReportMsgs();
  airCheckAdminLogicCapability();
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
  if(aiReportChat.some(m=>m.kind==="locationCard"))return '<div class="air-card air-step-done"><b>✓ 核心信息已填写，等待确认地图位置</b><span>'+escapeHtml(v.projectName||"未命名项目")+'｜填写地点：'+escapeHtml(v.location||"")+'。请在下方候选中人工选择，系统不会自动套用第一条结果。</span></div>';
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
    +'<div><label>建设地点（用于地图定位，建议填完整地址）</label><input id="air_loc" type="text" value="'+escapeHtml(v.location||"")+'"><small class="air-field-help">请在这里填：城市＋区＋街道＋社区/道路/门牌。例如“深圳市光明区凤凰街道光谷苑”；未建地块可填最近道路交叉口或已上图地标。</small></div>'
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
  await airSearchLocationCandidates();
  airSetBusy(false);
}

async function airSearchLocationCandidates(overrideQuery){
  const ex=aiReportExtracted||{},query=String(overrideQuery||ex.location||"").trim();
  if(!query){alert("请在建设地点中填写城市、区、街道和社区/道路后再检索。");return;}
  if(overrideQuery)aiReportExtracted.location=query;
  aiReportLocationConfirmed=null;aiReportLocationCandidates=[];
  const loading=airPushLoading("正在核对建设地点，请稍后选择正确地址…");
  try{
    const r=await fetch("/api/poi",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"search",address:query,projectName:ex.projectName||""})});
    const d=await r.json();
    if(!d.ok||!(d.candidates||[]).length){
      airResolve(loading,{kind:"locationCard",query,candidates:[],error:d.error||"未找到匹配地址"});return;
    }
    aiReportLocationCandidates=window.ProjectWorkflow?.rankLocationCandidates?ProjectWorkflow.rankLocationCandidates(query,d.candidates):d.candidates;
    airResolve(loading,{kind:"locationCard",query,candidates:aiReportLocationCandidates});airSaveState();
  }catch(e){airResolve(loading,{kind:"locationCard",query,candidates:[],error:e.message});}
}

function airLocationCardHtml(m){
  const candidates=m.candidates||aiReportLocationCandidates||[],query=m.query||(aiReportExtracted&&aiReportExtracted.location)||"";
  const tips='<div class="air-location-tip"><b>在哪里填、什么最影响结果？</b><span>就在下方“重新检索地址”框填写：城市＋区＋街道＋社区/道路/门牌；精确坐标/完整门牌 ＞ 区＋街道＋社区/道路 ＞ 仅区名。系统会合并精确地址、短地址和项目名称检索，最多展示15条真实相似候选，由你人工确认。</span></div>';
  const search='<div class="air-location-retry"><input id="airLocationRetryInput" value="'+escapeHtml(query)+'" placeholder="例：深圳市光明区凤凰街道光谷苑"><button type="button" class="btn ghost" id="airLocationSearchAgain">重新检索地址</button></div>';
  const rows=candidates.slice(0,15).map((c,i)=>'<label class="air-location-option '+(c.locationMatch==='conflict'?'conflict':'')+'"><input type="radio" name="airLocationCandidate" value="'+i+'"><span><b>'+escapeHtml(c.name||"未命名位置")+'</b><small>'+escapeHtml([c.district,c.address].filter(Boolean).join(" · ")||"无详细地址")+'</small></span><em>'+(c.locationMatch==='matched'?'行政区匹配':c.locationMatch==='conflict'?'行政区不一致':'请人工核对')+'</em></label>').join("");
  const count=rows?'<div class="air-location-query">已汇总 <b>'+candidates.length+'</b> 条真实候选（不伪造凑数），请选择与你项目一致的一项：</div>':'';
  return '<div class="air-card">'+tips+search+count+(rows?'<div class="air-location-list">'+rows+'</div>':'<div class="air-location-error">'+escapeHtml(m.error||"暂未找到真实候选")+'。请直接在上方补充街道、社区/道路、门牌或附近地标后重试，不需要重新开始整个流程。</div>')+'<div class="air-location-actions"><button type="button" class="btn" id="airConfirmLocation" '+(rows?'':'disabled')+'>确认所选地址并继续 →</button><button type="button" class="btn ghost" id="airRetryLocation">返回修改项目信息</button><button type="button" class="btn ghost" id="airSkipLocation">跳过地图检索</button></div></div>';
}

async function airConfirmLocation(){
  const checked=document.querySelector('input[name="airLocationCandidate"]:checked');
  if(!checked){alert("请先点击选择与你项目一致的地址。");return;}
  const selected=aiReportLocationCandidates[+checked.value];if(!selected)return;
  if(selected.locationMatch==='conflict'&&!confirm("该候选行政区与填写地点不一致，仍要采用吗？建议取消并选择正确地址。"))return;
  aiReportLocationConfirmed=Object.assign({query:aiReportExtracted.location},selected);
  project.poiLoc=selected.location;project.poiLocLabel=selected.name;project.poiKw=aiReportExtracted.location;
  aiReportChat=aiReportChat.filter(m=>m.kind!=="locationCard");
  airPush({role:"assistant",kind:"text",content:"📍 已人工确认项目位置："+selected.name+"（"+([selected.district,selected.address].filter(Boolean).join("，")||"地图坐标已确认")+"）。后续周边、职住和竞品分析均以该坐标为准。"});
  airSetBusy(true);await airRunSurvey(selected);await airRunSuggest();airSetBusy(false);airSaveState();
}

async function airSkipLocation(){
  if(!confirm("跳过后不会生成地图周边、竞品和POI职住代理数据，但不影响参数推荐与可研框架生成。是否继续？"))return;
  aiReportLocationConfirmed={skipped:true,query:aiReportExtracted.location};aiReportChat=aiReportChat.filter(m=>m.kind!=="locationCard");
  airPush({role:"assistant",kind:"text",content:"已按你的选择跳过地图检索。报告中需要周边实测数据的位置会标注待补，不会套用其他行政区结果。"});
  airSetBusy(true);await airRunSuggest();airSetBusy(false);airSaveState();
}

/* 信息一确认，先列出高德候选并由用户人工选择；只有确认后的坐标才会跑周边配套和竞品调研。
   复用的还是 poi.js 里那三个接口
   （/api/poi 的 search / 周边 / competitors），查到的 project.poiDesc / project.competitors
   跟标准向导写的是同一份字段，会被 surveyBrief() 自动带进后续生成的每一节里，不用额外接线。
   查不到、没配AMAP_KEY、接口挂了——都只是跳过，不能卡住后面的参数推荐和测算。 */
async function airRunSurvey(confirmedCandidate){
  const ex = aiReportExtracted;
  const kw = ((ex.location||"") + (ex.projectName||"")).trim();
  if(!kw) return;
  const loading = airPushLoading("正在检索项目周边配套与竞品（高德地图）…");
  try{
    const best=confirmedCandidate||aiReportLocationConfirmed;
    if(!best||!best.location){airResolve(loading,{kind:"text",content:"尚未确认地图位置，已跳过周边检索。"});return;}
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

function airFormatParamValue(value,meta){
  const unit=String(meta&&meta.unit||"");
  if(value==null||value==="")return "—";
  const numberText=n=>Number(n).toLocaleString("zh-CN",{maximumFractionDigits:4});
  if(Array.isArray(value)){
    if(unit==="比例")return value.map(x=>Number.isFinite(+x)?numberText(+x*100)+"%":String(x)).join("、");
    return value.map(x=>Number.isFinite(+x)?numberText(+x):String(x)).join("、")+(unit&&unit!=="—"?" "+unit:"");
  }
  if(typeof value==="object")return JSON.stringify(value);
  if(typeof value==="number"){
    if(unit==="比例")return numberText(value*100)+"%";
    if(unit==="%")return numberText(value)+"%";
    if(unit==="年"||unit==="月")return String(value)+unit;
    return numberText(value)+(unit&&unit!=="—"?" "+unit:"");
  }
  return String(value);
}

function airConfirmCardHtml(){
  const sug = aiReportSuggested;
  if(!sug) return "";
  const alreadyCalculated=airStageAtLeast("calculated");
  const shownParams=alreadyCalculated&&calcParams?calcParams:sug.params;
  const confCls = c => c==="高"?"air-conf-hi":c==="中"?"air-conf-mid":"air-conf-lo";
  const rows = sug.keyFields.map(f=>{
    const src = sug.sources[f.key] || {};
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
  const otherDetails=otherKeys.length?'<details style="margin-top:10px;"><summary style="font-size:12px;cursor:pointer;">查看其余 '+otherKeys.length+' 项参数及来源</summary><div class="air-other-param-list">'
    +'<div class="air-other-param-row head"><span>参数</span><span>当前值</span><span>来源/依据</span><span>确认状态</span></div>'
    +otherKeys.map(k=>{const s=sug.sources[k]||{},m=(sug.paramMeta&&sug.paramMeta[k])||{},value=shownParams[k];return '<div class="air-other-param-row"><span><b>'+escapeHtml(m.label||k)+'</b><br><code>'+escapeHtml(k)+'</code></span><span class="air-other-param-value">'+escapeHtml(airFormatParamValue(value,m))+'</span><span>'+escapeHtml(s.from||"来源待确认")+'</span><span>'+(s.requiresManualConfirmation?'待批量确认':'资料已给定')+'</span></div>';}).join("")+'</div></details>':'';
  return '<div class="air-card">'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">来源层级：'+escapeHtml((sug.sourceHierarchy||[]).join(" → "))+'</div>'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">本次全量来源：'+escapeHtml(sourceSummary)+'</div>'
    +(alreadyCalculated?'<div class="air-step-done"><b>✓ 参数已经人工确认，财务测算已完成</b><span>当前参数只读展示；如需调整，可在下方对话中直接说明要修改的参数和值，系统会先预演影响。</span><button type="button" class="btn ghost air-open-calc-details" style="margin-top:8px;align-self:flex-start;">📊 进入财务测算详情</button></div>':'<div class="air-bulk-confirm"><div><b>已逐项核对数值和依据？</b><span>可一次勾选本卡片全部待人工确认项；不会自动开始测算。</span></div><button type="button" class="btn" id="airConfirmAll">批量人工确认全部</button><span id="airConfirmAllState"></span></div>')
    + rows
    + otherDetails
    +(!alreadyCalculated&&otherManual.length?'<label style="display:block;margin-top:10px;font-size:11.5px;"><input class="air-kf-confirm" data-key="__other_batch" type="checkbox"> 已批量核对其余 '+otherManual.length+' 项案例/兜底/默认参数（低影响项后续还会做联合扰动验证）</label>':'')
    +'<div style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'
    +(alreadyCalculated?'<span class="air-complete-pill">测算步骤已完成</span>':'<button class="btn" id="airConfirmParams">确认，开始测算 →</button>')
    +'<span style="font-size:11.5px; color:var(--ink-soft);">其余约'+(Object.keys(sug.params).length-sug.keyFields.length)+'项参数的当前值、单位和来源已列在上方折叠区</span>'
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
    if(window.ReportLogicCore){try{await ReportLogicCore.load(calcType);}catch(e){}}
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
  let logicOutline = null;
  if(window.ReportLogicCore){
    try{ await ReportLogicCore.load(sug.calcType); logicOutline=ReportLogicCore.outline(sug.calcType); }catch(e){}
  }
  if(logicOutline) reportLoadDomainSource(domainKey_,logicOutline);
  else loadDomain(domainKey_);
  rptCtype = sug.calcType;

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
  }, reportGenerationConcurrency(tasks.length), ()=>!aiReportStopFlag);
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
  let streamTimer=null,streamText="";
  const streamWrite=partial=>{
    streamText=partial;
    if(streamTimer)return;
    streamTimer=setTimeout(()=>{
      streamTimer=null;
      const el=document.getElementById(secId),body=el&&el.querySelector(".body");
      if(body)body.textContent=streamText;
    },50);
  };
  try{
    const text = await generateSection(chapter, section, (partial)=>{
      streamWrite(partial);
    });
    if(streamTimer){clearTimeout(streamTimer);streamTimer=null;}
    section.content = text;
    if(secEl){
      secEl.dataset.status = "done";
      secEl.classList.remove("pending"); secEl.classList.remove("gen");
      airRenderCompletedSection(chapter,section,si);
    }
    if(opts.onDone) opts.onDone();
  }catch(e){
    if(streamTimer){clearTimeout(streamTimer);streamTimer=null;}
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
let aiReportSelectionState=null;
function airSectionToolsHtml(chapter,section,si){
  const undo=Array.isArray(section.undoStack)&&section.undoStack.length?'<button type="button" class="air-section-action air-section-undo" data-cn="'+chapter.cn+'" data-si="'+si+'">撤销</button>':'';
  return '<div class="air-section-tools"><button type="button" class="air-section-action air-section-rewrite" data-cn="'+chapter.cn+'" data-si="'+si+'">↻ 重写</button>'
    +'<button type="button" class="air-section-action air-section-revise" data-cn="'+chapter.cn+'" data-si="'+si+'">✎ AI修改</button>'+undo
    +'<span>也可拖选正文中的文字进行局部修改</span></div>';
}
function airCandidateHtml(chapter,section,si){
  if(!section.pendingRevision||!window.ProjectWorkflow)return '';
  return '<div class="air-section-candidate wf-candidate"><b>AI修改候选稿 · 尚未覆盖正式正文</b>'
    +ProjectWorkflow.simpleDiffHtml(section.pendingRevision.before,section.pendingRevision.after)
    +'<div class="wf-candidate-actions"><button type="button" class="btn air-candidate-accept" data-cn="'+chapter.cn+'" data-si="'+si+'">接受修改</button>'
    +'<button type="button" class="btn ghost air-candidate-reject" data-cn="'+chapter.cn+'" data-si="'+si+'">拒绝</button></div></div>';
}
function airRenderCompletedSection(chapter,section,si){
  const el=document.getElementById('sec_'+chapter.cn+'_'+si);if(!el)return;
  const title=el.querySelector('h4');if(title&&!title.querySelector('.done-stamp'))title.insertAdjacentHTML('beforeend','<span class="done-stamp">已拟</span>');
  const tools=el.querySelector('.air-section-tools');
  if(tools)tools.outerHTML=airSectionToolsHtml(chapter,section,si);else el.querySelector('.air-section-material')?.insertAdjacentHTML('afterend',airSectionToolsHtml(chapter,section,si));
  const body=el.querySelector('.body');if(body)body.innerHTML=renderContent(airSectionDisplayContent(chapter,section));
  el.querySelector('.air-section-candidate')?.remove();
  if(body)body.insertAdjacentHTML('afterend',airCandidateHtml(chapter,section,si));
}
function airRefreshSection(cn,si){const info=findChapterSection(cn,si);if(info)airRenderCompletedSection(info.chapter,info.section,si);}
function airHideSelectionAction(){document.getElementById('airSelectionAction')?.remove();aiReportSelectionState=null;}
function airHandleTextSelection(e){
  if(e.target.closest('button,input,textarea,.wf-candidate'))return;
  setTimeout(()=>{
    const sel=window.getSelection();if(!sel||sel.isCollapsed){airHideSelectionAction();return;}
    const text=sel.toString().trim();if(text.length<2){airHideSelectionAction();return;}
    const node=sel.anchorNode&&sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
    const body=node&&node.closest?node.closest('.section-block .body'):null;
    const block=body&&body.closest('.section-block');if(!block||!block.id.startsWith('sec_')){airHideSelectionAction();return;}
    const m=block.id.match(/^sec_(.+)_(\d+)$/);if(!m)return;
    const rect=sel.getRangeAt(0).getBoundingClientRect();airHideSelectionAction();
    aiReportSelectionState={cn:m[1],si:+m[2],text:text.slice(0,4000)};
    const btn=document.createElement('button');btn.id='airSelectionAction';btn.type='button';btn.className='air-selection-edit';btn.textContent='✎ AI修改选中文字';
    btn.onmousedown=event=>event.preventDefault();
    btn.onclick=()=>{const st=aiReportSelectionState;if(!st)return;airHideSelectionAction();airOpenRevisionModal(st.cn,st.si,st.text);};
    btn.style.left=Math.max(8,Math.min(window.innerWidth-180,rect.left+rect.width/2-75))+'px';btn.style.top=Math.max(8,rect.top-40)+'px';document.body.appendChild(btn);
  },0);
}
async function airRewriteSection(cn,si,btn){
  const info=findChapterSection(cn,si);if(!info||!window.ProjectWorkflow)return;
  btn.disabled=true;const old=btn.textContent;btn.textContent='重写中…';
  try{const text=await generateSection(info.chapter,info.section);ProjectWorkflow.setCandidate(info.section,text,'重写本节');saveDraft();airSaveState();airRefreshSection(cn,si);}
  catch(e){alert('重写失败：'+e.message);}finally{btn.disabled=false;btn.textContent=old;}
}
function airOpenRevisionModal(cn,si,selected){
  const info=findChapterSection(cn,si);if(!info)return;document.getElementById('airRevisionModal')?.remove();
  const partial=!!selected,preview=partial?'<div class="air-revision-selection"><b>已选择文字</b><div>'+escapeHtml(selected)+'</div></div>':'';
  document.body.insertAdjacentHTML('beforeend','<div class="air-modal-overlay" id="airRevisionModal"><div class="air-modal-card air-revision-modal">'
    +'<div class="air-modal-head"><div><b>'+(partial?'局部AI修改':'整节AI修改')+' · '+escapeHtml(info.section.t)+'</b><span>'+(partial?'只替换选中文字，完整正文先保持不变。':'按要求生成完整候选稿，接受后才覆盖正文。')+'</span></div><button type="button" class="air-modal-close" id="airRevisionClose">×</button></div>'
    +'<div class="air-revision-body">'+preview+'<label>修改要求<textarea id="airRevisionInstruction" rows="4" placeholder="例如：压缩表达、加强论证、改为正式公文语气">'+(partial?'在保持事实和数字不变的前提下，使这段文字更准确、正式、简洁。':'')+'</textarea></label><div class="air-revision-output" id="airRevisionOutput"></div></div>'
    +'<div class="air-modal-actions"><button type="button" class="btn ghost" id="airRevisionCancel">取消</button><button type="button" class="btn" id="airRevisionSubmit">生成候选稿</button></div></div></div>');
  const modal=document.getElementById('airRevisionModal'),close=()=>modal.remove();
  document.getElementById('airRevisionClose').onclick=close;document.getElementById('airRevisionCancel').onclick=close;
  document.getElementById('airRevisionSubmit').onclick=()=>airRunRevision(cn,si,selected);document.getElementById('airRevisionInstruction').focus();
}
async function airRunRevision(cn,si,selected){
  const info=findChapterSection(cn,si),btn=document.getElementById('airRevisionSubmit'),input=document.getElementById('airRevisionInstruction'),out=document.getElementById('airRevisionOutput');
  if(!info||!btn||!input)return;const instruction=input.value.trim();if(!instruction){input.focus();return;}
  btn.disabled=true;btn.textContent='生成中…';if(out)out.textContent='AI正在形成候选稿…';
  try{
    let candidate;
    if(selected){
      const replacement=await reviseSectionExcerpt(info.chapter,info.section,selected,instruction,partial=>{if(out)out.textContent=partial;});
      const current=info.section.editedHtml?blocksToSource(info.section.editedHtml):(info.section.content||'');
      const merged=ProjectWorkflow.replaceSelectedText(current,selected,replacement);if(!merged.ok)throw new Error(merged.error);candidate=merged.text;
    }else candidate=await reviseSection(info.chapter,info.section,instruction,partial=>{if(out)out.textContent=partial;});
    ProjectWorkflow.setCandidate(info.section,candidate,(selected?'局部修改：':'整节修改：')+instruction);saveDraft();airSaveState();document.getElementById('airRevisionModal')?.remove();airRefreshSection(cn,si);
    try{fetch('/api/revlog',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders()),body:JSON.stringify({chapter:info.chapter.name,section:info.section.t,instruction,scope:selected?'selection':'section'})});}catch(e){}
  }catch(e){if(out)out.innerHTML='<span style="color:var(--seal-red)">修改失败：'+escapeHtml(e.message)+'</span>';btn.disabled=false;btn.textContent='生成候选稿';}
}
function airResolveRevision(cn,si,action){
  const info=findChapterSection(cn,si);if(!info||!window.ProjectWorkflow)return;
  if(action==='accept'){ProjectWorkflow.acceptCandidate(info.section);ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:'在AI可研预览接受AI修改'});}
  else if(action==='reject')ProjectWorkflow.rejectCandidate(info.section);
  else if(action==='undo'){if(!ProjectWorkflow.undoSection(info.section))return;ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:'在AI可研预览撤销修改'});}
  saveDraft();airSaveState();airRefreshSection(cn,si);
}
function airSectionMaterialState(chapter,section){
  if(!window.ReportLogicCore)return {rules:[],missing:[],ready:false};
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",rules=ReportLogicCore.match(type,chapter.name,section.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" ")}),ctx=airMaterialContext();
  const statuses=rules.map(rule=>ReportLogicCore.generationReadiness?ReportLogicCore.generationReadiness(rule,ctx):ReportLogicCore.requirementStatus(rule,ctx)),missing=[...new Set(statuses.flatMap(x=>x.missing||[]))];
  const criticalRules=rules.filter((rule,index)=>statuses[index]&&statuses[index].level==="critical"),frameworkRules=rules.filter((rule,index)=>statuses[index]&&statuses[index].level==="framework");
  return {rules,statuses,missing,criticalRules,frameworkRules,ready:!!rules.length&&!missing.length,level:criticalRules.length?"critical":frameworkRules.length?"framework":"ready"};
}
function airSectionMaterialHtml(chapter,section,si){
  const st=airSectionMaterialState(chapter,section),label={knowledge_base:"知识库检索",web_search:"网上检索",provider:"数据接口",calculation_engine:"测算引擎",manual_upload:"人工上传",derived_section:"其他章节",system_rule:"系统规则",unclassified:"确认材料来源"};
  const enhance=aiReportCanEnhanceLogic&&st.rules.length?'<button type="button" class="air-logic-enhance air-section-enhance" data-cn="'+chapter.cn+'" data-si="'+si+'">🛠 从本节成稿提炼增强规则</button>':'';
  if(st.ready)return '<div class="air-section-material ok"><b>✓ 本节依据已找到</b><span>测算或项目材料已经匹配，可据此生成并保留来源。</span>'+(enhance?'<div class="air-section-material-actions">'+enhance+'</div>':'')+'</div>';
  const needed=st.missing.map(x=>label[x]||x),sourcePool=st.level==="critical"?st.criticalRules:st.rules,sources=sourcePool.map(r=>String(r.requiredSources||"").trim()).filter(Boolean).slice(0,3).map(x=>x.length>120?x.slice(0,120)+"…":x);
  const css=st.level==="critical"?"missing":"pending",title=st.level==="critical"?"框架将先生成，以下关键依据待补":"可先生成通用框架，项目事实后续核实";
  const ids=escapeHtml(st.rules.map(r=>r.id).join(",")),required=escapeHtml(sources.join("；"));
  const upload='<button type="button" class="air-material-upload" data-rule-id="'+ids+'" data-chapter="'+escapeHtml(chapter.name)+'" data-section="'+escapeHtml(section.t)+'" data-cn="'+chapter.cn+'" data-si="'+si+'">＋ 上传材料并补强本节</button>';
  const web=st.missing.includes("web_search")?'<button type="button" class="air-web-search" data-rule-id="'+ids+'" data-chapter="'+escapeHtml(chapter.name)+'" data-section="'+escapeHtml(section.t)+'" data-required-sources="'+required+'">🌐 联网查找本节依据</button>':'';
  return '<div class="air-section-material '+css+'"><b>↳ '+title+'</b><span>'+(st.level==="critical"?'重要来源：'+escapeHtml(sources.join("；")||"与本节对应的批复、说明、表格或原始数据"):'待核实渠道：'+escapeHtml(needed.join("、")||"确认材料来源"))+'</span><div class="air-section-material-actions">'+web+upload+enhance+'</div></div>';
}
function airChapterMaterialLevel(chapter){const levels=chapter.sections.map(s=>airSectionMaterialState(chapter,s).level);return levels.includes("critical")?"missing":levels.includes("framework")?"pending":"ok";}
function airApplyDocMaterialStatuses(){
  chapters.filter(c=>c.checked).forEach(c=>{c.sections.forEach((s,si)=>{const el=document.querySelector('#sec_'+c.cn+'_'+si+' .air-section-material');if(el)el.outerHTML=airSectionMaterialHtml(c,s,si);});const dot=document.querySelector('.air-doc-outline .chip[data-cn="'+c.cn+'"] .air-material-dot');if(dot){const level=airChapterMaterialLevel(c);dot.className="air-material-dot "+level;dot.title=level==="ok"?"本章材料已确认齐全":level==="missing"?"本章有关键依据待补":"本章可先生成，部分来源待核实";}});
}
function airBuildDocPane(){
  const pane = document.getElementById("airDocPane");
  if(!pane) return;
  pane.classList.remove("empty");
  const active = chapters.filter(c=>c.checked);
  const totalSec = active.reduce((n,c)=>n+c.sections.length,0);
  const outline = active.map(c=>{const level=airChapterMaterialLevel(c);return '<span class="chip" data-cn="'+c.cn+'"><i class="air-material-dot '+level+'" title="'+(level==='ok'?'本章材料已确认齐全':level==='missing'?'本章有关键依据待补':'本章可先生成，部分来源待核实')+'"></i>'+c.cn+'·'+c.name+'</span>';}).join("");
  const body = active.map(c=>'<div class="chapter-block" id="block_'+c.cn+'"><h3><span class="cn">'+c.cn+'</span>'+c.name+'</h3>'
    + c.sections.map((s,si)=>{const ready=!!(s.content||s.editedHtml),content=ready?renderContent(airSectionDisplayContent(c,s)):'<span class="skel" style="width:94%"></span><span class="skel" style="width:99%"></span><span class="skel" style="width:70%"></span>';return '<div class="section-block '+(ready?'':'pending')+'" id="sec_'+c.cn+'_'+si+'" data-status="'+(ready?'done':'pending')+'"><h4>'+s.t+(s.numeric?' ⚠数据':'')+(ready?'<span class="done-stamp">已拟</span>':'')+'</h4>'+airSectionMaterialHtml(c,s,si)+(ready?airSectionToolsHtml(c,s,si):'')+'<div class="body">'+content+'</div>'+airCandidateHtml(c,s,si)+'</div>';}).join("")
    +'</div>').join("");
  pane.innerHTML = '<div class="air-doc-head"><button type="button" class="air-doc-close" title="收起预览">✕</button>'
    +'<div class="air-doc-title">'+escapeHtml(project.name||"未命名项目")+'</div>'
    +'<div class="air-doc-meta">'+escapeHtml(project.industry||"")+' · 共 '+active.length+' 章 / '+totalSec+' 个子标题</div></div>'
    +'<div class="air-doc-outline">'+outline+'</div>'
    +'<input type="file" id="airDocMaterialFile" accept=".txt,.md,.docx,.pdf,.xlsx,.xls,.csv" multiple hidden>'
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
function airSectionDisplayContent(chapter,section){
  const base=section.editedHtml&&typeof blocksToSource==="function"?blocksToSource(section.editedHtml):(section.content||"");
  if(!window.ReportLogicCore?.ensureMissingMarkers)return base;
  const state=airSectionMaterialState(chapter,section);
  return ReportLogicCore.ensureMissingMarkers(base,state.rules,airMaterialContext());
}
// 从首页/其它模块切回本模块时，如果本轮已经生成过内容（chapters里有正文），把预览面板重建为"已完成"态
async function airRestoreDocPaneIfNeeded(){
  if(!aiReportSuggested || !chapters.length) return;
  const hasContent = chapters.some(c=>c.sections.some(s=>s.content||s.editedHtml));
  if(!hasContent) return;
  if(window.ReportLogicCore){
    try{await ReportLogicCore.load(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent");}catch(e){}
  }
  airBuildDocPane();
  chapters.filter(c=>c.checked).forEach(c=>{
    c.sections.forEach((s,si)=>{
      const el = document.getElementById('sec_'+c.cn+'_'+si);
      if(!el || !(s.content||s.editedHtml)) return;
      el.dataset.status = "done";
      el.classList.remove("pending");
      airRenderCompletedSection(c,s,si);
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
  if(airStageAtLeast("generating")) return '<div class="air-card air-step-done"><b>✓ 已进入可研生成阶段</b><span>请查看当前生成进度或右侧报告预览；已完成的小节可立即重写、AI修改或拖选局部修改。</span></div>';
  const logic=window.ReportLogicCore?ReportLogicCore.overview(calcType||(calcResult&&calcResult.__ctype)||rptCtype):null;
  return '<div class="air-card">'+(logic?'<div class="air-step-done" style="margin-bottom:10px;"><b>✓ 已接入公司逐小节生成逻辑 v'+logic.version+'</b><span>'+logic.chapterCount+'章 / '+logic.ruleCount+'项；生成、材料提示和复核共用同一规则ID。</span></div>':'')
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;">'+(logic?'<button class="btn" id="airCheckMaterials">先检查'+logic.chapterCount+'章所需材料 →</button><button class="btn ghost air-start-gen">资料暂缺，带缺口标记生成</button>':'<button class="btn air-start-gen">确认，开始可研生成 →</button>')+'</div>'
    +'<div style="margin-top:8px; font-size:11.5px; color:var(--ink-soft);">建议先检查材料完整性。知识库、网上检索、数据接口和测算结果由系统尽量补齐；必须人工提供的资料会按章列出。即使继续生成，缺失处也只会标“待补”，不会编造。</div></div>';
}

function airOpenCalcDetails(){
  if(!calcParams||!calcResult){alert("当前还没有可查看的测算结果。");return;}
  scParams=Object.assign({},calcParams);scResult=calcResult;calcType=(aiReportSuggested&&aiReportSuggested.calcType)||(calcResult&&calcResult.__ctype)||calcType;scStep=2;
  airSaveState();try{sessionStorage.setItem("studyreport:calc-return-aireport:v1","1");}catch(e){}
  appMode="calc";renderTOC();renderSheet();
}

function airMaterialContext(){
  const evidenceByRule={};
  (Array.isArray(kbEntries)?kbEntries:[]).forEach(entry=>{
    const ids=Array.isArray(entry.ruleIds)?entry.ruleIds:[];
    ids.forEach(id=>{
      if(!evidenceByRule[id])evidenceByRule[id]=[];
      evidenceByRule[id].push({kind:"all",title:entry.title||entry.fileName||"项目上传材料",source:"project_upload"});
    });
  });
  const web=window.WebResearch?.materialContext?.()||{hasWebEvidence:false,evidenceByRule:{}};
  Object.entries(web.evidenceByRule||{}).forEach(([id,rows])=>{if(!evidenceByRule[id])evidenceByRule[id]=[];evidenceByRule[id].push(...rows);});
  return {hasKnowledge:false,hasWebEvidence:!!web.hasWebEvidence,hasProviderData:false,hasManualMaterial:false,hasCalculation:!!(calcParams&&calcResult),hasDerivedSection:chapters.some(c=>c.sections.some(s=>!!(s.content||s.editedHtml))),evidenceByRule};
}
async function airCheckWholeReportMaterials(){
  if(!window.ReportLogicCore)return airPush({role:"assistant",kind:"text",content:"逐小节生成逻辑模块未加载，暂时无法检查材料。"});
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent";await ReportLogicCore.load(type);
  const inventory=ReportLogicCore.materialInventory(type,airMaterialContext());
  if(!inventory.total)return airPush({role:"assistant",kind:"text",content:"当前项目类型还没有已发布的逐小节生成逻辑，可先按原流程生成。"});
  aiReportChat=aiReportChat.filter(m=>m.kind!=="materialCheck");airPush({role:"assistant",kind:"materialCheck",inventory});airSaveState();
}
function airMaterialCheckHtml(m){
  const inv=m.inventory||{summary:{},chapters:[]},sum=inv.summary||{},labels={knowledge_base:"知识库检索",web_search:"网上检索",provider:"数据接口",calculation_engine:"测算引擎",manual_upload:"人工上传",derived_section:"其他章节",system_rule:"系统规则",unclassified:"来源待确认"};
  const batch=window.WebResearch?.batchStatus?.(),batchLabel=batch?(batch.status==="completed"?"🌐 查看批量检索结果（"+batch.done+"/"+batch.total+"）":batch.status==="paused"?"🌐 批量检索已暂停（"+batch.done+"/"+batch.total+"）":"🌐 查看批量检索进度（"+batch.done+"/"+batch.total+"）"):"🌐 自动批量检索全部网上缺口（"+(sum.pendingWeb||0)+"）";
  const stat=(num,label,color)=>'<div style="border:1px solid var(--line);border-radius:8px;padding:9px 11px;background:#fff;"><b style="display:block;font-size:18px;color:'+color+';">'+(num||0)+'</b><span style="font-size:11px;color:var(--ink-soft);">'+label+'</span></div>';
  const rowHtml=item=>{const status=item.ready?'<span style="color:var(--ok-green);">✓ 已确认找到</span>':'<span style="color:var(--red);">● 待补充/待检索</span>';const kinds=(item.sourceKinds||[]).length?item.sourceKinds:["unclassified"];const channels=kinds.map(kind=>'<span style="display:inline-block;border:1px solid '+(item.missing.includes(kind)?'#e6a5a0':'#b7ddc6')+';background:'+(item.missing.includes(kind)?'#fff0ef':'#edf8f1')+';color:'+(item.missing.includes(kind)?'var(--red)':'var(--ok-green)')+';padding:1px 5px;border-radius:8px;margin:1px;font-size:10.5px;">'+escapeHtml(labels[kind]||kind)+'</span>').join("");const web=item.missing.includes("web_search")?'<button type="button" class="air-web-search" data-rule-id="'+escapeHtml(item.ruleId)+'" data-chapter="'+escapeHtml(item.chapter)+'" data-section="'+escapeHtml(item.section||item.title)+'" data-required-sources="'+escapeHtml(item.requiredSources)+'">🌐 联网查找</button>':'';return '<tr><td style="white-space:nowrap;">第'+item.sourceNo+'项</td><td><b>'+escapeHtml(item.title)+'</b><div style="color:var(--ink-soft);margin-top:3px;white-space:pre-line;">'+escapeHtml(item.requiredSources)+'</div></td><td>'+channels+'</td><td><div class="air-material-row-actions">'+status+(item.blocking?'<span style="font-size:10px;color:var(--red);">重要阻断</span>':'')+web+'<button type="button" class="air-material-upload" data-rule-id="'+escapeHtml(item.ruleId)+'" data-chapter="'+escapeHtml(item.chapter)+'" data-section="'+escapeHtml(item.section||item.title)+'">＋ 上传补充</button></div></td></tr>';};
  return '<div class="air-card"><div class="air-step-done" style="margin-bottom:10px;"><b>材料完整性台账 · 逻辑 v'+inv.version+'</b><span>共'+inv.total+'项、'+inv.chapters.length+'章。以下来源数量允许交叉，例如同一小节可能同时需要知识库和人工材料。</span></div>'
    +(aiReportCanEnhanceLogic?'<div class="air-enhance-entry-tip"><b>管理员增强模式已开启</b><span>请先生成右侧正文并持续修改；定稿后从对应小节点击“从本节成稿提炼增强规则”，AI会比较版本并交由管理员审定。</span></div>':'')
    +'<div style="display:grid;grid-template-columns:repeat(7,minmax(86px,1fr));gap:7px;margin-bottom:10px;">'+stat(sum.ready,"已确认找到","var(--ok-green)")+stat(sum.system_rule,"系统规则直接生成","var(--bp)")+stat(sum.pendingKnowledge,"需从知识库检索","var(--red)")+stat(sum.pendingWeb,"需网上检索","var(--red)")+stat(sum.pendingProvider,"需调用数据接口","var(--red)")+stat(sum.pendingCalculation,"需从测算引擎取得","var(--red)")+stat(sum.pendingManual,"需人工上传","var(--red)")+'</div>'
    +'<div style="display:flex;gap:7px;margin-bottom:8px;flex-wrap:wrap;"><button type="button" class="btn sm ghost" id="airMaterialExpandAll">展开全部</button><button type="button" class="btn sm ghost" id="airMaterialCollapseAll">收起全部</button><button type="button" class="btn sm ghost air-material-ask" data-prompt="请把全报告'+inv.total+'项材料需求按章节列成完整Markdown表格，列出序号、材料名称、获取渠道、当前状态和是否阻断，不要省略。">让AI列完整材料表</button><button type="button" class="btn sm air-batch-web-search" id="airBatchWebSearch" '+(sum.pendingWeb||batch?'':'disabled')+'>'+batchLabel+'</button><button type="button" class="btn sm air-batch-material-upload" id="airBatchMaterialUpload">＋ 批量上传材料</button></div>'
    +'<div style="max-height:470px;overflow:auto;border:1px solid var(--line);border-radius:8px;">'+inv.chapters.map(g=>'<details class="air-material-chapter" style="border-bottom:1px solid var(--line);"><summary style="cursor:pointer;padding:11px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><b style="min-width:210px;">'+escapeHtml(g.chapter)+'</b><span style="color:var(--ok-green);">已找到 '+g.counts.ready+'/'+g.total+'</span><span style="color:var(--red);">需知识库检索 '+g.counts.pendingKnowledge+'</span><span style="color:var(--red);">需网搜 '+g.counts.pendingWeb+'</span><span style="color:var(--red);">需接口 '+g.counts.pendingProvider+'</span><span style="color:var(--red);">需测算 '+g.counts.pendingCalculation+'</span><span style="color:var(--red);">需上传 '+g.counts.pendingManual+'</span></summary><div style="padding:0 10px 11px;"><table class="air-material-table" style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="text-align:left;background:#f5f8fb;"><th style="padding:7px;">序号</th><th style="padding:7px;">具体需要的内容/材料</th><th style="padding:7px;">获取渠道</th><th style="padding:7px;min-width:150px;">当前状态/补充</th></tr></thead><tbody>'+g.items.map(rowHtml).join("")+'</tbody></table><button type="button" class="btn sm ghost air-material-ask" style="margin-top:8px;" data-prompt="请把'+escapeHtml(g.chapter)+'全部材料需求列成表格，并告诉我应该先补哪几项。">询问本章补充顺序</button></div></details>').join("")+'</div>'
    +'<input type="file" id="airMaterialFile" accept=".txt,.md,.docx,.pdf,.xlsx,.xls,.csv" multiple hidden>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><button class="btn air-start-gen">先联网检索并集中确认 →</button><button class="btn" id="airBackgroundSearchGenerate">后台检索并立即开始可研生成 →</button><button class="btn ghost air-material-ask" data-prompt="请按重要程度汇总全报告必须由我人工补充的材料清单，并列成表格">仅汇总人工材料</button></div><div style="font-size:11.5px;color:var(--ink-soft);margin-top:8px;">“先联网检索”会等待你集中采用依据后再生成；“后台检索并立即生成”会让联网任务继续运行，同时先按现有资料起草可研，完成后可回到批量检索采用高价值来源并更新受影响章节。上传材料只关联你选择的逻辑项。</div></div>';
}

function airRefreshMaterialInventory(){
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",card=aiReportChat.find(m=>m.kind==="materialCheck");
  if(card)card.inventory=ReportLogicCore.materialInventory(type,airMaterialContext());
  renderAiReportMsgs();airApplyDocMaterialStatuses();airSaveState();
}
function airUpdateBatchWebButton(status){
  const button=document.getElementById("airBatchWebSearch");if(!button||!status)return;
  button.disabled=false;button.textContent=status.status==="completed"?"🌐 查看批量检索结果（"+status.done+"/"+status.total+"）":status.status==="paused"?"🌐 批量检索已暂停（"+status.done+"/"+status.total+"）":"🌐 查看批量检索进度（"+status.done+"/"+status.total+"）";
}
async function airBatchWebPreflight(continueAfter,backgroundImmediately){
  if(!window.WebResearch?.batchSearchGaps)return alert("批量联网检索模块未加载，请刷新页面后重试");
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",inventory=ReportLogicCore.materialInventory(type,airMaterialContext());
  try{
    await window.WebResearch.batchSearchGaps(inventory.items,{continueAfter:!!continueAfter&&!backgroundImmediately,openReview:!backgroundImmediately,onProgress:airUpdateBatchWebButton,onAdopt:airRefreshMaterialInventory,onContinue:()=>aiReportStartGenerate()});
    if(backgroundImmediately)await aiReportStartGenerate();
  }
  catch(error){alert("批量联网检索未完成："+error.message);}
}

async function airParseProjectMaterial(file){
  const lower=String(file.name||"").toLowerCase();let text="";
  if(/\.(txt|md)$/.test(lower)) text=await file.text();
  else if(lower.endsWith(".docx")){
    if(!window.mammoth)await loadScript("mammoth.min.js");
    text=(await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value||"";
  }else if(lower.endsWith(".pdf")){
    if(!window.pdfjsLib)await loadScript("pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc="pdf.worker.min.js";
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise,parts=[];
    for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),tc=await page.getTextContent();parts.push("[第"+p+"页]\n"+tc.items.map(x=>x.str).join(" "));}
    text=parts.join("\n\n");
  }else if(/\.(xlsx|xls|csv)$/.test(lower)){
    if(!window.XLSX)await loadScript("xlsx.full.min.js");
    const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array",cellFormula:true,cellDates:true});
    text=wb.SheetNames.map(name=>"[工作表 "+name+"]\n"+window.XLSX.utils.sheet_to_csv(wb.Sheets[name])).join("\n\n");
  }else throw new Error("暂不支持该格式，请上传 Word、PDF、Excel、CSV、TXT 或 Markdown");
  text=String(text||"").replace(/\n{4,}/g,"\n\n").trim();
  if(!text)throw new Error("未提取到文字；若为扫描件PDF，请先OCR后上传");
  return text.slice(0,80000)+(text.length>80000?"\n…（超长材料已保留前8万字）":"");
}
function airOpenMaterialUpload(button){
  aiReportMaterialTarget={ruleIds:String(button.dataset.ruleId||"").split(",").filter(Boolean),chapter:button.dataset.chapter||"",section:button.dataset.section||"",cn:button.dataset.cn||"",si:button.dataset.si===""||button.dataset.si==null?null:+button.dataset.si};
  const input=document.getElementById("airMaterialFile")||document.getElementById("airDocMaterialFile");
  if(input){input.value="";input.click();}
}
async function airHandleMaterialFiles(files){
  const target=aiReportMaterialTarget;if(!target||!files||!files.length)return;
  const loading=airPushLoading("正在本地解析材料并关联到“"+(target.section||target.chapter||"所选逻辑项")+"”…");
  try{
    for(const file of files){
      const text=await airParseProjectMaterial(file),title=String(file.name||"项目补充材料").replace(/\.[^.]+$/,"");
      kbEntries.push({title,content:text,fileName:file.name,sourceType:"project_upload",ruleIds:[...target.ruleIds],chapter:target.chapter,section:target.section,uploadedAt:Date.now()});
    }
    saveDraft();
    const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent";
    const inv=ReportLogicCore.materialInventory(type,airMaterialContext()),card=aiReportChat.find(m=>m.kind==="materialCheck");
    if(card)card.inventory=inv;
    airResolve(loading,{kind:"text",content:"✓ 已上传并关联 "+files.length+" 份材料到“"+(target.section||target.chapter||"所选逻辑项")+"”。对应缺口已重新核验；绿色表示已找到，其他红色来源仍需补充。"});
    renderAiReportMsgs();airApplyDocMaterialStatuses();airSaveState();
    if(target.cn&&target.si!==null){
      const info=findChapterSection(target.cn,target.si);
      if(info&&info.section.content){
        const rerun=airPushLoading("新材料已到位，正在只补写受影响小节“"+info.section.t+"”…");
        await airDriveSectionGen(info.chapter,info.section,target.si,{clearFirst:true,failLabel:"材料补写失败",onDone:()=>{saveDraft();airResolve(rerun,{kind:"text",content:"✓ “"+info.section.t+"”已根据新上传材料实时补写完成。"});},onFail:()=>airResolve(rerun,{kind:"text",content:"材料已保存，但“"+info.section.t+"”自动补写失败；可在右侧点击重试，材料不会丢失。"})});
      }
    }
  }catch(error){airResolve(loading,{kind:"text",content:"材料补充失败："+error.message});}
}

/* 批量材料先解析、再由用户确认每份文件对应哪些逻辑项。未经确认不写入资料库，
   避免把一份材料误判成当前项目类型的全部逻辑项均已具备。 */
async function airPrepareBatchMaterialFiles(files){
  if(!files||!files.length)return;
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent";
  await ReportLogicCore.load(type);
  const loading=airPushLoading("正在本地解析 "+files.length+" 份材料，并智能建议对应小节…");
  try{
    aiReportBatchFiles=[];
    for(const file of files){
      const content=await airParseProjectMaterial(file);
      aiReportBatchFiles.push({fileName:file.name,title:String(file.name||"项目补充材料").replace(/\.[^.]+$/,""),content,
        suggestions:ReportLogicCore.suggestMaterialRuleLinks(type,file.name,content,8)});
    }
    airResolve(loading,{kind:"text",content:"✓ 已解析 "+aiReportBatchFiles.length+" 份材料。请在弹窗中确认每份文件对应的小节后再入库；系统不会自动把它们判定为全报告材料。"});
    airShowBatchMaterialModal(type);
  }catch(error){airResolve(loading,{kind:"text",content:"批量材料解析失败："+error.message});}
}
function airShowBatchMaterialModal(type){
  document.getElementById("airBatchMaterialModal")?.remove();
  const rules=(ReportLogicCore.current(type)?.data?.rules)||[],ruleById=Object.fromEntries(rules.map(rule=>[rule.id,rule]));
  const rows=aiReportBatchFiles.map((entry,index)=>{
    const suggestedIds=new Set((entry.suggestions||[]).map(x=>x.ruleId)),ordered=[...(entry.suggestions||[]).map(x=>ruleById[x.ruleId]).filter(Boolean),...rules.filter(x=>!suggestedIds.has(x.id))];
    const options=['<option value="">仅存入项目资料，不标记具体小节</option>'].concat(ordered.map((rule,pos)=>'<option value="'+escapeHtml(rule.id)+'" '+(pos===0&&suggestedIds.has(rule.id)?'selected':'')+'>'+escapeHtml((suggestedIds.has(rule.id)?'★ 建议｜':'')+'第'+rule.sourceNo+'项｜'+rule.chapter+'｜'+(rule.displayTitle||rule.section))+'</option>')).join("");
    return '<div class="air-batch-file"><div><b>'+escapeHtml(entry.fileName)+'</b><span>已提取 '+entry.content.length.toLocaleString("zh-CN")+' 字</span></div><label>关联逻辑项（可按 Ctrl/Shift 多选）</label><select class="air-batch-rule-select" data-index="'+index+'" multiple size="5">'+options+'</select></div>';
  }).join("");
  const modal=document.createElement("div");modal.id="airBatchMaterialModal";modal.className="air-modal-overlay";
  modal.innerHTML='<div class="air-modal-card air-batch-modal"><div class="air-modal-head"><div><b>批量上传材料 · 确认小节映射</b><span>智能匹配只是建议；确认后才写入项目资料并更新绿色/红色状态。</span></div><button type="button" class="air-modal-close" aria-label="关闭">×</button></div><div class="air-batch-list">'+rows+'</div><div class="air-modal-actions"><button type="button" class="btn ghost air-modal-close">取消</button><button type="button" class="btn" id="airCommitBatchMaterials">确认映射并入库</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelectorAll(".air-modal-close").forEach(button=>button.onclick=()=>modal.remove());
  document.getElementById("airCommitBatchMaterials").onclick=()=>airCommitBatchMaterials(type);
}
function airCommitBatchMaterials(type){
  const modal=document.getElementById("airBatchMaterialModal");if(!modal)return;
  const rules=(ReportLogicCore.current(type)?.data?.rules)||[],ruleById=Object.fromEntries(rules.map(rule=>[rule.id,rule]));let linked=0;
  modal.querySelectorAll(".air-batch-rule-select").forEach(select=>{
    const entry=aiReportBatchFiles[+select.dataset.index];if(!entry)return;
    const ruleIds=[...select.selectedOptions].map(x=>x.value).filter(Boolean),first=ruleById[ruleIds[0]];
    kbEntries.push({title:entry.title,content:entry.content,fileName:entry.fileName,sourceType:"project_upload",ruleIds,
      chapter:first?.chapter||"",section:first?.section||"",uploadedAt:Date.now()});
    linked+=ruleIds.length;
  });
  modal.remove();aiReportBatchFiles=[];saveDraft();
  const inventory=ReportLogicCore.materialInventory(type,airMaterialContext()),card=aiReportChat.find(m=>m.kind==="materialCheck");if(card)card.inventory=inventory;
  airPush({role:"assistant",kind:"text",content:"✓ 批量材料已入库：共 "+modal.querySelectorAll(".air-batch-rule-select").length+" 份文件，确认关联 "+linked+" 个逻辑项。台账已重新核验；未关联的小节仍保持待补状态。"});
  airApplyDocMaterialStatuses();airSaveState();
}

function airAdminLogicHeaders(adminPass){return Object.assign({"Content-Type":"application/json"},authHeaders(),adminPass?{"x-admin-pass":adminPass}:{});}
async function airCheckAdminLogicCapability(){
  if(aiReportCanEnhanceLogic)return;
  try{
    const response=await fetch("/api/reportlogic",{method:"POST",headers:airAdminLogicHeaders(),body:JSON.stringify({action:"adminCapability"})}),data=await response.json();
    if(data.ok&&data.isAdmin){aiReportCanEnhanceLogic=true;renderAiReportMsgs();airApplyDocMaterialStatuses();}
  }catch(_){/* 普通用户或离线时不显示管理员入口，不影响可研生成 */}
}
function airEnhancementCandidate(base){return {requiredSources:"",sourceKinds:[...(base.sourceKinds||[])],writingLogic:"",outputForm:base.outputForm||"",missingPolicy:base.missingPolicy||"资料缺失时标注待补，不得虚构",changeReason:""};}
function airSectionRevisionContext(info){
  const snapshots=(projectWorkflow&&Array.isArray(projectWorkflow.reportVersions)?projectWorkflow.reportVersions:[]).map(version=>{
    const chapter=(version.chapters||[]).find(item=>String(item.cn)===String(info.chapter.cn));
    const section=chapter&&(chapter.sections||[]).find((item,index)=>index===info.si||item.t===info.section.t);
    if(!section)return null;
    const content=section.editedHtml?(typeof blocksToSource==="function"?blocksToSource(section.editedHtml):section.editedHtml):(section.content||"");
    return content?{version:version.version,reason:version.reason||"报告版本",content}:null;
  }).filter(Boolean);
  const current=info.section.editedHtml?(typeof blocksToSource==="function"?blocksToSource(info.section.editedHtml):info.section.editedHtml):(info.section.content||"");
  const unique=[];snapshots.concat(current?[{version:"当前",reason:"当前成稿",content:current}]:[]).forEach(item=>{if(item.content&&!unique.some(x=>x.content===item.content))unique.push(item);});
  return {chapter:info.chapter.name,section:info.section.t,versions:unique,first:unique[0]?.content||current,current:current||unique[unique.length-1]?.content||""};
}
function airOpenSectionLogicEnhancement(cn,si){
  const info=findChapterSection(cn,si);if(!info)return alert("未找到该小节，请刷新后重试");
  const st=airSectionMaterialState(info.chapter,info.section),base=st.rules[0];if(!base)return alert("本节尚未匹配已发布的生成规则");
  aiReportLogicEnhanceState={type:calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",base,candidate:airEnhancementCandidate(base),history:[],busy:false,sectionContext:airSectionRevisionContext({chapter:info.chapter,section:info.section,si})};airRenderLogicEnhancementModal();
}
function airOpenLogicEnhancement(ruleId){
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",base=(ReportLogicCore.current(type)?.data?.rules||[]).find(rule=>rule.id===ruleId);if(!base)return alert("未找到该逻辑项，请刷新后重试");
  aiReportLogicEnhanceState={type,base,candidate:airEnhancementCandidate(base),history:[],busy:false};airRenderLogicEnhancementModal();
}
function airRenderLogicEnhancementModal(){
  const state=aiReportLogicEnhanceState;if(!state)return;document.getElementById("airLogicEnhanceModal")?.remove();const base=state.base,c=state.candidate;
  const modal=document.createElement("div");modal.id="airLogicEnhanceModal";modal.className="air-modal-overlay";
  const sc=state.sectionContext,revisionBlock=sc?'<details open><summary>本节成稿演进（'+sc.versions.length+'个有效版本）</summary><div class="air-enhance-base"><b>第一版</b><p>'+escapeHtml((sc.first||"尚无第一版正文").slice(0,1800))+'</p><b>当前定稿</b><p>'+escapeHtml((sc.current||"尚无当前正文").slice(0,1800))+'</p></div></details>':'';
  modal.innerHTML='<div class="air-modal-card air-enhance-modal"><div class="air-modal-head"><div><b>管理员审定本节增强 · 第'+base.sourceNo+'项</b><span>'+escapeHtml(base.chapter+'｜'+(base.displayTitle||base.section))+'</span></div><button type="button" class="air-modal-close">×</button></div>'
    +'<div class="air-enhance-guard">本次操作只会在原规则后追加“增强子规则”并发布新版本，不删除、不覆盖原有逻辑。</div>'
    +revisionBlock
    +'<details open><summary>查看现行基础逻辑</summary><div class="air-enhance-base"><b>现有所需材料</b><p>'+escapeHtml(base.requiredSources||"未指定")+'</p><b>现有写作逻辑</b><p>'+escapeHtml(base.writingLogic||"未指定")+'</p></div></details>'
    +'<div class="air-enhance-grid"><label>新增/细化的数据与材料来源<textarea id="airEnhanceSources" rows="4" placeholder="只写需要追加的内容，不必重复原规则">'+escapeHtml(c.requiredSources)+'</textarea></label><label>新增/细化的生成逻辑<textarea id="airEnhanceWriting" rows="4" placeholder="说明怎样核验、引用、分析和输出">'+escapeHtml(c.writingLogic)+'</textarea></label><label>来源渠道（逗号分隔）<input id="airEnhanceKinds" value="'+escapeHtml((c.sourceKinds||[]).join(","))+'"></label><label>输出形式<input id="airEnhanceOutput" value="'+escapeHtml(c.outputForm||"")+'"></label><label class="wide">缺失材料时的处理<input id="airEnhanceMissing" value="'+escapeHtml(c.missingPolicy||"")+'"></label><label class="wide">本次增强原因<input id="airEnhanceReason" value="'+escapeHtml(c.changeReason||"")+'" placeholder="例如：细化规划批复来源和指标勾稽方式"></label></div>'
    +'<div class="air-enhance-chat">'+(state.history.length?state.history.map(x=>'<div><b>'+escapeHtml(x.role==='user'?'管理员':'AI建议')+'：</b>'+escapeHtml(x.content)+'</div>').join(""):'<div class="muted">AI会比较本节第一版与当前成稿，提炼新增的材料要求、论证方法和输出方式；候选仍可人工增减，确认后才发布。</div>')+'</div>'
    +'<textarea id="airEnhanceInstruction" rows="2" placeholder="可补充你的判断；留空则由AI自动比较第一版与当前成稿并汇总增强经验"></textarea>'
    +'<div class="air-modal-actions"><button type="button" class="btn ghost air-modal-close">取消</button><button type="button" class="btn ghost" id="airAskEnhancement" '+(state.busy?'disabled':'')+'>AI汇总本节增强经验</button><button type="button" class="btn" id="airPublishEnhancement" '+(state.busy?'disabled':'')+'>管理员审定并追加发布</button></div></div>';
  document.body.appendChild(modal);modal.querySelectorAll(".air-modal-close").forEach(button=>button.onclick=()=>{modal.remove();aiReportLogicEnhanceState=null;});
  document.getElementById("airAskEnhancement").onclick=airAskLogicEnhancement;document.getElementById("airPublishEnhancement").onclick=airPublishLogicEnhancement;
}
function airReadEnhancementFields(){
  const s=id=>document.getElementById(id);return {requiredSources:s("airEnhanceSources")?.value.trim()||"",writingLogic:s("airEnhanceWriting")?.value.trim()||"",
    sourceKinds:(s("airEnhanceKinds")?.value||"").split(/[,，]/).map(x=>x.trim()).filter(Boolean),outputForm:s("airEnhanceOutput")?.value.trim()||"",missingPolicy:s("airEnhanceMissing")?.value.trim()||"",changeReason:s("airEnhanceReason")?.value.trim()||""};
}
function airParseEnhancementJson(text){const cleaned=String(text||"").replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""),start=cleaned.indexOf("{"),end=cleaned.lastIndexOf("}");if(start<0||end<start)throw new Error("AI未返回可识别的JSON候选");return JSON.parse(cleaned.slice(start,end+1));}
async function airAskLogicEnhancement(){
  const state=aiReportLogicEnhanceState;if(!state||state.busy)return;const instruction=(document.getElementById("airEnhanceInstruction")?.value||"").trim()||(state.sectionContext?"请比较第一版与当前成稿，自动提炼本节可复用的增量材料要求、生成方法和输出结构。":"请在保留原规则的前提下，细化材料来源、核验方法和生成逻辑。");
  state.candidate=airReadEnhancementFields();state.history.push({role:"user",content:instruction});state.busy=true;airRenderLogicEnhancementModal();
  try{
    const answer=await callGen("你是保障房可研逐小节规则工程师。只输出JSON对象，字段为requiredSources、sourceKinds数组、writingLogic、outputForm、missingPolicy、changeReason。只能提炼第一版到当前成稿之间真正新增且可复用的经验，并在原规则基础上补充增强；不得把某个项目的专属数值写成通用规则，不得删除、替换或弱化原逻辑。材料来源要细到文件名、数据字段、统计期、版本和核验方法。","原规则：\n"+JSON.stringify(state.base)+"\n\n本节成稿演进：\n"+JSON.stringify(state.sectionContext||{})+"\n\n当前候选：\n"+JSON.stringify(state.candidate)+"\n\n管理员要求：\n"+instruction);
    const next=airParseEnhancementJson(answer);state.candidate=Object.assign({},state.candidate,next,{sourceKinds:Array.isArray(next.sourceKinds)?next.sourceKinds:state.candidate.sourceKinds});state.history.push({role:"assistant",content:"已形成一版增强候选，可继续修改或确认发布。"});
  }catch(error){state.history.push({role:"assistant",content:"本轮完善失败："+error.message});}finally{state.busy=false;airRenderLogicEnhancementModal();}
}
async function airPublishLogicEnhancement(){
  const state=aiReportLogicEnhanceState;if(!state||state.busy)return;const enhancement=airReadEnhancementFields();if(!enhancement.requiredSources&&!enhancement.writingLogic)return alert("至少补充一项材料来源或写作逻辑");
  const adminPass=prompt("请输入后台管理员密码以发布增强版本（密码只用于本次请求）：");if(adminPass===null)return;
  state.candidate=enhancement;state.busy=true;airRenderLogicEnhancementModal();
  try{
    const response=await fetch("/api/reportlogic",{method:"POST",headers:airAdminLogicHeaders(adminPass),body:JSON.stringify({action:"appendEnhancement",projectType:state.type,baseRuleId:state.base.id,enhancement})}),data=await response.json();
    if(!data.ok)throw new Error(data.error||"发布失败");
    document.getElementById("airLogicEnhanceModal")?.remove();aiReportLogicEnhanceState=null;await ReportLogicCore.load(state.type,true);await airCheckWholeReportMaterials();
    airPush({role:"assistant",kind:"text",content:"✓ 已保留第"+state.base.sourceNo+"项原逻辑，并追加一条增强子规则，发布为生成逻辑 v"+data.set.version+"。下一次生成或补写相关小节时会自动采用增强内容。"});
  }catch(error){state.busy=false;airRenderLogicEnhancementModal();alert("增强规则发布失败："+error.message);}
}
function airWantsFullMaterialTable(text){return /(?:全报告|全部|完整|\d+项).*(?:材料|资料).*(?:表|清单)|(?:材料|资料).*(?:全报告|全部|完整|\d+项).*(?:表|清单)/.test(String(text||""));}
async function airFullMaterialTableMarkdown(){
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent";await ReportLogicCore.load(type);const inv=ReportLogicCore.materialInventory(type,airMaterialContext()),labels={knowledge_base:"需知识库检索",web_search:"需网上检索",provider:"需数据接口取得",calculation_engine:"需测算引擎取得",manual_upload:"需人工上传",derived_section:"需引用其他章节",system_rule:"系统规则自动填入",unclassified:"需确认来源"},cell=value=>String(value||"").replace(/\|/g,"｜").replace(/\r?\n/g,"；");
  const rows=inv.items.map(item=>"|"+[item.sourceNo,cell(item.chapter),cell(item.title),cell(item.requiredSources),((item.sourceKinds||[]).length?item.sourceKinds:["unclassified"]).map(x=>labels[x]||x).join("、"),item.ready?"已确认找到":"待补充/待检索",item.blocking?"是":"否"].join("|")+"|").join("\n");
  return "已按当前发布的逐小节逻辑 v"+inv.version+"列出全报告 "+inv.total+" 项材料台账（不省略）：\n\n|序号|章节|逻辑项|具体材料/数据|所需动作|当前状态|重要阻断|\n|---:|---|---|---|---|---|---|\n"+rows+"\n\n说明：‘需检索’只表示获取路径，不代表知识库或网络一定能找到；只有已取得并关联到具体规则的真实材料才显示‘已确认找到’。";
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
    +'<button type="button" class="air-prompt" data-prompt="项目背景这一节应该按什么逻辑写？需要什么输出形式？">查看小节生成逻辑</button>'
    +'<button type="button" class="air-prompt" data-prompt="项目背景这一节目前还缺哪些材料？请区分可自动检索和必须人工上传的内容">检查小节材料缺口</button>'
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
  const backButton=document.getElementById("airBackStepBtn");
  if(backButton)backButton.disabled=!(window.ProjectWorkflow&&ProjectWorkflow.previousAiReportStage(airCurrentStage()));
  box.innerHTML = aiReportChat.map(m=>{
    // 类型标签：彩色小胶囊，不套用普通消息气泡（不带"AI："前缀，不是在冒充一句对话）
    if(m.kind==="typeTag"){
      return '<div class="air-typetag-row"><span class="air-typetag air-typetag-'+m.calcType+'">✓ 已选择测算类型：'+escapeHtml(m.content)+'</span></div>';
    }
    let body;
    if(m.kind==="infoCard") body = airInfoCardHtml();
    else if(m.kind==="locationCard") body = airLocationCardHtml(m);
    else if(m.kind==="confirmCard") body = airConfirmCardHtml();
    else if(m.kind==="genConfirm") body = airGenConfirmHtml();
    else if(m.kind==="materialCheck") body = airMaterialCheckHtml(m);
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
  if(s("airConfirmLocation")) s("airConfirmLocation").onclick = airConfirmLocation;
  if(s("airSkipLocation")) s("airSkipLocation").onclick = airSkipLocation;
  if(s("airLocationSearchAgain")){
    const run=()=>airSearchLocationCandidates(String(s("airLocationRetryInput")?.value||"").trim());
    s("airLocationSearchAgain").onclick=run;
    if(s("airLocationRetryInput"))s("airLocationRetryInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();run();}};
  }
  if(s("airRetryLocation")) s("airRetryLocation").onclick = ()=>{aiReportLocationCandidates=[];aiReportLocationConfirmed=null;aiReportChat=aiReportChat.filter(m=>m.kind!=="locationCard");renderAiReportMsgs();airSaveState();};
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
  document.querySelectorAll(".air-start-gen").forEach(button=>button.onclick=()=>airBatchWebPreflight(true));
  if(s("airBackgroundSearchGenerate"))s("airBackgroundSearchGenerate").onclick=()=>airBatchWebPreflight(false,true);
  if(s("airCheckMaterials")) s("airCheckMaterials").onclick = airCheckWholeReportMaterials;
  document.querySelectorAll(".air-open-calc-details").forEach(button=>button.onclick=airOpenCalcDetails);
  if(s("airApplyCalc"))s("airApplyCalc").onclick=airApplyCalcPreview;
  if(s("airRejectCalc"))s("airRejectCalc").onclick=()=>{aiReportPendingCalcChange=null;aiReportChat=aiReportChat.filter(m=>m.kind!=="calcPreview");airPush({role:"assistant",kind:"text",content:"已取消本次参数修改，当前正式测算和报告没有变化。"});airSaveState();};
  document.querySelectorAll(".air-act").forEach(b=>{ b.onclick = ()=>airDeliverAction(b.dataset.act); });
  document.querySelectorAll(".air-prompt").forEach(b=>{b.onclick=()=>{const inp=s("airInput");if(!inp)return;inp.value=b.dataset.prompt||"";airAutosize(inp);inp.focus();}});
  document.querySelectorAll(".air-material-ask").forEach(b=>{b.onclick=()=>{const inp=s("airInput");if(!inp)return;inp.value=b.dataset.prompt||"";airAutosize(inp);inp.focus();}});
  if(s("airMaterialExpandAll"))s("airMaterialExpandAll").onclick=()=>document.querySelectorAll(".air-material-chapter").forEach(x=>x.open=true);
  if(s("airMaterialCollapseAll"))s("airMaterialCollapseAll").onclick=()=>document.querySelectorAll(".air-material-chapter").forEach(x=>x.open=false);
  if(s("airBatchMaterialUpload"))s("airBatchMaterialUpload").onclick=()=>{
    aiReportMaterialTarget={batch:true};const input=s("airMaterialFile");if(input){input.value="";input.click();}
  };
  if(s("airBatchWebSearch"))s("airBatchWebSearch").onclick=()=>airBatchWebPreflight(false);
  box.querySelectorAll(".air-material-upload").forEach(button=>button.onclick=()=>airOpenMaterialUpload(button));
  box.querySelectorAll(".air-web-search").forEach(button=>button.onclick=()=>window.WebResearch?.searchFromButton(button,()=>{const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",card=aiReportChat.find(m=>m.kind==="materialCheck");if(card)card.inventory=ReportLogicCore.materialInventory(type,airMaterialContext());renderAiReportMsgs();airApplyDocMaterialStatuses();airSaveState();}).catch(e=>alert(e.message)));
  if(s("airMaterialFile"))s("airMaterialFile").onchange=e=>aiReportMaterialTarget?.batch?airPrepareBatchMaterialFiles([...e.target.files]):airHandleMaterialFiles([...e.target.files]);
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
  if(aiReportAgentRegistered||!window.AgentCore)return;aiReportAgentRegistered=true;const AC=window.AgentCore;window.WebResearch?.registerAgentTools?.();
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
  AC.registerTool("get_section_generation_logic",{schema:{type:"function",function:{name:"get_section_generation_logic",description:"查询某个可研小节应按什么逻辑写、需要什么材料、输出什么表格或图示。只读取已发布公司逻辑，不修改规则。",parameters:{type:"object",properties:{title:{type:"string",description:"小节标题或关键词"}},required:["title"]}}},run:async a=>{
    if(!window.ReportLogicCore)return JSON.stringify({ok:false,error:"逐小节生成逻辑模块未加载"});
    const type=(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent");await ReportLogicCore.load(type);
    const q=String(a.title||""),hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t)||x.c.name.includes(q));
    const targets=hits.length?hits.slice(0,5):chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).slice(0,0);
    return JSON.stringify({ok:true,version:ReportLogicCore.overview(type),sections:targets.map(x=>({chapter:x.c.name,title:x.s.t,rules:ReportLogicCore.match(type,x.c.name,x.s.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" ")}).map(r=>({id:r.id,sourceNo:r.sourceNo,subsection:r.subsection,pointTitle:r.pointTitle,requiredSources:r.requiredSources,writingLogic:r.writingLogic,outputForm:r.outputForm,importance:r.importance,generationMode:r.generationMode}))}))});
  }});
  AC.registerTool("check_section_material_requirements",{schema:{type:"function",function:{name:"check_section_material_requirements",description:"检查单个章节或全报告需要哪些材料和数据，区分已确认找到、系统规则、需知识库检索、需网上检索、需数据接口、需测算引擎和需人工上传。‘需检索’不等于一定能找到。用户要求全表时必须返回当前项目类型的全部逻辑项，不得省略。",parameters:{type:"object",properties:{title:{type:"string",description:"章节标题、关键词；填写‘全报告’可取得当前逻辑库完整台账"}}}}},run:async a=>{
    if(!window.ReportLogicCore)return JSON.stringify({ok:false,error:"逐小节生成逻辑模块未加载"});
    const type=(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent");await ReportLogicCore.load(type);
    const context=airMaterialContext();
    const inventory=ReportLogicCore.materialInventory(type,context),q=String(a&&a.title||"").trim(),all=!q||/全报告|全部|所有|完整|\d+项/.test(q),nq=ReportLogicCore.normalize(q);
    const compact=item=>({sourceNo:item.sourceNo,chapter:item.chapter,title:item.title,requiredSources:item.requiredSources,sourceKinds:item.sourceKinds,missing:item.missing,ready:item.ready,blocking:item.blocking});
    if(all)return JSON.stringify({ok:true,scope:"all",version:inventory.version,total:inventory.total,summary:inventory.summary,chapters:inventory.chapters.map(g=>({chapter:g.chapter,total:g.total,counts:g.counts,items:g.items.map(compact)}))});
    const hits=inventory.items.filter(item=>[item.chapter,item.section,item.title].some(text=>ReportLogicCore.normalize(text).includes(nq)||nq.includes(ReportLogicCore.normalize(text))));
    return JSON.stringify({ok:true,scope:"matched",version:inventory.version,total:hits.length,summary:inventory.summary,items:hits.map(compact)});
  }});
  AC.registerTool("propose_feasibility_section_revision",{schema:{type:"function",function:{name:"propose_feasibility_section_revision",description:"为一个明确小节生成候选修改稿，不覆盖正式正文；用户可在右侧报告预览或复核页接受、拒绝",parameters:{type:"object",properties:{title:{type:"string"},instruction:{type:"string"}},required:["title","instruction"]}}},validate:a=>a&&String(a.title||"").trim()&&String(a.instruction||"").trim()?{ok:true}:{ok:false,error:"必须提供小节标题和修改要求"},run:async a=>{const q=String(a.title),hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t));if(hits.length!==1)return JSON.stringify({ok:false,error:hits.length?"匹配到多个小节，请说完整标题":"没有找到该小节"});const x=hits[0];if(x.s.locked)return JSON.stringify({ok:false,error:"该小节已人工锁定，请先解除锁定"});const text=await reviseSection(x.c,x.s,String(a.instruction));ProjectWorkflow.setCandidate(x.s,text,String(a.instruction));saveDraft();airSaveState();if(aiReportHasDoc)airRefreshSection(x.c.cn,x.si);return JSON.stringify({ok:true,status:"candidate_only",cn:x.c.cn,chapter:x.c.name,si:x.si,title:x.s.t,message:"候选稿已生成，正式正文尚未变化；可直接在右侧报告预览接受或拒绝，也可进入复核页处理"});},label:a=>"生成章节候选稿："+a.title});
}
async function airRunAgent(text){
  airRegisterAgentTools();const loading=airPushLoading("正在结合当前项目、测算和报告状态处理…");
  try{
    if(window.ReportLogicCore&&airWantsFullMaterialTable(text)){const table=await airFullMaterialTableMarkdown();airResolve(loading,{kind:"text",content:table});airSaveState();return;}
    const meta=Object.entries(aiReportSuggested&&aiReportSuggested.paramMeta||{}).map(([k,m])=>k+"="+m.label+(m.unit?'('+m.unit+')':'')).join("；");
    const history=aiReportChat.filter(m=>m.kind==="text"&&(m.role==="user"||m.role==="assistant")).slice(-10).map(m=>({role:m.role,content:m.content}));
    const logicTotal=window.ReportLogicCore?.overview(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent")?.ruleCount||0;
    const res=await AgentCore.run({system:"你是当前可研项目的持续协作助手。项目已有白箱测算和报告。用户询问某节怎么写、需要什么表格/材料时，必须调用get_section_generation_logic；用户询问还缺什么资料、为什么不能直接生成时，必须调用check_section_material_requirements，按‘已确认找到、系统规则、需知识库检索、需网上检索、需数据接口取得、需测算引擎取得、需人工上传、重要阻断项’说明。‘需检索’只表示路径，不代表一定能找到；不得把缺失资料说成已有。用户要求全报告材料表、完整清单或当前全部"+logicTotal+"项时，调用工具时title传‘全报告’，必须按章节输出完整Markdown表格，不得只给摘要或省略后续行。用户问‘项目怎么样’‘测算是否合理’‘哪里可以提升’‘主要风险/改进优先级’等开放式综合判断时，必须首先调用diagnose_feasibility_project，并严格按诊断底稿回答：先给总体判断，再按高/中/提示列建议，每条说明依据类型；财务数字只能引用metrics，硬规则只能引用hardRuleAnomalies，行业比较只能引用knowledgeEvidence；数据缺失必须直说暂无，AI推断必须明确标为判断。用户要求修改测算参数时，必须调用preview_feasibility_parameter_change，只能预演，绝不能声称已修改。用户只问影响范围时调用find_feasibility_impacted_sections。用户明确要求修改某个小节文字时，先用get_feasibility_section_content核对，再调用propose_feasibility_section_revision生成候选稿；候选稿不等于已采用，必须提示用户可直接在右侧报告预览接受或拒绝，也可到复核页处理。不要自行计算IRR/NPV。参数中文与key目录："+meta+"。比例参数工具值必须用0到1，例如90%传0.9。",messages:history,tools:["diagnose_feasibility_project","get_current_feasibility_project","preview_feasibility_parameter_change","find_feasibility_impacted_sections","get_feasibility_section_status","get_feasibility_section_content","get_section_generation_logic","check_section_material_requirements","propose_feasibility_section_revision","get_calc_summary","search_knowledge_base","get_review_issues"],maxRounds:4,selfCheck:false,traceQuery:text,onTrace:lines=>{loading.content=(lines&&lines.length?lines[lines.length-1]:"正在处理")+"…";renderAiReportMsgs();}});
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
    if(m.kind==="loading"||m.kind==="materialCheck") return; // 瞬时态/可重算材料清单，不必存
    if(m.kind==="genProgress"){ chat.push({role:"assistant",kind:"genProgress",total:m.total,done:m.done,failed:m.failed,active:false,stopped:true}); return; }
    if(m.kind==="calcPreview")return;
    if(m.kind==="typeTag"){ chat.push({role:m.role, kind:"typeTag", content:m.content||"", calcType:m.calcType}); return; }
    if(m.kind==="locationCard"){chat.push({role:m.role,kind:m.kind,content:"",query:m.query||"",candidates:m.candidates||[]});return;}
    chat.push({role:m.role, kind:m.kind, content:m.content||""});
  });
  return { savedAt:Date.now(),stage:airCurrentStage(),chat,extracted:aiReportExtracted,suggested:aiReportSuggested,hasDoc:aiReportHasDoc,paramsConfirmed:aiReportParamsConfirmed,
    locationCandidates:aiReportLocationCandidates,locationConfirmed:aiReportLocationConfirmed,
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
      aiReportLocationCandidates=Array.isArray(state.locationCandidates)?state.locationCandidates:[];
      aiReportLocationConfirmed=state.locationConfirmed||null;
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
      aiReportChat=(state.chat||[]).map(m=>Object.assign({id:++aiReportMsgSeq},m));aiReportExtracted=state.extracted||null;aiReportSuggested=state.suggested||null;aiReportLocationCandidates=Array.isArray(state.locationCandidates)?state.locationCandidates:[];aiReportLocationConfirmed=state.locationConfirmed||null;aiReportHasDoc=!!state.hasDoc;aiReportParamsConfirmed=airRestoredConfirmation(state);
      if(state.calcType)calcType=state.calcType;if(aiReportParamsConfirmed&&state.calcParams){calcParams=state.calcParams;try{calcResult=runCalcEngine(calcType,calcParams);calcResult.__ctype=calcType;scParams=calcParams;scResult=calcResult;}catch(_){aiReportParamsConfirmed=false;} }
      airRepairFlowCards();renderAiReportMsgs();
    }
  }
}

/* 兼容历史存档：旧版本可能只存了参数/测算结果，没有存对应的“下一步”卡片。
   恢复时补齐唯一必要的动作卡，同时删除同类重复卡，避免刷新后倒退或重复执行。 */
function airRepairFlowCards(){
  const dedupe=kind=>{let seen=false;aiReportChat=aiReportChat.filter(m=>m.kind!==kind||(!seen&&(seen=true)));};
  ["infoCard","locationCard","confirmCard","genConfirm","deliver"].forEach(dedupe);
  const has=kind=>aiReportChat.some(m=>m.kind===kind);
  if(aiReportExtracted&&!has("infoCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"infoCard"});
  if(aiReportExtracted&&!aiReportSuggested&&!aiReportLocationConfirmed&&aiReportLocationCandidates.length&&!has("locationCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"locationCard",query:aiReportExtracted.location||"",candidates:aiReportLocationCandidates});
  if(aiReportSuggested&&!has("confirmCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"confirmCard"});
  const stage=airCurrentStage();
  if(stage==="calculated"&&!has("genConfirm"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"genConfirm"});
  if(stage==="delivered"&&!has("deliver"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"deliver"});
}
