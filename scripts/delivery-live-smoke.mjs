// Local test fixtures only. Tokens are generated in memory and never logged or written.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const url=new URL(process.env.DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
const DB=createD1Shim(url.toString()),env={...process.env,DB},base='http://localhost:8080';
try{
  if(process.argv.includes('--preflight')){
    const count=await DB.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE status='running'").first();console.log(JSON.stringify({runningJobs:Number(count.n)}));
  }else{
    assert.ok(process.argv.includes('--run'),'需要 --run');
    const accounts=[];
    for(let i=0;i<2;i++){
      const username='delivery_'+crypto.randomUUID().slice(0,8),projectId='system-test-delivery-'+crypto.randomUUID();
      await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'not-a-login-hash','test-only',Date.now()).run();
      const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);
      const token=await signToken(env,id,username);
      const name='[系统测试]验收与混合负载 '+i;
      await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,id,name,JSON.stringify({project:{name},chapters:[{name:'项目总论',sections:[{t:'投资',content:'总投资：100万元'}]}]}),Date.now()).run();
      accounts.push({token,projectId});
    }
    const probe=await fetch(base+'/api/projectartifacts?projectId='+accounts[0].projectId+'&name=probe.txt',{method:'POST',headers:{authorization:'Bearer '+accounts[0].token},body:'[系统测试] upload probe'});
    if(!probe.ok)throw new Error('上传预检：'+JSON.stringify(await probe.json()));
    const r=spawnSync(process.execPath,['scripts/delivery-mixed-load.mjs','--run',...(process.argv.includes('--include-model')?['--include-model']:[])],{env:{...process.env,DELIVERY_LOAD_ACCOUNTS:JSON.stringify(accounts)},encoding:'utf8',windowsHide:true,timeout:180000});
    console.log(r.stdout);assert.equal(r.status,0,r.stderr);
    const a=accounts[0],headers={authorization:'Bearer '+a.token};
    const files=await (await fetch(base+'/api/projectartifacts?projectId='+a.projectId,{headers})).json();
    const file=files.items[0];assert.ok(file);
    const original=await fetch(base+'/api/projectartifacts?projectId='+a.projectId+'&id='+file.id,{headers});assert.equal(original.status,200);assert.match(await original.text(),/系统测试/);
    assert.equal((await fetch(base+'/api/projectartifacts?projectId='+a.projectId+'&id='+file.id,{headers:{authorization:'Bearer '+accounts[1].token}})).status,403);
    for(const p of ['/local-server/.env','/local-data/rag-objects/test','/outputs/0907六步执行工作账.md'])assert.equal((await fetch(base+p)).status,404,p);
    assert.equal((await fetch(base+'/index.html')).status,200);
    const response=await fetch(base+'/api/generate',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({system:'只输出一行',messages:[{role:'user',content:'请回复测试通过'}],max_tokens:200}),signal:AbortSignal.timeout(60000)});
    const generated=await response.json();assert.equal(response.status,200,JSON.stringify(generated).slice(0,300));assert.ok(generated.text||generated.content||generated.result);
    console.log(JSON.stringify({ok:true,originalDownload:true,crossAccountDenied:true,privatePathsBlocked:true,realGenerate:true,testProjects:accounts.map(a=>a.projectId),fixturesRetained:true}));
  }
}finally{await DB._close();}
