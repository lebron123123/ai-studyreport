// Read-only GLB audit: largest source triangles and invalid indices.
const fs=require('node:fs');
const decoder=require('../project-map/vendor/meshopt_decoder.js');
(async()=>{
 await decoder.ready;
 for(const file of process.argv.slice(2)){
  const b=fs.readFileSync(file),len=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+len)),bin=b.subarray(28+len),cache=new Map();
  function view(i){if(cache.has(i))return cache.get(i);const v=g.bufferViews[i],e=v.extensions?.EXT_meshopt_compression;let a;if(e){a=Buffer.alloc(e.count*e.byteStride);decoder.decodeGltfBuffer(a,e.count,e.byteStride,bin.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);}else a=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);cache.set(i,a);return a;}
  const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  function get(i,j,d=0){const a=g.accessors[i],v=g.bufferViews[a.bufferView],buf=view(a.bufferView),off=(a.byteOffset||0)+j*(v.byteStride||sizes[a.componentType]*counts[a.type])+d*sizes[a.componentType];let n;switch(a.componentType){case 5120:n=buf.readInt8(off);break;case 5121:n=buf.readUInt8(off);break;case 5122:n=buf.readInt16LE(off);break;case 5123:n=buf.readUInt16LE(off);break;case 5125:n=buf.readUInt32LE(off);break;case 5126:n=buf.readFloatLE(off);break;}if(a.normalized)n/=({5120:127,5121:255,5122:32767,5123:65535}[a.componentType]||1);return n;}
  let invalid=0,triangles=0;const largest=[];
  for(const node of g.nodes||[]){if(node.mesh==null)continue;for(const p of g.meshes[node.mesh].primitives){if((p.mode??4)!==4||p.attributes.POSITION==null)continue;const a=g.accessors[p.attributes.POSITION],count=p.indices==null?a.count:g.accessors[p.indices].count;for(let i=0;i<count;i+=3){triangles++;const ids=[0,1,2].map(k=>p.indices==null?i+k:get(p.indices,i+k));if(ids.some(n=>n<0||n>=a.count)){invalid++;continue;}const vs=ids.map(id=>[0,1,2].map(d=>get(p.attributes.POSITION,id,d)*(node.scale?.[d]??1)+(node.translation?.[d]??0)));if(vs.flat().some(n=>!Number.isFinite(n))){invalid++;continue;}const edge=Math.max(...[0,1,2].map(k=>Math.hypot(...vs[k].map((v,d)=>v-vs[(k+1)%3][d]))));if(largest.length<4||edge>largest.at(-1).edge){largest.push({mesh:node.name,face:i/3,edge,vs,material:g.materials?.[p.material]?.name});largest.sort((a,b)=>b.edge-a.edge);largest.length=Math.min(largest.length,4);}}}}
  console.log(JSON.stringify({file,triangles,invalid,largest}));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
