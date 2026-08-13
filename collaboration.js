// 前台“知识与规则”协作中心：只读查询、受控投稿、个人进度。
let collabTab="knowledge", collabPrefill=null;
const COLLAB_KIND_LABEL={material:"正式资料",wiki:"Wiki知识页",rule:"审核规则建议",example:"黄金范例",correction:"数据/功能纠错"};
const COLLAB_STATUS_LABEL={pending:"待审核",needs_changes:"待补充",approved:"已通过",rejected:"已驳回"};

function collabEsc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
async function collabApi(body){const r=await fetch("/api/contributions",{method:"POST",headers:{...authHeaders(),"Content-Type":"application/json"},body:JSON.stringify(body)});return r.json();}
function renderCollaboration(){
  return '<div class="doc-eyebrow">KNOWLEDGE · COLLABORATION</div><h1 class="doc-title">知识与规则</h1>'
    +'<div class="step-desc">查正式口径、提交资料或建议、跟踪审核状态。投稿不会直接进入报告生成链路，只有管理员审核后才会分流到正式模块。</div>'
    +'<div class="collab-tabs"><button data-ctab="knowledge">知识与规则</button><button class="primary" data-ctab="submit">提交资料/建议</button><button data-ctab="mine">我的提交</button></div>'
    +'<div id="collabBody"><div class="collab-loading">读取中…</div></div>';
}
function bindCollaborationEvents(){
  document.querySelectorAll("[data-ctab]").forEach(b=>b.onclick=()=>{collabTab=b.dataset.ctab;loadCollabTab();});
  loadCollabTab();
}
async function loadCollabTab(){
  document.querySelectorAll("[data-ctab]").forEach(b=>b.classList.toggle("active",b.dataset.ctab===collabTab));
  const box=document.getElementById("collabBody");if(!box)return;box.innerHTML='<div class="collab-loading">读取中…</div>';
  if(collabTab==="submit"){renderCollabSubmit(box);return;}
  if(collabTab==="mine"){await renderMyContributions(box);return;}
  await renderCollabKnowledge(box);
}
async function renderCollabKnowledge(box){
  try{
    const [wd,cd]=await Promise.all([
      fetch("/api/wiki",{method:"POST",headers:{...authHeaders(),"Content-Type":"application/json"},body:JSON.stringify({action:"publicList"})}).then(r=>r.json()),
      fetch("/api/calcconfig",{headers:authHeaders()}).then(r=>r.json())
    ]);
    const pages=wd.ok?(wd.pages||[]):[], rules=cd.ok?(cd.config.airules||[]):[], standards=cd.ok?(cd.config.calcstd||[]):[];
    box.innerHTML='<div class="collab-search"><input id="collabSearch" placeholder="搜索标题、政策口径、审核规则或测算标准"><span>已发布 Wiki '+pages.length+' 页 · 审核规则 '+rules.length+' 条 · 测算标准 '+standards.length+' 条</span></div><div id="collabResults"></div>';
    const draw=()=>{const q=document.getElementById("collabSearch").value.trim().toLowerCase(),items=[];
      pages.forEach(p=>items.push({type:"Wiki",title:p.title,text:p.content,source:p.source_ref||p.doc_no||"已发布知识页"}));
      rules.forEach(r=>items.push({type:"可研规则",title:r.match||r.id||"审核规则",text:r.rule||"",source:r.reason||"后台审核规则"}));
      standards.forEach(r=>items.push({type:"测算标准",title:r.item||r.id||"测算标准",text:r.standard||r.note||"",source:r.category||"测算审核标准"}));
      const hit=items.filter(x=>!q||(x.title+" "+x.text+" "+x.source).toLowerCase().includes(q)).slice(0,80);
      document.getElementById("collabResults").innerHTML=hit.length?hit.map(x=>'<article class="collab-knowledge"><span>'+collabEsc(x.type)+'</span><h3>'+collabEsc(x.title)+'</h3><p>'+collabEsc(x.text).slice(0,560)+'</p><small>依据：'+collabEsc(x.source)+'</small></article>').join(""):'<div class="collab-loading">没有匹配内容</div>';
    };document.getElementById("collabSearch").oninput=draw;draw();
  }catch(e){box.innerHTML='<div class="collab-error">读取失败：'+collabEsc(e.message)+'</div>';}
}
function renderCollabSubmit(box){
  const p=collabPrefill||{};collabPrefill=null;
  box.innerHTML='<div class="collab-form"><div class="collab-notice"><b>受控提交</b>　提交后内容锁定；管理员通过前，不会进入 RAG、Wiki、规则库或范例库。被退回时请“复制后重新提交”。</div>'
    +'<div class="collab-grid"><label>提交类型<select id="coKind">'+Object.entries(COLLAB_KIND_LABEL).map(([k,v])=>'<option value="'+k+'"'+(p.kind===k?' selected':'')+'>'+v+'</option>').join("")+'</select></label><label>标题<input id="coTitle" value="'+collabEsc(p.title||"")+'" placeholder="一句话说明提交内容"></label><label>区域（可选）<input id="coRegion" value="'+collabEsc(p.region||"")+'"></label><label>项目类型（可选）<input id="coProjectType" value="'+collabEsc(p.project_type||"")+'"></label></div>'
    +'<label>原始依据/来源位置<input id="coSource" value="'+collabEsc(p.source_ref||"")+'" placeholder="文件名、文号、页码、条款或来源系统；纠错可留空"></label>'
    +'<label>上传文件（可选，支持 TXT/MD/DOCX/PDF/XLSX/CSV）<input type="file" id="coFile"><small id="coFileState">文件只在本机解析为文本，审核前不会进入正式知识库。</small></label>'
    +'<label>正文/说明<textarea id="coContent" rows="12" placeholder="资料正文、建议内容、适用边界和希望怎样处理">'+collabEsc(p.content||"")+'</textarea></label>'
    +'<button class="btn primary" id="coSubmit">提交管理员审核</button><span id="coSubmitMsg"></span></div>';
  document.getElementById("coFile").onchange=collabReadFile;
  document.getElementById("coSubmit").onclick=submitContribution;
}
async function collabReadFile(e){
  const f=e.target.files[0],state=document.getElementById("coFileState");if(!f)return;state.textContent="正在本地解析 "+f.name+"…";
  try{let text="",name=f.name.toLowerCase();
    if(name.endsWith(".docx")){if(!window.mammoth)await loadScript("mammoth.min.js");text=(await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()})).value;}
    else if(name.endsWith(".pdf")){if(!window.pdfjsLib)await loadScript("pdf.min.js");pdfjsLib.GlobalWorkerOptions.workerSrc="pdf.worker.min.js";const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise,parts=[];for(let i=1;i<=pdf.numPages;i++){const c=await (await pdf.getPage(i)).getTextContent();parts.push("[第"+i+"页]\n"+c.items.map(x=>x.str).join(" "));}text=parts.join("\n");}
    else if(/\.(xlsx|xls|csv)$/.test(name)){if(!window.XLSX)await loadScript("xlsx.full.min.js");const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellFormula:true});text=wb.SheetNames.map(n=>"[工作表 "+n+"]\n"+XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");}
    else text=await f.text();
    text=String(text||"").trim().slice(0,200000);if(!text)throw new Error("未提取到文字");document.getElementById("coContent").value=text;document.getElementById("coTitle").value=document.getElementById("coTitle").value||f.name.replace(/\.[^.]+$/,"");state.dataset.name=f.name;state.textContent="已解析 "+f.name+"（"+text.length+" 字），可在下方核对后提交。";
  }catch(err){state.textContent="解析失败："+err.message+"。可复制正文到下方后提交。";}
}
async function submitContribution(){
  const btn=document.getElementById("coSubmit"),msg=document.getElementById("coSubmitMsg");btn.disabled=true;msg.textContent="提交中…";
  try{const d=await collabApi({action:"submit",item:{kind:document.getElementById("coKind").value,title:document.getElementById("coTitle").value,region:document.getElementById("coRegion").value,project_type:document.getElementById("coProjectType").value,source_ref:document.getElementById("coSource").value,file_name:document.getElementById("coFileState").dataset.name||"",content:document.getElementById("coContent").value,parent_id:document.getElementById("coSubmit").dataset.parent||""}});if(!d.ok)throw new Error(d.error||"提交失败");msg.textContent=d.message;collabTab="mine";setTimeout(loadCollabTab,600);}catch(e){msg.textContent=e.message;btn.disabled=false;}
}
async function renderMyContributions(box){
  try{const d=await collabApi({action:"listMine"});if(!d.ok)throw new Error(d.error||"读取失败");const rows=d.items||[];
    box.innerHTML=rows.length?rows.map(x=>'<article class="collab-submission"><div><span class="co-status '+x.status+'">'+collabEsc(COLLAB_STATUS_LABEL[x.status]||x.status)+'</span><b>'+collabEsc(x.title)+'</b><small>'+collabEsc(COLLAB_KIND_LABEL[x.kind]||x.kind)+' · '+new Date(x.created_at).toLocaleString("zh-CN")+'</small></div><p>'+collabEsc(x.content).slice(0,260)+'</p>'+(x.review_note?'<div class="collab-review-note">审核意见：'+collabEsc(x.review_note)+'</div>':'')+(x.target_module?'<div class="collab-target">已进入：'+collabEsc(x.target_module)+'　编号 '+collabEsc(x.target_ref)+'</div>':'')+(["needs_changes","rejected"].includes(x.status)?'<button class="btn sm co-copy" data-id="'+x.id+'">复制后重新提交</button>':'')+'</article>').join(""):'<div class="collab-loading">还没有提交记录</div>';
    document.querySelectorAll(".co-copy").forEach(b=>b.onclick=()=>{const x=rows.find(v=>v.id===b.dataset.id);collabPrefill={...x,parent_id:x.id};collabTab="submit";loadCollabTab();setTimeout(()=>{const s=document.getElementById("coSubmit");if(s)s.dataset.parent=x.id;},0);});
  }catch(e){box.innerHTML='<div class="collab-error">'+collabEsc(e.message)+'</div>';}
}
