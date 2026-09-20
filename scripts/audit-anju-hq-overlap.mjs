// Read-only audit: never modify the author's merged city assets.
import fs from 'node:fs';
import {buildHQGeometry} from '../project-map/anju-hq-geometry.mjs';
const catalog=JSON.parse(fs.readFileSync('project-map/models/catalog.json','utf8'));
const hq=buildHQGeometry(catalog);
const inside=(x,z,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const result=[],components=[];
for(const key of ['-8_-1','-9_-1']){
 const file=`project-map/city-stream-v1/buildings-${key}-fine.glb`,buf=fs.readFileSync(file),len=buf.readUInt32LE(12),g=JSON.parse(buf.subarray(20,20+len)),bin=buf.subarray(28+len);
 function read(id,index){const a=g.accessors[id],v=g.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[a.type],size={5122:2,5123:2,5125:4,5126:4}[a.componentType];if(!size||!n)throw Error('Unsupported accessor');const start=(v.byteOffset||0)+(a.byteOffset||0)+index*(v.byteStride||n*size);return Array.from({length:n},(_,d)=>{const p=start+d*size;return a.componentType===5122?bin.readInt16LE(p)/(a.normalized?32767:1):a.componentType===5123?bin.readUInt16LE(p):a.componentType===5125?bin.readUInt32LE(p):bin.readFloatLE(p);});}
 for(const node of g.nodes){if(node.rotation||node.matrix)throw Error('Audit needs transformed node support');for(const p of g.meshes[node.mesh].primitives){
  const points=Array.from({length:g.accessors[p.attributes.POSITION].count},(_,i)=>read(p.attributes.POSITION,i).map((n,d)=>(n*(node.scale?.[d]??1)+(node.translation?.[d]??0))*(d===2?-1:1)));
  // Weld duplicate face vertices only for topology inspection, never editing.
  const parents=points.map((_,i)=>i),weld=new Map(),root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;},join=(a,b)=>{parents[root(a)]=root(b);};
  for(let i=0;i<points.length;i++){const k=points[i].map(v=>Math.round(v*1000)).join(',');if(weld.has(k))join(i,weld.get(k));else weld.set(k,i);}
  for(let i=0;i<g.accessors[p.indices].count;i+=3){const ids=[0,1,2].map(d=>read(p.indices,i+d)[0]);join(ids[0],ids[1]);join(ids[1],ids[2]);}
  const groups=new Map();for(let i=0;i<points.length;i++){const id=root(i);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(points[i]);}
  for(const group of groups.values()){
   const bounds=[0,1,2].map(d=>[Math.min(...group.map(v=>v[d])),Math.max(...group.map(v=>v[d]))]);
   const center=[(bounds[0][0]+bounds[0][1])/2-hq.anchor.x,(bounds[2][0]+bounds[2][1])/2-hq.anchor.z];
   const hosts=hq.bodies.filter(body=>inside(...center,body.ring)).map(body=>body.id);
   if(hosts.length)components.push({key,node:node.name,vertices:group.length,hosts,bounds});
  }
  for(const body of hq.bodies){let triangles=0,minY=Infinity,maxY=-Infinity;for(let i=0;i<g.accessors[p.indices].count;i+=3){const tri=[0,1,2].map(d=>points[read(p.indices,i+d)[0]]),x=tri.reduce((s,v)=>s+v[0],0)/3-hq.anchor.x,z=tri.reduce((s,v)=>s+v[2],0)/3-hq.anchor.z;if(!inside(x,z,body.ring))continue;triangles++;for(const v of tri){minY=Math.min(minY,v[1]);maxY=Math.max(maxY,v[1]);}}if(triangles)result.push({key,node:node.name,body:body.id,triangles,minHeightMeters:minY/catalog.scale,maxHeightMeters:maxY/catalog.scale});}
 }}
}
console.log(JSON.stringify({policy:'Centroid/topology overlap audit only; NOT authorization to delete geometry',result,components},null,2));
