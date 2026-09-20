// Only repairs this task's derived manifests, never the OSM source or user data.
const fs=require('node:fs');const root='project-map/baoan-lod-v1/';
const index=JSON.parse(fs.readFileSync(root+'index.json'));
if(index.sourceMd5!=='19f568d32fb9dc34398aa13bae52f56b')throw Error('Unexpected source');
for(const name of ['known','estimated']){
 const path=root+name+'.json',m=JSON.parse(fs.readFileSync(path));
 if(m.extras?.boundsPaddingDegrees===.00025)continue;
 const margin=.00025*Math.PI/180;
 for(const t of m.root.children){const r=t.boundingVolume.region;r[0]-=margin;r[1]-=margin;r[2]+=margin;r[3]+=margin;for(const child of t.children)child.boundingVolume.region=[...r];}
 const regions=m.root.children.map(t=>t.boundingVolume.region);
 m.root.boundingVolume.region=[Math.min(...regions.map(r=>r[0])),Math.min(...regions.map(r=>r[1])),Math.max(...regions.map(r=>r[2])),Math.max(...regions.map(r=>r[3])),-5,Math.max(...regions.map(r=>r[5]))];
 m.extras={boundsPaddingDegrees:.00025};fs.writeFileSync(path,JSON.stringify(m));console.log(name+' culling bounds padded');
}
