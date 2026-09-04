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

const AI_TYPE_CN = { rent:"出租类（长期持有经营）", sale:"出售类（配售/出售为主）", gaibao:"中资产（非居改保/商业改造等）" };
const AI_GAIBAO_SCENARIO_CN = { housing_conversion:"非居改保、居改居等（住房改造）", commercial_renovation:"商业改造（自持改造）" };
function airBusinessScenario(){
  const value=aiReportExtracted&&aiReportExtracted.businessScenario;
  return value==="commercial_renovation"?value:"housing_conversion";
}
const AI_DOMAIN_OF = { rent:"baozhang_xinjian", sale:"baozhang_xinjian", gaibao:"baozhang_gaibao" };
// 快速开始：不是范例句子，是"选类型"——点了只代表选中这个类型（用彩色标签记进对话里，
// 不冒充用户说过这句话），随后弹出的是空白信息表，要用户自己填真实项目信息，不会拿假数据直接开跑
const AI_CATEGORY_OPTIONS = [
  { key:"rent", label:"出租类（公租房/保租房）" },
  { key:"sale", label:"出售类（配售/出售）" },
  { key:"gaibao", label:"中资产（非居改保/商业改造等）" },
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
let aiReportDocZoom = 100;       // 网页预览缩放，不改变Word字号与正式正文
let aiReportChatCollapsed = false; // 收起左侧对话后让报告预览占满可用宽度
let aiReportOutlineCollapsed = false; // 章节导航可独立收起
let aiReportDocFullscreen = false; // 仅改变网页阅读方式，不改变报告内容
let aiReportPendingCalcChange = null; // AgentCore只生成预演，用户确认后才写入
let aiReportAgentRegistered = false;
let aiReportParamsConfirmed = false; // 只表示本次AI可研会话已通过人工确认；不得复用其他测算模块的全局calcParams
let aiReportMaterialTarget = null; // 当前项目材料上传要补到哪一条规则/哪个小节
let aiReportBatchFiles = []; // 批量材料解析后的待确认映射，不确认不写入项目资料
let aiReportCanEnhanceLogic = false; // 仅控制管理员增强入口显示；真正发布仍由服务端校验密码
let aiReportLogicEnhanceState = null; // 当前逐项增强会话
let aiReportLocationCandidates = []; // 地图候选必须由用户确认，禁止默认取第一条
let aiReportLocationConfirmed = null; // {name,district,address,location,query}
let aiReportSiteSearches = []; // 最多6个分析点位的独立候选，任何一个都不默认选中
let aiReportSiteLocations = []; // 已人工确认的主/次点位；主点位同时写回旧字段保持兼容
let aiReportEntryContext = null; // 从项目库显式传入；只补旧会话空字段，不覆盖已有AI可研内容
let aiReportMaterialAutoRetryStarted = false; // 每次页面会话最多自动重试一次，避免上游持续故障时刷新反复耗费请求
let aiReportGenerationLockId = null; // 项目级生成锁；刷新/重复点击不得重复消耗模型
let aiReportStateRevision = 0; // AI会话保存序号；防止较慢的旧请求覆盖较新的完成状态
let aiReportStateSaveInFlight = Promise.resolve();
let aiReportCollapsedCards = {params:null,materials:null}; // null采用流程默认值；用户手动收起后按项目本地保存

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
  aiReportHasDoc=false;aiReportDocVisible=false;aiReportDocZoom=100;aiReportChatCollapsed=false;aiReportOutlineCollapsed=false;aiReportDocFullscreen=false;aiReportPendingCalcChange=null;aiReportBusy=false;aiReportChatLoaded=false;aiReportParamsConfirmed=false;aiReportMaterialTarget=null;aiReportBatchFiles=[];aiReportLogicEnhanceState=null;aiReportLocationCandidates=[];aiReportLocationConfirmed=null;aiReportSiteSearches=[];aiReportSiteLocations=[];aiReportMaterialAutoRetryStarted=false;aiReportCollapsedCards={params:null,materials:null};
  aiReportEntryContext=null;aiReportGenerationLockId=null;aiReportStateRevision=0;aiReportStateSaveInFlight=Promise.resolve();
}
function airSetProjectEntryContext(context){
  aiReportEntryContext=context&&typeof context==="object"?Object.assign({},context):null;
  if(aiReportChatLoaded&&window.ProjectWorkflow?.aiReportShouldSeedProject(aiReportEntryContext)){if(aiReportExtracted)airFillCurrentProjectGaps();else airSeedCurrentProject();}
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
    +'<div class="step-desc">可以先批量上传项目材料，也可以一句话描述项目；AI会抽取待确认信息、从历史案例库推荐一整套测算参数初值。'
    +'你只需要确认<b>7个真正影响结论的关键参数</b>，其余系统自动填好。测算数字仍然全部来自确定性引擎，AI不会替你编造IRR。'
    +'开始测算后会弹出报告预览，实时显示AI正在撰写的内容，随时可以收起或展开。</div>'
    +'<div class="air-module-bar"><span>独立模块：</span><button type="button" data-module="project">项目信息</button><button type="button" data-module="materials">数据与材料</button><button type="button" data-module="params">关键参数</button><button type="button" data-module="logic">可研逻辑</button><button type="button" data-module="report">报告生成/修订</button><button type="button" data-module="word">下载当前阶段 Word</button></div>'
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
    aiReportLocationCandidates=[];aiReportLocationConfirmed=null;aiReportSiteSearches=[];aiReportSiteLocations=[];
    aiReportChat=aiReportChat.filter(m=>!["locationCard","locationResult"].includes(m.kind));
  }
  airRepairFlowCards();renderAiReportMsgs();airSaveState();
}

function bindAiReportEvents(){
  const s = id=>document.getElementById(id);
  if(s("airRestartBtn")) s("airRestartBtn").onclick = airRestartChat;
  if(s("airBackStepBtn")){s("airBackStepBtn").onclick = airBackStep;s("airBackStepBtn").disabled=!(window.ProjectWorkflow&&ProjectWorkflow.previousAiReportStage(airCurrentStage()));}
  if(s("airSend")) s("airSend").onclick = aiReportSend;
  document.querySelectorAll(".air-module-bar [data-module]").forEach(button=>button.onclick=()=>airOpenIndependentModule(button.dataset.module));
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
      const adopt=e.target.closest(".air-candidate-adopt");
      if(adopt){airResolveRevision(adopt.dataset.cn,+adopt.dataset.si,"adopt");return;}
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
      const logicEdit=e.target.closest(".air-section-logic-edit");
      if(logicEdit){airOpenSectionLogicEditor(logicEdit.dataset.cn,+logicEdit.dataset.si);return;}
      const refine=e.target.closest(".air-refine-requirement");
      if(refine){
        let requirement=null;try{requirement=JSON.parse(decodeURIComponent(refine.dataset.requirementSchema||"null"));}catch(error){}
        if(requirement)window.WebResearch?.openRequirementRefinement(requirement,()=>{airApplyDocMaterialStatuses();airSaveState();});
        return;
      }
      const chatToggle=e.target.closest(".air-doc-chat-toggle");
      if(chatToggle){aiReportChatCollapsed=!aiReportChatCollapsed;airApplyDocViewState();return;}
      const outlineToggle=e.target.closest(".air-doc-outline-toggle");
      if(outlineToggle){aiReportOutlineCollapsed=!aiReportOutlineCollapsed;airApplyDocViewState();return;}
      if(e.target.closest(".air-doc-zoom-out")){aiReportDocZoom=Math.max(70,aiReportDocZoom-10);airApplyDocViewState();return;}
      if(e.target.closest(".air-doc-zoom-in")){aiReportDocZoom=Math.min(160,aiReportDocZoom+10);airApplyDocViewState();return;}
      if(e.target.closest(".air-doc-zoom-reset")){aiReportDocZoom=100;airApplyDocViewState();return;}
      if(e.target.closest(".air-doc-download")){exportWord();return;}
      if(e.target.closest(".air-doc-fullscreen")){aiReportDocFullscreen=!aiReportDocFullscreen;airApplyDocViewState();return;}
      if(e.target.closest(".air-doc-current-draft")){airRestoreDocPaneIfNeeded();return;}
      const close = e.target.closest(".air-doc-close");
      if(close){ airSetDocVisible(false); return; }
      const chip = e.target.closest(".air-doc-outline .chip");
      if(chip) airScrollToChapter(chip.dataset.cn);
    });
    docPane.addEventListener("mouseup",airHandleTextSelection);
    docPane.addEventListener("scroll",airHideSelectionAction,true);
    docPane.addEventListener("change",airHandleDocPaneChange);
  }
  renderAiReportMsgs();
  airCheckAdminLogicCapability();
  airRenderDocToggle();
  airLoadState();
  airRestoreDocPaneIfNeeded();
}
function airHandleDocPaneChange(e){
  if(e.target&&e.target.id==="airDocMaterialFile"){airHandleMaterialFiles([...e.target.files]);return;}
  const selector=e.target&&e.target.closest&&e.target.closest(".air-doc-version-select");
  if(selector){if(selector.value==="current")airRestoreDocPaneIfNeeded();else airOpenReportVersionById(selector.value);}
}

async function airOpenIndependentModule(module){
  if(window.ProjectWorkflow?.touchModule)ProjectWorkflow.touchModule(projectWorkflow,module,{reason:"打开独立模块",value:{projectId:typeof currentProjectId!=="undefined"?currentProjectId:null}});
  if(module==="word")return exportWord();
  if(module==="report"){
    if(!chapters.some(c=>c.sections.some(s=>s.content||s.editedHtml)))return alert("当前还没有已生成正文；你可以先完成任一小节，再单独回到这里修订和导出。");
    airBuildDocPane();return;
  }
  if(module==="logic")return airOpenLogicModule();
  if(module==="materials"){await airCheckWholeReportMaterials();renderAiReportMsgs();return;}
  if(module==="params"){
    if(calcParams&&calcResult)return airOpenCalcDetails();
    if(aiReportSuggested&&!aiReportChat.some(m=>m.kind==="confirmCard"))aiReportChat.push({id:"module_params_"+Date.now(),role:"assistant",kind:"confirmCard",content:""});
    renderAiReportMsgs();return;
  }
  if(module==="project"){
    if(aiReportExtracted&&!aiReportChat.some(m=>m.kind==="infoCard"))aiReportChat.push({id:"module_project_"+Date.now(),role:"assistant",kind:"infoCard",content:""});
    renderAiReportMsgs();document.querySelector(".air-card")?.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
}

async function airOpenLogicModule(){
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",scenario=airBusinessScenario();await ReportLogicCore.load(type);
  const set=ReportLogicCore.current(type),rules=(set?.data?.rules||[]).filter(rule=>!scenario||!rule.scenarios?.length||rule.scenarios.includes(scenario)).map(rule=>Object.assign({},rule,scenario&&rule.scenarioVariants?.[scenario]||{}));
  document.getElementById("airLogicModuleModal")?.remove();
  document.body.insertAdjacentHTML("beforeend",'<div class="air-modal-overlay" id="airLogicModuleModal"><div class="air-modal-card" style="max-width:900px"><div class="air-modal-head"><div><b>可研逻辑独立模块 · v'+(set?.version||0)+'</b><span>共'+rules.length+'项；这里只展示生成方法，不重复展示冗长参考来源。修改某一小节并采纳后，会替换对应规则而不影响其他规则。</span></div><button type="button" class="air-modal-close">×</button></div><div style="max-height:65vh;overflow:auto">'+rules.map(rule=>'<div class="rpt-logic-note"><b>第'+rule.sourceNo+'项 · '+escapeHtml(rule.chapter+'｜'+(rule.displayTitle||rule.section))+'</b><div>'+escapeHtml(rule.writingLogic||"按小节标题规范撰写").replace(/\n/g,"<br>")+(rule.outputForm?'<br><b>输出：</b>'+escapeHtml(rule.outputForm):'')+'</div></div>').join("")+'</div><div class="air-modal-actions"><button type="button" class="btn air-modal-close">关闭</button></div></div></div>');
  document.querySelectorAll("#airLogicModuleModal .air-modal-close").forEach(button=>button.onclick=()=>document.getElementById("airLogicModuleModal")?.remove());
}

/* 报告预览面板：只在真正开始生成时才弹出来（不然一开始聊天区就被挤窄了），
   之后用户可以随时用右上角"✕"收起、再用聊天区里的小按钮展开——不影响后台继续生成。 */
function airSetDocVisible(v){
  aiReportDocVisible = v;
  const shell = document.querySelector(".air-shell");
  if(shell) shell.classList.toggle("solo", !v);
  if(!v)aiReportDocFullscreen=false;
  airApplyDocViewState();
  airRenderDocToggle();
}
function airApplyDocViewState(){
  const shell=document.querySelector(".air-shell"),pane=document.getElementById("airDocPane");
  if(shell)shell.classList.toggle("chat-collapsed",aiReportChatCollapsed&&aiReportDocVisible);
  if(!pane)return;
  pane.classList.toggle("outline-collapsed",aiReportOutlineCollapsed);
  pane.classList.toggle("fullscreen",aiReportDocFullscreen);
  pane.style.setProperty("--air-doc-zoom",String(aiReportDocZoom/100));
  const zoom=pane.querySelector(".air-doc-zoom-value");if(zoom)zoom.textContent=aiReportDocZoom+"%";
  const chat=pane.querySelector(".air-doc-chat-toggle");if(chat)chat.textContent=aiReportChatCollapsed?"展开对话":"收起对话";
  const outline=pane.querySelector(".air-doc-outline-toggle");if(outline)outline.textContent=aiReportOutlineCollapsed?"展开章节":"收起章节";
  const full=pane.querySelector(".air-doc-fullscreen");if(full)full.textContent=aiReportDocFullscreen?"退出全屏":"全屏阅读";
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
      aiReportExtracted = Object.assign({ projectName:"", location:"", calcType:null, businessScenario:null, landArea:null, landPrice:null, startYear:null, owner:"", landNature:"", desc:text }, d.data);
      if(!aiReportExtracted.projectName) aiReportExtracted.projectName = (aiReportExtracted.location||"") + "项目";
      aiReportExtracted.analysisSites=airAnalysisSites(aiReportExtracted);
      airResolve(loading, {kind:"infoCard"});
    }
    project.name=aiReportExtracted.projectName||project.name||"AI可研未命名项目";project.location=aiReportExtracted.location||project.location||"";project.analysisSites=airAnalysisSites(aiReportExtracted);project.businessScenario=aiReportExtracted.businessScenario||"";
    saveDraft();airSaveState();
  }catch(e){
    airResolve(loading, {kind:"text", content:"网络异常，信息抽取失败："+e.message, retry:{type:"extract", text}});
  }
}

function airAnalysisSites(value){
  const v=value||aiReportExtracted||{},fallback={name:v.projectName||"",location:v.location||"",role:"primary"};
  return window.ProjectWorkflow?ProjectWorkflow.normalizeAnalysisSites(v.analysisSites,fallback):[Object.assign({id:"site-1",address:fallback.location},fallback)];
}
function airSiteRowsHtml(v){
  return airAnalysisSites(v).map((site,index)=>'<div class="air-site-row" data-site-index="'+index+'">'
    +'<label class="air-site-role"><input type="radio" name="airSitePrimary" value="'+index+'" '+(site.role==="primary"?'checked':'')+'> '+(site.role==="primary"?'主项目':'设为主项目')+'</label>'
    +'<input class="air-site-name" value="'+escapeHtml(site.name||'')+'" placeholder="点位/子项目名称">'
    +'<input class="air-site-address" value="'+escapeHtml(site.address||'')+'" placeholder="城市＋区＋街道＋社区/道路/门牌">'
    +(index?'<button type="button" class="btn ghost air-site-remove" data-site-remove="'+index+'">删除</button>':'<span class="air-site-required">必填</span>')
    +'</div>').join('');
}
function airReadSiteRows(){
  return Array.from(document.querySelectorAll('.air-site-row')).map((row,index)=>({id:(airAnalysisSites()[index]||{}).id||('site-'+(index+1)),name:String(row.querySelector('.air-site-name')?.value||'').trim(),address:String(row.querySelector('.air-site-address')?.value||'').trim(),role:row.querySelector('input[name="airSitePrimary"]')?.checked?'primary':'secondary'}));
}
function airCaptureInfoCard(){
  const g=id=>document.getElementById(id);if(!g('air_name'))return;
  aiReportExtracted=Object.assign({},aiReportExtracted,{projectName:g('air_name').value.trim(),analysisSites:airReadSiteRows(),calcType:g('air_ctype').value,businessScenario:g('air_business_scenario')?.value||'',owner:g('air_owner').value.trim(),landArea:g('air_landarea').value?parseFloat(g('air_landarea').value):null,startYear:g('air_startyear').value?parseInt(g('air_startyear').value):null,landNature:g('air_landnature').value.trim(),desc:g('air_desc').value});
}

