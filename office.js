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
    +'<span style="font-size:11.5px; color:var(--ink-soft); margin-left:10px;">导出最近一条AI回复的内容</span>'
    +'</div>';
}

function bindOfficeEvents(){
  const s = id=>document.getElementById(id);
  if(s("officeSend")) s("officeSend").onclick = officeSend;
  if(s("officeInput")) s("officeInput").addEventListener("keydown", e=>{ if(e.key==="Enter") officeSend(); });
  if(s("officeExportWord")) s("officeExportWord").onclick = ()=>officeExport("word");
  if(s("officeExportExcel")) s("officeExportExcel").onclick = ()=>officeExport("excel");
  renderOfficeMsgs();
  // 已有历史回复时（如切走再切回），恢复导出按钮的显示状态
  if(officeLastAnswer() && s("officeActions")) s("officeActions").style.display = "block";
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
    + "4. 这是草稿性质的办公输出，不是正式签发文件。";

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

  const history = officeChat.slice(-8).map(m=>({role:m.role, content:m.content}));
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
  renderOfficeMsgs();
  document.getElementById("officeActions").style.display = "block";
  btn.disabled = false; btn.textContent = "发送";
}

function renderOfficeMsgs(){
  const box = document.getElementById("officeMsgs");
  if(!box) return;
  box.innerHTML = officeChat.map(m=>{
    const traceHtml = (m.trace && m.trace.length) ? '<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed var(--line,#DCE6F0); font-size:11px; color:var(--ink-soft);">'+m.trace.map(t=>escapeHtml(t)).join("<br>")+'</div>' : "";
    const bodyHtml = m.role==="assistant" ? renderContent(m.content) : escapeHtml(m.content).replace(/\n/g,"<br>");
    const hintHtml = m.refHint ? '<div style="margin-top:6px; font-size:11px; color:var(--ink-soft);">📎 '+escapeHtml(m.refHint)+'</div>' : "";
    const dtHtml = m.docType ? '<span style="font-size:11px; margin-left:8px; padding:1px 7px; border-radius:3px; background:#EAF1F8; color:#2C6CA6;">'+escapeHtml(m.docType)+'</span>' : "";
    return '<div style="margin:10px 0; padding:12px 16px; font-size:13.5px; line-height:1.8; border-radius:8px; '
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
// 解析 [[TABLE]]...[[/TABLE]] 块，返回 {textBefore, table:[[...]], textAfter} 的数组片段
function officeParseBlocks(text){
  const parts = [];
  const re = /\[\[TABLE\]\]([\s\S]*?)\[\[\/TABLE\]\]/g;
  let last = 0, m;
  while((m = re.exec(text))){
    if(m.index > last) parts.push({type:"text", content:text.slice(last, m.index).trim()});
    const rows = m[1].trim().split("\n").map(r=>r.split("|").map(c=>c.trim())).filter(r=>r.length>1);
    if(rows.length) parts.push({type:"table", rows});
    last = re.lastIndex;
  }
  if(last < text.length) parts.push({type:"text", content:text.slice(last).trim()});
  return parts.filter(p=> p.type==="table" || (p.content && p.content.length));
}

async function officeExport(kind){
  const text = officeLastAnswer();
  if(!text){ officeNotify("还没有可导出的内容，请先让AI生成内容"); return; }
  const blocks = officeParseBlocks(text);
  try{
    if(kind === "word"){
      await ensureDocxLib();
      const D = window.docx;
      const run = (t, opt)=> new D.TextRun(Object.assign({text:String(t)}, opt||{}));
      const children = [];
      children.push(new D.Paragraph({ children:[run("办公文稿草稿",{size:32,bold:true})], alignment:D.AlignmentType.CENTER, spacing:{after:200} }));
      children.push(new D.Paragraph({ children:[run("生成时间："+new Date().toLocaleString("zh-CN")+"　｜　本文为AI辅助起草草稿，非正式签发文件",{size:18,color:"888888"})], spacing:{after:300} }));
      blocks.forEach(b=>{
        if(b.type === "text"){
          b.content.split("\n").filter(l=>l.trim()).forEach(line=>{
            children.push(new D.Paragraph({ children:[run(line)], spacing:{after:160} }));
          });
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
        const rows = text.split("\n").filter(l=>l.trim()).map(l=>[l]);
        const ws = XLSX.utils.aoa_to_sheet([["内容"], ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, "内容");
      }
      XLSX.writeFile(wb, "办公数据-"+Date.now()+".xlsx");
    }
  }catch(e){
    officeNotify("导出失败："+e.message);
  }
}
