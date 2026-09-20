import {validatePortfolioLocation} from './portfolio-location.mjs';
export const portfolioCategories={potential:'潜力项目',progress:'在推进中',completed:'已完成（租 / 售等）'};
export function validatePortfolio(raw){
 if(!raw||typeof raw!=='object'||!portfolioCategories[raw.category])throw Error('项目分类无效');
 const text=(v,n)=>{if(typeof v!=='string'||v.length>n)throw Error('台账字段格式或长度无效');return v;};
 const name=text(raw.name,200).trim();if(!name)throw Error('项目名称不能为空');
 if(!/^[a-f0-9]{32}$/.test(raw.sourceKey)||! /^[a-f0-9]{64}$/.test(raw.sourceHash))throw Error('台账来源标识无效');
 if(!Array.isArray(raw.records)||!raw.records.length||raw.records.length>10)throw Error('台账来源页无效');
 const records=raw.records.map(r=>{if(!Number.isInteger(r.row)||r.row<1||!Array.isArray(r.fields)||r.fields.length>60)throw Error('台账行无效');return {sheet:text(r.sheet,100),row:r.row,fields:r.fields.map(f=>{if(f.value!==null&&!['string','number','boolean'].includes(typeof f.value))throw Error('原始值无效');return {label:text(f.label,300),value:f.value,display:text(f.display,3000),cell:text(f.cell,20),numberFormat:text(f.numberFormat||'',200),formula:text(f.formula||'',2000)};})};});
 const point=raw.point;
 if(point!=null&&(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90))throw Error('坐标无效');
 const confirmed=raw.locationStatus==='confirmed'&&!!point&&!!raw.locationEvidence;
 const locationSource=raw.locationSource?validatePortfolioLocation(raw.locationSource):null;
 return {name,category:raw.category,potentialTier:['A','B'].includes(raw.potentialTier)?raw.potentialTier:'',sourceKey:raw.sourceKey,sourceHash:raw.sourceHash,sourceFile:text(raw.sourceFile,250),owner:text(raw.owner||'',100),type:text(raw.type||'',100),address:text(raw.address||'',300),point:confirmed?point:null,locationStatus:confirmed?'confirmed':'pending',locationEvidence:text(raw.locationEvidence||'',1000),...(locationSource?{locationSource}:{}),records,preferredRecord:Number.isInteger(raw.preferredRecord)&&raw.preferredRecord>=0&&raw.preferredRecord<records.length?raw.preferredRecord:records.length-1};
}
export function portfolioMapItem(id,p){return {id,name:p.name,address:p.address,district:'',type:p.type,stage:portfolioCategories[p.category],source:'正式项目库（只读）',point:p.locationStatus==='confirmed'?p.point:null,confirmed:p.locationStatus==='confirmed',portfolio:p};}
