// 审核相关模块 —— 从 index.html 内联脚本拆分而来（智能审查上传报告、硬规则检查、AI深度评审）
let rvChapters = [];   // 智能审查:解析出的章节
let rvStep = 0;        // 0上传 1结果
let rvFileName = "";
function renderReviewModule(){
  if(rvStep===0){
    return '<div class="doc-eyebrow">可研智能审查 · STEP 01</div>'
      +'<h1 class="doc-title">上传待审查的可研报告</h1>'
      +'<div class="step-desc">支持 Word(.docx)、PDF、txt。系统将自动拆解章节结构，随后可执行与生成流程完全一致的硬规则检查与AI深度评审。文件在浏览器本地解析，不上传服务器。</div>'
      +'<div style="border:2px dashed var(--line-strong); background:#FFF; padding:44px 20px; text-align:center; margin-top:20px;">'
      +'<button class="btn" id="rvPick">选择报告文件</button>'
      +'<input type="file" id="rvFile" accept=".docx,.pdf,.txt" style="display:none;">'
      +'<div id="rvStatus" style="font-size:12px; color:var(--ink-soft); margin-top:14px;">尚未选择文件</div></div>';
  }
  // 结果页
  const nSec = rvChapters.reduce((n,c)=>n+c.sections.length,0);
  let inner = rvChapters.map(c=>
    '<div class="ch-block"><h3 style="font-family:var(--serif); color:var(--bp-navy); margin:22px 0 6px;">第'+c.cn+'章　'+escapeHtml(c.name)+'</h3>'
    + c.sections.map((s,si)=>'<div class="section-block" data-cn="'+c.cn+'" data-si="'+si+'"><h4>'+escapeHtml(s.t)+'</h4>'
        +'<div class="body">'+renderContent(s.content||"")+'</div></div>').join("")
    +'</div>').join("");
  return '<div class="doc-eyebrow">可研智能审查 · STEP 02</div>'
    +'<h1 class="doc-title">审查：'+escapeHtml(rvFileName||"未命名报告")+'</h1>'
    +'<div class="step-desc">已解析 '+rvChapters.length+' 章 / '+nSec+' 个小节。硬规则检查免费即时；AI深度评审逐节调用（消耗生成额度）。</div>'
    +'<div class="cf-chart" style="margin:0 0 16px;"><div class="cf-head"><span>审查检查</span><span style="display:flex; gap:8px;"><button class="ub-btn" id="auditBtn">运行审核检查</button><button class="ub-btn" id="aiAuditBtn">AI深度审核</button></span></div><div id="aiAuditBox" style="font-size:12.5px; display:none;"></div><div id="auditBox" style="font-size:12.5px;"><span style="color:var(--ink-soft);">检查项：完整性（待填）、规范性（篇幅/AI穿帮语）与AI逐节评审。</span></div></div>'
    + inner
    +'<div class="actions"><button class="btn ghost" id="rvBack">← 换一份报告</button></div>';
}
async function rvParseFile(f){
  const ext = (f.name.split(".").pop()||"").toLowerCase();
  if(ext==="txt") return await f.text();
  if(ext==="docx"){
    if(!window.mammoth) await loadScript("mammoth.min.js");
    const r = await window.mammoth.extractRawText({arrayBuffer: await f.arrayBuffer()});
    return r.value||"";
  }
  if(ext==="pdf"){
    if(!window.pdfjsLib) await loadScript("pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    const parts = [];
    for(let p=1; p<=pdf.numPages; p++){
      const tc = await (await pdf.getPage(p)).getTextContent();
      parts.push(tc.items.map(it=>it.str).join(""));
    }
    return parts.join("\n");
  }
  throw new Error("不支持的格式 ."+ext);
}
function splitReportText(text){
  const lines = text.split(/\r?\n/);
  const chRe = /^第\s*([一二三四五六七八九十百]+)\s*[章篇]\s*[、．.:：\s]*(.*)$/;
  const secRe = /^(\d+\.\d+)\s*[、．.:：\s]*(.+)$/;
  const secRe2 = /^[（(]?([一二三四五六七八九十]+)[）)]\s*[、．.]?\s*(.{2,30})$/;
  const chs = [];
  let curC = null, curS = null;
  const flush = ()=>{ if(curS && curC){ curS.content = curS.content.trim(); curC.sections.push(curS); curS=null; } };
  lines.forEach(raw=>{
    const line = raw.trim();
    if(!line) { if(curS) curS.content += "\n\n"; return; }
    let m;
    if((m = line.match(chRe)) && line.length < 40){
      flush();
      curC = {cn:m[1], name:(m[2]||"").trim()||("第"+m[1]+"章"), sections:[]};
      chs.push(curC); return;
    }
    if(curC && (m = line.match(secRe)) && line.length < 45){
      flush();
      curS = {t:m[2].trim(), content:""}; return;
    }
    if(curC && !curS && (m = line.match(secRe2)) && line.length < 34){
      curS = {t:line, content:""}; return;
    }
    if(!curC){ curC = {cn:"—", name:"前置部分", sections:[]}; chs.push(curC); }
    if(!curS) curS = {t:"正文", content:""};
    curS.content += line + "\n";
  });
  flush();
  chs.forEach(c=>{ if(!c.sections.length) c.sections.push({t:"（本章无子节）", content:""}); });
  return chs.filter(c=>c.sections.some(s=>s.content.trim()) || c.sections.length);
}
function bindReviewEvents(){
  const s = id=>document.getElementById(id);
  if(s("rvPick")) s("rvPick").onclick = ()=>s("rvFile").click();
  if(s("rvFile")) s("rvFile").onchange = async e=>{
    const f = e.target.files[0];
    if(!f) return;
    s("rvStatus").textContent = "正在解析《"+f.name+"》…";
    try{
      const text = await rvParseFile(f);
      if(!text.trim()) throw new Error("未提取到文字（可能是扫描件PDF）");
      rvChapters = splitReportText(text);
      if(!rvChapters.length) throw new Error("未能识别章节结构");
      rvFileName = f.name.replace(/\.[^.]+$/,"");
      rvStep = 1; renderTOC(); renderSheet();
    }catch(err){ s("rvStatus").textContent = "解析失败："+err.message; }
  };
  if(s("rvBack")) s("rvBack").onclick = ()=>{ rvStep=0; rvChapters=[]; renderTOC(); renderSheet(); };
}

/* ================= 可研审核 · AI深度评审 ================= */
const DEFAULT_AI_RULES = [{match:"*", rule:"①论证是否有具体依据（政策/数据/事实），避免空洞套话；②逻辑层次是否清晰、有分点递进；③表述是否符合正式公文文风；④涉及数字处是否明确来源或标注待填；⑤篇幅与深度是否达到正式可研报告水准。"}];
function aiRulesFor(chName, secTitle){
  const rules = (CALC_CFG.airules && CALC_CFG.airules.length)? CALC_CFG.airules : DEFAULT_AI_RULES;
  const q = String(chName||"")+String(secTitle||"");
  return rules.filter(r=> r.match==="*" || String(r.match||"").split(/[,，、\s]+/).filter(Boolean).some(k=>q.includes(k)));
}
async function aiAuditOne(c, s){
  const rules = aiRulesFor(c.name, s.t);
  const src = s.editedHtml? blocksToSource(s.editedHtml) : (s.content||"");
  const sys = '你是政府投资项目可研报告评审专家。请依据【审核要点】评审给定小节，只输出一个JSON对象（不要markdown代码块、不要任何其他文字），格式：{"score":0到100整数,"issues":[{"point":"问题(15字内)","suggestion":"具体修改建议(40字内)"}]}。达标项不要列入issues；最多列3条最重要的问题；写得好就给高分、issues可为空数组。';
  const user = '【小节】第'+c.cn+'章 '+c.name+' — '+s.t
    +'\n【审核要点】\n'+rules.map((r,i)=>(i+1)+'. '+r.rule).join('\n')
    +'\n【小节内容】\n'+src.slice(0,3000);
  const text = await callGen(sys, user);
  const clean = text.replace(/```json|```/g,"").trim();
  const j = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}")+1));
  return { score: Math.max(0,Math.min(100, parseInt(j.score)||0)), issues: Array.isArray(j.issues)? j.issues.slice(0,3):[] };
}
async function runAiAudit(){
  const active = appMode==="review"? rvChapters : chapters.filter(c=>c.checked);
  const tasks = [];
  active.forEach(c=>c.sections.forEach((s,si)=>{ if(s.content||s.editedHtml) tasks.push({c,s,si}); }));
  if(!tasks.length){ alert("没有可审核的内容"); return; }
  const est = (tasks.length*(1500+200)/10000).toFixed(1);
  if(!confirm("将对 "+tasks.length+" 个小节进行AI深度评审，预计消耗约 "+est+" 万tokens，占用生成额度 "+tasks.length+" 次。继续？")) return;
  const box = document.getElementById("aiAuditBox");
  box.style.display = "block";
  let done = 0, results = [];
  box.innerHTML = 'AI评审中… 0/'+tasks.length;
  async function one(t){
    try{ const r = await aiAuditOne(t.c, t.s); results.push(Object.assign({cn:t.c.cn, si:t.si, chName:t.c.name, secTitle:t.s.t}, r)); }
    catch(e){ results.push({cn:t.c.cn, si:t.si, chName:t.c.name, secTitle:t.s.t, score:null, issues:[], err:e.message}); }
    done++; box.innerHTML = 'AI评审中… '+done+'/'+tasks.length;
  }
  const queue = tasks.slice();
  await Promise.all(Array.from({length:Math.min(3,queue.length)}, ()=>(async()=>{ while(queue.length) await one(queue.shift()); })()));
  renderAiAudit(results);
}
function renderAiAudit(results){
  window.__lastAuditResults = results;   // 暴露给悬浮助手的工具读取，不改变原有渲染行为
  const box = document.getElementById("aiAuditBox");
  const scored = results.filter(r=>r.score!==null);
  const avg = scored.length? Math.round(scored.reduce((s,r)=>s+r.score,0)/scored.length) : 0;
  const dot = v=> v>=80? "var(--ok-green)" : v>=60? "#C99A2E" : "var(--seal-red)";
  let htmlStr = '<div style="font-weight:700; margin:8px 0;">AI评审完成：全篇平均 <span style="color:'+dot(avg)+'; font-size:18px;">'+avg+'</span> 分'
    +(results.some(r=>r.err)? '（'+results.filter(r=>r.err).length+' 节评审失败）':'')+'</div>';
  results.sort((a,b)=>(a.score===null?-1:a.score)-(b.score===null?-1:b.score));
  htmlStr += results.map(r=>{
    let inner = '<div class="audit-row" style="flex-wrap:wrap;">'
      +'<span style="font-family:var(--mono); font-weight:700; color:'+(r.score===null?"var(--ink-soft)":dot(r.score))+'; min-width:34px;">'+(r.score===null?"—":r.score)+'</span>'
      +'<span style="color:var(--ink-soft); cursor:pointer;" data-aigoto="'+r.cn+'_'+r.si+'">第'+r.cn+'章 · '+escapeHtml(r.secTitle)+'</span>'
      +(r.err? '<span style="margin-left:10px; color:var(--seal-red);">'+escapeHtml(r.err)+'</span>':'');
    r.issues.forEach(it=>{
      inner += '<div style="width:100%; padding:3px 0 3px 44px; display:flex; gap:8px; align-items:baseline;">'
        +'<span style="color:var(--seal-red);">•</span><span>'+escapeHtml(it.point||"")+'：'+escapeHtml(it.suggestion||"")+'</span>'
        +'<button class="ub-btn" data-adopt="'+r.cn+'_'+r.si+'" data-sug="'+escapeHtml(it.suggestion||"")+'" style="flex-shrink:0; padding:2px 10px; font-size:11px;">采纳→AI修改</button></div>';
    });
    return inner + '</div>';
  }).join("");
  box.innerHTML = htmlStr;
  box.querySelectorAll("[data-aigoto]").forEach(el=>{ el.onclick = ()=>locateSection(el.dataset.aigoto); });
  box.querySelectorAll("[data-adopt]").forEach(btn=>{
    btn.onclick = ()=>{
      const blk = locateSection(btn.dataset.adopt);
      if(!blk) return;
      const bar = blk.querySelector(".revise-bar");
      if(!bar) return;
      bar.style.display = "flex";
      const inp = bar.querySelector(".rev-input");
      inp.value = btn.dataset.sug;
      inp.focus();
    };
  });
}
function locateSection(key){
  const parts = key.split("_");
  const cn = parts[0], si = parts[1];
  const el = document.querySelector('.section-block[data-cn="'+cn+'"][data-si="'+si+'"]');
  if(el){ el.scrollIntoView({behavior:"smooth", block:"center"}); el.style.outline="2px solid var(--seal-red)"; setTimeout(()=>el.style.outline="",1800); }
  return el;
}

