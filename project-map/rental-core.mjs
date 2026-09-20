// Public rental observations. A search hit is evidence, not a verified transaction.
import {distance} from './research-core.mjs';
export const rentalVersion=1;
export function rentalQuery(input={}) {
 const point=input.point;
 if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[0]<113.5||point[0]>114.8||point[1]<22.3||point[1]>23)throw Error('请选择深圳范围内的已确认地点');
 const radius=Number(input.radius||2000),kind=input.kind||'住宅';
 if(![500,1000,2000,3000].includes(radius)||!['住宅','商铺','办公'].includes(kind))throw Error('租金范围或物业类型无效');
 if(input.market && !['rent','sale'].includes(input.market))throw Error('租售类别无效');
 return {point:[...point],radius,kind,...(input.market==='sale'?{market:'sale'}:{})};
}
export function rentalUrl(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('仅支持公开HTTPS房源链接');
 u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','from','spm'])u.searchParams.delete(k);
 return u.href;
}
export function rentalObservation(hit,community,channel,now=Date.now()) {
 const url=rentalUrl(hit.url),text=String(hit.title||'')+' '+String(hit.text||hit.snippet||'');
 if(!community.name||!text.includes(community.name))return null;
 if(community.market==='sale'){
  const matches=[...text.matchAll(/(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s*元\s*[/／]\s*(?:㎡|平米|平方米|m²)(?!\s*[·/／]\s*(?:月|天|日))/g)];
  const saleUnitPrice=matches.length===1&&!/租金|元\s*[/／]\s*月|\d\s*[-~–—至]\s*\d/.test(text)?Number(matches[0][1].replaceAll(',','')):null;
  return {version:rentalVersion,url,title:String(hit.title||community.name).slice(0,240),community:community.name,address:community.address||'',district:community.district||'',street:community.street||'',point:community.point,locationPrecision:'community',kind:community.kind,market:'sale',channel,monthlyRent:null,area:null,saleUnitPrice:saleUnitPrice>0&&saleUnitPrice<1000000?saleUnitPrice:null,evidence:String(hit.text||hit.snippet||'').slice(0,1200),observedAt:now,status:'candidate'};
 }
 // Only one unambiguous monthly rent and area; ranges and per-day prices stay unpriced.
 const prices=[...text.matchAll(/(?<![\d.\-~—至])(\d[\d,]*(?:\.\d+)?)\s*元\s*\/\s*月/g)];
 const areas=[...text.matchAll(/(?<![\d.\-~—至])(\d+(?:\.\d+)?)\s*(?:㎡|平米|平方米|m²)/g)];
 const ambiguous=/\d\s*[-~—至]\s*\d|元\s*\/\s*(?:天|日)|元起|月起/.test(text);
 const rent=!ambiguous&&prices.length===1?Number(prices[0][1].replaceAll(',','')):null;
 const area=!ambiguous&&areas.length===1?Number(areas[0][1]):null;
 return {version:rentalVersion,url,title:String(hit.title||community.name).slice(0,240),community:community.name,address:community.address||'',district:community.district||'',street:community.street||'',point:community.point,locationPrecision:'community',kind:community.kind,channel,monthlyRent:rent>0&&rent<10000000?rent:null,area:area>0&&area<100000?area:null,leaseType:/合租/.test(text)?'合租':/整租/.test(text)?'整租':'待核实',evidence:String(hit.text||hit.snippet||'').slice(0,1200),observedAt:now,publishedAt:hit.publishedAt||null,status:'candidate'};
}
export function rentalInRange(row,query) {return (row.market||'rent')===(query.market||'rent')&&row.kind===query.kind&&Array.isArray(row.point)&&row.point.length===2&&row.point.every(Number.isFinite)&&distance(query.point,row.point)<=query.radius;}
export function rentalFresh(row,now=Date.now()) {return Number.isFinite(row.observedAt)&&row.observedAt<=now&&now-row.observedAt<30*86400000;}
export function rentalStatistics(rows,now=Date.now()) {
 const accepted=rows.filter(r=>!r.referenceKind&&r.propertySubtype!=='别墅'&&r.priceBasis!=='policy'&&r.status==='verified'&&r.leaseType==='整租'&&r.monthlyRent>0&&r.area>0&&rentalFresh(r,now));
 const values=accepted.map(r=>r.monthlyRent/r.area).sort((a,b)=>a-b),n=values.length;
 return {count:n,median:n?(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2:null,unit:'元/㎡·月',basis:'已核实整租挂牌样本；不是成交价'};
}
export async function rentalCollectChannels(channels,{onResult,onError}) {
 return Promise.all(Object.entries(channels).map(async([name,run])=>{
  try{const rows=await run();await onResult(name,rows);return {channel:name,status:'completed',count:rows.length};}
  catch(error){const message=error?.message||'采集失败';await onError(name,message);return {channel:name,status:'failed',error:message};}
 }));
}
