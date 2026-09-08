import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExpectedDeliveryHash,verifyFrozenDelivery,deliverySnapshot} from '../functions/api/_delivery.js';
import {reportEvidenceHash} from '../functions/api/_report-trusted-evaluation.js';

async function fixture(){
 const snapshot=deliverySnapshot({chapters:[{name:'总论',sections:[{t:'投资',content:'总投资：100万元'}]}]});
 const hash=await reportEvidenceHash(snapshot);
 return {hash,row:{content_hash:hash,snapshot_json:JSON.stringify(snapshot),contract_json:JSON.stringify({numbers:[{label:'总投资',value:100,unit:'万元'}]}),result_json:JSON.stringify({passed:true})}};
}
test('冻结支持旧调用，已提供的保存版本哈希必须匹配',()=>{
 const hash='a'.repeat(64);assert.doesNotThrow(()=>assertExpectedDeliveryHash(undefined,hash));assert.doesNotThrow(()=>assertExpectedDeliveryHash(hash,hash));
 for(const value of ['',null,'other','b'.repeat(64)])assert.throws(()=>assertExpectedDeliveryHash(value,hash),/重新读取版本/);
});
test('独立复核重新检查冻结正文及合同，不信任通过缓存',async()=>{
 const {row,hash}=await fixture();assert.equal((await verifyFrozenDelivery(row,hash)).passed,true);
 const badContract={...row,contract_json:JSON.stringify({numbers:[{label:'总投资',value:200,unit:'万元'}]})};
 await assert.rejects(()=>verifyFrozenDelivery(badContract,hash),/重新检查未通过/);
 await assert.rejects(()=>verifyFrozenDelivery({...row,snapshot_json:row.snapshot_json.replace('100万元','200万元')},hash),/校验不一致/);
 await assert.rejects(()=>verifyFrozenDelivery(row,'b'.repeat(64)),/正文或测算已变化/);
});
test('空冻结稿、待补稿不允许因历史缓存通过而确认',async()=>{
 const {row,hash}=await fixture();await assert.rejects(()=>verifyFrozenDelivery({...row,snapshot_json:'{}'},hash),/正文不完整/);
 const snapshot=JSON.parse(row.snapshot_json);snapshot.chapters[0].sections[0].content+='【待核：来源】';const modified=await reportEvidenceHash(snapshot);
 await assert.rejects(()=>verifyFrozenDelivery({...row,snapshot_json:JSON.stringify(snapshot),content_hash:modified},modified),/重新检查未通过/);
});

test('新冻结格式封存引用与逻辑，段落ID稳定且元数据变化不随机改变哈希',async()=>{
 const data={ts:1,documentRevision:1,chapters:[{cn:1,name:'总论',sections:[{t:'投资',content:'<p>总投资100万元</p><p>资金落实。</p>',prov:{web:[{url:'https://example.test/policy',version:'2026',excerpt:'总投资100万元'}]},logicSnapshot:{version:'19.2',globalRequirements:'简明'},lineage:{sourceVersion:'v1'}}]}],workflow:{currentReportVersionId:'r1',reportVersions:[{id:'r1',lineage:{calculation:{id:'calc-1',version:1}}}]}};
 const snapshot=deliverySnapshot(data),hash=await reportEvidenceHash(snapshot),section=snapshot.chapters[0].sections[0];
 assert.equal(snapshot.schemaVersion,2);assert.equal(section.paragraphs.length,2);assert.deepEqual(section.paragraphs.map(p=>p.id),['c1:s1:p1','c1:s1:p2']);
 assert.deepEqual(snapshot.references.lineage,{calculation:{id:'calc-1',version:1}});
 const saved=structuredClone(data);saved.ts=999;saved.documentRevision=200;assert.equal(await reportEvidenceHash(deliverySnapshot(saved)),hash);
 for(const field of ['prov','logicSnapshot','lineage']){const changed=structuredClone(snapshot);changed.chapters[0].sections[0][field].changed=true;assert.notEqual(await reportEvidenceHash(changed),hash);}
 const reordered=structuredClone(data);reordered.chapters[0].sections[0].prov={web:[{excerpt:'总投资100万元',version:'2026',url:'https://example.test/policy'}]};assert.equal(await reportEvidenceHash(deliverySnapshot(reordered)),hash);
});

test('原v1哈希逐字兼容，既有冻结内容不补写字段或假造来源',async()=>{
 const data={chapters:[{name:'总论',sections:[{t:'投资',content:'总投资：100万元',prov:{web:[]}}]}],calcParams:{investment:100}};
 const legacy={chapters:[{name:'总论',sections:[{title:'投资',content:'总投资：100万元'}]}],calculations:{investment:100}};
 assert.equal(JSON.stringify(deliverySnapshot(data,1)),JSON.stringify(legacy));
 const hash=await reportEvidenceHash(legacy),row={snapshot_json:JSON.stringify(legacy),content_hash:hash,contract_json:'{}'};
 assert.equal((await verifyFrozenDelivery(row,hash)).passed,true);assert.equal(row.snapshot_json,JSON.stringify(legacy));
});
