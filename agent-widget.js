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
  function renderAw(){
    const box = document.getElementById("awMsgs");
    if(!awChat.length){ box.innerHTML = '<div id="awEmpty">可以问我任何关于当前页面、测算结果、知识库资料的问题。</div>'; return; }
    box.innerHTML = awChat.map(m=>{
      const traceHtml = (m.trace && m.trace.length) ? '<div class="aw-trace">'+m.trace.map(t=>esc(t)).join("<br>")+'</div>' : "";
      return '<div class="aw-m '+(m.role==="user"?"aw-u":"aw-a")+'">'+(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+traceHtml+esc(m.content).replace(/\n/g,"<br>")+'</div>';
    }).join("");
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

    awChat.push({role:"assistant", content: res.text || "（未返回内容）", trace: res.trace});
    renderAw();
    sendBtn.disabled = false; sendBtn.textContent = "发送";
  }

  btn.onclick = ()=>{ panel.classList.toggle("open"); if(panel.classList.contains("open")) document.getElementById("awInput").focus(); };
  document.getElementById("awClose").onclick = ()=> panel.classList.remove("open");
  document.getElementById("awSend").onclick = sendAw;
  document.getElementById("awInput").addEventListener("keydown", e=>{ if(e.key==="Enter") sendAw(); });
})();
