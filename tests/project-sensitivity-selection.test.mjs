import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequestPost} from '../functions/api/calcconfig.js';
import {resolveKeyFields} from '../functions/api/aireport.js';
import {signToken} from '../functions/api/_auth.js';
import {validateSelection} from '../functions/api/_project-sensitivity-selection.js';
const row=(key,STi)=>({key,label:key,STi,Si:STi,STiLow:STi*.8,STiHigh:STi*1.2,spearmanRho:.2,src:.2,combinedRank:1,selected:STi>=.001});
const selection=()=>({version:'anju-global-v2',selectionApplied:true,N:300,threshold:.001,table:[row('rent',.4),row('discount',0),row('rampRates.0',.1),row('operateStartMonth',.02)]});
test('v4 policy blocks fixed rules and dates, supports reclassification and AI resolution',()=>{
 const data=selection();Object.assign(data,{selectionMode:'impact-v4',criteria:{sti:.001,irr:.1,npv:.1,weighted:.1}});
 data.table=data.table.slice(0,2);data.table.forEach((r,i)=>Object.assign(r,{policy:i?'fixed':'actual',selectionSource:'threshold',irrDeviation:1,npvDeviation:100,npvRelative:1,weightedScore:1,selected:!i}));
 validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}).map(r=>r.key),['rent']);
 data.table[1].selected=true;data.table[1].selectionSource='manual';assert.throws(()=>validateSelection(data),/固定规则/);
 data.table[1].policy='assumed';validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}).map(r=>r.key),['rent','discount']);
 data.table[1].key='operateStartMonth';assert.throws(()=>validateSelection(data),/时间边界/);
});
test('v3 strict OR and weighted score validation',()=>{
 const data=selection();Object.assign(data,{selectionMode:'impact-v3',criteria:{sti:.001,irr:.1,npv:.1,weighted:.1}});
 data.table=data.table.slice(0,2);data.table.forEach((r,i)=>Object.assign(r,{selectionSource:'threshold',irrDeviation:i?1:.1,npvDeviation:i?100:10,npvRelative:i?1:.1,weightedScore:i?1:.1,selected:!!i}));
 validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}).map(r=>r.key),['discount']);
 data.table[0].selected=true;assert.throws(()=>validateSelection(data),/门槛不一致/);data.table[0].selected=false;
 data.table[0].weightedScore=.2;assert.throws(()=>validateSelection(data),/综合影响/);
});
test('v2 actual-only selection preserves low-effect exclusions despite high STi',()=>{
 const data=selection();Object.assign(data,{selectionMode:'impact-v2',criteria:{sti:.001,irr:1,npv:null}});
 data.table.forEach(r=>Object.assign(r,{selectionSource:'threshold',irrDeviation:.1,npvDeviation:20,selected:false}));
 validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}),[]);
 data.table[0].selected=true;assert.throws(()=>validateSelection(data),/门槛不一致/);
 data.table[0].selectionSource='manual';validateSelection(data);assert.equal(resolveKeyFields('gaibao',{gaibao:data})[0].key,'rent');
});
test('impact criteria and manual selection survive AI field resolution',()=>{
 const data=selection();Object.assign(data,{selectionMode:'impact-v1',criteria:{sti:.001,irr:null,npv:10}});
 data.table.forEach(r=>Object.assign(r,{selectionSource:'threshold',irrDeviation:0,npvDeviation:20,selected:true}));
 data.table[0].selected=false;data.table[0].selectionSource='manual';
 validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}).map(r=>r.key),['discount','rampRates','operateStartMonth']);
 data.table[1].selected=false;assert.throws(()=>validateSelection(data),/门槛不一致/);
 data.table[1].selectionSource='manual';validateSelection(data);
 data.criteria.npv=-1;assert.throws(()=>validateSelection(data),/门槛无效/);
});
test('applied threshold is exact, no legacy minimum three or fixed seven fallback',()=>{
 const data=selection();validateSelection(data);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}).map(x=>x.key),['rent','rampRates','operateStartMonth']);
 data.threshold=2;data.table.forEach(r=>r.selected=false);assert.deepEqual(resolveKeyFields('gaibao',{gaibao:data}),[]);
 data.table[0].selected=true;assert.throws(()=>validateSelection(data),/不一致/);
});
test('admin-only scoped apply preserves rent/sale, rejects stale snapshot and invalid records',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE configs(key TEXT PRIMARY KEY,data TEXT,updated_at INTEGER)');
 const env={SESSION_SECRET:'isolated-sensitivity-test',ADMIN_USERS:'admin',ADMIN_PASS:'test-only',DB:{prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args);},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}}}}};
 try{db.prepare('INSERT INTO configs VALUES(?,?,?)').run('calc_sensitivity',JSON.stringify({rent:{keep:1},sale:{keep:2}}),1);
 const admin=await signToken(env,1,'admin'),user=await signToken(env,2,'user');
 const call=async(token,data=selection(),expected=null,pass='test-only')=>onRequestPost({env,request:new Request('http://test/api/calcconfig',{method:'POST',headers:{authorization:'Bearer '+token,'x-admin-pass':pass,'content-type':'application/json'},body:JSON.stringify({key:'sensitivity',applyProjectSensitivity:true,data,expected})})});
 assert.equal((await call(user)).status,403);assert.equal((await call(admin,selection(),null,'bad')).status,403);
 assert.equal((await call(admin)).status,200);const saved=JSON.parse(db.prepare('SELECT data FROM configs').get().data);assert.equal(saved.rent.keep,1);assert.equal(saved.sale.keep,2);
 assert.equal((await call(admin)).status,409);assert.equal((await call(admin,selection(),selection())).status,200);
 const invalid=selection();invalid.table[0].key='futureUnknown';assert.equal((await call(admin,invalid,selection())).status,400);
 const impact=selection();Object.assign(impact,{selectionMode:'impact-v1',criteria:{sti:.001,irr:null,npv:10}});impact.table.forEach(r=>Object.assign(r,{selected:true,selectionSource:'manual',irrDeviation:0,npvDeviation:20}));
 assert.equal((await call(admin,impact,selection())).status,200);
 const applied=JSON.parse(db.prepare('SELECT data FROM configs').get().data);
 assert.ok(resolveKeyFields('gaibao',applied).some(r=>r.key==='discount'));assert.equal(applied.rent.keep,1);
 }finally{db.close();}
});
