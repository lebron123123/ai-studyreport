// One small, distant envelope per district block; exact footprints stay in streamed GLBs.
import fs from 'node:fs';
import {scenePoint} from '../project-map/core.mjs';
const district=process.argv[2];
if(!['futian','nanshan','luohu'].includes(district))throw Error('Expected district');
const target=`project-map/${district}-lod-v2/overview.glb`;
if(fs.existsSync(target))throw Error('Preserve existing overview');
const catalog={origin:[114.025,22.536],scale:.6},chunks=[],views=[],accessors=[],meshes=[],nodes=[];
let offset=0,features=0;
for(const file of fs.readdirSync(`project-map/${district}-lod-v2/metadata`)){
 const positions=[],normals=[];
 for(const f of JSON.parse(fs.readFileSync(`project-map/${district}-lod-v2/metadata/${file}`))){
  features++;
  const xy=f.geometry.coordinates.flat(Infinity),xs=[],zs=[];
  for(let i=0;i<xy.length;i+=2){const p=scenePoint([xy[i],xy[i+1]],catalog);xs.push(p.x);zs.push(-p.z);}
  const x=Math.min(...xs),X=Math.max(...xs),z=Math.min(...zs),Z=Math.max(...zs),b=(f.base||0)*.6,y=f.kind==='unknown'?.18:Math.max(.18,f.height*.6);
  const v=[[x,b,z],[X,b,z],[X,b,Z],[x,b,Z],[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]];
  const faces=[[[4,7,6,4,6,5],[0,1,0]],...(f.kind==='unknown'?[]:[[[0,4,5,0,5,1],[0,0,-1]],[[1,5,6,1,6,2],[1,0,0]],[[2,6,7,2,7,3],[0,0,1]],[[3,7,4,3,4,0],[-1,0,0]]])];
  for(const [ids,n] of faces)for(const i of ids){positions.push(...v[i]);normals.push(...n);}
 }
 if(!positions.length)continue;
 const ai=accessors.length;
 for(const [data,isPosition] of [[positions,true],[normals,false]]){
  const bytes=Buffer.from(new Float32Array(data).buffer),a={bufferView:views.length,componentType:5126,count:data.length/3,type:'VEC3'};
  if(isPosition){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];data.forEach((n,i)=>{a.min[i%3]=Math.min(a.min[i%3],n);a.max[i%3]=Math.max(a.max[i%3],n);});}
  views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});accessors.push(a);chunks.push(bytes);offset+=bytes.length;
 }
 nodes.push({name:`baoan-overview-${district}:${file.replace('.json','')}`,mesh:meshes.length});
 meshes.push({primitives:[{attributes:{POSITION:ai,NORMAL:ai+1},material:0}]});
}
const g={asset:{version:'2.0',generator:'OSM distant envelopes; not measured heights'},buffers:[{byteLength:offset}],bufferViews:views,accessors,meshes,nodes,scenes:[{nodes:nodes.map((_,i)=>i)}],scene:0,materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.58,.59,.56,1],roughnessFactor:.8,metallicFactor:0}}]};
let j=Buffer.from(JSON.stringify(g));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);
const h=Buffer.alloc(20),c=Buffer.alloc(8);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+offset,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);c.writeUInt32LE(offset);c.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(target,Buffer.concat([h,j,c,...chunks]));console.log(JSON.stringify({district,features,bytes:28+j.length+offset}));
