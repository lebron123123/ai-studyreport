import {facilityStyles} from './facility-markers.mjs';

// Change text only: mixed icon/text layers keep their icons and roads.
export function applyBaseNames(map, mode, originals){
 for(const layer of map.getStyle()?.layers||[]){
  if(layer.type!=='symbol'||!layer.layout?.['text-field'])continue;
  if(!originals.has(layer.id))originals.set(layer.id,map.getPaintProperty(layer.id,'text-opacity')??1);
  map.setPaintProperty(layer.id,'text-opacity',mode==='all'?originals.get(layer.id):0);
 }
}
export function createMapNames(){
 let map=null,host=null,mode='all',points=[],originals=new Map();
 function draw(){
  if(!host)return;host.replaceChildren();if(mode==='none')return;
  const boxes=[],width=map.getContainer().clientWidth,height=map.getContainer().clientHeight;
  for(const feature of points){
   const p=feature.properties,style=facilityStyles[p.category];if(!style||!p.name)continue;
   const xy=map.project(feature.geometry.coordinates),x=xy.x+12,y=xy.y-9;
   if(x<0||y<0||x>width-30||y>height-20)continue;
   const node=document.createElement('span');node.textContent=p.name;
   node.style.cssText=`position:absolute;left:${x}px;top:${y}px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/20px system-ui,"Microsoft YaHei",sans-serif;color:${style.color};background:rgba(255,255,255,.9);border-radius:3px;padding:0 3px;text-shadow:0 1px white;`;
   host.append(node);const box={x,y,w:node.offsetWidth,h:22};
   if(boxes.some(b=>x<b.x+b.w+5&&x+box.w+5>b.x&&y<b.y+b.h&&y+box.h>b.y)){node.remove();continue;}
   boxes.push(box);if(boxes.length>=80)break;
  }
 }
 function detach(){if(map){map.off('moveend',draw);map.off('movestart',hide);map.off('resize',draw);}host?.remove();map=null;host=null;originals=new Map();}
 function hide(){host?.replaceChildren();}
 return {
  attach(instance){if(map===instance){applyBaseNames(map,mode,originals);draw();return;}detach();map=instance;host=document.createElement('div');host.setAttribute('aria-label','配套名称');host.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';map.getContainer().append(host);map.on('moveend',draw);map.on('movestart',hide);map.on('resize',draw);applyBaseNames(map,mode,originals);draw();},
  update(features){points=features.filter(f=>f.properties?.kind==='facility');draw();},
  setMode(value){mode=['all','important','none'].includes(value)?value:'all';if(map){applyBaseNames(map,mode,originals);draw();}},detach
 };
}
