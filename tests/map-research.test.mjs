import test from 'node:test';
import assert from 'node:assert/strict';
import {distance,circle,polygon,area,length,parseCSV,normalizeProject,mergeProjects,filterProjects,decodeBundle,safeURL} from '../project-map/research-core.mjs';
import {mapAround} from '../functions/api/_map-around.js';

test('education searches school category only; supplier QPS retries once without exposing provider payload',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async url=>{assert.equal(url.searchParams.get('types'),'141200');calls++;return {ok:true,json:async()=>calls===1?{status:'0',infocode:'10021',info:'private payload'}:{status:'1',count:'0',pois:[]}};};
  const r=await mapAround({location:'114,22.5',radius:500,category:'教育'},'test');assert.equal(calls,2);assert.equal(r.status,200);assert.deepEqual(r.data.items,[]);
  globalThis.fetch=async()=>({ok:true,json:async()=>({status:'0',infocode:'10044',info:'private payload'})});
  const denied=await mapAround({location:'114,22.5',radius:500,category:'教育'},'test');assert.match(denied.data.error,/10044/);assert.doesNotMatch(denied.data.error,/private payload/);
 }finally{globalThis.fetch=original;}
});

test('blank CSV coordinates remain unset; formal projects preserve distinct IDs',()=>{
 assert.equal(normalizeProject({name:'A','经度':'','纬度':''}).point,null);
 const rows=['one','two'].map(id=>normalizeProject({id,name:'同名项目',address:'同一地址',source:'正式项目库（只读）'}));
 assert.equal(mergeProjects([],rows).added.length,2);
 assert.equal(mergeProjects(rows,rows).duplicates.length,2);
});
test('history import validates independent snapshots and recomputes distances',()=>{
 const project=normalizeProject({name:'历史',point:[114,22.5]});
 const record={id:'r',date:'2026-09-15T10:00:00Z',project,radius:500,facilities:[{name:'学校',category:'教育',point:[114.001,22.5],distance:999999}],outcomes:{教育:{state:'loading'}},note:'测试'};
 const bundle={version:1,projects:[{...project,point:[114.1,22.5]}],records:[record]};
 const result=decodeBundle(JSON.stringify(bundle));
 assert.deepEqual(result.records[0].project.point,[114,22.5]);
 assert.ok(result.records[0].facilities[0].distance<104);
 assert.equal(result.records[0].outcomes.教育.state,'failed');
 record.facilities[0].point=[115,22.5];
 assert.throws(()=>decodeBundle(JSON.stringify(bundle)));
});
test('range circles and distances use metres',()=>{const p=[114,22.5];assert.equal(distance(p,p),0);for(const r of [500,1000,2000,3000])for(const q of circle(p,r))assert.ok(Math.abs(distance(p,q)-r)<.01);assert.throws(()=>circle(p,0));assert.ok(Math.abs(length([p,[114.001,22.5]])-102.73)<1);});
test('redline area, invalid/self intersecting geometry',()=>{const ring=polygon([[114,22.5],[114.001,22.5],[114.001,22.501],[114,22.501]]);assert.ok(area(ring)>11000&&area(ring)<12000);assert.deepEqual(ring[0],ring.at(-1));assert.throws(()=>polygon([[0,0],[1,1],[0,1],[1,0]]));assert.throws(()=>polygon([[1,1],[2,2]]));assert.throws(()=>polygon([[1,1],[2,2],[3,3]]));});
test('CSV handles BOM, commas, escaped quotes and malformed rows',()=>{assert.deepEqual(parseCSV('\uFEFF项目名称,地址\r\n"A,栋","路""口"\r\n'),[{'项目名称':'A,栋','地址':'路"口'}]);assert.throws(()=>parseCSV('a,b\n1'));assert.throws(()=>parseCSV('a\n"x'));});
test('project conversion, duplicate protection and filters',()=>{const p=normalizeProject({name:'A',point:[114,22.5],district:'南山',type:'租赁',stage:'研究'});assert.equal(p.confirmed,false);const q=normalizeProject({name:'A',point:[114,22.5]});assert.equal(mergeProjects([p],[q]).duplicates.length,1);assert.equal(filterProjects([p],{district:'南山',query:'A'}).length,1);assert.equal(filterProjects([p],{stage:'运营'}).length,0);assert.throws(()=>normalizeProject({name:'A',point:[999,9]}));assert.equal(normalizeProject({name:'A'}).point,null);});
test('bundle roundtrip, unsafe URLs, validation before mutation',()=>{const p=normalizeProject({name:'<script>x</script>',point:[114,22.5],photo:'javascript:alert(1)'});assert.equal(p.photo,'');assert.equal(safeURL('https://a:b@example.com'),'');p.confirmed=true;const b=decodeBundle(JSON.stringify({version:1,projects:[p],records:[]}));assert.equal(b.projects[0].confirmed,true);assert.throws(()=>decodeBundle(JSON.stringify({version:2,projects:[],records:[]})));assert.throws(()=>decodeBundle(JSON.stringify({version:1,projects:[p,p],records:[]})));});
test('provider validates requests and reports failures distinctly',async()=>{assert.equal((await mapAround({location:'0,0',radius:1000,category:'教育'},'test')).status,400);const old=globalThis.fetch;try{globalThis.fetch=async()=>{throw Error('network')};assert.equal((await mapAround({location:'114,22.5',radius:1000,category:'教育'},'test')).status,503);globalThis.fetch=async()=>({ok:true,json:async()=>({status:'0'})});assert.equal((await mapAround({location:'114,22.5',radius:1000,category:'教育'},'test')).status,502);globalThis.fetch=async()=>({ok:true,json:async()=>({status:'1',count:'26',pois:[{name:'School',location:'114,22.5'}]})});const result=await mapAround({location:'114,22.5',radius:1000,category:'教育'},'test');assert.equal(result.data.items.length,1);assert.equal(result.data.truncated,true);assert.equal(result.data.source,'高德周边搜索');}finally{globalThis.fetch=old;}});
test('3000m radius reaches provider and survives saved record import',async()=>{
 const old=globalThis.fetch;
 try {globalThis.fetch=async url=>{assert.equal(url.searchParams.get('radius'),'3000');return {ok:true,json:async()=>({status:'1',count:'0',pois:[]})};};
 assert.equal((await mapAround({location:'114,22.5',radius:3000,category:'教育'},'test')).status,200);
 }finally{globalThis.fetch=old;}
 const project=normalizeProject({name:'测试',point:[114,22.5]});
 const result=decodeBundle(JSON.stringify({version:1,projects:[project],records:[{id:'r3000',date:'2026-09-15T10:00:00Z',project,radius:3000,facilities:[],outcomes:{},note:''}]}));
 assert.equal(result.records[0].radius,3000);
});
