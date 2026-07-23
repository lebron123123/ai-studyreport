// 应用外壳/路由模块 —— 从 index.html 内联脚本拆分而来（步骤路由、TOC导航、首页、公共工具函数、全局事件绑定）
const STEPS = ["选择领域","项目信息","财务测算","章节范围","逐章生成","复核与签发"];
let currentStep = 0;
let appMode = null;          // null=首页 | 'report'=可研生成 | 'calc'=独立测算
function mountAnchorNav(){
  const old = document.getElementById("anchorNav");
  if(old) old.remove();
  if(appMode!=="report") return;
  if(currentStep!==4 && currentStep!==5) return;
  const active = chapters.filter(c=>c.checked);
  if(!active.length) return;
  const items = active.map(c=>'<a href="#block_anchor_'+c.cn+'" data-cn="'+c.cn+'">'+c.cn+'</a>').join("");
  document.body.insertAdjacentHTML("beforeend", '<nav id="anchorNav" aria-label="章节跳转">'+items+'</nav>');
  document.querySelectorAll("#anchorNav a").forEach(a=>{
    a.onclick = e=>{
      e.preventDefault();
      const cn = a.dataset.cn;
      const target = document.querySelector('.chapter-block h3 .cn') ?
        Array.from(document.querySelectorAll('.chapter-block')).find(b=>{
          const cne = b.querySelector('h3 .cn'); return cne && cne.textContent===cn;
        }) : null;
      if(target) target.scrollIntoView({behavior:"smooth", block:"start"});
    };
  });
}

function renderTOC(){
  const el = document.getElementById("tocList");
  let items = "";
  if(appMode===null){
    const HM = [
      {id:"homeCalc",  ic:"📊", label:"财务测算"},
      {id:"homeReview",ic:"🔍", label:"可研智能审查"},
      {id:"homeReport",ic:"📄", label:"可研生成"},
    ];
    items += HM.map(m=>'<div class="toc-item" data-home="'+m.id+'" style="cursor:pointer;"><span class="num">'+m.ic+'</span><span>'+m.label+'</span></div>').join("");
  }
  if(appMode!==null){
    items += '<div class="toc-item" style="cursor:pointer;" onclick="goHome()"><span class="num">⌂</span><span>返回首页</span></div>';
  }
  if(appMode==="calc"){
    const CS = ["选择类型","参数录入","测算结果"];
    items += CS.map((s,i)=>{
      const cls = i===scStep?"active":(i<scStep?"done":"");
      const click = i<scStep? ' data-goc="'+i+'" style="cursor:pointer;"' : '';
      return '<div class="toc-item '+cls+'"'+click+'><span class="num">'+String(i+1).padStart(2,'0')+'</span><span>'+s+'</span></div>';
    }).join("");
  }else if(appMode==="review"){
    const RS = ["上传报告","审查结果"];
    items += RS.map((s,i)=>{
      const cls = i===rvStep?"active":(i<rvStep?"done":"");
      const click = i<rvStep? ' data-gov="'+i+'" style="cursor:pointer;"' : '';
      return '<div class="toc-item '+cls+'"'+click+'><span class="num">'+String(i+1).padStart(2,'0')+'</span><span>'+s+'</span></div>';
    }).join("");
  }else if(appMode==="report"){
    items += STEPS.map((s,i)=>{
      const cls = i===currentStep?"active":(i<currentStep?"done":"");
      const click = i<currentStep? ' data-gor="'+i+'" style="cursor:pointer;"' : '';
      return '<div class="toc-item '+cls+'"'+click+'><span class="num">'+String(i+1).padStart(2,'0')+'</span><span>'+s+'</span></div>';
    }).join("");
  }
  el.innerHTML = items;
  el.querySelectorAll("[data-gor]").forEach(it=>{ it.onclick = ()=>{ currentStep = +it.dataset.gor; renderTOC(); renderSheet(); }; });
  el.querySelectorAll("[data-goc]").forEach(it=>{ it.onclick = ()=>{ scStep = +it.dataset.goc; renderTOC(); renderSheet(); }; });
  el.querySelectorAll("[data-gov]").forEach(it=>{ it.onclick = ()=>{ rvStep = +it.dataset.gov; renderTOC(); renderSheet(); }; });
  el.querySelectorAll("[data-home]").forEach(it=>{
    it.onclick = ()=>{ const card = document.getElementById(it.dataset.home); if(card) card.click(); };
  });
}
function goHome(){ appMode=null; renderTOC(); renderSheet(); }

