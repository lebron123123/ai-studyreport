// Fixed denominator. Failures remain in the artifact; never replace a hard sample.
import {writeFile,readFile} from 'node:fs/promises';
import {collectRentalCommunity} from '../functions/api/_rental-collect.js';
import {createRentalCrawler} from '../functions/api/_rental-crawler.js';
import {rentalPriced} from '../project-map/rental-identity.mjs';
import {createD1Shim} from '../local-server/d1-shim.js';
import {saveRentalObservation} from '../functions/api/_rental-store.js';
export const samples=[
 ['雅福居','福田区',114.0019657711373,22.551061722992458],
 ['万科香蜜府','福田区',114.00189288383258,22.552180855104595],
 ['聚龙花园二期','坪山区',114.38295318886827,22.72416314029024],
 ['亚迪三村','坪山区',114.38073474487847,22.730177269531012],
 ['金洪名筑','光明区',113.92301127827947,22.728683404953625],
 ['锦绣江南四期','龙华区',114.02688171151318,22.64065864901243],
 ['万科未来之光家园','宝安区',113.90600419333079,22.592237044152625],
 ['寓见安居·未来之光','宝安区',113.90589721030499,22.591101212143325],
 ['曦城南区二期','宝安区',113.90404407869939,22.592606267649323],
 ['新世界誉名别苑','宝安区',113.90752880044242,22.594063471537762]
].map(([name,district,lon,lat])=>({name,district,point:[lon,lat],kind:'住宅',street:'',address:''}));
const output=new URL('../outputs/rental-ten-20260918.json',import.meta.url);
const resume=process.argv.includes('--retry-unpriced');
const report=resume?JSON.parse(await readFile(output,'utf8')):{startedAt:new Date().toISOString(),sampleCount:10,definition:'至少一种有效租金或售价；直接报价与其他分期参考分开，不能代表每个周边范围90%',samples:samples.map(community=>({community,markets:{}}))};
await writeFile(output,JSON.stringify(report,null,2));
const DB=process.argv.includes('--save')?createD1Shim(process.env.DATABASE_URL):null;
try{
 for(const sample of report.samples){
  for(const market of ['rent','sale']){
   if(resume&&sample.markets[market]?.rows.some(rentalPriced))continue;
   if(resume&&!['万科香蜜府','寓见安居·未来之光'].includes(sample.community.name))continue;
   if(resume&&sample.community.name==='寓见安居·未来之光'&&market==='sale')continue;
   const community={...sample.community,market},searchCache=new Map(),crawler=createRentalCrawler({maxPages:16});
   const out={rows:[],errors:[],sources:[]};
   for(const channel of ['search','crawler']){
    try{const result=await collectRentalCommunity(process.env,community,channel,{crawler,searchCache});out.rows.push(...result.rows.filter(rentalPriced));out.errors.push(...result.errors);out.sources.push(...(result.sources||[]));}
    catch(error){out.errors.push(channel+': '+error.message);}
   }
   out.rows=[...new Map(out.rows.map(row=>[row.url+'|'+(row.referenceKind||'direct'),row])).values()];
   if(DB)for(const row of out.rows)row.id=await saveRentalObservation(DB,row);
   if(sample.markets[market])out.previousAttempts=[...(sample.markets[market].previousAttempts||[]),{errors:sample.markets[market].errors,rows:sample.markets[market].rows}];
   sample.markets[market]=out;
   await writeFile(output,JSON.stringify(report,null,2));
   console.log(JSON.stringify({name:community.name,market,priced:out.rows.length,direct:out.rows.filter(r=>!r.referenceKind).length,errors:out.errors.length}));
  }
 }
 report.finishedAt=new Date().toISOString();
 report.direct=report.samples.filter(s=>Object.values(s.markets).some(m=>m.rows.some(r=>!r.referenceKind))).length;
 report.withReference=report.samples.filter(s=>Object.values(s.markets).some(m=>m.rows.length)).length;
 await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({direct:report.direct,withReference:report.withReference,denominator:10}));
}finally{await DB?._close();}
