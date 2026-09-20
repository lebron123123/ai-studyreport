// Import only priced public observations from the fixed ten-center live run.
// Default is read-only audit; --save persists through the existing idempotent store.
import {readFile,writeFile} from 'node:fs/promises';
import {createD1Shim} from '../local-server/d1-shim.js';
import {saveRentalObservation,readRentalObservations} from '../functions/api/_rental-store.js';
import {rentalPriced} from '../project-map/rental-identity.mjs';
import {rentalInRange} from '../project-map/rental-core.mjs';
const report=JSON.parse(await readFile(new URL('../outputs/rental-surrounding-recovery-20260919.json',import.meta.url),'utf8'));
const save=process.argv.includes('--save'),DB=save?createD1Shim(process.env.DATABASE_URL):null,summary=[];
try{
 for(const project of report.projects){
  const ids=[];
  for(const row of project.observations||[]){
   const match=project.inventory.communities.find(c=>c.name===row.community);
   if(!match||!rentalPriced(row)||!row.evidence||!row.observedAt||!rentalInRange(row,{point:match.point,radius:500,kind:'住宅',market:row.market||'rent'}))continue;
   if(!/^https:\/\/(www\.fang\.com|sz\.esf\.fang\.com|sz\.zu\.fang\.com|shenzhen\.leyoujia\.com)\//.test(row.url))continue;
   if(save)ids.push(await saveRentalObservation(DB,row));else ids.push(row.url);
  }
  summary.push({project:project.name,observations:ids.length,distinct:new Set(ids).size,coverage:project.coverage});
 }
 console.log(JSON.stringify({saved:save,projects:summary.map(({project,observations,distinct,coverage})=>({project,observations,distinct,direct:coverage.direct,total:coverage.denominator}))},null,2));
 if(save)await writeFile(new URL('../outputs/rental-recovery-stored-20260919.json',import.meta.url),JSON.stringify({savedAt:new Date().toISOString(),projects:summary},null,2));
}finally{if(DB)await DB._close();}
