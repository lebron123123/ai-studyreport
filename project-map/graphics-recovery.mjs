// One rebuild per viewing session. Repeated device loss must not create a loop.
export function createGraphicsRecovery(rebuild, notify) {
 let attempted=false, running=false;
 return async function recover(isCurrent) {
  if(!isCurrent()||running)return false;
  if(attempted){notify('图形设备再次中断，已停止自动重建。请返回二维地图，或手动重新加载。',true);return false;}
  attempted=true;running=true;
  try {await rebuild(isCurrent);return true;}
  catch {if(isCurrent())notify('三维场景重建失败，请手动重新加载或返回二维地图。',true);return false;}
  finally {running=false;}
 };
}
