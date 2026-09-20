// Verified public community pages, checked 2026-09-17. Not a city-wide catalog.
// Explicit aliases only; nearby recommendations must never inherit this location.
import {rentalPageText} from './_rental-crawler.js';
import {rentalObservation} from '../../project-map/rental-core.mjs';
import {rentalName} from '../../project-map/rental-identity.mjs';
const origin='https://shenzhen.leyoujia.com';
export const rentalCatalog=[
 {names:['万科香蜜府','万科瑧山府（三期）','万科瑧山府三期'],id:'855813',sourceName:'万科瑧山府（三期）',district:'福田区'},
 {names:['亚迪三村'],id:'890833',sourceName:'亚迪三村',district:'坪山区'},
 {names:['雅福居'],id:'2706',sourceName:'雅福居',district:'福田区'},
 {names:['新世界誉名别苑','新世界名镌'],id:'47308',sourceName:'新世界名镌',district:'宝安区'},
 {names:['招商华侨城曦城一期'],id:'9677',sourceName:'招商华侨城曦城一期',district:'宝安区'},
 {names:['金洪名筑','甲子塘金洪名筑'],id:'892620',sourceName:'甲子塘金洪名筑',district:'光明区'},
 {names:['万科未来之光家园','未来之光家园'],id:'885641',sourceName:'未来之光家园',district:'宝安区'},
 {names:['锦绣江南四期'],id:'104',sourceName:'锦绣江南四期',district:'龙华区'},
 {names:['纯海岸雅居','纯海岸'],id:'1199',sourceName:'纯海岸'},
 {names:['博海名苑','博海茗苑'],id:'9079',sourceName:'博海名苑'},
 {names:['京武·浪琴半岛','浪琴半岛'],id:'1761',sourceName:'浪琴半岛'},
 {names:['岸芷汀兰','中信岸芷汀兰','中信岸芷汀兰花园'],id:'8286',sourceName:'中信岸芷汀兰'}
];
export function catalogEntry(community){
 if(community.kind!=='住宅')return null;
 return rentalCatalog.find(entry=>entry.names.some(n=>rentalName(n)===rentalName(community.name))&&(community.district||'').replace(/区$/,'')===(entry.district||'南山区').replace(/区$/,''))||null;
}
export function rentalCards(html,community,entry){
 const rows=[],seen=new Set();
 for(const match of html.matchAll(/<li\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)){
  const card=match[1],attrs=[...card.matchAll(/<p\b[^>]*class=["']attr["'][^>]*>([\s\S]*?)<\/p>/gi)].map(m=>rentalPageText(m[1]));
  // Rental list cards explicitly identify their community and residential usage.
  if(!attrs.some(t=>t.startsWith(entry.sourceName+' ')&&/普通住宅|公寓|花园式洋房|别墅/.test(t)))continue;
  const path=card.match(/href=["'](\/zf\/detail\/[A-Za-z0-9]+(?:\.html)?)["']/)?.[1];
  const amount=card.match(/class=["']salePrice["'][^>]*>\s*(\d+(?:\.\d+)?)\s*<\/span>\s*元\/月/)?.[1];
  const area=attrs.join(' ').match(/建筑面积\s*(\d+(?:\.\d+)?)㎡/)?.[1];
  if(!path||!amount||!area||seen.has(path))continue;
  const lease=/整租/.test(rentalPageText(card))?'整租':/合租/.test(rentalPageText(card))?'合租':'租赁形式待核实';
  const evidence=community.name+' '+entry.sourceName+' '+lease+' '+amount+'元/月 建筑面积'+area+'㎡';
  const row=rentalObservation({url:origin+path,title:community.name+'出租房源',text:evidence},community,'crawler');
  if(row){row.layout=rentalPageText(card).match(/[一二三四五六七八九十两\d]+\s*[室房](?:\s*\d+厅)?/)?.[0]||null;row.propertySubtype=attrs.join(' ').match(/普通住宅|公寓|花园式洋房|别墅/)?.[0]||null;rows.push(row);seen.add(path);}
 }
 return rows;
}
export async function crawlCatalog(community,crawler){
 const entry=catalogEntry(community);if(!entry)return null;
 const home=await crawler(origin+'/xq/detail/'+entry.id+'.html');
 const link=[...home.html.matchAll(/<(?:a|span)\b[^>]*(?:data-)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:a|span)>/gi)]
  .find(m=>rentalPageText(m[2])==='小区租房');
 if(!link)throw Error('乐有家小区页未提供公开租房入口');
 const url=new URL(link[1],origin);
 if(url.origin!==origin||url.pathname.replace(/\/$/,'')!=='/xq/detail/zf/'+entry.id||url.search)throw Error('小区租房入口发生变化，需重新核实');
 const page=await crawler(url.href),rows=rentalCards(page.html,community,entry);
 if(!rows.length&&!/暂无.*(?:租房|房源)|没有.*房源|共找到\s*0\s*套/.test(page.text))throw Error('公开租房页未解析到可核对卡片，未将其误报为无房源');
 return {rows,errors:[],searched:2};
}
