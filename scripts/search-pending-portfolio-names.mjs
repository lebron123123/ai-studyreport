import fs from 'node:fs';
import {toWgs84} from '../project-map/core.mjs';
const input=JSON.parse(fs.readFileSync('outputs/portfolio-location-audit.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('outputs/portfolio-locations-reviewed.json','utf8'));
const pending=new Set(reviewed.projects.filter(p=>p.status==='pending').map(p=>p.sourceKey));
const target='outputs/portfolio-name-search.json';
const prior=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
const results=prior?.sourceHash===input.sourceHash?prior.projects:[];
const extra={27:['深业泰富广场E座'],28:['银湖蓝山10栋'],29:['招商中环201栋'],31:['招商开元中心'],34:['云海湾花园'],50:['龙辉花园','龙联花园'],52:['电力花园二期3栋'],53:['电力花园二期6栋'],55:['科技生态园1栋A座','科技生态园1栋B座'],56:['科技生态园1栋D座'],72:['庆宜华苑二期'],77:['石岩东综合车场'],80:['中车深圳基地'],91:['龙园大观'],99:['坪地综合车场'],100:['龙岗综合车场'],101:['雅龙阁'],102:['珺龙阁'],129:['安居秀景苑'],134:['安居燕翠府'],136:['安居创景苑'],148:['薯田埔综合车场'],149:['将石综合车场'],150:['白花片区保障性住房项目']};
if(!process.env.AMAP_KEY)throw Error('地图查询配置缺失');
for(const p of input.projects.filter(p=>pending.has(p.sourceKey))){
 const name=p.name.split(/[（(]/)[0].replace(/项目$/,'');
 const aliases=[...new Set([name,...[...p.address.matchAll(/[（(]([^）)]+)[）)]/g)].map(m=>m[1]),...(extra[p.row]||[])])];
 const old=results.find(r=>r.sourceKey===p.sourceKey);
 if(old&&!old.error&&aliases.every(q=>old.queries.includes(q)))continue;
 const item={row:p.row,name:p.name,sourceKey:p.sourceKey,address:p.address,checkedAt:new Date().toISOString(),queries:aliases,candidates:[]};
 if(old&&!old.error)item.candidates=[...old.candidates];
 try{for(const keywords of aliases.filter(q=>!old||old.error||!old.queries.includes(q))){
  await new Promise(r=>setTimeout(r,350));
  const url=new URL('https://restapi.amap.com/v3/place/text');
  const city=p.address.includes('东莞')?'东莞':p.address.includes('深汕')?'汕尾':'深圳';
  for(const [k,v]of Object.entries({key:process.env.AMAP_KEY,keywords,city,citylimit:'true',offset:'10',page:'1',extensions:'base'}))url.searchParams.set(k,v);
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();if(data.status!=='1')throw Error('地图服务拒绝：'+data.info);
  for(const c of data.pois||[]){if(item.candidates.some(x=>x.id===c.id))continue;item.candidates.push({id:c.id,name:c.name,address:[c.pname,c.cityname,c.adname,c.address].filter(x=>typeof x==='string').join(''),providerCoordinate:c.location,providerCrs:'GCJ02',point:toWgs84(c.location,'GCJ02'),query:keywords});}
 }}catch(e){item.error=e.name==='TimeoutError'?'查询超时':'查询失败，请重试';}
 const i=results.findIndex(r=>r.sourceKey===p.sourceKey);if(i<0)results.push(item);else results[i]=item;
 fs.writeFileSync(target,JSON.stringify({sourceHash:input.sourceHash,projects:results},null,2));
 console.log(JSON.stringify({row:p.row,name:p.name,count:item.candidates.length,error:item.error}));
}
