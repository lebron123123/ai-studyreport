import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/projects.js';import {signToken} from '../functions/api/_auth.js';
async function save(mode,size){
  let stored=null;
  const env={DEPLOY_MODE:mode,SESSION_SECRET:'isolated-test-only',DB:{
    prepare(sql){return {run:async()=>({success:true}),bind(...args){return {first:async()=>null,run:async()=>{if(/INSERT INTO projects/i.test(sql))stored=args[3];return {success:true};}};}};}
  }};
  const token=await signToken(env,1,'test');
  const response=await onRequestPost({env,request:new Request('http://test/api/projects',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:'test-size-project',data:{content:'中'.repeat(size)}})})});
  return {response,stored};
}
test('PostgreSQL保存超过旧900k字符阈值的完整报告',async()=>{const r=await save('local',1000000);assert.equal(r.response.status,200);assert.equal(JSON.parse(r.stored).content.length,1000000);});
test('云部署仍受现有存储限制并提供可操作错误',async()=>{const r=await save('cloud',1000000);assert.equal(r.response.status,413);assert.equal(r.stored,null);assert.match((await r.response.json()).error,/大文件存储/);});
test('本地32MiB边界以UTF8字节计算，拒绝时不写数据库',async()=>{const r=await save('local',Math.floor(32*1024*1024/3)+1);assert.equal(r.response.status,413);assert.equal(r.stored,null);});
