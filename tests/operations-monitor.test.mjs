import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {ensureOperations,observeOperations,dispatchOperations,readOperations,monitorConditions} from '../functions/api/_operations-monitor.js';
test('监控用时间窗口增量，不把上次进程错误算到重启后',()=>{
  const s={observedAt:100,jobs:[],uncertainCalls:0,expiredLeases:0,runtime:{startedAt:2,requests:20,failures:10,p95Ms:50}};
  assert.equal(monitorConditions(s,{runtime:{startedAt:1,requests:10,failures:0}}).server_errors,false);
  assert.equal(monitorConditions(s,{runtime:{startedAt:2,requests:10,failures:0}}).server_errors,true);
});
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('隔离数据库：告警并发去重、失败重试、重连与恢复通知',{skip:!target},async()=>{
  const u=new URL(target);assert.match(u.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname));
  const DB=createD1Shim(target),env={DB,OPERATIONS_ALERT_URL:'https://alert.test.invalid'};
  try{
    await ensureOperations(env);
    const at=Date.now(),base={observedAt:at,jobs:[],uncertainCalls:0,expiredLeases:0,runtime:null};
    await observeOperations(env,base);
    await Promise.all([observeOperations(env,{...base,observedAt:at+1,uncertainCalls:1}),observeOperations(env,{...base,observedAt:at+1,uncertainCalls:1})]);
    const events=(await DB.prepare('SELECT * FROM operations_alerts WHERE created_at=?').bind(at+1).all()).results;assert.equal(events.length,1);
    await dispatchOperations(env,async()=>new Response('',{status:503}));
    assert.equal((await DB.prepare('SELECT status FROM operations_alerts WHERE id=?').bind(events[0].id).first()).status,'pending');
    await DB.prepare('UPDATE operations_alerts SET next_at=0 WHERE id=?').bind(events[0].id).run();
    const seen=[];await dispatchOperations(env,async(url,opts)=>{seen.push(opts.headers['idempotency-key']);return new Response('{}');});assert.ok(seen.includes(events[0].id));
    const DB2=createD1Shim(target);try{assert.equal((await readOperations({...env,DB:DB2})).state.conditions.billing,true);await observeOperations({...env,DB:DB2},{...base,observedAt:at+2});}finally{await DB2._close();}
    const recovery=(await DB.prepare('SELECT kind FROM operations_alerts WHERE created_at=?').bind(at+2).all()).results;assert.deepEqual(recovery,[{kind:'recovery'}]);
    assert.equal((await dispatchOperations({DB})).configured,false);
  }finally{await DB._close();}
});
