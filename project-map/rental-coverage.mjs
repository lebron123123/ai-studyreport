import {rentalName,rentalPriced} from './rental-identity.mjs';

// The inventory is fixed before collection. Missing/failed attempts stay in the denominator.
export function rentalCoverage(communities,observations){
 const items=communities.map(community=>{
  const rows=observations.filter(r=>rentalName(r.community)===rentalName(community.name)&&rentalPriced(r)
   &&(!community.district||r.district===community.district)
   &&(!community.point||(Array.isArray(r.point)&&community.point.every((n,i)=>Number.isFinite(r.point[i])&&Math.abs(n-r.point[i])<0.001))));
  const direct=rows.filter(r=>!r.referenceKind),reference=rows.filter(r=>r.referenceKind);
  return {name:community.name,direct:direct.length>0,reference:reference.length>0,rent:direct.some(r=>r.market!=='sale'),sale:direct.some(r=>r.market==='sale')};
 });
 const denominator=items.length,direct=items.filter(x=>x.direct).length,withReference=items.filter(x=>x.direct||x.reference).length;
 return {denominator,direct,withReference,missing:denominator-withReference,directRate:denominator?direct/denominator:null,referenceInclusiveRate:denominator?withReference/denominator:null,passed:denominator>0&&direct/denominator>=0.9,items};
}