function airInfoCardHtml(){
  const v = aiReportExtracted || {};
  const siteCount=airAnalysisSites(v).length;
  if(airStageAtLeast("suggested")) return '<div class="air-card air-step-done"><b>✓ 项目信息已确认</b><span>'+escapeHtml(v.projectName||"未命名项目")+'｜'+siteCount+'个分析点位｜主项目：'+escapeHtml((airAnalysisSites(v).find(x=>x.role==='primary')||{}).name||v.location||"")+'｜'+escapeHtml(v.calcType==="gaibao"?(AI_GAIBAO_SCENARIO_CN[v.businessScenario]||"改造场景待确认"):(AI_TYPE_CN[v.calcType]||""))+'</span></div>';
  if(aiReportChat.some(m=>m.kind==="locationCard"))return '<div class="air-card air-step-done"><b>✓ 核心信息已填写，等待逐个确认地图位置</b><span>'+escapeHtml(v.projectName||"未命名项目")+'｜共'+siteCount+'个点位。请在下方为各点位选择真实候选，系统不会自动套用第一条结果。</span></div>';
  const opt = (val,label)=>'<option value="'+val+'" '+(v.calcType===val?"selected":"")+'>'+label+'</option>';
  const introText = v.__manual
    ? "请填写项目核心信息（都是真实信息，不是AI猜的）："
    : "AI已抽取以下信息，请核对/补充后继续（拿不准的字段AI没有瞎猜，需要你手动填）：";
  const btnLabel = v.__manual ? "信息填写完毕，生成参数建议 →" : "信息确认无误，生成参数建议 →";
  const hint = v.__manual ? "" : '<span style="font-size:11px; color:var(--ink-faint,#8A97A8);">信息不对？直接在下方输入框说一句就行，比如"不对，是2026年开工"</span>';
  return '<div class="air-card">'
    +(airMaterialExtractionNeedsRetry(v)?'<div class="air-location-tip"><b>已保存材料，等待重新AI提取</b><span>这是接口恢复前留下的降级草稿。系统会自动用已保存材料重试；你也可以立即手动触发，不需要重新上传文件。</span><button type="button" class="btn ghost" id="airRetryMaterialExtraction">重新用公网DeepSeek提取</button></div>':'')
    +'<div style="font-size:12.5px; color:var(--ink-soft); margin-bottom:8px;">'+introText+'</div>'
    +'<div><label>报告/批次名称</label><input id="air_name" type="text" value="'+escapeHtml(v.projectName||"")+'"><small class="air-field-help">例如“市税务局6处非居改保项目”。具体点位在下方分别填写。</small></div>'
    +'<div class="air-sites-box"><div class="air-sites-head"><span><b>批量分析点位（1—6个）</b><small>地图将逐个检索；请选择一个影响最大的主项目。主项目精写，其他项目合并压缩。</small></span><button type="button" class="btn ghost" id="airAddSite" '+(airAnalysisSites(v).length>=6?'disabled':'')+'>＋增加点位</button></div>'
    +'<div id="airSiteRows">'+airSiteRowsHtml(v)+'</div></div>'
    +'<div class="grid2">'
    +'<div><label>测算类型</label><select id="air_ctype"><option value="">请选择…</option>'
      + opt("rent","出租类（公租房/保租房）") + opt("sale","出售类（配售/出售）") + opt("gaibao","改造项目") + '</select></div>'
    +'<div><label>建设/委托单位（选填）</label><input id="air_owner" type="text" value="'+escapeHtml(v.owner||"")+'"></div>'
    +'</div><div class="grid2" id="air_gaibao_scenario_row" style="'+(v.calcType==="gaibao"?'':'display:none;')+'">'
    +'<div><label>改造业务场景（必选）</label><select id="air_business_scenario"><option value="">请选择…</option><option value="housing_conversion" '+(v.businessScenario==="housing_conversion"?'selected':'')+'>非居改保、居改居等（住房改造）</option><option value="commercial_renovation" '+(v.businessScenario==="commercial_renovation"?'selected':'')+'>商业改造（自持改造）</option></select><small class="air-field-help">系统将据此自动选择对应的市场分析、定位、改造、运营与财务逻辑，两套逻辑不会混用。</small></div><div></div>'
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
  if(!calcType){ alert("请先选择测算类型（出租类/出售类/中资产）"); return; }
  const name = g("air_name").value.trim(),sites=airReadSiteRows();
  if(!name){alert("请填写报告/批次名称");return;}
  if(!sites.length||sites.some(x=>!x.name||!x.address)){alert("请完整填写每个点位的名称和建设地点");return;}
  if(!sites.some(x=>x.role==="primary")){alert("请指定一个影响最大的主项目");return;}
  const primary=sites.find(x=>x.role==="primary")||sites[0],loc=primary.address;
  const businessScenario=calcType==="gaibao"?g("air_business_scenario").value:"";
  if(calcType==="gaibao"&&!businessScenario){alert("请选择‘非居改保、居改居等（住房改造）’或‘商业改造（自持改造）’，系统才能加载正确逻辑");return;}
  aiReportExtracted = Object.assign({}, aiReportExtracted, {
    projectName: name,
    location: loc,
    analysisSites: sites,
    calcType,
    businessScenario,
    owner: g("air_owner").value.trim(),
    landArea: g("air_landarea").value? parseFloat(g("air_landarea").value): null,
    startYear: g("air_startyear").value? parseInt(g("air_startyear").value): null,
    landNature: g("air_landnature").value.trim(),
    desc: g("air_desc").value,
    __manual: false,   // 已经走到确认这一步，后续走"多轮修正"逻辑时不用再当成空白表单处理
  });
  project.name=name;project.location=loc;project.analysisSites=sites;project.owner=aiReportExtracted.owner||project.owner||"";project.businessScenario=businessScenario;project.landArea=aiReportExtracted.landArea;project.startYear=aiReportExtracted.startYear;project.landNature=aiReportExtracted.landNature;project.desc=aiReportExtracted.desc||project.desc||"";
  saveDraft();
  airSetBusy(true);
  await airSearchLocationCandidates();
  airSetBusy(false);
}

async function airFetchLocationSite(site){
  try{
    const r=await fetch("/api/poi",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"search",address:site.address,projectName:site.name})});
    const d=await r.json(),raw=d.candidates||[];
    return Object.assign({},site,{query:site.address,candidates:window.ProjectWorkflow?.rankLocationCandidates?ProjectWorkflow.rankLocationCandidates(site.address,raw):raw,error:d.ok&&raw.length?"":(d.error||"未找到匹配地址"),selectedIndex:null,searching:false});
  }catch(e){return Object.assign({},site,{query:site.address,candidates:[],error:e.message,selectedIndex:null,searching:false});}
}
function airCaptureLocationSelections(){
  aiReportSiteSearches.forEach((site,index)=>{const checked=document.querySelector('input[name="airLocationCandidate_'+index+'"]:checked');if(checked)site.selectedIndex=+checked.value;});
}
async function airSearchLocationSite(index){
  const input=document.querySelector('.air-location-site-address[data-site-index="'+index+'"]'),address=String(input&&input.value||"").trim();
  if(!address){alert("请先填写这个点位的城市、区、街道、社区/道路或附近地标。");return;}
  airCaptureLocationSelections();
  const current=aiReportSiteSearches[index];if(!current)return;
  current.address=address;current.query=address;current.searching=true;current.error="";current.candidates=[];current.selectedIndex=null;
  const extractedSites=airAnalysisSites();if(extractedSites[index])extractedSites[index].address=address;
  aiReportExtracted.analysisSites=extractedSites;const primary=extractedSites.find(site=>site.role==='primary')||extractedSites[0];aiReportExtracted.location=primary?.address||aiReportExtracted.location;
  const card=aiReportChat.find(message=>message.kind==="locationCard");if(card)card.sites=aiReportSiteSearches;
  renderAiReportMsgs();airSaveState();
  aiReportSiteSearches[index]=await airFetchLocationSite(current);
  if(card)card.sites=aiReportSiteSearches;
  const primarySearch=aiReportSiteSearches.find(site=>site.role==='primary')||aiReportSiteSearches[0];aiReportLocationCandidates=primarySearch?.candidates||[];
  renderAiReportMsgs();airSaveState();
}

async function airSearchLocationCandidates(overrideQuery){
  const ex=aiReportExtracted||{},sites=airAnalysisSites(ex);
  if(overrideQuery&&sites.length===1){sites[0].address=String(overrideQuery).trim();ex.location=sites[0].address;ex.analysisSites=sites;}
  if(sites.some(x=>!x.address)){alert("请为每个点位填写城市、区、街道和社区/道路后再检索。");return;}
  aiReportLocationConfirmed=null;aiReportLocationCandidates=[];aiReportSiteLocations=[];
  const loading=airPushLoading("正在批量核对 "+sites.length+" 个建设地点，请稍后逐个确认…");
  aiReportSiteSearches=await Promise.all(sites.map(airFetchLocationSite));
  const primary=aiReportSiteSearches.find(x=>x.role==="primary")||aiReportSiteSearches[0];
  aiReportLocationCandidates=primary?.candidates||[];
  airResolve(loading,{kind:"locationCard",sites:aiReportSiteSearches});airSaveState();
}

function airLocationCardHtml(m){
  const sites=(m.sites&&m.sites.length?m.sites:aiReportSiteSearches).slice(0,6);
  const tips='<div class="air-location-tip"><b>批量位置确认（'+sites.length+'个点位）</b><span>每个点位都独立检索、独立确认，不会把同一区的候选混到另一个项目。完整门牌 ＞ 区＋街道＋社区/道路 ＞ 仅区名；没有真实候选的点位会保留为待补，不伪造位置。</span></div>';
  const blocks=sites.map((site,si)=>{
    const rows=(site.candidates||[]).slice(0,15).map((c,i)=>'<label class="air-location-option '+(c.locationMatch==='conflict'?'conflict':'')+'"><input type="radio" name="airLocationCandidate_'+si+'" value="'+i+'" '+(site.selectedIndex===i?'checked':'')+'><span><b>'+escapeHtml(c.name||"未命名位置")+'</b><small>'+escapeHtml([c.district,c.address].filter(Boolean).join(" · ")||"无详细地址")+'</small></span><em>'+(c.locationMatch==='matched'?'行政区匹配':c.locationMatch==='conflict'?'行政区不一致':'请人工核对')+'</em></label>').join('');
    const retry='<div class="air-location-retry"><input class="air-location-site-address" data-site-index="'+si+'" value="'+escapeHtml(site.address||site.query||'')+'" placeholder="补充或修改本点位地址"><button type="button" class="btn ghost air-location-site-refresh" data-site-index="'+si+'" '+(site.searching?'disabled':'')+'>'+(site.searching?'正在重搜…':'↻ 仅重搜此点位')+'</button></div>';
    return '<section class="air-location-site"><div class="air-location-site-title"><b>'+(site.role==='primary'?'主项目':'次项目')+'｜'+escapeHtml(site.name||('点位'+(si+1)))+'</b><span>其他点位不会受影响</span></div>'+retry+(rows?'<div class="air-location-query">真实候选 '+(site.candidates||[]).length+' 条，请选择一项：</div><div class="air-location-list">'+rows+'</div>':'<div class="air-location-error">'+escapeHtml(site.searching?'正在单独检索此点位':(site.error||'暂未找到真实候选'))+(site.searching?'':'。可在上方补充道路、门牌或附近地标后，仅重搜这一项。')+'</div>')+'</section>';
  }).join('');
  return '<div class="air-card">'+tips+blocks+'<div class="air-location-actions"><button type="button" class="btn" id="airConfirmLocation">确认各点位并继续 →</button><button type="button" class="btn ghost" id="airRetryLocation">返回修改点位</button><button type="button" class="btn ghost" id="airLocationSearchAgain">按当前点位重新批量检索</button><button type="button" class="btn ghost" id="airSkipLocation">全部跳过地图检索</button></div></div>';
}

function airLocationResultHtml(m){
  const sites=(m.sites&&m.sites.length?m.sites:aiReportSiteLocations).slice(0,6),primary=sites.find(site=>site.role==='primary')||sites[0],confirmed=sites.filter(site=>site.confirmed&&site.location).length,pending=sites.length-confirmed;
  const rows=sites.map((site,index)=>'<div class="air-completed-location-row"><span><b>'+(site.role==='primary'?'主项目':'次项目')+'｜'+escapeHtml(site.projectName||site.name||('点位'+(index+1)))+'</b><small>'+escapeHtml(site.query||site.address||'未填写地址')+'</small></span><em>'+(site.confirmed&&site.location?'已确认：'+escapeHtml(site.candidateName||site.formattedName||site.name||'地图位置'):'待补地图位置')+'</em></div>').join('');
  const target='airLocationResultDetail_'+m.id;
  return '<div class="air-completed-step"><div class="air-completed-step-head"><span><b>✓ 位置确认已完成</b><small>共'+sites.length+'个点位，已确认'+confirmed+'个'+(pending?'，待补'+pending+'个':'')+'；主项目“'+escapeHtml(primary?.projectName||primary?.name||'未命名')+'”将重点分析。</small></span><button type="button" class="air-card-detail-toggle" data-detail-target="'+target+'">查看详情</button></div><div class="air-completed-step-detail" id="'+target+'" hidden>'+rows+'</div></div>';
}

async function airConfirmLocation(){
  const confirmed=[];
  for(let si=0;si<aiReportSiteSearches.length;si++){
    const site=aiReportSiteSearches[si],checked=document.querySelector('input[name="airLocationCandidate_'+si+'"]:checked');
    if((site.candidates||[]).length&&!checked){alert('请先为“'+(site.name||('点位'+(si+1)))+'”选择正确地址。');return;}
    if(!checked){confirmed.push(Object.assign({},site,{candidates:undefined,skipped:true}));continue;}
    const selected=site.candidates[+checked.value];
    if(selected.locationMatch==='conflict'&&!confirm('“'+site.name+'”的候选行政区与填写地点不一致，仍要采用吗？'))return;
    confirmed.push(Object.assign({},site,selected,{name:site.name,projectName:site.projectName||site.name,candidateName:selected.name,candidates:undefined,query:site.address||site.query,confirmed:true}));
  }
  aiReportSiteLocations=confirmed;const primary=confirmed.find(x=>x.role==='primary')||confirmed[0];
  aiReportLocationConfirmed=primary;aiReportLocationCandidates=primary?.candidates||[];
  project.analysisSites=confirmed;project.poiLoc=primary?.location||'';project.poiLocLabel=primary?.name||'';project.poiKw=primary?.query||'';
  const locationCard=aiReportChat.find(m=>m.kind==="locationCard");
  if(locationCard){locationCard.kind="locationResult";locationCard.sites=confirmed;locationCard.content="";}
  else airPush({role:"assistant",kind:"locationResult",content:"",sites:confirmed});
  airSetBusy(true);if(primary?.location)await airRunSurvey(primary);await airRunSecondarySurveys(confirmed.filter(x=>x!==primary&&x.location));await airRunSuggest();airSetBusy(false);airSaveState();
}

