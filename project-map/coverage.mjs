import {landmarkCoordinate} from './core.mjs';

// Model block extents, not administrative boundaries or surveyed completeness.
export function coverageFeatures(catalog){
 const rect=(bounds,properties)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]],[bounds[0],bounds[1]]]]}});
 return {type:'FeatureCollection',features:[
  ...(catalog.originalTiles||[]).map(t=>rect([...landmarkCoordinate({x:t.bounds[0],z:t.bounds[1]},catalog),...landmarkCoordinate({x:t.bounds[2],z:t.bounds[3]},catalog)],{name:'原作者精细场景',kind:'original'})),
  ...(catalog.baoanTiles||[]).filter(t=>t.count>0).map(t=>rect(t.bounds,{name:t.districtName||'宝安',kind:'derived',count:t.count,known:t.known}))
 ]};
}
// Dissolve rectangle interiors; retain disconnected islands and genuine holes.
export function coverageOutline(catalog){
 const features=coverageFeatures(catalog).features, result=[];
 for(const kind of ['original','derived']){
  const rects=features.filter(f=>f.properties.kind===kind).map(f=>{const p=f.geometry.coordinates[0];return [...p[0],...p[2]].map(n=>Number(n.toFixed(7)));});
  if(!rects.length)continue;
  const xs=[...new Set(rects.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b),ys=[...new Set(rects.flatMap(r=>[r[1],r[3]]))].sort((a,b)=>a-b);
  const xi=new Map(xs.map((v,i)=>[v,i])),yi=new Map(ys.map((v,i)=>[v,i])),cells=new Set(),key=(x,y)=>x*ys.length+y;
  for(const r of rects)for(let x=xi.get(r[0]);x<xi.get(r[2]);x++)for(let y=yi.get(r[1]);y<yi.get(r[3]);y++)cells.add(key(x,y));
  const lines=[];
  for(const cell of cells){const x=Math.floor(cell/ys.length),y=cell%ys.length;
   if(x===0||!cells.has(key(x-1,y)))lines.push([[xs[x],ys[y]],[xs[x],ys[y+1]]]);
   if(!cells.has(key(x+1,y)))lines.push([[xs[x+1],ys[y]],[xs[x+1],ys[y+1]]]);
   if(y===0||!cells.has(key(x,y-1)))lines.push([[xs[x],ys[y]],[xs[x+1],ys[y]]]);
   if(!cells.has(key(x,y+1)))lines.push([[xs[x],ys[y+1]],[xs[x+1],ys[y+1]]]);
  }
  result.push({type:'Feature',properties:{kind},geometry:{type:'MultiLineString',coordinates:lines}});
 }
 return {type:'FeatureCollection',features:result};
}
export function showCoverage(map,catalog,visible){
 if(!map?.isStyleLoaded()||!catalog)return;
 const data=coverageOutline(catalog);
 if(map.getSource('model-coverage'))map.getSource('model-coverage').setData(data);
 else{
  map.addSource('model-coverage',{type:'geojson',data});
  map.addLayer({id:'model-coverage-line',type:'line',source:'model-coverage',paint:{'line-color':['match',['get','kind'],'original','#8644a9','#087881'],'line-width':2}});
 }
 map.setLayoutProperty('model-coverage-line','visibility',visible?'visible':'none');
}
