// Formatting normalization preserves phase and directional identity.
export function rentalName(value) {
 return String(value||'').replace(/[·•\s（）()]/g,'').replace(/([1-9])期/g,(_,n)=>'一二三四五六七八九'[Number(n)-1]+'期');
}
export function rentalReferenceLabel(row) {
 if(!row.referenceKind)return '';
 return (row.referenceKind==='other-phase'?'其他分期参考价':'周边参考价')+' · '+(row.sourceCommunity||'来源待核实')+'（非本项目报价）';
}
export function rentalPriced(row) {
 if(row.market!=='sale'&&row.priceBasis==='operator-range'&&Array.isArray(row.rentRange)&&row.rentRange.length===2&&row.rentRange.every(n=>Number.isFinite(n)&&n>0)&&row.rentRange[1]>=row.rentRange[0])return true;
 return row.market==='sale'?Number.isFinite(row.saleUnitPrice)&&row.saleUnitPrice>0:Number.isFinite(row.monthlyRent)&&row.monthlyRent>0&&Number.isFinite(row.area)&&row.area>0;
}
export function rentalOfferLabel(row){
 return row.priceBasis==='operator-range'&&rentalPriced(row)?row.rentRange.join('–')+'元/月起（运营方区间）':'';
}
