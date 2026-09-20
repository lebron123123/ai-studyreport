import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as wiki} from '../functions/api/wiki.js';
import {onRequestPost as rag} from '../functions/api/rag.js';
import {signToken} from '../functions/api/_auth.js';

function fixture(){
 const page={id:'w1',title:'项目经验',status:'published',content:'受限项目经验正文',security:1,dept_scope:'全部门',vector_ids:'["v1","e1"]'};
 const title='【Wiki】w1｜项目经验';
 const state={restricted:false,page};
 const env={SESSION_SECRET:'test-only-wiki',ADMIN_USERS:'admin',DB:{prepare(sql){let args=[];return {
  bind(...a){args=a;return this;},async run(){return {success:true};},
  async first(){if(sql.includes('FROM wiki_pages'))return args[0]==='w1'?page:null;if(sql.includes('FROM projects'))return null;return null;},
  async all(){
   if(sql.includes('FROM wiki_source_bindings'))return {results:state.restricted?[{project_id:'secret',evidence_id:'source',source_hash:'hash'}]:[]};
   if(sql.includes('FROM wiki_pages'))return {results:[page]};
   if(sql.includes('FROM rag_text_chunks'))return {results:[{id:'e1',title,text:'受限项目经验正文',doc_no:'文号1',section:'第一条'}]};
   if(sql.includes('FROM rag_files_v2'))return {results:[{title,enabled:1,security:1,dept_scope:'全部门'}]};
   return {results:[]};
  }
 };}},AI:{async run(){return {data:[[0.1]]};}},VECTORIZE:{async query(){return {matches:[{id:'v1',score:1,metadata:{title,text:'受限项目经验正文'}},{id:'old',score:1,metadata:{title,text:'过时向量'}},{id:'public',score:0.9,metadata:{title:'公开政策',text:'公开正文'}}]};}}};
 return {env,state};
}
async function call(fn,env,body){const token=await signToken(env,1,'admin');const response=await fn({env,request:new Request('http://test/api',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
test('公共Wiki列表与管理员get都不能绕过项目来源权限',async()=>{
 const {env,state}=fixture();
 assert.equal((await call(wiki,env,{action:'publicList'})).body.pages.length,1);
 state.restricted=true;
 assert.equal((await call(wiki,env,{action:'publicList'})).body.pages.length,0);
 assert.equal((await call(wiki,env,{action:'get',id:'w1'})).status,403);
});
test('真实RAG入口过滤精确/向量/旧版本；目录同样受控',async()=>{
 const {env,state}=fixture();const query={action:'query',query:'文号1第一条',topK:8,rerank:false};
 let result=await call(rag,env,query);
 assert.equal(result.body.ok,true);
 assert.deepEqual(new Set(result.body.matches.map(m=>m.id)),new Set(['e1','v1','public']));
 state.restricted=true;result=await call(rag,env,query);
 assert.deepEqual(result.body.matches.map(m=>m.id),['public']);
 assert.equal((await call(rag,env,{action:'catalog'})).body.total,0);
 state.restricted=false;state.page.status='draft';
 assert.deepEqual((await call(rag,env,query)).body.matches.map(m=>m.id),['public']);
});
