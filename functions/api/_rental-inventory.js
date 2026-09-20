import {toWgs84} from '../../project-map/core.mjs';
import {rentalInRange} from '../../project-map/rental-core.mjs';
import {rentalName} from '../../project-map/rental-identity.mjs';
import {rentalCommunityEligible} from './_rental-search-plan.js';

// Only normalize the operator prefix and directional area suffix for excluding
// the research center. Do not use this identity for assigning prices.
export function rentalIsResearchCenter(candidate,query){
 const names=[query.projectName,...(query.projectAliases||[])].filter(Boolean);
 const identity=value=>rentalName(value).replace(/^安居/,'').replace(/[东西南北]区$/,'');
 return names.some(name=>identity(name).length>=3&&identity(candidate.name)===identity(name));
}

export async function rentalInventory(env,query,{fetcher=fetch,maxPages=20,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!env.AMAP_KEY)throw Error('未配置周边地点服务');
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>20)throw Error('地点分页预算无效');
 let location=[...query.point];for(let i=0;i<5;i++){const w=toWgs84(location,'GCJ02');location=location.map((n,j)=>n+query.point[j]-w[j]);}
 const communities=[],excluded=[],seen=new Set();let total=0,received=0,pages=0,complete=false;
 for(let page=1;page<=maxPages;page++){
  const url=new URL('https://restapi.amap.com/v3/place/around');
  for(const [k,v] of Object.entries({key:env.AMAP_KEY,location:location.join(','),radius:query.radius,types:'120300',sortrule:'distance',offset:25,page,extensions:'base'}))url.searchParams.set(k,v);
  let data;for(let attempt=0;attempt<4;attempt++){
   await sleep(attempt?1000*2**attempt:400);
   const response=await fetcher(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('周边地点服务HTTP '+response.status);
   data=await response.json();if(data.status==='1'||data.info!=='CUQPS_HAS_EXCEEDED_THE_LIMIT')break;
  }
  if(data.status!=='1')throw Error('周边地点查询失败：'+String(data.info||'未知错误'));
  total=Number(data.count)||0;pages++;received+=(data.pois||[]).length;
  for(const p of data.pois||[]){
   const c={name:String(p.name||''),poiId:p.id,poiType:p.type||'',district:p.adname||'',address:typeof p.address==='string'?p.address:'',point:toWgs84(String(p.location).split(',').map(Number),'GCJ02'),kind:'住宅'};
   const key=rentalName(c.name),reason=!c.name?'无名称':seen.has(key)?'同名重复':!rentalCommunityEligible(c)?'非住宅竞品':!rentalInRange(c,{...query,kind:'住宅',market:'rent'})?'超出范围':rentalIsResearchCenter(c,query)?'项目自身（含运营方前缀或方向分区）':'';
   if(reason){excluded.push({name:c.name,reason});continue;}seen.add(key);communities.push(c);
  }
  if(!(data.pois||[]).length||received>=total){complete=true;break;}
 }
 return {communities,excluded,providerTotal:total,received,pages,complete,truncated:!complete,radius:query.radius,createdAt:new Date().toISOString()};
}
