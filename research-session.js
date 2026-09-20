// Explicit adapter for the existing report UI. Does not replace global fetch,
// project IDs, localStorage or the formal project workflow.
(function(root){
 'use strict';
 const Context=typeof module!=='undefined'&&module.exports?require('./research-context.js'):root.ResearchContext;
 function create({request,onState=null,onError=()=>{}}){
  if(typeof request!=='function')throw new Error('缺少研究接口');
  const context=Context.create();
  let selected=null,pending=Promise.resolve(),generation=0,loadSequence=0,failed=false,uncertain=null,navigation=false,uncertainTransition=null;
  const contentHashCache=new Map();
  const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
  const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(value));
  function ensureEditable(){
   if(uncertainTransition)throw new Error('上次状态操作结果未确认，请重试同一操作后再编辑');
   if(!selected||selected.study.status!=='active'||selected.run.status!=='active'||selected.study.role==='viewer')throw new Error('当前轮次为只读，请返回活动轮次或先恢复研究');
   if(failed)throw new Error('保存尚未成功，请重试保存后再执行此操作');
  }
  async function open(researchId,runId){
   if(uncertainTransition)throw new Error('上次状态操作结果未确认，请先重试同一操作');
   // Failure leaves the current selection intact. Never navigate on false/ok:false.
   if(navigation)throw new Error('正在切换研究，请等待当前操作完成');
   const sequence=++loadSequence;navigation=true;
   try{
    await flush();
    const loaded=await request({method:'GET',researchId,runId});
    if(sequence!==loadSequence)return false;
    if(!loaded?.ok)throw new Error(loaded?.error||'研究读取失败');
    context.select({userId:loaded.userId,...loaded.run});
    selected=clone(loaded);generation++;failed=false;
    if(onState)onState(clone(selected));return clone(selected);
   }finally{navigation=false;}
  }
  function save(state){
   if(navigation)return Promise.reject(new Error('正在切换研究，未提交新修改'));
   if(uncertainTransition)return Promise.reject(new Error('上次状态操作结果未确认，请先重试同一操作'));
   if(!selected)return Promise.reject(new Error('尚未打开研究'));
   if(selected.study.status!=='active'||selected.run.status!=='active'||selected.study.role==='viewer')return Promise.reject(new Error('当前轮次为只读'));
   const snapshot=clone(state),identity=context.capture('autosave'),scope=generation;
   const work=pending.catch(()=>{}).then(async()=>{
    if(scope!==generation||!context.accepts(identity))throw new Error('研究已切换，未提交旧内容');
    // A previous transport failure does not destroy the local retry snapshot.
    const wasFailed=failed;failed=false;
    try{ensureEditable();}catch(error){failed=wasFailed;throw error;}
    try{
     async function submit(envelope,retried=false){
       async function reconcileVersion(errorText){
        if(retried||!/已有更新/.test(errorText||''))return false;
        const latest=await request({method:'GET',researchId:identity.researchId,runId:identity.runId});
        if(scope!==generation||!context.accepts(identity))throw new Error('研究已切换，未提交旧内容');
        const sameIdentity=latest?.ok&&latest.userId===selected.userId&&latest.run?.researchId===identity.researchId&&latest.run?.runId===identity.runId&&latest.run?.epoch===identity.epoch&&latest.study?.status==='active'&&latest.run?.status==='active'&&latest.study?.role!=='viewer';
        // Only reconcile an identical server snapshot. Never merge different reports
        // or drop version/permission checks to make navigation appear successful.
        if(!sameIdentity||(canonical(latest.run.state)!==canonical(selected.run.state)&&canonical(latest.run.state)!==canonical(envelope.state)))return false;
        if(!context.acceptVersion(identity,{...latest.run,acceptedVersion:latest.run.version}))throw new Error('研究保存版本核对失败');
        selected.run.version=latest.run.version;selected.run.state=clone(latest.run.state);
        if(latest.run.storedObjects)selected.run.storedObjects=clone(latest.run.storedObjects);
        if(canonical(latest.run.state)!==canonical(envelope.state))await submit({token:context.capture('autosave'),state:envelope.state},true);
        return true;
       }
       if(selected.storageProtocol==='parts-v1'&&!envelope.wire){
       const {packState}=await import('./research-state-codec.mjs?v=20260910.capacity128');
       const packed=await packState(envelope.state,contentHashCache),known=new Set(selected.run.storedObjects||[]);
       envelope.objectIds=[...packed.objects.keys()];
       envelope.wire={packed:{manifest:packed.manifest,objects:[...packed.objects].filter(([id])=>!known.has(id))}};
       if(scope!==generation||!context.accepts(identity))throw new Error('研究已切换，未提交旧内容');
      }
      uncertain=envelope;
      if(selected.storageUploadBatchBytes&&envelope.wire?.packed?.objects?.length){
       const remaining=envelope.wire.packed.objects;
       // Keep completed batches in the envelope across a transport retry. An
       // ambiguous batch is safe to repeat because server blocks are immutable.
       while(remaining.length){
        let size=2,count=0;
        while(count<remaining.length){const next=new TextEncoder().encode(JSON.stringify(remaining[count])).length+1;if(count&&size+next>selected.storageUploadBatchBytes)break;size+=next;count++;}
         if(scope!==generation||!context.accepts(identity))throw new Error('研究已切换，未上传旧内容');
         const staged=await request({method:'POST',action:'stageObjects',...envelope.token,objects:remaining.slice(0,count)});
         if(!staged?.ok){
          uncertain=null;
          if(await reconcileVersion(staged?.error))return;
          throw new Error(staged?.error||'资料分批保存未完成，请重试保存');
         }
        remaining.splice(0,count);
       }
      }
      const result=await request({method:'POST',action:'save',...envelope.token,...(envelope.wire||{state:envelope.state})});
      // An HTTP response is definitive; a transport exception is ambiguous and
      // must replay exactly the same request before allocating a new version.
      uncertain=null;
      if(!result?.ok){
       if(await reconcileVersion(result?.error))return;
       throw new Error(result?.error||'研究保存失败');
      }
      if(!context.acceptVersion(envelope.token,result))throw new Error('保存回执不属于当前轮次');
      selected.run.state=envelope.state;selected.run.version=result.acceptedVersion;
      if(envelope.objectIds)selected.run.storedObjects=envelope.objectIds;
     }
     const replay=uncertain;
     if(replay)await submit(replay);
     if(!replay||JSON.stringify(replay.state)!==JSON.stringify(snapshot))await submit({token:context.capture('autosave'),state:snapshot});
     failed=false;
     return true;
    }catch(error){failed=true;onError(error);throw error;}
   });
   pending=work;return work;
  }
  async function recover(reviewed,state){
   if(navigation||uncertainTransition)throw new Error('正在处理研究，请稍后重试');
   const scope=generation, identity=context.capture('autosave');
   await pending.catch(()=>{});
   const latest=await request({method:'GET',researchId:identity.researchId,runId:identity.runId});
   if(scope!==generation||!context.accepts(identity)||!latest?.ok||latest.userId!==identity.userId||latest.run?.researchId!==identity.researchId||latest.run?.runId!==identity.runId||latest.run?.epoch!==identity.epoch||latest.study?.status!=='active'||latest.study?.role==='viewer'||latest.run?.status!=='active')throw new Error('研究身份、权限或轮次已变化，未处理冲突');
   if(latest.run.version!==reviewed.run.version||canonical(latest.run.state)!==canonical(reviewed.run.state))throw new Error('服务器又有更新，请重新核对；两份备份仍保留');
   if(!context.acceptVersion(identity,{...latest.run,acceptedVersion:latest.run.version}))throw new Error('版本核对失败');
   selected=clone(latest);failed=false;uncertain=null;
   await save(state);return true;
  }
  async function flush(){await pending;if(failed)throw new Error('研究尚未保存成功，未切换页面');return true;}
  async function execute(chain,produce,apply){
   if(navigation)throw new Error('正在切换研究，未启动任务');
   ensureEditable();
   const token=context.capture(chain);
   const result=await produce(token);
   if(navigation||!context.accepts(token))return {accepted:false,reason:'stale'};
   ensureEditable();
   // Consumers are synchronous; any subsequent asynchronous task must capture
   // its own identity, rather than hold a mutable reference to the selection.
   const applied=apply(result,token);
   if(applied&&typeof applied.then==='function')throw new Error('研究结果应用必须同步完成');
   return {accepted:true,value:applied};
  }
  async function transition(action,options={}){
   if(!selected)throw new Error('尚未打开研究');
   if(navigation)throw new Error('研究状态正在更新，请勿重复操作');
   if(uncertainTransition&&(uncertainTransition.action!==action||uncertainTransition.mode!==options.mode))throw new Error('请重试上次未确认的同一状态操作');
   navigation=true;
   try{
    await flush();
    const retrying=Boolean(uncertainTransition);
    const envelope=uncertainTransition||{...context.capture('autosave'),action,mode:options.mode,expectedVersion:action==='restart'?selected.run.version:selected.study.version};
    // Keep only the non-secret identity for ambiguous transport retries. Password
    // must be supplied again by the caller; never persist it in session state.
    uncertainTransition=envelope;
    const result=await request({...options,...envelope,method:'POST'});
    if(!result?.ok){if(!retrying)uncertainTransition=null;throw new Error(result?.error||'研究状态操作失败');}
    uncertainTransition=null;
    // Invalidate late callbacks as soon as the server accepts the transition.
    generation++;context.clear();selected=null;
    return result;
   }finally{navigation=false;}
  }
  function capture(chain){
   if(navigation||uncertainTransition)throw new Error('研究正在切换或状态尚未确认');
   if(chain!=='export')ensureEditable();
   if(!selected)throw new Error('尚未打开研究');
   return context.capture(chain);
  }
  function accepts(token){return !navigation&&!uncertainTransition&&context.accepts(token);}
  async function refreshAuthority(token){
   if(!accepts(token))throw new Error('研究轮次已改变，请重新操作');
   const latest=await request({method:'GET',action:'authority',researchId:token.researchId,runId:token.runId});
   if(!accepts(token)||!latest?.ok||latest.userId!==token.userId||latest.run?.researchId!==token.researchId||latest.run?.runId!==token.runId||latest.run?.epoch!==token.epoch||latest.study?.status!=='active'||(token.chain!=='export'&&(latest.run.status!=='active'||latest.study.role==='viewer'))){
    // Do not overwrite local unsaved contents while checking another tab's action.
    throw new Error(latest?.error||'研究权限或轮次状态已改变，请保留内容并刷新');
   }
   return true;
  }
  return Object.freeze({open,save,recover,flush,execute,transition,capture,accepts,refreshAuthority,
   stateMetadata:()=>selected?clone(Object.fromEntries(Object.entries(selected.run.state||{}).filter(([key])=>key!=='draft'&&key!=='aiReport'))):{},
   current:()=>selected?clone(selected):null,
   // Permission checks must not clone the complete report on every rendered field.
   identity:()=>selected?{userId:selected.userId,study:clone(selected.study),run:{researchId:selected.run.researchId,runId:selected.run.runId,version:selected.run.version,epoch:selected.run.epoch,status:selected.run.status,ordinal:selected.run.ordinal}}:null,
   invalidate(){loadSequence++;generation++;context.clear();selected=null;uncertain=null;},
   localKey:()=>context.localKey()
  });
 }
 const api=Object.freeze({create});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ResearchSession=api;
})(typeof globalThis!=='undefined'?globalThis:this);
