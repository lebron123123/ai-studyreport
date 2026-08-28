/* AI可研项目驾驶舱：只管理项目索引、恢复入口和元数据，不接管报告/测算业务状态。 */
(function(root){
  "use strict";
  const PM_STATUS={draft:"草稿",collecting:"资料准备",calculated:"测算完成",generating:"生成中",review:"复核签发",signed:"已签发",paused:"暂缓"};
  const PM_TYPE={rent:"出租类",sale:"出售类",gaibao:"非居改保","保障性租赁住房":"出租类","配售型保障性住房":"出售类"};
  const esc=value=>String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const when=value=>{const d=new Date(Number(value)||value);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("zh-CN")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");};
  function displayType(value){return PM_TYPE[value]||value||"类型待确认";}
  function health(p){
    const issues=[];
    if(!p.location)issues.push("位置待补");
    if(!p.calcVersions)issues.push("未形成测算快照");
    if(p.stale)issues.push(p.stale+"节待同步");
    if(!p.materials)issues.push("尚无项目资料");
    return issues.slice(0,3);
  }
  function matches(p,q){q=String(q||"").trim().toLowerCase();if(!q)return true;return [p.name,p.location,p.owner,p.type,p.stage].concat(p.tags||[]).join(" ").toLowerCase().includes(q);}
  function projectCard(p,active){
    const hs=health(p);
    return '<button type="button" class="pm-project '+(active?'active':'')+'" data-pm-select="'+esc(p.id)+'">'
      +'<span class="pm-card-top"><b>'+esc(p.name||"未命名项目")+'</b><i class="pm-status s-'+esc(p.status)+'">'+esc(PM_STATUS[p.status]||p.stage||"进行中")+'</i></span>'
      +'<span class="pm-card-meta">'+esc(displayType(p.type))+' · '+esc(p.location||"位置待补")+'</span>'
      +'<span class="pm-progress"><em style="width:'+Math.max(2,Math.min(100,Number(p.progress)||0))+'%"></em></span>'
      +'<span class="pm-card-foot"><small>'+esc(p.stage||"草稿")+' '+(p.progress||0)+'%</small><small>'+esc(when(p.updated_at))+'</small></span>'
      +(hs.length?'<span class="pm-warnings">'+hs.map(x=>'<i>'+esc(x)+'</i>').join('')+'</span>':'')+'</button>';
  }
  function detail(p,currentId){
    if(!p)return '<div class="pm-detail-empty"><b>选择一个项目</b><span>查看项目进度、成果版本、资料状态和恢复入口。</span></div>';
    const current=p.id===currentId,hs=health(p),acts=(p.activity||[]);
    return '<div class="pm-detail-head"><div><span class="pm-eyebrow">PROJECT WORKSPACE</span><h2>'+esc(p.name||"未命名项目")+'</h2><p>'+esc(displayType(p.type))+' · '+esc(p.location||"位置待补")+' · 负责人 '+esc(p.owner||"待指定")+'</p></div><i class="pm-status s-'+esc(p.status)+'">'+esc(PM_STATUS[p.status]||p.stage)+'</i></div>'
      +'<div class="pm-phase"><div><b>当前阶段：'+esc(p.stage)+'</b><span>'+Number(p.progress||0)+'%</span></div><i><em style="width:'+Number(p.progress||0)+'%"></em></i></div>'
      +'<div class="pm-kpis"><div><b>'+p.generated+'/'+p.sections+'</b><span>已生成小节</span></div><div><b>'+p.materials+'</b><span>项目资料</span></div><div><b>V'+p.calcVersions+'</b><span>测算快照</span></div><div><b>V'+p.reportVersions+'</b><span>报告版本</span></div></div>'
      +'<div class="pm-detail-section"><h3>项目健康状态</h3><div class="pm-health">'+(hs.length?hs.map(x=>'<span class="warn">! '+esc(x)+'</span>').join(''):'<span class="ok">✓ 当前未发现明显保存或同步风险</span>')+(p.locked?'<span>🔒 '+p.locked+'节人工锁定</span>':'')+'</div></div>'
      +'<div class="pm-detail-section"><h3>项目状态与标签</h3><div class="pm-meta-edit"><select id="pmStatus">'+Object.entries(PM_STATUS).map(([k,v])=>'<option value="'+k+'" '+(p.status===k?'selected':'')+'>'+v+'</option>').join('')+'</select><input id="pmTags" value="'+esc((p.tags||[]).join('、'))+'" placeholder="标签，用顿号分隔"><button class="ub-btn" data-pm-meta="'+esc(p.id)+'">保存</button></div></div>'
      +'<div class="pm-detail-section"><h3>最近活动</h3><div class="pm-activity">'+(acts.length?acts.map(a=>'<div><i></i><span><b>'+esc(a.text||"项目更新")+'</b><small>'+esc(when(a.at))+(a.by?' · '+esc(a.by):'')+'</small></span></div>').join(''):'<p>尚无活动记录；后续归档、恢复、复制和状态修改会记录在这里。</p>')+'</div></div>'
      +'<div class="pm-detail-actions"><button class="btn" data-pm-open="'+esc(p.id)+'">'+(current?'返回当前项目':'打开并继续')+'</button><button class="btn ghost" data-pm-copy="'+esc(p.id)+'">复制项目</button>'
      +(p.archived?'<button class="btn ghost" data-pm-archive="'+esc(p.id)+'" data-value="0">恢复项目</button><button class="btn danger-lite" data-pm-purge="'+esc(p.id)+'">彻底删除</button>':'<button class="btn ghost" data-pm-archive="'+esc(p.id)+'" data-value="1">归档项目</button>')+'</div>';
  }
  async function open(options){
    options=options||{};document.getElementById("projPanel")?.remove();
    document.body.insertAdjacentHTML("beforeend",'<div id="projPanel" class="proj-overlay"><section class="proj-panel pm-shell"><header class="pm-head"><div><span>FEASIBILITY · PROJECTS</span><b>可研项目驾驶舱</b><small>项目、测算、报告、资料与版本统一管理</small></div><button class="pp-close" id="ppClose" aria-label="关闭">×</button></header><div class="pm-toolbar"><label>⌕<input id="pmSearch" placeholder="搜索项目、区域、负责人或标签"></label><select id="pmSort"><option value="updated">最近更新</option><option value="name">项目名称</option><option value="progress">完成进度</option></select><button class="pm-tab active" data-pm-tab="active">进行中</button><button class="pm-tab" data-pm-tab="archived">归档</button><button class="btn" id="pmNew">＋ 新建项目</button></div><main class="pm-main"><aside id="pmList"><div class="pm-loading">正在读取项目索引…</div></aside><article id="pmDetail"></article></main></section></div>');
    const overlay=document.getElementById("projPanel"),listEl=document.getElementById("pmList"),detailEl=document.getElementById("pmDetail");
    let projects=[],selected=null,tab="active",query="",sort="updated";
    const headers=()=>typeof options.headers==="function"?options.headers():{};
    async function api(body){const r=await fetch("/api/projects",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},headers()),body:JSON.stringify(body)}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"操作失败");return d;}
    function visible(){
      const arr=projects.filter(p=>(tab==="archived")===!!p.archived&&matches(p,query));
      return arr.sort(sort==="name"?(a,b)=>String(a.name).localeCompare(String(b.name),"zh-CN"):sort==="progress"?(a,b)=>b.progress-a.progress:(a,b)=>b.updated_at-a.updated_at);
    }
    function render(){const rows=visible();if(!rows.some(p=>p.id===selected))selected=rows[0]?.id||null;listEl.innerHTML='<div class="pm-list-summary"><b>'+rows.length+' 个项目</b><span>'+(tab==="archived"?'可恢复或彻底删除':'点击项目查看工作区')+'</span></div>'+(rows.length?rows.map(p=>projectCard(p,p.id===selected)).join(''):'<div class="pm-detail-empty"><b>这里还没有项目</b><span>'+(tab==="archived"?'归档项目会安全地保存在这里。':'新建项目后，系统会自动保存并记录进度。')+'</span></div>');detailEl.innerHTML=detail(projects.find(p=>p.id===selected),options.currentId&&options.currentId());bind();}
    function bind(){
      listEl.querySelectorAll('[data-pm-select]').forEach(b=>b.onclick=()=>{selected=b.dataset.pmSelect;render();});
      detailEl.querySelectorAll('[data-pm-open]').forEach(b=>b.onclick=()=>options.openProject&&options.openProject(b.dataset.pmOpen));
      detailEl.querySelectorAll('[data-pm-copy]').forEach(b=>b.onclick=async()=>{const src=projects.find(p=>p.id===b.dataset.pmCopy),name=prompt("副本名称",(src?.name||"未命名项目")+"（副本）");if(!name)return;await api({action:"duplicate",sourceId:b.dataset.pmCopy,id:options.genId(),name});await load();});
      detailEl.querySelectorAll('[data-pm-archive]').forEach(b=>b.onclick=async()=>{const archived=b.dataset.value==="1";if(!confirm(archived?"归档后不会出现在进行中列表，可随时恢复。是否继续？":"恢复该项目到进行中列表？"))return;await api({action:"setArchived",id:b.dataset.pmArchive,archived});if(archived&&options.currentId&&b.dataset.pmArchive===options.currentId())options.newProject&&options.newProject(true);await load();});
      detailEl.querySelectorAll('[data-pm-purge]').forEach(b=>b.onclick=async()=>{const p=projects.find(x=>x.id===b.dataset.pmPurge);if(prompt("彻底删除不可恢复。请输入项目名称确认：")!==(p?.name||""))return;const r=await fetch("/api/projects?id="+encodeURIComponent(b.dataset.pmPurge),{method:"DELETE",headers:headers()});if(!r.ok)throw new Error("删除失败");await load();});
      detailEl.querySelectorAll('[data-pm-meta]').forEach(b=>b.onclick=async()=>{const tags=document.getElementById("pmTags").value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),status=document.getElementById("pmStatus").value,saved=await api({action:"updateMeta",id:b.dataset.pmMeta,status,tags});if(options.updateCurrentMeta&&b.dataset.pmMeta===options.currentId())options.updateCurrentMeta({status,tags},saved.updatedAt);await load();});
    }
    async function load(){try{const r=await fetch("/api/projects",{headers:headers()}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||"加载失败");projects=d.list||[];render();}catch(e){listEl.innerHTML='<div class="pm-detail-empty"><b>项目索引加载失败</b><span>'+esc(e.message)+'</span></div>';}}
    overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};document.getElementById("ppClose").onclick=()=>overlay.remove();
    document.getElementById("pmSearch").oninput=e=>{query=e.target.value;render();};document.getElementById("pmSort").onchange=e=>{sort=e.target.value;render();};
    document.querySelectorAll('[data-pm-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.pmTab;document.querySelectorAll('[data-pm-tab]').forEach(x=>x.classList.toggle("active",x===b));render();});
    document.getElementById("pmNew").onclick=()=>{if(confirm("新建项目后，当前项目仍会自动保存。是否继续？")){overlay.remove();options.newProject&&options.newProject();}};
    await load();
  }
  root.ProjectManager={open,health,matches,displayType};
  if(typeof module==="object"&&module.exports)module.exports={health,matches,displayType};
})(typeof window!=="undefined"?window:globalThis);
