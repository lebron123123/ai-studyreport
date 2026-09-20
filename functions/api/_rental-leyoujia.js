// Only bind prices to the named community's header/cards, never recommendations.
import {rentalPageText} from './_rental-crawler.js';
import {catalogEntry,rentalCards} from './_rental-catalog.js';
import {rentalObservation} from '../../project-map/rental-core.mjs';
import {rentalName} from '../../project-map/rental-identity.mjs';
export function leyoujiaCommunityCandidate(value){
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol!=='https:'||u.hostname!=='shenzhen.leyoujia.com'||u.username||u.password||u.port)return null;
 const id=u.pathname.match(/^\/xq\/detail\/(?:esf\/|zf\/)?(\d+)(?:\.html|\/)?$/)?.[1];
 return id?'https://shenzhen.leyoujia.com/xq/detail/'+id+'.html':null;
}
export function leyoujiaCommunityPage(page,community){
 const u=new URL(page.url);
 if(u.hostname!=='shenzhen.leyoujia.com'||!/^\/xq\/detail\/(?:zf\/)?\d+(?:\.html|\/)?$/.test(u.pathname))return null;
 const entry=catalogEntry(community)||{names:[community.name],sourceName:community.name};
 const title=rentalPageText(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 if(!entry.names.some(n=>rentalName(title).includes(rentalName(n)+'小区')))return null;
 if(community.market==='sale'){
  // The first page heading ends before news/recommendations and identifies this community.
  const heading=page.text.split('深圳房产资讯')[0];
  const match=heading.match(/在售均价\s*([\d,]+)\s*元\s*\/\s*㎡/);
  if(!match)return {rows:[]};
  const row=rentalObservation({url:page.url,title:community.name+'小区在售均价',text:community.name+' 在售均价 '+match[1]+'元/㎡'},community,'crawler');
  return {rows:row?[row]:[]};
 }
 return {rows:rentalCards(page.html,community,entry)};
}
export async function crawlLeyoujiaPage(page,community,crawler){
 const parsed=leyoujiaCommunityPage(page,community);if(!parsed)return null;
 if(community.market==='sale'||/\/zf\//.test(new URL(page.url).pathname))return parsed;
 const id=new URL(page.url).pathname.match(/\/(\d+)(?:\.html|\/)?$/)[1];
 const link=[...page.html.matchAll(/<(?:a|span)\b[^>]*(?:data-)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:a|span)>/gi)].find(m=>rentalPageText(m[2])==='小区租房');
 if(!link)return parsed;
 const u=new URL(link[1],page.url);
 if(u.origin!==new URL(page.url).origin||u.pathname.replace(/\/$/,'')!=='/xq/detail/zf/'+id||u.search)throw Error('小区租房入口发生变化');
 return leyoujiaCommunityPage(await crawler(u.href),community);
}
