// Merge identical-material coarse primitives in a common ENU frame, preserving
// every vertex's ECEF location. No height or geometry invention, no source edits.
const fs=require('node:fs');const root='project-map/baoan-lod-v2/';
for(const layer of ['known','estimated']){
 const manifest=JSON.parse(fs.readFileSync(root+layer+'.json')),partitions=new Map(),children=[];let totalBytes=0;
 for(const tile of manifest.root.children){const key=tile.content.uri.split('/').at(-1).split('-'+layer)[0],xy=key.split('_').map(Number),group=xy.map(n=>Math.floor(n/4)).join('_');if(!partitions.has(group))partitions.set(group,[]);partitions.get(group).push(tile);}
 for(const [partition,tiles] of partitions){
 const origin=tiles[0].transform;
 const groups=new Map();let materials;
 const project=(x,y,z,m,normal=false)=>{const dx=m[0]*x-m[4]*z+m[8]*y+(normal?0:m[12]-origin[12]),dy=m[1]*x-m[5]*z+m[9]*y+(normal?0:m[13]-origin[13]),dz=m[2]*x-m[6]*z+m[10]*y+(normal?0:m[14]-origin[14]);return [origin[0]*dx+origin[1]*dy+origin[2]*dz,origin[8]*dx+origin[9]*dy+origin[10]*dz,-origin[4]*dx-origin[5]*dy-origin[6]*dz];};
 for(const tile of tiles){
  const b=fs.readFileSync(root+tile.content.uri),length=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+length)),start=28+length;materials=g.materials;
  for(const p of g.meshes[0].primitives){const group=groups.get(p.material)||{position:[],normal:[]};groups.set(p.material,group);
   for(const [attribute,key] of [['POSITION','position'],['NORMAL','normal']]){const a=g.accessors[p.attributes[attribute]],v=g.bufferViews[a.bufferView];const source=new Float32Array(b.buffer,b.byteOffset+start+v.byteOffset,a.count*3),target=new Float32Array(source.length);
    for(let i=0;i<source.length;i+=3)target.set(project(source[i],source[i+1],source[i+2],tile.transform,key==='normal'),i);
    group[key].push(Buffer.from(target.buffer));
   }
  }
 }
 const buffers=[],views=[],accessors=[],primitives=[];let offset=0;
 function attribute(parts){const buffer=Buffer.concat(parts),values=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.length/4);const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++){const d=i%3;min[d]=Math.min(min[d],values[i]);max[d]=Math.max(max[d],values[i]);}views.push({buffer:0,byteOffset:offset,byteLength:buffer.length,target:34962});offset+=buffer.length;buffers.push(buffer);accessors.push({bufferView:views.length-1,componentType:5126,count:values.length/3,type:'VEC3',min,max});return accessors.length-1;}
 for(const [material,group] of groups)primitives.push({attributes:{POSITION:attribute(group.position),NORMAL:attribute(group.normal)},material});
 const g={asset:{version:'2.0',generator:'Baoan coarse ECEF-preserving batch merge'},buffers:[{byteLength:offset}],bufferViews:views,accessors,materials,meshes:[{primitives}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};let json=Buffer.from(JSON.stringify(g));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(buffers),header=Buffer.alloc(20),chunk=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);chunk.writeUInt32LE(bin.length);chunk.writeUInt32LE(0x004e4942,4);
 const name='mesh/overview-'+layer+'-'+partition+'.glb';fs.writeFileSync(root+name,Buffer.concat([header,json,chunk,bin]));totalBytes+=28+json.length+bin.length;
 const regions=tiles.map(t=>t.boundingVolume.region),region=[0,1,2,3,4,5].map(i=>(i===0||i===1||i===4?Math.min:Math.max)(...regions.map(r=>r[i])));
 children.push({boundingVolume:{region},transform:origin,geometricError:0,content:{uri:name},extras:{sourceTiles:tiles.map(t=>t.content.uri)}});
 }
 // Spatial batches keep offscreen culling. One whole-district GLB increased
 // rendered geometry and did not improve measured FPS on the target laptop.
 fs.writeFileSync(root+'overview-'+layer+'.json',JSON.stringify({asset:{version:'1.1'},geometricError:100000,root:{boundingVolume:manifest.root.boundingVolume,geometricError:100000,children}}));console.log(JSON.stringify({layer,bytes:totalBytes,spatialBatches:children.length}));
}
