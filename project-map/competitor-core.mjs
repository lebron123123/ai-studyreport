// POI positions and rental evidence are independent: no price is not no competitor.
import {rentalReferenceLabel,rentalPriced,rentalOfferLabel} from './rental-identity.mjs';
export function rentalUnitPrice(row) {
 return Number.isFinite(row.monthlyRent)&&row.monthlyRent>0&&Number.isFinite(row.area)&&row.area>0 ? row.monthlyRent/row.area : null;
}
export function rentalExample(row) {
 const text=[row.layout,row.title,row.evidence].filter(Boolean).join(' ');
 const room=text.match(/([一二三四五六七八九十两\d]+)\s*[室房]/);
 const layout=room?room[1]+'房':'户型未披露';
 return (row.propertySubtype?row.propertySubtype+' · ':'')+row.area+'㎡ '+layout+(row.leaseType==='合租'?'（合租）':'')+'：'+row.monthlyRent+'元/月';
}
export function competitorRows(results) {
 const groups=new Map();
 const add=(name,kind,point)=>{
  if(!name||!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))return null;
  const key=JSON.stringify([name,kind,point.map(v=>v.toFixed(4))]);
  if(!groups.has(key))groups.set(key,{id:key,name,kind,point,items:[]});
  return groups.get(key);
 };
 for(const [kind,result] of results){
  for(const p of result.run?.competitors||[]){const g=add(p.name,kind,p.point);if(g){const tasks=Object.values(result.run?.channels||{}).map(c=>c.tasks?.[p.name]).filter(Boolean);g.priceState=tasks.some(t=>t.state==='failed')?'查询失败，可重试':result.run?.state==='running'?'价格查询中…':result.run?.state==='failed'?'查询失败，可重试':'未取得公开报价';}}
  for(const row of result.items||[]){const group=add(row.community,kind,row.point);if(group&&!group.items.some(x=>x.url===row.url))group.items.push(row);}
 }
 return [...groups.values()].map(group=>{
  const fresh=group.items.filter(x=>!x.stale&&rentalPriced(x)),direct=fresh.filter(x=>!x.referenceKind);
  const selected=direct.length?direct:fresh;
  const reference=direct.length?'':[...new Set(selected.map(rentalReferenceLabel).filter(Boolean))].join('；');
  const offers=selected.filter(x=>rentalOfferLabel(x));
  if(group.kind!=='售价'&&offers.length){
   const amounts=offers.flatMap(x=>x.rentRange);
   return {...group,rent:'运营方 '+Math.min(...amounts)+'–'+Math.max(...amounts)+' 元/月起',examples:offers.slice(0,3).map(x=>(x.areaRange?'约'+x.areaRange.join('–')+'㎡ ':'')+(x.layout||'')+'：'+rentalOfferLabel(x)).concat('面积与租金区间未逐套配对，不折算单价')};
  }
  if(group.kind==='售价'){
   const prices=selected.map(x=>x.saleUnitPrice);
   const min=Math.min(...prices),max=Math.max(...prices);
   return {...group,examples:reference?[reference]:[],rent:prices.length?(reference?'其他分期参考 ':'参考售价 ')+min.toFixed(0)+(min===max?'':'–'+max.toFixed(0))+' 元/㎡':group.priceState||'售价待核实'};
  }
  const valid=selected.filter(x=>rentalUnitPrice(x)!==null);
  const prices=valid.map(rentalUnitPrice);
  const min=Math.min(...prices),max=Math.max(...prices);
  const examples=[...(reference?[reference]:[]),...[...new Set(valid.map(rentalExample))].slice(0,3)];
  return {...group,examples,rent:prices.length?'挂牌 '+min.toFixed(1)+(min.toFixed(1)===max.toFixed(1)?'':'–'+max.toFixed(1))+' 元/㎡·月':group.items.some(x=>!x.stale&&x.monthlyRent>0)?'面积待核实，暂不折算':group.priceState||'租金待核实'};
 });
}
