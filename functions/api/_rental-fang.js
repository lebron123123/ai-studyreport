// Parse individual public listing cards, never whole-page recommendation prices.
import {rentalPageText} from './_rental-crawler.js';
import {rentalObservation} from '../../project-map/rental-core.mjs';
import {rentalName} from '../../project-map/rental-identity.mjs';
export function fangCommunityCandidate(value){
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 let id;
 if(u.hostname==='www.fang.com')id=u.pathname.match(/^\/xiaoqu\/sz-(\d+)\/$/)?.[1];
 if(u.hostname==='sz.esf.fang.com')id=u.pathname.match(/^\/loupan\/(\d+)(?:\.htm|\/(?:strategy|housedetail|fangjia)\.htm|\/chuzu\/(?:list\/)?)$/)?.[1];
 if(u.hostname==='fangjia.fang.com')id=u.pathname.match(/^\/sz\/process\/(\d+)\.htm$/)?.[1];
 if(u.hostname==='sz.esf.fang.com'&&!id)id=u.pathname.match(/^\/loupan\/(\d+)\/(?:chushou|chuzu)\/list\/(?:[a-z0-9-]+\/)?$/)?.[1];
 if(u.hostname==='m.fang.com')id=u.pathname.match(/^\/esf\/sz_xm(\d+)\/$/)?.[1]||u.pathname.match(/^\/xiaoqu\/sz\/(\d+)\.html$/)?.[1];
 // This is a candidate endpoint, NEVER an observation until the fetched page's
 // exact community heading and district validate in fangCommunityPrice.
 return id?'https://www.fang.com/xiaoqu/sz-'+id+'/':null;
}
export function fangCommunityLinks(page,communities){
 if(!/^https:\/\/www\.fang\.com\/xiaoqu\/sz-\d+\/$/.test(page.url||''))return [];
 const names=new Map(communities.map(c=>[rentalName(c.name),c])),found=new Map();
 for(const match of (page.html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const name=rentalPageText(match[2]),community=names.get(rentalName(name));if(!community)continue;
  let url;try{url=new URL(match[1],page.url).href;}catch{continue;}
  const candidate=fangCommunityCandidate(url);if(!candidate)continue;
  found.set(community.name,{community,url:candidate,discoveredFrom:page.url});
 }
 return [...found.values()];
}
export function fangCommunityPrice(page,community){
 if(community.market!=='sale'||!/^https:\/\/www\.fang\.com\/xiaoqu\/sz-\d+\/$/.test(page.url||''))return null;
 const blocks=[...(page.html||'').matchAll(/<div\b[^>]*class=["']infor_xq(?:\s+[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/gi)];
 for(const [,html] of blocks){
  const title=rentalPageText(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||'').replace(/基本信息$/,'');
  if(rentalName(title)!==rentalName(community.name))continue;
  const price=rentalPageText(html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'');
  if(!/^\d[\d,]*(?:\.\d+)?\s*元\/㎡\s*[（(]\d{1,2}月参考价[）)]$/.test(price))continue;
  const text=rentalPageText(page.html),district=community.district?.replace(/区$/,'');
  if(district&&!text.includes(district+'小区二手房')&&!text.includes(district+'区小区二手房'))return null;
  const row=rentalObservation({url:page.url,title:community.name+'小区参考售价',text:community.name+' '+price},community,'crawler');
  return row?{...row,priceBasis:'listing-reference'}:null;
 }
 return null;
}
export function fangRentalCards(page,community){
 if(!/^https:\/\/sz\.esf\.fang\.com\//.test(page.url||''))return [];
 const rows=[],seen=new Set();
 for(const m of (page.html||'').matchAll(/<dl\b[^>]*id=["']houseRow_[^"']+["'][^>]*>([\s\S]*?)<\/dl>/gi)){
  const html=m[1],address=html.match(/<p\b[^>]*class=["']add_shop["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]||'';
  const name=address.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  if(!name||rentalPageText(name)!==community.name)continue;
  const price=html.match(/class=["']price_right["'][^>]*>([\s\S]*?)<\/dd>/i)?.[1]||'';
  const amount=rentalPageText(price).match(/^(\d+(?:\.\d+)?)\s*元\/月$/)?.[1];
  const facts=rentalPageText(html.match(/class=["']tel_shop["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]||'');
  const area=facts.match(/建筑面积\s*(\d+(?:\.\d+)?)㎡/)?.[1];
  const href=html.match(/href=["']((?:https:)?\/\/sz\.zu\.fang\.com\/chuzu\/\d+_\d+_\d+\.htm)["']/)?.[1];
  if(!amount||!area||!href||seen.has(href))continue;
  const lease=/整租/.test(facts)?'整租':/合租/.test(facts)?'合租':'租赁形式待核实';
  const row=rentalObservation({url:new URL(href,page.url).href,title:community.name+'公开挂牌',text:`${community.name} ${lease} ${amount}元/月 建筑面积${area}㎡`},community,'crawler');
  if(row){rows.push(row);seen.add(href);}
 }
 return rows;
}