/* ================= 可研审核 · 硬规则检查（零AI成本，确定性） ================= */
function runAudit(){
  const issues = [];  // {sev:"err"|"warn"|"info", cn, si, secTitle, msg}
  const add = (sev,c,si,s,msg)=>issues.push({sev, cn:c.cn, si, secTitle:s? s.t:"", chName:c.name, msg});
  const active = appMode==="review"? rvChapters : chapters.filter(c=>c.checked);
  const plain = s => {
    const src = s.editedHtml? s.editedHtml.replace(/<[^>]+>/g," ") : (s.content||"");
    return src;
  };
  const fullText = active.map(c=>c.sections.map(plain).join("\n")).join("\n");

  active.forEach(c=>c.sections.forEach((s,si)=>{
    const t = plain(s);
    // 完整性
    if(!s.content && !s.editedHtml){ add("err",c,si,s,"未生成内容"); return; }
    const tf = (t.match(/待填/g)||[]).length;
    if(tf) add("warn",c,si,s,"存在 "+tf+" 处「待填」，须补充真实数据");
    // 规范性
    const len = t.replace(/\s/g,"").length;
    if(len < 150) add("info",c,si,s,"篇幅偏短（"+len+"字），建议充实");
    if(s.numeric){
      const hasTable = s.editedHtml? /<table/i.test(s.editedHtml) : /\[\[TABLE\]\]/.test(s.content||"");
      if(!hasTable) add("warn",c,si,s,"数据类子节缺少数据表格");
    }
    // 穿帮语
    const m = t.match(/作为(一个)?(AI|人工智能|语言模型)|以下是|希望对您有帮助|抱歉，|无法提供/);
    if(m) add("err",c,si,s,"疑似AI穿帮语：「"+m[0]+"」");
  }));

  // 一致性：全文数字 vs 测算结果（同一问题去重）
  const seen = new Set();
  const addOnce = (msg)=>{ if(seen.has(msg)) return; seen.add(msg); issues.push({sev:"err", cn:"—", si:null, secTitle:"", chName:"全文一致性", msg}); };
  if(appMode!=="review" && calcResult && calcResult.summary){
    const S = calcResult.summary;
    const near = (a,b,tol)=>Math.abs(a-b)<=tol;
    // IRR：找“内部收益率/IRR”附近的百分数
    if(S.irr!==null && S.irr!==undefined){
      const re = /(内部收益率|IRR)[^。\n]{0,30}?(-?\d+(?:\.\d+)?)\s*%/g;
      let mm;
      while((mm = re.exec(fullText))){
        const v = parseFloat(mm[2]);
        if(!near(v, S.irr, 0.05)) addOnce("IRR 表述「"+mm[2]+"%」与测算结果 "+S.irr+"% 不一致");
      }
    }
    // 净现值/净利润/总收入：找指标名附近的金额
    [["净现值", S.totalNpv], ["净利润", S.totalNetProfit], ["总收入", S.totalIncome]].forEach(([label, val])=>{
      if(val===null||val===undefined) return;
      const re = new RegExp(label+"[^。\\n]{0,25}?(-?[\\d,]+(?:\\.\\d+)?)\\s*万", "g");
      let mm;
      while((mm = re.exec(fullText))){
        const v = parseFloat(mm[1].replace(/,/g,""));
        if(!near(v, val, Math.max(Math.abs(val)*0.005, 0.5))) addOnce(label+" 表述「"+mm[1]+"万」与测算结果 "+(Math.round(val*100)/100).toLocaleString("zh-CN")+"万 不一致");
      }
    });
  }
  return issues;
}
function auditPanelHtml(issues){
  const err = issues.filter(x=>x.sev==="err"), warn = issues.filter(x=>x.sev==="warn"), info = issues.filter(x=>x.sev==="info");
  const dot = s=> s==="err"? "var(--seal-red)" : s==="warn"? "#C99A2E" : "var(--ink-soft)";
  let head;
  if(!issues.length) head = '<div style="color:var(--ok-green); font-weight:700;">✓ 全部检查通过（完整性 / 规范性 / 数据一致性），可进入签发。</div>';
  else head = '<div style="font-weight:700;">检查完成：<span style="color:var(--seal-red);">'+err.length+' 项错误</span> ｜ <span style="color:#C99A2E;">'+warn.length+' 项警告</span> ｜ '+info.length+' 项提示</div>';
  const rows = issues.map(x=>
    '<div class="audit-row" '+(x.si!==null&&x.si!==undefined?'data-goto="'+x.cn+'_'+x.si+'" style="cursor:pointer;"':'')+'>'
    +'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+dot(x.sev)+';margin-right:8px;flex-shrink:0;"></span>'
    +'<span style="color:var(--ink-soft); flex-shrink:0;">'+(x.si!==null&&x.si!==undefined? '第'+x.cn+'章 · '+escapeHtml(x.secTitle) : escapeHtml(x.chName))+'</span>'
    +'<span style="margin-left:10px;">'+escapeHtml(x.msg)+'</span></div>').join("");
  return head + '<div style="margin-top:8px; max-height:260px; overflow-y:auto;">'+rows+'</div>'
    +'<div style="font-size:11px; color:var(--ink-soft); margin-top:8px;">点击条目可定位到对应小节。硬规则检查不消耗AI额度。</div>';
}

