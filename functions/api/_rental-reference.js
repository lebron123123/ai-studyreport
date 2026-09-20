import {crawlLeyoujiaPage} from './_rental-leyoujia.js';
import {rentalName,rentalPriced} from '../../project-map/rental-identity.mjs';
// Explicit family mapping only. Same short name or proximity alone is not proof.
// User-confirmed example, public source identifies 一期, never relabelled as 二期.
const families=[{district:'宝安',targets:['曦城南区二期','招商华侨城曦城二期'],name:'招商华侨城曦城一期',url:'https://shenzhen.leyoujia.com/xq/detail/9677.html'}];
export async function collectPhaseReference(community,crawler){
 const family=families.find(f=>(community.district||'').replace(/区$/,'')===f.district&&f.targets.some(n=>rentalName(n)===rentalName(community.name)));
 if(!family)return [];
 const source={...community,name:family.name};
 const parsed=await crawlLeyoujiaPage(await crawler(family.url),source,crawler);
 return (parsed?.rows||[]).filter(rentalPriced).map(row=>({...row,community:community.name,address:community.address||'',referenceKind:'other-phase',sourceCommunity:family.name,sourceCommunityUrl:family.url,referenceReason:'本项目未取得有效报价；展示同名楼盘其他分期公开挂牌，仅供参考',locationPrecision:'reference-target'}));
}
