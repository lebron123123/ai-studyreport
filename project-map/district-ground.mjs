export function validateDistrictGround(data,catalog){
 if(data?.version!==1||data.district!=='luohu'||data.scale!==catalog.scale||JSON.stringify(data.origin)!==JSON.stringify(catalog.origin))throw Error('片区地表坐标不匹配');
 const {positions:p,indices:i}=data;
 if(!Array.isArray(p)||!p.length||p.length%3||!p.every(Number.isFinite)||!Array.isArray(i)||i.length%3||!i.every(v=>Number.isInteger(v)&&v>=0&&v<p.length/3))throw Error('片区地表几何无效');
 return data;
}
export async function loadDistrictGround(scene,catalog,isActive){
 const r=await fetch(new URL('./city-relief-v1/luohu-ground.json',import.meta.url),{signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('罗湖地表 HTTP '+r.status);
 const data=validateDistrictGround(await r.json(),catalog);
 if(!isActive())return;
 const B=globalThis.BABYLON,source=scene.meshes.find(m=>m.name==='terrain_land')?.material;
 if(!source)throw Error('原版地表材质未就绪');
 const mesh=new B.Mesh('luohu-boundary-ground',scene),vertices=new B.VertexData();
 vertices.positions=data.positions;vertices.indices=data.indices;vertices.normals=[];vertices.uvs=[];
 for(let n=0;n<data.positions.length;n+=3)vertices.uvs.push(data.positions[n]/300,data.positions[n+2]/300);
 B.VertexData.ComputeNormals(vertices.positions,vertices.indices,vertices.normals);
 vertices.applyToMesh(mesh);mesh.material=source;mesh.isPickable=false;mesh.freezeWorldMatrix();
 return mesh;
}
