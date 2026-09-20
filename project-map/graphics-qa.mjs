// Local opt-in acceptance UI. No user records or browser storage are touched.
export function attachGraphicsQA({getScene,enter,leave,places}){
 if(!['localhost','127.0.0.1'].includes(location.hostname)||new URLSearchParams(location.search).get('graphicsQA')!=='1')return;
 const panel=document.createElement('details');panel.open=true;panel.style.cssText='position:fixed;bottom:8px;right:8px;z-index:100;width:320px;max-height:45vh;overflow:auto;background:white;padding:10px;border:1px solid #567';
 const title=document.createElement('summary');title.textContent='本机图形验收（非生产容量认证）';panel.append(title);
 const output=document.createElement('pre');output.style.cssText='white-space:pre-wrap;font-size:12px';
 const report={started:null,samples:[],events:[],errors:[]};let running=false,timer;
 function show(message){output.textContent=message+'\n'+JSON.stringify({samples:report.samples.length,events:report.events,errors:report.errors.slice(-5)},null,2);}
 function button(name,action){const el=document.createElement('button');el.textContent=name;el.onclick=()=>Promise.resolve().then(action).catch(e=>{report.errors.push(String(e));show('未通过：'+e.message);});panel.append(el);}
 window.addEventListener('error',e=>{report.errors.push(e.message);});
 window.addEventListener('unhandledrejection',e=>{report.errors.push(String(e.reason));});
 document.addEventListener('webglcontextlost',()=>report.events.push({type:'lost',at:Date.now()}),true);
 document.addEventListener('webglcontextrestored',()=>report.events.push({type:'restored',at:Date.now()}),true);
 button('受控上下文丢失与恢复',()=>{const canvas=document.querySelector('#map canvas');const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');const ext=gl?.getExtension('WEBGL_lose_context');if(!getScene()||!ext)throw Error('请先进入三维；当前设备未提供受控恢复扩展');report.events.push({type:'controlled-request',at:Date.now()});ext.loseContext();setTimeout(()=>ext.restoreContext(),1500);show('已请求真实 WebGL 上下文丢失；这不是物理驱动重置测试。');});
 button('5 次进出复验',async()=>{if(running)return;running=true;try{for(let i=0;i<5;i++){const scene=await enter();if(!scene)throw Error('三维入口未返回场景');await scene.ready;await leave();report.events.push({type:'exit-cycle',cycle:i+1,at:Date.now()});show('进出 '+(i+1)+'/5');}show('进出结束，请同时核对控制台及系统日志。');}finally{running=false;}});
 button('开始 60 分钟跨区巡检',async()=>{if(running)return;running=true;report.started=Date.now();const scene=await enter();if(!scene){running=false;throw Error('三维未就绪');}await scene.ready;let step=0;timer=setInterval(()=>{try{const current=getScene();if(!current)throw Error('三维实例不存在');const elapsed=Date.now()-report.started;const list=places();if(step%6===0&&list.length)current.focus(list[Math.floor(step/6)%list.length]);current.orbit();report.samples.push({at:Date.now(),elapsed,hidden:document.hidden,...current.stats,heap:performance.memory?.usedJSHeapSize??null});step++;show('持续巡检 '+(elapsed/60000).toFixed(1)+'/60 分钟（保持页面可见）');if(elapsed>=3600000){clearInterval(timer);running=false;current.stop();show('60 分钟采样结束：须核对错误、隐藏时段、帧数及系统驱动日志后判定。');}}catch(e){clearInterval(timer);running=false;report.errors.push(String(e));show('巡检中断：'+e.message);}},10000);show('巡检开始');});
 button('停止巡检',()=>{clearInterval(timer);running=false;getScene()?.stop();show('已停止，未满 60 分钟不得通过');});
 button('导出验收记录',()=>{
  // Keep an accessible copy: some embedded browsers do not expose blob downloads.
  let copy=panel.querySelector('textarea');
  if(!copy){copy=document.createElement('textarea');copy.readOnly=true;copy.setAttribute('aria-label','完整图形验收记录 JSON');copy.style.cssText='width:100%;height:160px';panel.append(copy);}
  copy.value=JSON.stringify(report,null,2);
  const url=URL.createObjectURL(new Blob([copy.value],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='graphics-acceptance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 panel.append(output);document.body.append(panel);show('等待实测');
}
