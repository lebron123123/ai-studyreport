// Isolated full-report acceptance tooling. Never updates either source project/run.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {packState,unpackState} from '../research-state-codec.mjs';

const require=createRequire(import.meta.url);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SOURCE_IDS=Object.freeze({tax:'1bb24013-18ce-4819-9588-09fe98e5e0c0',longgang:'c28320f4-38be-400f-be6c-7f3c5463ca8f'});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const serialized=value=>typeof value==='string'?value:JSON.stringify(value);
const timestamp=value=>value instanceof Date?value.toISOString():String(value);
const copy=value=>value===undefined?undefined:structuredClone(value);
const safeError=error=>String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL redacted]');
const jsonWrite=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2),{flag:'wx'});

export function parseArgs(argv=process.argv.slice(2)){
  const options={run:false,prepareOnly:false,browser:false,selfTest:false,baseUrl:'http://localhost:8080',snapshotDir:null,out:null};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--dry-run')options.run=false;
    else if(arg==='--run')options.run=true;
    else if(arg==='--prepare-only')options.prepareOnly=true;
    else if(arg==='--browser')options.browser=true;
    else if(arg==='--self-test')options.selfTest=true;
    else if(['--snapshot-dir','--out','--base-url'].includes(arg)){
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value for '+arg);
      options[{'--snapshot-dir':'snapshotDir','--out':'out','--base-url':'baseUrl'}[arg]]=argv[++i];
    }else throw Error('Unknown argument: '+arg);
  }
  if(options.run&&!options.prepareOnly)throw Error('This scaffold has no AI generation adapter. Use --run --prepare-only for explicitly authorized isolated preparation; the parent acceptance runner must supply generation.');
  if(options.browser&&!options.run)throw Error('--browser requires --run --prepare-only');
  const url=new URL(options.baseUrl);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw Error('Only a local HTTP acceptance server is allowed');
  options.baseUrl=url.origin;
  return options;
}

async function connect(){
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required; use --env-file=local-server/.env');
  const pg=require(path.join(ROOT,'local-server/node_modules/pg'));
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();return client;
}

async function readSources(client){
  const {toPgPlaceholders}=await import('../local-server/d1-shim.js');
  const {readStoredState}=await import('../functions/api/_research-state-objects.js');
  const db={prepare(sql){return {bind(...args){return {async all(){return {results:(await client.query(toPgPlaceholders(sql),args)).rows};}};}};}};
  const row=(await client.query('SELECT id,user_id,name,data,updated_at FROM projects WHERE id=$1',[SOURCE_IDS.tax])).rows[0];
  if(!row)throw Error('Tax source project was not found');
  const study=(await client.query('SELECT id,owner_user_id,title,status,version,created_at FROM research_studies WHERE id=$1',[SOURCE_IDS.longgang])).rows[0];
  if(!study||!String(study.title).includes('龙岗'))throw Error('Longgang research identity mismatch');
  const run=(await client.query("SELECT id,research_id,ordinal,version,epoch,status,created_at,state_json FROM research_runs WHERE research_id=$1 AND status='active' ORDER BY ordinal DESC LIMIT 1",[study.id])).rows[0];
  if(!run)throw Error('Longgang has no active research run');
  const taxRaw=serialized(row.data),longgangRaw=serialized(run.state_json),at=new Date().toISOString();
  return {
    tax:{name:row.name,state:JSON.parse(taxRaw),sourceIdentity:{kind:'project',projectId:row.id,ownerId:row.user_id,updatedAt:timestamp(row.updated_at),sourceSha256:hash(taxRaw),sourceBytes:Buffer.byteLength(taxRaw),capturedAt:at}},
    longgang:{name:study.title,state:await readStoredState(db,run),sourceIdentity:{kind:'research',researchId:study.id,studyVersion:study.version,ownerId:study.owner_user_id,runId:run.id,ordinal:run.ordinal,version:run.version,epoch:run.epoch,status:run.status,createdAt:timestamp(run.created_at),sourceSha256:hash(longgangRaw),sourceBytes:Buffer.byteLength(longgangRaw),capturedAt:at}}
  };
}

export async function checkSourceUnchanged(identity,client){
  let own=false;if(!client){client=await connect();own=true;}
  try{
    if(identity.kind==='project'){
      const row=(await client.query('SELECT data,updated_at FROM projects WHERE id=$1',[identity.projectId])).rows[0];
      return !!row&&hash(serialized(row.data))===identity.sourceSha256&&timestamp(row.updated_at)===identity.updatedAt;
    }
    const row=(await client.query('SELECT version,epoch,state_json,status FROM research_runs WHERE id=$1 AND research_id=$2',[identity.runId,identity.researchId])).rows[0];
    const study=(await client.query('SELECT version FROM research_studies WHERE id=$1',[identity.researchId])).rows[0];
    return !!row&&!!study&&row.version===identity.version&&row.epoch===identity.epoch&&row.status===identity.status&&study.version===identity.studyVersion&&hash(serialized(row.state_json))===identity.sourceSha256;
  }finally{if(own)await client.end();}
}

