// POI相关模块 —— 从 index.html 内联脚本拆分而来（周边配套/竞品调研/AI选址建议）
async function fetchPoi(){
  saveProject();
  const btn = document.getElementById("poiBtn");
  const st = document.getElementById("poiStatus");
  let addr = (document.getElementById("poiKw").value||"").trim();
  if(!addr && document.getElementById("f_name")){ addr = document.getElementById("f_name").value.trim(); if(addr) document.getElementById("poiKw").value = addr; }
  if(!addr){ st.textContent = "请输入项目/小区名称（建议加城市名，如：深圳 安居华越龙苑）"; return; }
  project.poiKw = addr;
  btn.disabled = true; st.innerHTML = "定位候选中…";
  try{
    const r = await fetch("/api/poi", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"search", address: addr})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||"搜索失败");
    // 候选确认:列出让人点选,防止定位张冠李戴
    st.innerHTML = '<b style="color:var(--seal-red);">请确认项目位置（防止定位错片区）：</b><br>'
      + d.candidates.map((c,i)=>'<a href="javascript:void(0)" class="poi-cand" data-loc="'+c.location+'" style="display:inline-block; margin:4px 6px 0 0; padding:4px 10px; border:1px solid var(--line-strong); background:#fff; font-size:12px; text-decoration:none; color:var(--ink);">'
        + escapeHtml(c.name)+'<span style="color:var(--ink-soft);">｜'+escapeHtml(c.district)+(c.address?'｜'+escapeHtml(String(c.address).slice(0,24)):'')+'</span></a>').join("")
      + '<br><span style="color:var(--ink-soft); font-size:11px;">都不对？请把搜索词改成"城市 + 项目全名"（如：深圳 安居华越龙苑）后重试；选定后仍请人工核对抓取结果。</span>';
    document.querySelectorAll(".poi-cand").forEach(a=>{
      a.onclick = ()=>fetchPoiAround(a.dataset.loc, a.textContent.split("｜")[0]);
    });
  }catch(e){ st.textContent = "失败："+e.message; }
  btn.disabled = false;
}
async function fetchPoiAround(loc, label){
  project.poiLoc = loc; project.poiLocLabel = label;   // 记住确认坐标供竞品抓取复用
  const st = document.getElementById("poiStatus");
  st.textContent = "已确认「"+label+"」，抓取3公里周边…";
  try{
    const r = await fetch("/api/poi", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({location: loc})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||"抓取失败");
    let lines = [];
    Object.entries(d.pois||{}).forEach(([lab, items])=>{
      if(items && items.length) lines.push(lab+"："+items.map(p=>p.name+(p.dist!==null?"（约"+p.dist+"km）":"")).join("、"));
    });
    if(!lines.length) throw new Error("3公里内未检索到配套");
    document.getElementById("f_poiDesc").value = lines.join("\n");
    saveProject(); saveDraft();
    st.textContent = "✓ 已按「"+label+"」抓取，请核对后可手动编辑";
  }catch(e){ st.textContent = "失败："+e.message; }
}


async function fetchCompetitors(){
  const st = document.getElementById("cpFetchSt");
  if(!project.poiLoc){ st.innerHTML = '<span style="color:var(--seal-red);">请先在上方完成"搜索位置"并确认项目位置</span>'; return; }
  st.textContent = "抓取周边公寓中…";
  try{
    const r = await fetch("/api/poi", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({action:"competitors", location: project.poiLoc})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||"抓取失败");
    if(!(d.competitors||[]).length) throw new Error("3公里内未检索到公寓类项目");
    readCpFromDom(); saveProject();
    project.competitors = project.competitors||[];
    let added = 0;
    d.competitors.forEach(c=>{
      if(!project.competitors.some(x=>x.name===c.name)){
        project.competitors.push({name:c.name, dist:c.dist!==null? String(c.dist):"", rent:"", occ:"", note:"（地图抓取，租金/出租率须人工调研）"});
        added++;
      }
    });
    renderSheet();
    setTimeout(()=>{
      const st2 = document.getElementById("cpFetchSt");
      if(st2) st2.innerHTML = '✓ 已抓取'+added+'个周边公寓（名称与距离为地图实测）。<b style="color:var(--seal-red);">租金与出租率无公开数据，须人工调研后填入，空着不会注入报告。</b>';
    }, 100);
  }catch(e){ st.textContent = "失败："+e.message; }
}

