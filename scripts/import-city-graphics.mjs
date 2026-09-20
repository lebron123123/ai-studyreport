// Import only graphics/observer dependencies, never the game's world/runtime.
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const source=process.argv[2];
if(!source)throw Error('Provide the local city reference directory');
const target=path.resolve('project-map'), records=[],seen=new Set();
const hash=b=>createHash('sha256').update(b).digest('hex');
function module(name){
 if(seen.has(name))return;seen.add(name);
 const original=fs.readFileSync(path.join(source,'source/src',name),'utf8');
 let js=stripTypeScriptTypes(original,{mode:'transform'});
 for(const match of js.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))module(match[1]);
 js=js.replace(/import\s*\{([^}]+)\}\s*from\s*['"]@babylonjs\/core['"];?/g,(_,names)=>`const {${names.replace(/\bas\b/g,':')}} = globalThis.BABYLON;`)
  .replace(/\.ts(['"])/g,'.mjs$1').replaceAll('/city/','/project-map/city/');
 if(name==='city-observer.ts')js=js.replace('class CityObserver {','class CityObserver {\n speedMultiplier = 1;').replace('speed * Math.min','speed * this.speedMultiplier * Math.min');
 if(name==='city-facade-stream.ts')js=js.replace('async load(tile) {','async load(tile) {\n if(this.disposed)return;').replace('result.meshes[0].rotationQuaternion', 'if(this.disposed){for(const mesh of result.meshes)mesh.dispose();return;}\n result.meshes[0].rotationQuaternion');
 fs.mkdirSync(path.join(target,'reference'),{recursive:true});
 fs.writeFileSync(path.join(target,'reference',name.replace('.ts','.mjs')),`// Adapted from local GTA_SZ derivative: ${name}; original SHA256 ${hash(original)}\n`+js);
 records.push({source:'source/src/'+name,sha256:hash(original)});
}
for(const name of ['city-observer.ts','city-architecture-materials.ts','city-facade-diversity.ts','city-facade-stream.ts','city-cinematic.ts'])module(name);
function copy(relative){const from=path.join(source,'web',relative),to=path.join(target,relative);if(fs.statSync(from).isDirectory()){for(const n of fs.readdirSync(from))copy(relative+'/'+n);return;}fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);const bytes=fs.readFileSync(from);records.push({file:relative,bytes:bytes.length,sha256:hash(bytes)});}
for(const name of ['buildings.glb','roads.glb','terrain.glb','landmarks.glb','landmark-detail.glb','facade-tiles.json','facade-tiles','textures','environment','metadata.json'])copy('city/'+name);
if(fs.existsSync(path.join(source,'web/licenses')))copy('licenses');
fs.writeFileSync(path.join(target,'reference/import-manifest.json'),JSON.stringify({source:'Local 深圳精细城市探索版 / GTA_SZ derivative',adaptations:['Babylon global imports','Local asset paths','Observer speed multiplier','Facade disposal guard'],records},null,2));
console.log(JSON.stringify({modules:seen.size,files:records.filter(r=>r.file).length,bytes:records.reduce((n,r)=>n+(r.bytes||0),0)}));
