import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createD1Shim} from '../local-server/d1-shim.js';
import {onRequestPost,onRequestGet} from '../functions/api/projects.js';
import {signToken} from '../functions/api/_auth.js';
import {packState} from '../research-state-codec.mjs';
const target=testDatabaseUrl();
test('正式项目增量传输保留原JSON兼容、校验损坏和版本冲突',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB,DEPLOY_MODE:'local',SESSION_SECRET:crypto.randomUUID()};
 try{
  const user=await DB.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
  const token=await signToken(env,Number(user.id),user.username),headers={authorization:'Bearer '+token};
  const id=crypto.randomUUID();
  async function post(body){const r=await onRequestPost({env,request:new Request('http://test/api/projects',{method:'POST',headers,body:JSON.stringify({id,name:'[系统测试]项目增量',...body})})});return {status:r.status,...await r.json()};}
  const state={project:{name:'[系统测试]'},material:'完整资料'.repeat(100000),chapters:[{content:'旧正文'.repeat(3000)}]};
  const first=await post({data:state});assert.equal(first.ok,true);assert.equal(first.storageProtocol,'parts-v1');
  const before=await packState(state);state.chapters[0].content='新正文'.repeat(3000);const after=await packState(state);
  const packed={manifest:after.manifest,objects:[...after.objects].filter(([k])=>!before.objects.has(k))};
  const corrupt=structuredClone(packed);corrupt.objects[0][1]+='坏';
  assert.equal((await post({packed:corrupt,expectedUpdatedAt:first.updatedAt})).status,409);
  const second=await post({packed,expectedUpdatedAt:first.updatedAt});assert.equal(second.ok,true);
  assert.equal((await post({packed,expectedUpdatedAt:first.updatedAt})).status,409);
  const row=await DB.prepare('SELECT data FROM projects WHERE id=?').bind(id).first(),saved=JSON.parse(row.data);
  assert.equal(saved.material,state.material);assert.deepEqual(saved.chapters,state.chapters);assert.equal(saved.storageFormat,undefined);
 }finally{await DB._close();}
});
