const panel=document.querySelector('#search-panel'),body=document.querySelector('#panel-body'),toggle=document.querySelector('#panel-toggle'),handle=document.querySelector('#panel-resize');
let expandedHeight=480,start=null;
function resize(height){expandedHeight=Math.max(180,Math.min(height,panel.parentElement.clientHeight-24));panel.style.height=expandedHeight+'px';}
toggle.onclick=()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'收起 −':'展开 ＋';body.hidden=!open;handle.hidden=!open;panel.classList.toggle('collapsed',!open);panel.style.height=open?expandedHeight+'px':'auto';};
handle.onpointerdown=e=>{start={y:e.clientY,height:panel.offsetHeight};handle.setPointerCapture(e.pointerId);e.preventDefault();};
handle.onpointermove=e=>{if(start)resize(start.height+e.clientY-start.y);};
handle.onpointerup=handle.onpointercancel=()=>{start=null;};
handle.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resize(panel.offsetHeight+(e.key==='ArrowUp'?-30:30));}};
document.querySelector('#query').addEventListener('input',e=>{const field=document.querySelector('#landmark-query');field.value=e.target.value;field.dispatchEvent(new Event('input'));});
