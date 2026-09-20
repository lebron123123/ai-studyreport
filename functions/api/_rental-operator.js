// Operator offer ranges are not paired rent/area observations.
import {rentalPageText} from './_rental-crawler.js';
import {rentalName} from '../../project-map/rental-identity.mjs';
export const operatorUrl='https://zzaj-h5.szajfw.com/room-type/list?project_id=3a1fd41a-6289-53fc-251c-5a2b7237555b';
export function operatorCommunity(c){return c.kind==='住宅'&&c.market!=='sale'&&c.district==='宝安区'&&rentalName(c.name)===rentalName('寓见安居·未来之光');}
export function operatorOffers(page,c,now=Date.now()){
 if(!operatorCommunity(c)||page.url!==operatorUrl)return [];
 const rows=[];
 for(const m of page.html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){
  const html=m[1],text=rentalPageText(html);
  if(!text.includes('寓见安居|宝安-未来之光'))continue;
  const path=html.match(/href="(\/room-type\/detail\?id=[a-f0-9-]+)"/)?.[1];
  const rent=text.match(/(\d+)-(\d+)\s*元\/月起/),area=text.match(/面积:\s*约(\d+)-(\d+)m\s*2/);
  if(!path||!rent||!area)continue;
  const rentRange=rent.slice(1).map(Number),areaRange=area.slice(1).map(Number);
  if([...rentRange,...areaRange].some(n=>!Number.isFinite(n)||n<=0)||rentRange[0]>rentRange[1]||areaRange[0]>areaRange[1])continue;
  rows.push({version:1,url:new URL(path,operatorUrl).href,community:c.name,address:c.address||'',district:c.district,street:c.street||'',point:c.point,kind:'住宅',market:'rent',channel:'crawler',status:'candidate',monthlyRent:null,area:null,rentRange,areaRange,priceBasis:'operator-range',propertySubtype:'保租房运营方报价',layout:text.match(/一房一厅|两房一厅|单间/)?.[0]||null,leaseType:'整租',title:c.name+'公开户型报价',evidence:text,evidenceUrl:operatorUrl,observedAt:now,locationPrecision:'community'});
 }
 return rows;
}
export async function crawlOperator(c,crawler){
 if(!operatorCommunity(c))return null;
 const rows=operatorOffers(await crawler(operatorUrl),c);
 if(!rows.length)throw Error('运营方公开户型页结构变化，未取得可核对的报价区间');
 return {rows,errors:[],searched:1};
}
