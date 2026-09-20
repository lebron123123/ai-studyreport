// Shared, bounded DOM annotations: no meshes, textures, picking or render loop.
export function selectLabels(items, width, height, limit=32) {
 const chosen=[];
 for(const p of [...items].sort((a,b)=>(b.priority||0)-(a.priority||0))) {
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<8||p.y<20||p.x>width-8||p.y>height-8)continue;
  const w=Math.min(210,Math.max(64,p.name.length*13+16)),box=[p.x-w/2,p.y-24,p.x+w/2,p.y+4];
  if(box[0]<0||box[2]>width||chosen.some(q=>box[0]<q.box[2]+8&&box[2]>q.box[0]-8&&box[1]<q.box[3]+8&&box[3]>q.box[1]-8))continue;
  chosen.push({...p,box});if(chosen.length>=limit)break;
 }return chosen;
}
export function createPlaceLabels(container,items,project,onSelect=()=>{},options={}) {
 const layer=document.createElement('div');layer.className='map-place-labels';layer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1';
 const toggle=document.createElement('button');toggle.type='button';toggle.textContent='地名标注：开';toggle.setAttribute('aria-pressed','true');toggle.style.cssText='position:absolute;right:18px;top:80px;z-index:2;background:#17374c;color:white;border:1px solid #8aafc5;border-radius:6px;padding:8px;cursor:pointer';
 container.append(layer,toggle);let enabled=true,last=-Infinity,signature='',pointer=null;
 const hover=options.hover===true;
 if(hover)toggle.textContent='地名提示：悬停';
 const move=e=>{const r=container.getBoundingClientRect();pointer={x:e.clientX-r.left,y:e.clientY-r.top};update(true);};
 const leave=()=>{pointer=null;layer.replaceChildren();signature='';};
 if(hover){container.addEventListener('pointermove',move);container.addEventListener('pointerleave',leave);}
 function update(force=false){if(!enabled)return;const now=performance.now();if(!force&&now-last<180)return;last=now;
  let candidates=items.map(item=>{const p=project(item);return p?{...item,...p}:null;}).filter(Boolean);
  if(hover)candidates=pointer?candidates.map(p=>({...p,d:Math.hypot(p.x-pointer.x,p.y-pointer.y)})).filter(p=>p.d<35).sort((a,b)=>a.d-b.d).slice(0,1):[];
  const visible=selectLabels(candidates,container.clientWidth,container.clientHeight,hover?1:32);
  const next=visible.map(p=>p.id+':'+Math.round(p.x)+','+Math.round(p.y)).join('|');if(next===signature)return;signature=next;
  layer.replaceChildren(...visible.map(p=>{const b=document.createElement('button');b.type='button';b.textContent=p.name;b.title=p.note||p.name;b.dataset.placeId=p.id;b.style.cssText=`position:absolute;left:${p.x}px;top:${p.y}px;transform:translate(-50%,-100%);max-width:210px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#163349df;color:#fff3cd;border:1px solid #7893a5;border-radius:4px;padding:3px 6px;font:12px system-ui;pointer-events:auto;cursor:pointer`;if(hover)b.style.cssText+=';min-height:0;line-height:16px;font:11px "PingFang SC","Noto Sans SC",system-ui,sans-serif;color:#edf8f2;background:#172b29a6;border:0;padding:3px 6px;pointer-events:none;';b.onclick=e=>{e.stopPropagation();onSelect(p);};return b;}));
 }
 toggle.onclick=()=>{enabled=!enabled;toggle.textContent=(hover?'地名提示：':'地名标注：')+(enabled?(hover?'悬停':'开'):'关');toggle.setAttribute('aria-pressed',String(enabled));layer.hidden=!enabled;if(enabled)update(true);};
 return {update,dispose(){container.removeEventListener('pointermove',move);container.removeEventListener('pointerleave',leave);layer.remove();toggle.remove();}};
}
