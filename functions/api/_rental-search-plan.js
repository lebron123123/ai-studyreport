// Each source gets its own query; one site's hit must not suppress the others.
export const rentalSearchSites=[
 {id:'lianjia',name:'链家',domain:'lianjia.com'},
 {id:'fang',name:'房天下',domain:'fang.com'},
 {id:'leyoujia',name:'乐有家',domain:'leyoujia.com'}
];
export function rentalSearchPlan(community,name=community.name){
 const use=community.market==='sale'?'房价':community.kind==='办公'?'写字楼出租':community.kind==='商铺'?'商铺出租':'租房';
 name=String(name||'').replace(/[·•\s]/g,'');
 return rentalSearchSites.map(site=>({...site,query:`site:${site.domain} 深圳 ${community.district||''} ${name} ${use}`}));
}
export function rentalRecoveryQuery(community){
 // Keep the phase in the query: removing it would turn another phase into a
 // false direct match. Omit site: because some search providers lose recall.
 return `深圳 ${community.district||''} ${String(community.name||'').replace(/[·•\s]/g,'')} ${community.market==='sale'?'小区 房价':'租房 公寓'} 乐有家 房天下 链家`;
}
export function rentalSiteMatch(hit,site){
 try{const url=new URL(hit.url),host=url.hostname;if(!(host===site.domain||host.endsWith('.'+site.domain)))return false;
  // Search engines sometimes return another city's page under a Shenzhen title.
  if(site.id==='leyoujia'&&!['leyoujia.com','www.leyoujia.com','shenzhen.leyoujia.com','wap.leyoujia.com'].includes(host))return false;
  if(host==='wap.leyoujia.com'&&!url.pathname.startsWith('/shenzhen/'))return false;
  return true;
 }catch{return false;}
}
export function rentalCommunityEligible(community){
 if(community.kind!=='住宅')return true;
 return !/商务写字楼|旅馆|宿舍/.test(community.poiType||'')&&!/工地|生活区\d*栋|产业园|工业园|综合楼|停车场|售楼|接待|服务中心/.test(community.name||'');
}
