/* 可研生成逻辑库后台：与审核规则合并展示；解锁后可增删改并发布新版本。 */
(function reportLogicAdminModule(global){
  "use strict";
  const escHtml = value => typeof esc === "function" ? esc(value) : String(value || "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const KIND_LABELS={knowledge_base:"知识库",web_search:"网上检索",provider:"数据接口",manual_upload:"人工材料",calculation_engine:"测算引擎",derived_section:"其他章节",system_rule:"系统规则"};
  const TYPE_LABELS={rent:"出租类",gaibao:"改造项目（双场景）"};
  const SCENARIO_LABELS={housing_conversion:"非居改保、居改居等（住房改造）",commercial_renovation:"商业改造（自持改造）"};
  const DEFAULT_LOGIC_VERSIONS={rent:"1.0",housing_conversion:"2.0",commercial_renovation:"1.0"};
  let activeSet=null, activeType="rent", activeScenario="housing_conversion", editing=false;
  async function api(body){
    const response=await fetch("/api/reportlogic",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},authHeaders()),body:JSON.stringify(body)}),result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||"生成逻辑库请求失败");return result;
  }
  async function loadPublished(type){
    const response=await fetch("/api/reportlogic?projectType="+encodeURIComponent(type||"rent"),{headers:authHeaders()}),result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||"生成逻辑读取失败");if(result.set&&global.ReportWritingPolicy)result.set.data=global.ReportWritingPolicy.normalize(result.set.data);return result.set;
  }
  const clone=value=>JSON.parse(JSON.stringify(value));
  function numericPath(rule){
    const text=[rule?.subsection,rule?.section,rule?.pointTitle].find(value=>/^\s*\d+(?:\.\d+)*/.test(value||""))||"";
    const match=String(text).match(/^\s*(\d+(?:\.\d+)*)/);return match?match[1].split(".").map(Number):[];
  }
  function chapterRank(rule,chapterNames){
    const exact=(chapterNames||[]).indexOf(rule?.chapter);if(exact>=0)return exact;
    const match=String(rule?.chapter||"").match(/第([一二三四五六七八九十百]+)章/),digits={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
    return match?(digits[match[1]]||999):999;
  }
  function compareRules(a,b,chapterNames){
    const chapterDelta=chapterRank(a,chapterNames)-chapterRank(b,chapterNames);if(chapterDelta)return chapterDelta;
    const left=numericPath(a),right=numericPath(b),length=Math.max(left.length,right.length);
    for(let i=0;i<length;i++){const delta=(left[i]??-1)-(right[i]??-1);if(delta)return delta;}
    return Number(a.sourceNo||0)-Number(b.sourceNo||0)||String(a.id||"").localeCompare(String(b.id||""),"zh-CN");
  }
  function projectedRules(){
    const allRules=activeSet?.data?.rules||[];
    if(activeType!=="gaibao")return allRules.map((rule,index)=>Object.assign({_baseRuleId:rule.id,_baseIndex:index},rule));
    const chapterNames=activeSet?.data?.structure?.scenarioStructures?.[activeScenario]?.chapterNames||[];
    return allRules.filter(rule=>!Array.isArray(rule.scenarios)||rule.scenarios.includes(activeScenario)).map((rule,index)=>Object.assign({_baseRuleId:rule.id,_baseIndex:index},rule,rule.scenarioVariants?.[activeScenario]||{},{scenarios:[activeScenario]})).sort((a,b)=>compareRules(a,b,chapterNames));
  }
  function logicVersion(){return activeSet?.data?.logicVersions?.[activeType==="gaibao"?activeScenario:"rent"]||DEFAULT_LOGIC_VERSIONS[activeType==="gaibao"?activeScenario:"rent"];}
  function field(rule,key,label,type){
    const value=rule[key]==null?"":rule[key];
    return type==="area"?'<label>'+label+'<textarea data-rla-field="'+key+'">'+escHtml(value)+'</textarea></label>':'<label>'+label+'<input data-rla-field="'+key+'" value="'+escHtml(value)+'"></label>';
  }
  function ruleCard(rule,index){
    const badges=(rule.sourceKinds||[]).map(kind=>'<span class="rla-badge">'+escHtml(KIND_LABELS[kind]||kind)+'</span>').join("")+(rule.scenarios||[]).map(s=>'<span class="rla-badge">'+escHtml(SCENARIO_LABELS[s]||s)+'</span>').join("");
    return '<article class="rla-rule"><div class="rla-rule-head"><b>第'+(index+1)+'项　'+escHtml(rule.displayTitle||rule.section)+'</b><span>'+escHtml(rule.importance)+'</span></div><div class="rla-path">'+escHtml(rule.section)+(rule.pointTitle?' → '+escHtml(rule.pointTitle):'')+'<span class="rla-source-no">源规则 #'+escHtml(rule.sourceNo)+'</span></div><div class="rla-grid"><div><label>所需来源/材料</label><p>'+escHtml(rule.requiredSources||'未指定')+'</p>'+badges+'</div><div><label>写作逻辑</label><p>'+escHtml(rule.writingLogic||'按小节标题规范撰写')+'</p></div><div><label>输出形式</label><p>'+escHtml(rule.outputForm||'文字')+'｜'+escHtml(rule.generationMode)+'</p></div></div></article>';
  }
  function editorCard(rule,index){
    return '<details class="rla-editor" data-rla-rule-id="'+escHtml(rule._baseRuleId||rule.id)+'"><summary><b>第'+(index+1)+'项　'+escHtml(rule.displayTitle||rule.section||'新规则')+'</b><span>'+escHtml(rule.chapter||'未分章')+'</span></summary><div class="rla-editor-grid">'
      +field(rule,"chapter","一级章节")+field(rule,"section","小节")+field(rule,"subsection","子节")+field(rule,"pointTitle","逻辑点标题")+field(rule,"requiredSources","所需来源/材料","area")+field(rule,"writingLogic","写作逻辑","area")+field(rule,"outputForm","输出形式")+field(rule,"importance","重要程度")+field(rule,"generationMode","生成方式")+field(rule,"missingPolicy","材料缺失处理","area")+field({sourceKinds:(rule.sourceKinds||[]).join(",")},"sourceKinds","来源类型（逗号分隔）")+field(rule,"note","备注","area")+'</div><div class="rla-editor-actions">'+(activeType==="gaibao"?'<span class="rla-auto-order">按小节编号自动排序</span>':'<button class="btn sm ghost" data-rla-up="'+rule._baseIndex+'">↑ 上移</button><button class="btn sm ghost" data-rla-down="'+rule._baseIndex+'">↓ 下移</button>')+'<button class="btn sm" data-rla-delete="'+escHtml(rule._baseRuleId||rule.id)+'" style="background:var(--red);">移除本项</button></div></details>';
  }
  function readEditors(){
    if(!activeSet?.data?.rules)return;
    const whole=document.getElementById("rlaGlobalRequirements");
    if(whole){activeSet.data.globalRequirements=activeSet.data.globalRequirements||{};activeSet.data.globalRequirements[activeType==="gaibao"?activeScenario:activeType]=whole.value.trim();}
    document.querySelectorAll(".rla-editor").forEach(row=>{const rule=activeSet.data.rules.find(item=>item.id===row.dataset.rlaRuleId);if(!rule)return;const target=activeType==="gaibao"?(rule.scenarioVariants||(rule.scenarioVariants={}),rule.scenarioVariants[activeScenario]||(rule.scenarioVariants[activeScenario]={})):rule;row.querySelectorAll("[data-rla-field]").forEach(input=>{const key=input.dataset.rlaField;if(key==="sourceKinds")target[key]=[...new Set(input.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))];else target[key]=input.value.trim();});target.displayTitle=[target.subsection,target.pointTitle].filter(Boolean).join("｜")||target.section;});
  }
  function bindTabs(){
    [["arTabGeneration","generation"],["arTabRules","rules"],["arTabLogic","logic"],["arTabSensitivity","sensitivity"],["arTabStd","std"]].forEach(([id,tab])=>{const el=document.getElementById(id);if(el)el.onclick=()=>{if(editing&&tab!=="generation"&&!confirm("当前生成逻辑尚未发布，确定离开并放弃本轮编辑？"))return;editing=false;if(typeof switchAiRuleAdminTab==="function")switchAiRuleAdminTab(tab);};});
  }
  function renderSet(){
    const root=document.getElementById("rlaBody");if(!root)return;if(!activeSet){root.innerHTML='<div class="empty">当前类型还没有已发布生成逻辑。</div>';return;}
    const allRules=activeSet.data?.rules||[],rules=projectedRules(),groups=new Map();rules.forEach(rule=>{if(!groups.has(rule.chapter))groups.set(rule.chapter,[]);groups.get(rule.chapter).push(rule);});
    root.innerHTML='<div class="rla-summary"><div><b>'+rules.length+'</b><span>正式逻辑项</span></div><div><b>'+groups.size+'</b><span>一级章节</span></div><div><b>'+escHtml(logicVersion())+'</b><span>逻辑版本</span><small>发布记录 v'+activeSet.version+'</small></div><div><b>'+(editing?'编辑中':'前台交互')+'</b><span>'+(editing?'发布后生效':'日常完善入口')+'</span></div></div><div class="msg '+(editing?'warn':'ok')+'"><b>'+(editing?'编辑说明：':'当前口径：')+'</b>'+(editing?'当前只修改所选场景，按章节/小节编号自动排序；发布后小改升修订号（如2.1），框架调整升主版本（如3.0），上一发布记录继续保留。':'以《'+escHtml(activeSet.data?.source?.fileName||TYPE_LABELS[activeType]+'逻辑表')+'》实际 '+rules.length+' 项为准，当前按章节与小节编号连续显示1—'+rules.length+'；源规则号仅用于历史追溯。')+'</div>'
      +(activeType==="gaibao"?'<div class="rla-type-tabs">'+Object.entries(SCENARIO_LABELS).map(([key,label])=>'<button type="button" data-rla-scenario="'+key+'" class="'+(key===activeScenario?'active':'')+'" '+(editing?'disabled title="请先发布或取消当前场景修改"':'')+'>'+label+'（'+allRules.filter(rule=>(rule.scenarios||[]).includes(key)).length+'项）</button>').join('')+'</div>':'')
      +globalRequirementsCard()
      +(editing?'<div class="rla-edit-tools"><button class="btn" id="rlaAdd">＋ 新增规则</button><button class="btn" id="rlaPublish">校验并发布新版本</button><button class="btn ghost" id="rlaCancel">取消修改</button></div>'+rules.map(editorCard).join(""):[...groups.entries()].map(([chapter,items],index)=>'<details class="rla-chapter" '+(index===0?'open':'')+'><summary><b>'+escHtml(chapter)+'</b><span>'+items.length+'项</span></summary>'+items.map((rule,itemIndex)=>ruleCard(rule,rules.indexOf(rule))).join('')+'</details>').join(''))
      +'<div id="rlaTablePanel"></div>';
    if(global.ReportTableAdmin){const tableType=activeType==="rent"?"rent":activeScenario==="commercial_renovation"?"gaibao-commercial":"gaibao-housing";global.ReportTableAdmin.mount(document.getElementById("rlaTablePanel"),tableType);}
    document.querySelectorAll("[data-rla-scenario]").forEach(button=>button.onclick=()=>{activeScenario=button.dataset.rlaScenario;renderSet();});
    const wholeEdit=document.getElementById("rlaEditGlobal");if(wholeEdit)wholeEdit.onclick=beginEdit;
    if(!editing)return;
    document.getElementById("rlaAdd").onclick=()=>{readEditors();const last=rules.at(-1)||{},id=activeType+"-logic-"+Date.now().toString(36),base={id,projectType:activeType,chapter:last.chapter||"第十三章 项目研究结论及建议",section:"新增小节",subsection:"",pointTitle:"",displayTitle:"新增小节",requiredSources:"",sourceKinds:[],scenarios:activeType==="gaibao"?[activeScenario]:[],writingLogic:"",importance:"★★一般",outputForm:"文字",generationMode:"ai_writing",missingPolicy:"资料缺失时标注待补，不得虚构",note:"",projectSpecific:false};if(activeType==="gaibao")base.scenarioVariants={[activeScenario]:{chapter:base.chapter,section:base.section,subsection:"",pointTitle:"",displayTitle:"新增小节",requiredSources:"",sourceKinds:[],writingLogic:"",importance:base.importance,outputForm:base.outputForm,generationMode:base.generationMode,missingPolicy:base.missingPolicy,note:""}};activeSet.data.rules.push(base);renderSet();};
    document.getElementById("rlaCancel").onclick=async()=>{editing=false;activeSet=await loadPublished(activeType);renderReportLogicTab();};document.getElementById("rlaPublish").onclick=publishChanges;
    document.querySelectorAll("[data-rla-delete]").forEach(btn=>btn.onclick=()=>{const id=btn.dataset.rlaDelete,index=activeSet.data.rules.findIndex(rule=>rule.id===id);if(index<0||!confirm("确定移除本场景中的这一项？发布前仍可点取消修改。"))return;readEditors();const rule=activeSet.data.rules[index];if(activeType==="gaibao"&&(rule.scenarios||[]).length>1){rule.scenarios=rule.scenarios.filter(item=>item!==activeScenario);if(rule.scenarioVariants)delete rule.scenarioVariants[activeScenario];}else activeSet.data.rules.splice(index,1);renderSet();});
    document.querySelectorAll("[data-rla-up],[data-rla-down]").forEach(btn=>btn.onclick=()=>{readEditors();const from=Number(btn.dataset.rlaUp??btn.dataset.rlaDown),to=btn.hasAttribute("data-rla-up")?from-1:from+1;if(to<0||to>=activeSet.data.rules.length)return;const item=activeSet.data.rules.splice(from,1)[0];activeSet.data.rules.splice(to,0,item);renderSet();});
  }
  function globalRequirementsCard(){
    const value=activeSet?.data?.globalRequirements?.[activeType==="gaibao"?activeScenario:activeType]||"";
    return '<section class="rla-rule" data-rla-global><h3>全篇要求 · 逻辑版本 '+escHtml(logicVersion())+'</h3>'+(!editing?'<button type="button" class="btn" id="rlaEditGlobal">编辑全篇要求</button>':'')+'<p>适用于当前场景的所有小节。这里统一维护语言、称谓、编号与事实边界；下方仅保留各小节的业务逻辑。随逻辑版本发布，不直接改写已有正文。</p>'+(editing?'<label>全篇写作要求<textarea id="rlaGlobalRequirements" rows="8" maxlength="12000" style="width:100%;box-sizing:border-box">'+escHtml(value)+'</textarea></label>':'<div style="white-space:pre-wrap">'+escHtml(value||'暂未设置场景专属全篇要求；仍遵守系统的事实核验与禁止编造约束。')+'</div>')+'</section>';
  }
  async function publishChanges(){
    readEditors();if(!confirm("确认校验并发布本轮修改？发布后前台生成与审核将同时使用新版本。"))return;const button=document.getElementById("rlaPublish");button.disabled=true;button.textContent="正在校验并发布…";
    try{await api({action:"publish",projectType:activeType,businessScenario:activeType==="gaibao"?activeScenario:"rent",data:activeSet.data});editing=false;if(typeof stdEditUnlocked!=="undefined")stdEditUnlocked=false;activeSet=await loadPublished(activeType);if(typeof msg==="function")msg(TYPE_LABELS[activeType]+"可研生成逻辑已发布，逻辑版本 "+logicVersion()+"（发布记录 v"+activeSet.version+"）","ok");renderReportLogicTab();}catch(error){button.disabled=false;button.textContent="校验并发布新版本";alert("发布失败："+error.message);}
  }
  function beginEdit(){const proceed=()=>{editing=true;activeSet=clone(activeSet);renderReportLogicTab();};if(typeof unlockStdEdit==="function")unlockStdEdit(proceed);else proceed();}
  function renderReportLogicTab(){
    const box=document.getElementById("editBox"),subnav=typeof arSubnavHtml==="function"?arSubnavHtml():"";
    box.innerHTML='<style>.rla-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.rla-head .sub{max-width:850px}.rla-type-tabs{display:flex;gap:8px;margin:14px 0 4px}.rla-type-tabs button{border:1px solid var(--line);background:#fff;color:var(--bp-deep);padding:8px 18px;border-radius:18px;cursor:pointer}.rla-type-tabs button.active{background:var(--bp);color:#fff;border-color:var(--bp)}.rla-type-tabs button:disabled{cursor:not-allowed;opacity:.72}.rla-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.rla-summary>div{border:1px solid var(--line);border-radius:10px;background:#fff;padding:15px 18px;display:flex;flex-direction:column}.rla-summary b{font-size:22px;color:var(--bp-deep)}.rla-summary span,.rla-summary small{font-size:12px;color:var(--soft);margin-top:4px}.rla-chapter,.rla-editor{border:1px solid var(--line);border-radius:10px;background:#fff;margin:12px 0;overflow:hidden}.rla-chapter>summary,.rla-editor>summary{padding:15px 18px;display:flex;justify-content:space-between;cursor:pointer;background:#f7fafc}.rla-rule{padding:15px 18px;border-top:1px solid var(--line)}.rla-rule-head{display:flex;justify-content:space-between;gap:20px}.rla-path{font-size:12px;color:var(--soft);margin:5px 0 10px}.rla-source-no{margin-left:10px;color:#98a6b5}.rla-grid{display:grid;grid-template-columns:1.05fr 1.4fr .55fr;gap:18px}.rla-grid label{font-size:11px;color:var(--soft)}.rla-grid p{margin:4px 0;white-space:pre-line;line-height:1.65}.rla-badge{font-size:11px;border:1px solid #bfd7ea;background:#edf6fc;color:#276796;padding:2px 6px;border-radius:9px;margin-right:4px}.rla-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px 18px}.rla-editor-grid label{font-size:12px;color:var(--soft)}.rla-editor-grid input,.rla-editor-grid textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px}.rla-editor-grid textarea{min-height:78px}.rla-editor-actions,.rla-edit-tools{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 16px}.rla-auto-order{font-size:12px;color:var(--soft);align-self:center}.rla-edit-tools{padding:14px 0 2px}@media(max-width:900px){.rla-summary,.rla-grid,.rla-editor-grid{grid-template-columns:1fr 1fr}}</style><h1 style="font-size:18px;">AI生成规则、审核规则与逻辑</h1>'+subnav+'<div class="rla-head"><div><h2 style="font-size:15px;margin-top:16px;">可研逐小节生成逻辑</h2><div class="sub">出租类与改造项目分类存储；改造项目再按“非居改保、居改居等（住房改造）/商业改造（自持改造）”分流。生成正文与审核投影共用同一规则ID。</div><div class="rla-type-tabs">'+Object.entries(TYPE_LABELS).map(([type,label])=>'<button type="button" data-rla-type="'+type+'" class="'+(type===activeType?'active':'')+'">'+label+'</button>').join('')+'</div></div>'+(editing?'':'<button class="btn" id="rlaUnlock">🔓 修改生成逻辑</button>')+'</div><div id="rlaBody" class="empty">读取正式逻辑…</div>';
    bindTabs();document.querySelectorAll("[data-rla-type]").forEach(button=>button.onclick=async()=>{const next=button.dataset.rlaType;if(next===activeType)return;if(editing&&!confirm("当前逻辑尚未发布，确定切换类型并放弃本轮编辑？"))return;editing=false;activeType=next;activeSet=null;await global.renderReportLogicAdminTab();});if(!editing){const unlock=document.getElementById("rlaUnlock");if(unlock)unlock.onclick=beginEdit;}renderSet();
  }
  global.renderReportLogicAdminTab=async function(preferredType){const box=document.getElementById("editBox"),list=document.getElementById("listBox");if(TYPE_LABELS[preferredType]){activeType=preferredType;activeSet=null;}if(list)list.style.display="none";box.style.display="block";if(!activeSet){box.innerHTML='<div style="padding:30px 0;color:var(--soft);">加载'+TYPE_LABELS[activeType]+'正式生成逻辑…</div>';try{activeSet=await loadPublished(activeType);}catch(error){box.innerHTML='<div class="msg err">'+escHtml(error.message)+'</div>';return;}}renderReportLogicTab();};
  global.openReportLogicAdmin=global.renderReportLogicAdminTab;
  global.ReportLogicAdminTools={compareRules,numericPath};
})(window);