async function airSkipLocation(){
  if(!confirm("跳过后不会生成地图周边、竞品和POI职住代理数据，但不影响参数推荐与可研框架生成。是否继续？"))return;
  aiReportSiteLocations=airAnalysisSites().map(x=>Object.assign({},x,{projectName:x.name,skipped:true,query:x.address}));aiReportLocationConfirmed=aiReportSiteLocations.find(x=>x.role==='primary')||aiReportSiteLocations[0];project.analysisSites=aiReportSiteLocations;const locationCard=aiReportChat.find(m=>m.kind==="locationCard");if(locationCard){locationCard.kind="locationResult";locationCard.sites=aiReportSiteLocations;locationCard.content="";}
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
    if(poiLines.length){project.poiDesc = poiLines.join("\n");best.poiDesc=project.poiDesc;}

    let cpText = "";
    if(cpRes.ok && (cpRes.competitors||[]).length){
      project.competitors = cpRes.competitors.map(c=>({ name:c.name, dist:c.dist!=null?String(c.dist):"", rent:"", occ:"",
        note:"（地图抓取，租金/出租率须人工调研）" }));
      best.competitors=project.competitors;
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

async function airRunSecondarySurveys(sites){
  if(!sites.length)return;
  const loading=airPushLoading("正在按次项目精简模式检索其余 "+sites.length+" 个点位的周边差异…"),summaries=[];
  for(const site of sites){
    try{
      const [poiRes,cpRes,popRes]=await Promise.all([
        fetch("/api/poi",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({location:site.location})}).then(r=>r.json()).catch(()=>({ok:false})),
        fetch("/api/poi",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"competitors",location:site.location})}).then(r=>r.json()).catch(()=>({ok:false})),
        fetch("/api/population?lookup=1&location="+encodeURIComponent(site.address||site.query||""),{headers:authHeaders()}).then(r=>r.json()).catch(()=>({ok:false})),
      ]);
      const balData=await fetch("/api/poi",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"balance",location:site.location})}).then(r=>r.json()).catch(()=>({ok:false}));
      const poiLines=[];if(poiRes.ok)Object.entries(poiRes.pois||{}).forEach(([label,items])=>{if(items?.length)poiLines.push(label+'：'+items.map(p=>p.name+(p.dist!=null?'（约'+p.dist+'km）':'')).join('、'));});
      site.poiDesc=poiLines.join('\n');site.competitors=cpRes.ok?(cpRes.competitors||[]).slice(0,6):[];
      if(popRes.ok&&popRes.item){const it=popRes.item;site.populationText=(it.street?it.city+it.district+it.street:it.city+it.district)+'常住人口约'+it.population+'万人（'+it.year+'年，来源：'+(it.source||'人工整理')+'）';}
      if(balData.ok&&(balData.resiCount+balData.jobCount)>0){const total=balData.resiCount+balData.jobCount,jobRatio=Math.round(balData.jobCount/total*100);site.balanceText='3公里内住宅小区类POI '+balData.resiCount+'个，企业/写字楼/产业园类POI '+balData.jobCount+'个，岗位类POI占比约'+jobRatio+'%';}
      summaries.push('“'+site.name+'”已取得'+(poiLines.length?poiLines.length+'类周边配套':'0类周边配套')+'、'+site.competitors.length+'个竞品候选'+(site.populationText?'、人口依据':'、人口待补')+(site.balanceText?'、职住代理指标':'、职住待补'));
    }catch(e){site.surveyError=e.message;summaries.push('“'+site.name+'”周边检索待补');}
  }
  project.analysisSites=aiReportSiteLocations;saveDraft();
  airResolve(loading,{kind:"text",content:'次项目批量检索完成：'+summaries.join('；')+'。生成正文时只提炼与主项目不同、且会影响结论的内容。'});
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
      best.populationText=project.populationText;
      lines.push("👥 人口参考："+project.populationText);
    }else{
      lines.push("👥 人口参考：本地未收录「"+(ex.location||"")+"」的人口数据，需求分析章节会标注「待人工核实统计部门最新数据」，不会编造人口数字。");
    }

    if(balData.ok && (balData.resiCount+balData.jobCount)>0){
      const total = balData.resiCount + balData.jobCount;
      const jobRatio = Math.round(balData.jobCount/total*100);
      project.balanceText = "3公里内住宅小区类POI "+balData.resiCount+"个，企业/写字楼/产业园类POI "+balData.jobCount+"个，岗位类POI占比约"+jobRatio+"%";
      best.balanceText=project.balanceText;
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
    await airSaveState();
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

function airPersistentCardHtml(kind,title,summary,content,defaultCollapsed){
  const saved=aiReportCollapsedCards&&aiReportCollapsedCards[kind],collapsed=saved==null?!!defaultCollapsed:!!saved;
  return '<details class="air-persistent-card" data-air-card="'+escapeHtml(kind)+'" '+(collapsed?'':'open')+'>'
    +'<summary><span><b>'+escapeHtml(title)+'</b><small>'+escapeHtml(summary||"")+'</small></span><span class="air-persistent-card-toggle"><i class="when-open">收起</i><i class="when-closed">展开</i></span></summary>'
    +'<div class="air-persistent-card-content">'+content+'</div></details>';
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
  const content = '<div class="air-card">'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">来源层级：'+escapeHtml((sug.sourceHierarchy||[]).join(" → "))+'</div>'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:10px;">本次全量来源：'+escapeHtml(sourceSummary)+'</div>'
    +(alreadyCalculated?'<div class="air-step-done"><b>✓ 参数已经人工确认，财务测算已完成</b><span>当前参数只读展示；如需调整，可在下方对话中直接说明要修改的参数和值，系统会先预演影响。</span></div>':'<div class="air-bulk-confirm"><div><b>已逐项核对数值和依据？</b><span>可一次勾选本卡片全部待人工确认项；不会自动开始测算。</span></div><button type="button" class="btn" id="airConfirmAll">批量人工确认全部</button><span id="airConfirmAllState"></span></div>')
    + rows
    + otherDetails
    +(!alreadyCalculated&&otherManual.length?'<label style="display:block;margin-top:10px;font-size:11.5px;"><input class="air-kf-confirm" data-key="__other_batch" type="checkbox"> 已批量核对其余 '+otherManual.length+' 项案例/兜底/默认参数（低影响项后续还会做联合扰动验证）</label>':'')
    +'<div style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'
    +(alreadyCalculated?'<span class="air-complete-pill">测算步骤已完成</span>':'<button class="btn" id="airConfirmParams">确认，开始测算 →</button>')
    +'<span style="font-size:11.5px; color:var(--ink-soft);">其余约'+(Object.keys(sug.params).length-sug.keyFields.length)+'项参数的当前值、单位和来源已列在上方折叠区</span>'
    +'</div></div>';
  return airPersistentCardHtml("params",alreadyCalculated?"关键参数（已确认）":"关键参数确认",alreadyCalculated?"测算已完成，可展开查看参数与来源":"请核对7个关键参数后开始测算",content,alreadyCalculated);
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
    airPush({role:"assistant", kind:"calcResult", content:"✅ 财务测算完成：全投资IRR "+(s.irr==null?"无法计算":s.irr+"%")+"，全周期总收入 "+fmt(s.totalIncome)+" 万元，净利润合计 "+fmt(s.totalNetProfit)+" 万元，累计净现值 "+fmt(s.totalNpv)+" 万元。\n数字均由确定性引擎计算得出，可在导出的Excel/测算说明书中复核。\n"+airIrrTakeaway(s.irr)});
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

function airReportGenerationStatus(){
  if(window.ProjectWorkflow?.reportGenerationStatus)return ProjectWorkflow.reportGenerationStatus(chapters);
  const all=chapters.filter(c=>c.checked!==false).flatMap(c=>c.sections||[]),generated=all.filter(s=>String(s.editedHtml||s.content||"").trim()).length;
  return {total:all.length,generated,remaining:Math.max(0,all.length-generated),complete:all.length>0&&generated===all.length};
}
function airIsIncompleteGenerationMessage(message){
  return !!message&&(message.kind==="generationIncomplete"||(
    message.kind==="text"&&/^本轮实际完成\s*\d+\/\d+\s*个子标题，仍有\s*\d+\s*个没有正文/.test(String(message.content||""))
  ));
}
function airGenerationIncompleteHtml(message){
  const coverage=airReportGenerationStatus();
  if(coverage.complete)return '<div class="air-step-done"><b>✓ 当前报告已完整生成</b><span>已完成 '+coverage.generated+'/'+coverage.total+' 个子标题。</span></div>';
  const content=message&&message.content||("本轮实际完成 "+coverage.generated+"/"+coverage.total+" 个子标题，仍有 "+coverage.remaining+" 个没有正文。不会标记为完成，也不会覆盖上一完整版本。");
  return '<div class="air-card"><div>'+(window.MD?window.MD.renderHtml(content):escapeHtml(content))+'</div>'
    +'<div style="margin-top:12px;"><button type="button" class="btn air-resume-inline-btn">▶ 继续生成剩余 '+coverage.remaining+' 节</button></div></div>';
}
function airRebuildPendingGenerationTasks(){
  const tasks=[];
  chapters.filter(c=>c.checked!==false).forEach(c=>(c.sections||[]).forEach((s,si)=>{
    if(!String(s&&s.editedHtml||s&&s.content||"").trim())tasks.push({c,s,si});
  }));
  aiReportPendingTasks=tasks;
  return tasks;
}
async function airResumeGeneration(){
  if(aiReportBusy)return;
  const coverage=airReportGenerationStatus();
  if(coverage.complete){airOpenExistingReport("当前报告已经完整生成，已为你打开报告预览。");return;}
  const tasks=airRebuildPendingGenerationTasks();
  if(!tasks.length){airOpenExistingReport("没有发现需要继续生成的小节，已为你打开现有报告预览。");return;}
  const claim=window.ProjectWorkflow?.claimReportGeneration?ProjectWorkflow.claimReportGeneration(projectWorkflow,chapters,{force:false}):{ok:true,lock:{id:"local-"+Date.now()}};
  if(!claim.ok){alert("该项目已有生成任务在运行。请等待完成或刷新查看进度，不会重复启动。");return;}
  aiReportGenerationLockId=claim.lock.id;
  const targetReportVersion=window.ProjectWorkflow?.nextReportVersionNumber?ProjectWorkflow.nextReportVersionNumber(projectWorkflow):(projectWorkflow.reportVersions||[]).length+1;
  if(!aiReportProgressMsg){
    aiReportProgressMsg={role:"assistant",kind:"genProgress",total:coverage.total,done:coverage.generated,failed:0,active:true,stopped:false,targetReportVersion,generationId:"generation-"+Date.now().toString(36)};
    airPush(aiReportProgressMsg);
  }else{
    aiReportProgressMsg.total=coverage.total;aiReportProgressMsg.done=coverage.generated;
    aiReportProgressMsg.active=true;aiReportProgressMsg.stopped=false;
  }
  aiReportStopFlag=false;airSetBusy(true);saveDraft();airSaveState();renderAiReportMsgs();
  try{await airRunGenTasks();}
  catch(e){airPush({role:"assistant",kind:"text",content:"继续生成失败："+e.message+"。已保留现有内容，可以再次点击继续。"});}
  finally{
    if(window.ProjectWorkflow?.releaseReportGeneration&&aiReportGenerationLockId){const status=aiReportStopFlag?"paused":(airReportGenerationStatus().complete?"completed":"incomplete");ProjectWorkflow.releaseReportGeneration(projectWorkflow,aiReportGenerationLockId,status);}
    aiReportGenerationLockId=null;saveDraft();airSaveState();airSetBusy(false);
  }
}
function airOpenExistingReport(message){
  airRestoreDocPaneIfNeeded();
  if(message)airPush({role:"assistant",kind:"text",content:message});
}
async function aiReportStartGenerate(options){
  options=options||{};
  if(aiReportBusy) return;
  if(!aiReportParamsConfirmed || !calcResult){ alert("请先完成人工确认并成功生成财务测算，再开始可研生成。"); return; }
  const coverage=airReportGenerationStatus();
  if(coverage.complete&&!options.force){airOpenExistingReport("🔒 已有完整可研报告，系统已直接打开原版预览；本次没有联网检索、没有调用模型，也没有覆盖原报告。");return;}
  const claim=window.ProjectWorkflow?.claimReportGeneration?ProjectWorkflow.claimReportGeneration(projectWorkflow,chapters,{force:!!options.force}):{ok:true,lock:{id:"local-"+Date.now()}};
  if(!claim.ok){
    if(claim.reason==="already_complete")airOpenExistingReport("🔒 已有完整报告，重复生成已被锁阻止，已为你打开原版预览。");
    else alert("该项目已有生成任务在运行。请等待完成或刷新查看进度，不会重复启动。");
    return;
  }
  aiReportGenerationLockId=claim.lock.id;saveDraft();airSaveState();
  airSetBusy(true);
  try{ await aiReportRunGenerate(); }
  catch(e){ airPush({role:"assistant",kind:"text",content:"可研生成未能启动："+e.message+"。按钮已恢复，可检查参数或稍后重试。"}); }
  finally{
    if(window.ProjectWorkflow?.releaseReportGeneration&&aiReportGenerationLockId){const status=aiReportStopFlag?"paused":(airReportGenerationStatus().complete?"completed":"incomplete");ProjectWorkflow.releaseReportGeneration(projectWorkflow,aiReportGenerationLockId,status);}
    aiReportGenerationLockId=null;saveDraft();airSaveState();airSetBusy(false);
  }
}
async function airRequestFullRegeneration(){
  const status=airReportGenerationStatus();if(!status.generated)return aiReportStartGenerate();
  if(!confirm("第一次确认：重新生成会再次消耗模型额度。现有报告会先保存为版本，是否继续？"))return;
  if(!confirm("第二次确认：将重新生成全部未锁定小节；原版可从项目库的报告版本中查看。确定继续？"))return;
  if(window.ProjectWorkflow)ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta("重新生成前自动备份"));
  chapters.filter(c=>c.checked!==false).forEach(c=>(c.sections||[]).forEach(s=>{if(!s.locked){s.content="";s.editedHtml=null;s.pendingRevision=null;}}));
  saveDraft();airSaveState();await aiReportStartGenerate({force:true});
}

/* ================= 阶段⑤ 生成：复用 report.js 的 generateSection()（接上流式），实时写入右侧预览面板 ================= */
async function aiReportRunGenerate(){
  const ex = aiReportExtracted || {};
  const sug = aiReportSuggested;
  const domainKey_ = AI_DOMAIN_OF[sug.calcType];
  await fetchOutlines();
  let logicOutline = null;
  if(window.ReportLogicCore){
    try{ await ReportLogicCore.load(sug.calcType); logicOutline=ReportLogicCore.outline(sug.calcType,{businessScenario:airBusinessScenario()}); }catch(e){}
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
    type: sug.calcType==="gaibao"?(AI_GAIBAO_SCENARIO_CN[airBusinessScenario()]||AI_TYPE_CN.gaibao):(AI_TYPE_CN[sug.calcType] || ""),
    businessScenario: sug.calcType==="gaibao"?airBusinessScenario():"",
    scale: calcParams && (calcParams.totalInvestment || calcParams.invest || calcParams.loan) || "",
    desc: (ex.desc||"") + "\n\n【参数说明】本报告关键测算参数由系统依据历史项目类比自动推荐并计算，经"+who+"于"+today+"确认；如需复核请以导出的《测算说明书》与Excel为准。",
  });
  appMode = "report";
  saveDraft();

  airBuildDocPane();

  const active = chapters.filter(c=>c.checked);
  const tasks = [];
  active.forEach(c=>c.sections.forEach((s,si)=>{if(!s.content&&!s.editedHtml)tasks.push({c,s,si});}));
  aiReportPendingTasks = tasks;
  aiReportStopFlag = false;
  aiReportChat=aiReportChat.filter(message=>message.kind!=="genProgress");
  const coverage=airReportGenerationStatus();
  const targetReportVersion=window.ProjectWorkflow?.nextReportVersionNumber?ProjectWorkflow.nextReportVersionNumber(projectWorkflow):(projectWorkflow.reportVersions||[]).length+1;
  aiReportProgressMsg = { role:"assistant", kind:"genProgress", total:coverage.total, done:coverage.generated, failed:0, active:true,targetReportVersion,generationId:"generation-"+Date.now().toString(36) };
  airPush(aiReportProgressMsg);

  await airRunGenTasks();
}

async function airRunGenTasks(){
  const tasks = aiReportPendingTasks || [];
  const p = aiReportProgressMsg;
  await runWorkerPool(tasks, async (t)=>{
    const generated=await airGenOneSection(t);
    if(generated){p.done++;saveDraft();airSaveLocalState();}
    renderAiReportMsgs();
  }, reportGenerationConcurrency(tasks.length), ()=>!aiReportStopFlag);
  saveDraft();

  if(aiReportStopFlag && tasks.length){
    const coverage=airReportGenerationStatus();
    p.done=coverage.generated;p.total=coverage.total;p.active=false;p.stopped=true;
    aiReportPendingTasks=tasks.filter(t=>!String(t.s&&t.s.editedHtml||t.s&&t.s.content||"").trim());
    renderAiReportMsgs();
    if(typeof flushCloudSave==="function")await flushCloudSave();
    await airSaveState();
    return;
  }
  const coverage=airReportGenerationStatus();
  p.done=coverage.generated;p.total=coverage.total;
  aiReportPendingTasks=tasks.filter(t=>!String(t.s&&t.s.editedHtml||t.s&&t.s.content||"").trim());
  p.active=false;p.stopped=!coverage.complete;
  if(!coverage.complete){
    renderAiReportMsgs();
    aiReportChat=aiReportChat.filter(message=>!airIsIncompleteGenerationMessage(message));
    airPush({role:"assistant",kind:"generationIncomplete",content:"本轮实际完成 "+coverage.generated+"/"+coverage.total+" 个子标题，仍有 "+coverage.remaining+" 个没有正文，因此不会标记为完成、不会生成完成版，也不会覆盖上一完整版本。"});
    airRepairFlowCards();renderAiReportMsgs();
    saveDraft();if(typeof flushCloudSave==="function")await flushCloudSave();await airSaveState();return;
  }
  aiReportPendingTasks=[];
  aiReportChat=aiReportChat.filter(message=>!airIsIncompleteGenerationMessage(message));
  p.failed=0;
  if(window.ProjectWorkflow){const version=window.ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta("AI可研初稿生成完成"));p.reportVersionId=version&&version.id||null;p.reportVersion=Number(version&&version.version)||p.targetReportVersion||null;}
  renderAiReportMsgs();
  airPush({role:"assistant", kind:"text", content:"🎉 可研报告已经生成啦！已完成 "+(p.total-p.failed)+"/"+p.total+" 个子标题的初稿起草"+(p.failed? "（"+p.failed+" 个失败，可在右侧预览里逐节点「重试」）。":"。")+"\n\n接下来你可以继续和我对话修改测算或报告，也可以点击下方「复核与人工审查」，或者直接给我发送“复核”，我会带你进入复核与签发。"});
  airPush({role:"assistant", kind:"deliver"});
  saveDraft();
  if(typeof flushCloudSave==="function")await flushCloudSave();
  await airSaveState();
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
  let generated=false;
  try{
    const text = await generateSection(chapter, section, (partial)=>{
      streamWrite(partial);
    });
    if(!String(text||"").trim())throw new Error("模型未返回正文，本节没有计入完成");
    if(streamTimer){clearTimeout(streamTimer);streamTimer=null;}
    section.content = text;
    if(secEl){
      secEl.dataset.status = "done";
      secEl.classList.remove("pending"); secEl.classList.remove("gen");
      airRenderCompletedSection(chapter,section,si);
    }
    if(opts.onDone) opts.onDone();
    generated=true;
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
  return generated;
}

