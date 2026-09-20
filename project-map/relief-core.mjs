// Coordinates match core.scenePoint: east = x, north = z, city scale = 0.6.
export function validateRelief(manifest,catalog){
 if(manifest?.schema!==1||manifest.scale!==catalog.scale||JSON.stringify(manifest.origin)!==JSON.stringify(catalog.origin))throw Error('地形坐标基准不匹配');
 if(!Number.isFinite(manifest.step)||manifest.step<=0||!Array.isArray(manifest.tiles)||manifest.tiles.length>1000)throw Error('地形清单无效');
 for(const tile of manifest.tiles){
  if(!/^[0-9]+_[0-9]+\.bin$/.test(tile.file)||!Number.isFinite(tile.x0)||!Number.isFinite(tile.z0)||!Number.isInteger(tile.columns)||!Number.isInteger(tile.rows)||tile.columns<2||tile.rows<2||tile.columns>65||tile.rows>65||tile.bytes!==tile.columns*tile.rows*4)throw Error('地形分块无效');
 }
 const o=manifest.overview;
 if(o?.file!=='overview.bin'||!Number.isInteger(o.columns)||!Number.isInteger(o.rows)||o.columns<2||o.rows<2||o.columns*o.rows>1000000||o.step!==manifest.step*4)throw Error('地形概览无效');
 return manifest;
}
export function reliefHeight(grid,heights,x,z){
 const u=(x-grid.x0)/grid.step,v=(z-grid.z0)/grid.step;
 if(u<0||v<0||u>grid.columns-1||v>grid.rows-1)return 0;
 const ix=Math.min(grid.columns-2,Math.floor(u)),iz=Math.min(grid.rows-2,Math.floor(v)),fx=u-ix,fz=v-iz;
 const a=heights[iz*grid.columns+ix],b=heights[iz*grid.columns+ix+1],c=heights[(iz+1)*grid.columns+ix],d=heights[(iz+1)*grid.columns+ix+1];
 return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
}
export function reliefGeometry(grid,heights){
 if(heights.length!==grid.columns*grid.rows||heights.some(v=>!Number.isFinite(v)||v<0||v>2000))throw Error('地形高度数据损坏');
 const positions=[],indices=[],colors=[];
 for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.columns;x++){
  const h=heights[z*grid.columns+x];positions.push(grid.x0+x*grid.step,h,grid.z0+z*grid.step);
  const rock=Math.min(.5,h/800),variation=Math.sin((grid.x0+x*grid.step)*.019)*Math.cos((grid.z0+z*grid.step)*.023)*.025;
  colors.push(.19+rock*.20+variation,.30+rock*.12+variation,.14+rock*.20+variation,1);
 }
 for(let z=0;z<grid.rows-1;z++)for(let x=0;x<grid.columns-1;x++){
  const a=z*grid.columns+x,b=a+1,c=a+grid.columns,d=c+1;
  if(Math.max(heights[a],heights[b],heights[c],heights[d])<.05)continue;
  indices.push(a,c,b,b,c,d);
 }
 return {positions,indices,colors};
}
export function nearestReliefTiles(manifest,position,max=9){
 if(position.y>2000)return [];
 return manifest.tiles.map(tile=>{
  const x1=tile.x0+(tile.columns-1)*manifest.step,z1=tile.z0+(tile.rows-1)*manifest.step;
  return {tile,d:Math.hypot(Math.max(tile.x0-position.x,0,position.x-x1),Math.max(tile.z0-position.z,0,position.z-z1))};
 }).filter(v=>v.d<1800).sort((a,b)=>a.d-b.d).slice(0,max).map(v=>v.tile);
}
