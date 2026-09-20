// Engine auto-restore is disabled. Only this owner may rebuild a lost scene.
export function bindContextLifecycle(canvas,{pause,restore,notify,signal}){
 let lost=false,restoring=false;
 canvas.addEventListener('webglcontextlost',event=>{
  event.preventDefault();lost=true;pause();
  notify('图形设备中断：已停止资源队列与绘制，等待设备恢复；也可返回二维地图。',true);
 },{signal});
 canvas.addEventListener('webglcontextrestored',()=>{
  if(!lost||restoring||signal.aborted)return;
  restoring=true;
  Promise.resolve().then(()=>{if(!signal.aborted)return restore();}).catch(()=>notify('图形重建失败，请返回二维或手动重试。',true));
 },{signal});
}
