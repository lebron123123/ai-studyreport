/* 可研标准表格后台：懒加载预览、差异化编辑、版本发布与Word查看版。 */
(function reportTableAdminModule(global){
  "use strict";
  const escHtml=value=>typeof esc==="function"?esc(value):String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const LABELS={rent:"出租类", "gaibao-housing":"非居改保（住房改造）", "gaibao-commercial":"商业改造（自持改造）"};
  const TYPES=Object.keys(LABELS);
  let mountedRoot=null,workingSet=null,editing=false,busy=false,activeType="rent";
  const clone=value=>JSON.parse(JSON.stringify(value));

  async function ensureLoaded(force){
    if(!global.ReportTableTemplates)throw new Error("表格模板模块未加载");
    const set=await global.ReportTableTemplates.load(activeType,!!force);workingSet=clone(set);return set;
  }
  function templateByIndex(index){return workingSet?.templates?.[Number(index)]||null;}
  function readRendered(card){
    const template=templateByIndex(card.dataset.rtaIndex);if(!template)return;
    const title=card.querySelector("[data-rta-title]");if(title)template.title=title.value.trim();
    const chapter=card.querySelector("[data-rta-chapter]");if(chapter)template.chapter=chapter.value.trim();
    const match=card.querySelector("[data-rta-match]");if(match)template.match=match.value.split(/[，,；;]/).map(x=>x.trim()).filter(Boolean);
    card.querySelectorAll("[data-role]:not([data-role='value'])").forEach(cell=>{
      const segment=Number(cell.closest("[data-segment]")?.dataset.segment||0),row=Number(cell.dataset.row),col=Number(cell.dataset.col);
      const target=template.segments?.[segment]?.rows?.[row]?.cells?.find(item=>Number(item.col)===col);
      if(target)target.text=cell.textContent.replace(/\u00a0/g," ").trim();
    });
  }
  function readAll(){mountedRoot?.querySelectorAll("[data-rta-index]").forEach(readRendered);}
  function cardBody(index){
    const template=templateByIndex(index);if(!template)return '<div class="msg err">表格不存在</div>';
    return '<div class="rta-title-edit"><label>表格名称</label><input data-rta-title value="'+escHtml(template.title)+'" '+(editing?'':'readonly')+'><label>放置章节</label><input data-rta-chapter value="'+escHtml(template.chapter||'')+'" '+(editing?'':'readonly')+'><label>匹配小节</label><input data-rta-match value="'+escHtml((template.match||[]).join('，'))+'" '+(editing?'':'readonly')+'></div>'
      +(editing?'<div class="rta-edit-note">蓝色文字单元格可直接修改；灰色空白数据格由项目材料或测算引擎填写，不能固化进公司模板。</div>':'')
      +(editing?'<button class="btn sm danger" data-rta-delete="'+index+'">删除此表格</button>':'')
      +global.ReportTableTemplates.renderTemplate(template,{editable:editing});
  }
  function lazyBind(){
    mountedRoot.querySelectorAll("details[data-rta-index]").forEach(card=>card.ontoggle=()=>{
      if(!card.open)return;const body=card.querySelector(".rta-lazy");if(body&&!body.dataset.loaded){body.innerHTML=cardBody(card.dataset.rtaIndex);body.dataset.loaded="1";const del=body.querySelector('[data-rta-delete]');if(del)del.onclick=()=>deleteTemplate(Number(del.dataset.rtaDelete));}
    });
  }
  function toolbarHtml(config){
    const stats=global.ReportTableTemplates.stats(activeType);
    return '<div class="rta-library-tabs" role="tablist" aria-label="标准表格库类型">'+TYPES.map(type=>'<button type="button" role="tab" data-rta-type="'+type+'" aria-selected="'+(type===activeType)+'" class="'+(type===activeType?'active':'')+'">'+escHtml(LABELS[type])+'</button>').join('')+'</div>'
      +'<div class="rta-toolbar"><div><b>'+escHtml(LABELS[activeType])+'标准表格库</b><span>'+stats.templates+'套逻辑表 · '+stats.physicalTables+'张源Word物理表 · 当前 v'+Number(config.version||1)+'</span></div><div class="rta-actions">'
      +'<button class="btn sm ghost" id="rtaExport">📄 导出表格Word版</button>'
      +(editing?'<button class="btn sm ghost" id="rtaAdd">＋新增表格</button><button class="btn sm" id="rtaPublish">保存并同步到前台</button><button class="btn sm ghost" id="rtaCancel">取消修改</button>':'<button class="btn sm" id="rtaEdit">🔓 修改表格模板</button>')+'</div></div>';
  }
  function chapterGroups(templates,appendix){
    const groups=[],byName=new Map();
    templates.forEach((template,index)=>{
      if(!!template.appendix!==appendix)return;
      const name=appendix?"财务附表":String(template.chapter||"其他章节");
      let group=byName.get(name);
      if(!group){group={name,items:[]};byName.set(name,group);groups.push(group);}
      group.items.push({template,index});
    });
    return groups;
  }
  function tableCardHtml(item){
    const t=item.template;
    return '<details class="rta-card" data-rta-index="'+item.index+'"><summary><b>'+escHtml(t.title)+'</b><span>源表 '
      +escHtml((t.sourceTableNumbers||[]).join('、'))+(t.longPeriod?' · 含续表':'')+'</span></summary><div class="rta-lazy"></div></details>';
  }
  function chapterHtml(group){
    return '<details class="rta-chapter"><summary><span><b>'+escHtml(group.name)+'</b><small>'+group.items.length+'套表格</small></span><em>展开查看</em></summary>'
      +'<div class="rta-chapter-body">'+group.items.map(tableCardHtml).join('')+'</div></details>';
  }
  function render(){
    if(!mountedRoot)return;const config=global.ReportTableTemplates.config(activeType),templates=workingSet?.templates||[];
    mountedRoot.innerHTML='<style>.rta-wrap{margin-top:20px;border-top:2px solid var(--bp);padding-top:16px}.rta-library-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.rta-library-tabs button{border:1px solid var(--line);background:#fff;color:var(--bp-deep);padding:9px 17px;border-radius:20px;cursor:pointer}.rta-library-tabs button.active{background:var(--bp);border-color:var(--bp);color:#fff}.rta-toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:10px}.rta-toolbar>div:first-child{display:flex;flex-direction:column}.rta-toolbar span{font-size:11px;color:var(--soft);margin-top:3px}.rta-actions{display:flex;gap:7px;flex-wrap:wrap}.rta-help{background:#F3F8FC;border:1px solid var(--line);padding:10px 13px;border-radius:8px;color:var(--soft);font-size:12px;line-height:1.7}.rta-group{margin-top:14px}.rta-group>h3{font-size:14px;color:var(--bp-deep);margin:0 0 8px}.rta-chapter{border:1px solid #C9DBEA;border-radius:10px;background:#fff;margin:9px 0;overflow:hidden}.rta-chapter>summary{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 16px;cursor:pointer;background:#EDF5FB;color:var(--bp-deep)}.rta-chapter>summary span{display:flex;align-items:baseline;gap:10px}.rta-chapter>summary b{font-size:14px}.rta-chapter>summary small,.rta-chapter>summary em{font-size:11px;color:var(--soft);font-style:normal;font-weight:400}.rta-chapter[open]>summary{border-bottom:1px solid #C9DBEA}.rta-chapter-body{padding:7px 11px 11px;background:#FAFCFE}.rta-card{border:1px solid var(--line);border-radius:8px;background:#fff;margin:7px 0;overflow:hidden}.rta-card>summary{display:flex;justify-content:space-between;gap:14px;padding:10px 13px;cursor:pointer;background:#fff}.rta-card[open]>summary{background:#F7FAFD;border-bottom:1px solid var(--line)}.rta-card>summary span{font-size:11px;color:var(--soft)}.rta-lazy{padding:12px;overflow:auto}.rta-title-edit{display:grid;grid-template-columns:90px minmax(260px,1fr);align-items:center;gap:8px;margin-bottom:10px}.rta-title-edit label{margin:0}.rta-title-edit input[readonly]{background:#F7FAFD;color:var(--ink)}.rta-edit-note{font-size:11px;color:#276796;background:#EDF6FC;padding:7px 10px;margin-bottom:9px}.rta-wrap .rpt-template-card{margin:0;border:0}.rta-wrap .rpt-template-card figcaption{display:none}.rta-wrap .rpt-template-scroll{overflow:auto;max-height:520px}.rta-wrap .rpt-fixed-template{border-collapse:collapse;table-layout:fixed;width:100%;min-width:720px}.rta-wrap .rpt-fixed-template th,.rta-wrap .rpt-fixed-template td{border:1px solid #9FAFBE;padding:4px 5px;font-size:11px;line-height:1.35;vertical-align:middle}.rta-wrap .rpt-fixed-template th{background:#E8F0F7}.rta-wrap [contenteditable=true]{outline:1px dashed #77A9D3;background:#F4FAFF;color:#174E79}.rta-wrap [data-role=value]{background:#F5F6F7;color:#999}.rta-wrap .rpt-template-segment-title{text-align:center;font-weight:700;margin:8px 0}.rta-wrap .rpt-template-period{margin:8px 0}.rta-wrap .rpt-template-period>summary{cursor:pointer;color:var(--bp-deep);font-size:12px}@media(max-width:850px){.rta-toolbar{align-items:flex-start;flex-direction:column}.rta-title-edit{grid-template-columns:1fr}.rta-chapter>summary span{align-items:flex-start;flex-direction:column;gap:2px}}</style>'
      +'<section class="rta-wrap">'+toolbarHtml(config)+'<div class="rta-help">逐表点击即可查看完整行列。管理员修改只保存与原Word的差异，原始1:1结构始终可恢复；发布后，前台生成、复核预览和Word导出会同时采用新版本。</div>'
      +[['正文表格',false],['财务附表',true]].map(([label,appendix])=>'<div class="rta-group"><h3>'+label+'（'+templates.filter(t=>!!t.appendix===appendix).length+'套）</h3>'+chapterGroups(templates,appendix).map(chapterHtml).join('')+'</div>').join('')+'</section>';
    lazyBind();document.getElementById("rtaExport").onclick=exportWord;mountedRoot.querySelectorAll("[data-rta-type]").forEach(button=>button.onclick=async()=>{const type=button.dataset.rtaType;if(type===activeType)return;activeType=type;editing=false;await ensureLoaded(false);render();});
    if(editing){document.getElementById("rtaAdd").onclick=addTemplate;document.getElementById("rtaPublish").onclick=publish;document.getElementById("rtaCancel").onclick=cancel;}else document.getElementById("rtaEdit").onclick=beginEdit;
  }
  async function beginEdit(){
    const proceed=()=>{editing=true;workingSet=clone(global.ReportTableTemplates.current(activeType));render();};
    if(typeof unlockStdEdit==="function")unlockStdEdit(proceed);else proceed();
  }
  async function cancel(){editing=false;await ensureLoaded(true);render();}
  async function publish(){
    if(busy)return;readAll();const overrides=global.ReportTableTemplates.buildOverrides(workingSet,global.ReportTableTemplates.baseline(activeType));
    const changed=Object.keys(overrides.templates||{}).length+(overrides.addedTemplates||[]).length+(overrides.deletedTemplateIds||[]).length;if(!confirm("确认发布表格模板新版本？共涉及 "+changed+" 张逻辑表，发布后前台立即使用。"))return;
    const button=document.getElementById("rtaPublish");busy=true;button.disabled=true;button.textContent="正在保存…";
    try{
      const response=await fetch("/api/reporttables",{method:"POST",headers:authHeaders(),body:JSON.stringify({action:"publish",projectType:activeType,overrides})}),result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||"表格模板发布失败");editing=false;await ensureLoaded(true);render();if(typeof msg==="function")msg(LABELS[activeType]+"表格模板已发布为 v"+result.config.version,"ok");
    }catch(error){button.disabled=false;button.textContent="保存并同步到前台";alert("发布失败："+error.message);}finally{busy=false;}
  }
  function catalogPayload(){
    readAll();const templates=workingSet?.templates||[],toSections=list=>list.map(template=>({title:template.title,blocks:[{type:"templateTable",template:clone(template)}]}));
    return {project:{name:LABELS[activeType]+"可研标准表格模板库 v"+Number(global.ReportTableTemplates.config(activeType).version||1),owner:"公司可研生成逻辑库",industry:"可行性研究"},signed:true,docNo:"",chapters:[{cn:"一",num:1,name:"正文标准表格",sections:toSections(templates.filter(t=>!t.appendix))},{cn:"二",num:2,name:"财务附表",sections:toSections(templates.filter(t=>t.appendix))}],appendix:null,tableAppendix:[],provenance:null};
  }
  async function exportWord(){
    const button=document.getElementById("rtaExport");button.disabled=true;button.textContent="正在生成Word…";
    try{
      if(typeof ensureDocxLib!=="function")throw new Error("Word导出组件未加载");await ensureDocxLib();
      const doc=global.buildDocxDocument(global.docx,catalogPayload()),blob=await global.docx.Packer.toBlob(doc),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=LABELS[activeType]+"可研标准表格模板库-v"+Number(global.ReportTableTemplates.config(activeType).version||1)+".docx";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    }catch(error){alert("表格Word导出失败："+error.message);}finally{button.disabled=false;button.textContent="📄 导出表格Word版";}
  }
  async function mount(root,preferredType){
    mountedRoot=root;if(!root)return;if(TYPES.includes(preferredType))activeType=preferredType;root.innerHTML='<div class="empty">加载'+escHtml(LABELS[activeType])+'标准表格库…</div>';
    try{await ensureLoaded(false);render();}catch(error){root.innerHTML='<div class="msg err">'+escHtml(error.message)+'</div>';}
  }
  function addTemplate(){
    readAll();const id="custom-"+activeType+"-"+Date.now().toString(36),scenario=activeType==="gaibao-commercial"?"commercial_renovation":activeType==="gaibao-housing"?"housing_conversion":"";
    workingSet.templates.push({id,title:"新建表格",projectType:activeType,businessScenario:scenario,version:1,chapter:"第一章 项目总论",match:["项目概况"],placement:"管理员新增",appendix:false,longPeriod:false,sourceTableNumbers:[],segments:[{sourceTableNumber:0,gridWidths:[3600,3600],rows:[{cells:[{text:"指标",col:0,colSpan:1,vMerge:"",fill:"D9EAF7",align:"center",role:"static"},{text:"内容",col:1,colSpan:1,vMerge:"",fill:"D9EAF7",align:"center",role:"static"}]},{cells:[{text:"待编辑",col:0,colSpan:1,vMerge:"",fill:"",align:"left",role:"static"},{text:"",col:1,colSpan:1,vMerge:"",fill:"",align:"left",role:"value"}]}]}]});render();
  }
  function deleteTemplate(index){readAll();const item=templateByIndex(index);if(!item||!confirm("确认删除表格“"+item.title+"”？发布前仍可取消修改。"))return;workingSet.templates.splice(index,1);render();}
  global.ReportTableAdmin={mount,exportWord,chapterGroups};
  if(typeof module==="object"&&module.exports)module.exports={chapterGroups,LABELS,TYPES};
})(typeof window!=="undefined"?window:globalThis);