function renderSheet(){
  const sheet = document.getElementById("sheet");
  if(appMode===null){ sheet.innerHTML = stepHome(); bindEvents(); bindCalcEvents(); mountAnchorNav(); return; }
  if(appMode==="calc"){ sheet.innerHTML = renderCalcModule(); bindEvents(); bindCalcEvents(); mountAnchorNav(); return; }
  if(appMode==="review"){ sheet.innerHTML = renderReviewModule(); bindEvents(); bindReviewEvents(); mountAnchorNav(); return; }
  if(currentStep===0) sheet.innerHTML = stepDomain();
  if(currentStep===1) sheet.innerHTML = stepProjectInfo();
  if(currentStep===2) sheet.innerHTML = stepCalc();
  if(currentStep===3) sheet.innerHTML = stepChapters();
  if(currentStep===4) sheet.innerHTML = stepGenerate();
  if(currentStep===5) sheet.innerHTML = stepReview();
  bindEvents();
  mountAnchorNav();
}


function heroDraftHtml(){
  return `<div class="hero-draft" aria-hidden="true"><svg viewBox="0 0 700 150" xmlns="http://www.w3.org/2000/svg">
    <!-- 地平线 -->
    <path class="draw d1" d="M20 130 H680" fill="none"/>
    <!-- 住宅楼A -->
    <path class="draw d2" d="M60 130 V52 H150 V130" fill="none"/>
    <path class="draw d3" d="M72 66 H138 M72 82 H138 M72 98 H138 M72 114 H138 M94 52 V130 M116 52 V130" fill="none" stroke-width="1"/>
    <!-- 住宅楼B（高层） -->
    <path class="draw d3" d="M180 130 V28 H248 V130" fill="none"/>
    <path class="draw d4" d="M192 42 H236 M192 58 H236 M192 74 H236 M192 90 H236 M192 106 H236 M214 28 V130" fill="none" stroke-width="1"/>
    <!-- 住宅楼C（板楼） -->
    <path class="draw d4" d="M278 130 V68 H388 V130" fill="none"/>
    <path class="draw d5" d="M292 82 H374 M292 98 H374 M292 114 H374 M314 68 V130 M336 68 V130 M358 68 V130" fill="none" stroke-width="1"/>
    <!-- 树 -->
    <path class="draw d5" d="M420 130 V116 M420 116 a9 9 0 1 1 .1 0" fill="none"/>
    <path class="draw d5" d="M448 130 V118 M448 118 a7 7 0 1 1 .1 0" fill="none"/>
    <!-- 塔吊 -->
    <path class="draw d2" d="M540 130 V22 M528 130 H552 M540 22 H472 M540 22 H660 M540 22 L505 40 M540 22 L575 40" fill="none"/>
    <path class="draw d4" d="M628 22 V64 M620 64 H636 M628 64 V72" fill="none" stroke-width="1"/>
    <path class="crane-flag" d="M540 22 L540 10 L556 15 Z"/>
    <!-- 施工中的楼（框架） -->
    <path class="draw d6" d="M596 130 V86 H668 V130 M596 108 H668 M620 86 V130 M644 86 V130" fill="none" stroke-width="1"/>
    <!-- 航标灯（呼吸的窗灯） -->
    <rect class="lamp l1" x="97" y="70" width="8" height="6"/>
    <rect class="lamp l2" x="218" y="46" width="8" height="6"/>
    <rect class="lamp l3" x="340" y="86" width="8" height="6"/>
    <!-- 制图尺寸标注 -->
    <path class="dim" d="M60 142 H388 M60 138 V146 M388 138 V146" fill="none"/>
    <text class="dim-t" x="205" y="139" text-anchor="middle">RESIDENTIAL BLOCK A · B · C</text>
    <text class="anno" x="612" y="146" text-anchor="middle">在建 · 安居</text>
  </svg><span class="hero-cap">图别：总体鸟瞰示意（自动绘制）　比例：示意　单位：mm</span></div>`;
}


