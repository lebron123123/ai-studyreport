import {toWgs84} from './core.mjs';
export function validatePortfolioLocation(raw){
 if(!raw||typeof raw!=='object')throw Error('定位资料无效');
 const text=(x,max)=>{if(typeof x!=='string'||x.length>max)throw Error('定位字段无效');return x;};
 const sourceKey=text(raw.sourceKey,32),sourceHash=text(raw.sourceHash,64);
 if(!/^[a-f0-9]{32}$/.test(sourceKey)||!/^[a-f0-9]{64}$/.test(sourceHash))throw Error('定位来源无效');
 const address=text(raw.address,300),evidence=text(raw.evidence,1000),name=text(raw.name,200),sourceFile=text(raw.sourceFile,250);
 const confirmed=raw.status==='confirmed';if(!['confirmed','pending'].includes(raw.status))throw Error('定位状态无效');
 let point=null;if(confirmed){if(!address||!evidence||!['GCJ02','WGS84'].includes(raw.crs)||!Array.isArray(raw.coordinate)||raw.coordinate.length!==2||!raw.coordinate.every(Number.isFinite))throw Error('确认定位必须有地址、坐标系和核对依据');point=toWgs84(raw.coordinate,raw.crs);if(!point)throw Error('坐标无效');}
 return {name,sourceKey,sourceHash,sourceFile,address,evidence,status:raw.status,point,crs:confirmed?raw.crs:'unknown',coordinate:confirmed?[...raw.coordinate]:null};
}
export function mergePortfolioLocation(data,input,at,by){
 const patch=validatePortfolioLocation(input),p=data.project?.portfolio;
 if(!p||p.sourceKey!==patch.sourceKey||p.name!==patch.name)throw Error('项目身份不一致，未修改');
 const next=structuredClone(data);
 next.project.portfolio={...p,address:patch.address,point:patch.point,locationStatus:patch.status,locationEvidence:patch.evidence,locationSource:patch};
 // Location-only change: financial records, source hash and other project settings remain intact.
 next.project.location=patch.address;
 next.workflow??={};next.workflow.management??={};next.workflow.management.activity??=[];
 next.workflow.management.activity.push({at,by:String(by),type:'ledgerLocation',text:'核对项目位置：'+patch.status,sourceHash:patch.sourceHash,previous:{address:p.address,point:p.point,status:p.locationStatus,evidence:p.locationEvidence}});
 return next;
}
