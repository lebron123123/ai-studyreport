// Diagnostic first pass across all ten centers. Never reports subset as range acceptance.
import {readFile,writeFile} from 'node:fs/promises';
import {collectRentalCommunity} from '../functions/api/_rental-collect.js';
import {createRentalCrawler} from '../functions/api/_rental-crawler.js';
import {rentalPriced} from '../project-map/rental-identity.mjs';
import {rentalCoverage} from '../project-map/rental-coverage.mjs';
const path=new URL('../outputs/rental-surrounding-ten-20260918.json',import.meta.url);
const report=JSON.parse(await readFile(path,'utf8'));
const depth=Number(process.env.RENTAL_PROBE_DEPTH||1);
if(!Number.isInteger(depth)||depth<1||depth>20)throw Error('诊断深度须为1至20');
for(let index=0;index<depth;index++)for(const project of report.projects){
 const base=project.inventory.communities[index];if(!base)continue;
 project.attempts||={};project.observations||=[];
 for(const market of ['sale','rent']){
  const key=base.name+'|'+market;if(project.attempts[key])continue;
  const community={...base,market},searchCache=new Map(),crawler=createRentalCrawler({maxPages:12}),attempt={startedAt:new Date().toISOString(),rows:[],errors:[],hits:[]};
  for(const channel of ['search','crawler']){
   try{const out=await collectRentalCommunity(process.env,community,channel,{crawler,searchCache});attempt.rows.push(...out.rows.filter(rentalPriced));attempt.errors.push(...out.errors);attempt.hits.push(...(out.hits||[]));}
   catch(error){attempt.errors.push(channel+': '+error.message);}
  }
  attempt.finishedAt=new Date().toISOString();project.attempts[key]=attempt;
  project.observations.push(...attempt.rows);project.coverage=rentalCoverage(project.inventory.communities,project.observations);
  await writeFile(path,JSON.stringify(report,null,2));
  console.log(JSON.stringify({project:project.name,competitor:base.name,market,rows:attempt.rows.length,errors:attempt.errors,hits:attempt.hits.map(h=>h.url)}));
 }
}
