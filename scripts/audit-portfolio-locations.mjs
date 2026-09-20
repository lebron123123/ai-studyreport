// Read-only provider checks. Never writes projects or logs provider credentials.
import fs from 'node:fs';
import {toWgs84} from '../project-map/core.mjs';
const input=JSON.parse(fs.readFileSync('outputs/portfolio-location-evidence.json','utf8'));
if(!process.env.AMAP_KEY)throw Error('AMAP_KEY 未配置');
const target='outputs/portfolio-location-audit.json';
const prior=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
const results=prior?.sourceHash===input.sourceHash?prior.projects:[];
const distance=(a,b)=>Math.hypot((a[0]-b[0])*102700,(a[1]-b[1])*111320);
async function query(path,params){
 await new Promise(resolve=>setTimeout(resolve,650));
 const url=new URL('https://restapi.amap.com/v3/'+path);for(const [k,v]of Object.entries({...params,key:process.env.AMAP_KEY}))url.searchParams.set(k,v);
 try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(d.status!=='1')throw Error(d.info||'服务拒绝');return d;}catch(e){throw Error(e.name==='TimeoutError'?'地图服务超时':e.message.includes('fetch')?'地图服务连接失败':e.message);}
}
for(const p of input.projects){
 if(results.some(r=>r.sourceKey===p.sourceKey&&!r.error))continue;
 const item={...p,checkedAt:new Date().toISOString(),candidates:[]};
 try{
  const city=p.address.includes('东莞')?'东莞':p.address.includes('深汕')?'':'深圳';
  if(p.address){const d=await query('geocode/geo',{address:p.address,...(city?{city}:{})});for(const c of d.geocodes||[])item.candidates.push({kind:'address',name:c.formatted_address,address:c.formatted_address,level:c.level,point:toWgs84(c.location,'GCJ02'),providerCoordinate:c.location,providerCrs:'GCJ02'});}
  const d=await query('place/text',{keywords:p.name.replace(/项目$/,''),...(city?{city,citylimit:'true'}:{}),offset:'10',page:'1',extensions:'base'});
  for(const c of d.pois||[])item.candidates.push({kind:'name',id:c.id,name:c.name,address:[c.pname,c.cityname,c.adname,c.address].filter(x=>typeof x==='string').join(''),point:toWgs84(c.location,'GCJ02'),providerCoordinate:c.location,providerCrs:'GCJ02'});
  for(const c of item.candidates){if(c.point&&p.suppliedPoint){c.distanceIfWgs=Math.round(distance(c.point,p.suppliedPoint));c.distanceIfGcj=Math.round(distance(c.point,toWgs84(p.suppliedPoint,'GCJ02')));}}
 }catch(e){item.error=e.message;}
 const index=results.findIndex(r=>r.sourceKey===p.sourceKey);if(index<0)results.push(item);else results[index]=item;
 fs.writeFileSync(target,JSON.stringify({...input,format:'anju-location-audit-v1',projects:results},null,2));
 console.log(JSON.stringify({done:results.length,total:input.projects.length,name:p.name,candidates:item.candidates.length,error:item.error}));
}
