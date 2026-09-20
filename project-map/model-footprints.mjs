import {landmarkCoordinate} from './core.mjs';
// Display-only suppression of the author's replacement footprints. Never alter GIS data.
export function replacementFilter(catalog,detail){
 const coordinates=detail.collisionFootprints.map(f=>{
  const ring=f.rings[0],cx=ring.reduce((s,p)=>s+p[0],0)/ring.length,cz=ring.reduce((s,p)=>s+p[1],0)/ring.length;
  // Small tolerance for independently simplified map tiles; ignore courtyards for containment.
  return [ring.map(([x,z])=>landmarkCoordinate({x:cx+(x-cx)*1.08,z:cz+(z-cz)*1.08},catalog))];
 });
 for(const item of catalog.landmarks.filter(i=>i.excludeRadius>0&&catalog.modelIds.includes(i.id))){
  const ring=Array.from({length:33},(_,n)=>landmarkCoordinate({x:item.x+item.excludeRadius*Math.cos(n*Math.PI/16),z:item.z+item.excludeRadius*Math.sin(n*Math.PI/16)},catalog));coordinates.push([ring]);
 }
 return ['all',['!=',['get','hide_3d'],true],['>', ['distance',{type:'MultiPolygon',coordinates}],0]];
}
