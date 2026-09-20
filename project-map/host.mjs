import {publicSnapshot} from './core.mjs';
import {fetchPortfolio} from './portfolio-ui.mjs';
let active=null;
export function openMap(project,headers,options={}){
  if(active){active.focus();return;}
  const snapshot=publicSnapshot(project),key=crypto.randomUUID(),abort=new AbortController(),prior=document.activeElement;
  const dialog=document.createElement('dialog');active=dialog;
  dialog.style.cssText='padding:0;border:1px solid #c7d9e7;border-radius:12px;width:96vw;max-width:1800px;height:94dvh;max-height:94dvh;overflow:hidden';
  const frame=document.createElement('iframe');frame.title='深圳项目地图';frame.style.cssText='width:100%;height:100%;border:0';frame.src='/project-map/index.html';dialog.append(frame);document.body.append(dialog);
  const send=data=>frame.contentWindow?.postMessage({version:1,key,...data},location.origin);
  frame.onload=()=>send({type:'init',project:snapshot,facilities:options.facilities===true});
  const onMessage=async e=>{
    const d=e.data;if(e.origin!==location.origin||e.source!==frame.contentWindow||d?.version!==1||d.key!==key)return;
  if(d.type==='close'){dialog.close();return;}
  if(d.type==='map-request'&&Number.isInteger(d.id)&&['ledger','portfolio','around','rentals'].includes(d.action)){
   try{
    if(d.action==='portfolio'){const items=(await fetchPortfolio(headers,AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]))).filter(p=>!p.archived);if(active===dialog)send({type:'map-response',id:d.id,data:{items}});return;}
    const response=await fetch(d.action==='ledger'?'/api/projects':d.action==='rentals'?'/api/maprentals':'/api/poi',{method:d.action==='ledger'?'GET':'POST',headers:{...headers(),'Content-Type':'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]),...(d.action==='around'?{body:JSON.stringify({action:'mapAround',location:d.location,radius:d.radius,category:d.category})}:d.action==='rentals'?{body:JSON.stringify(d.rental)}:{})});
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'地图请求失败');
    const data=d.action==='ledger'?{items:(result.list||[]).map(p=>({id:p.id,name:p.name,address:p.location,type:p.type,stage:p.stage,source:'正式项目库（只读）'}))}:result;
    if(active===dialog)send({type:'map-response',id:d.id,data});
   }catch(error){if(!abort.signal.aborted)send({type:'map-response',id:d.id,error:error instanceof TypeError?'网络连接失败，请重试':error.message});}return;
  }
    if(d.type!=='search'||typeof d.query!=='string'||!Number.isInteger(d.id))return;
    try{
      const response=await fetch('/api/poi',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(24000)]),body:JSON.stringify({action:'search',address:d.query.slice(0,100)})});
      const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'位置搜索暂不可用');
      if(active===dialog)send({type:'search-result',id:d.id,candidates:(result.candidates||[]).slice(0,15).map(c=>({name:String(c.name||''),location:c.location,address:String(c.address||'')}))});
    }catch(error){if(!abort.signal.aborted)send({type:'search-result',id:d.id,error:error.name==='TimeoutError'?'搜索超时，请稍后重试':error instanceof TypeError?'网络连接失败，请检查服务后重试':error.message});}
  };
  window.addEventListener('message',onMessage);
  dialog.addEventListener('cancel',event=>{event.preventDefault();send({type:'request-close'});});
  dialog.addEventListener('close',()=>{abort.abort();window.removeEventListener('message',onMessage);frame.src='about:blank';dialog.remove();active=null;prior?.focus();},{once:true});
  dialog.showModal();
}
