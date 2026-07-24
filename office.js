/* ============================================================
   office.js —— AI办公助手（第四大功能模块）
   定位：日常办公文稿撰写、业务分析对话、导出Word/Excel
   依赖：agent-core.js（引擎）、export.js（ensureDocxLib/XLSX加载）、docxgen相关工具函数

   红线（与全站一致）：
   - 涉及本项目财务数字时，仍必须调用 get_calc_summary 工具引用真实测算结果，不得凭空编造
   - 本模块生成的是"办公文稿草稿"，不是正式签发文件；导出的文档不带公章/签发状态
   ============================================================ */

let officeChat = [];

function stepOffice(){
  return '<div class="doc-eyebrow">OFFICE · AI办公助手</div>'
    +'<h1 class="doc-title">AI办公助手</h1>'
    +'<div class="step-desc">像聊天一样描述你的需求：起草通知/周报/分析报告、整理数据成表格、结合本单位知识库与项目数据做业务分析。生成后可直接导出为 Word 或 Excel。'
    +'<br><span style="color:var(--seal-red,#C24A42);">提醒：本工具生成的是办公草稿，涉及财务数字/正式结论仍需人工核实后使用；不能替代财务测算与正式签发流程。</span></div>'
    +'<div id="officeMsgs" style="min-height:120px; margin-top:16px;"></div>'
    +'<div style="display:flex; gap:8px; margin-top:14px;">'
    +'<input id="officeInput" type="text" placeholder="例如：帮我写一份本周工作周报 / 把下面这些数据整理成表格 / 分析一下本项目的风险点" style="flex:1;">'
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

  const sys = "你是单位内部的AI办公助手，帮助员工撰写日常公文（通知、周报、请示、分析报告等）、整理数据为表格、结合本单位知识库和项目信息做业务分析。"
    + "\n要求：1. 涉及具体财务数字（如IRR、成本、收入）时，必须先调用工具获取真实数据，不得编造；没有真实数据支撑的数字一律标注'待核实'。"
    + "2. 需要表格时，用 [[TABLE]] 和 [[/TABLE]] 包裹，表头在第一行，单元格用竖线|分隔。"
    + "3. 输出正式公文语气，结构清晰；不要输出'以下是'之类的开场白，直接给内容。"
    + "4. 这是草稿性质的办公输出，不是正式签发文件，无需加盖章。";

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
    return '<div style="margin:10px 0; padding:12px 16px; font-size:13.5px; line-height:1.8; border-radius:8px; '
      +(m.role==="user"?'background:#EDF1F5;':'background:#FFF; border:1px solid var(--line,#DCE6F0);')+'">'
      +(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+traceHtml+bodyHtml+'</div>';
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
