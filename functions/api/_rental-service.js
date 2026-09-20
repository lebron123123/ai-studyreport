import {ensureRentalStore,rentalHash,readRentalObservations,saveRentalObservation} from './_rental-store.js';
import {rentalCommunities,collectRentalCommunity} from './_rental-collect.js';
import {createRentalCrawler} from './_rental-crawler.js';
import {rentalQuery} from '../../project-map/rental-core.mjs';
const channels=['search','crawler'];
const strategyVersion=8;
const coverageDescription='分批采集最近最多25处同类物业，未完成项可续查；不是范围内完整房源库';
export function rentalPendingOrder(communities,states){
 return [...communities].sort((a,b)=>{
  const rank=c=>channels.every(ch=>states[ch].tasks?.[c.name]?.state==='completed')?2:channels.some(ch=>!states[ch].tasks?.[c.name])?0:1;
  return rank(a)-rank(b);
 });
}
export function rentalTaskErrors(out,channel){
 const errors=[...(out.errors||[])];
 if(channel==='crawler'&&!out.rows.length&&!out.skipped&&!errors.length)errors.push('网页取证未取得有效报价，需补查；不代表该物业没有市场报价');
 if(channel==='search'&&!out.rows.length&&!out.hits?.length&&!out.skipped&&!errors.length)errors.push('检索未取得有效网页候选，需补查；不代表该物业没有市场报价');
 return errors;
}
export async function rentalService(env,input,waitUntil,{discover=rentalCommunities,collect=collectRentalCommunity}={}){
 const query=rentalQuery(input),DB=env.DB;await ensureRentalStore(DB);
 const id=await rentalHash(query),now=Date.now();
 let row=await DB.prepare('SELECT * FROM map_rental_runs WHERE id=?').bind(id).first();
 const samples=await readRentalObservations(DB,query);
 const previous=row?JSON.parse(row.data):{},currentStrategy=previous.strategyVersion===strategyVersion;
 if(input.action==='list')return {ok:true,...samples,run:row?publicRun(row):null};
 if(!['collect','retry'].includes(input.action))throw Error('未知租金操作');
 // Successful completed ranges are reused for a day. Failed ranges need explicit retry.
 if(row&&((row.state==='running'&&Number(row.lease_until)>now)||(currentStrategy&&((row.state==='completed'&&now-Number(row.updated_at)<86400000)||(row.state==='failed'&&input.action!=='retry')||now-Number(row.updated_at)<60000))))return {ok:true,...samples,run:publicRun(row),cached:true};
 if(typeof waitUntil!=='function')throw Error('服务未配置后台采集执行器');
 const recent=await DB.prepare('SELECT COUNT(*) AS n FROM map_rental_runs WHERE updated_at>?').bind(now-3600000).first();
 if(!row&&Number(recent.n)>=20)throw Error('本小时采集预算已满，已有样本仍可使用');
 const lease=now+600000,owner=crypto.randomUUID();let slot=null;
 for(const n of [1,2]){const claimed=await DB.prepare('UPDATE map_rental_slots SET lease_until=?,owner=? WHERE id=? AND lease_until<?').bind(lease,owner,n,now).run();if(claimed.meta?.changes===1){slot=n;break;}}
 if(slot===null)return {ok:true,...samples,run:row?publicRun(row):null,busy:true};
 const resume=row&&currentStrategy&&(row.state!=='completed');
 const data={strategyVersion,communities:resume?previous.communities:null,channels:Object.fromEntries(channels.map(c=>[c,resume&&previous.channels?.[c]?.state==='completed'?previous.channels[c]:{state:'pending',count:0,errors:[],tasks:resume?previous.channels?.[c]?.tasks||{}:{}}]))};
 try{
 if(!row){await DB.prepare('INSERT INTO map_rental_runs(id,query,state,lease_until,updated_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,JSON.stringify(query),'pending',0,0,JSON.stringify(data)).run();}
 const claimed=await DB.prepare("UPDATE map_rental_runs SET state='running',lease_until=?,updated_at=?,data=? WHERE id=? AND lease_until<=?").bind(lease,now,JSON.stringify(data),id,now).run();
 if(claimed.meta?.changes!==1){await release();row=await DB.prepare('SELECT * FROM map_rental_runs WHERE id=?').bind(id).first();return {ok:true,...samples,run:publicRun(row),cached:true};}
 }catch(error){await release();throw error;}
 const run=async()=>{
  let writes=Promise.resolve();
  const checkpoint=state=>{const snapshot=JSON.stringify(data);writes=writes.then(async()=>{const saved=await DB.prepare('UPDATE map_rental_runs SET state=?,updated_at=?,data=? WHERE id=? AND lease_until=?').bind(state,Date.now(),snapshot,id,lease).run();if(saved.meta?.changes!==1)throw Error('采集任务租约已失效');});return writes;};
  try{
   if(!data.communities)data.communities=(await discover(env,query)).map(c=>({...c,...(query.market?{market:query.market}:{})}));
   if(!data.communities.length)throw Error('所选范围未取得可定位的同类物业；没有扩大范围或推测地址');
   // Reuse successfully searched communities from overlapping ranges for one day.
   // Coordinate and kind checks prevent same-name communities in other districts matching.
   const recentRuns=await DB.prepare('SELECT query,data FROM map_rental_runs WHERE updated_at>? AND id<>? ORDER BY updated_at DESC LIMIT 100').bind(now-86400000,id).all();
   for(const record of recentRuns.results||[]){const oldQuery=JSON.parse(record.query),old=JSON.parse(record.data);if(oldQuery.kind!==query.kind||(oldQuery.market||'rent')!==(query.market||'rent')||old.strategyVersion!==strategyVersion)continue;
    for(const community of data.communities){const matched=old.communities?.find(c=>c.name===community.name&&Math.abs(c.point[0]-community.point[0])<0.0001&&Math.abs(c.point[1]-community.point[1])<0.0001);if(!matched)continue;
     for(const channel of channels){const task=old.channels?.[channel]?.tasks?.[community.name];if(task?.state==='completed'&&!data.channels[channel].tasks?.[community.name]){data.channels[channel].tasks||={};data.channels[channel].tasks[community.name]={...task,reused:true};}}
    }
   }
   await checkpoint('running');
   const searchCache=new Map();
   for(const community of data.communities){const task=data.channels.search.tasks?.[community.name];if(task?.state==='completed'&&task.hits?.length)searchCache.set(JSON.stringify([community.name,community.kind,community.point,community.market||'rent']),{results:task.hits,sources:task.sources||[]});}
   const crawlers=Object.fromEntries(channels.map(c=>[c,createRentalCrawler({maxPages:32})]));
   for(const channel of channels){
    const tasks=data.channels[channel].tasks||{};
    data.channels[channel]={state:'running',count:0,errors:[],tasks};
   }
   // Finish evidence collection for one property before searching the next.
   // Otherwise slow discovery can consume the entire lease without any crawl.
   for(const community of rentalPendingOrder(data.communities,data.channels)){
    for(const channel of channels){
     const result=data.channels[channel],crawler=crawlers[channel];
     if(result.tasks[community.name]?.state==='completed'){result.count+=result.tasks[community.name].count;continue;}
     if(Date.now()>lease-150000){result.errors.push('本轮总时长预算不足，请重试未完成通道');break;}
     try{const out=await collect(env,community,channel,{crawler,searchCache,communities:data.communities});const errors=rentalTaskErrors(out,channel);for(const observation of out.rows){await saveRentalObservation(DB,observation);result.count++;}result.errors.push(...errors.map(e=>community.name+'：'+e));result.tasks[community.name]={state:errors.length?'failed':'completed',count:out.rows.length,...(out.hits?{hits:out.hits}:{}),...(out.sources?{sources:out.sources}:{}),...(out.skipped?{skipped:out.skipped}:{})};}
     catch(error){result.errors.push(community.name+'：'+safeError(error));result.tasks[community.name]={state:'failed',count:0};}
     await checkpoint('running');
    }
   }
   for(const channel of channels){const result=data.channels[channel];result.state=result.errors.length?'failed':'completed';}
   await checkpoint(channels.some(c=>data.channels[c].state==='failed')?'failed':'completed');
  }catch(error){data.error=safeError(error);await checkpoint('failed');}
  finally{await DB.prepare('UPDATE map_rental_runs SET lease_until=0 WHERE id=? AND lease_until=?').bind(id,lease).run();await release();}
 };
 waitUntil(run());
 return {ok:true,...samples,run:{id,state:'running',channels:data.channels,communities:[],coverage:coverageDescription}};
 async function release(){await DB.prepare('UPDATE map_rental_slots SET lease_until=0,owner=? WHERE id=? AND owner=?').bind('',slot,owner).run();}
}
function safeError(error){const message=String(error?.message||'采集失败');return /^(?:fetch failed|ECONN\w*|EACCES|timeout|.*aborted)$/i.test(message)?'外部服务连接失败或超时，请检查网络后重试':message.slice(0,1200);}
function publicRun(row){const data=JSON.parse(row.data);return {id:row.id,state:row.state==='running'&&Number(row.lease_until)<Date.now()?'interrupted':row.state,updatedAt:Number(row.updated_at),channels:data.channels,error:data.error||'',communities:data.communities?.map(x=>x.name)||[],competitors:(data.communities||[]).map(({name,point,kind,address})=>({name,point,kind,address})),coverage:coverageDescription};}
