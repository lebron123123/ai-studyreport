import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
test('只读负载零失败不伪造100%恢复率或50个员工',async()=>{
  let requests=0;
  const server=createServer((req,res)=>{requests++;res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['scripts/investment-os-load.mjs'],{env:{...process.env,INVESTMENT_OS_BASE_URL:'http://127.0.0.1:'+server.address().port,INVESTMENT_OS_PROJECT_ID:'[系统测试]',INVESTMENT_OS_CONCURRENCY:'5',INVESTMENT_OS_ITERATIONS:'1',INVESTMENT_OS_RECORD:'0',INVESTMENT_OS_COOKIE:'',INVESTMENT_OS_BEARER:''}});
      let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error('load failed '+code+': '+err.slice(-2000))));
    });
    assert.equal(requests,10);assert.equal(result.failureCount,0);assert.equal(result.recoveryRate,null);assert.equal(result.recoveryTested,false);assert.equal(result.distinctAccounts,1);assert.equal(result.mixedWorkloadTested,false);
  }finally{await new Promise(r=>server.close(r));}
});
