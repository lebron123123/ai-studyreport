// Step 2's shared request contract. Step 3 connects UI producers, never globals.
(function(root){
 'use strict';
 const chains=new Set(['chat','parameters','calculation','file','report','autosave','export']);
 function create(){
  let current=null,selection=0;
  const valid=x=>x&&Number.isSafeInteger(x.userId)&&x.userId>0&&['researchId','runId'].every(k=>typeof x[k]==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(x[k]))&&Number.isSafeInteger(x.version)&&x.version>0&&Number.isSafeInteger(x.epoch)&&x.epoch>0;
  const select=value=>{if(!valid(value))throw new Error('研究身份不完整');current=Object.freeze({...value});selection++;return current;};
  const capture=chain=>{
   if(!current||!chains.has(chain))throw new Error('请选择明确的研究轮次及任务类型');
   return Object.freeze({userId:current.userId,researchId:current.researchId,runId:current.runId,expectedVersion:current.version,epoch:current.epoch,requestId:root.crypto.randomUUID(),chain,selection});
  };
  const accepts=token=>Boolean(current&&token.selection===selection&&token.userId===current.userId&&token.researchId===current.researchId&&token.runId===current.runId&&token.epoch===current.epoch);
  const acceptVersion=(token,response)=>{
   if(!accepts(token)||response.researchId!==token.researchId||response.runId!==token.runId||response.epoch!==token.epoch||!Number.isSafeInteger(response.acceptedVersion)||response.acceptedVersion<current.version)return false;
   current=Object.freeze({...current,version:response.acceptedVersion});return true;
  };
  return Object.freeze({select,capture,accepts,acceptVersion,clear(){current=null;selection++;},localKey(){if(!current)throw new Error('未选择研究');return 'fs_research_'+[current.userId,current.researchId,current.runId].join('_');}});
 }
 const api=Object.freeze({create});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ResearchContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
