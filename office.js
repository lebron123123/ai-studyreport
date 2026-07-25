/* ============================================================ 
   office.js —— AI办公助手（第四大功能模块）
   定位：日常办公文稿撰写、业务分析对话、导出Word/Excel
   依赖：agent-core.js（引擎）、export.js（ensureDocxLib/XLSX加载）、docxgen相关工具函数

   红线（与全站一致）：
   - 涉及本项目财务数字时，仍必须调用 get_calc_summary 工具引用真实测算结果，不得凭空编造
   - 本模块生成的是"办公文稿草稿"，不是正式签发文件；导出的文档不带公章/签发状态
   ============================================================ */


/* ===== 文种知识：不同公文的结构与用语规范 =====
   作用：AI起草前先明确"这是什么文种"，套用对应的结构与分寸；
   再配合知识库"模板范文"分类里的真实历史文档，做到既合规范、又像本单位的笔法 */
const DOC_TYPES = [
  // 注意：匹配按数组顺序进行，越具体的文种越要排在前面
  // 例如"年度工作报告"应识别为年度总结（而非报告），因此年度总结的关键词要先于"报告"匹配
  { key:"周报",     match:["周报","本周","周工作"],                     cat:"事务文稿",
    guide:"结构：本周完成事项（分条，突出结果与数据）→ 存在问题 → 下周计划。语气平实，不堆砌形容词；每条事项写清'做了什么、到什么程度'，避免'积极推进''高度重视'这类空话。" },
  { key:"年度总结", match:["年度总结","年终总结","年度工作报告","年度报告","全年","工作总结"], cat:"事务文稿",
    guide:"结构：总体情况概述 → 主要工作与成效（分板块，用数据支撑）→ 存在不足 → 下一年思路。成绩部分要具体到项目和数字，不足部分要真实不回避、并给出改进方向。" },
  { key:"会议纪要", match:["会议纪要","纪要","会议记录"],                cat:"记录文稿",
    guide:"结构：会议基本信息（时间/地点/主持/参会人员）→ 逐项议题（议题+讨论要点+形成决议）→ 需明确责任部门与完成时限。措辞用'会议认为''会议决定''会议要求'，只记结论不记争论过程，决议必须明确到人到时限。" },
  { key:"请示",     match:["请示","申请批准","恳请"],                    cat:"上行文",
    guide:"上行文规范：一文一事。结构：请示缘由（为什么要办）→ 请示事项（具体请求什么，要明确）→ 结语。结语固定用'妥否，请批示'或'当否，请批复'，不得用'请尽快批复'等催促语气。开头称谓顶格写受文单位。" },
  { key:"报告",     match:["报告","汇报"],                              cat:"上行文",
    guide:"上行文规范：报告是'呈报情况'，不得夹带请示事项（需要批准的事项应另行请示）。结构：情况概述 → 具体做法与成效 → 存在问题 → 下步打算。结语用'特此报告'，不写'请批示'。" },
  { key:"复函",     match:["复函","回复","函复","答复"],                 cat:"平行文",
    guide:"平行文规范。结构：引述来函（'你单位《XX函》（XX〔2026〕X号）收悉'）→ 逐项答复（对方问什么答什么，一一对应）→ 结语'特此函复'。语气平等、客气，不用命令式措辞。" },
  { key:"通知",     match:["通知","关于印发","关于开展"],                 cat:"下行文",
    guide:"下行文规范。结构：发文缘由 → 通知事项（分条列明，可执行）→ 执行要求（时限、责任单位、联系人）。语气明确有权威性但不生硬，事项必须具体可落实，避免'要高度重视'这类无法执行的表述。" },
  { key:"新闻稿",   match:["新闻稿","宣传稿","报道"],                    cat:"宣传文稿",
    guide:"与公文完全不同的语言体系。结构：标题（吸引力+信息量）→ 导语（第一段交代五要素：何时/何地/何人/何事/何果）→ 主体（细节展开，可引用当事人原话）→ 背景补充。语言生动具体，避免公文腔和空洞口号，多用事实和数字说话。" },
  { key:"合作协议", match:["合作协议","协议书","合同"],                   cat:"法律文本",
    guide:"⚠️法律文本，结构必须严谨。基本结构：甲乙双方信息 → 合作事项与范围 → 双方权利义务（分列）→ 期限 → 违约责任 → 争议解决 → 附则与签署栏。所有金额、期限、责任划分必须明确无歧义；不确定的条款留空标注'待商定'，绝不臆造具体条款。" },
  { key:"框架协议", match:["框架协议","战略合作","备忘录"],               cat:"法律文本",
    guide:"⚠️法律文本。框架协议侧重合作意向与原则，不涉及具体交易条款。结构：合作背景与目标 → 合作领域 → 合作原则 → 后续推进机制（约定另签具体协议）→ 有效期 → 签署栏。注意区别于正式合同：不写具体金额与刚性违约责任，但要写明'本协议不构成法律约束力'或明确约束范围。" },
];
function detectDocType(text){
  const t = String(text||"");
  for(const d of DOC_TYPES){
    if(d.match.some(k=>t.includes(k))) return d;
  }
  return null;
}