async function airGenOneSection(t){
  return airDriveSectionGen(t.c, t.s, t.si, {
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
function airTrustBadgeHtml(section){
  if(!window.ReportTrust)return '';
  const p=ReportTrust.buildSectionProfile(section,{hasCalculation:!!(projectWorkflow&&projectWorkflow.currentCalcSnapshotId)}),cls=p.grade==="高"?"high":p.grade==="低"?"low":"mid";
  return '<button type="button" class="air-trust-badge '+cls+'" title="'+escapeHtml((p.reasons||[]).join('；')||'点击依据徽章查看来源')+'">'+escapeHtml(p.types.map(t=>ReportTrust.TYPE_LABELS[t]).join(' · '))+' · '+p.score+'分</button>';
}
function airCandidateHtml(chapter,section,si){
  if(!section.pendingRevision||!window.ProjectWorkflow)return '';
  return '<div class="air-section-candidate wf-candidate"><b>AI修改候选稿 · 尚未覆盖正式正文</b>'
    +ProjectWorkflow.simpleDiffHtml(section.pendingRevision.before,section.pendingRevision.after)
    +'<div class="wf-candidate-actions"><button type="button" class="btn air-candidate-accept" data-cn="'+chapter.cn+'" data-si="'+si+'">接受修改</button>'
    +(section.pendingRevision.logicRevision?'<button type="button" class="btn ghost air-candidate-adopt" data-cn="'+chapter.cn+'" data-si="'+si+'">接受并采纳为后台逻辑</button>':'')
    +'<button type="button" class="btn ghost air-candidate-reject" data-cn="'+chapter.cn+'" data-si="'+si+'">拒绝</button></div></div>';
}
function airRenderCompletedSection(chapter,section,si){
  const el=document.getElementById('sec_'+chapter.cn+'_'+si);if(!el)return;
  const title=el.querySelector('h4');if(title){title.querySelector('.air-trust-badge')?.remove();if(!title.querySelector('.done-stamp'))title.insertAdjacentHTML('beforeend','<span class="done-stamp">已拟</span>');title.insertAdjacentHTML('beforeend',airTrustBadgeHtml(section));}
  const tools=el.querySelector('.air-section-tools');
  if(tools)tools.outerHTML=airSectionToolsHtml(chapter,section,si);else el.querySelector('.air-section-material')?.insertAdjacentHTML('afterend',airSectionToolsHtml(chapter,section,si));
  const body=el.querySelector('.body');if(body)body.innerHTML=renderContent(airSectionDisplayContent(chapter,section));
  el.querySelector(':scope > .rpt-logic-note')?.remove();el.querySelector('h4')?.insertAdjacentHTML('afterend',renderSectionLogicHtml(chapter,section,true));
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
  try{const text=await generateSection(info.chapter,info.section);ProjectWorkflow.setCandidate(info.section,text,'重写本节',{logicRevision:reportLogicRevision(info.chapter,info.section,'根据现有逻辑重新生成本节')});saveDraft();airSaveState();airRefreshSection(cn,si);}
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
    ProjectWorkflow.setCandidate(info.section,candidate,(selected?'局部修改：':'整节修改：')+instruction,{logicRevision:reportLogicRevision(info.chapter,info.section,instruction)});saveDraft();airSaveState();document.getElementById('airRevisionModal')?.remove();airRefreshSection(cn,si);
    try{fetch('/api/revlog',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders()),body:JSON.stringify({chapter:info.chapter.name,section:info.section.t,instruction,scope:selected?'selection':'section'})});}catch(e){}
  }catch(e){if(out)out.innerHTML='<span style="color:var(--seal-red)">修改失败：'+escapeHtml(e.message)+'</span>';btn.disabled=false;btn.textContent='生成候选稿';}
}
async function airResolveRevision(cn,si,action){
  const info=findChapterSection(cn,si);if(!info||!window.ProjectWorkflow)return;
  if(action==='accept'||action==='adopt'){
    const revision=info.section.pendingRevision?.logicRevision;
    ProjectWorkflow.acceptCandidate(info.section);ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta('在AI可研预览接受AI修改'));
    if(action==='adopt'){try{const result=await adoptReportLogicRevision(info.chapter,info.section,revision);alert(result.message);}catch(error){alert('正文已接受，但逻辑采纳失败：'+error.message);}}
  }
  else if(action==='reject')ProjectWorkflow.rejectCandidate(info.section);
  else if(action==='undo'){if(!ProjectWorkflow.undoSection(info.section))return;ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta('在AI可研预览撤销修改'));}
  saveDraft();airSaveState();airRefreshSection(cn,si);
}
function airOpenSectionLogicEditor(cn,si){
  const info=findChapterSection(cn,si);if(!info)return;
  const backendRules=window.ReportLogicCore?ReportLogicCore.match(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",info.chapter.name,info.section.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" "),businessScenario:airBusinessScenario()}):[];
  const snapshot=info.section.logicSnapshot?.localOverride?info.section.logicSnapshot:reportSectionLogicSnapshot(info.chapter,info.section,backendRules);
  document.getElementById("airSectionLogicModal")?.remove();
  const rows=(snapshot.rules||[]).map((rule,index)=>'<div class="air-logic-edit-row" data-index="'+index+'"><b>'+(rule.sourceNo?'第'+escapeHtml(rule.sourceNo)+'项':'逻辑'+(index+1))+' · '+escapeHtml(rule.title||info.section.t)+'</b><label>生成方法<textarea class="air-logic-writing" rows="4">'+escapeHtml(rule.writingLogic||'')+'</textarea></label><label>输出形式<input class="air-logic-output" value="'+escapeHtml(rule.outputForm||'文字')+'"></label></div>').join("");
  document.body.insertAdjacentHTML("beforeend",'<div class="air-modal-overlay" id="airSectionLogicModal"><div class="air-modal-card air-section-logic-modal"><div class="air-modal-head"><div><b>调整本节生成逻辑 · '+escapeHtml(info.section.t)+'</b><span>仅作用于当前项目和本小节。保存后可生成候选稿，但不会直接改后台规则，也不会进入下载的 Word。</span></div><button type="button" class="air-modal-close">×</button></div><div class="air-logic-edit-list">'+(rows||'<p>本节暂未匹配到可编辑规则。</p>')+'</div><div class="air-enhance-guard">安全边界：这里先形成项目级临时逻辑；正文须人工接受。若以后选择“接受并采纳为后台逻辑”，仍需通过自动评测与管理员权限。</div><div class="air-modal-actions"><button type="button" class="btn ghost air-logic-reset">恢复后台逻辑</button><button type="button" class="btn ghost air-modal-close">取消</button><button type="button" class="btn air-logic-save">仅保存逻辑</button><button type="button" class="btn air-logic-generate">保存并生成候选稿</button></div></div></div>');
  const modal=document.getElementById("airSectionLogicModal"),close=()=>modal?.remove();
  modal.querySelectorAll(".air-modal-close").forEach(button=>button.onclick=close);
  modal.querySelector(".air-logic-reset").onclick=()=>{info.section.logicSnapshot=reportSectionLogicSnapshot(info.chapter,info.section,backendRules);saveDraft();airSaveState();close();airRefreshSection(cn,si);};
  modal.querySelector(".air-logic-save").onclick=()=>airSaveSectionLogicEditor(info,cn,si,false);
  modal.querySelector(".air-logic-generate").onclick=()=>airSaveSectionLogicEditor(info,cn,si,true);
}
async function airSaveSectionLogicEditor(info,cn,si,generateCandidate){
  const modal=document.getElementById("airSectionLogicModal");if(!modal)return;
  const base=reportSectionLogicSnapshot(info.chapter,info.section),rules=[...modal.querySelectorAll(".air-logic-edit-row")].map((row,index)=>Object.assign({},base.rules?.[index]||{}, {writingLogic:row.querySelector(".air-logic-writing").value.trim(),outputForm:row.querySelector(".air-logic-output").value.trim()||"文字",changeReason:"当前项目人工调整"}));
  if(!rules.length)return alert("本节暂未匹配到生成逻辑，不能保存。");
  info.section.logicSnapshot=Object.assign({},base,{rules,localOverride:true,updatedAt:new Date().toISOString(),changeReason:"当前项目人工调整"});
  saveDraft();airSaveState();
  if(!generateCandidate){modal.remove();airRefreshSection(cn,si);return;}
  const button=modal.querySelector(".air-logic-generate");button.disabled=true;button.textContent="正在生成候选稿…";
  try{
    const text=await generateSection(info.chapter,info.section);
    ProjectWorkflow.setCandidate(info.section,text,"按项目级生成逻辑重新起草",{logicRevision:info.section.logicSnapshot});
    saveDraft();airSaveState();modal.remove();airRefreshSection(cn,si);
  }catch(error){button.disabled=false;button.textContent="保存并生成候选稿";alert("候选稿生成失败："+error.message);}
}
function airSectionMaterialState(chapter,section){
  if(!window.ReportLogicCore)return {rules:[],missing:[],ready:false};
  const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",ctx=airMaterialContext(),rules=ReportLogicCore.match(type,chapter.name,section.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" "),businessScenario:ctx.businessScenario});
  const statuses=rules.map(rule=>ReportLogicCore.generationReadiness?ReportLogicCore.generationReadiness(rule,ctx):ReportLogicCore.requirementStatus(rule,ctx)),missing=[...new Set(statuses.flatMap(x=>x.missing||[]))];
  const criticalRules=rules.filter((rule,index)=>statuses[index]&&statuses[index].level==="critical"),frameworkRules=rules.filter((rule,index)=>statuses[index]&&statuses[index].level==="framework");
  return {rules,statuses,missing,criticalRules,frameworkRules,ready:!!rules.length&&!missing.length,level:criticalRules.length?"critical":frameworkRules.length?"framework":"ready"};
}
function airRequirementChinese(value,kind){
  const maps={
    time:{effective_at_generation:"以报告生成日为准",latest_12_months:"最近12个月",latest_3_years:"最近3年",current_model_version:"当前测算模型版本",project_current:"本项目当前有效资料"},
    geo:{city:"所在城市",district:"所在行政区",street:"所在街道",radius:"项目周边范围",project:"本项目",multi_level:"国家与地方多层级",national:"全国",applicable_area:"政策适用区域"}
  };
  return maps[kind]?.[value]||(kind==="time"?"按本节所需统计时点":"按本项目适用范围");
}
function airRequirementSummary(requirement){
  const fields=(requirement.fields||[]).slice(0,4).map(field=>field.label).join("、")||"本节必要字段";
  const time=airRequirementChinese(requirement.timeScope?.kind,"time"),geo=airRequirementChinese(requirement.geoScope?.level,"geo");
  const quality=requirement.quality||{},budget=requirement.budget||{},version=Number(requirement.refinementVersion||0);
  return requirement.title+"〔字段："+fields+"；时点："+time+"；范围："+geo+"；质量：不低于"+(quality.minScore||80)+"分"+(quality.crossCheck?"、需交叉核验":"")+"；检索上限："+(budget.maxQueries||1)+"次/"+(budget.maxResults||5)+"条；"+(version?"已人工细化至第"+version+"版":"系统初始判断")+"〕";
}
function airSectionMaterialHtml(chapter,section,si){
  const st=airSectionMaterialState(chapter,section),type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",ctx=airMaterialContext(),plan=window.ReportLogicCore?.sourcePlan?ReportLogicCore.sourcePlan(type,chapter.name,section.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" "),location:project.location||"",businessScenario:ctx.businessScenario,context:ctx}):{needs:[],requirements:[]};
  const enhance=aiReportCanEnhanceLogic&&st.rules.length?'<button type="button" class="air-logic-enhance air-section-enhance" data-cn="'+chapter.cn+'" data-si="'+si+'">🛠 从本节成稿提炼增强规则</button>':'';
  const needs=plan.needs||[],needed=needs.filter(x=>!x.ready),requirements=plan.requirements||[],planText=(needed.length?needed:needs).map(x=>x.label+"："+x.task).join("；"),exactText=requirements.slice(0,3).map(airRequirementSummary).join("；");
  const css=st.ready?"ok":st.level==="critical"?"missing":"pending",title=st.ready?"本节依据已找到，智能数据需求仍可继续细化":st.level==="critical"?"框架将先生成，以下关键依据待补":"可先生成通用框架，项目事实后续核实";
  const ids=escapeHtml(st.rules.map(r=>r.id).join(",")),required=escapeHtml(planText);
  const upload='<button type="button" class="air-material-upload" data-rule-id="'+ids+'" data-chapter="'+escapeHtml(chapter.name)+'" data-section="'+escapeHtml(section.t)+'" data-cn="'+chapter.cn+'" data-si="'+si+'">＋ 上传材料并补强本节</button>';
  const webRequirement=requirements.find(x=>x.webAllowed),schema=webRequirement?encodeURIComponent(JSON.stringify(webRequirement)):"",web=st.missing.includes("web_search")&&webRequirement?'<button type="button" class="air-web-search" data-rule-id="'+ids+'" data-chapter="'+escapeHtml(chapter.name)+'" data-section="'+escapeHtml(section.t)+'" data-query="'+escapeHtml(webRequirement.query)+'" data-requirement-schema="'+schema+'" data-required-sources="'+required+'">🌐 精确联网（最多1次/5条）</button>':'';
  const editableRequirement=requirements[0],editSchema=editableRequirement?encodeURIComponent(JSON.stringify(editableRequirement)):"",refine=editableRequirement?'<button type="button" class="air-logic-enhance air-refine-requirement" data-requirement-schema="'+editSchema+'">🎯 调整本节数据需求</button>':'';
  const stop='系统按“已有资料 → 知识库 → 数据接口/测算 → 必要时精确联网 → 人工材料”寻源；字段和质量门槛满足即停止，不会无边界搜索。';
  return '<div class="air-section-material '+css+'"><b>↳ '+title+'</b><span><strong>智能判断的数据需求：</strong>'+escapeHtml(exactText||"根据论证任务识别字段、时点、地域、来源和质量门槛")+'</span><span><strong>当前寻源任务：</strong>'+escapeHtml(planText||"优先使用已有项目材料、知识库、数据接口和测算结果")+'</span><span>'+stop+'</span><div class="air-section-material-actions">'+web+refine+upload+enhance+'</div></div>';
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
    + c.sections.map((s,si)=>{const ready=!!(s.content||s.editedHtml),content=ready?renderContent(airSectionDisplayContent(c,s)):'<span class="skel" style="width:94%"></span><span class="skel" style="width:99%"></span><span class="skel" style="width:70%"></span>';return '<div class="section-block '+(ready?'':'pending')+'" id="sec_'+c.cn+'_'+si+'" data-status="'+(ready?'done':'pending')+'"><h4>'+s.t+(s.numeric?' ⚠数据':'')+(ready?'<span class="done-stamp">已拟</span>'+airTrustBadgeHtml(s):'')+'</h4>'+(ready?renderSectionLogicHtml(c,s,true):'')+airSectionMaterialHtml(c,s,si)+(ready?airSectionToolsHtml(c,s,si):'')+'<div class="body">'+content+'</div>'+airCandidateHtml(c,s,si)+'</div>';}).join("")
    +'</div>').join("");
  pane.innerHTML = '<div class="air-doc-head"><div class="air-doc-heading"><div class="air-doc-title">'+escapeHtml(project.name||"未命名项目")+'</div>'
    +'<div class="air-doc-meta">'+escapeHtml(project.industry||"")+' · 共 '+active.length+' 章 / '+totalSec+' 个子标题</div></div>'
    +'<div class="air-doc-actions">'+airReportVersionSelectHtml("current")+'<button type="button" class="air-doc-tool air-doc-chat-toggle">收起对话</button><button type="button" class="air-doc-tool air-doc-outline-toggle">收起章节</button><span class="air-doc-zoom"><button type="button" class="air-doc-tool air-doc-zoom-out" title="缩小">−</button><button type="button" class="air-doc-tool air-doc-zoom-reset" title="恢复100%"><span class="air-doc-zoom-value">100%</span></button><button type="button" class="air-doc-tool air-doc-zoom-in" title="放大">＋</button></span><button type="button" class="air-doc-tool air-doc-download">下载 Word</button><button type="button" class="air-doc-tool air-doc-fullscreen">全屏阅读</button><button type="button" class="air-doc-close" title="关闭报告预览">✕</button></div></div>'
    +'<div class="air-doc-outline">'+outline+'</div>'
    +'<input type="file" id="airDocMaterialFile" accept=".txt,.md,.doc,.docx,.pdf,.xlsx,.xls,.csv" multiple hidden>'
    +'<div class="air-doc-scroll" id="airDocScroll">'+body+'</div>';
  aiReportHasDoc = true;
  airSetDocVisible(true);
  airApplyDocViewState();
}
function airCompletedVersionForProgress(progress){
  if(!window.ProjectWorkflow?.latestCompleteReportVersion)return null;
  return ProjectWorkflow.latestCompleteReportVersion(projectWorkflow,progress&&progress.reportVersionId);
}
function airReportVersionSelectHtml(selectedId){
  const versions=Array.isArray(projectWorkflow&&projectWorkflow.reportVersions)?[...projectWorkflow.reportVersions].reverse():[];
  return '<label class="air-doc-version-picker">查看版本 <select class="air-doc-version-select"><option value="current" '+(selectedId==="current"?'selected':'')+'>当前工作稿</option>'+versions.map(version=>'<option value="'+escapeHtml(version.id)+'" '+(selectedId===version.id?'selected':'')+'>报告第'+Number(version.version||1)+'版 · '+escapeHtml(version.reason||"已保存版本")+'</option>').join("")+'</select></label>';
}
function airSavedVersionRules(chapter,section){
  const snapshotRules=section&&section.logicSnapshot&&Array.isArray(section.logicSnapshot.rules)?section.logicSnapshot.rules:[];
  let currentRules=[];
  if(window.ReportLogicCore){
    const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",ctx=airMaterialContext();
    currentRules=ReportLogicCore.match(type,chapter.name,section.t,{projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" "),businessScenario:ctx.businessScenario})||[];
  }
  if(!snapshotRules.length)return {rules:currentRules,reconstructed:true};
  return {rules:snapshotRules.map(saved=>Object.assign({},currentRules.find(rule=>rule.id===saved.id)||{},saved)),reconstructed:false};
}
function airSavedVersionLogicHtml(chapter,section){
  const set=airSavedVersionRules(chapter,section),rules=set.rules;
  if(!rules.length)return '<div class="rpt-logic-note"><b>本节生成逻辑</b><div>该早期版本未保存逻辑快照，当前规则库也未匹配到对应规则。</div></div>';
  return '<div class="rpt-logic-note"><b>本节生成逻辑'+(set.reconstructed?'（按当前适用规则补显）':'（该版本快照）')+'</b><div>'+rules.map((rule,index)=>escapeHtml((rule.sourceNo?'第'+rule.sourceNo+'项：':'逻辑'+(index+1)+'：')+(rule.writingLogic||rule.title||"按本节规则生成")+(rule.outputForm?'；输出：'+rule.outputForm:''))).join("<br>")+'</div></div>';
}
function airSavedVersionFrameworkHtml(chapter,section){
  const set=airSavedVersionRules(chapter,section),rules=set.rules;
  if(!rules.length)return '<div class="air-section-material pending"><b>↳ 本版框架与数据需求（只读）</b><span>该早期版本没有保存对应框架，当前规则库也未匹配到该小节。</span></div>';
  return '<div class="air-section-material pending"><b>↳ 本版框架与数据需求（只读'+(set.reconstructed?'，按当前规则补显':'')+'）</b><span><strong>所需数据与材料：</strong>'+escapeHtml(rules.map(rule=>rule.requiredSources||"按本节论证需要取得项目事实、测算结果和适用依据").join("；"))+'</span><span><strong>输出框架：</strong>'+escapeHtml(rules.map(rule=>rule.outputForm||"文字").join("；"))+'</span><span><strong>缺失处理：</strong>'+escapeHtml(rules.map(rule=>rule.missingPolicy||"缺失内容标注待补，不得虚构").join("；"))+'</span></div>';
}
function airOpenCompletedVersion(progress){
  const version=airCompletedVersionForProgress(progress);
  if(!version){alert("没有找到可恢复的完整历史版本；当前工作稿仍保留，可继续生成缺失小节。");return;}
  airOpenReportVersionById(version.id);
}
function airOpenReportVersionById(versionId){
  const versions=Array.isArray(projectWorkflow&&projectWorkflow.reportVersions)?projectWorkflow.reportVersions:[],version=versions.find(item=>item&&item.id===versionId);
  if(!version){alert("没有找到这个报告版本，可能已被删除或尚未保存。");airRestoreDocPaneIfNeeded();return;}
  const pane=document.getElementById("airDocPane");if(!pane)return;
  const active=(version.chapters||[]).filter(c=>c.checked!==false),total=active.reduce((n,c)=>n+(c.sections||[]).length,0);
  const outline=active.map(c=>'<span class="chip" data-cn="saved_'+escapeHtml(c.cn)+'"><i class="air-material-dot ok"></i>'+escapeHtml(c.cn)+'·'+escapeHtml(c.name)+'</span>').join("");
  const body=active.map(c=>'<div class="chapter-block" id="block_saved_'+escapeHtml(c.cn)+'"><h3><span class="cn">'+escapeHtml(c.cn)+'</span>'+escapeHtml(c.name)+'</h3>'+(c.sections||[]).map((s,si)=>{
    const source=s.editedHtml&&typeof blocksToSource==="function"?blocksToSource(s.editedHtml):(s.content||"");
    return '<div class="section-block" id="saved_sec_'+escapeHtml(c.cn)+'_'+si+'"><h4>'+escapeHtml(s.t)+'<span class="done-stamp">该版已拟</span></h4>'+airSavedVersionLogicHtml(c,s)+airSavedVersionFrameworkHtml(c,s)+'<div class="body">'+renderContent(source)+'</div></div>';
  }).join("")+'</div>').join("");
  pane.classList.remove("empty");
  pane.innerHTML='<div class="air-doc-head"><div class="air-doc-heading"><div class="air-doc-title">'+escapeHtml(project.name||"未命名项目")+' · 第'+Number(version.version||1)+'版报告</div><div class="air-doc-meta">历史版本只读预览 · 共 '+active.length+' 章 / '+total+' 个子标题；不会覆盖当前工作稿</div></div><div class="air-doc-actions">'+airReportVersionSelectHtml(version.id)+'<button type="button" class="air-doc-tool air-doc-current-draft">返回当前工作稿</button><button type="button" class="air-doc-tool air-doc-chat-toggle">收起对话</button><span class="air-doc-zoom"><button type="button" class="air-doc-tool air-doc-zoom-out">−</button><button type="button" class="air-doc-tool air-doc-zoom-reset"><span class="air-doc-zoom-value">100%</span></button><button type="button" class="air-doc-tool air-doc-zoom-in">＋</button></span><button type="button" class="air-doc-tool air-doc-fullscreen">全屏阅读</button><button type="button" class="air-doc-close">✕</button></div></div><div class="air-doc-outline">'+outline+'</div><div class="air-doc-scroll" id="airDocScroll">'+body+'</div>';
  airSetDocVisible(true);airApplyDocViewState();
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
  if(!chapters.length) return;
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
  else if(m.stopped&&m.total>m.done) actions = (m.recoveredFromMismatch&&airCompletedVersionForProgress(m)?'<button class="btn ghost air-progress-btn air-open-completed-version">📄 查看上一完整版本</button>':'')+'<button class="btn air-progress-btn air-resume-btn">▶ 继续'+(m.recoveredFromMismatch?'第二轮':'生成')+'剩余 '+(m.total-m.done)+' 节</button>';
  else actions = '<button class="btn air-progress-btn air-open-preview-btn">📄 查看已有报告</button><button class="btn ghost air-progress-btn air-regenerate-btn">🔒 重新生成全部</button>';
  const label = m.active? "⏳ 正在起草，可在右侧实时查看…" : (m.recoveredFromMismatch?"⚠ 已识别为后续一轮未完成稿":(m.stopped&&m.total>m.done? "⏸ 已暂停" : "✅ 本轮生成已完成"));
  const versionNo=Number(m.reportVersion||m.targetReportVersion)||0,versionLabel=versionNo?'报告第'+versionNo+'版 · ':'';
  return '<div class="air-progress-card"><div style="flex:1; min-width:180px;">'
    +'<div class="air-progress-text">'+versionLabel+label+'　已完成 '+m.done+'/'+m.total+(m.failed?'（失败 '+m.failed+'）':'')+'</div>'
    +'<div class="air-progress-bar"><div class="air-progress-bar-fill" style="width:'+pct+'%;"></div></div>'
    +'</div><div class="air-progress-actions">'+actions+'</div></div>';
}

