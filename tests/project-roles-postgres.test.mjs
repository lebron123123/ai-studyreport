import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import * as projects from '../functions/api/projects.js';
import * as workspace from '../functions/api/projectworkspace.js';
import * as jobs from '../functions/api/agentjobs.js';
import * as runs from '../functions/api/agentruns.js';
import {resolveProjectAccess} from '../functions/api/_project-access.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {createAgentRun} from '../functions/api/_agent-runtime.js';
import {enqueueAgentJob,reauthorizeAgentJob} from '../functions/api/_agent-enterprise.js';

import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('项目三角色：真实数据库权限、撤权、并发保存', {skip:!target}, async t=>{
  const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),DEPLOY_MODE:'local'},pid=crypto.randomUUID(),created=[];
  try{
    for(const role of ['owner','editor','viewer'])created.push(await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?) RETURNING id').bind('[系统测试]'+role+crypto.randomUUID(),'disabled','disabled',Date.now()).first());
    const [owner,editor,viewer]=created.map(x=>Number(x.id));
    async function call(api,user,method='GET',body=null,query=''){
      const token=await signToken(env,user,'[系统测试]'),request=new Request('http://test/api/test'+query,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      const r=await api['onRequest'+({GET:'Get',POST:'Post',DELETE:'Delete'}[method])]({request,env});return {status:r.status,data:await r.json()};
    }
    let initial=await call(projects,owner,'POST',{id:pid,name:'[系统测试]三角色',data:{chapters:[],project:{name:'权限测试'}}});assert.equal(initial.status,200);
    assert.equal((await changeProjectMember(env,owner,pid,editor,'EDITOR')).ok,true);
    assert.equal((await changeProjectMember(env,owner,pid,viewer,'VIEWER')).ok,true);
    await t.test('三角色读取相同正文，查看者不可保存，编辑者不可管理成员',async()=>{
      const a=await call(projects,owner,'GET',null,'?id='+pid),b=await call(projects,editor,'GET',null,'?id='+pid),c=await call(projects,viewer,'GET',null,'?id='+pid);
      assert.equal(b.data.project.role,'EDITOR');assert.equal(c.data.project.role,'VIEWER');assert.deepEqual(c.data.project.data,a.data.project.data);
      assert.equal((await call(projects,viewer,'POST',{id:pid,data:{bad:true},expectedUpdatedAt:c.data.project.updated_at})).status,403);
      assert.equal((await call(workspace,editor,'POST',{projectId:pid,action:'updateMember',userId:viewer,role:'OWNER'})).status,403);
      assert.equal((await changeProjectMember(env,owner,pid,owner,'VIEWER')).status,400);
      const list=(await call(projects,viewer)).data.list;
      assert.equal(list.find(x=>x.id===pid)?.role,'VIEWER');
      assert.equal(list.find(x=>x.id===pid)?.permissions.delete,false);
      assert.equal((await call(projects,viewer,'POST',{id:pid,action:'updateMeta',tags:['forbidden']})).status,403);
      assert.equal((await call(projects,editor,'POST',{id:pid,action:'setArchived',archived:true})).status,403);
      assert.equal((await call(projects,editor,'DELETE',null,'?id='+pid)).status,403);
      assert.equal((await call(runs,viewer,'POST',{action:'create',projectId:pid})).status,403);
    });
    await t.test('同版本并发保存只能成功一次，不静默覆盖',async()=>{
      const version=(await call(projects,editor,'GET',null,'?id='+pid)).data.project.updated_at;
      const r=await Promise.all(['A','B'].map(name=>call(projects,editor,'POST',{id:pid,name:'[系统测试]'+name,data:{result:name},expectedUpdatedAt:version})));
      assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
      const saved=(await call(projects,owner,'GET',null,'?id='+pid)).data.project;assert.ok(['A','B'].includes(saved.data.result));
    });
    await t.test('查看者不能生成，编辑者降级后任务取消且不得重试',async()=>{
      assert.equal((await call(jobs,viewer,'POST',{action:'enqueue',projectId:pid,query:'test'})).status,403);
      const run=(await createAgentRun(env,editor,{projectId:pid,query:'[系统测试]',idempotencyKey:crypto.randomUUID()})).run;
      const job=await enqueueAgentJob(env,editor,run.id,{payload:{projectId:pid}});
      assert.equal((await reauthorizeAgentJob(env,job)).ok,true);
      assert.equal((await changeProjectMember(env,owner,pid,editor,'VIEWER')).ok,true);
      const stored=await DB.prepare('SELECT status FROM agent_jobs WHERE id=?').bind(job.id).first();assert.equal(stored.status,'cancelled');
      assert.equal((await reauthorizeAgentJob(env,job)).ok,false);
      assert.equal((await call(jobs,editor,'POST',{action:'retry',id:job.id})).status,403);
      await changeProjectMember(env,owner,pid,editor,'',true);
      assert.equal(await resolveProjectAccess(env,editor,pid),null);
      assert.equal((await call(jobs,editor,'GET',null,'?id='+job.id)).status,404);
      assert.equal((await call(projects,editor,'GET',null,'?id='+pid)).status,404);
      assert.equal((await call(runs,editor,'GET',null,'?action=detail&runId='+run.id)).status,404);
      assert.equal((await call(runs,editor)).data.runs.some(x=>x.id===run.id),false);
    });
    await t.test('审核未启用；权限变更有审计，不存在用户不能加入',async()=>{
      assert.equal((await changeProjectMember(env,owner,pid,2147483647,'VIEWER')).status,404);
      const audit=await DB.prepare('SELECT COUNT(*) AS n FROM project_events WHERE project_id=?').bind(pid).first();assert.equal(Number(audit.n),4);
    });
  }finally{await DB._close();}
});
