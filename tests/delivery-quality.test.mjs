import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreReportQuality,validateQualityContract} from '../functions/api/_report-quality.js';
import {deliverySnapshot,deliveryText} from '../functions/api/_delivery.js';
import {createRagObjectStore} from '../local-server/rag-object-store.js';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('结构化检查拒绝只出现关键词、错数值、缺表和占位',()=>{
  const contract={headings:['投资'],numbers:[{label:'总投资',value:123.5,unit:'万元'}],tables:[{title:'投资表',columns:['项目','金额'],minRows:1}],noPending:true};
  const text='# 投资\n总投资：123.5万元\n投资表\n|项目|金额|\n|---|---|\n|改造|123.5|';
  assert.equal(scoreReportQuality(contract,text).passed,true);
  for(const broken of [text.replace('# 投资','提及投资'),text.replace('123.5万元','123.6万元'),text.replace('|---|---|',''),text+'\n【待补：依据】'])assert.equal(scoreReportQuality(contract,broken).passed,false);
  assert.throws(()=>validateQualityContract({numbers:[{label:'总投资',unit:'元',value:'123'}]}));
  assert.equal(scoreReportQuality({required:['a.b'],numbers:[{label:'a.b',value:2,unit:'元'}]},'axb 2元').passed,false);
});

test('新expected全文核验有来源版本、全部出现勾稽，旧numbers冻结合同兼容',()=>{
  const contract={expected:[{key:'investment',label:'总投资',aliases:['项目投资额'],value:15000,unit:'万元',sourceRef:'snapshot-1',version:2}]};
  const good='总投资为1.5亿元。\n项目投资额为一亿五千万元。';
  const quality=scoreReportQuality(contract,good);assert.equal(quality.passed,true);assert.equal(quality.numericReconciliation.checked[0].occurrences.length,2);assert.equal(quality.semanticAccuracyVerified,false);
  assert.equal(scoreReportQuality(contract,good+'\n总投资14000万元').passed,false);
  assert.equal(scoreReportQuality(contract,'总投资待核对').passed,false);
  assert.equal(scoreReportQuality({expected:[]},good).passed,false);
  assert.throws(()=>validateQualityContract({expected:[{label:'总投资',value:1,unit:'万元'}]}),/来源与版本/);
  assert.equal(scoreReportQuality({numbers:[{label:'总投资',value:1,unit:'万元'}]},'总投资1万元').passed,true);
  const partial=scoreReportQuality(contract,good+'\n收入300万元');assert.equal(partial.passed,true);assert.equal(partial.numericReconciliation.passed,false);assert.equal(partial.numericReconciliation.unmatched.length,1);
});
test('冻结只含成果与测算，不受页面滚动和保存时间影响',()=>{
  const data={chapters:[{name:'第一章',sections:[{t:'项目',content:'正文',syncStatus:'stale'}]}],workflow:{calcSnapshots:[{value:1}]}};
  assert.deepEqual(deliverySnapshot(data),deliverySnapshot({...data,updated_at:2,scrollTop:200}));
  assert.match(deliveryText(deliverySnapshot(data)),/正文/);
});
test('流式原件：哈希去重、超限和中断清理',{timeout:10000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studyreport-stream-'));
  try{const store=createRagObjectStore(dir);async function* chunks(){yield Buffer.from('abc');yield Buffer.from('def');}
    const a=await store.putStream({stream:chunks()}),b=await store.putStream({stream:chunks()});assert.equal(a.contentHash,b.contentHash);assert.equal(b.deduplicated,true);assert.equal((await store.verify(a.storageKey,a.contentHash)).ok,true);
    await assert.rejects(()=>store.putStream({stream:chunks(),maxBytes:2}),/上限/);
    async function* broken(){yield Buffer.from('a');throw new Error('断网');}await assert.rejects(()=>store.putStream({stream:broken()}),/断网/);
    assert.deepEqual((await readdir(dir)).filter(n=>n.startsWith('.upload-')),[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
import {publicStaticPath} from '../local-server/static-policy.js';
test('静态目录禁止配置、原件及编码绕过，保留公开资源',()=>{
  for(const p of ['/local-server/.env','/LOCAL-DATA/a','/.git/config','/%252elocal/a','/outputs/backup.dump','/local-data%5ca','/a/../x','/a%00'])assert.equal(publicStaticPath(p),false,p);
  for(const p of ['/','/index.html','/report-delivery-ui.js','/assets/pets/a.mp4','/data/release-manifest-v1.json'])assert.equal(publicStaticPath(p),true,p);
});