/* 测算和起草报告是两步：这张卡片是测算和生成之间的停顿点，人工确认数字没问题了再往下点。 */
function airGenConfirmHtml(){
  if(airStageAtLeast("generating")) return '<div class="air-card air-step-done"><b>✓ 已进入可研生成阶段</b><span>请查看当前生成进度或右侧报告预览；已完成的小节可立即重写、AI修改或拖选局部修改。</span></div>';
  const logic=window.ReportLogicCore?ReportLogicCore.overview(calcType||(calcResult&&calcResult.__ctype)||rptCtype,{businessScenario:airBusinessScenario()}):null;
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
  const entries=Array.isArray(kbEntries)?kbEntries:[],hasKnowledge=entries.some(x=>x.source==="rag"||x.source==="knowledge_base"||x.kind==="wiki"),hasProviderData=entries.some(x=>x.source==="provider"||x.kind==="provider"||x.provider),hasManualMaterial=entries.some(x=>x.source==="project_upload"||x.fileName||x.ruleIds?.length);
  return {businessScenario:airBusinessScenario(),location:project.location||aiReportExtracted?.location||"",hasKnowledge,hasWebEvidence:!!web.hasWebEvidence,hasProviderData,hasManualMaterial,hasCalculation:!!(calcParams&&calcResult),hasDerivedSection:chapters.some(c=>c.sections.some(s=>!!(s.content||s.editedHtml))),evidenceByRule,requirementOverrides:web.requirementOverrides||{}};
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
  const rowHtml=item=>{const status=item.ready?'<span style="color:var(--ok-green);">✓ 已确认找到</span>':'<span style="color:var(--red);">● 待补充/待检索</span>';const kinds=(item.sourceKinds||[]).length?item.sourceKinds:["unclassified"];const channels=kinds.map(kind=>'<span style="display:inline-block;border:1px solid '+(item.missing.includes(kind)?'#e6a5a0':'#b7ddc6')+';background:'+(item.missing.includes(kind)?'#fff0ef':'#edf8f1')+';color:'+(item.missing.includes(kind)?'var(--red)':'var(--ok-green)')+';padding:1px 5px;border-radius:8px;margin:1px;font-size:10.5px;">'+escapeHtml(labels[kind]||kind)+'</span>').join(""),req=item.dataRequirement||null,reqHtml=req?'<div style="color:var(--ok-green);margin-top:4px;">'+escapeHtml(airRequirementSummary(req))+'</div>':'',web=item.missing.includes("web_search")&&req?.webAllowed?'<button type="button" class="air-web-search" data-rule-id="'+escapeHtml(item.ruleId)+'" data-chapter="'+escapeHtml(item.chapter)+'" data-section="'+escapeHtml(item.section||item.title)+'" data-query="'+escapeHtml(req.query)+'" data-requirement-schema="'+encodeURIComponent(JSON.stringify(req))+'" data-required-sources="'+escapeHtml(item.requiredSources)+'">🌐 精确联网</button>':'';return '<tr><td style="white-space:nowrap;">第'+item.sourceNo+'项</td><td><b>'+escapeHtml(item.title)+'</b><div style="color:var(--ink-soft);margin-top:3px;white-space:pre-line;">'+escapeHtml(item.requiredSources)+'</div>'+reqHtml+'</td><td>'+channels+'</td><td><div class="air-material-row-actions">'+status+(item.blocking?'<span style="font-size:10px;color:var(--red);">重要阻断</span>':'')+(req?'<button type="button" class="air-refine-requirement" data-requirement="'+encodeURIComponent(JSON.stringify(req))+'">🎯 调整数据需求</button>':'')+web+'<button type="button" class="air-material-upload" data-rule-id="'+escapeHtml(item.ruleId)+'" data-chapter="'+escapeHtml(item.chapter)+'" data-section="'+escapeHtml(item.section||item.title)+'">＋ 上传补充</button></div></td></tr>';};
  const content='<div class="air-card"><div class="air-step-done" style="margin-bottom:10px;"><b>材料完整性台账 · 逻辑 v'+inv.version+'</b><span>共'+inv.total+'项、'+inv.chapters.length+'章。以下来源数量允许交叉，例如同一小节可能同时需要知识库和人工材料。</span></div>'
    +(aiReportCanEnhanceLogic?'<div class="air-enhance-entry-tip"><b>管理员增强模式已开启</b><span>请先生成右侧正文并持续修改；定稿后从对应小节点击“从本节成稿提炼增强规则”，AI会比较版本并交由管理员审定。</span></div>':'')
    +'<div style="display:grid;grid-template-columns:repeat(7,minmax(86px,1fr));gap:7px;margin-bottom:10px;">'+stat(sum.ready,"已确认找到","var(--ok-green)")+stat(sum.system_rule,"系统规则直接生成","var(--bp)")+stat(sum.pendingKnowledge,"需从知识库检索","var(--red)")+stat(sum.pendingWeb,"需网上检索","var(--red)")+stat(sum.pendingProvider,"需调用数据接口","var(--red)")+stat(sum.pendingCalculation,"需从测算引擎取得","var(--red)")+stat(sum.pendingManual,"需人工上传","var(--red)")+'</div>'
    +'<div style="display:flex;gap:7px;margin-bottom:8px;flex-wrap:wrap;"><button type="button" class="btn sm ghost" id="airMaterialExpandAll">展开全部</button><button type="button" class="btn sm ghost" id="airMaterialCollapseAll">收起全部</button><button type="button" class="btn sm ghost air-material-ask" data-prompt="请把全报告'+inv.total+'项材料需求按章节列成完整Markdown表格，列出序号、材料名称、获取渠道、当前状态和是否阻断，不要省略。">让AI列完整材料表</button><button type="button" class="btn sm air-batch-web-search" id="airBatchWebSearch" '+(sum.pendingWeb||batch?'':'disabled')+'>'+batchLabel+'</button><button type="button" class="btn sm air-batch-material-upload" id="airBatchMaterialUpload">＋ 批量上传材料</button></div>'
    +'<div style="max-height:470px;overflow:auto;border:1px solid var(--line);border-radius:8px;">'+inv.chapters.map(g=>'<details class="air-material-chapter" style="border-bottom:1px solid var(--line);"><summary style="cursor:pointer;padding:11px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><b style="min-width:210px;">'+escapeHtml(g.chapter)+'</b><span style="color:var(--ok-green);">已找到 '+g.counts.ready+'/'+g.total+'</span><span style="color:var(--red);">需知识库检索 '+g.counts.pendingKnowledge+'</span><span style="color:var(--red);">需网搜 '+g.counts.pendingWeb+'</span><span style="color:var(--red);">需接口 '+g.counts.pendingProvider+'</span><span style="color:var(--red);">需测算 '+g.counts.pendingCalculation+'</span><span style="color:var(--red);">需上传 '+g.counts.pendingManual+'</span></summary><div style="padding:0 10px 11px;"><table class="air-material-table" style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="text-align:left;background:#f5f8fb;"><th style="padding:7px;">序号</th><th style="padding:7px;">具体需要的内容/材料</th><th style="padding:7px;">获取渠道</th><th style="padding:7px;min-width:150px;">当前状态/补充</th></tr></thead><tbody>'+g.items.map(rowHtml).join("")+'</tbody></table><button type="button" class="btn sm ghost air-material-ask" style="margin-top:8px;" data-prompt="请把'+escapeHtml(g.chapter)+'全部材料需求列成表格，并告诉我应该先补哪几项。">询问本章补充顺序</button></div></details>').join("")+'</div>'
    +'<input type="file" id="airMaterialFile" accept=".txt,.md,.doc,.docx,.pdf,.xlsx,.xls,.csv" multiple hidden>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><button class="btn air-start-gen">先联网检索并集中确认 →</button><button class="btn" id="airBackgroundSearchGenerate">后台检索并立即开始可研生成 →</button><button class="btn ghost air-material-ask" data-prompt="请按重要程度汇总全报告必须由我人工补充的材料清单，并列成表格">仅汇总人工材料</button></div><div style="font-size:11.5px;color:var(--ink-soft);margin-top:8px;">“先联网检索”会等待你集中采用依据后再生成；“后台检索并立即生成”会让联网任务继续运行，同时先按现有资料起草可研，完成后可回到批量检索采用高价值来源并更新受影响章节。上传材料只关联你选择的逻辑项。</div></div>';
  return airPersistentCardHtml("materials","数据与材料来源","共"+(inv.total||0)+"项；待知识库"+(sum.pendingKnowledge||0)+"、待网搜"+(sum.pendingWeb||0)+"、待人工"+(sum.pendingManual||0),content,false);
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
  const coverage=airReportGenerationStatus();
  if(coverage.complete){airOpenExistingReport("🔒 已有完整可研报告，本次后台检索和重复生成已被阻止，原版没有被覆盖。");return;}
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
  else if(lower.endsWith(".doc")){
    if(Number(file.size||0)>12*1024*1024)throw new Error("旧版 .doc 单文件不能超过12MB");
    const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const response=await fetch("/api/aireport",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"parseLegacyDoc",name:file.name,dataBase64:btoa(binary)})}),data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||"旧版 .doc 解析失败，请另存为 .docx 后重试");
    text=data.text||"";
  }
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
  }else throw new Error("暂不支持该格式，请上传 Word（.doc/.docx）、PDF、Excel、CSV、TXT 或 Markdown");
  text=String(text||"").replace(/\n{4,}/g,"\n\n").trim();
  if(!text)throw new Error("未提取到文字；若为扫描件PDF，请先OCR后上传");
  return text.slice(0,80000)+(text.length>80000?"\n…（超长材料已保留前8万字）":"");
}
function airInitialMaterialExcerpt(text,limit){
  const raw=String(text||""),lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),keywords=/项目|地块|地址|地点|坐落|位置|街道|社区|道路|区|建设单位|委托单位|业主|改造|保障房|公租房|保租房|商业|出租|出售|面积|开工|工期|土地性质/;
  const selected=[],seen=new Set();
  [...lines.filter(x=>keywords.test(x)),...lines.slice(0,35)].forEach(line=>{const value=line.slice(0,500);if(value&&!seen.has(value)){seen.add(value);selected.push(value);}});
  return selected.join("\n").slice(0,Math.max(1200,limit||4000));
}
function airSavedInitialMaterials(){
  const names=new Set((aiReportExtracted&&aiReportExtracted.sourceFileNames||[]).map(String));
  return (kbEntries||[]).filter(entry=>entry&&entry.sourceType==="project_upload"&&entry.content&&(entry.intake===true||names.has(String(entry.fileName||""))));
}
function airInitialMaterialRows(value){
  const supplied=Array.isArray(value&&value.files)?value.files:Array.isArray(aiReportExtracted&&aiReportExtracted.sourceFiles)?aiReportExtracted.sourceFiles:[];
  const saved=airSavedInitialMaterials(),byName=new Map(saved.map(entry=>[String(entry.fileName||entry.title||""),entry]));
  const names=(aiReportExtracted&&aiReportExtracted.sourceFileNames||[]).map(fileName=>({fileName})),base=supplied.length?supplied:saved.length?saved:names;
  const rows=base.map(entry=>{const name=String(entry.fileName||entry.name||entry.title||"未命名材料"),stored=byName.get(name)||{};return Object.assign({},stored,entry,{fileName:name,parsedChars:Number(entry.parsedChars||entry.content?.length||stored.content?.length||0),sizeBytes:Number(entry.sizeBytes||stored.sizeBytes||0),objectStored:entry.objectStored===true||stored.objectStored===true});});
  const seen=new Set();return rows.filter(row=>row.fileName&&!seen.has(row.fileName)&&(seen.add(row.fileName),true));
}
function airFormatBytes(bytes){const n=Number(bytes)||0;if(!n)return "大小未记录";if(n<1024)return n+" B";if(n<1024*1024)return (n/1024).toFixed(1)+" KB";return (n/1024/1024).toFixed(1)+" MB";}
function airMaterialResultHtml(message){
  const files=airInitialMaterialRows(message),stored=files.filter(file=>file.objectStored).length;
  const chips=files.map(file=>'<span class="air-saved-file-chip" title="'+escapeHtml(file.fileName)+'">📄 '+escapeHtml(file.fileName)+'</span>').join("");
  const rows=files.map(file=>{const status=file.objectStored?'<b class="air-storage-ok">原件已归档</b>':'<b class="air-storage-legacy">原件未归档'+(file.storageWarning?'':'（旧上传）')+'</b>',hash=file.contentHash?'<small>SHA-256：'+escapeHtml(String(file.contentHash).slice(0,16))+'…</small>':'';return '<div class="air-saved-file-row"><span><b>'+escapeHtml(file.fileName)+'</b><small>'+airFormatBytes(file.sizeBytes)+'｜已解析 '+Number(file.parsedChars||0).toLocaleString("zh-CN")+' 字</small></span><span>'+status+hash+(file.storageWarning?'<small>'+escapeHtml(file.storageWarning)+'</small>':'')+'</span></div>';}).join("");
  const extraction=message.extractionStatus==="degraded"?'文件已解析；AI字段抽取曾降级，信息卡仍需人工核对。':'文件已解析，并已形成待核对的信息草稿。';
  return '<div class="air-completed-step air-material-result"><div class="air-completed-step-head"><span><b>✓ 已处理 '+files.length+' 份项目材料</b><small>'+escapeHtml(extraction)+'</small></span></div><div class="air-saved-file-chips">'+chips+'</div><div class="air-material-storage-summary"><span>解析文本：已保存到浏览器草稿，并随登录项目同步到项目数据库。</span><span>原件：'+stored+'/'+files.length+' 份已进入 SHA-256 对象存储。'+(stored<files.length?'未归档的旧文件需重新选择一次才能补存原件。':'')+'</span></div><details class="air-native-detail"><summary>查看存储详情</summary><div class="air-completed-step-detail">'+rows+'</div></details></div>';
}
async function airFileToBase64(file){
  const bytes=new Uint8Array(await file.arrayBuffer()),parts=[];for(let offset=0;offset<bytes.length;offset+=32768)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));return btoa(parts.join(""));
}
async function airStoreProjectOriginal(file){
  if(!currentProjectId)return {objectStored:false,storageWarning:"项目尚未建立，原件未归档"};
  try{
    const response=await fetch("/api/projectworkspace",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"storeProjectOriginal",projectId:currentProjectId,name:file.name,mimeType:file.type||"application/octet-stream",dataBase64:await airFileToBase64(file)})}),data=await response.json();
    if(!response.ok||!data.ok)return {objectStored:false,storageWarning:data.error||"原件对象存储暂不可用"};
    if(!data.stored)return {objectStored:false,storageWarning:data.warning||"当前部署未配置原件对象存储"};
    return {objectStored:true,contentHash:data.object&&data.object.contentHash||"",storageKey:data.object&&data.object.storageKey||"",sizeBytes:Number(data.object&&data.object.sizeBytes||file.size||0),fileId:data.fileId||"",version:data.version||1,deduplicated:!!(data.object&&data.object.deduplicated)};
  }catch(error){return {objectStored:false,storageWarning:"原件归档失败："+error.message};}
}
function airInitialMaterialsPrompt(parsed){
  const perFile=Math.max(1800,Math.floor(28000/Math.max(1,parsed.length)));
  return parsed.map((entry,index)=>"【材料"+(index+1)+"："+(entry.fileName||entry.title||("材料"+(index+1)))+"】\n"+airInitialMaterialExcerpt(entry.content,perFile)).join("\n\n").slice(0,30000);
}
function airMaterialExtractionNeedsRetry(value){
  const v=value||aiReportExtracted||{};
  if(v.__materialExtractionDegraded===true)return true;
  if(!v.__fromMaterials||!(v.sourceFileNames||[]).length)return false;
  const blank=!v.projectName&&!v.location&&!v.calcType&&!v.owner&&v.landArea==null&&v.startYear==null;
  return blank&&aiReportChat.some(message=>/外部AI暂时不可用|本地字段标签.*保守预填/.test(String(message&&message.content||"")));
}
function airNullableExtractedText(value){
  const text=String(value==null?"":value).trim();
  return !text||/^(?:null|undefined|none|未提及|不详)$/i.test(text)?null:text;
}
function airMergeMaterialExtraction(extracted){
  const current=Object.assign({},aiReportExtracted||{}),incoming=extracted||{};
  ["projectName","location","owner","landNature","desc"].forEach(key=>{incoming[key]=airNullableExtractedText(incoming[key]);});
  ["projectName","location","calcType","businessScenario","landArea","landPrice","startYear","owner","landNature","desc"].forEach(key=>{
    if((current[key]==null||current[key]==="")&&incoming[key]!=null&&incoming[key]!=="")current[key]=incoming[key];
  });
  const hasUsableSites=Array.isArray(current.analysisSites)&&current.analysisSites.some(site=>site&&(site.name||site.address));
  if(!hasUsableSites&&Array.isArray(incoming.analysisSites)&&incoming.analysisSites.length)current.analysisSites=incoming.analysisSites;
  current.__manual=false;current.__fromMaterials=true;current.__materialExtractionDegraded=false;current.__materialRetryAt=Date.now();
  current.analysisSites=airAnalysisSites(current);return current;
}
async function airRetrySavedMaterialExtraction(automatic=false){
  if(aiReportBusy)return;
  const parsed=airSavedInitialMaterials();
  if(!parsed.length){if(!automatic)alert("没有找到已保存的原始解析材料，请重新选择文件一次。");return;}
  if(document.getElementById("air_name"))airCaptureInfoCard();
  aiReportExtracted.__materialRetryAt=Date.now();airSaveState();
  const loading=airPushLoading("正在用已恢复的公网DeepSeek重新提取 "+parsed.length+" 份已保存材料…");airSetBusy(true);
  try{
    const response=await fetch("/api/aireport",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"extract",text:airInitialMaterialsPrompt(parsed),materialMode:true})}),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||"重新提取失败");
    if(data.degraded){aiReportExtracted.__materialExtractionDegraded=true;throw new Error(data.degradedReason||"公网DeepSeek未形成有效抽取结果，已保留当前材料和填写内容");}
    aiReportExtracted=airMergeMaterialExtraction(data.data);
    const oldWarning=aiReportChat.find(message=>message.kind==="text"&&/外部AI暂时不可用|本地字段标签.*保守预填/.test(String(message.content||"")));
    if(oldWarning)Object.assign(oldWarning,{kind:"materialResult",content:"",files:airInitialMaterialRows(),extractionStatus:"extracted"});
    const materialResult=aiReportChat.find(message=>message.kind==="materialResult");if(materialResult)materialResult.extractionStatus="extracted";
    aiReportChat=aiReportChat.filter(message=>!/^重新AI提取暂未完成：/.test(String(message&&message.content||"")));
    airResolve(loading,{kind:"text",content:"✓ 已重新提取并自动回填信息卡；原材料没有重复上传，已有人工填写内容也不会被覆盖。"});
    saveDraft();airSaveState();renderAiReportMsgs();
  }catch(error){airResolve(loading,{kind:"text",content:"重新AI提取暂未完成："+error.message+"。材料和当前填写内容均已保留，可稍后点击信息卡顶部按钮重试。"});airSaveState();}
  finally{airSetBusy(false);}
}
function airMaybeAutoRetryMaterialExtraction(){
  if(aiReportMaterialAutoRetryStarted||!airMaterialExtractionNeedsRetry())return;
  const last=Number(aiReportExtracted&&aiReportExtracted.__materialRetryAt||0);if(last&&Date.now()-last<60000)return;
  aiReportMaterialAutoRetryStarted=true;setTimeout(()=>airRetrySavedMaterialExtraction(true),250);
}
async function airPrepareInitialProjectFiles(files){
  files=Array.from(files||[]);if(!files.length||aiReportBusy)return;
  if(files.length>12){alert("一次最多上传12份材料；如材料更多，请先上传最能确定项目名称、地点和类型的文件。");return;}
  const totalBytes=files.reduce((sum,file)=>sum+(Number(file.size)||0),0);
  if(totalBytes>50*1024*1024){alert("本批材料超过50MB，请分批上传，优先选择项目基本情况、资产清单和地址表。");return;}
  if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);}
  if(!project.name)project.name="AI可研待确认项目";
  const loading=airPushLoading("正在本地解析 "+files.length+" 份材料，并提取项目名称、点位和类型候选…");airSetBusy(true);
  try{
    if(typeof cloudSaveNow==="function"&&getToken())await cloudSaveNow();
    const parsed=[];for(const file of files){const content=await airParseProjectMaterial(file),storage=await airStoreProjectOriginal(file);parsed.push(Object.assign({fileName:file.name,content,sizeBytes:Number(file.size)||0,mimeType:file.type||"application/octet-stream",parsedChars:content.length},storage));}
    const text=airInitialMaterialsPrompt(parsed);
    parsed.forEach(entry=>{if(!kbEntries.some(x=>x.sourceType==="project_upload"&&x.fileName===entry.fileName&&x.content===entry.content))kbEntries.push({title:String(entry.fileName).replace(/\.[^.]+$/,"")||"项目材料",content:entry.content,fileName:entry.fileName,sourceType:"project_upload",ruleIds:[],intake:true,uploadedAt:Date.now()});});
    parsed.forEach(entry=>{const saved=kbEntries.find(x=>x.sourceType==="project_upload"&&x.fileName===entry.fileName&&x.content===entry.content);if(saved)Object.assign(saved,entry);});
    saveDraft();
    let data;
    try{const response=await fetch("/api/aireport",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify({action:"extract",text,materialMode:true})});data=await response.json();if(!response.ok||!data.ok){const failure=new Error(data.error||"材料信息抽取失败");failure.authFailure=response.status===401||response.status===403;throw failure;}}
    catch(error){if(error&&error.authFailure)throw error;data={ok:true,degraded:true,degradedReason:"AI接口暂不可用",data:{projectName:"",location:"",analysisSites:null,calcType:null,businessScenario:null,landArea:null,landPrice:null,startYear:null,owner:"",landNature:"",desc:""}};}
    const extracted=data.data||{},sourceFiles=parsed.map(({content,...entry})=>entry);
    aiReportExtracted=Object.assign({projectName:"",location:"",calcType:null,businessScenario:null,landArea:null,landPrice:null,startYear:null,owner:"",landNature:"",desc:""},extracted,{__manual:false,__fromMaterials:true,__materialExtractionDegraded:!!data.degraded,__materialRetryAt:data.degraded?Date.now():0,sourceFileNames:parsed.map(x=>x.fileName),sourceFiles});
    aiReportExtracted.analysisSites=airAnalysisSites(aiReportExtracted);
    if(aiReportExtracted.calcType&&!aiReportChat.some(m=>m.kind==="typeTag")){
      const option=AI_CATEGORY_OPTIONS.find(x=>x.key===aiReportExtracted.calcType);if(option)aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"typeTag",content:option.label,calcType:option.key});
    }
    aiReportChat=aiReportChat.filter(m=>m.kind!=="infoCard");
    airResolve(loading,{kind:"materialResult",content:"",files:sourceFiles,extractionStatus:data.degraded?"degraded":"extracted"});
    aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"infoCard",content:""});
    saveDraft();airSaveState();renderAiReportMsgs();
  }catch(error){airResolve(loading,{kind:"text",content:"批量材料解析失败："+error.message+"。你可以删减文件后重试，或直接选择测算类型手动填写。"});}
  finally{airSetBusy(false);}
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
        suggestions:ReportLogicCore.suggestMaterialRuleLinks(type,file.name,content,8,{businessScenario:airBusinessScenario()})});
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
    +'<div class="air-enhance-guard">本次操作会保留原规则ID，在新版本中合并替换该规则；不会新增“逻辑＋子逻辑”。历史版本仍可追溯。</div>'
    +revisionBlock
    +'<details open><summary>查看现行基础逻辑</summary><div class="air-enhance-base"><b>现有所需材料</b><p>'+escapeHtml(base.requiredSources||"未指定")+'</p><b>现有写作逻辑</b><p>'+escapeHtml(base.writingLogic||"未指定")+'</p></div></details>'
    +'<div class="air-enhance-grid"><label>新增/细化的数据与材料来源<textarea id="airEnhanceSources" rows="4" placeholder="只写需要追加的内容，不必重复原规则">'+escapeHtml(c.requiredSources)+'</textarea></label><label>新增/细化的生成逻辑<textarea id="airEnhanceWriting" rows="4" placeholder="说明怎样核验、引用、分析和输出">'+escapeHtml(c.writingLogic)+'</textarea></label><label>来源渠道（逗号分隔）<input id="airEnhanceKinds" value="'+escapeHtml((c.sourceKinds||[]).join(","))+'"></label><label>输出形式<input id="airEnhanceOutput" value="'+escapeHtml(c.outputForm||"")+'"></label><label class="wide">缺失材料时的处理<input id="airEnhanceMissing" value="'+escapeHtml(c.missingPolicy||"")+'"></label><label class="wide">本次增强原因<input id="airEnhanceReason" value="'+escapeHtml(c.changeReason||"")+'" placeholder="例如：细化规划批复来源和指标勾稽方式"></label></div>'
    +'<div class="air-enhance-chat">'+(state.history.length?state.history.map(x=>'<div><b>'+escapeHtml(x.role==='user'?'管理员':'AI建议')+'：</b>'+escapeHtml(x.content)+'</div>').join(""):'<div class="muted">AI会比较本节第一版与当前成稿，提炼新增的材料要求、论证方法和输出方式；候选仍可人工增减，确认后才发布。</div>')+'</div>'
    +'<textarea id="airEnhanceInstruction" rows="2" placeholder="可补充你的判断；留空则由AI自动比较第一版与当前成稿并汇总增强经验"></textarea>'
    +'<div class="air-modal-actions"><button type="button" class="btn ghost air-modal-close">取消</button><button type="button" class="btn ghost" id="airAskEnhancement" '+(state.busy?'disabled':'')+'>AI汇总本节定稿经验</button><button type="button" class="btn" id="airPublishEnhancement" '+(state.busy?'disabled':'')+'>管理员审定并合并发布</button></div></div>';
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
    const answer=await callGen("你是保障房可研逐小节规则工程师。只输出JSON对象，字段为requiredSources、sourceKinds数组、writingLogic、outputForm、missingPolicy、changeReason。请把原规则与定稿经验合并为一条完整、可复用的替换规则；不得生成子规则，不得把某个项目的专属数值写成通用规则。材料来源要细到文件名、数据字段、统计期、版本和核验方法。","原规则：\n"+JSON.stringify(state.base)+"\n\n本节成稿演进：\n"+JSON.stringify(state.sectionContext||{})+"\n\n当前候选：\n"+JSON.stringify(state.candidate)+"\n\n管理员要求：\n"+instruction);
    const next=airParseEnhancementJson(answer);state.candidate=Object.assign({},state.candidate,next,{sourceKinds:Array.isArray(next.sourceKinds)?next.sourceKinds:state.candidate.sourceKinds});state.history.push({role:"assistant",content:"已形成一版增强候选，可继续修改或确认发布。"});
  }catch(error){state.history.push({role:"assistant",content:"本轮完善失败："+error.message});}finally{state.busy=false;airRenderLogicEnhancementModal();}
}
async function airPublishLogicEnhancement(){
  const state=aiReportLogicEnhanceState;if(!state||state.busy)return;const enhancement=airReadEnhancementFields();if(!enhancement.requiredSources&&!enhancement.writingLogic)return alert("至少补充一项材料来源或写作逻辑");
  const adminPass=prompt("请输入后台管理员密码以发布增强版本（密码只用于本次请求）：");if(adminPass===null)return;
  state.candidate=enhancement;state.busy=true;airRenderLogicEnhancementModal();
  try{
    const evalResponse=await fetch("/api/reportlogic",{method:"POST",headers:airAdminLogicHeaders(""),body:JSON.stringify({action:"evaluateRuleRevision",projectType:state.type,baseRuleId:state.base.id,businessScenario:airBusinessScenario(),revision:enhancement})}),evalData=await evalResponse.json();if(!evalResponse.ok||!evalData.ok)throw new Error(evalData.error||"自动评测失败");const evaluation=evalData.evaluation;if(!evaluation.recommended)throw new Error("自动评测未通过（现行 "+evaluation.oldScore+" 分，候选 "+evaluation.candidateScore+" 分）："+[...(evaluation.blockers||[]),...(evaluation.warnings||[])].join("；"));
    const response=await fetch("/api/reportlogic",{method:"POST",headers:airAdminLogicHeaders(adminPass),body:JSON.stringify({action:"mergeRuleRevision",projectType:state.type,baseRuleId:state.base.id,businessScenario:airBusinessScenario(),revision:enhancement})}),data=await response.json();
    if(!data.ok)throw new Error(data.error||"发布失败");
    document.getElementById("airLogicEnhanceModal")?.remove();aiReportLogicEnhanceState=null;await ReportLogicCore.load(state.type,true);await airCheckWholeReportMaterials();
    airPush({role:"assistant",kind:"text",content:"✓ 自动评测通过（"+evaluation.oldScore+"→"+evaluation.candidateScore+"），已在第"+state.base.sourceNo+"项原规则上合并定稿经验，未新增子规则；现已发布为生成逻辑 v"+data.set.version+"。下一次生成或补写相关小节时会自动采用新逻辑。"});
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
  const coverage=airReportGenerationStatus(),complete=coverage.complete;
  const title=complete?'下一步想做什么？':'下一步怎么处理当前工作稿？';
  const copy=complete?'你可以先复核签发，也可以继续在下方和我对话。我能预演参数变化、判断受影响章节，或者生成某一小节的候选修改稿；正式内容不会未经确认就被覆盖。':'当前工作稿已完成 '+coverage.generated+'/'+coverage.total+' 节。可以继续生成剩余 '+coverage.remaining+' 节，也可先下载当前阶段 Word 或查看上一完整版本；不会强制重新生成已完成内容。';
  const actions=complete
    ?'<button class="btn ghost air-act air-act-btn" data-act="exportWord">📄 导出可研报告（Word）</button><button class="btn ghost air-act air-act-btn" data-act="exportExcel">📊 导出测算表（Excel）</button><button class="btn ghost air-act air-act-btn" data-act="exportCalcWord">📋 导出测算说明书（Word）</button><button class="btn air-act air-act-btn air-review-primary" data-act="review">🔍 进入复核与签发 →</button><button class="btn ghost air-act air-act-btn" data-act="saveCase">📁 存入历史项目案例库</button>'
    :'<button type="button" class="btn air-resume-inline-btn">▶ 继续生成剩余 '+coverage.remaining+' 节</button><button class="btn ghost air-act air-act-btn" data-act="exportWord">📄 下载当前阶段 Word</button>'+(airCompletedVersionForProgress(aiReportProgressMsg)?'<button type="button" class="btn ghost air-open-completed-version">📄 查看上一完整版本</button>':'');
  return '<div class="air-card air-deliver-card">'
    +'<div class="air-deliver-guide"><div class="air-deliver-title">'+title+'</div>'
    +'<div class="air-deliver-copy">'+copy+'</div>'
    +'<div class="air-deliver-prompts"><button type="button" class="air-prompt" data-prompt="把租金调整为42元，看看影响">把租金调整为42元，看看影响</button>'
    +'<button type="button" class="air-prompt" data-prompt="你觉得这个项目整体怎么样？请做一次综合诊断">评价这个项目</button>'
    +'<button type="button" class="air-prompt" data-prompt="这个项目还有哪些地方可以提升？请按优先级给建议">寻找提升点</button>'
    +'<button type="button" class="air-prompt" data-prompt="哪些章节会受当前参数影响？">查看参数影响章节</button>'
    +'<button type="button" class="air-prompt" data-prompt="项目背景这一节应该按什么逻辑写？需要什么输出形式？">查看小节生成逻辑</button>'
    +'<button type="button" class="air-prompt" data-prompt="项目背景这一节目前还缺哪些材料？请区分可自动检索和必须人工上传的内容">检查小节材料缺口</button>'
    +'<button type="button" class="air-prompt" data-prompt="帮我修改项目建设必要性这一节，先给候选稿">修改某一章节文字</button></div></div>'
    +'<div class="air-deliver-actions">'+actions+'</div><div class="air-deliver-tip">'+(complete?'也可以直接在对话框发送“复核”，我会自动带你进入。':'未完成稿不会被标记为最终版本，也不会覆盖上一完整版本。')+'</div></div>';
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
  el.innerHTML = '<div class="air-intake-upload" id="airInitialUploadDrop"><div><b>先批量上传项目材料，由AI预填信息</b><span>支持 Word（.doc/.docx）、PDF、Excel、CSV、TXT、Markdown；解析后只调用一次信息抽取。项目名称、1—6个地图点位和类型等都要由你在信息卡中复核确认。</span></div><button type="button" class="btn" id="airInitialUploadButton">＋ 选择多份材料</button><input type="file" id="airInitialUploadFile" accept=".txt,.md,.doc,.docx,.pdf,.xlsx,.xls,.csv" multiple hidden></div>'
    +'<div class="air-intake-or"><span>或者</span></div>'
    +'<div class="air-chips"><div class="air-chips-label">直接选测算类型，自己手动填项目信息：</div>'
    + AI_CATEGORY_OPTIONS.map(c=>'<button type="button" class="air-chip-ex air-chip-'+c.key+'" data-type="'+c.key+'">'+c.label+'</button>').join("")
    + '</div>';
  const input=document.getElementById("airInitialUploadFile"),button=document.getElementById("airInitialUploadButton"),drop=document.getElementById("airInitialUploadDrop");
  if(button&&input)button.onclick=()=>{input.value="";input.click();};
  if(input)input.onchange=e=>airPrepareInitialProjectFiles([...e.target.files]);
  if(drop){drop.ondragover=e=>{e.preventDefault();drop.classList.add("drag")};drop.ondragleave=()=>drop.classList.remove("drag");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("drag");airPrepareInitialProjectFiles([...e.dataTransfer.files]);};}
  el.querySelectorAll(".air-chip-ex").forEach(b=>{
    b.onclick = ()=>airPickCategory(b.dataset.type);
  });
}

