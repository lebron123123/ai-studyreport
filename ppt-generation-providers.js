/* AI PPT generation provider registry. The stable local provider is active;
 * optional research runtimes stay isolated until explicitly deployed. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.PptGenerationProviders=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const PROVIDERS=[
    {id:"local-design-ir",name:"本地智能排版引擎",description:"使用当前设计语义层、模板页检索与所见即所得导出。",enabled:true,local:true,version:"agent-v1"},
    {id:"pptagent-isolated",name:"PPTAgent 隔离引擎",description:"预留独立 Python/容器服务接口；未部署时不会影响主系统。",enabled:false,local:false,version:"adapter-v1"},
    {id:"deeppresenter-isolated",name:"DeepPresenter 隔离引擎",description:"预留研究型生成服务接口；默认关闭。",enabled:false,local:false,version:"adapter-v1"}
  ];
  function list(){return PROVIDERS.map(x=>({...x}));}
  function get(id){return list().find(x=>x.id===id)||list()[0];}
  function resolve(id){const p=get(id);return p.enabled?p:get("local-design-ir");}
  function jobMeta(id,extra={}){
    const p=resolve(id);
    return {providerId:p.id,providerVersion:p.version,pipelineVersion:"agent-v1",promptVersion:"ppt-agent-2026-08-18",...extra};
  }
  return {PROVIDERS:list(),list,get,resolve,jobMeta};
});
