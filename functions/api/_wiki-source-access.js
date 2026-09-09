// Shared by page reads and both exact/vector retrieval. Never cache actor grants.
import {resolveProjectAccess} from './_project-access.js';
import {verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {checkedRows} from './_investment-formal-facts.js';
export async function verifyWikiSource(env,access,id){
 if(!id.startsWith('formal:'))return verifyInvestmentEvidence(env,access,id);
 const row=(await checkedRows(env,access.row.id)).find(x=>x.id===id.slice(7)&&x.currentValid);
 if(!row)throw Object.assign(new Error('批准原件失效，经验待复核'),{status:409});return row;
}

export const wikiSourceSchema = "CREATE TABLE IF NOT EXISTS wiki_source_bindings(wiki_id TEXT NOT NULL,project_id TEXT NOT NULL,evidence_id TEXT NOT NULL,source_hash TEXT NOT NULL,locator TEXT NOT NULL,PRIMARY KEY(wiki_id,project_id,evidence_id))";
export async function ensureWikiSourceAccess(env){await env.DB.prepare(wikiSourceSchema).run();}

// Called only inside the owning workflow transaction, before exposing its Wiki draft.
// Bindings are additive: generic Wiki editing cannot remove the source restrictions.
export async function bindWikiSources(env,userId,wikiId,sources){
  if(!Array.isArray(sources)||!sources.length||sources.length>20)throw new Error('经验必须关联1至20项来源');
  const verified=[];
  for(const source of sources){
    if(!source.projectId||!source.evidenceId||typeof source.locator!=='string'||!source.locator.trim()||source.locator.length>1000)throw new Error('来源项目、证据及页段定位不能为空');
    const access=await resolveProjectAccess(env,userId,source.projectId);
    if(!access?.permissions.edit)throw new Error('没有来源项目编辑权限');
    const proof=await verifyWikiSource(env,access,source.evidenceId);
    verified.push({...source,hash:await reportEvidenceHash(proof)});
  }
  for(const source of verified)await env.DB.prepare('INSERT INTO wiki_source_bindings(wiki_id,project_id,evidence_id,source_hash,locator) VALUES(?,?,?,?,?) ON CONFLICT(wiki_id,project_id,evidence_id) DO NOTHING').bind(wikiId,source.projectId,source.evidenceId,source.hash,source.locator.trim()).run();
}

export async function wikiSourcesAccessible(env,userId,wikiId){
  if(/^ev-[a-f0-9]{32}$/.test(wikiId)){
    const r=await env.DB.prepare('SELECT parent_id,payload_json FROM investment_step4_records WHERE id=?').bind(wikiId).first();
    if(!r)return false;
    const e=await env.DB.prepare('SELECT status,snapshot_json,content_hash FROM investment_post_evaluations WHERE id=?').bind(r.parent_id).first();
    if(!e||e.status!=='approved')return false;
    const snapshot=JSON.parse(e.snapshot_json);
    if(await reportEvidenceHash(snapshot)!==e.content_hash)return false;
    for(const actual of snapshot.actuals||[]){if(!await env.DB.prepare('SELECT id FROM investment_actual_values WHERE id=?').bind(actual.id).first())return false;if(await env.DB.prepare('SELECT id FROM investment_actual_values WHERE supersedes_id=?').bind(actual.id).first())return false;}
    for(const id of JSON.parse(r.payload_json).rectificationIds||[]){
      const fix=await env.DB.prepare('SELECT status,payload_json,project_id FROM investment_step4_records WHERE id=?').bind(id).first();
      if(!fix||fix.status!=='closed')return false;
      const p=JSON.parse(fix.payload_json).proof,a=await resolveProjectAccess(env,userId,fix.project_id);
      if(!a?.permissions.view)return false;
      try{if(!p||await reportEvidenceHash(await verifyInvestmentEvidence(env,a,p.id))!==p.hash)return false;}catch{return false;}
    }
  }
  const bindings=(await env.DB.prepare('SELECT * FROM wiki_source_bindings WHERE wiki_id=?').bind(wikiId).all()).results||[];
  if(/^ev-[a-f0-9]{32}$/.test(wikiId)&&!bindings.length)return false;
  for(const binding of bindings){
    const access=await resolveProjectAccess(env,userId,binding.project_id);
    if(!access?.permissions.view)return false;
    try{
      const source=await verifyWikiSource(env,access,binding.evidence_id);
      if(!binding.source_hash||await reportEvidenceHash(source)!==binding.source_hash)return false;
    }catch{return false;}
  }
  return true;
}

export async function wikiPageAccessible(env,userId,page,{published=true}={}){
  if(!page)return false;
  if(published){
    const today=new Date().toISOString().slice(0,10);
    if(page.status!=='published'||(page.effective_date&&page.effective_date>today)||(page.expiry_date&&page.expiry_date<today))return false;
  }
  return wikiSourcesAccessible(env,userId,page.id);
}

export async function filterWikiPages(env,userId,pages,options){
  const visible=[];
  for(const page of pages)if(await wikiPageAccessible(env,userId,page,options))visible.push(page);
  return visible;
}

export async function wikiRetrievalAccess(env,userId,titles){
  const allowed=new Map();
  const currentIds=new Map();
  // Orphaned/archived/draft Wiki vectors are denied, including legacy vectors.
  for(const title of new Set(titles)){
    if(!String(title||'').startsWith('【Wiki】'))continue;
    allowed.set(title,false);
    const id=String(title).match(/^【Wiki】([^｜]+)｜/)?.[1];
    if(!id)continue;
    const page=await env.DB.prepare('SELECT * FROM wiki_pages WHERE id=?').bind(id).first();
    if(await wikiPageAccessible(env,userId,page)){
      if(('【Wiki】'+page.id+'｜'+page.title).slice(0,80)!==title)continue;
      allowed.set(title,true);
      try{const ids=JSON.parse(page.vector_ids||'[]');currentIds.set(title,new Set(Array.isArray(ids)?ids:[]));}catch{currentIds.set(title,new Set());}
    }
  }
  return (title,chunkId)=>!String(title||'').startsWith('【Wiki】')||(allowed.get(title)===true&&(!chunkId||currentIds.get(title)?.has(chunkId)));
}

export async function filterWikiRagRows(env,userId,rows){
  const titles=rows.map(row=>row.title);
  if(!titles.some(title=>String(title||'').startsWith('【Wiki】')))return rows;
  await ensureWikiSourceAccess(env);
  const allowed=await wikiRetrievalAccess(env,userId,titles);
  return rows.filter(row=>allowed(row.title));
}
