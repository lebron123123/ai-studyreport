// Streaming adaptation of GTA_SZ derivative city-road-surface.ts.
// Keep source scan scale and day/night response; share maps across live blocks.
export const ROAD_LOOK={
 day:{albedo:[1.02,1.03,1.04],specular:.55,environment:1,roughness:[.66,.19]},
 sunset:{albedo:[.72,.76,.79],specular:.22,environment:.55,roughness:[.83,.12]},
 night:{albedo:[.72,.76,.79],specular:.22,environment:.55,roughness:[.83,.12]}
};
export function createRoadSurface(scene,B=globalThis.BABYLON){
 const entries=new Map(),textures=[],states={normal:false,orm:false};let dead=false,mode='sunset',normal,orm;
 class DryFilm extends B.MaterialPluginBase{
  constructor(material){super(material,'AsphaltDryFilm',210,{},true,true,true);}
  isCompatible(language){return language===B.ShaderLanguage.GLSL;}
  getUniforms(){return {ubo:[{name:'cityAsphaltRoughness',size:2,type:'vec2'}],fragment:'uniform vec2 cityAsphaltRoughness;'};}
  bindForSubMesh(buffer){buffer.updateFloat2('cityAsphaltRoughness',...ROAD_LOOK[mode].roughness);}
  getCustomCode(type){return type==='fragment'?{CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS:'metallicRoughness.g=cityAsphaltRoughness.x+cityAsphaltRoughness.y*metallicRoughness.g;'}:null;}
 }
 function color(material){const look=ROAD_LOOK[mode];material.albedoColor=new B.Color3(...look.albedo);material.specularIntensity=look.specular;material.environmentIntensity=look.environment;}
 function attach(){if(dead||!states.normal||!states.orm)return;for(const [material,entry] of entries){if(entry.applied)continue;
  const properties={bumpTexture:normal,metallicTexture:orm,microSurfaceTexture:null,reflectionTexture:null,metallic:0,roughness:1,disableBumpMap:false,invertNormalMapX:!scene.useRightHandedSystem,invertNormalMapY:scene.useRightHandedSystem,useRoughnessFromMetallicTextureAlpha:false,useRoughnessFromMetallicTextureGreen:true,useMetallnessFromMetallicTextureBlue:true,useAmbientOcclusionFromMetallicTextureRed:true,enableSpecularAntiAliasing:true};
  entry.previous=Object.fromEntries([...Object.keys(properties),'albedoColor','specularIntensity','environmentIntensity'].map(k=>[k,material[k]]));
  Object.assign(material,properties);color(material);entry.film=new DryFilm(material);entry.applied=true;
 }}
 function load(kind,file,size,period){const texture=new B.Texture('/project-map/city/textures/road-cinematic/'+file,scene,{noMipmap:false,invertY:false,samplingMode:B.Texture.TRILINEAR_SAMPLINGMODE,gammaSpace:false,onLoad:()=>queueMicrotask(()=>{if(dead)return;const d=texture.getSize();if(d.width!==size||d.height!==size){console.warn('Road texture unexpected dimensions',kind);return;}states[kind]=true;attach();}),onError:()=>{if(!dead)console.warn('Road texture unavailable; retaining base road',kind);}});
  texture.name='stream-road:'+kind;texture.wrapU=texture.wrapV=B.Texture.WRAP_ADDRESSMODE;texture.anisotropicFilteringLevel=8;texture.uScale=texture.vScale=14/period;texture.vOffset=1-texture.vScale;textures.push(texture);return texture;
 }
 function applyMeshes(meshes){if(dead)return;for(const mesh of meshes){const material=mesh.material;if(!(material instanceof B.PBRMaterial)||!/^asphalt(?:\.\d+)?$/.test(material.name)||entries.has(material))continue;
  const entry={};entries.set(material,entry);entry.observer=material.onDisposeObservable.add(()=>entries.delete(material));
 }
 if(entries.size&&!normal){normal=load('normal','asphalt-normal-gl.webp',1024,2.35*.6);normal.level=.13;orm=load('orm','asphalt-orm.webp',2048,2.35*.6*8);}attach();}
 return {applyMeshes,setMode(value){if(!ROAD_LOOK[value])return;mode=value;for(const [material,entry] of entries)if(entry.applied)color(material);},get stats(){return {materials:entries.size,textures:textures.length,ready:states.normal&&states.orm,mode,additionalRenderTargets:0};},dispose(){if(dead)return;dead=true;for(const [material,entry] of entries){material.onDisposeObservable.remove(entry.observer);if(entry.applied&&material.bumpTexture===normal&&material.metallicTexture===orm)Object.assign(material,entry.previous);entry.film?.dispose(false);}entries.clear();for(const texture of textures)texture.dispose();textures.length=0;}};
}