function domainIcon(k){
  if(k==="baozhang_xinjian"){
    return `<svg class="dm-ico" viewBox="0 0 40 40" aria-hidden="true"><path d="M6 34 H34 M10 34 V12 H22 V34 M26 34 V18 H34 V34 M13 16 h6 M13 21 h6 M13 26 h6 M29 22 h2 M29 27 h2" fill="none"/></svg>`;
  }
  return `<svg class="dm-ico" viewBox="0 0 40 40" aria-hidden="true"><path d="M6 34 H34 M9 34 V14 H27 V34 M13 19 h10 M13 24 h10 M13 29 h10" fill="none"/><path class="dm-arrow" d="M30 8 a8 8 0 1 1 -8 8" fill="none"/><path class="dm-arrow-h" d="M30 4 L30 12 L23 8 Z"/></svg>`;
}


/* ================= 首页：两大功能分类 ================= */
function stepHome(){
  return '<div class="doc-eyebrow">HOME · 欢迎</div>'
    +'<h1 class="doc-title">可研报告工坊</h1>'
    +'<div class="step-desc">请从左侧选择要使用的功能模块：财务测算、可研智能审查、可研生成。</div>'
    // 三个入口按钮仍然渲染(供左侧导航点击复用同一套逻辑)，但不在正文区展示为卡片
    +'<div style="display:none;">'
    +'<div class="domain-card" id="homeCalc"></div>'
    +'<div class="domain-card" id="homeReview"></div>'
    +'<div class="domain-card" id="homeReport"></div>'
    +'</div>';
}

/* ================= 独立测算模块 ================= */
function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}


