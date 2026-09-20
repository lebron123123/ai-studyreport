// Geometry package is served from disk. No browser persistent cache or external fonts.
export function offlineStyle(){return {version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef0e9'}}]};}
export function geometryLayers(id){return [
 {id:id+'-water',type:'fill',source:id,filter:['==','kind','water'],paint:{'fill-color':'#b8dce4'}},
 {id:id+'-park',type:'fill',source:id,filter:['==','kind','park'],paint:{'fill-color':'#ccdfb6'}},
 {id:id+'-building',type:'fill',source:id,filter:['==','kind','building'],paint:{'fill-color':'#c4bfb5','fill-outline-color':'#aaa69e'}},
 {id:id+'-road',type:'line',source:id,filter:['==','kind','road'],paint:{'line-color':'#d5ac79','line-width':['interpolate',['linear'],['zoom'],9,1,17,3]}}
];}
export async function attachOffline(map,report){
 let dead=false;map.once('remove',()=>{dead=true;});
 const base='offline-shenzhen-v1/', response=await fetch(base+'manifest.json');
 if(!response.ok)throw Error('离线底图包未部署，请检查 offline-shenzhen-v1 目录');
 const manifest=await response.json(),available=new Set(manifest.tiles),active=new Set();if(dead)return;
 function add(id,url){map.addSource(id,{type:'geojson',data:url,attribution:'© OpenStreetMap contributors · ODbL · 2026-09-12'});for(const l of geometryLayers(id))map.addLayer(l);}
 add('offline-overview',base+'overview.json');
 function update(){
  if(dead)return;const bounds=map.getBounds(),wanted=[];
  if(map.getZoom()>=12){for(let x=Math.floor(bounds.getWest()*20);x<=Math.floor(bounds.getEast()*20);x++)for(let y=Math.floor(bounds.getSouth()*20);y<=Math.floor(bounds.getNorth()*20);y++){const id=x+'_'+y;if(available.has(id))wanted.push(id);}}
  const center=map.getCenter();wanted.sort((a,b)=>{const dist=id=>{const [x,y]=id.split('_').map(Number);return (x/20+.025-center.lng)**2+(y/20+.025-center.lat)**2;};return dist(a)-dist(b);});
  const keep=new Set(wanted.slice(0,16));
  for(const id of active)if(!keep.has(id)){for(const l of geometryLayers('offline-'+id))map.removeLayer(l.id);map.removeSource('offline-'+id);active.delete(id);}
  for(const id of keep)if(!active.has(id)){add('offline-'+id,base+id+'.json');active.add(id);}
  report('本地离线简版底图 · '+active.size+' 个近景分块；含道路、水域、建筑轮廓，非完整商业底图／法定地块。');
 }
 map.on('moveend',update);map.once('remove',()=>{dead=true;map.off('moveend',update);});update();
}
