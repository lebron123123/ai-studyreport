/* PPT template page acceptance and slot-contract console. */
(function(root){
  "use strict";
  const ROLE_LABELS={title:"标题",subtitle:"副标题",claim:"结论",metric:"指标值",label:"标签",body:"正文",source:"来源",picture:"图片",table:"表格",chart:"图表",keep:"保留原样"};
  const STATUS_LABELS={draft:"草稿",pending:"待审核",published:"已发布",rejected:"已驳回"};
  const CATEGORY_LABELS={"talent-housing":"专题模板｜人才住房","business-premium":"通用模板｜高级商务","general-fixed":"其他固定模板"};
  let records=new Map();
  const escText=value=>root.esc?root.esc(value):String(value==null?"":value).replace(/[&<>\"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
  const api=async body=>{
    if(root.pptTemplateAdminApi)return root.pptTemplateAdminApi(body);
    const response=await fetch("/api/ppttemplates",{method:"POST",headers:root.authHeaders(),body:JSON.stringify(body)}),data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||"PPT模板操作失败");return data;
  };

  function installStyles(){
    if(document.getElementById("pptTemplateAdminV2Style"))return;
    const style=document.createElement("style");style.id="pptTemplateAdminV2Style";style.textContent=`
      .ppt-tpl-card{background:#fff;border:1px solid var(--line);border-radius:12px;margin:14px 0;overflow:hidden;box-shadow:0 4px 16px rgba(30,75,114,.05)}
      .ppt-tpl-head{padding:17px 19px;display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.ppt-tpl-title{font-size:16px;color:var(--ink)}
      .ppt-tpl-meta{font-size:12px;color:var(--soft);margin-top:6px;line-height:1.75}.ppt-tpl-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .ppt-tpl-summary{display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
      .ppt-tpl-kpi{background:#f8fbfe;padding:12px 15px}.ppt-tpl-kpi b{display:block;font-size:20px;color:var(--bp)}.ppt-tpl-kpi span{font-size:11px;color:var(--soft)}
      .ppt-tpl-pages{padding:16px 18px;background:#f8fbfe}.ppt-tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
      .ppt-tpl-page{padding:0;border:1px solid #cfdeeb;border-radius:9px;overflow:hidden;background:white;text-align:left;cursor:pointer;transition:.15s}.ppt-tpl-page:hover{border-color:var(--bp);transform:translateY(-1px)}
      .ppt-tpl-page img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:linear-gradient(135deg,#edf5fb,#dbeaf5)}.ppt-tpl-page-info{padding:9px 11px}.ppt-tpl-page-info b{font-size:13px}.ppt-tpl-page-info small{display:block;color:var(--soft);margin-top:4px}
      .ppt-tpl-page.accepted{border-color:#73bd94;box-shadow:0 0 0 2px rgba(44,151,91,.09)}.ppt-tpl-page.rejected{opacity:.58}.ppt-tpl-editor{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:14px}
      .ppt-slot-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}.ppt-slot-table th,.ppt-slot-table td{border-bottom:1px solid var(--line);padding:8px 7px;text-align:left}.ppt-slot-table select{min-width:110px;padding:6px}
      .ppt-tpl-editor-actions{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}.ppt-tpl-editor-actions input{min-width:260px;flex:1}.ppt-tpl-empty{padding:22px;color:var(--soft);text-align:center}
      @media(max-width:900px){.ppt-tpl-summary{grid-template-columns:repeat(2,1fr)}.ppt-tpl-head{display:block}.ppt-tpl-actions{justify-content:flex-start;margin-top:12px}}
    `;document.head.appendChild(style);
  }

  async function loadThumbnail(img){
    if(img.dataset.loaded)return;img.dataset.loaded="1";
    try{const response=await fetch(img.dataset.src,{headers:root.authHeaders()});if(!response.ok)throw new Error("缩略图读取失败");img.src=URL.createObjectURL(await response.blob());}
    catch{img.alt="缩略图暂不可用";}
  }

  function pageButton(record,page){
    const review=page.review||{},status=review.status||"candidate",slotCount=((page.slotContract||{}).slots||[]).length;
    return `<button class="ppt-tpl-page ${status}" data-ppt-tpl-page="${escText(record.id)}" data-page="${page.page}"><img loading="lazy" data-src="/api/ppt-template-preview?id=${encodeURIComponent(record.id)}&page=${page.page}" alt="第${page.page}页"><span class="ppt-tpl-page-info"><b>第${page.page}页 · ${escText(page.name||page.role)}</b><small>${escText(page.role)} · ${slotCount}个槽位 · ${status==="accepted"?"已准入":status==="rejected"?"不采用":"待确认"}</small></span></button>`;
  }

  function templateCard(record){
    const profile=record.profile||{},pages=profile.pages||[],acceptance=profile.acceptance||{},roles=[...new Set(pages.map(page=>page.role).filter(Boolean))].slice(0,8);
    const category=CATEGORY_LABELS[profile.templateCategory]||CATEGORY_LABELS["general-fixed"];
    return `<section class="ppt-tpl-card" data-template-card="${escText(record.id)}"><div class="ppt-tpl-head"><div><div class="ppt-tpl-title"><b>${escText(record.name)}</b> <span class="stat-badge ${record.status==="published"?"ok":record.status==="pending"?"warn":""}">${escText(STATUS_LABELS[record.status]||record.status)}</span></div><div class="ppt-tpl-meta">模板类型：${escText(category)} · 用户 #${escText(record.user_id)} · 原稿 ${profile.slideCount||0} 页 · 候选 ${pages.length} 页 · 版本 v${record.version}<br>页面角色：${escText(roles.join(" / ")||"尚未识别")}</div></div><div class="ppt-tpl-actions"><button class="btn sm" data-ppt-toggle="${escText(record.id)}">查看页面与槽位</button>${record.status!=="published"?`<button class="btn sm" data-ppt-publish="${escText(record.id)}">审核通过并发布</button>`:""}${record.status!=="rejected"?`<button class="btn sm red" data-ppt-reject="${escText(record.id)}">驳回</button>`:""}${record.status==="published"?`<button class="btn sm" data-ppt-return="${escText(record.id)}">撤回为草稿</button>`:""}<button class="btn sm red" data-ppt-delete="${escText(record.id)}">永久删除</button></div></div><div class="ppt-tpl-summary"><div class="ppt-tpl-kpi"><b>${profile.slideCount||0}</b><span>原模板总页数</span></div><div class="ppt-tpl-kpi"><b>${pages.length}</b><span>高频候选页</span></div><div class="ppt-tpl-kpi"><b>${acceptance.acceptedCount||0}</b><span>已准入页面</span></div><div class="ppt-tpl-kpi"><b>${pages.reduce((n,page)=>n+(((page.slotContract||{}).slots||[]).length),0)}</b><span>可治理Shape槽位</span></div></div><div class="ppt-tpl-pages" data-ppt-pages="${escText(record.id)}" hidden><div class="ppt-tpl-grid">${pages.map(page=>pageButton(record,page)).join("")}</div><div class="ppt-tpl-editor" data-ppt-editor="${escText(record.id)}" hidden></div></div></section>`;
  }

  function renderEditor(record,page){
    const slots=((page.slotContract||{}).slots||[]),editor=document.querySelector(`[data-ppt-editor="${CSS.escape(record.id)}"]`);if(!editor)return;
    editor.hidden=false;editor.innerHTML=`<div><b>第${page.page}页槽位合同</b><div class="hint">按真实 Shape ID 维护；发布后生成器优先按 Shape ID 精确回填，未准入页不进入公共候选。</div></div><table class="ppt-slot-table"><thead><tr><th>Shape ID</th><th>原对象名</th><th>类型</th><th>容量</th><th>业务槽位</th></tr></thead><tbody>${slots.map(slot=>`<tr><td>${escText(slot.sourceId)}</td><td>${escText(slot.sourceName||"—")}</td><td>${escText(slot.type)}</td><td>${slot.capacity||0}</td><td><select data-slot-source="${escText(slot.sourceId)}">${Object.entries(ROLE_LABELS).map(([value,label])=>`<option value="${value}" ${slot.role===value?"selected":""}>${label}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table><div class="ppt-tpl-editor-actions"><input data-review-note placeholder="准入说明（可选）" value="${escText((page.review||{}).note||"")}"><button class="btn primary" data-review-status="accepted">准入此页</button><button class="btn" data-review-status="candidate">保留待确认</button><button class="btn red" data-review-status="rejected">不采用此页</button></div>`;
    editor.querySelectorAll("[data-review-status]").forEach(button=>button.onclick=async()=>{
      const slotRoles={};editor.querySelectorAll("[data-slot-source]").forEach(select=>slotRoles[select.dataset.slotSource]=select.value);
      try{await api({action:"profileReview",id:record.id,review:{page:page.page,status:button.dataset.reviewStatus,note:editor.querySelector("[data-review-note]").value,slotRoles}});root.msg&&root.msg("页面准入与槽位合同已保存","ok");await open();}
      catch(error){root.msg&&root.msg(error.message,"err");}
    });
  }

  async function open(){
    installStyles();const list=document.getElementById("listBox"),edit=document.getElementById("editBox");if(edit)edit.style.display="none";list.style.display="block";
    list.innerHTML='<h1 style="font-size:20px;">PPT模板页面准入与发布</h1><div class="sub">审核不再只看整份PPT：先查看高频候选页缩略图，核对真实 Shape 槽位，再决定页面准入；只有已发布模板会进入公共选版。</div><div class="bar"><button class="btn ghost" id="pptTplReloadV2">刷新</button></div><div id="pptTplBodyV2" class="empty">读取中…</div>';
    document.getElementById("pptTplReloadV2").onclick=open;
    try{
      const data=await api({action:"adminList"}),items=data.items||[];records=new Map(items.map(item=>[item.id,item]));
      const body=document.getElementById("pptTplBodyV2");body.className="";body.innerHTML=items.length?items.map(templateCard).join(""):'<div class="ppt-tpl-empty">暂无用户参考PPT模板。</div>';
      body.querySelectorAll("[data-ppt-toggle]").forEach(button=>button.onclick=()=>{const panel=body.querySelector(`[data-ppt-pages="${CSS.escape(button.dataset.pptToggle)}"]`);panel.hidden=!panel.hidden;if(!panel.hidden)panel.querySelectorAll("img[data-src]").forEach(loadThumbnail);});
      body.querySelectorAll("[data-ppt-tpl-page]").forEach(button=>button.onclick=()=>{const record=records.get(button.dataset.pptTplPage),page=(record.profile.pages||[]).find(item=>Number(item.page)===Number(button.dataset.page));if(page)renderEditor(record,page);});
      body.querySelectorAll("[data-ppt-publish]").forEach(button=>button.onclick=async()=>{try{await api({action:"review",id:button.dataset.pptPublish,decision:"publish",note:"页面准入合同已核对"});root.msg&&root.msg("模板已发布","ok");open();}catch(error){root.msg&&root.msg(error.message,"err");}});
      body.querySelectorAll("[data-ppt-reject]").forEach(button=>button.onclick=async()=>{const note=prompt("请填写驳回原因","");if(note===null||!note.trim())return;try{await api({action:"review",id:button.dataset.pptReject,decision:"reject",note});open();}catch(error){root.msg&&root.msg(error.message,"err");}});
      body.querySelectorAll("[data-ppt-return]").forEach(button=>button.onclick=async()=>{if(!confirm("撤回后该模板将不再供全员使用，是否继续？"))return;try{await api({action:"review",id:button.dataset.pptReturn,decision:"draft",note:"管理员撤回为草稿"});open();}catch(error){root.msg&&root.msg(error.message,"err");}});
      body.querySelectorAll("[data-ppt-delete]").forEach(button=>button.onclick=async()=>{const record=records.get(button.dataset.pptDelete);if(!record)return;const impact=record.status==="published"?"该模板当前已发布，删除后会立即从所有用户的模板列表移除；":"删除后该模板记录将无法恢复；";if(!confirm(impact+"已有PPT项目若仍引用它，将不能再用该模板导出。是否继续？"))return;const typed=prompt("为防止误删，请输入“删除”确认永久删除：","");if(typed!=="删除"){if(typed!==null)root.msg&&root.msg("未输入“删除”，操作已取消","err");return;}try{const deleted=await api({action:"delete",id:record.id});if(deleted.storageKey){try{await fetch("/api/ppt-template-cleanup",{method:"POST",headers:root.authHeaders(),body:JSON.stringify({id:record.id,storageKey:deleted.storageKey})});}catch{}}root.msg&&root.msg("模板已永久删除："+record.name,"ok");await open();}catch(error){root.msg&&root.msg(error.message,"err");}});
    }catch(error){document.getElementById("pptTplBodyV2").innerHTML=`<div class="msg err">${escText(error.message)}</div>`;}
  }

  root.openPptTemplates=open;
  const nav=document.getElementById("btnPptTemplates");if(nav)nav.onclick=()=>{document.querySelectorAll(".nav-item").forEach(item=>item.classList.remove("active"));nav.classList.add("active");open();};
})(window);