// 把测算结果整理成给AI的数据摘要 + 现成表格
function bindEvents(){
  const s = id=>document.getElementById(id);
  document.querySelectorAll(".domain-card").forEach(card=>{
    card.onclick = ()=>{ loadDomain(card.dataset.key); renderSheet(); };
  });
  if(s("cpFetch")) s("cpFetch").onclick = fetchCompetitors;
  if(s("poiBtn")) s("poiBtn").onclick = fetchPoi;
  if(s("aiPosBtn")) s("aiPosBtn").onclick = aiPositionSuggest;
  if(s("cpAdd")) s("cpAdd").onclick = ()=>{
    readCpFromDom(); saveProject();
    project.competitors = project.competitors||[];
    project.competitors.push({name:"",dist:"",rent:"",occ:"",note:""});
    renderSheet();
  };
  document.querySelectorAll(".cp-del").forEach(b=>b.onclick=()=>{
    readCpFromDom(); saveProject();
    project.competitors.splice(+b.dataset.ci,1);
    renderSheet();
  });
  document.querySelectorAll(".cp-name,.cp-rent,.cp-occ").forEach(inp=>{
    inp.addEventListener("input", ()=>{ clearTimeout(inp.__t); inp.__t = setTimeout(renderCpChart, 400); });
  });
  if(document.getElementById("cpChartBox")) renderCpChart();
  if(s("kbAdd")) s("kbAdd").onclick = ()=>{ readKbFromDom(); kbEntries.push({title:"",content:""}); renderSheet(); };
  if(s("kbUpload")) s("kbUpload").onclick = ()=>{ s("kbFile").click(); };
  if(s("kbFile")) s("kbFile").onchange = e=>{ if(e.target.files.length) kbHandleFiles([...e.target.files]); };
  document.querySelectorAll(".kb-del").forEach(b=>{ b.onclick = ()=>{ readKbFromDom(); kbEntries.splice(+b.dataset.ki,1); renderSheet(); }; });
  if(s("toStep1")) s("toStep1").onclick = ()=>{ if(!domainKey) return; currentStep=1; renderTOC(); renderSheet(); };
  if(s("backStep0")) s("backStep0").onclick = ()=>{ currentStep=0; renderTOC(); renderSheet(); };
  if(s("toStep2")) s("toStep2").onclick = ()=>{ saveProject(); saveDraft(); currentStep=2; renderTOC(); renderSheet(); };
  if(s("backStep1c")) s("backStep1c").onclick = ()=>{ currentStep=1; renderTOC(); renderSheet(); };
  if(s("runCalcBtn")) s("runCalcBtn").onclick = runCalc;
  if(s("rptCtype")) s("rptCtype").onchange = ()=>{ rptCtype = s("rptCtype").value; scParams=null; calcParams=null; calcResult=null; renderSheet(); };
  if(s("toStep3c")) s("toStep3c").onclick = ()=>{ currentStep=3; renderTOC(); renderSheet(); };
  if(s("backStep2ch")) s("backStep2ch").onclick = ()=>{ currentStep=2; renderTOC(); renderSheet(); };
  if(s("chAll")) s("chAll").onclick = ()=>{ chapters.forEach(c=>c.checked=true); saveDraft(); renderSheet(); };
  if(s("chNone")) s("chNone").onclick = ()=>{ chapters.forEach(c=>c.checked=false); saveDraft(); renderSheet(); };
  if(s("chRange")) s("chRange").onclick = ()=>{
    let a = parseInt(s("chFrom").value)||1, b = parseInt(s("chTo").value)||chapters.length;
    if(a>b){ const t=a; a=b; b=t; }
    chapters.forEach((c,i)=>c.checked = (i+1>=a && i+1<=b));
    saveDraft(); renderSheet();
  };
  if(s("toStep4g")) s("toStep4g").onclick = ()=>{ currentStep=4; renderTOC(); renderSheet(); };
  if(s("backStep3g")) s("backStep3g").onclick = ()=>{ currentStep=3; renderTOC(); renderSheet(); };
  if(s("startGen")) s("startGen").onclick = runGeneration;
  if(s("toStep5r")) s("toStep5r").onclick = ()=>{ currentStep=5; renderTOC(); renderSheet(); };
  if(s("backStep4r")) s("backStep4r").onclick = ()=>{ currentStep=4; renderTOC(); renderSheet(); };
  if(s("aiAuditBtn")) s("aiAuditBtn").onclick = runAiAudit;
  if(s("auditBtn")) s("auditBtn").onclick = ()=>{
    const issues = runAudit();
    document.getElementById("auditBox").innerHTML = auditPanelHtml(issues);
    document.querySelectorAll(".audit-row[data-goto]").forEach(r=>{
      r.onclick = ()=>{
        const [cn,si] = r.dataset.goto.split("_");
        const el = document.getElementById("sec_"+cn+"_"+si) || document.querySelector('.section-block[data-cn="'+cn+'"][data-si="'+si+'"]');
        if(el){ el.scrollIntoView({behavior:"smooth", block:"center"}); el.style.outline="2px solid var(--seal-red)"; setTimeout(()=>el.style.outline="",1800); }
      };
    });
  };
  if(s("signBtn")) s("signBtn").onclick = ()=>{ signed=true; saveDraft(); renderSheet(); };
  if(s("printBtn")) s("printBtn").onclick = ()=> window.print();
  if(s("exportWordBtn")) s("exportWordBtn").onclick = exportWord;
  document.querySelectorAll(".chk").forEach(chk=>{ chk.onchange = e=>{ chapters[+e.target.dataset.idx].checked = e.target.checked; }; });
  if(document.querySelector(".cnum")) animateCountUps();
  // 复核页：编辑实时写回数据层（修复"返回再进来编辑丢失"）
  document.querySelectorAll('#sheet .section-block[data-cn] .body[contenteditable]').forEach(el=>{
    el.addEventListener("blur", ()=>{
      const blk = el.closest(".section-block");
      const sec = findSection(blk.dataset.cn, +blk.dataset.si);
      if(sec){ sec.editedHtml = el.innerHTML; saveDraft(); }
    });
  });
  // 复核页：单节AI重写
  document.querySelectorAll(".rev-toggle").forEach(btn=>{
    btn.onclick = ()=>{
      const blk = btn.closest(".section-block");
      const bar = blk.querySelector(".revise-bar");
      bar.style.display = bar.style.display==="none"? "flex":"none";
      if(bar.style.display==="flex") bar.querySelector(".rev-input").focus();
    };
  });
  document.querySelectorAll(".rev-go").forEach(btn=>{
    const doRevise = async ()=>{
      const blk = btn.closest(".section-block");
      const inp = blk.querySelector(".rev-input");
      const instruction = inp.value.trim();
      if(!instruction){ inp.focus(); return; }
      const info = findChapterSection(btn.dataset.cn, +btn.dataset.si);
      if(!info) return;
      const bodyEl = blk.querySelector(".body");
      btn.disabled = true; btn.textContent = "修改中…";
      blk.querySelectorAll(".regen-btn").forEach(b=>b.disabled=true);
      try{
        const text = await reviseSection(info.chapter, info.section, instruction, (partial)=>{
          bodyEl.textContent = partial;
        });
        info.section.content = text;
        info.section.editedHtml = null;
        bodyEl.innerHTML = renderContent(text);
        inp.value = "";
        blk.querySelector(".revise-bar").style.display = "none";
        saveDraft();
        try{ fetch("/api/revlog",{method:"POST", headers:Object.assign({"Content-Type":"application/json"}, authHeaders()),
          body:JSON.stringify({chapter:info.chapter.name, section:info.section.t, instruction})}); }catch(e){}
      }catch(e){
        alert("修改失败："+e.message);
        bodyEl.innerHTML = info.section.editedHtml? info.section.editedHtml : renderContent(info.section.content||"");
      }
      btn.disabled = false; btn.textContent = "按要求修改";
      blk.querySelectorAll(".regen-btn").forEach(b=>b.disabled=false);
    };
    btn.onclick = doRevise;
    const inp = btn.closest(".revise-bar").querySelector(".rev-input");
    inp.addEventListener("keydown", e=>{ if(e.key==="Enter") doRevise(); });
  });

  document.querySelectorAll(".regen-btn:not(.rev-toggle)").forEach(btn=>{
    btn.onclick = async (e)=>{
      e.preventDefault();
      const cn = btn.dataset.cn, si = +btn.dataset.si;
      const info = findChapterSection(cn, si);
      if(!info) return;
      const blk = btn.closest(".section-block");
      const bodyEl = blk.querySelector(".body");
      btn.disabled = true; btn.textContent = "重写中…"; blk.classList.add("gen");
      try{
        const text = await generateSection(info.chapter, info.section);
        info.section.content = text;
        info.section.editedHtml = null;
        bodyEl.innerHTML = renderContent(text);
        saveDraft();
      }catch(err){ bodyEl.insertAdjacentHTML("afterbegin", '<p style="color:var(--seal-red);">重写失败：'+err.message+'</p>'); }
      blk.classList.remove("gen");
      btn.disabled = false; btn.textContent = "↻ 重写";
    };
  });
  // 生成页：失败重试
  document.querySelectorAll(".retry-btn").forEach(btn=>{
    btn.onclick = async ()=>{
      const cn = btn.dataset.cn, si = +btn.dataset.si;
      const info = findChapterSection(cn, si);
      if(!info) return;
      const secEl = document.getElementById('sec_'+cn+'_'+si);
      secEl.classList.add("gen");
      btn.disabled = true; btn.textContent = "重试中…";
      try{
        secEl.querySelector(".body").innerHTML = "";
        const text = await generateSection(info.chapter, info.section, (partial)=>{
          secEl.querySelector(".body").textContent = partial;
        });
        info.section.content = text;
        secEl.classList.remove("pending"); secEl.classList.remove("gen");
        secEl.querySelector(".body").innerHTML = renderContent(text);
        secEl.querySelector("h4").insertAdjacentHTML("beforeend", '<span class="done-stamp">已拟</span>');
        saveDraft();
      }catch(err){
        secEl.classList.remove("gen");
        btn.disabled = false; btn.textContent = "重试";
        secEl.querySelector(".body").insertAdjacentHTML("afterbegin", '<p style="color:var(--seal-red); margin:0 0 6px;">仍然失败：'+err.message+'</p>');
      }
    };
  });
}
