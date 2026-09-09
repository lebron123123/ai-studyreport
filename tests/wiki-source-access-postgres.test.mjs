import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureWikiSourceAccess,bindWikiSources,wikiSourcesAccessible} from '../functions/api/_wiki-source-access.js';
import {ensureInvestmentLifecycle} from '../functions/api/_investment-lifecycle.js';
const target=testDatabaseUrl();
test('Wiki来源权限交集、撤权即时生效、来源变更和失效关闭访问',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB};
 try{
  await ensureInvestmentLifecycle(env);await ensureWikiSourceAccess(env);await ensureWikiSourceAccess(env);
  const users=[];
  for(let i=0;i<2;i++){
   const name='[系统测试]wiki-'+crypto.randomUUID();
   await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();
   users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));
  }
  const [owner,reader]=users,pids=[crypto.randomUUID(),crypto.randomUUID()],sources=[],wikiId='w-'+crypto.randomUUID();
  for(const pid of pids){
   await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]Wiki来源','{}',Date.now()).run();
   const eid=crypto.randomUUID();
   await DB.prepare("INSERT INTO project_facts(id,project_id,user_id,fact_type,fact_key,value_json,status,source_ref,created_by,created_at,updated_at) VALUES(?,?,?,'operations','wiki.source','1','confirmed','原件页1','reviewer',?,?)").bind(eid,pid,owner,Date.now(),Date.now()).run();
   sources.push({projectId:pid,evidenceId:eid,locator:'原件页1'});
  }
  await bindWikiSources(env,owner,wikiId,sources);
  assert.equal(await wikiSourcesAccessible(env,owner,wikiId),true);
  assert.equal(await wikiSourcesAccessible(env,reader,wikiId),false);
  for(const pid of pids){
   await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'VIEWER','active',?,?)").bind(pid,reader,Date.now(),Date.now()).run();
   assert.equal(await wikiSourcesAccessible(env,reader,wikiId),pid===pids[1]);
  }
  await DB.prepare("UPDATE project_memberships SET status='removed' WHERE project_id=? AND user_id=?").bind(pids[0],reader).run();
  assert.equal(await wikiSourcesAccessible(env,reader,wikiId),false);
  await DB.prepare("UPDATE project_facts SET value_json='2' WHERE id=?").bind(sources[0].evidenceId).run();
  assert.equal(await wikiSourcesAccessible(env,owner,wikiId),false);
  // Rebinding must not silently approve changed evidence.
  await bindWikiSources(env,owner,wikiId,sources);
  assert.equal(await wikiSourcesAccessible(env,owner,wikiId),false);
  await DB.prepare("UPDATE project_facts SET value_json='1',status='rejected' WHERE id=?").bind(sources[0].evidenceId).run();
  assert.equal(await wikiSourcesAccessible(env,owner,wikiId),false);
 }finally{await DB._close();}
});
