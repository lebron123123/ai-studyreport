/* ============================================================
   agent-widget.js —— 全站悬浮 AI 助手（阶段二）
   依赖：agent-core.js（引擎）、auth.js（authHeaders）
   职责：
     1. 注入悬浮按钮 + 侧边对话面板（不侵入任何页面已有逻辑）
     2. 注册一个"感知当前页面"的通用工具，让 AI 知道你在哪、在看什么
     3. 复用 agent-core.js 的循环执行器；工具集合按当前是否已有
        calc.js 注册的工具自动叠加（同一个引擎、同一份工具表）
   红线：这里只注册"只读/查询/导航"类工具，不提供任何"代填参数/
   代点执行/代改数据"的工具——数字与操作仍必须由人在原页面确认。
   ============================================================ */
(function(){
  if(!window.AgentCore){ console.warn("[AgentWidget] AgentCore 未加载，跳过挂载"); return; }
  const AC = window.AgentCore;

  /* ---------- 注册"当前页面上下文"工具 ---------- */
  AC.registerTool("get_current_context", {
    schema: {
      type: "function",
      function: {
        name: "get_current_context",
        description: "获取用户当前所在页面/步骤、当前项目的基本信息。当用户的问题涉及'我现在在哪''这是什么''当前项目情况'等与当前操作场景相关的内容时，应先调用此工具了解上下文，再回答或提供引导建议。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"🧭 读取当前页面上下文",
    run: async ()=>{
      try{
        const lines = [];
        if(typeof homeView !== "undefined" && homeView) lines.push("当前处于首页(功能选择)");
        if(typeof calcType !== "undefined" && typeof scStep !== "undefined") lines.push("当前处于【独立财务测算】，测算类型："+({gaibao:"非居改保",rent:"出租类",sale:"出售类"}[calcType]||calcType)+"，步骤："+(scStep===0?"参数填写":"结果查看"));
        if(typeof project !== "undefined" && project && project.name) lines.push("当前处于【可研生成】，项目名称："+project.name+(project.location?"，建设地点："+project.location:""));
        if(typeof rptCtype !== "undefined" && rptCtype) lines.push("报告内测算类型："+rptCtype);
        if(typeof reviewMode !== "undefined" && reviewMode) lines.push("当前处于【可研智能审查】页面");
        return lines.length ? lines.join("；") : "（无法识别具体页面状态，可能在首页或某个通用页面）";
      }catch(e){ return "（读取页面上下文时出错："+e.message+"）"; }
    },
  });

  /* ---------- 阶段三：扩充工具箱（跨模块只读工具） ---------- */

  // 工具：读取当前项目信息(仅在"可研生成"流程中有效)
  AC.registerTool("get_project_info", {
    schema: {
      type: "function",
      function: {
        name: "get_project_info",
        description: "获取用户当前正在编辑的项目基本信息(名称/建设单位/地点/规模/概况/客群定位/竞品调研/周边配套)。当用户询问'我这个项目现在填了什么''帮我看看项目信息'等问题时调用。仅在'可研生成'流程中有数据，其他场景请如实告知用户当前不在该流程。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📁 读取当前项目信息",
    run: async ()=>{
      try{
        if(typeof project === "undefined" || !project || !project.name){
          return "（当前不在'可研生成'流程中，或尚未填写项目信息）";
        }
        const lines = [];
        lines.push("项目名称："+project.name);
        if(project.owner) lines.push("建设/委托单位："+project.owner);
        if(project.location) lines.push("建设地点："+project.location);
        if(project.scale) lines.push("投资规模："+project.scale+"万元");
        if(project.desc) lines.push("项目概况："+String(project.desc).slice(0,200));
        if(project.targetGroup) lines.push("主力客群："+project.targetGroup);
        if(project.unitPlan) lines.push("户型策略："+project.unitPlan);
        if(project.rentPlan) lines.push("租金策略："+project.rentPlan);
        if(project.competitors && project.competitors.length){
          const cps = project.competitors.filter(c=>c.name);
          if(cps.length) lines.push("竞品调研："+cps.map(c=>c.name+(c.rent?"(租金"+c.rent+")":"")).join("、"));
        }
        return lines.join("\n");
      }catch(e){ return "（读取项目信息出错："+e.message+"）"; }
    },
  });

  // 工具：读取当前"可研智能审查"的AI评审结果(仅在该流程中有效)
  AC.registerTool("get_review_issues", {
    schema: {
      type: "function",
      function: {
        name: "get_review_issues",
        description: "获取用户当前'可研智能审查'流程中，AI对上传报告的评审结果(各章节评分与具体问题清单)。当用户询问'审查结果怎么样''有哪些问题'等问题时调用。仅在完成过AI评审后有数据。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📋 读取审查结果",
    run: async ()=>{
      try{
        const results = window.__lastAuditResults;
        if(!results || !results.length) return "（尚未运行过AI深度评审，暂无数据）";
        const scored = results.filter(r=>r.score!==null);
        const failed = results.filter(r=>r.err);
        const avg = scored.length? Math.round(scored.reduce((s,r)=>s+r.score,0)/scored.length) : 0;
        const lines = ["全篇平均分："+avg+"（共"+results.length+"节，成功评审"+scored.length+"节"
          +(failed.length? "，"+failed.length+"节评审失败" : "")+"）"];
        results.slice(0,10).forEach(r=>{
          const head = "第"+r.cn+"章 "+(r.secTitle||"");
          if(r.err){ lines.push(head+"：评审失败（"+r.err+"），该节未获得评分"); return; }
          const issueTxt = (r.issues||[]).map(it=>(it.point||"")+"："+(it.suggestion||"")).join("；");
          lines.push(head+"：得分"+(r.score===null?"—":r.score)+(issueTxt?"，问题："+issueTxt:"，无明显问题"));
        });
        if(results.length > 10) lines.push("（仅列出前10节，共"+results.length+"节）");
        return lines.join("\n");
      }catch(e){ return "（读取审查结果出错："+e.message+"）"; }
    },
  });

  // 工具：建议导航（只返回建议，不代替用户点击——由面板渲染可点击按钮，用户自己确认跳转）
  const NAV_TARGETS = [
    { key:"calc",   label:"财务测算", desc:"独立测算非居改保/出租/出售三类项目" },
    { key:"report", label:"可研生成", desc:"完整可行性研究报告生成流程" },
    { key:"review", label:"可研智能审查", desc:"上传外部报告进行智能审查" },
    { key:"home",   label:"返回首页", desc:"" },
  ];
  AC.registerTool("suggest_navigation", {
    schema: {
      type: "function",
      function: {
        name: "suggest_navigation",
        description: "当用户想去某个功能模块，或你判断应该引导用户前往某个页面完成操作时调用(例如：用户说'我想测算一下'、'带我去审查页面')。此工具只返回建议，不会自动跳转，用户需要自己点击确认。",
        parameters: {
          type:"object",
          properties:{ target:{ type:"string", description:"目标模块：calc(财务测算)/report(可研生成)/review(可研智能审查)/home(首页)" } },
          required:["target"],
        },
      },
    },
    validate: (args)=> AC.V.all([
      AC.V.requiredString(args, "target", 20, "target"),
      AC.V.optionalEnum(args, "target", ["calc","report","review","home"], "target"),
    ]),
    label: (args)=>"🧭 建议跳转："+(NAV_TARGETS.find(t=>t.key===args.target)||{}).label,
    run: async (args)=>{
      try{
        const t = NAV_TARGETS.find(x=>x.key===(args&&args.target));
        if(!t) return "（未知目标，请从 calc/report/review/home 中选择）";
        return "已为用户准备好前往「"+t.label+"」的入口按钮(界面会显示，等待用户点击确认，不会自动跳转)";
      }catch(e){ return "（生成导航建议出错："+e.message+"）"; }
    },
  });

  /* ---------- 注入 UI ---------- */

  /* ---------- 注入 UI ---------- */
  const style = document.createElement("style");
  style.textContent = `
    #awBtn{
      position:fixed; right:22px; bottom:22px; z-index:900;
      width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
      background:var(--bp-navy,#2C6CA6); color:#fff; font-size:22px;
      box-shadow:0 4px 16px -4px rgba(30,75,114,.45);
      display:flex; align-items:center; justify-content:center;
      transition:transform .15s ease;
    }
    #awBtn:hover{ transform:scale(1.06); }
    #awPanel{
      position:fixed; right:22px; bottom:86px; z-index:900;
      width:360px; max-width:88vw; max-height:70vh; display:none;
      flex-direction:column; background:#fff; border:1px solid var(--line,#DCE6F0);
      border-radius:12px; box-shadow:0 12px 40px -12px rgba(30,75,114,.35);
      overflow:hidden;
    }
    #awPanel.open{ display:flex; }
    #awHead{
      padding:12px 16px; background:var(--side-bg,#EEF4FA); border-bottom:1px solid var(--line,#DCE6F0);
      display:flex; justify-content:space-between; align-items:center; font-size:13.5px; font-weight:700; color:var(--bp-deep,#1E4B72);
    }
    #awHead .awClose{ cursor:pointer; color:var(--ink-soft,#66788C); font-size:18px; line-height:1; background:none; border:none; }
    #awMsgs{ flex:1; overflow-y:auto; padding:12px 14px; font-size:13px; line-height:1.7; }
    #awMsgs .aw-m{ margin-bottom:10px; padding:9px 12px; border-radius:8px; }
    #awMsgs .aw-u{ background:#EDF1F5; }
    #awMsgs .aw-a{ background:#F7FAFD; border:1px solid var(--line,#DCE6F0); }
    #awMsgs .aw-trace{ font-size:11px; color:var(--ink-soft,#66788C); margin-bottom:5px; }
    #awInputBar{ display:flex; gap:6px; padding:10px; border-top:1px solid var(--line,#DCE6F0); }
    #awInputBar input{ flex:1; font-size:13px; padding:8px 10px; border:1px solid var(--line,#DCE6F0); border-radius:6px; outline:none; }
    #awInputBar button{ flex-shrink:0; padding:8px 14px; border:none; border-radius:6px; background:var(--bp-navy,#2C6CA6); color:#fff; font-size:12.5px; cursor:pointer; }
    #awInputBar button:disabled{ opacity:.5; cursor:wait; }
    #awEmpty{ color:var(--ink-soft,#66788C); font-size:12.5px; text-align:center; padding:20px 6px; }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "awBtn"; btn.title = "AI助手"; btn.textContent = "💬";
  const panel = document.createElement("div");
  panel.id = "awPanel";
  panel.innerHTML = `
    <div id="awHead"><span>🤖 AI 助手</span><button class="awClose" id="awClose">×</button></div>
    <div id="awMsgs"><div id="awEmpty">可以问我任何关于当前页面、测算结果、知识库资料的问题。</div></div>
    <div id="awInputBar">
      <input id="awInput" type="text" placeholder="随时问我…">
      <button id="awSend">发送</button>
    </div>
  `;
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  let awChat = [];
  function esc(s){ const d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; }
  const NAV_LABELS = { calc:"财务测算", report:"可研生成", review:"可研智能审查", home:"首页" };
  // 根据消息上挂的navTarget(结构化数据,来自工具调用记录)渲染"点击确认跳转"按钮——不自动执行，人工点击才生效
  function renderNavButtons(navTarget){
    if(!navTarget || !NAV_LABELS[navTarget]) return "";
    return '<div><button class="aw-nav-btn" data-nav="'+navTarget+'" style="margin-top:6px; padding:6px 14px; font-size:12px; border:1px solid var(--bp-navy,#2C6CA6); border-radius:6px; background:#fff; color:var(--bp-navy,#2C6CA6); cursor:pointer;">前往'+NAV_LABELS[navTarget]+' →</button></div>';
  }
  function doNav(key){
    if(typeof goHome !== "function") return;
    if(key === "home"){ goHome(); panel.classList.remove("open"); return; }
    // 注意:let/const声明的顶层变量不会挂到window上,必须直接赋值(同一全局作用域下的裸标识符)才能改到真正生效的那个变量
    try{
      appMode = key;
      if(key==="calc") scStep = 0;
      if(key==="review") rvStep = 0;
      if(key==="report") currentStep = 0;
      if(typeof renderTOC==="function") renderTOC();
      if(typeof renderSheet==="function") renderSheet();
    }catch(e){ console.warn("[AgentWidget] 导航失败:", e.message); }
    panel.classList.remove("open");
  }
  function renderAw(){
    const box = document.getElementById("awMsgs");
    if(!awChat.length){ box.innerHTML = '<div id="awEmpty">可以问我任何关于当前页面、测算结果、知识库资料的问题。</div>'; return; }
    box.innerHTML = awChat.map(m=>{
      const traceHtml = (m.trace && m.trace.length) ? '<div class="aw-trace">'+m.trace.map(t=>esc(t)).join("<br>")+'</div>' : "";
      const navBtn = m.role==="assistant" ? renderNavButtons(m.navTarget) : "";
      return '<div class="aw-m '+(m.role==="user"?"aw-u":"aw-a")+'">'+(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+traceHtml+esc(m.content).replace(/\n/g,"<br>")+navBtn+'</div>';
    }).join("");
    box.querySelectorAll(".aw-nav-btn").forEach(b=>{ b.onclick = ()=> doNav(b.dataset.nav); });
    box.scrollTop = box.scrollHeight;
  }

  async function sendAw(){
    const inp = document.getElementById("awInput");
    const q = inp.value.trim();
    if(!q) return;
    const sendBtn = document.getElementById("awSend");
    sendBtn.disabled = true; sendBtn.textContent = "…";
    awChat.push({role:"user", content:q});
    renderAw();
    inp.value = "";

    const sys = "你是「可研报告工坊」的全站AI助手，可以帮助用户理解当前页面、解释测算结果、检索知识库资料，或引导用户完成操作。你只能查询信息、不能代替用户填写表单或执行任何计算/提交操作——涉及具体数字与操作，请引导用户自己在对应页面完成。回答简明、口语化，150字以内为宜。";
    const history = awChat.slice(-6).map(m=>({role:m.role, content:m.content}));

    const res = await AC.run({
      system: sys,
      messages: history,
      // 工具集合不写死：已注册的工具（含各页面自行注册的）全部可用，助手自己判断该调用哪个
      traceQuery: q,
      onTrace: (lines)=>{
        const last = awChat[awChat.length-1];
        if(last && last.role==="assistant") return; // 避免过程闪烁覆盖已完成的回答
        const tempTrace = document.getElementById("awTempTrace");
        if(tempTrace) tempTrace.innerHTML = lines.map(esc).join("<br>");
      },
    });

    // 从工具调用记录里找导航建议(结构化提取,不依赖AI复述内部标记)
    let navTarget = null;
    (res.toolCalls||[]).forEach(tc=>{
      if(tc.name === "suggest_navigation" && !tc.error && tc.args && tc.args.target) navTarget = tc.args.target;
    });
    awChat.push({role:"assistant", content: res.text || "（未返回内容）", trace: res.trace, navTarget});
    renderAw();
    sendBtn.disabled = false; sendBtn.textContent = "发送";
  }

  btn.onclick = ()=>{ panel.classList.toggle("open"); if(panel.classList.contains("open")) document.getElementById("awInput").focus(); };
  document.getElementById("awClose").onclick = ()=> panel.classList.remove("open");
  document.getElementById("awSend").onclick = sendAw;
  document.getElementById("awInput").addEventListener("keydown", e=>{ if(e.key==="Enter") sendAw(); });
})();