function stepReview(){
  const active = chapters.filter(c=>c.checked);
  let inner = active.map(c=>'<div class="chapter-block"><h3><span class="cn">'+c.cn+'</span>'+c.name+'</h3>'
    + c.sections.map((s,si)=>'<div class="section-block" data-cn="'+c.cn+'" data-si="'+si+'"><h4>'+s.t+'<button class="regen-btn" data-cn="'+c.cn+'" data-si="'+si+'" title="用AI重写本节">↻ 重写</button><button class="regen-btn rev-toggle" data-cn="'+c.cn+'" data-si="'+si+'" title="提修改意见，AI按要求改">✎ AI修改</button></h4>'
        +'<div class="body" contenteditable="true">'+(s.editedHtml? s.editedHtml : (s.content? renderContent(s.content) : "（该子章节未生成）"))+'</div>'
        +'<div class="revise-bar" style="display:none;"><input type="text" class="rev-input" placeholder="修改意见，如：数据分析太浅，应结合敏感性分析展开；语气再正式一些…"><button class="btn rev-go" data-cn="'+c.cn+'" data-si="'+si+'" style="padding:7px 16px; font-size:12px; flex-shrink:0;">按要求修改</button></div>'
        +(s.numeric?'<div class="data-flag">⚠ 请核对/替换为真实数据后再签发</div>':'')+'</div>').join("")
    +'</div>').join("");
  return '<div class="doc-eyebrow">STEP 05 · 人工复核与签发</div>'
    +'<h1 class="doc-title">'+(project.name||"（未命名项目）")+'可行性研究报告</h1>'
    +(!signed?'<div class="watermark">AI初稿 · 未经复核</div>':'')
    + archiveCardHtml()
    +'<div class="step-desc">每一段正文可直接点击编辑。数据类子章节的表格须由人工替换为真实测算结果后，方可确认签发。</div>'
    +'<div class="cf-chart" style="margin:0 0 16px;"><div class="cf-head"><span>签发前审核检查</span><span style="display:flex; gap:8px;"><button class="ub-btn" id="auditBtn">运行审核检查</button><button class="ub-btn" id="aiAuditBtn">AI深度审核</button></span></div><div id="aiAuditBox" style="font-size:12.5px; display:none;"></div><div id="auditBox" style="font-size:12.5px;"><span style="color:var(--ink-soft);">检查项：内容完整性（未生成/待填）、规范性（篇幅/数据表格/AI穿帮语）、全文与测算结果的数据一致性。</span></div></div>'
    + inner
    +(signed?'<div class="seal"><span>单位复核确认<br>'+new Date().toLocaleDateString('zh-CN')+'<br>责任人签发</span></div><div class="final-banner">✓ 已完成人工复核签发，可导出正式文本</div>':'')
    +'<div class="actions"><button class="btn ghost" id="backStep4r">← 返回生成</button>'
    +'<button class="btn ghost" id="exportWordBtn">导出 Word</button>'
    +(!signed?'<button class="btn" id="signBtn">人工复核 · 确认签发</button>':'<button class="btn" id="printBtn">打印</button>')+'</div>';
}



function findChapterSection(cn, si){
  const c = chapters.find(x=>x.cn===cn);
  if(!c || !c.sections[si]) return null;
  return {chapter:c, section:c.sections[si]};
}
function findSection(cn, si){ const r = findChapterSection(cn, si); return r? r.section : null; }
