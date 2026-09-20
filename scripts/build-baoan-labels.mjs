import fs from 'node:fs';
import crypto from 'node:crypto';
const root='project-map/baoan-lod-v2',items=[],seen=new Set();
function add(item){const key=item.name+'|'+item.point.map(x=>Math.round(x*200)).join(',');if(seen.has(key))return;seen.add(key);items.push(item);}
for(const file of fs.readdirSync(root+'/metadata').sort())for(const f of JSON.parse(fs.readFileSync(root+'/metadata/'+file))){
 if(!f.name||f.name===f.id||/^[A-Z0-9一二三四五六七八九十]+[号栋座楼层区单元]*$/.test(f.name))continue;
 const important=/机场|航站|会展|体育|图书馆|博物馆|政府|人民医院|文化中心/.test(f.name);
 add({id:f.id,name:f.name,point:f.geometry.coordinates[0][0][0].slice(0,2),height:f.height,kind:f.kind,priority:important?100:/站$|学校|医院|广场|大厦|公园/.test(f.name)?75:40,note:'OSM建筑名称；位置锚定源轮廓，名称未经现场核验。'});
}
const basemap=JSON.parse(fs.readFileSync('outputs/baoan-source/basemap.json'));
for(const [i,f] of basemap.features.entries())if(f.kind==='road'&&f.name&&['motorway','trunk','primary','secondary'].includes(f.class)){
 const line=f.geometry.type==='LineString'?f.geometry.coordinates:f.geometry.coordinates[0];if(!line?.length)continue;
 add({id:'road-'+i,name:f.name,point:line[Math.floor(line.length/2)].slice(0,2),height:1,kind:'road',priority:60,note:'OSM道路名称；示意标注，不代表道路宽度测绘值。'});
}
items.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
const result={schemaVersion:1,source:'OpenStreetMap / guangdong-260912',sourceMd5:basemap.sourceMd5,items};
const text=JSON.stringify(result);fs.writeFileSync('project-map/baoan-places.json',text);console.log({count:items.length,bytes:Buffer.byteLength(text),sha256:crypto.createHash('sha256').update(text).digest('hex')});