let officeChat = [];
let officeChatLoaded = false;   // 本次页面会话是否已从云端拉取过历史，避免每次重渲染都重复请求
const OFFICE_CHAT_LIMIT = 30;   // 云端保存上限（约15轮问答），防止数据量无限增长
const OFFICE_CTX_FULL  = 8;     // 最近8条：原文完整发给AI
const OFFICE_CTX_BRIEF = 12;    // 再往前12条：只发摘要，让AI"记得聊过什么"但不吃掉大量token

/* 构造发给AI的上下文（分层记忆）
   背景：办公助手的回复经常是整篇公文，一条就上千字。如果把界面上保留的30条原样发出去，
   token开销和延迟都不可接受；但只发最近8条，用户在界面上明明看得到更早的内容，
   AI却完全"失忆"，会被当成bug。折中做法：近的给原文，远的给摘要。 */
function officeBuildHistory(){
  const n = officeChat.length;
  const fullFrom = Math.max(0, n - OFFICE_CTX_FULL);
  const briefFrom = Math.max(0, fullFrom - OFFICE_CTX_BRIEF);
  const MARK = "…（较早的内容，此处只保留摘要）";
  const out = [];
  for(let i = briefFrom; i < fullFrom; i++){
    const m = officeChat[i];
    const txt = String(m.content || "").replace(/\s+/g, " ").trim();
    // 只在确实能省下篇幅时才截断——否则"截断+加标记"反而比原文更长
    const worth = txt.length > 120 + MARK.length;
    out.push({ role: m.role, content: worth ? txt.slice(0,120) + MARK : txt });
  }
  for(let i = fullFrom; i < n; i++){
    out.push({ role: officeChat[i].role, content: officeChat[i].content });
  }
  return out;
}
// 界面上标注"AI能完整看到"的分界线从第几条开始，让用户知道记忆边界在哪
function officeCtxBoundary(){
  return officeChat.length > OFFICE_CTX_FULL ? officeChat.length - OFFICE_CTX_FULL : -1;
}

function stepOffice(){
  return '<div class="doc-eyebrow">OFFICE · AI办公助手</div>'
    +'<h1 class="doc-title">AI办公助手</h1>'
    +'<div class="step-desc">像聊天一样描述你的需求。系统会自动识别文种并套用对应规范：<b>周报 / 年度总结 / 会议纪要 / 请示 / 报告 / 复函 / 通知 / 新闻稿 / 合作协议 / 框架协议</b>；同时自动检索知识库「模板范文」分类下的历史范文，学本单位的实际笔法。生成后可直接导出为 Word 或 Excel。'
    +'<br><span style="color:var(--seal-red,#C24A42);">提醒：本工具生成的是办公草稿，涉及财务数字/正式结论仍需人工核实后使用；不能替代财务测算与正式签发流程。</span></div>'
    +'<div id="officeMsgs" style="min-height:120px; margin-top:16px;"></div>'
    +'<div style="display:flex; gap:8px; margin-top:14px;">'
    +'<input id="officeInput" type="text" placeholder="例如：写一份本周工作周报 / 起草给XX单位的复函 / 整理这次会议的纪要 / 分析本项目风险点" style="flex:1;">'
    +'<button class="btn" id="officeSend" style="flex-shrink:0;">发送</button></div>'
    +'<div id="officeActions" style="margin-top:10px; display:none;">'
    +'<button class="btn ghost" id="officeExportWord" style="padding:7px 16px; font-size:12.5px;">📄 导出为 Word</button>'
    +'<button class="btn ghost" id="officeExportExcel" style="padding:7px 16px; font-size:12.5px; margin-left:8px;">📊 导出为 Excel</button>'
    +'<span style="font-size:11.5px; color:var(--ink-soft); margin-left:10px;">导出前可先预览效果</span>'
    +'</div>'
    +'<div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">'
    +'<span id="officeHistTip" style="font-size:11.5px; color:var(--ink-soft);"></span>'
    +'<span style="display:flex; align-items:center; gap:10px;">'
    +'<span id="officeQuota" style="font-size:11.5px;"></span>'
    +'<button class="btn ghost" id="officeClearChat" style="padding:5px 12px; font-size:12px;">🗑 清空对话</button>'
    +'</span></div>';
}

