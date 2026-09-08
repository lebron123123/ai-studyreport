// Real local service smoke. Synthetic project only; no browser credentials or user projects.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import pg from '../local-server/node_modules/pg/lib/index.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {createInvestmentCalculator} from '../local-server/investment-calculator.js';

assert.ok(process.argv.includes('--run'),'需要显式 --run；仅本机服务');
const connection=new URL(process.env.DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(connection.hostname));
const DB=createD1Shim(connection.toString()),client=new pg.Client({connectionString:connection.toString()});
const projectId='system-test-lifecycle-'+crypto.randomUUID(),username='[系统测试]全周期冒烟_'+crypto.randomUUID().slice(0,8);
let userId,projectCreated=false;
const checks=[];
try {
  await client.connect();
  userId=Number((await client.query('INSERT INTO users(username,pass_hash,salt,created_at) VALUES($1,$2,$3,$4) RETURNING id',[username,'disabled-no-login','disabled',Date.now()])).rows[0].id);
  const token=await signToken({...process.env,DB},userId,username);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  async function request(path,body){
    const response=await fetch('http://localhost:8080'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    const data=await response.json();
    assert.equal(response.status,200,path+' HTTP '+response.status+' '+String(data.error||'').slice(0,180));
    return data;
  }
  const source=fs.readFileSync(new URL('../tests/calc-engines.test.js',import.meta.url),'utf8');
  const literal=source.match(/const GAIBAO_DEFAULT_PARAMS = (\{[\s\S]*?\n\});/);
  assert.ok(literal,'测算基准参数缺失');
  const snapshot={id:'snapshot-'+crypto.randomUUID(),version:1,calcType:'gaibao',params:vm.runInNewContext('('+literal[1]+')')};
  snapshot.summary=createInvestmentCalculator().calculate({snapshot}).summary;
  const project={project:{name:'[系统测试]全周期实际服务验收',type:'gaibao'},chapters:[{name:'项目总论',sections:[{t:'编制依据',content:'[系统测试]仅用于接口验收，不是正式报告。'}]}],workflow:{currentCalcSnapshotId:snapshot.id,calcSnapshots:[snapshot]}};
  await client.query('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES($1,$2,$3,$4,$5)',[projectId,userId,project.project.name,JSON.stringify(project),Date.now()]);projectCreated=true;
  for(const route of ['/api/projects','/api/projectbrain?projectId='+projectId,'/api/projectintelligence?projectId='+projectId,'/api/investmentops?projectId='+projectId+'&view=lifecycle']){await request(route);checks.push(route.split('?')[0]);}
  const saved=await request('/api/investmentops',{projectId,action:'saveScenario',scenario:{kind:'baseline'}});
  assert.ok(saved.id&&saved.scenario?.metrics);checks.push('服务器真实测算方案');
  await request('/api/investmentops',{projectId,action:'selectScenario',scenarioId:saved.id});
  const portfolio=await request('/api/investmentops?view=lifecyclePortfolio&projectIds='+encodeURIComponent(projectId));
  assert.ok(portfolio.portfolio);checks.push('授权项目汇总');
  const rag=await request('/api/rag',{action:'query',query:'[系统测试]保障性租赁住房资料索引连通性',topK:1});
  assert.notEqual(rag.ok,false);checks.push('RAG实际检索');
  const generated=await request('/api/generate',{system:'这是系统连通性测试，只输出“测试通过”。',messages:[{role:'user',content:'请回复测试通过'}],max_tokens:200});
  assert.ok(generated.text||generated.content||generated.result);checks.push('AI实际生成');
  for(const route of ['/index.html','/admin.html','/investment-lifecycle.js'])assert.equal((await fetch('http://localhost:8080'+route)).status,200);
  for(const route of ['/local-server/.env','/local-data/rag-objects/test','/outputs/0907六步执行工作账.md'])assert.equal((await fetch('http://localhost:8080'+route)).status,404);
  checks.push('页面可访问与私有文件保护');
  console.log(JSON.stringify({ok:true,checks}));
} finally {
  if(projectCreated){
    // Resolve exact synthetic ownership before any deletion. Transaction rollback retains fixtures on error.
    const target=(await client.query('SELECT user_id,name FROM projects WHERE id=$1',[projectId])).rows[0];
    assert.equal(Number(target?.user_id),userId);assert.ok(target.name.startsWith('[系统测试]'));
    await client.query('BEGIN');
    try {
      const tables=(await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='project_id' ORDER BY table_name")).rows;
      for(const {table_name:table} of tables){assert.match(table,/^[a-z_]+$/);await client.query('DELETE FROM "'+table+'" WHERE project_id=$1',[projectId]);}
      await client.query('DELETE FROM projects WHERE id=$1 AND user_id=$2',[projectId,userId]);await client.query('COMMIT');
      console.log(JSON.stringify({testProjectRemoved:true,projectId,auditAccount:username,note:'保留无登录密码的测试账号及真实调用审计，不删除业务数据'}));
    } catch(error){await client.query('ROLLBACK');console.error(JSON.stringify({testFixtureRetained:true,projectId,error:String(error.message)}));throw error;}
  }
  await client.end();await DB._close();
}
