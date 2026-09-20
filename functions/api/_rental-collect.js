import {wrSearch,wrProviderCatalog} from './_web-research-core.js';
import {createRentalCrawler,assertRentalUrl} from './_rental-crawler.js';
import {rentalObservation,rentalInRange} from '../../project-map/rental-core.mjs';
import {toWgs84} from '../../project-map/core.mjs';
import {crawlCatalog,catalogEntry} from './_rental-catalog.js';
import {rentalSearchPlan,rentalSiteMatch,rentalCommunityEligible,rentalRecoveryQuery,rentalSearchSites} from './_rental-search-plan.js';
import {fangRentalCards,fangCommunityPrice,fangCommunityCandidate,fangCommunityLinks} from './_rental-fang.js';
import {crawlLeyoujiaPage,leyoujiaCommunityCandidate} from './_rental-leyoujia.js';
import {collectPhaseReference} from './_rental-reference.js';
import {crawlOperator,operatorCommunity} from './_rental-operator.js';
import {rentalName,rentalPriced} from '../../project-map/rental-identity.mjs';
export function rentalSearchMatch(hit,community){
 let u;try{u=new URL(hit.url);}catch{return false;}
 if(u.protocol!=='https:'||!/(^|\.)(lianjia\.com|ke\.com|fang\.com|anjuke\.com|leyoujia\.com)$/.test(u.hostname))return false;
 const text=String(hit.title||'')+' '+String(hit.snippet||hit.text||'');
 const names=catalogEntry(community)?.names||[community.name];
 const compact=rentalName;
 const communityPage=!!leyoujiaCommunityCandidate(hit.url)||!!fangCommunityCandidate(hit.url);
 return names.some(name=>name&&compact(text).includes(compact(name)))&&(communityPage||(community.market==='sale'?/二手房|售价|均价|房价|出售/.test(text):/租|出租|元\/月/.test(text)));
}
function gcj(point){let p=[...point];for(let i=0;i<5;i++){const w=toWgs84(p,'GCJ02');p=[p[0]+point[0]-w[0],p[1]+point[1]-w[1]];}return p;}
export async function rentalCommunities(env,query){
 if(!env.AMAP_KEY)throw Error('未配置周边地点服务，无法核实竞品位置');
 const url=new URL('https://restapi.amap.com/v3/place/around');
 const params={key:env.AMAP_KEY,location:gcj(query.point).join(','),radius:String(query.radius),keywords:query.kind==='住宅'?'住宅小区|公寓|长租公寓|统建楼|城中村':query.kind==='办公'?'写字楼':'购物中心',...(query.kind==='住宅'?{types:'120300'}:{}),sortrule:'distance',offset:'25',page:'1',extensions:'base'};
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 let data;try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('周边地点服务连接失败，请稍后重试');}
 if(data.status!=='1')throw Error('周边地点服务未完成查询，请检查地图配置和额度');
 const seen=new Set();return (data.pois||[]).map(p=>({name:String(p.name||''),poiType:String(p.type||''),address:typeof p.address==='string'?p.address:'',district:typeof p.adname==='string'?p.adname:'',street:'',point:toWgs84(String(p.location).split(',').map(Number),'GCJ02'),kind:query.kind,...(query.market?{market:query.market}:{})})).filter(p=>{if(!p.name||!rentalCommunityEligible(p)||seen.has(p.name)||!rentalInRange(p,query))return false;seen.add(p.name);return true;});
}
export async function collectRentalCommunity(env,community,channel,{search=wrSearch,crawler=createRentalCrawler(),searchCache=new Map(),communities=[]}={}){
 let result,failure;
 try{result=await collectExact(env,community,channel,{search,crawler,searchCache,communities});}
 catch(error){if(channel!=='crawler')throw error;failure=error;result={rows:[],errors:[error.message],searched:0};}
 if(channel==='crawler'&&!result.rows.some(rentalPriced)){
  try{result.rows.push(...await collectPhaseReference(community,crawler));}
  catch(error){result.errors.push('其他分期补查：'+error.message);}
 }
 if(failure&&!result.rows.length)throw failure;
 return result;
}
async function collectExact(env,community,channel,{search,crawler,searchCache,communities}){
 const cacheKey=JSON.stringify([community.name,community.kind,community.point,community.market||'rent']);
 if(!rentalCommunityEligible(community))return {rows:[],errors:[],searched:0,skipped:'非同类住宅物业，不作为住宅竞品'};
 let direct=null;const directErrors=[];
 if(channel==='crawler'&&operatorCommunity(community)){
  try{direct=await crawlOperator(community,crawler);}catch(error){directErrors.push('运营方公开页取证：'+error.message);}
 }
 if(channel==='crawler'){
  try{const entry=catalogEntry(community);const catalog=community.market==='sale'?(entry?{...await crawlLeyoujiaPage(await crawler('https://shenzhen.leyoujia.com/xq/detail/'+entry.id+'.html'),community,crawler),errors:[],searched:1}:null):await crawlCatalog(community,crawler);if(catalog)direct=catalog;}catch(error){directErrors.push('小区公开页取证：'+error.message);}
 }
 // Use real search results, not model-generated prices or links. Bound fallback count.
 const providers=wrProviderCatalog(env).filter(p=>p.configured&&['deepseek-web','custom','brave','tavily','bing','duckduckgo'].includes(p.id)).slice(0,3).map(p=>p.id);
 if(!providers.length){if(direct?.rows?.length)return {...direct,errors:['没有可用的搜索通道，已保留公开页取证结果']};throw Error('没有可用的租金搜索通道');}
 let result=searchCache.get(cacheKey),hadFailure=false,hadIrrelevant=false;const failures=[];
 if(result?.error){if(direct)return {...direct,errors:[result.error]};throw Error(result.error);}
 const merged=[],seen=new Set(),sources=[];
 await Promise.all((result?[]:rentalSearchPlan(community,catalogEntry(community)?.sourceName||community.name)).map(async site=>{
  let found=false;const siteErrors=[];
  for(const provider of providers){
  try{
   const candidate=await search(env,site.query,{limit:6,providers:[provider],domain:'rental',market:community.market||'rent',maxOutputTokens:3000});
   hadFailure ||= !!candidate.errors?.length;
   for(const error of candidate.errors||[])siteErrors.push(site.name+'/'+provider+'：'+String(error.error||'请求失败').slice(0,180));
   const matches=(candidate.results||[]).filter(hit=>rentalSiteMatch(hit,site)&&rentalSearchMatch(hit,community));
   if(matches.length){for(const hit of matches.slice(0,2)){if(!seen.has(hit.url)){seen.add(hit.url);merged.push(hit);}}found=true;break;}
   hadIrrelevant ||= !!candidate.results?.length;
  }catch(error){hadFailure=true;siteErrors.push(site.name+'/'+provider+'：'+String(error.message||'请求异常').slice(0,180));}
  }
  sources.push({site:site.name,state:found?'matched':siteErrors.length?'failed':'empty'});
  if(!found)failures.push(...siteErrors);
 }));
 // A failed site-scoped query is not evidence that the community has no page.
 // One bounded, cross-site recovery query; reuse its links in the crawler pass.
 if(!result&&!merged.length){
  try{
   const candidate=await search(env,rentalRecoveryQuery(community),{limit:8,providers:[providers[0]],domain:'rental',market:community.market||'rent',maxOutputTokens:3000});
   for(const hit of candidate.results||[]){
    if(rentalSearchSites.some(site=>rentalSiteMatch(hit,site))&&rentalSearchMatch(hit,community)&&!seen.has(hit.url)){seen.add(hit.url);merged.push(hit);}
   }
   const errors=candidate.errors||[];
   hadFailure ||= errors.length>0;hadIrrelevant ||= !!candidate.results?.length&&!merged.length;
   failures.push(...errors.map(e=>'跨站补查：'+String(e.error||'请求失败').slice(0,180)));
   sources.push({site:'跨站补查',state:merged.length?'matched':errors.length?'failed':'empty'});
  }catch(error){hadFailure=true;failures.push('跨站补查：'+String(error.message||'请求异常').slice(0,180));sources.push({site:'跨站补查',state:'failed'});}
 }
 if(merged.length)result={results:merged,sources,errors:failures};
 if(!result){
  if(hadIrrelevant||hadFailure){const error=(hadIrrelevant?'搜索返回内容与目标物业'+(community.market==='sale'?'售价':'租金')+'不匹配，未采纳；':'搜索通道未取得有效网页候选；')+failures.join('；')+'。可重试失败站点';searchCache.set(cacheKey,{error});if(direct)return {...direct,errors:[error],sources};throw Error(error);}
  searchCache.set(cacheKey,{results:[]});
  return {...(direct||{rows:[],errors:[],searched:0}),sources};
 }
 const rows=[...(direct?.rows||[])],errors=[...directErrors,...(result.errors||[])];
 searchCache.set(cacheKey,result);
 for(const hit of result.results.slice(0,6)){
  try{
   let evidence={...hit,title:community.name+' · '+hit.title};
   if(channel==='crawler'&&community.market==='sale'&&leyoujiaCommunityCandidate(hit.url)){
    const page=await crawler(leyoujiaCommunityCandidate(hit.url));
    const parsed=await crawlLeyoujiaPage(page,community,crawler);
    if(parsed?.rows.length)rows.push(...parsed.rows);
    else errors.push('乐有家小区主页未取得名称一致的直接报价');
    continue;
   }
   if(channel==='crawler'&&community.market==='sale'){
    const candidate=fangCommunityCandidate(hit.url);
    if(candidate){
     const page=await crawler(candidate),price=fangCommunityPrice(page,community);
     for(const link of fangCommunityLinks(page,communities)){
      const linked={...link.community,market:community.market},key=JSON.stringify([linked.name,linked.kind,linked.point,linked.market||'rent']);
      if(!searchCache.has(key)||searchCache.get(key)?.error)searchCache.set(key,{results:[{url:link.url,title:linked.name+'小区',discoveredFrom:page.url}],sources:[{site:'房天下小区导航',state:'matched'}]});
     }
     if(price){rows.push({...price,discoveredFrom:hit.url});continue;}
     // A homepage with another name is not evidence for this phase/community.
     errors.push('房天下小区主页未取得与名称、区域一致的直接报价');continue;
    }
   }
   if(channel==='crawler'){assertRentalUrl(hit.url);evidence={...hit,...await crawler(hit.url)};const parsed=await crawlLeyoujiaPage(evidence,community,crawler);if(parsed){rows.push(...parsed.rows);continue;}const fangPrice=fangCommunityPrice(evidence,community);if(fangPrice){rows.push(fangPrice);continue;}const cards=community.market==='sale'?[]:fangRentalCards(evidence,community);if(cards.length){rows.push(...cards);continue;}}
   const row=rentalObservation(evidence,community,channel);if(row)rows.push(row);
  }catch(error){errors.push(error.message||'房源读取失败');}
 }
 return {rows,errors:[...new Set(errors)],searched:result.results.length,hits:result.results,sources:result.sources||[]};
}
