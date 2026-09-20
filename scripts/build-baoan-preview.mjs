// Derived public OSM data only; never reads project/user records.
import fs from 'node:fs';
import path from 'node:path';
import { heightInfo } from '../project-map/baoan-data.mjs';
const source=path.resolve('outputs/baoan-source/audit');
const destination=path.resolve('project-map/baoan-data');
if(fs.existsSync(destination))throw Error('Preview already exists: preserve previous published data.');
const coverage=JSON.parse(fs.readFileSync(path.join(source,'coverage.json')));
const tiles=[];const files=[];
for(const name of fs.readdirSync(source).filter(n=>n.endsWith('.geojson')&&n!=='boundary.geojson')){
 const data=JSON.parse(fs.readFileSync(path.join(source,name)));let west=180,south=90,east=-180,north=-90,known=0;
 const features=data.features.map(f=>{
  for(const polygon of f.geometry.coordinates)for(const ring of polygon)for(const [lon,lat] of ring){west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);}
  const h=heightInfo(f.properties.tags);if(h.kind!=='unknown')known++;
  return {type:'Feature',id:f.id,geometry:f.geometry,properties:{name:f.properties.tags.name||f.id,...h}};
 });
 const body=JSON.stringify({type:'FeatureCollection',features});files.push([name,body]);
 tiles.push({file:name,center:[(west+east)/2,(south+north)/2],count:features.length,known,bytes:Buffer.byteLength(body)});
}
tiles.sort((a,b)=>b.known-a.known);
fs.mkdirSync(destination);
for(const [name,body] of files)fs.writeFileSync(path.join(destination,name),body);
fs.writeFileSync(path.join(destination,'index.json'),JSON.stringify({coverage,tiles,start:tiles[0].center}));
console.log(JSON.stringify({tiles:tiles.length,features:coverage.features,start:tiles[0],totalBytes:files.reduce((n,f)=>n+Buffer.byteLength(f[1]),0)}));