function airCalcResultHtml(message){
  const content=window.MD?window.MD.renderHtml(message.content||""):escapeHtml(message.content||"").replace(/\n/g,"<br>");
  return '<div class="air-calc-result">'+content
    +'<div style="margin-top:10px;"><button type="button" class="btn ghost air-open-calc-details">📊 进入财务测算详情</button></div></div>';
}

/* 点类型标签：只记一条"已选择类型"的彩色标签消息（不是冒充用户说了一句话），
   然后弹出一张空白信息表——项目名称/地点/土地性质等都要用户自己填，不会拿AI猜的假数据往下走。 */
function airPickCategory(calcType){
  if(aiReportBusy) return;
  const opt = AI_CATEGORY_OPTIONS.find(c=>c.key===calcType);
  if(!opt) return;
  if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);project.name="AI可研未命名项目";saveDraft();}
  airPush({role:"assistant", kind:"typeTag", content:opt.label, calcType});
  aiReportExtracted = { projectName:"", location:"", calcType, businessScenario:null, landArea:null, landPrice:null, startYear:null, owner:"", landNature:"", desc:"", __manual:true };
  airPush({role:"assistant", kind:"infoCard"});
  airSaveState();
}

function renderAiReportMsgs(){
  const box = document.getElementById("airMsgs");
  if(!box) return;
  box.style.minHeight=aiReportChat.length?"80px":"0";
  const backButton=document.getElementById("airBackStepBtn");
  if(backButton)backButton.disabled=!(window.ProjectWorkflow&&ProjectWorkflow.previousAiReportStage(airCurrentStage()));
  box.innerHTML = aiReportChat.map(m=>{
    // 类型标签：彩色小胶囊，不套用普通消息气泡（不带"AI："前缀，不是在冒充一句对话）
    if(m.kind==="typeTag"){
      return '<div class="air-typetag-row"><span class="air-typetag air-typetag-'+m.calcType+'">✓ 已选择测算类型：'+escapeHtml(m.content)+'</span></div>';
    }
    let body;
    if(m.kind==="materialResult") body = airMaterialResultHtml(m);
    else if(m.kind==="infoCard") body = airInfoCardHtml();
    else if(m.kind==="locationCard") body = airLocationCardHtml(m);
    else if(m.kind==="locationResult") body = airLocationResultHtml(m);
    else if(m.kind==="confirmCard") body = airConfirmCardHtml();
    else if(m.kind==="genConfirm") body = airGenConfirmHtml();
    else if(m.kind==="materialCheck") body = airMaterialCheckHtml(m);
    else if(m.kind==="deliver") body = airDeliverHtml();
    else if(m.kind==="genProgress") body = airProgressCardHtml(m);
    else if(airIsIncompleteGenerationMessage(m)) body = airGenerationIncompleteHtml(m);
    else if(m.kind==="calcPreview") body = airCalcPreviewHtml(m);
    else if(m.kind==="calcResult") body = airCalcResultHtml(m);
    else if(m.kind==="loading") body = '<div class="air-loading"><span class="air-dots"><span></span><span></span><span></span></span>'
      +'<span class="air-loading-label">'+escapeHtml(m.content)+'</span></div>';
    else body = (window.MD? window.MD.renderHtml(m.content||"") : escapeHtml(m.content||"").replace(/\n/g,"<br>"));
    const collapsibleText=m.role==="assistant"&&m.kind==="text"&&!airIsIncompleteGenerationMessage(m)&&(String(m.content||"").trim().length>120||/\r?\n/.test(String(m.content||"")));
    if(collapsibleText){
      const detailId="airMsgDetail_"+m.id,firstLine=String(m.content||"").split(/\r?\n/).map(line=>line.trim()).find(Boolean)||"查看本步骤完整结果";
      body='<div class="air-msg-summary">'+escapeHtml(firstLine.length>105?firstLine.slice(0,105)+'…':firstLine)+'</div><div class="air-msg-detail" id="'+detailId+'" hidden>'+body+'</div>';
    }
    const copyBtn = (m.role==="assistant" && (m.kind==="text"||m.kind==="generationIncomplete")) ? '<button class="air-msg-copy" data-copy="'+m.id+'">复制</button>' : "";
    const detailBtn = collapsibleText ? '<button class="air-msg-detail-toggle" data-detail-target="airMsgDetail_'+m.id+'">查看详情</button>' : "";
    const retryBtn = m.retry ? '<div style="margin-top:8px;"><button class="btn ghost air-msg-retry" data-retry="'+m.id+'" style="padding:4px 12px; font-size:11.5px;">重试</button></div>' : "";
    return '<div class="air-msg '+(m.role==="user"?"user":"assistant")+'">'
      +(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+copyBtn+detailBtn+body+retryBtn+'</div>';
  }).join("");
  box.scrollTop = box.scrollHeight;
  const s = id=>document.getElementById(id);
  if(s("airConfirmInfo")) s("airConfirmInfo").onclick = aiReportConfirmInfo;
  if(s("airRetryMaterialExtraction"))s("airRetryMaterialExtraction").onclick=()=>airRetrySavedMaterialExtraction(false);
  if(s("air_ctype"))s("air_ctype").onchange=()=>{const row=s("air_gaibao_scenario_row");if(row)row.style.display=s("air_ctype").value==="gaibao"?"":"none";};
  if(s("airAddSite"))s("airAddSite").onclick=()=>{airCaptureInfoCard();const sites=airAnalysisSites();if(sites.length>=6)return;sites.push({id:'site-'+(Date.now()),name:'',address:'',role:'secondary'});aiReportExtracted.analysisSites=sites;renderAiReportMsgs();};
  document.querySelectorAll('.air-site-remove').forEach(btn=>btn.onclick=()=>{airCaptureInfoCard();const sites=airAnalysisSites(),index=+btn.dataset.siteRemove,removed=sites.splice(index,1)[0];if(removed?.role==='primary'&&sites[0])sites[0].role='primary';aiReportExtracted.analysisSites=sites;renderAiReportMsgs();});
  document.querySelectorAll('input[name="airSitePrimary"]').forEach(radio=>radio.onchange=()=>{document.querySelectorAll('.air-site-role').forEach((label,index)=>{const input=label.querySelector('input');label.lastChild.textContent=' '+(input.checked?'主项目':'设为主项目');});});
  if(s("airConfirmLocation")) s("airConfirmLocation").onclick = airConfirmLocation;
  document.querySelectorAll('.air-card-detail-toggle,.air-msg-detail-toggle').forEach(button=>button.onclick=()=>{const detail=document.getElementById(button.dataset.detailTarget);if(!detail)return;const opening=detail.hidden;detail.hidden=!opening;button.textContent=opening?'收起详情':'查看详情';const summary=button.closest('.air-msg')?.querySelector('.air-msg-summary');if(summary)summary.hidden=opening;});
  document.querySelectorAll('.air-persistent-card').forEach(card=>card.ontoggle=()=>{
    const kind=card.dataset.airCard;if(!kind)return;
    aiReportCollapsedCards[kind]=!card.open;
    airSaveLocalState();
  });
  document.querySelectorAll('.air-location-site-refresh').forEach(button=>button.onclick=()=>airSearchLocationSite(+button.dataset.siteIndex));
  document.querySelectorAll('.air-location-site-address').forEach(input=>input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();airSearchLocationSite(+input.dataset.siteIndex);}});
  if(s("airSkipLocation")) s("airSkipLocation").onclick = airSkipLocation;
  if(s("airLocationSearchAgain")){
    const run=()=>airSearchLocationCandidates();
    s("airLocationSearchAgain").onclick=run;
  }
  if(s("airRetryLocation")) s("airRetryLocation").onclick = ()=>{aiReportLocationCandidates=[];aiReportLocationConfirmed=null;aiReportSiteSearches=[];aiReportSiteLocations=[];aiReportChat=aiReportChat.filter(m=>m.kind!=="locationCard");renderAiReportMsgs();airSaveState();};
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
  box.querySelectorAll(".air-refine-requirement").forEach(button=>button.onclick=()=>{let requirement=null;try{requirement=JSON.parse(decodeURIComponent(button.dataset.requirement||""));}catch(e){}window.WebResearch?.openRequirementRefinement(requirement,()=>{const type=calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent",card=aiReportChat.find(m=>m.kind==="materialCheck");if(card)card.inventory=ReportLogicCore.materialInventory(type,airMaterialContext());renderAiReportMsgs();airApplyDocMaterialStatuses();airSaveState();});});
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
  document.querySelectorAll(".air-resume-btn,.air-resume-inline-btn").forEach(b=>{b.onclick=airResumeGeneration;});
  document.querySelectorAll(".air-open-preview-btn").forEach(b=>b.onclick=()=>airRestoreDocPaneIfNeeded());
  document.querySelectorAll(".air-open-completed-version").forEach(b=>b.onclick=()=>airOpenCompletedVersion(aiReportProgressMsg));
  document.querySelectorAll(".air-regenerate-btn").forEach(b=>b.onclick=()=>airRequestFullRegeneration());
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
  const chainRows=p.impacted.slice(0,12).map(x=>'<tr><td>'+escapeHtml(x.chapter||'')+'</td><td>'+escapeHtml(x.title||'')+'</td><td>'+escapeHtml((x.metrics||[]).map(m=>m.label).join('、')||p.diff.map(d=>d.label).slice(0,3).join('、'))+'</td><td>'+(x.locked?'人工锁定':'可同步')+'</td></tr>').join('');
  return '<div class="air-card"><b>测算修改预演（尚未写入）</b><div style="margin:8px 0;">'+escapeHtml(meta.label)+'：<b>'+fmt(p.before)+'</b> → <b>'+fmt(p.after)+'</b> '+escapeHtml(meta.unit||'')+'</div>'
    +(anomalies.length?'<div class="wf-preview-warn">异常检测：'+anomalies.map(x=>escapeHtml(x.label+'：'+x.message)).join('<br>')+'</div>':'<div style="color:var(--ok-green);font-size:12px;">硬规则异常检测通过</div>')
    +'<table class="rpt"><tr><th>指标</th><th>修改前</th><th>修改后</th><th>变化</th></tr>'+rows+'</table>'
    +'<div style="font-size:12px;margin-top:8px;">预计影响 '+p.impacted.length+' 个小节，其中 '+p.impacted.filter(x=>x.locked).length+' 个已人工锁定。</div>'
    +(chainRows?'<details style="margin-top:8px;"><summary style="cursor:pointer;color:var(--bp-deep);">查看“参数 → 指标 → 章节”依赖路径</summary><div style="overflow:auto;max-height:260px;"><table class="rpt"><tr><th>章节</th><th>小节</th><th>受影响指标</th><th>同步策略</th></tr>'+chainRows+'</table></div></details>':'')
    +'<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn" id="airApplyCalc" '+(anomalies.some(x=>x.severity==="error")?'disabled':'')+'>确认采用并形成新版本</button><button class="btn ghost" id="airRejectCalc">取消</button></div></div>';
}
function airBuildCalcPreview(key,value){
  if(!calcParams||!calcResult)throw new Error("当前项目还没有可预演的正式测算");
  if(!(key in calcParams))throw new Error("当前测算不存在参数 "+key);
  const after=Number(value);if(!Number.isFinite(after))throw new Error("新值不是有效数字");
  const next=Object.assign({},calcParams,{[key]:after});
  const nextResult=runCalcEngine(calcType||calcResult.__ctype,next);nextResult.__ctype=calcType||calcResult.__ctype;
  const anomalies=window.ParamGovernance?ParamGovernance.anomalyChecks(calcType||calcResult.__ctype,next,pgParamDefs(calcType||calcResult.__ctype),CALC_CFG.paramrules&&CALC_CFG.paramrules[calcType||calcResult.__ctype]):[];
  const diff=ProjectWorkflow.summaryDiff(calcResult.summary,nextResult.summary),impactGraph=window.ReportDependency?ReportDependency.impactFromChanges({calcType:calcType||calcResult.__ctype,changedKeys:[key],beforeSummary:calcResult.summary,afterSummary:nextResult.summary,chapters}):null;
  return {calcType:calcType||calcResult.__ctype,key,before:calcParams[key],after:next[key],params:next,result:nextResult,diff,anomalies,impacted:ProjectWorkflow.impactedSections(chapters,[key]),impactGraph};
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
  AC.registerTool("find_feasibility_impacted_sections",{schema:{type:"function",function:{name:"find_feasibility_impacted_sections",description:"查询一个或多个测算参数经由哪些白箱指标影响哪些可研章节，不修改报告",parameters:{type:"object",properties:{keys:{type:"array",items:{type:"string"}}},required:["keys"]}}},run:a=>JSON.stringify(window.ReportDependency?ReportDependency.buildGraph({calcType:calcType||(calcResult&&calcResult.__ctype),paramKeys:a.keys||[],chapters}):ProjectWorkflow.impactedSections(chapters,a.keys||[]))});
  AC.registerTool("get_feasibility_section_status",{schema:{type:"function",function:{name:"get_feasibility_section_status",description:"查看当前报告每节的最新、待同步、人工锁定和候选修改状态",parameters:{type:"object",properties:{}}}},run:()=>JSON.stringify(chapters.flatMap(c=>c.sections.map((s,si)=>({cn:c.cn,chapter:c.name,si,title:s.t,status:s.syncStatus||"current",locked:!!s.locked,pendingRevision:!!s.pendingRevision}))))});
  AC.registerTool("get_feasibility_section_content",{schema:{type:"function",function:{name:"get_feasibility_section_content",description:"按小节标题读取当前可研正文，不修改内容",parameters:{type:"object",properties:{title:{type:"string"}},required:["title"]}}},run:a=>{const q=String(a.title||"");const hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t));return JSON.stringify(hits.slice(0,5).map(x=>({cn:x.c.cn,chapter:x.c.name,si:x.si,title:x.s.t,content:x.s.editedHtml?blocksToSource(x.s.editedHtml):x.s.content,locked:!!x.s.locked})));}});
  AC.registerTool("get_section_generation_logic",{schema:{type:"function",function:{name:"get_section_generation_logic",description:"查询某个可研小节应按什么逻辑写、需要什么材料、输出什么表格或图示。只读取已发布公司逻辑，不修改规则。",parameters:{type:"object",properties:{title:{type:"string",description:"小节标题或关键词"}},required:["title"]}}},run:async a=>{
    if(!window.ReportLogicCore)return JSON.stringify({ok:false,error:"逐小节生成逻辑模块未加载"});
    const type=(calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent");await ReportLogicCore.load(type);
    const q=String(a.title||""),hits=chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).filter(x=>x.s.t.includes(q)||q.includes(x.s.t)||x.c.name.includes(q));
    const targets=hits.length?hits.slice(0,5):chapters.flatMap(c=>c.sections.map((s,si)=>({c,s,si}))).slice(0,0);
    const businessScenario=airBusinessScenario();return JSON.stringify({ok:true,version:ReportLogicCore.overview(type,{businessScenario}),sections:targets.map(x=>({chapter:x.c.name,title:x.s.t,rules:ReportLogicCore.match(type,x.c.name,x.s.t,{businessScenario,projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(" ")}).map(r=>({id:r.id,sourceNo:r.sourceNo,subsection:r.subsection,pointTitle:r.pointTitle,requiredSources:r.requiredSources,writingLogic:r.writingLogic,outputForm:r.outputForm,importance:r.importance,generationMode:r.generationMode}))}))});
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
  const pendingTaskKeys=(aiReportPendingTasks||[]).filter(t=>!String(t.s&&t.s.editedHtml||t.s&&t.s.content||"").trim()).map(t=>({cn:t.c.cn,si:t.si}));
  const chat = [];
  aiReportChat.forEach(m=>{
    if(m.kind==="loading"||m.kind==="materialCheck") return; // 瞬时态/可重算材料清单，不必存
    if(m.kind==="genProgress"){chat.push(window.ProjectWorkflow?.persistedGenerationProgress?ProjectWorkflow.persistedGenerationProgress(m,pendingTaskKeys.length):{role:"assistant",kind:"genProgress",total:m.total,done:m.done,failed:m.failed,active:false,stopped:pendingTaskKeys.length>0&&Number(m.done||0)<Number(m.total||0)});return;}
    if(m.kind==="calcPreview")return;
    if(m.kind==="typeTag"){ chat.push({role:m.role, kind:"typeTag", content:m.content||"", calcType:m.calcType}); return; }
    if(m.kind==="materialResult"){chat.push({role:m.role,kind:"materialResult",content:"",files:airInitialMaterialRows(m),extractionStatus:m.extractionStatus||"extracted"});return;}
    if(m.kind==="locationCard"||m.kind==="locationResult"){chat.push({role:m.role,kind:m.kind,content:"",sites:m.sites||(m.kind==="locationResult"?aiReportSiteLocations:aiReportSiteSearches)||[]});return;}
    chat.push({role:m.role, kind:m.kind, content:m.content||""});
  });
  return { savedAt:Date.now(),stateRevision:aiReportStateRevision,stage:airCurrentStage(),chat,extracted:aiReportExtracted,suggested:aiReportSuggested,hasDoc:aiReportHasDoc,paramsConfirmed:aiReportParamsConfirmed,
    materialCheckOpen:aiReportChat.some(m=>m.kind==="materialCheck"),
    collapsedCards:Object.assign({},aiReportCollapsedCards),
    locationCandidates:aiReportLocationCandidates,locationConfirmed:aiReportLocationConfirmed,siteSearches:aiReportSiteSearches,siteLocations:aiReportSiteLocations,
    calcType:calcType||(calcResult&&calcResult.__ctype)||null,calcParams:calcParams||null,calcSummary:calcResult&&calcResult.summary||null,
    currentCalcSnapshotId:projectWorkflow&&projectWorkflow.currentCalcSnapshotId||null,currentReportVersionId:projectWorkflow&&projectWorkflow.currentReportVersionId||null,
    pendingTaskKeys };
}
function airSaveState(){
  aiReportStateRevision++;
  const state=airSerializableState();
  airSaveLocalState(state); // 同步落本地，刚点击后立即刷新也不会倒退
  aiReportStateSaveInFlight=aiReportStateSaveInFlight.catch(()=>false).then(async()=>{
    try{const response=await fetch("/api/aireport", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"saveState",projectId:currentProjectId||undefined,state})});return response.ok;
    }catch(e){return false;}
  });
  return aiReportStateSaveInFlight;
}
function airRestoredConfirmation(state){
  if(!state)return false;
  if(state.paramsConfirmed===true)return true;
  if(state.paramsConfirmed===false)return false;
  const chat=Array.isArray(state.chat)?state.chat:[];
  return !!(state.calcParams&&chat.some(m=>m&&["genProgress","deliver"].includes(m.kind)));
}
function airSeedCurrentProject(){
  const seed=window.ProjectWorkflow&&ProjectWorkflow.aiReportProjectSeed(Object.assign({},project,aiReportEntryContext||{}),projectWorkflow,domainKey);
  if(!seed||aiReportExtracted)return false;
  aiReportExtracted=seed;aiReportHasDoc=chapters.some(c=>c.sections.some(s=>String(s.editedHtml||s.content||"").trim()));
  const option=AI_CATEGORY_OPTIONS.find(x=>x.key===seed.calcType);
  if(option)aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"typeTag",content:option.label,calcType:seed.calcType});
  aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"infoCard",content:""});
  renderAiReportMsgs();
  if(aiReportHasDoc)airRestoreDocPaneIfNeeded();
  return true;
}
function airFillCurrentProjectGaps(){
  const seed=window.ProjectWorkflow&&ProjectWorkflow.aiReportProjectSeed(Object.assign({},project,aiReportEntryContext||{}),projectWorkflow,domainKey);
  if(!seed||!aiReportExtracted)return false;
  ["projectName","location","owner","businessScenario","landArea","landPrice","startYear","landNature","desc"].forEach(key=>{if(aiReportExtracted[key]==null||aiReportExtracted[key]==="")aiReportExtracted[key]=seed[key];});
  if(!Array.isArray(aiReportExtracted.analysisSites)||!aiReportExtracted.analysisSites.length)aiReportExtracted.analysisSites=seed.analysisSites;
  if(!aiReportExtracted.calcType)aiReportExtracted.calcType=seed.calcType;
  return true;
}
async function airRestoreMaterialCheck(state){
  const chat=Array.isArray(state&&state.chat)?state.chat:[],hasReportFlow=!!(state&&(state.hasDoc||["generating","paused","delivered"].includes(state.stage)||chat.some(m=>m&&["genProgress","deliver","generationIncomplete"].includes(m.kind))));
  if(!(state?.materialCheckOpen||hasReportFlow)||!window.ReportLogicCore||aiReportChat.some(m=>m.kind==="materialCheck"))return;
  const type=state.calcType||calcType||(calcResult&&calcResult.__ctype)||rptCtype||"rent";
  try{
    await ReportLogicCore.load(type);
    const inventory=ReportLogicCore.materialInventory(type,airMaterialContext());
    aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"materialCheck",inventory});
  }catch(e){console.warn("恢复材料完整性台账失败",e);}
}
async function airLoadState(){
  if(aiReportChatLoaded) return;
  // 直接刷新到AI可研时，项目正文会在大纲和项目接口完成后才恢复。
  // 此时若用空的chapters纠正进度，会把真实27/42误写成0/0；等待restoreDraft后的第二次渲染再加载AI会话。
  if(currentProjectId&&!chapters.length)return;
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
      aiReportCollapsedCards=Object.assign({params:null,materials:null},state.collapsedCards||{});
      aiReportChat = (Array.isArray(state.chat)?state.chat:[]).map(m=>Object.assign({id: ++aiReportMsgSeq}, m));
      aiReportStateRevision=Math.max(aiReportStateRevision,Number(state.stateRevision)||0);
      aiReportExtracted = state.extracted || null;
      airFillCurrentProjectGaps();
      aiReportSuggested = state.suggested || null;
      aiReportLocationCandidates=Array.isArray(state.locationCandidates)?state.locationCandidates:[];
      aiReportLocationConfirmed=state.locationConfirmed||null;
      aiReportSiteSearches=Array.isArray(state.siteSearches)?state.siteSearches:[];
      aiReportSiteLocations=Array.isArray(state.siteLocations)?state.siteLocations:[];
      aiReportHasDoc=!!state.hasDoc||chapters.some(c=>(c.sections||[]).some(s=>String(s.editedHtml||s.content||"").trim()));
      aiReportParamsConfirmed=airRestoredConfirmation(state);
      if(state.calcType)calcType=state.calcType;
      if(aiReportParamsConfirmed&&state.calcParams){calcParams=state.calcParams;try{calcResult=runCalcEngine(calcType,calcParams);calcResult.__ctype=calcType;scParams=calcParams;scResult=calcResult;}catch(e){aiReportParamsConfirmed=false;}}
      let repairedState=airRepairFlowCards();
      await airRestoreMaterialCheck(state);
      aiReportProgressMsg=[...aiReportChat].reverse().find(m=>m.kind==="genProgress")||null;
      if(aiReportProgressMsg&&window.ProjectWorkflow?.recoverCompletedReport){
        const recovered=ProjectWorkflow.recoverCompletedReport(chapters,projectWorkflow,aiReportProgressMsg);
        if(recovered.recovered){chapters=recovered.chapters;aiReportProgressMsg.reportVersionId=recovered.version.id;aiReportProgressMsg.reportVersion=Number(recovered.version.version)||null;aiReportProgressMsg.recoveredFromMismatch=false;repairedState=true;saveDraft();}
      }
      aiReportPendingTasks=[];
      chapters.filter(c=>c.checked!==false).forEach(c=>(c.sections||[]).forEach((s,si)=>{if(!String(s.editedHtml||s.content||"").trim())aiReportPendingTasks.push({c,s,si});}));
      if(aiReportProgressMsg&&window.ProjectWorkflow?.reconcileGenerationProgress){
        const reconciled=ProjectWorkflow.reconcileGenerationProgress(aiReportProgressMsg,chapters);
        if(reconciled.repaired){
          Object.assign(aiReportProgressMsg,reconciled.progress);
          repairedState=true;
        }
        if(!aiReportProgressMsg.reportVersion&&!aiReportProgressMsg.targetReportVersion){aiReportProgressMsg.targetReportVersion=ProjectWorkflow.nextReportVersionNumber(projectWorkflow);repairedState=true;}
        if(reconciled.status.complete&&!airCompletedVersionForProgress(aiReportProgressMsg)&&window.ProjectWorkflow?.createReportVersion){
          const version=ProjectWorkflow.createReportVersion(projectWorkflow,chapters,currentReportVersionMeta("刷新恢复时补建完成版本"));aiReportProgressMsg.reportVersionId=version&&version.id||null;aiReportProgressMsg.reportVersion=Number(version&&version.version)||null;repairedState=true;saveDraft();
        }
      }
      repairedState=airRepairFlowCards()||repairedState;
      if(aiReportHasDoc&&chapters.length)airRestoreDocPaneIfNeeded();
      renderAiReportMsgs();
      if(repairedState)airSaveState();
      airMaybeAutoRetryMaterialExtraction();
    }else if(window.ProjectWorkflow?.aiReportShouldSeedProject(aiReportEntryContext))airSeedCurrentProject();
  }catch(e){
    const state=airLoadLocalState();
    if(state){
      aiReportCollapsedCards=Object.assign({params:null,materials:null},state.collapsedCards||{});aiReportStateRevision=Math.max(aiReportStateRevision,Number(state.stateRevision)||0);aiReportChat=(state.chat||[]).map(m=>Object.assign({id:++aiReportMsgSeq},m));aiReportExtracted=state.extracted||null;airFillCurrentProjectGaps();aiReportSuggested=state.suggested||null;aiReportLocationCandidates=Array.isArray(state.locationCandidates)?state.locationCandidates:[];aiReportLocationConfirmed=state.locationConfirmed||null;aiReportHasDoc=!!state.hasDoc;aiReportParamsConfirmed=airRestoredConfirmation(state);
      if(state.calcType)calcType=state.calcType;if(aiReportParamsConfirmed&&state.calcParams){calcParams=state.calcParams;try{calcResult=runCalcEngine(calcType,calcParams);calcResult.__ctype=calcType;scParams=calcParams;scResult=calcResult;}catch(_){aiReportParamsConfirmed=false;} }
      let repairedState=airRepairFlowCards();await airRestoreMaterialCheck(state);aiReportProgressMsg=[...aiReportChat].reverse().find(m=>m.kind==="genProgress")||null;
      if(aiReportProgressMsg&&window.ProjectWorkflow?.recoverCompletedReport){const recovered=ProjectWorkflow.recoverCompletedReport(chapters,projectWorkflow,aiReportProgressMsg);if(recovered.recovered){chapters=recovered.chapters;aiReportProgressMsg.reportVersionId=recovered.version.id;aiReportProgressMsg.reportVersion=Number(recovered.version.version)||null;aiReportProgressMsg.recoveredFromMismatch=false;repairedState=true;saveDraft();}}
      aiReportPendingTasks=[];chapters.filter(c=>c.checked!==false).forEach(c=>(c.sections||[]).forEach((s,si)=>{if(!String(s.editedHtml||s.content||"").trim())aiReportPendingTasks.push({c,s,si});}));
      if(aiReportProgressMsg&&window.ProjectWorkflow?.reconcileGenerationProgress){const reconciled=ProjectWorkflow.reconcileGenerationProgress(aiReportProgressMsg,chapters);if(reconciled.repaired){Object.assign(aiReportProgressMsg,reconciled.progress);repairedState=true;}if(!aiReportProgressMsg.reportVersion&&!aiReportProgressMsg.targetReportVersion){aiReportProgressMsg.targetReportVersion=ProjectWorkflow.nextReportVersionNumber(projectWorkflow);repairedState=true;}}
      repairedState=airRepairFlowCards()||repairedState;
      if(aiReportHasDoc&&chapters.length)airRestoreDocPaneIfNeeded();renderAiReportMsgs();if(repairedState)airSaveState();airMaybeAutoRetryMaterialExtraction();
    }else if(window.ProjectWorkflow?.aiReportShouldSeedProject(aiReportEntryContext))airSeedCurrentProject();
  }
}