export function sourceSummary(source){
  const draft=source.state.draft||source.state,workflow=draft.workflow||{},kb=draft.kb||[];
  const sections=(draft.chapters||[]).flatMap((chapter,ci)=>(chapter.sections||[]).map((section,si)=>({number:`${ci+1}.${si+1}`,title:section.t||section.title||'',bodyChars:String(section.editedHtml||section.content||'').length})));
  return {name:source.name,sourceIdentity:source.sourceIdentity,stateSha256:hash(JSON.stringify(source.state)),stateBytes:Buffer.byteLength(JSON.stringify(source.state)),project:copy(draft.project),calcType:draft.calcType||source.state.aiReport?.calcType||null,calcParams:copy(draft.calcParams||source.state.aiReport?.calcParams||{}),calcParamsSha256:hash(JSON.stringify(draft.calcParams||source.state.aiReport?.calcParams||{})),currentCalcSnapshotId:workflow.currentCalcSnapshotId||source.state.aiReport?.currentCalcSnapshotId||null,calcSnapshots:(workflow.calcSnapshots||[]).map(item=>({id:item.id,createdAt:item.createdAt,updatedAt:item.updatedAt,type:item.type,calcType:item.calcType,paramsSha256:item.params?hash(JSON.stringify(item.params)):null,keys:Object.keys(item)})),currentReportVersionId:workflow.currentReportVersionId||null,reportVersions:(workflow.reportVersions||[]).map(v=>({id:v.id,version:v.version,createdAt:v.createdAt})),chapterCount:(draft.chapters||[]).length,sectionCount:sections.length,sections,materials:kb.map(item=>({title:item.title||item.name||item.fileName||'',fileId:item.fileId||item.materialRef?.fileId||null,contentChars:String(item.content||'').length,contentSha256:hash(String(item.content||'')),storedContentHash:item.contentHash||null,parsedChars:item.parsedChars||null,sourceType:item.sourceType||null})),aiReportKeys:Object.keys(source.state.aiReport||draft.aiReport||{})};
}