function bindOfficeEvents(){
  const s = id=>document.getElementById(id);
  if(s("officeSend")) s("officeSend").onclick = officeSend;
  if(s("officeInput")) s("officeInput").addEventListener("keydown", e=>{ if(e.key==="Enter") officeSend(); });
  if(s("officeExportWord")) s("officeExportWord").onclick = ()=>officeOpenPreview("word");
  if(s("officeExportExcel")) s("officeExportExcel").onclick = ()=>officeOpenPreview("excel");
  if(s("officeClearChat")) s("officeClearChat").onclick = officeClearHistory;
  renderOfficeMsgs();
  // 已有历史回复时（如切走再切回、或云端历史刚恢复），恢复导出按钮的显示状态
  if(officeLastAnswer() && s("officeActions")) s("officeActions").style.display = "block";
  // 第一次进入本模块（本次页面会话内）时，去云端拉一次上次的对话记录
  if(!officeChatLoaded){
    officeChatLoaded = true;
    officeLoadHistory();
  }
  officeCheckQuota();
}

// ===== 云端对话记忆：加载 / 保存 / 清空（每人一份，覆盖式）=====
async function officeLoadHistory(){
  try{
    const r = await fetch("/api/officechat", {headers: authHeaders()});
    const d = await r.json();
    if(d.ok && Array.isArray(d.chat) && d.chat.length && !officeChat.length){
      officeChat = d.chat;
      renderOfficeMsgs();
      const tip = document.getElementById("officeHistTip");
      if(tip) tip.textContent = "已恢复上次的对话记录（最多保留最近" + OFFICE_CHAT_LIMIT + "条）";
      if(officeLastAnswer() && document.getElementById("officeActions")) document.getElementById("officeActions").style.display = "block";
    }
  }catch(e){ /* 拉取失败不影响正常使用，只是这次没有历史 */ }
}
function officeTrimChat(){
  if(officeChat.length > OFFICE_CHAT_LIMIT) officeChat = officeChat.slice(-OFFICE_CHAT_LIMIT);
}
async function officeSaveHistory(){
  try{
    await fetch("/api/officechat", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({chat: officeChat})});
  }catch(e){ /* 保存失败不阻断当前对话，只是这次没同步到云端，下次发言会重试 */ }
}

/* 额度提醒：只在快用完时才提示，平时不占用户注意力。
   撞上限时后端的报错已经说得很清楚，这里的作用是提前打个招呼，避免用户
   正写着东西突然被拦住。 */
async function officeCheckQuota(){
  try{
    const r = await fetch("/api/generate", {headers: authHeaders()});
    const d = await r.json();
    if(!d || !d.ok || !d.chat) return;
    const tip = document.getElementById("officeQuota");
    if(!tip) return;
    if(d.chat.left <= 0){
      tip.textContent = "今日AI问答额度已用完，明天恢复（报告生成有独立额度，不受影响）";
      tip.style.color = "var(--seal-red,#C24A42)";
    }else if(d.chat.left <= Math.round(d.chat.limit * 0.2)){
      tip.textContent = "今日AI问答还剩 " + d.chat.left + " 次";
      tip.style.color = "var(--seal-red,#C24A42)";
    }else{
      tip.textContent = "";
    }
  }catch(e){ /* 查不到额度不影响使用 */ }
}
async function officeClearHistory(){
  if(!confirm("确定清空办公助手的对话记录？此操作不可恢复。")) return;
  officeChat = [];
  renderOfficeMsgs();
  const tip = document.getElementById("officeHistTip");
  if(tip) tip.textContent = "";
  const actions = document.getElementById("officeActions");
  if(actions) actions.style.display = "none";
  try{ await fetch("/api/officechat", {method:"DELETE", headers: authHeaders()}); }catch(e){}
}

