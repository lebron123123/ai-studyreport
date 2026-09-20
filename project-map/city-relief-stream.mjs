import {validateRelief,reliefGeometry,reliefHeight,nearestReliefTiles} from './relief-core.mjs';

export function createCityReliefStream(scene,catalog,notify,upload=task=>task()){
 const B=globalThis.BABYLON,base=new URL('./city-relief-v1/',import.meta.url);
 const fine=new Map(),coarse=new Map(),pending=new Map(),retry=new Map();
 let manifest=null,overview=null,wanted=new Set(),disposed=false,warned=false;
 const lifecycle=new AbortController();
 const material=new B.PBRMaterial('four-district-relief',scene);
 material.metallic=0;material.roughness=.98;material.environmentIntensity=.85;material.maxSimultaneousLights=3;
 async function read(file){
  const response=await fetch(new URL(file,base),{signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(20000)])});
  if(!response.ok)throw Error(`地形资源 HTTP ${response.status}`);
  return response;
 }
 function mesh(grid,heights,name){
  const geometry=reliefGeometry(grid,heights),result=new B.Mesh(name,scene),data=new B.VertexData();
  data.positions=geometry.positions;data.indices=geometry.indices;data.colors=geometry.colors;
  data.normals=[];B.VertexData.ComputeNormals(data.positions,data.indices,data.normals);
  data.applyToMesh(result);result.material=material;result.isPickable=false;result.freezeWorldMatrix();return result;
 }
 function announceError(e){if(!disposed&&!warned){warned=true;notify('山体细节暂未加载，现有城市仍可浏览。请重新进入三维重试：'+e.message,true);}}
 async function init(){
  try{
   manifest=validateRelief(await (await read('manifest.json')).json(),catalog);
   const data=await (await read('overview.bin')).arrayBuffer();if(disposed)return;
   if(data.byteLength!==manifest.overview.columns*manifest.overview.rows*4)throw Error('地形概览长度错误');
   overview=new Float32Array(data);
   for(const tile of manifest.tiles){
    const cx=Math.round((tile.x0-manifest.x0)/manifest.overview.step),rz=Math.round((tile.z0-manifest.z0)/manifest.overview.step);
    const columns=Math.floor((tile.columns-1)/4)+1,rows=Math.floor((tile.rows-1)/4)+1;
    if(columns<2||rows<2)continue;
    const heights=new Float32Array(columns*rows);
    for(let z=0;z<rows;z++)for(let x=0;x<columns;x++)heights[z*columns+x]=overview[(rz+z)*manifest.overview.columns+cx+x];
    coarse.set(tile.file,mesh({...tile,columns,rows,step:manifest.overview.step},heights,'relief-overview-'+tile.file));
   }
  }catch(e){announceError(e);}
 }
 function update(position){
  if(disposed||!manifest||!overview)return;
  const next=nearestReliefTiles(manifest,position);wanted=new Set(next.map(t=>t.file));
  for(const [key,value] of fine)if(!wanted.has(key)){value.mesh.dispose();fine.delete(key);coarse.get(key)?.setEnabled(true);}
  for(const tile of next){
   if(pending.size>=2)break;
   if(fine.has(tile.file)||pending.has(tile.file)||(retry.get(tile.file)||0)>Date.now())continue;
   const task=upload(async()=>{
    try{
     const data=await (await read(tile.file)).arrayBuffer();
     if(disposed||upload.isActive?.()===false||!wanted.has(tile.file))return;
     if(data.byteLength!==tile.bytes)throw Error('地形分块长度错误');
     const heights=new Float32Array(data),grid={...tile,step:manifest.step};
     fine.set(tile.file,{mesh:mesh(grid,heights,'relief-fine-'+tile.file),grid,heights});
     coarse.get(tile.file)?.setEnabled(false);
    }catch(e){retry.set(tile.file,Date.now()+30000);announceError(e);}
   },{label:'山体细节',wanted:()=>!disposed&&wanted.has(tile.file)&&(retry.get(tile.file)||0)<=Date.now()}).catch(announceError).finally(()=>pending.delete(tile.file));pending.set(tile.file,task);
  }
 }
 function heightAt(x,z){
  if(!manifest||!overview)return 0;
  for(const value of fine.values()){
   const g=value.grid;if(x>=g.x0&&z>=g.z0&&x<=g.x0+(g.columns-1)*g.step&&z<=g.z0+(g.rows-1)*g.step)return reliefHeight(g,value.heights,x,z);
  }
  return reliefHeight({...manifest,...manifest.overview},overview,x,z);
 }
 const unregister=upload.registerEvictor?.(()=>{for(const [key,v] of fine){v.mesh.dispose();coarse.get(key)?.setEnabled(true);retry.set(key,Date.now()+30000);}fine.clear();});
 return {init:()=>upload(init,{label:'山体概览'}),update,heightAt,get stats(){return {coarse:coarse.size,fine:fine.size,pending:pending.size};},dispose(){disposed=true;unregister?.();lifecycle.abort();for(const v of fine.values())v.mesh.dispose();for(const v of coarse.values())v.dispose();fine.clear();coarse.clear();overview=null;material.dispose();}};
}
