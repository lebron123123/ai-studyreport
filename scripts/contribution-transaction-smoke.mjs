// Isolated schema: never writes the user's contribution or knowledge tables.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {onRequestPost} from '../functions/api/contributions.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
import {createAIAdapter} from '../local-server/ai-ollama.js';
const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
const schema='test_contrib_'+Date.now();assert.match(schema,/^test_contrib_\d+$/);let DB;
try{
 await admin.query('CREATE SCHEMA '+schema);
 for(const table of ['knowledge_contributions','source_assets','source_asset_versions','wiki_pages','rag_vectors','rag_text_chunks','rag_files_v2','rag_file_meta'])await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema+',public');DB=createD1Shim(url.toString());
 const env={DB,SESSION_SECRET:'isolated-test-secret',ADMIN_USERS:'testadmin',DEPLOY_MODE:'local'};
 const token=await signToken({SESSION_SECRET:env.SESSION_SECRET},987654,'testadmin');
 async function call(id,classification='policy'){const r=await onRequestPost({env,request:new Request('http://test/api/contributions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'review',id,decision:'approve',classification})})});return {status:r.status,data:await r.json()};}
 async function seed(id){await DB.prepare("INSERT INTO knowledge_contributions(id,kind,title,content,source_ref,meta,status,user_id,created_at) VALUES(?,'wiki','[系统测试]政策','原文依据','https://www.gov.cn/test','{}','pending',987654,?)").bind(id,Date.now()).run();}
 await seed('concurrent');const pair=await Promise.all([call('concurrent'),call('concurrent')]);assert.deepEqual(pair.map(x=>x.status).sort(),[200,409]);assert.equal((await DB.prepare('SELECT count(*) AS n FROM source_assets').first()).n,1);
 await seed('rollback');await admin.query(`ALTER TABLE ${schema}.source_asset_versions ADD CONSTRAINT test_fail CHECK (content_text <> '原文依据') NOT VALID`);
 const failed=await call('rollback');assert.equal(failed.status,409);assert.equal((await DB.prepare("SELECT status FROM knowledge_contributions WHERE id='rollback'").first()).status,'pending');assert.equal((await DB.prepare('SELECT count(*) AS n FROM source_assets').first()).n,1);
 await admin.query(`ALTER TABLE ${schema}.source_asset_versions DROP CONSTRAINT test_fail`);assert.equal((await call('rollback','interpretation')).status,200);
 await seed('experience');assert.equal((await call('experience','experience')).status,200);assert.equal((await DB.prepare('SELECT status FROM wiki_pages').first()).status,'draft');
 env.AI={run:async(_,{text})=>({data:text.map(()=>Array(1024).fill(0.01))})};
 async function publish(id,classification='policy'){
  const r=await onRequestPost({env,request:new Request('http://test/api/contributions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'approvePublish',id,classification})})});return {status:r.status,data:await r.json()};
 }
 for(const id of ['publish','failpublish','publishwiki']){await seed(id);await DB.prepare('UPDATE knowledge_contributions SET content=? WHERE id=?').bind('这是经过管理员核验的真实来源测试正文，仅用于隔离数据库回归。'.repeat(60),id).run();}
 const pubPair=await Promise.all([publish('publish'),publish('publish')]);assert.ok(pubPair.some(r=>r.status===200),JSON.stringify(pubPair));
 assert.equal((await publish('publish')).status,200);assert.equal((await DB.prepare('SELECT count(*) AS n FROM rag_files_v2').first()).n,1);
 const before=(await DB.prepare('SELECT count(*) AS n FROM rag_vectors').first()).n;
 await admin.query(`ALTER TABLE ${schema}.rag_file_meta ADD CONSTRAINT pub_fail CHECK (false) NOT VALID`);
 assert.equal((await publish('failpublish')).status,503);assert.equal((await DB.prepare('SELECT count(*) AS n FROM rag_vectors').first()).n,before);
 assert.equal((await DB.prepare("SELECT status FROM knowledge_contributions WHERE id='failpublish'").first()).status,'approved');
 await admin.query(`ALTER TABLE ${schema}.rag_file_meta DROP CONSTRAINT pub_fail`);
 assert.equal((await publish('failpublish')).status,200);
 assert.equal((await publish('publishwiki','experience')).status,200);
 const receipt=await DB.prepare("SELECT meta,target_ref FROM knowledge_contributions WHERE id='publishwiki'").first();assert.equal(JSON.parse(receipt.meta).publication.state,'published');assert.equal((await DB.prepare('SELECT status FROM wiki_pages WHERE id=?').bind(receipt.target_ref).first()).status,'published');
 assert.equal((await DB.prepare('SELECT count(*) AS n FROM rag_files_v2 WHERE enabled=1').first()).n,3);
 if(process.argv.includes('--real-embedding')){
  env.AI=createAIAdapter({ollamaUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',embedModel:process.env.EMBED_MODEL||'bge-m3'});
  await seed('realembedding');await DB.prepare('UPDATE knowledge_contributions SET content=? WHERE id=?').bind('保障性租赁住房项目编制依据：应核验政策原文、发布机关、文号以及适用范围。'.repeat(5),'realembedding').run();
  const result=await publish('realembedding');assert.equal(result.status,200,JSON.stringify(result));
  const query=await env.AI.run('@cf/baai/bge-m3',{text:['保障性租赁住房政策编制依据']});
  const hit=await DB.prepare("SELECT id FROM rag_vectors WHERE id LIKE 'conpub_realembedding_%' ORDER BY embedding <=> ?::vector LIMIT 1").bind('['+query.data[0].join(',')+']').first();assert.ok(hit);
  console.log('PASS: real embedding model -> publication -> PostgreSQL vector retrieval (isolated schema)');
 }
 console.log('PASS: atomic publication vectors/exact text/ledger, failure rollback and retry, duplicate publication, material + Wiki');
 console.log('PASS: real PostgreSQL concurrency, atomic rollback, retry, policy/interpretation material routing, Wiki draft only');
}finally{if(DB)await DB._close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
