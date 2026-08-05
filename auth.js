// 账号与云端项目库模块 —— 从 index.html 内联脚本拆分而来（登录态、云端自动保存、项目管理面板、应用启动引导）
function saveProject(){
  readKbFromDom();
  const g=id=>{const e=document.getElementById(id);return e?e.value:"";};
  project.name=g("f_name"); project.owner=g("f_owner"); project.type=g("f_type");
  project.location=g("f_location"); project.scale=g("f_scale"); project.desc=g("f_desc");
  readCpFromDom();
  project.poiDesc=g("f_poiDesc");
  if(document.getElementById("poiKw")) project.poiKw=document.getElementById("poiKw").value.trim();
  project.targetGroup=g("f_targetGroup"); project.industryDesc=g("f_industryDesc");
  project.unitPlan=g("f_unitPlan"); project.rentPlan=g("f_rentPlan");
}

/* ================= 账号体系 ================= */
function getToken(){ try{ return localStorage.getItem("fs_token"); }catch(e){ return null; } }
function getUser(){ try{ return localStorage.getItem("fs_user"); }catch(e){ return null; } }
function setAuth(t,u){ try{ localStorage.setItem("fs_token",t); localStorage.setItem("fs_user",u); }catch(e){} }
function clearAuth(){ try{ localStorage.removeItem("fs_token"); localStorage.removeItem("fs_user"); }catch(e){} }
function authHeaders(){ const t=getToken(); return t? {"Authorization":"Bearer "+t} : {}; }

function showLoginModal(msg){
  if(document.getElementById("gate")) return;
  document.body.insertAdjacentHTML("beforeend",
    '<div id="gate" style="position:fixed; inset:0; background:rgba(14,28,44,.62); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:999;">'
    +'<div style="background:var(--paper-card); border:1px solid var(--line-strong); border-top:5px solid var(--bp-navy); border-radius:2px; box-shadow:0 24px 60px -18px rgba(0,0,0,.5); padding:30px 34px; width:340px;">'
    +'<div class="auth-tabs"><button class="at-btn active" data-m="login">登 录</button><button class="at-btn" data-m="register">注 册</button></div>'
    +(msg?'<div style="font-size:12px; color:var(--seal-red); margin-bottom:10px;">'+msg+'</div>':'')
    +'<label style="margin-top:4px;">用户名</label><input id="auName" type="text" placeholder="2-20位中英文/数字">'
    +'<label>密码</label><input id="auPass" type="password" placeholder="至少6位">'
    +'<div id="auInviteWrap" style="display:none;"><label>注册邀请码</label><input id="auInvite" type="text" placeholder="向管理员索取"></div>'
    +'<button class="btn" style="width:100%; margin-top:18px;" id="auSubmit">登 录</button>'
    +'<div id="auErr" style="color:var(--seal-red); font-size:12px; margin-top:10px; display:none;"></div>'
    +'</div></div>');
  let mode = "login";
  document.querySelectorAll(".at-btn").forEach(b=>{
    b.onclick = ()=>{
      mode = b.dataset.m;
      document.querySelectorAll(".at-btn").forEach(x=>x.classList.toggle("active", x===b));
      document.getElementById("auInviteWrap").style.display = mode==="register"? "block":"none";
      document.getElementById("auSubmit").textContent = mode==="register"? "注 册":"登 录";
    };
  });
  const submit = async ()=>{
    const btn = document.getElementById("auSubmit");
    const errEl = document.getElementById("auErr");
    btn.disabled = true; btn.textContent = "请稍候…"; errEl.style.display="none";
    try{
      const resp = await fetch("/api/auth", {method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({action:mode,
          username: document.getElementById("auName").value.trim(),
          password: document.getElementById("auPass").value,
          invite: mode==="register"? document.getElementById("auInvite").value.trim() : undefined })});
      const data = await resp.json();
      if(data.ok){ setAuth(data.token, data.username); document.getElementById("gate").remove(); startApp(); }
      else{ errEl.textContent = data.error||"操作失败"; errEl.style.display="block"; btn.disabled=false; btn.textContent = mode==="register"?"注 册":"登 录"; }
    }catch(e){ errEl.textContent="网络错误，请重试"; errEl.style.display="block"; btn.disabled=false; btn.textContent = mode==="register"?"注 册":"登 录"; }
  };
  document.getElementById("auSubmit").onclick = submit;
  document.getElementById("auPass").addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); });
}

/* ================= 云端项目库 ================= */
let currentProjectId = null;
let cloudTimer = null;
function genProjectId(){
  try{ return crypto.randomUUID(); }catch(e){
    return "p-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  }
}
function scheduleCloudSave(){
  if(!getToken()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudSaveNow, 1200);
}
async function cloudSaveNow(){
  if(!getToken()) return;
  if(!currentProjectId) currentProjectId = genProjectId();
  setSaveState("saving");
  try{
    const resp = await fetch("/api/projects", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({id:currentProjectId, name:project.name||"未命名项目", data:buildDraftData()})});
    if(resp.status===401){ setSaveState("err"); clearAuth(); showLoginModal("登录已过期，请重新登录（本地草稿仍在）"); return; }
    const d = await resp.json();
    setSaveState(d.ok? "ok":"err");
  }catch(e){ setSaveState("err"); }
}
function setSaveState(st){
  const el = document.getElementById("saveState");
  if(!el) return;
  el.textContent = st==="saving"? "云端保存中…" : st==="ok"? "已保存到云端" : "云端保存失败（本地已存）";
  el.style.color = st==="err"? "var(--seal-red)" : "";
}