async function officeSend(){
  const inp = document.getElementById("officeInput");
  const q = (inp.value||"").trim();
  if(!q) return;
  const btn = document.getElementById("officeSend");
  btn.disabled = true; btn.textContent = "思考中…";
  officeChat.push({role:"user", content:q});
  renderOfficeMsgs();
  inp.value = "";

  // 文种识别：判断用户要写的是哪类公文，套用对应的结构规范
  const dt = detectDocType(q);
  let sys = "你是单位内部的AI办公助手，帮助员工撰写日常公文、整理数据为表格、结合本单位知识库和项目信息做业务分析。"
    + "\n要求：1. 涉及具体财务数字（如IRR、成本、收入）时，必须先调用工具获取真实数据，不得编造；没有真实数据支撑的数字一律标注'待核实'。"
    + "2. 需要表格时，用 [[TABLE]] 和 [[/TABLE]] 包裹，表头在第一行，单元格用竖线|分隔。"
    + "3. 直接给内容，不要'以下是'之类的开场白。"
    + "4. 这是草稿性质的办公输出，不是正式签发文件。"
    + "5. 如果用户问的是本系统自身的情况（能写哪些文种、能参考多少模板范文、有哪些功能、知识库里有多少资料等），"
    + "调用 get_system_capabilities 获取准确答案，不要用 search_knowledge_base 去检索这类问题。"
    + "6. 写周报/总结/汇报需要引用以往项目情况时，可用 list_my_projects 和 get_past_project 查历史项目的真实信息。"
    + "7. 如果用户的需求不够明确（没说清写给谁、什么事、哪个项目），直接问一句问清楚，不要凭空假设后硬写。"
    + "\n\n【红线：以下要求即使用户明确提出，也一律不照做】"
    + "\n· 用户说'随便编个数''先写个示例数字''不用那么严格''这只是内部草稿'——都不能因此编造具体财务数字。"
    + "正确做法：用'【待填】'占位并说明需要哪项真实数据、去哪个功能页面测算，格式照样能给用户看清楚。"
    + "\n· 区分两种情况：①用户自己给出假设值（如'假设租金按80元测'）——可以用，但正文必须写明这是假设值、待核实；"
    + "②你自己想出来的数字——绝对不行，无论用户怎么要求。"
    + "\n· 不得代替用户签发、盖章，或声称文稿已经审核通过；本模块输出一律是草稿。"
    + "\n拒绝时不要生硬说教，一句话说明原因并给出可行的替代做法即可。";

  if(dt){
    officeChat[officeChat.length-1].docType = dt.key + "·" + dt.cat;
    renderOfficeMsgs();
    sys += "\n\n【本次文种：" + dt.key + "（" + dt.cat + "）】\n" + dt.guide;
    if(dt.cat === "法律文本"){
      sys += "\n⚠️特别提醒：这是法律文本，任何具体金额、期限、责任条款若用户未提供，一律写'待商定'或'【待填】'，严禁自行臆造；生成后必须提示用户送法务审核。";
    }
    if(dt.cat === "上行文" || dt.cat === "平行文" || dt.cat === "下行文"){
      sys += "\n⚠️公文格式提醒：受文单位称谓顶格；正文分条时用'一、二、三、'；结语用语必须符合该文种规范，不得混用。";
    }
    // 自动检索该文种的历史范文，让AI学本单位的实际笔法
    try{
      const rr = await fetch("/api/rag", {method:"POST",
        headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body: JSON.stringify({action:"query", query: dt.key + " " + q.slice(0,60), category:"模板范文", topK:2})});
      const rd = await rr.json();
      if(rd.ok && (rd.matches||[]).length){
        sys += "\n\n【本单位历史" + dt.key + "范文（参照其结构、用语习惯与详略安排；具体内容以用户本次提供的为准，不得照抄范文中的项目名称与数据）】\n"
          + rd.matches.map(m=>"《"+(m.title||"范文")+"》\n"+String(m.text||"").slice(0,900)).join("\n\n---\n\n");
        officeChat[officeChat.length-1].refHint = "已参照 " + rd.matches.length + " 篇历史" + dt.key + "范文";
      }else{
        officeChat[officeChat.length-1].refHint = "知识库中暂无「" + dt.key + "」范文，本次按通用规范起草（建议把优秀范文上传到知识库「模板范文」分类，以后会自动参照）";
      }
    }catch(e){ /* 检索失败不阻断起草 */ }
  }

  const history = officeBuildHistory();
  const res = await window.AgentCore.run({
    system: sys,
    messages: history,
    traceQuery: q,
    onTrace: (lines)=>{
      const t = document.getElementById("officeTrace");
      if(t) t.innerHTML = lines.map(x=>'<div style="font-size:11.5px; color:var(--ink-soft);">'+escapeHtml(x)+'…</div>').join("");
    },
  });

  officeChat.push({role:"assistant", content: res.text || "（未返回内容）", trace: res.trace});
  officeTrimChat();
  renderOfficeMsgs();
  document.getElementById("officeActions").style.display = "block";
  btn.disabled = false; btn.textContent = "发送";
  officeSaveHistory();   // 异步保存到云端，不阻塞界面
  officeCheckQuota();    // 顺带刷新额度提醒
}

