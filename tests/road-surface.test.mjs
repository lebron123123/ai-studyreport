import test from 'node:test';import assert from 'node:assert/strict';
import {createRoadSurface} from '../project-map/road-surface.mjs';
class Observable{items=new Set();add(f){this.items.add(f);return f;}remove(f){this.items.delete(f);}fire(){for(const f of this.items)f();}}
class PBRMaterial{constructor(name){this.name=name;this.onDisposeObservable=new Observable();this.roughness=.5;}dispose(){this.onDisposeObservable.fire();}}
class Texture{static all=[];constructor(url,scene,options){this.url=url;this.options=options;this.disposed=0;Texture.all.push(this);}getSize(){const n=this.url.includes('normal')?1024:2048;return {width:n,height:n};}dispose(){this.disposed++;}}
class MaterialPluginBase{dispose(){this.disposed=true;}}
const B={PBRMaterial,Texture,MaterialPluginBase,Color3:class{constructor(...v){this.values=v;}},ShaderLanguage:{GLSL:0}};
test('near road blocks share maps, honor light selected while loading and release ownership',async()=>{
 Texture.all=[];const surface=createRoadSurface({useRightHandedSystem:false},B),a=new PBRMaterial('asphalt'),b=new PBRMaterial('asphalt.1'),building=new PBRMaterial('glass');
 surface.applyMeshes([{material:a},{material:building}]);surface.applyMeshes([{material:b},{material:a}]);assert.equal(Texture.all.length,2);assert.equal(surface.stats.materials,2);
 surface.setMode('day');for(const t of Texture.all)t.options.onLoad();await Promise.resolve();assert.equal(surface.stats.ready,true);assert.equal(a.bumpTexture,b.bumpTexture);assert.deepEqual(a.albedoColor.values,[1.02,1.03,1.04]);assert.equal(building.bumpTexture,undefined);
 a.dispose();assert.equal(surface.stats.materials,1);surface.dispose();surface.dispose();assert.equal(b.roughness,.5);assert.equal(b.bumpTexture,undefined);assert.ok(Texture.all.every(t=>t.disposed===1));
});
test('late texture callback after exit does not attach material',async()=>{
 Texture.all=[];const surface=createRoadSurface({},B),a=new PBRMaterial('asphalt');surface.applyMeshes([{material:a}]);surface.dispose();for(const t of Texture.all)t.options.onLoad();await Promise.resolve();assert.equal(a.bumpTexture,undefined);assert.equal(surface.stats.materials,0);
});
test('failed map preserves existing material and later live blocks reuse loaded maps',async()=>{
 Texture.all=[];const surface=createRoadSurface({},B),a=new PBRMaterial('asphalt');surface.applyMeshes([{material:a}]);Texture.all[0].options.onLoad();await Promise.resolve();assert.equal(a.roughness,.5);
 Texture.all[1].options.onLoad();await Promise.resolve();a.dispose();const b=new PBRMaterial('asphalt');surface.applyMeshes([{material:b}]);assert.equal(Texture.all.length,2);assert.equal(b.roughness,1);surface.dispose();
});