export async function snapshotSources(options={}){
  const out=path.resolve(options.out||path.join(ROOT,'outputs/report-standardization','1010-full-generation-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)));
  if(!out.startsWith(path.join(ROOT,'outputs/report-standardization')+path.sep))throw Error('Acceptance artifacts must stay inside outputs/report-standardization');
  const client=await connect();let sources,configs;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='30s'");
    sources=await readSources(client);configs={};
    const logic=(await client.query("SELECT project_type,version,data FROM report_logic_sets WHERE status='published' ORDER BY project_type,version DESC")).rows;
    configs.logic=logic.filter((row,i)=>!logic.slice(0,i).some(old=>old.project_type===row.project_type));
    configs.templates=(await client.query("SELECT project_type,version,overrides FROM report_table_template_versions WHERE status='published' ORDER BY project_type,version DESC")).rows;
    await client.query('ROLLBACK');
    for(const source of Object.values(sources))if(!await checkSourceUnchanged(source.sourceIdentity,client))throw Error('Source changed during snapshot; no acceptance baseline can be claimed');
    await fs.mkdir(out,{recursive:false});
    const manifest={version:'full-generation-acceptance-snapshot-v1',capturedAt:new Date().toISOString(),directory:out,policy:'READ ONLY source capture. Complete source states preserved. No source, account, configuration, candidate or report writes; no AI requests.',sources:{},sourceUnchanged:true};
    for(const [key,source] of Object.entries(sources)){
      const file=path.join(out,key+'-source.json');await jsonWrite(file,source);const bytes=await fs.readFile(file);
      manifest.sources[key]={file,fileSha256:hash(bytes),fileBytes:bytes.length,...sourceSummary(source)};
    }
    await jsonWrite(path.join(out,'published-config.json'),configs);await jsonWrite(path.join(out,'manifest.json'),manifest);
    return {out,manifest,sources};
  }finally{await client.end();}
}

export async function loadSnapshots(directory){
  const out=path.resolve(directory),manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
  if(manifest.version!=='full-generation-acceptance-snapshot-v1')throw Error('Snapshot manifest format mismatch');
  const sources={};
  for(const key of ['tax','longgang']){
    const file=path.join(out,key+'-source.json'),bytes=await fs.readFile(file);
    if(hash(bytes)!==manifest.sources[key].fileSha256)throw Error('Snapshot content changed: '+key);
    const source=JSON.parse(bytes);if(hash(JSON.stringify(source.state))!==manifest.sources[key].stateSha256)throw Error('Resolved state hash changed: '+key);
    sources[key]=source;
  }
  return {out,manifest,sources};
}

// Clear all old prose/candidates/history, but preserve the full input materials,
// original financial assumptions/results and source outline. Never shrink slots.
export function buildIsolatedData(source,testProject,management={}){
  const draft=source.state.draft||source.state;
  const chapters=(draft.chapters||[]).map(chapter=>({name:chapter.name||chapter.title||'',checked:chapter.checked!==false,sections:(chapter.sections||[]).map(section=>({t:section.t||section.title||'',content:'',...(section.structure?{structure:copy(section.structure)}:{})}))}));
  const versions=draft.workflow?.reportVersions||[],baseline=source.sourceIdentity.projectId===SOURCE_IDS.tax?versions.find(v=>Number(v.version)===9):[...versions].sort((a,b)=>Number(b.version||0)-Number(a.version||0))[0];
  const C=require('../report-completion-contract.js'),Business=require('../report-business-structure.js');
  const escaped=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const structureChapters=chapters.map(chapter=>({name:chapter.name,sections:chapter.sections.map(section=>{
    const prior=baseline?.chapters?.find(c=>c.name===chapter.name)?.sections?.find(s=>s.t===section.t);
    const binding=Business.resolve({chapterName:chapter.name,sectionTitle:section.t,projectType:draft.calcType||'gaibao',businessScenario:draft.project?.businessScenario,currentSource:prior?.editedHtml||prior?.content||'',history:[],rules:[]});
    return {t:section.t,content:binding.requiredHeadings.map(h=>`<h${h.level}>${escaped(h.text)}</h${h.level}>`).join(''),qaStructureOnly:true,qaStructureSourceHash:C.fingerprint(binding)};
  })}));
  const structureCount=structureChapters.flatMap(c=>c.sections).reduce((n,s)=>n+C.headingOutline(s.content).length,0);
  const reportVersions=structureCount?[{id:'qa-structure-'+hash(JSON.stringify(structureChapters)).slice(0,20),version:1,label:'仅结构基线（无旧AI正文）',qaStructureOnly:true,qaSourceVersion:baseline?.version??null,chapters:structureChapters}]:[];
  const workflow={management:copy(management),calcSnapshots:copy(draft.workflow?.calcSnapshots||[]),analysisSnapshots:copy(draft.workflow?.analysisSnapshots||[]),currentCalcSnapshotId:draft.workflow?.currentCalcSnapshotId||null,reportVersions,currentReportVersionId:null};
  const data={project:copy(draft.project||{}),appMode:'aireport',aiReportSession:true,domainKey:draft.domainKey,calcType:draft.calcType,calcParams:copy(draft.calcParams||{}),kb:copy(draft.kb||[]),chapters,workflow,qaSourceIdentity:copy(source.sourceIdentity),qaSourceStateSha256:hash(JSON.stringify(source.state)),qaAcceptance:{version:'full-generation-acceptance-v1',id:testProject.id,name:testProject.name,scope:'Only this new [系统测试] copy may receive generation writes; source is immutable.',materialPolicy:'Complete parsed source material retained; no evidence windows, hardcoded project facts or summary-slot abbreviation.'}};
  // The database row is visibly [系统测试], while report facts keep the real name.
  data.project.name=draft.project?.name||source.name;
  for(const field of ['calcResult','calcResults','calcSummary','reportParams','confirmedFields','paramsConfirmed','analysisResults','analysisSnapshot'])if(Object.hasOwn(draft,field))data[field]=copy(draft[field]);
  // A reference is provenance only: never expose original research write targets.
  for(const item of data.kb)if(item.materialRef){item.qaOriginalMaterialRef=copy(item.materialRef);delete item.materialRef;}
  return data;
}

async function sourceUser(source,db){
  let user=await db.prepare('SELECT id,username FROM users WHERE id=?').bind(source.sourceIdentity.ownerId).first();
  if(!user){const rows=(await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').all()).results;if(rows?.length!==1)throw Error('Original owner unavailable and zgbyd is not unique');user=rows[0];}
  return user;
}

export async function createIsolatedProjects(snapshot,options={}){
  if(options.run!==true)throw Error('Explicit run authorization is required before creating isolated API projects');
  const {createD1Shim}=await import('../local-server/d1-shim.js'),{signToken}=await import('../functions/api/_auth.js');
  const db=createD1Shim(process.env.DATABASE_URL),baseUrl=options.baseUrl||'http://localhost:8080',projects={},sessions={},requests=[];
  const receipt={version:'full-generation-isolation-v1',startedAt:new Date().toISOString(),projects,requests,sourceUnchangedBefore:false,sourceUnchangedAfter:false,aiCalls:0};
  const receiptFile=path.join(snapshot.out,'isolated-projects.json');
  try{
    for(const source of Object.values(snapshot.sources))if(!await checkSourceUnchanged(source.sourceIdentity))throw Error('Source changed since immutable capture; recapture required before isolated preparation');
    receipt.sourceUnchangedBefore=true;
    for(const [key,source] of Object.entries(snapshot.sources)){
      const user=await sourceUser(source,db),token=await signToken({...process.env,DB:db},user.id,user.username);
      const target={id:crypto.randomUUID(),name:'[系统测试]全量报告验收-'+key+'-'+crypto.randomUUID().slice(0,8),sourceIdentity:source.sourceIdentity,ownerId:user.id,username:user.username};
      projects[key]=target;
      const request=async(url,body,method=body?'POST':'GET')=>{
        const record={key,path:url.split('?')[0],method,startedAt:new Date().toISOString()};requests.push(record);
        if(method!=='GET'&&(url!=='/api/projects'||body?.id!==target.id))throw Error('Non-isolated mutation rejected');
        const response=await fetch(baseUrl+url,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
        record.status=response.status;const result=await response.json();
        if(!response.ok||result.ok===false)throw Error(url+' HTTP '+response.status+': '+(result.error||'API failed'));
        return result;
      };
      sessions[key]={user,token,request,target};
      await request('/api/projects',{action:'createProject',id:target.id,name:target.name});
      const opened=await request('/api/projects?id='+target.id);
      const data=buildIsolatedData(source,target,opened.project?.data?.workflow?.management||{});
      await request('/api/projects',{id:target.id,name:target.name,expectedUpdatedAt:opened.project.updated_at,data});
      const saved=await request('/api/projects?id='+target.id);
      if(saved.project?.name!==target.name||saved.project?.data?.qaSourceStateSha256!==data.qaSourceStateSha256)throw Error('Isolated project round-trip verification failed');
      if(saved.project.data.kb.length!==data.kb.length||saved.project.data.kb.some((item,i)=>item.content!==data.kb[i].content))throw Error('Full material preservation verification failed');
      target.updatedAt=saved.project.updated_at;target.inputSha256=hash(JSON.stringify(saved.project.data));target.chapterCount=data.chapters.length;target.sectionCount=data.chapters.reduce((n,c)=>n+c.sections.length,0);target.materialChars=data.kb.reduce((n,item)=>n+String(item.content||'').length,0);
    }
    for(const source of Object.values(snapshot.sources))if(!await checkSourceUnchanged(source.sourceIdentity))throw Error('Source changed during isolated preparation; do not claim no changes until reviewed');
    receipt.sourceUnchangedAfter=true;receipt.completedAt=new Date().toISOString();await jsonWrite(receiptFile,receipt);
    return {snapshot,projects,sessions,receipt,baseUrl};
  }catch(error){receipt.error=safeError(error);await jsonWrite(receiptFile,receipt).catch(()=>{});throw error;}
  finally{await db._close?.();}
}

export async function loadIsolation(snapshot,options={}){
  const receipt=JSON.parse(await fs.readFile(path.join(snapshot.out,'isolated-projects.json'),'utf8'));
  if(receipt.version!=='full-generation-isolation-v1'||!receipt.sourceUnchangedAfter||receipt.error)throw Error('Isolated preparation receipt is not complete');
  const {createD1Shim}=await import('../local-server/d1-shim.js'),{signToken}=await import('../functions/api/_auth.js');
  const db=createD1Shim(process.env.DATABASE_URL),baseUrl=options.baseUrl||'http://localhost:8080',sessions={};
  try{
    for(const [key,source] of Object.entries(snapshot.sources)){
      const target=receipt.projects[key];
      if(!target?.name?.startsWith('[系统测试]全量报告验收-')||target.sourceIdentity.sourceSha256!==source.sourceIdentity.sourceSha256)throw Error('Retained isolation identity mismatch');
      const user=await sourceUser(source,db),token=await signToken({...process.env,DB:db},user.id,user.username);
      const request=async(url,body,method=body?'POST':'GET')=>{
        if(method!=='GET'&&(url!=='/api/projects'||body?.id!==target.id))throw Error('Non-isolated mutation rejected');
        const response=await fetch(baseUrl+url,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
        const data=await response.json();if(!response.ok||data.ok===false)throw Error(url+' HTTP '+response.status+': '+(data.error||'API failed'));return data;
      };
      const opened=await request('/api/projects?id='+target.id);
      if(opened.project?.name!==target.name||opened.project?.data?.qaSourceStateSha256!==hash(JSON.stringify(source.state)))throw Error('Retained project provenance mismatch');
      sessions[key]={user,token,target,request};
    }
    return {snapshot,projects:receipt.projects,sessions,receipt,baseUrl};
  }finally{await db._close?.();}
}

export async function refreshIsolatedStructure(isolation){
  const results={};
  for(const [key,session] of Object.entries(isolation.sessions)){
    const opened=await session.request('/api/projects?id='+session.target.id),data=opened.project.data;
    if(data.qaSourceStateSha256!==hash(JSON.stringify(isolation.snapshot.sources[key].state)))throw Error('Isolation source mismatch');
    if((data.chapters||[]).some(c=>(c.sections||[]).some(s=>String(s.content||s.editedHtml||'').trim()||s.executionTask||s.pendingRevision)))throw Error('Test generation has started; will not alter active structure');
    const prepared=buildIsolatedData(isolation.snapshot.sources[key],session.target,data.workflow?.management||{});
    data.workflow={...data.workflow,reportVersions:prepared.workflow.reportVersions};
    data.project={...data.project,name:prepared.project.name};
    await session.request('/api/projects',{id:session.target.id,name:session.target.name,expectedUpdatedAt:opened.project.updated_at,data});
    results[key]={projectId:session.target.id,structureVersion:prepared.workflow.reportVersions[0]?.qaSourceVersion||null,headings:prepared.workflow.reportVersions.flatMap(v=>v.chapters.flatMap(c=>c.sections)).reduce((n,s)=>n+(s.content.match(/<h[3-6]>/g)||[]).length,0)};
  }
  return results;
}

export function taskBelongsToIsolation(row,target,user){return !!row&&row.project_id===target.id&&String(row.user_id)===String(user.id);}

function isolationQa(source,target){
  if(!target?.id||Object.values(SOURCE_IDS).includes(target.id)||!/^\[系统测试\]全量报告验收-(?:tax|longgang)-[0-9a-f]{8}$/.test(target.name)||hash(JSON.stringify(target.sourceIdentity))!==hash(JSON.stringify(source.sourceIdentity)))throw Error('Exact isolation receipt identity mismatch');
  return {qaSourceIdentity:copy(source.sourceIdentity),qaSourceStateSha256:hash(JSON.stringify(source.state)),qaAcceptance:{version:'full-generation-acceptance-v1',id:target.id,name:target.name,scope:'Only this new [系统测试] copy may receive generation writes; source is immutable.',materialPolicy:'Complete parsed source material retained; no evidence windows, hardcoded project facts or summary-slot abbreviation.'}};
}

// Only the browser's exact, already-authenticated test-copy save is adapted.
// Production buildDraftData intentionally omits test-only QA fields.
export function protectIsolatedProjectSave(body,source,target,user){
  const qa=isolationQa(source,target),draft=source.state.draft||source.state;
  if(body?.id!==target.id||body.action||String(user?.id)!==String(target.ownerId)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw Error('Non-isolated project save rejected');
  if(body.data.project?.name!==(draft.project?.name||source.name))throw Error('Isolated report name does not match its immutable source');
  for(const [key,value] of Object.entries(qa))if(body.data[key]!==undefined&&hash(JSON.stringify(body.data[key]))!==hash(JSON.stringify(value)))throw Error('Conflicting isolation provenance: '+key);
  return {...body,name:target.name,data:{...body.data,...qa}};
}

// Follow the production codec for incremental saves, but read objects only from
// this receipt-bound copy. The normalized data path prevents the server from
// decoding the original manifest a second time and dropping the injected QA.
export async function protectIsolatedProjectWire(body,source,target,user,readBaseline){
  const qa=isolationQa(source,target);
  if(body?.id!==target.id||body.action||String(user?.id)!==String(target.ownerId))throw Error('Non-isolated project save rejected');
  if(!body.packed)return protectIsolatedProjectSave(body,source,target,user);
  if(body.data!==undefined||typeof readBaseline!=='function'||!Number.isSafeInteger(body.expectedUpdatedAt))throw Error('Invalid isolated packed save');
  const baseline=await readBaseline();
  if(baseline?.id!==target.id||baseline.name!==target.name||baseline.role!=='OWNER'||Number(baseline.updated_at)!==body.expectedUpdatedAt||Object.entries(qa).some(([key,value])=>hash(JSON.stringify(baseline.data?.[key]??null))!==hash(JSON.stringify(value))))throw Error('Isolated packed baseline identity/provenance/version mismatch');
  const packed=await packState(baseline.data),entries=body.packed.objects;
  if(!Array.isArray(entries)||entries.length>10000)throw Error('Invalid isolated packed objects');
  for(const entry of entries){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[1]!=='string'||hash(entry[1])!==entry[0])throw Error('Invalid isolated packed object digest');
    packed.objects.set(entry[0],entry[1]);
  }
  const data=unpackState(body.packed.manifest,packed.objects),{packed:ignored,...plain}=body;
  return protectIsolatedProjectSave({...plain,data},source,target,user);
}

async function isolatedProjectSaveRoute(route,isolation,key,errors){
  const session=isolation.sessions[key];let body;
  try{
    body=route.request().postDataJSON();
    const protectedBody=await protectIsolatedProjectWire(body,isolation.snapshot.sources[key],session.target,session.user,async()=>{
      const opened=await session.request('/api/projects?id='+session.target.id);return opened.project;
    });
    return route.continue({postData:JSON.stringify(protectedBody)});
  }catch(error){errors.push(safeError(error));return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Isolated acceptance project provenance validation failed.'})});}
}

// Can be installed on a retained isolated context without reloading the page,
// changing browser state or repeating any paid generation.
export async function installIsolatedProjectSaveAdapter(isolation,key,harness){
  const target=isolation.sessions[key]?.target;
  if(!target||harness?.key!==key||harness.target?.id!==target.id||!harness.context?.route)throw Error('Retained isolated harness identity mismatch');
  await harness.context.route('**/api/projects',async route=>{
    if(['GET','HEAD','OPTIONS'].includes(route.request().method()))return route.fallback();
    if(route.request().method()!=='POST')return route.fulfill({status:403,body:'Isolated mutation rejected'});
    return isolatedProjectSaveRoute(route,isolation,key,harness.errors);
  });
}

function isolationInputAnchors(data){
  return {calcParams:hash(JSON.stringify(data.calcParams||{})),materials:hash(JSON.stringify((data.kb||[]).map(m=>({title:m.title,content:String(m.content||'')})))),outline:hash(JSON.stringify((data.chapters||[]).map(c=>({name:c.name||c.title,sections:(c.sections||[]).map(s=>s.t||s.title)})))),calcSnapshotId:data.workflow?.currentCalcSnapshotId||null,calcSnapshots:hash(JSON.stringify(data.workflow?.calcSnapshots||[]))};
}

// Explicit recovery is limited to receipt IDs, their original owner, immutable
// input hashes and known probe tasks. It never relaxes loadIsolation checks.
export async function restoreIsolatedProvenance(snapshot,options={}){
  if(options.run!==true)throw Error('Explicit authorization is required for isolated provenance restoration');
  const receipt=JSON.parse(await fs.readFile(path.join(snapshot.out,'isolated-projects.json'),'utf8'));
  if(receipt.version!=='full-generation-isolation-v1'||!receipt.sourceUnchangedAfter||receipt.error)throw Error('Incomplete isolation receipt');
  const {createD1Shim}=await import('../local-server/d1-shim.js'),{signToken}=await import('../functions/api/_auth.js');
  const db=createD1Shim(process.env.DATABASE_URL),client=await connect(),results={};
  try{
    for(const [key,source] of Object.entries(snapshot.sources)){
      const target=receipt.projects[key],qa=isolationQa(source,target),draft=source.state.draft||source.state;
      if(!await checkSourceUnchanged(source.sourceIdentity,client))throw Error('Original source changed; recovery refused');
      const row=(await client.query('SELECT id,user_id,name,data,updated_at FROM projects WHERE id=$1',[target.id])).rows[0];
      if(!row||row.id!==target.id||String(row.user_id)!==String(target.ownerId))throw Error('Recovery project owner/ID mismatch');
      const data=JSON.parse(serialized(row.data));
      const intact=row.name===target.name&&Object.entries(qa).every(([field,value])=>hash(JSON.stringify(data[field]??null))===hash(JSON.stringify(value)));
      if(intact){results[key]={projectId:target.id,restored:false,provenance:'already-intact'};continue;}
      if(![target.name,draft.project?.name||source.name].includes(row.name)||hash(JSON.stringify(isolationInputAnchors(data)))!==hash(JSON.stringify(isolationInputAnchors(draft))))throw Error('Recovery immutable input/name mismatch');
      const known=options.knownTasks?.[key]||[],tasks=(await client.query('SELECT id,project_id,user_id FROM report_section_tasks WHERE project_id=$1',[target.id])).rows;
      if(!known.length||!tasks.length||tasks.some(task=>!known.includes(task.id)||!taskBelongsToIsolation(task,target,{id:target.ownerId})))throw Error('Recovery known probe task identity mismatch');
      const user=await sourceUser(source,db),payload=protectIsolatedProjectSave({id:target.id,expectedUpdatedAt:Number(row.updated_at),data},source,target,user);
      const backup=path.join(snapshot.out,key+'-provenance-recovery-before-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
      await jsonWrite(backup,{at:new Date().toISOString(),row,anchors:isolationInputAnchors(data),knownTasks:tasks,receiptTarget:target});
      const token=await signToken({...process.env,DB:db},user.id,user.username),baseUrl=options.baseUrl||'http://localhost:8080';
      const response=await fetch(baseUrl+'/api/projects',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)}),result=await response.json();
      if(!response.ok||result.ok===false)throw Error('Isolated recovery API failed: '+response.status);
      const saved=(await client.query('SELECT id,user_id,name,data,updated_at FROM projects WHERE id=$1',[target.id])).rows[0],savedData=JSON.parse(serialized(saved.data));
      if(saved.name!==target.name||Object.entries(qa).some(([field,value])=>hash(JSON.stringify(savedData[field]??null))!==hash(JSON.stringify(value)))||hash(JSON.stringify(savedData.chapters))!==hash(JSON.stringify(data.chapters))||hash(JSON.stringify(isolationInputAnchors(savedData)))!==hash(JSON.stringify(isolationInputAnchors(data))))throw Error('Isolated recovery round-trip failed; original backup retained');
      results[key]={projectId:target.id,restored:true,backup,anchors:isolationInputAnchors(data),preservedSectionStateSha256:hash(JSON.stringify(data.chapters)),knownTasks:tasks.map(t=>t.id)};
    }
    for(const source of Object.values(snapshot.sources))if(!await checkSourceUnchanged(source.sourceIdentity,client))throw Error('Original source changed during recovery');
    await jsonWrite(path.join(snapshot.out,'provenance-recovery-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'),{at:new Date().toISOString(),sourceUnchanged:true,results});
    return results;
  }finally{await client.end();await db._close?.();}
}

// Production app, new browser context and new test projects only. Existing browser
// cookies/profile/storage are never read. Paid AI is denied unless parent opts in.
export async function openProductionHarness(isolation,key,options={}){
  const session=isolation.sessions[key];if(!session)throw Error('No isolated authenticated session: '+key);
  if(options.readOnly===true&&options.allowAi===true)throw Error('A read-only composition harness cannot enable paid AI');
  require('./windows-browser-lockout-guard.cjs');const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:options.headless!==false});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],ledger=[],taskIds=new Set();
  await context.addInitScript(({token,user,id,readOnly})=>{localStorage.setItem('fs_token',token);localStorage.setItem('fs_user',JSON.stringify(user));if(!readOnly)localStorage.setItem('fs_active_project_id',id);},{token:session.token,user:session.user,id:session.target.id,readOnly:options.readOnly===true});
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(method==='GET'||method==='HEAD'||method==='OPTIONS'){
      const id=url.pathname==='/api/reportexecution'?url.searchParams.get('id'):null;
      if(id&&!taskIds.has(id)){
        const client=await connect();try{await client.query('BEGIN READ ONLY');const row=(await client.query('SELECT id,project_id,user_id FROM report_section_tasks WHERE id=$1',[id])).rows[0];await client.query('ROLLBACK');if(taskBelongsToIsolation(row,session.target,session.user))taskIds.add(id);}finally{await client.end();}
      }
      return route.continue();
    }
    let body={};try{body=request.postDataJSON()||{};}catch{}
    const isAi=['/api/generate','/api/reportexecution','/api/agent'].some(prefix=>url.pathname.startsWith(prefix));
    const identity=body.projectId||body.id||url.searchParams.get('projectId')||url.searchParams.get('id');
    const allowedProject=url.pathname==='/api/projects'&&method==='POST'&&body.id===session.target.id&&!body.action;
    const allowedReportSession=url.pathname==='/api/aireport'&&method==='POST'&&body.action==='saveState'&&body.projectId===session.target.id;
    const allowedRepair=options.allowAi===true&&url.pathname==='/api/reportexecution'&&body.action==='repair'&&taskIds.has(body.id);
    const allowedAi=options.allowAi===true&&isAi&&identity===session.target.id||allowedRepair;
    const readActions={
      '/api/reportlogic':['adminCapability','adminList','evaluateRuleRevision'],
      '/api/reporttables':['list','get','resolve','effective','preview'],
      '/api/reportoutline':['list','get'],
      '/api/reportdataneeds':['list','get','resolve'],
      '/api/webresearch':['status','plan','listEvidence','listRequirementRefinements']
    };
    // Read-only composition may resolve references to the user's immutable
    // source records as well as the isolated copy. Normal generation still
    // requires the isolated identity; backend authorization governs all reads.
    const readonlyPost=method==='POST'&&readActions[url.pathname]?.includes(body.action)&&(options.readOnly===true||!body.projectId||body.projectId===session.target.id);
    const allowed=readonlyPost||(options.readOnly!==true&&(allowedProject||allowedReportSession||allowedAi));
    ledger.push({path:url.pathname,method,action:typeof body.action==='string'?body.action:undefined,allowed,isolatedIdentity:identity===session.target.id,isAi,at:new Date().toISOString()});
    if(!allowed){errors.push('Blocked out-of-scope request: '+method+' '+url.pathname);return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'Isolated acceptance harness blocked this mutation; only its test project is writable.'})});}
    if(url.pathname==='/api/reportexecution'&&allowedAi){
      const response=await route.fetch();if(response.ok()){let data;try{data=await response.json();}catch{}if(data?.ok&&typeof data.task?.id==='string')taskIds.add(data.task.id);}
      return route.fulfill({response});
    }
    if(allowedProject){
      return isolatedProjectSaveRoute(route,isolation,key,errors);
    }
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(safeError(error)));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(isolation.baseUrl,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof openAiReportProject==='function',{timeout:30000});
  const opened=options.readOnly===true?await page.evaluate(async id=>{
    // Composition loads the normal app and configuration, but never enters the
    // AI workspace whose restore callbacks may schedule background saves.
    await Promise.all([fetchOutlines(),fetchCalcConfig()]);
    const response=await fetch('/api/projects?id='+encodeURIComponent(id),{headers:authHeaders()}),data=await response.json();
    if(!response.ok||!data.ok||data.project?.id!==id)throw Error('Read-only composition project identity could not be verified');
    applyProjectAccess(data.project);currentProjectId=id;currentProjectUpdatedAt=Number(data.project.updated_at)||null;
    clearTimeout(cloudTimer);cloudTimer=null;cloudFirstPendingAt=0;
    saveDraft=()=>{};scheduleCloudSave=()=>{};cloudSaveNow=async()=>false;flushCloudSave=async()=>false;
    persistReportDraft=async()=>({ok:false,local:false,remote:false,acceptanceReadOnly:true});
    airSaveState=async()=>false;
    return true;
  },session.target.id):await page.evaluate(id=>openAiReportProject(id),session.target.id);
  if(!opened){await browser.close();throw Error('Production app failed to open its isolated AI report project');}
  return {browser,context,page,errors,ledger,taskIds,key,target:session.target,async close(){await browser.close();}};
}