function renderOfficeMsgs(){
  const box = document.getElementById("officeMsgs");
  if(!box) return;
  const bound = officeCtxBoundary();
  box.innerHTML = officeChat.map((m, idx)=>{
    // 记忆分界线：这条线以上的内容，AI只记得大意；以下的才是完整原文
    const divider = (idx === bound)
      ? '<div style="display:flex; align-items:center; gap:8px; margin:14px 0 4px; color:var(--ink-soft); font-size:11px;">'
        +'<span style="flex:1; height:1px; background:var(--line,#DCE6F0);"></span>'
        +'<span title="更早的对话AI只保留摘要，如需精确引用请重述">↓ 以下是AI能完整看到的对话</span>'
        +'<span style="flex:1; height:1px; background:var(--line,#DCE6F0);"></span></div>'
      : "";
    const traceHtml = (m.trace && m.trace.length) ? '<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed var(--line,#DCE6F0); font-size:11px; color:var(--ink-soft);">'+m.trace.map(t=>escapeHtml(t)).join("<br>")+'</div>' : "";
    const bodyHtml = m.role==="assistant" ? renderContent(m.content) : escapeHtml(m.content).replace(/\n/g,"<br>");
    const hintHtml = m.refHint ? '<div style="margin-top:6px; font-size:11px; color:var(--ink-soft);">📎 '+escapeHtml(m.refHint)+'</div>' : "";
    const dtHtml = m.docType ? '<span style="font-size:11px; margin-left:8px; padding:1px 7px; border-radius:3px; background:#EAF1F8; color:#2C6CA6;">'+escapeHtml(m.docType)+'</span>' : "";
    return divider + '<div style="margin:10px 0; padding:12px 16px; font-size:13.5px; line-height:1.8; border-radius:8px; '
      +(m.role==="user"?'background:#EDF1F5;':'background:#FFF; border:1px solid var(--line,#DCE6F0);')+'">'
      +(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+dtHtml+traceHtml+bodyHtml+hintHtml+'</div>';
  }).join("") + '<div id="officeTrace" style="margin-top:4px;"></div>';
  box.scrollTop = box.scrollHeight;
}

// 统一提示：主站没有后台那套 msg()，用页面内提示条，避免 ReferenceError
function officeNotify(text){
  const box = document.getElementById("officeActions");
  if(!box){ alert(text); return; }
  let tip = document.getElementById("officeTip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "officeTip";
    tip.style.cssText = "margin-top:8px; font-size:12.5px; color:var(--seal-red,#C24A42);";
    box.appendChild(tip);
  }
  tip.textContent = text;
  clearTimeout(tip.__t);
  tip.__t = setTimeout(()=>{ tip.textContent = ""; }, 4000);
}

// ===== 导出：把最近一条AI回复导出为 Word 或 Excel（复用现有[[TABLE]]解析约定）=====
function officeLastAnswer(){
  for(let i=officeChat.length-1; i>=0; i--){ if(officeChat[i].role==="assistant") return officeChat[i].content; }
  return "";
}
// 解析待导出内容 → 结构块。统一走 md.js，这样"界面看到的"和"导出得到的"就是同一份解析结果，
// 不会出现界面渲染正常、导出却丢结构的情况
function officeParseBlocks(text){
  if(window.MD && typeof window.MD.parseBlocks === "function"){
    return window.MD.parseBlocks(text);
  }
  // 降级：md.js 未加载时仍支持旧的 [[TABLE]] 语法
  const parts = [];
  const re = /\[\[TABLE\]\]([\s\S]*?)\[\[\/TABLE\]\]/g;
  let last = 0, m;
  while((m = re.exec(text))){
    if(m.index > last) parts.push({type:"para", text:text.slice(last, m.index).trim()});
    const rows = m[1].trim().split("\n").map(r=>r.split("|").map(c=>c.trim())).filter(r=>r.length>1);
    if(rows.length) parts.push({type:"table", rows});
    last = re.lastIndex;
  }
  if(last < text.length) parts.push({type:"para", text:text.slice(last).trim()});
  return parts.filter(p=> p.type==="table" || (p.text && p.text.length));
}

/* ===== 导出前预览 =====
   为什么要有：导出Word/Excel是"黑盒"操作——点下去直接下载一个文件，
   用户要打开Word才知道排版对不对、表格有没有丢。预览让他在下载前先看一眼，
   有问题可以直接改需求重新生成，省掉"导出→打开→不对→回来重生成"的来回。 */
function officeOpenPreview(kind){
  const text = officeLastAnswer();
  if(!text){ officeNotify("还没有可导出的内容，请先让AI生成内容"); return; }
  const blocks = officeParseBlocks(text);
  const tableCount = blocks.filter(b=>b.type==="table").length;

  let inner = "";
  if(kind === "excel"){
    // Excel预览：明确告诉用户会导出成几张表；没有表格时说明会按文本逐行导出
    if(tableCount){
      inner = '<div style="font-size:12px; color:var(--ink-soft,#66707A); margin-bottom:10px;">'
        + '将导出 ' + tableCount + ' 张工作表（表1…表' + tableCount + '），仅包含下列表格内容，正文文字不会进入Excel。</div>'
        + blocks.filter(b=>b.type==="table").map((b,i)=>{
            let t = '<div style="font-size:12px; font-weight:600; margin:10px 0 4px;">表'+(i+1)+'</div><table class="rpt">';
            b.rows.forEach((r,ri)=>{ const tg = ri===0?"th":"td";
              t += "<tr>" + r.map(c=>'<'+tg+'>'+escapeHtml(c)+'</'+tg+'>').join("") + "</tr>"; });
            return t + "</table>";
          }).join("");
    }else{
      inner = '<div style="font-size:12px; color:var(--seal-red,#C24A42); margin-bottom:10px;">'
        + '这段内容里没有表格，导出的Excel会把正文按行放进单列。如果你要的是数据表，'
        + '可以让AI「把上面的内容整理成表格」后再导出。</div>'
        + '<div style="font-size:12.5px; line-height:1.8;">' + (window.MD ? window.MD.renderHtml(text) : escapeHtml(text)) + '</div>';
    }
  }else{
    inner = '<div style="font-size:12px; color:var(--ink-soft,#66707A); margin-bottom:10px;">'
      + '下面是Word文档的大致效果（正文含 ' + tableCount + ' 个表格）。文档会带"AI辅助起草草稿"标注。</div>'
      + '<div style="font-size:13px; line-height:1.9;">' + (window.MD ? window.MD.renderHtml(text) : escapeHtml(text)) + '</div>';
  }

  const old = document.getElementById("officePrevWrap"); if(old) old.remove();
  document.body.insertAdjacentHTML("beforeend",
    '<div id="officePrevWrap" style="position:fixed; inset:0; background:rgba(14,28,44,.55); display:flex; align-items:center; justify-content:center; z-index:998;">'
    + '<div style="background:#fff; width:min(760px,92vw); max-height:84vh; display:flex; flex-direction:column; border-radius:8px; box-shadow:0 24px 60px -18px rgba(0,0,0,.5);">'
    + '<div style="padding:14px 20px; border-bottom:1px solid var(--line,#DCE6F0); display:flex; justify-content:space-between; align-items:center;">'
    + '<b style="font-size:14px;">导出预览 · ' + (kind==="excel" ? "Excel" : "Word") + '</b>'
    + '<button id="opClose" style="border:none; background:none; font-size:20px; cursor:pointer; color:var(--ink-soft,#66707A);">×</button></div>'
    + '<div style="padding:18px 22px; overflow:auto; flex:1;">' + inner + '</div>'
    + '<div style="padding:12px 20px; border-top:1px solid var(--line,#DCE6F0); display:flex; justify-content:flex-end; gap:10px;">'
    + '<button class="btn ghost" id="opCancel" style="padding:7px 18px; font-size:12.5px;">返回修改</button>'
    + '<button class="btn" id="opConfirm" style="padding:7px 18px; font-size:12.5px;">确认导出</button>'
    + '</div></div></div>');

  const close = ()=>{ const w = document.getElementById("officePrevWrap"); if(w) w.remove(); };
  document.getElementById("opClose").onclick = close;
  document.getElementById("opCancel").onclick = close;
  document.getElementById("officePrevWrap").onclick = e=>{ if(e.target.id==="officePrevWrap") close(); };
  document.getElementById("opConfirm").onclick = ()=>{ close(); officeExport(kind); };
}

async function officeExport(kind){
  const text = officeLastAnswer();
  if(!text){ officeNotify("还没有可导出的内容，请先让AI生成内容"); return; }
  const blocks = officeParseBlocks(text);
  const plain = (s)=> (window.MD ? window.MD.stripInline(s) : String(s||""));
  try{
    if(kind === "word"){
      await ensureDocxLib();
      const D = window.docx;
      const run = (t, opt)=> new D.TextRun(Object.assign({text:String(t)}, opt||{}));
      const children = [];
      children.push(new D.Paragraph({ children:[run("办公文稿草稿",{size:32,bold:true})], alignment:D.AlignmentType.CENTER, spacing:{after:200} }));
      children.push(new D.Paragraph({ children:[run("生成时间："+new Date().toLocaleString("zh-CN")+"　｜　本文为AI辅助起草草稿，非正式签发文件",{size:18,color:"888888"})], spacing:{after:300} }));
      blocks.forEach(b=>{
        if(b.type === "heading"){
          children.push(new D.Paragraph({ children:[run(plain(b.text), {size: b.level<=2 ? 26 : 24, bold:true})],
            spacing:{before:180, after:100} }));
        }else if(b.type === "list"){
          b.items.forEach((it,i)=>{
            children.push(new D.Paragraph({ children:[run((b.ordered ? (i+1)+". " : "· ") + plain(it))],
              indent:{left:360}, spacing:{after:100} }));
          });
        }else if(b.type === "quote"){
          children.push(new D.Paragraph({ children:[run(plain(b.text), {italics:true, color:"666666"})],
            indent:{left:360}, spacing:{after:140} }));
        }else if(b.type === "hr"){
          children.push(new D.Paragraph({ children:[run("　")], spacing:{after:120} }));
        }else if(b.type === "table"){
          const table = new D.Table({
            width:{ size:100, type:D.WidthType.PERCENTAGE },
            rows: b.rows.map((r,ri)=> new D.TableRow({
              children: r.map(cell=> new D.TableCell({
                children:[ new D.Paragraph({ children:[run(cell, {bold: ri===0})] }) ],
                shading: ri===0 ? { fill:"E8EEF5" } : undefined,
              })),
            })),
          });
          children.push(table);
          children.push(new D.Paragraph({ text:"", spacing:{after:200} }));
        }else{
          String(b.text||"").split("\n").filter(l=>l.trim()).forEach(line=>{
            children.push(new D.Paragraph({ children:[run(plain(line))], spacing:{after:160} }));
          });
        }
      });
      const doc = new D.Document({ sections:[{ children }] });
      const blob = await D.Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "办公文稿-"+Date.now()+".docx"; a.click();
      URL.revokeObjectURL(url);
    }else{
      if(!window.XLSX) await loadScript("xlsx.full.min.js");
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();
      const tableBlocks = blocks.filter(b=>b.type==="table");
      if(tableBlocks.length){
        tableBlocks.forEach((b,i)=>{
          const ws = XLSX.utils.aoa_to_sheet(b.rows);
          XLSX.utils.book_append_sheet(wb, ws, "表"+(i+1));
        });
      }else{
        // 没有表格结构时，把文本按行放入单列，仍导出为可用的Excel
        const rows = text.split("\n").filter(l=>l.trim()).map(l=>[plain(l)]);
        const ws = XLSX.utils.aoa_to_sheet([["内容"], ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, "内容");
      }
      XLSX.writeFile(wb, "办公数据-"+Date.now()+".xlsx");
    }
  }catch(e){
    officeNotify("导出失败："+e.message);
  }
}