function mountUserBar(){
  if(document.getElementById("userBar")) return;
  document.querySelector(".sheet-wrap").insertAdjacentHTML("afterbegin",
    '<div id="userBar" class="user-bar">'
    +'<span class="ub-user">'+ (getUser()||"") +'</span>'
    +'<span id="saveState" class="ub-save"></span>'
    +'<span class="ub-acts">'
    +'<button class="ub-btn" id="ubProjects">我的项目</button>'
    +'<button class="ub-btn" id="ubNew">新建项目</button>'
    +'<button class="ub-btn" id="ubLogout">退出</button>'
    +'</span></div>');
  document.getElementById("ubLogout").onclick = ()=>{ clearAuth(); location.reload(); };
  document.getElementById("ubNew").onclick = ()=>{
    if(!confirm("开始一个全新项目？当前项目已自动保存到云端。")) return;
    newProject();
  };
  document.getElementById("ubProjects").onclick = openProjectsPanel;
}
function newProject(){
  currentProjectId = null; domainKey = null; chapters = []; signed = false;
  calcParams = null; calcResult = null; docNo = null;
  Object.keys(project).forEach(k=>project[k]="");
  kbEntries = [];
  currentStep = 0; clearDraft();
  renderTOC(); renderSheet();
}
async function openProjectsPanel(){
  const old = document.getElementById("projPanel"); if(old) old.remove();
  document.body.insertAdjacentHTML("beforeend",
    '<div id="projPanel" class="proj-overlay"><div class="proj-panel">'
    +'<div class="pp-head">我的项目<button class="pp-close" id="ppClose">×</button></div>'
    +'<div class="pp-list" id="ppList">加载中…</div></div></div>');
  document.getElementById("ppClose").onclick = ()=>document.getElementById("projPanel").remove();
  document.getElementById("projPanel").onclick = e=>{ if(e.target.id==="projPanel") e.target.remove(); };
  try{
    const resp = await fetch("/api/projects", {headers: authHeaders()});
    if(resp.status===401){ document.getElementById("projPanel").remove(); clearAuth(); showLoginModal("登录已过期，请重新登录"); return; }
    const d = await resp.json();
    const list = d.list||[];
    const el = document.getElementById("ppList");
    if(!list.length){ el.innerHTML = '<div class="pp-empty">还没有云端项目。开始编辑后会自动保存到这里。</div>'; return; }
    el.innerHTML = list.map(p=>{
      const t = new Date(p.updated_at);
      const when = t.toLocaleDateString("zh-CN")+" "+String(t.getHours()).padStart(2,"0")+":"+String(t.getMinutes()).padStart(2,"0");
      return '<div class="pp-row"><div class="pp-info"><div class="pp-name">'+escapeHtml(p.name||"未命名项目")+'</div><div class="pp-time">'+when+'</div></div>'
        +'<div class="pp-ops"><button class="ub-btn" data-open="'+p.id+'">打开</button><button class="ub-btn pp-del" data-del="'+p.id+'">删除</button></div></div>';
    }).join("");
    el.querySelectorAll("[data-open]").forEach(b=>{ b.onclick = ()=>openProject(b.dataset.open); });
    el.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm("确定删除该项目？此操作不可恢复。")) return;
        await fetch("/api/projects?id="+encodeURIComponent(b.dataset.del), {method:"DELETE", headers:authHeaders()});
        openProjectsPanel();
      };
    });
  }catch(e){ document.getElementById("ppList").textContent = "加载失败，请重试"; }
}
async function openProject(id){
  try{
    const resp = await fetch("/api/projects?id="+encodeURIComponent(id), {headers:authHeaders()});
    const d = await resp.json();
    if(!d.ok){ alert(d.error||"打开失败"); return; }
    currentProjectId = id;
    const panel = document.getElementById("projPanel"); if(panel) panel.remove();
    const bar = document.getElementById("draftBar"); if(bar) bar.remove();
    restoreDraft(d.project.data);
  }catch(e){ alert("打开失败，请重试"); }
}

async function startApp(){
  mountUserBar();
  renderTOC(); renderSheet();
  await Promise.all([fetchOutlines(), fetchCalcConfig()]);
  renderTOC(); renderSheet();
  const d = loadDraft();
  if(d && d.ts && !currentProjectId && (d.project&&d.project.name || (d.chapters||[]).some(c=>c.sections.some(s=>s.content)))){
    document.querySelector(".sheet-wrap").insertAdjacentHTML("beforeend", "");
    const bar = document.getElementById("draftBar");
    if(!bar){
      document.getElementById("userBar").insertAdjacentHTML("afterend", draftBarHtml(d));
      document.getElementById("draftRestore").onclick = ()=>{ document.getElementById("draftBar").remove(); restoreDraft(d); };
      document.getElementById("draftDiscard").onclick = ()=>{ clearDraft(); document.getElementById("draftBar").remove(); };
    }
  }
}
function checkLogin(){
  if(getToken()){ startApp(); }
  else{ renderTOC(); renderSheet(); showLoginModal(); }
}