/* 兼容历史存档：旧版本可能只存了参数/测算结果，没有存对应的“下一步”卡片。
   恢复时补齐唯一必要的动作卡，同时删除同类重复卡，避免刷新后倒退或重复执行。 */
function airRepairFlowCards(){
  let repaired=false;
  if(aiReportExtracted){
    ["projectName","location","owner","landNature","desc"].forEach(key=>{
      const normalized=airNullableExtractedText(aiReportExtracted[key]);
      if(normalized!==aiReportExtracted[key]){aiReportExtracted[key]=normalized||"";repaired=true;}
    });
    if(!airMaterialExtractionNeedsRetry(aiReportExtracted)){
      const before=aiReportChat.length;
      aiReportChat=aiReportChat.filter(message=>!/^重新AI提取暂未完成：/.test(String(message&&message.content||"")));
      if(aiReportChat.length!==before)repaired=true;
    }
  }
  if(aiReportExtracted&&airInitialMaterialRows().length&&!aiReportChat.some(message=>message.kind==="materialResult")){
    const oldIndex=aiReportChat.findIndex(message=>message.kind==="text"&&/(?:公网DeepSeek已恢复.*保存的\s*\d+\s*份材料|已保存并解析\s*\d+\s*份材料|已解析\s*\d+\s*份材料并形成)/.test(String(message.content||"")));
    if(oldIndex>=0){aiReportChat.splice(oldIndex,1,{id:aiReportChat[oldIndex].id,role:"assistant",kind:"materialResult",content:"",files:airInitialMaterialRows(),extractionStatus:aiReportExtracted.__materialExtractionDegraded?"degraded":"extracted"});repaired=true;}
  }
  // 兼容旧存档：历史财务结果是普通文本，恢复后升级为带“进入详情”操作的结果卡。
  aiReportChat.forEach(m=>{if(m.kind==="text"&&/^✅ 财务测算完成：/.test(m.content||""))m.kind="calcResult";});
  if(aiReportSiteLocations.length&&!aiReportChat.some(m=>m.kind==="locationResult")){
    const originals=airAnalysisSites(),restored=aiReportSiteLocations.map((site,index)=>Object.assign({},site,{candidateName:site.candidateName||site.name,projectName:site.projectName||originals[index]?.name||site.name,name:originals[index]?.name||site.name}));
    aiReportSiteLocations=restored;project.analysisSites=restored;
    const oldIndex=aiReportChat.findIndex(m=>m.kind==="text"&&/^📍 已完成 \d+ 个点位的位置确认/.test(String(m.content||"")));
    const result={id:oldIndex>=0?aiReportChat[oldIndex].id:++aiReportMsgSeq,role:"assistant",kind:"locationResult",content:"",sites:restored};
    if(oldIndex>=0)aiReportChat.splice(oldIndex,1,result);else{const infoIndex=aiReportChat.findIndex(m=>m.kind==="infoCard");aiReportChat.splice(infoIndex>=0?infoIndex+1:0,0,result);}
    repaired=true;
  }
  const progressIndexes=aiReportChat.map((m,index)=>m.kind==="genProgress"?index:-1).filter(index=>index>=0);
  if(progressIndexes.length>1){const keep=progressIndexes[progressIndexes.length-1];aiReportChat=aiReportChat.filter((m,index)=>m.kind!=="genProgress"||index===keep);repaired=true;}
  const generationCoverage=airReportGenerationStatus();
  if(generationCoverage.complete){
    const before=aiReportChat.length;aiReportChat=aiReportChat.filter(m=>!airIsIncompleteGenerationMessage(m));
    if(aiReportChat.length!==before)repaired=true;
  }else{
    aiReportChat.forEach(m=>{if(airIsIncompleteGenerationMessage(m)&&m.kind!=="generationIncomplete"){m.kind="generationIncomplete";repaired=true;}});
  }
  const dedupe=kind=>{let seen=false;aiReportChat=aiReportChat.filter(m=>m.kind!==kind||(!seen&&(seen=true)));};
  ["infoCard","locationCard","locationResult","confirmCard","genConfirm","deliver"].forEach(dedupe);
  const has=kind=>aiReportChat.some(m=>m.kind===kind);
  if(aiReportExtracted&&!has("infoCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"infoCard"});
  if(aiReportExtracted&&!aiReportSuggested&&!aiReportLocationConfirmed&&aiReportLocationCandidates.length&&!has("locationCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"locationCard",query:aiReportExtracted.location||"",candidates:aiReportLocationCandidates});
  if(aiReportSuggested&&!has("confirmCard"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"confirmCard"});
  const stage=airCurrentStage();
  if(stage==="calculated"&&!has("genConfirm"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"genConfirm"});
  const settledProgress=[...aiReportChat].reverse().find(m=>m.kind==="genProgress");
  if((stage==="delivered"||(generationCoverage.generated>0&&aiReportParamsConfirmed&&aiReportSuggested&&(!settledProgress||settledProgress.active===false)))&&!has("deliver"))aiReportChat.push({id:++aiReportMsgSeq,role:"assistant",kind:"deliver"});
  return repaired;
}
