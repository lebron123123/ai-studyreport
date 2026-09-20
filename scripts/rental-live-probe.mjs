// Public-place connectivity probe; no business database reads or writes.
import {rentalCommunities,collectRentalCommunity} from '../functions/api/_rental-collect.js';
import {wrSearch} from '../functions/api/_web-research-core.js';
const query={point:process.argv[2]==='huayue'?[114.02905103405446,22.63948998565567]:[113.947,22.525],radius:2000,kind:'住宅'};
try{
 const communities=await rentalCommunities(process.env,query);
 console.log(JSON.stringify({stage:'places',names:communities.map(c=>c.name)}));
 const searchCache=new Map();
 if(communities.length)for(const channel of ['search','crawler']){
  try{const result=await collectRentalCommunity(process.env,communities[Number(process.argv[3])||0],channel,{searchCache,search:async(...args)=>{const r=await wrSearch(...args);console.log(JSON.stringify({channel,query:args[1],provider:r.provider,errors:r.errors,candidates:r.results.map(x=>({title:x.title,url:x.url}))}));return r;}});console.log(JSON.stringify({channel,...result}));if(!result.rows.length)process.exitCode=1;}
  catch(e){console.log(JSON.stringify({channel,error:e.message}));process.exitCode=1;}
 }
}catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