async function aiPositionSuggest(){
  saveProject();
  const btn = document.getElementById("aiPosBtn");
  const box = document.getElementById("aiPosBox");
  btn.disabled = true; btn.textContent = "分析中…";
  const GROUPS = ["新市民/青年人","园区产业职工","混合客群","家庭型租户"];
  const UNITS = ["小户型为主（≤70㎡）","中小户型混合","大中小全覆盖"];
  const RENTS = ["市场价9折以内","市场价7-9折","显著低于市场价（≤7折）"];
  try{
    const sys = '你是保障性租赁住房定位顾问。基于用户提供的真实项目信息与调研数据，给出产品定位建议。只输出一个JSON对象（无代码块无其他文字）：{"targetGroup":"必须从['+GROUPS.join("/")+']中选一","unitPlan":"从['+UNITS.join("/")+']中选一","rentPlan":"从['+RENTS.join("/")+']中选一","rationale":"120字内的定位理由，只引用给定的真实数据"}';
    let user = '【项目】'+(project.name||"")+'｜'+(project.location||"")+'｜'+(project.desc||"").slice(0,300) + surveyBrief();
    if(calcResult && calcResult.summary) user += "\n【测算】拟定起始租金"+(calcParams?calcParams.rent:"?")+"元/㎡/月，IRR "+calcResult.summary.irr+"%";
    const text = await callGen(sys, user);
    const clean = text.replace(/```json|```/g,"").trim();
    const j = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}")+1));
    box.innerHTML = '<div style="border:1px dashed var(--line-strong); background:#FFFDF5; padding:12px 14px; margin-top:10px; font-size:13px;">'
      +'<b>AI定位建议</b>（仅供参考，采纳后仍可手动调整）<br>'
      +'主力客群：<b>'+escapeHtml(j.targetGroup||"")+'</b>｜户型：<b>'+escapeHtml(j.unitPlan||"")+'</b>｜租金：<b>'+escapeHtml(j.rentPlan||"")+'</b>'
      +'<div style="color:var(--ink-soft); margin-top:6px;">'+escapeHtml(j.rationale||"")+'</div>'
      +'<button type="button" class="btn" id="aiPosAdopt" style="margin-top:10px; padding:6px 18px; font-size:12px;">采纳此建议</button></div>';
    document.getElementById("aiPosAdopt").onclick = ()=>{
      const set = (id,v,list)=>{ const el=document.getElementById(id); if(el && list.includes(v)) el.value=v; };
      set("f_targetGroup", j.targetGroup, GROUPS);
      set("f_unitPlan", j.unitPlan, UNITS);
      set("f_rentPlan", j.rentPlan, RENTS);
      saveProject(); saveDraft();
      box.innerHTML = '<div style="color:var(--ok-green); font-size:12.5px; margin-top:8px;">✓ 已采纳并写入定位，生成章节时将保持一致。</div>';
    };
  }catch(e){ box.innerHTML = '<div style="color:var(--seal-red); font-size:12.5px; margin-top:8px;">建议生成失败：'+escapeHtml(e.message)+'</div>'; }
  btn.disabled = false; btn.textContent = "AI定位建议";
}

// 周边调研与定位摘要(注入生成prompt;有真实数据才输出)
function surveyBrief(){
  let out = "";
  const cps = (project.competitors||[]).filter(c=>c.name);
  if(cps.length){
    out += "\n【周边竞品调研（真实数据，市场分析必须引用，不得另行编造其他竞品）】\n竞品|距离km|租金(元/㎡/月)|出租率|备注\n";
    cps.forEach(c=>{ out += c.name+"|"+(c.dist||"—")+"|"+(c.rent||"—")+"|"+(c.occ?c.occ+"%":"—")+"|"+(c.note||"—")+"\n"; });
  }
  if(project.poiDesc && project.poiDesc.trim()){
    out += "\n【周边配套（地图实测数据，区位与市场章节须引用，不得另行编造配套）】\n"+project.poiDesc.trim()+"\n";
  }
  if(project.targetGroup || project.industryDesc){
    out += "\n【客群定位】主力客群："+(project.targetGroup||"未定")+(project.industryDesc? "；周边产业特征："+project.industryDesc : "")+"\n";
  }
  if(project.unitPlan || project.rentPlan){
    out += "【产品定位】户型策略："+(project.unitPlan||"未定")+"；租金策略："+(project.rentPlan||"未定")+"（相关章节表述须与此定位保持一致）\n";
  }
  return out;
}

