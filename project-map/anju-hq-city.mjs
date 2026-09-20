import {buildHQGeometry} from './anju-hq-geometry.mjs';
import {createHQModel} from './anju-hq-model.mjs';

// Only building/facade callers use this filter. Ground, roads and water never do.
// All three vertices must lie in the surveyed-source footprint union (plus a
// sub-metre modelling tolerance). A triangle centroid is deliberately insufficient.
export function createHQFootprintTest(catalog){
 const g=buildHQGeometry(catalog,undefined,{detail:false}),tolerance=.8*catalog.scale;
 const rings=g.bodies.flatMap(b=>[0,-2.55*catalog.scale].map(offset=>b.ring.map(p=>[p[0]+g.anchor.x+offset,p[1]+g.anchor.z])));
 // The author's two HQ blocks use a slightly different longitude scale:
 // audited old A/B walls are 1.53 scene units west at scale .6. Include that
 // measured legacy footprint, not the neighbouring parcel or a broad bbox.
 return (x,y,z)=>y>=-.1&&y<330*catalog.scale&&rings.some(r=>{
  let inside=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++){
   const a=r[j],b=r[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
   if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<=tolerance)return true;
   if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
 });
}
export function filterHQIndices(indices,points,contains){
 const inside=points.map(p=>contains(...p)),kept=[];let removed=0;
 for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];if(inside[a]&&inside[b]&&inside[c])removed++;else kept.push(a,b,c);}
 return {indices:kept,removed};
}
export function createHQCity(scene,catalog,upload,notify){
 const B=globalThis.BABYLON,contains=createHQFootprintTest(catalog);
 let coarse=null,fine=null,dead=false,pending=false,wanted=false,cooldown=0,removed=0;
 const releaseFine=()=>{fine?.dispose();fine=null;coarse?.root.setEnabled(true);};
 let unregister;
 return {
  async init(){
   // Register after the district streams: reclaim their distant detail first.
   // HQ remains evictable under the same shared budget.
   unregister=upload.registerEvictor?.(()=>{releaseFine();cooldown=Date.now()+30000;});
   await upload(()=>{if(dead)return;coarse=createHQModel(B,scene,catalog,{detail:false,withLogo:false});},{label:'总部轮廓',reserve:2*1024*1024,required:true});
  },
  filter(meshes){
   if(!coarse||dead)return;
   for(const mesh of meshes){
    if(mesh.metadata?.hqFiltered||!mesh.getTotalVertices?.())continue;
    mesh.computeWorldMatrix(true);const box=mesh.getBoundingInfo().boundingBox,anchor=coarse.data.anchor;
    if(box.maximumWorld.x<anchor.x-80||box.minimumWorld.x>anchor.x+100||box.maximumWorld.z<anchor.z-80||box.minimumWorld.z>anchor.z+100)continue;
    const pos=mesh.getVerticesData(B.VertexBuffer.PositionKind),indices=mesh.getIndices();if(!pos||!indices)continue;
    const matrix=mesh.getWorldMatrix(),points=[];
    for(let i=0;i<pos.length;i+=3)points.push(B.Vector3.TransformCoordinates(new B.Vector3(pos[i],pos[i+1],pos[i+2]),matrix).asArray());
    const result=filterHQIndices(indices,points,contains);
    if(result.removed){mesh.makeGeometryUnique();mesh.setIndices(result.indices);if(!result.indices.length)mesh.setEnabled(false);removed+=result.removed;}
    mesh.metadata={...mesh.metadata,hqFiltered:true};
   }
  },
  update(camera){
   if(dead||!coarse)return;
   const a=coarse.data.anchor,d=Math.hypot(camera.x-a.x,camera.z-a.z);wanted=d<1400&&camera.y<1500;
   if(!wanted){releaseFine();return;}
   if(fine||pending||Date.now()<cooldown)return;
   pending=true;
   upload(()=>{if(dead||!wanted)return;fine=createHQModel(B,scene,catalog);coarse.root.setEnabled(false);},{label:'总部照片参考精模',reserve:24*1024*1024,wanted:()=>!dead&&wanted})
    .catch(e=>{releaseFine();cooldown=Date.now()+10000;if(!dead)notify('总部细节暂未载入，保留双塔轮廓：'+e.message,true);})
    .finally(()=>{pending=false;});
  },
  get stats(){return {detail:!!fine,removedTriangles:removed};},
  dispose(){dead=true;wanted=false;unregister?.();releaseFine();coarse?.dispose();coarse=null;}
 };
}
