import test from 'node:test';
import assert from 'node:assert/strict';
import {wikiPageAccessible,wikiRetrievalAccess} from '../functions/api/_wiki-source-access.js';
function fixture(){
 const page={id:'w1',title:'经验',status:'published',effective_date:'',expiry_date:'',vector_ids:'["current"]'};
 const bindings=[];
 const env={DB:{prepare(sql){return {bind(...args){return {async first(){if(sql.includes('wiki_pages'))return args[0]==='w1'?page:null;if(sql.includes('FROM projects'))return null;throw Error('unexpected query');},async all(){return {results:bindings};}};}}}}};
 return {page,bindings,env};
}
test('published legacy Wiki is readable; draft, expiry and future publication are not',async()=>{
 const {env,page}=fixture();
 assert.equal(await wikiPageAccessible(env,1,page),true);
 for(const patch of [{status:'draft'},{status:'archived'},{expiry_date:'2000-01-01'},{effective_date:'2999-01-01'}]){
  assert.equal(await wikiPageAccessible(env,1,{...page,...patch}),false);
 }
});
test('project source denial applies even to otherwise public Wiki',async()=>{
 const {env,page,bindings}=fixture();bindings.push({project_id:'private',evidence_id:'e1',source_hash:'hash'});
 assert.equal(await wikiPageAccessible(env,1,page),false);
});
test('vector and exact titles share fail-closed Wiki filter and preserve ordinary RAG',async()=>{
 const {env,page}=fixture();const title='【Wiki】w1｜经验';
 let allowed=await wikiRetrievalAccess(env,1,[title,'【Wiki】missing｜孤立','【Wiki】malformed']);
 assert.equal(allowed(title),true);assert.equal(allowed('政策原文'),true);
 assert.equal(allowed(title,'old-vector'),false);assert.equal(allowed(title,'current'),true);
 assert.equal(allowed('【Wiki】missing｜孤立'),false);assert.equal(allowed('【Wiki】malformed'),false);
 page.status='draft';allowed=await wikiRetrievalAccess(env,1,[title]);assert.equal(allowed(title),false);
});
test('database errors propagate instead of opening access',async()=>{
 const env={DB:{prepare(){throw Error('database unavailable');}}};
 await assert.rejects(wikiRetrievalAccess(env,1,['【Wiki】w1｜经验']),/database unavailable/);
});