async function selfTest(){
  const assert=(await import('node:assert/strict')).default;
  assert.equal(parseArgs([]).run,false);assert.throws(()=>parseArgs(['--run']),/no AI generation adapter/);assert.throws(()=>parseArgs(['--base-url','https://example.com']),/local HTTP/);
  const source={name:'source',sourceIdentity:{kind:'project',projectId:'source-id'},state:{project:{name:'source',area:5973},calcParams:{area:5973},kb:[{content:'Full source material '.repeat(100),materialRef:{researchId:'source-research'}}],chapters:[{name:'Chapter',sections:[{t:'Section',content:'old',candidate:{html:'old candidate'}}]}],workflow:{reportVersions:[{id:'old'}],calcSnapshots:[{id:'calc',params:{area:5973}}],currentCalcSnapshotId:'calc'}}};
  const original=JSON.stringify(source),data=buildIsolatedData(source,{id:'new-id',name:'[系统测试]test'});
  assert.equal(JSON.stringify(source),original);assert.equal(data.kb[0].content,source.state.kb[0].content);assert.equal(data.chapters[0].sections[0].content,'');assert.equal(data.chapters[0].sections[0].candidate,undefined);assert.equal(data.workflow.reportVersions.length,0);assert.equal(data.kb[0].materialRef,undefined);assert.equal(data.workflow.currentCalcSnapshotId,'calc');
  console.log(JSON.stringify({selfTest:'passed',checks:11,paidAiCalls:0,sourceWrites:0}));
}

