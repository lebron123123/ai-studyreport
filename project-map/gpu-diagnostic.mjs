import {createArchitectureMaterials} from './reference/city-architecture-materials.mjs';
import {createFacadeDiversity} from './reference/city-facade-diversity.mjs';
import {createOriginalCityStream} from './original-city-stream.mjs';
import {createBaoanStream} from './baoan-city-stream.mjs';
import {CityFacadeStream} from './reference/city-facade-stream.mjs';
import {createCinematicLook} from './reference/city-cinematic.mjs';
const B=globalThis.BABYLON,canvas=document.querySelector('canvas'),log=document.querySelector('pre');
const note=s=>{log.textContent+=s+'\n';};
canvas.addEventListener('webglcontextcreationerror',event=>note('CREATE FAILED: '+event.statusMessage));
try {
const engine=new B.Engine(canvas,false,{stencil:false,disableWebGL2Support:true}),scene=new B.Scene(engine);scene.metadata={};
const camera=new B.FreeCamera('diagnostic',new B.Vector3(-950,300,-250),scene);camera.setTarget(new B.Vector3(-1100,60,-500));camera.maxZ=60000;
const sun=new B.DirectionalLight('sun',new B.Vector3(.95,-.19,.31),scene),hemi=new B.HemisphericLight('sky',new B.Vector3(0,1,0),scene);
const pipeline=new B.DefaultRenderingPipeline('quality',true,scene,[camera]);pipeline.samples=1;pipeline.fxaaEnabled=true;
const catalog=await(await fetch('models/catalog.json')).json();
catalog.baoanTiles=[];catalog.districts=[];
for(const [id,name] of [['baoan','宝安'],['futian','福田'],['nanshan','南山'],['luohu','罗湖']]){
 const response=await fetch(id+'-lod-v2/index.json');if(!response.ok)throw Error(id+' index HTTP '+response.status);
 const index=await response.json();catalog.districts.push({id,name});
 catalog.baoanTiles.push(...index.tiles.map(t=>({...t,key:id==='baoan'?t.key:id+':'+t.key,sourceKey:t.key,assetBase:id+'-lod-v2',district:id,districtName:name})));
}
note('CATALOG: '+catalog.districts.length+' districts, '+catalog.baoanTiles.length+' tiles');
const architecture=createArchitectureMaterials(scene),diversity=createFacadeDiversity(scene),apply=(meshes,name)=>{architecture.applyMeshes(meshes,name);diversity.applyMeshes(meshes,name);};
const original=createOriginalCityStream(scene,apply,note),near=createBaoanStream(scene,catalog,note),facade=new CityFacadeStream(scene,()=>{},apply);
let originalOn=false,nearOn=false,cinematic=null;
canvas.addEventListener('webglcontextlost',()=>note('CONTEXT LOST'));
canvas.addEventListener('webglcontextrestored',()=>note('CONTEXT RESTORED'));
engine.runRenderLoop(()=>{if(originalOn)original.update(camera.position,camera.position);if(nearOn)near.update(camera.position,camera.position);scene.render();});
const load=async name=>{const a=await B.ImportMeshAsync('city/'+name+'.glb',scene);a.meshes[0].rotationQuaternion=B.Quaternion.Identity();apply(a.meshes,name);};
const actions={terrain:()=>load('terrain'),landmarks:()=>load('landmark-detail'),overview:()=>near.initOverview(),original:async()=>{await original.init();originalOn=true;},near:()=>{nearOn=true;},facade:()=>facade.init(camera.position.x,camera.position.z),cinematic:async()=>{cinematic=await createCinematicLook({scene,sun,hemi,pipeline,camera});}};
for(const [id,action] of Object.entries(actions))document.getElementById(id).onclick=async e=>{e.target.disabled=true;note('BEGIN '+id);try{await action();note('END '+id+' meshes='+scene.meshes.length+' vertices='+scene.getTotalVertices());}catch(error){note('ERROR '+error.message);}};
note('BASE READY');
window.addEventListener('pagehide',()=>{original.dispose();near.dispose();cinematic?.dispose();scene.dispose();engine.dispose();});
} catch (error) {
 note('诊断中止：'+error.message+'。尚未加载城市模型，不能据此认定模型损坏。');
 for (const button of document.querySelectorAll('button')) button.disabled=true;
}
