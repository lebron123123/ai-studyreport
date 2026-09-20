// Public-page navigation recovery. Fixed original inventory; no price-based
// selection, no invented observations, no replacement of unsuccessful attempts.
import {readFile,writeFile} from 'node:fs/promises';
import {createRentalCrawler} from '../functions/api/_rental-crawler.js';
import {fangCommunityCandidate,fangCommunityPrice,fangCommunityLinks} from '../functions/api/_rental-fang.js';
import {rentalIsResearchCenter} from '../functions/api/_rental-inventory.js';
import {rentalCoverage} from '../project-map/rental-coverage.mjs';
import {wrSearch} from '../functions/api/_web-research-core.js';
import {rentalName} from '../project-map/rental-identity.mjs';
import {leyoujiaCommunityCandidate,crawlLeyoujiaPage} from '../functions/api/_rental-leyoujia.js';
import {rentalRecoveryQuery} from '../functions/api/_rental-search-plan.js';
const source=new URL('../outputs/rental-surrounding-ten-20260918.json',import.meta.url);
const target=new URL('../outputs/rental-surrounding-recovery-20260919.json',import.meta.url);
let report;try{report=JSON.parse(await readFile(target,'utf8'));}catch{report=JSON.parse(await readFile(source,'utf8'));report.recoveryStartedAt=new Date().toISOString();}
for(const project of report.projects){
 if(process.argv.length>2&&!process.argv.slice(2).includes(project.name))continue;
 const communities=project.inventory.communities.filter(c=>!rentalIsResearchCenter(c,{projectName:project.name}));
 project.excludedCenter=project.inventory.communities.filter(c=>!communities.includes(c)).map(c=>c.name);
 project.navigationAttempts||=[];project.observations||=[];
 const queue=[],seen=new Set(project.navigationAttempts.filter(a=>(a.state==='fetched'&&(a.saleUnitPrice||a.parserVersion===2))||/HTTP 404/.test(a.error||'')).map(a=>a.url));
 for(const previous of project.navigationAttempts){const community=communities.find(c=>c.name===previous.name);if(community&&previous.state==='fetched'&&!previous.saleUnitPrice&&previous.parserVersion!==2)queue.push({community,url:previous.url,discoveredFrom:previous.discoveredFrom});}
 for(const attempt of project.seedAttempts||[]){
  const community=communities.find(c=>c.name===attempt.name);if(!community)continue;
  for(const hit of attempt.hits||[]){const url=fangCommunityCandidate(hit.url)||leyoujiaCommunityCandidate(hit.url);if(url&&rentalName(hit.title).includes(rentalName(community.name)))queue.push({community,url,discoveredFrom:hit.url});}
 }
 for(const previous of project.navigationAttempts)for(const link of previous.links||[]){const community=communities.find(c=>c.name===link.name);if(community)queue.push({community,url:link.url,discoveredFrom:previous.url});}
 for(const [key,attempt]of Object.entries(project.attempts||{})){
  const name=key.slice(0,key.lastIndexOf('|')),community=communities.find(c=>c.name===name);if(!community)continue;
  for(const hit of attempt.hits||[]){const url=fangCommunityCandidate(hit.url)||leyoujiaCommunityCandidate(hit.url);if(url)queue.push({community,url,discoveredFrom:hit.url});}
 }
 if(!queue.some(e=>!seen.has(e.url))){
  project.seedAttempts||=[];
  let seedBudget=0;
  // Prioritize named communities over building/door-number POIs without
  // removing any candidate from the fixed acceptance denominator.
  const seeds=[...communities].sort((a,b)=>Number(/花园|家园|苑|府|山庄|公馆|春城|锦城/.test(b.name))-Number(/花园|家园|苑|府|山庄|公馆|春城|锦城/.test(a.name)));
  for(const community of seeds){
   if(project.seedAttempts.some(a=>a.name===community.name))continue;
   if(seedBudget++>=8)break;
   const attempt={name:community.name,startedAt:new Date().toISOString()};
   try{
    const result=await wrSearch(process.env,rentalRecoveryQuery({...community,market:'sale'}),{limit:8,providers:['deepseek-web'],domain:'rental',market:'sale',maxOutputTokens:3000});
    attempt.hits=result.results||[];attempt.errors=result.errors||[];attempt.matched=0;
    for(const hit of attempt.hits){const url=fangCommunityCandidate(hit.url)||leyoujiaCommunityCandidate(hit.url);if(url&&rentalName(hit.title).includes(rentalName(community.name))){queue.push({community,url,discoveredFrom:hit.url});attempt.matched++;}}
   }catch(error){attempt.error=error.message;}
   project.seedAttempts.push(attempt);await writeFile(target,JSON.stringify(report,null,2));
   console.log(JSON.stringify({project:project.name,seed:attempt.name,matched:attempt.matched,error:attempt.error}));
   // A discovered URL is not a verified quote. Continue the bounded seed batch
   // so an unpriced first page cannot starve the other surrounding communities.
  }
 }
 const crawler=createRentalCrawler({maxPages:32});let pages=0;
 while(queue.length&&pages<24){
  const entry=queue.shift();if(seen.has(entry.url))continue;seen.add(entry.url);pages++;
  const attempt={name:entry.community.name,url:entry.url,discoveredFrom:entry.discoveredFrom,parserVersion:2,startedAt:new Date().toISOString()};
  try{
   const page=await crawler(entry.url);attempt.state='fetched';
   const row=fangCommunityPrice(page,{...entry.community,market:'sale'})||(await crawlLeyoujiaPage(page,{...entry.community,market:'sale'},crawler))?.rows?.[0];
   if(row){project.observations.push({...row,discoveredFrom:entry.discoveredFrom});attempt.saleUnitPrice=row.saleUnitPrice;}
   const links=fangCommunityLinks(page,communities);queue.push(...links);attempt.links=links.map(l=>({name:l.community.name,url:l.url}));
  }catch(error){attempt.state='failed';attempt.error=error.message;}
  project.navigationAttempts.push(attempt);project.coverage=rentalCoverage(communities,project.observations);
  await writeFile(target,JSON.stringify(report,null,2));
  console.log(JSON.stringify({project:project.name,...attempt,links:attempt.links?.length,covered:project.coverage.direct,total:project.coverage.denominator}));
 }
 project.navigationRemaining=queue.length;project.coverage=rentalCoverage(communities,project.observations);
 await writeFile(target,JSON.stringify(report,null,2));
}
