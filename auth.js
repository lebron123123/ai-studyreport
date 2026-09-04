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
    '<div id="gate" class="auth-gate">'
    +'<div class="auth-card">'
    +'<div class="auth-tabs"><button class="at-btn active" data-m="login">登 录</button><button class="at-btn" data-m="register">注 册</button></div>'
    +(msg?'<div class="auth-message">'+msg+'</div>':'')
    +'<label>用户名</label><input id="auName" type="text" placeholder="2-20位中英文/数字">'
    +'<label>密码</label><input id="auPass" type="password" placeholder="至少6位">'
    +'<div id="auInviteWrap" class="auth-invite" aria-hidden="true"><label>注册邀请码</label><input id="auInvite" type="text" placeholder="向管理员索取"></div>'
    +'<button class="btn auth-submit" id="auSubmit">登 录</button>'
    +'<div id="auErr" class="auth-error"></div>'
    +'</div></div>');
  let mode = "login";
  document.querySelectorAll(".at-btn").forEach(b=>{
    b.onclick = ()=>{
      mode = b.dataset.m;
      document.querySelectorAll(".at-btn").forEach(x=>x.classList.toggle("active", x===b));
      const invite=document.getElementById("auInviteWrap");invite.classList.toggle("shown",mode==="register");invite.setAttribute("aria-hidden",mode==="register"?"false":"true");
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
let currentProjectUpdatedAt = null;
let cloudTimer = null;
let cloudSaveInFlight = Promise.resolve();
function rememberActiveProjectId(id){try{id?localStorage.setItem("fs_active_project_id",id):localStorage.removeItem("fs_active_project_id");}catch(e){}}
function recalledActiveProjectId(){try{return localStorage.getItem("fs_active_project_id")||null;}catch(e){return null;}}
function genProjectId(){
  try{ return crypto.randomUUID(); }catch(e){
    return "p-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  }
}
function scheduleCloudSave(){
  if(!getToken()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(()=>{cloudTimer=null;cloudSaveNow();}, 1200);
}
function cloudSaveNow(){
  if(!getToken())return Promise.resolve(false);
  clearTimeout(cloudTimer);cloudTimer=null;
  if(!currentProjectId){currentProjectId=genProjectId();rememberActiveProjectId(currentProjectId);}
  const request={id:currentProjectId,name:project.name||"未命名项目",snapshot:buildDraftData(),expectedUpdatedAt:currentProjectUpdatedAt};
  cloudSaveInFlight=cloudSaveInFlight.catch(()=>false).then(()=>cloudSaveSnapshot(request));
  return cloudSaveInFlight;
}
async function cloudSaveSnapshot(saveRequest){
  if(!getToken()) return;
  setSaveState("saving");
  try{
    const expected=saveRequest.id===currentProjectId?currentProjectUpdatedAt:saveRequest.expectedUpdatedAt;
    const resp = await fetch("/api/projects", {method:"POST",
      headers: Object.assign({"Content-Type":"application/json"}, authHeaders()),
      body: JSON.stringify({id:saveRequest.id,name:saveRequest.name,data:saveRequest.snapshot,expectedUpdatedAt:expected})});
    if(resp.status===401){ setSaveState("err"); clearAuth(); showLoginModal("登录已过期，请重新登录（本地草稿仍在）"); return; }
    const d = await resp.json();
    if(resp.status===409&&d.conflict){setSaveState("conflict");return;}
    if(d.ok&&saveRequest.id===currentProjectId)currentProjectUpdatedAt=Number(d.updatedAt)||currentProjectUpdatedAt;
    setSaveState(d.ok? "ok":"err");
    return !!d.ok;
  }catch(e){ setSaveState("err"); }
  return false;
}
function flushCloudSave(){return cloudSaveNow();}
function setSaveState(st){
  const el = document.getElementById("saveState");
  if(!el) return;
  el.textContent = st==="saving"? "云端保存中…" : st==="ok"? "已保存到云端" : st==="conflict"?"发现其他页面的新版本，请从项目管理重新载入":"云端保存失败（本地已存）";
  el.style.color = st==="err"||st==="conflict"? "var(--seal-red)" : "";
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
  if(typeof airSwitchProjectSession==="function")airSwitchProjectSession();
  currentProjectId = null; currentProjectUpdatedAt=null; domainKey = null; chapters = []; signed = false;
  if(typeof reportDocumentRevision!=="undefined")reportDocumentRevision=0;
  rememberActiveProjectId(null);
  calcParams = null; calcResult = null; docNo = null;
  projectWorkflow = window.ProjectWorkflow ? window.ProjectWorkflow.ensureState({}) : {calcSnapshots:[],reportVersions:[]};
  Object.keys(project).forEach(k=>project[k]="");
  kbEntries = [];
  currentStep = 0; clearDraft();
  renderTOC(); renderSheet();
}
async function openProjectsPanel(){
  if(window.ProjectManager)return window.ProjectManager.open({
    headers:authHeaders,currentId:()=>currentProjectId,genId:genProjectId,openProject,openAiReport:openAiReportProject,newProject,
    updateCurrentMeta:(meta,updatedAt)=>{currentProjectUpdatedAt=Number(updatedAt)||currentProjectUpdatedAt;projectWorkflow=window.ProjectWorkflow?ProjectWorkflow.ensureState(projectWorkflow):projectWorkflow;projectWorkflow.management=Object.assign(projectWorkflow.management||{},meta||{});saveDraft();}
  });
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
    if(!d.ok){ alert(d.error||"打开失败"); return false; }
    if(id!==currentProjectId&&typeof airSwitchProjectSession==="function")airSwitchProjectSession();
    currentProjectId = id;
    currentProjectUpdatedAt=Number(d.project.updated_at)||null;
    if(typeof reportDocumentRevision!=="undefined")reportDocumentRevision=0;
    rememberActiveProjectId(id);
    const panel = document.getElementById("projPanel"); if(panel) panel.remove();
    const bar = document.getElementById("draftBar"); if(bar) bar.remove();
    const local=loadDraft(),selected=window.ProjectWorkflow?.selectProjectDraft?ProjectWorkflow.selectProjectDraft(d.project.data,local,id):d.project.data;
    restoreDraft(selected);
    if(!String(project.name||"").trim()&&d.project.name)project.name=d.project.name;
    return d.project;
  }catch(e){ alert("打开失败，请重试"); return false; }
}
async function openAiReportProject(id,entryOptions){
  const opened=await openProject(id);if(!opened)return false;
  if(typeof airSetProjectEntryContext==="function")airSetProjectEntryContext(Object.assign({},opened.data&&opened.data.project||{},{name:opened.name||opened.data?.project?.name||"",explicitAiEntry:true},entryOptions||{}));
  appMode="aireport";
  try{history.replaceState(null,"",location.pathname+location.search+"#aireport");}catch(_){}
  if(window.UiRouteState)window.UiRouteState.write();
  renderTOC();renderSheet();
  return true;
}

async function startApp(){
  if(!currentProjectId) currentProjectId=recalledActiveProjectId();
  mountUserBar();
  renderTOC(); renderSheet();
  await Promise.all([fetchOutlines(), fetchCalcConfig()]);
  if(currentProjectId){
    try{
      const pr=await fetch("/api/projects?id="+encodeURIComponent(currentProjectId),{headers:authHeaders()});
      const pd=await pr.json();if(pd.ok&&pd.project&&pd.project.data){currentProjectUpdatedAt=Number(pd.project.updated_at)||null;const resumeMode=appMode,resumeOffice=typeof officeView!=="undefined"?officeView:"chat",local=loadDraft(),selected=window.ProjectWorkflow?.selectProjectDraft?ProjectWorkflow.selectProjectDraft(pd.project.data,local,currentProjectId):pd.project.data;restoreDraft(selected,{openHome:true});if(window.UiRouteState){appMode=resumeMode;if(typeof officeView!=="undefined")officeView=resumeOffice;renderTOC();renderSheet();}}
      else{currentProjectId=null;currentProjectUpdatedAt=null;rememberActiveProjectId(null);}
    }catch(e){ /* 网络失败时仍保留本地草稿兜底，不主动遗忘项目 */ }
  }
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
  const projectRoute=window.UiRouteState&&window.UiRouteState.projectRoute&&window.UiRouteState.projectRoute();
  if(projectRoute&&projectRoute.projectId)setTimeout(()=>openProjectsPanel(),60);
}
function checkLogin(){
  if(getToken()){ startApp(); }
  else{ renderTOC(); renderSheet(); showLoginModal(); }
}