async function main(){
  const options=parseArgs();if(options.selfTest)return selfTest();
  const snapshot=options.snapshotDir?await loadSnapshots(options.snapshotDir):await snapshotSources(options);
  console.log(JSON.stringify({mode:'read-only-snapshot',out:snapshot.out,sources:Object.fromEntries(Object.entries(snapshot.manifest.sources).map(([key,item])=>[key,{file:item.file,sourceIdentity:item.sourceIdentity,chapterCount:item.chapterCount,sectionCount:item.sectionCount,materialChars:item.materials.reduce((n,m)=>n+m.contentChars,0),calcParams:item.calcParams}]))}));
  if(!options.run)return;
  const isolation=await createIsolatedProjects(snapshot,options);console.log(JSON.stringify({mode:'isolated-preparation-only',out:snapshot.out,projects:isolation.projects,paidAiCalls:0,sourceUnchanged:isolation.receipt.sourceUnchangedAfter}));
  if(options.browser)for(const key of Object.keys(isolation.projects)){
    const harness=await openProductionHarness(isolation,key);await jsonWrite(path.join(snapshot.out,key+'-browser-preflight.json'),{at:new Date().toISOString(),project:harness.target,errors:harness.errors,requests:harness.ledger,paidAiCalls:0});await harness.close();
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
