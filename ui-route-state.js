/* Persist only navigation state. No credentials, document text or user content is stored here. */
(function(root){
  "use strict";
  const KEY="studyreport:last-view:v1";
  const MODES=new Set([null,"report","calc","review","office","aireport","collaboration","personalKnowledge","analysis"]);
  const OFFICE_VIEWS=new Set(["chat","ppt","assets"]);
  function projectRoute(hash){const m=String(hash==null?location.hash:hash).match(/^#project\/([A-Za-z0-9_-]{8,100})\/(overview|data|files|decisions|spatial|members)$/);return m?{projectId:m[1],projectView:m[2]}:null;}
  function hashState(){const pr=projectRoute();if(pr)return pr;const raw=String(location.hash||"").replace(/^#\/?/,"");if(!raw)return{};const parts=raw.split("/").map(decodeURIComponent);const mode=parts[0]||null;return{mode:MODES.has(mode)?mode:null,officeView:OFFICE_VIEWS.has(parts[1])?parts[1]:"chat"};}
  function read(){try{return{...JSON.parse(sessionStorage.getItem(KEY)||"{}"),...hashState()};}catch(_){return hashState();}}
  function write(){
    try{
      const ppt=root.PptWorkspace&&root.PptWorkspace.state;
      sessionStorage.setItem(KEY,JSON.stringify({
        mode:MODES.has(appMode)?appMode:null,
        officeView:typeof officeView!=="undefined"&&OFFICE_VIEWS.has(officeView)?officeView:"chat",
        reportStep:typeof currentStep==="number"?currentStep:0,
        pptProjectId:ppt&&ppt.current&&ppt.current.id||"",
        pptSlide:ppt&&Number.isFinite(ppt.selected)?ppt.selected:0
      }));
      const activeProject=projectRoute();if(activeProject)return;
      const route=appMode===null?"":encodeURIComponent(appMode)+(appMode==="office"?"/"+encodeURIComponent(typeof officeView!=="undefined"&&OFFICE_VIEWS.has(officeView)?officeView:"chat"):"");history.replaceState(null,"",location.pathname+location.search+(route?"#"+route:""));
    }catch(_){ }
  }
  function restore(){
    const saved=read();
    if(MODES.has(saved.mode))appMode=saved.mode;
    if(typeof officeView!=="undefined"&&OFFICE_VIEWS.has(saved.officeView))officeView=saved.officeView;
    if(typeof currentStep==="number"&&Number.isInteger(saved.reportStep))currentStep=Math.max(0,Math.min(5,saved.reportStep));
    return saved;
  }
  const saved=restore(),oldRender=root.renderSheet,oldHome=root.goHome,oldRestoreDraft=root.restoreDraft;
  root.renderSheet=function(){const out=oldRender.apply(this,arguments);write();return out;};
  root.goHome=function(){try{sessionStorage.removeItem(KEY);history.replaceState(null,"",location.pathname+location.search);}catch(_){}return oldHome.apply(this,arguments);};
  if(typeof oldRestoreDraft==="function")root.restoreDraft=function(data,options){
    const result=oldRestoreDraft.apply(this,arguments);
    if(options&&options.openHome){restore();root.renderTOC();root.renderSheet();}
    return result;
  };
  function restorePpt(){
    if(appMode!=="office"||typeof officeView==="undefined"||officeView!=="ppt"||!saved.pptProjectId||!root.PptWorkspace)return;
    const state=root.PptWorkspace.state;if(state){state.selected=Math.max(0,Number(saved.pptSlide)||0);}
    root.PptWorkspace.loadList(saved.pptProjectId).catch(()=>{});
  }
  setTimeout(restorePpt,350);
  root.addEventListener("beforeunload",write);
  root.UiRouteState={read,write,restore,projectRoute,writeProject:(projectId,view)=>history.pushState(null,"",location.pathname+location.search+"#project/"+encodeURIComponent(projectId)+"/"+(view||"overview"))};
})(window);
