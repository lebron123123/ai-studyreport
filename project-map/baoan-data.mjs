export function heightInfo(tags={}) {
 const number=value=>/^\d+(\.\d+)?\s*(m)?$/.test(String(value??'').trim())?parseFloat(value):NaN;
 const height=number(tags.height),levels=number(tags['building:levels']);
 if(height>0&&height<=1000)return {height,kind:'tag',label:'OSM高度标注，未测绘核实'};
 if(levels>0&&levels<=200)return {height:levels*3,kind:'levels',label:`${levels}层 × 3米（估算）`};
 return {height:0,kind:'unknown',label:'缺少可用高度；仅展示轮廓'};
}
export function nearestTiles(tiles,point,limit=2){
 if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))throw Error('Invalid coordinate');
 return tiles.map(t=>({t,d:Math.hypot((t.center[0]-point[0])*Math.cos(point[1]*Math.PI/180),t.center[1]-point[1])})).filter(x=>x.d<0.025).sort((a,b)=>a.d-b.d).slice(0,limit).map(x=>x.t);
}
