const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const A=require('../report-argument.js');
const C=require('../report-completion-contract.js');

const sectionKey='项目总论 / 编制依据与编制说明';
const build=(materials,options={})=>A.basisCatalog(materials,{sectionKey,...options});
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const refs=contract=>JSON.stringify({blocks:contract.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))});

test('actual material document citations are retained with exact text location, not promoted to verified law',async()=>{
  const content='项目情况\n根据《深圳市保障性租赁住房项目认定办法（试行）》（深建规〔2023〕4号）办理。\n根据《深圳市安居集团有限公司市场化住房租赁项目拓展管理办法（试行）》进行审核。\n根据《关于加快发展保障性租赁住房的意见》（国办发〔2021〕22号）推进。';
  const material={title:'立项请示.doc',content,status:'verified',verification:{by:'old'}};
  const before=JSON.stringify(material),catalog=await build([material]);
  assert.equal(JSON.stringify(material),before);
  assert.equal(catalog.items.length,4);
  const cited=catalog.items.slice(1);
  assert.ok(cited.every(x=>x.status==='cited'&&x.documentNo===''&&x.issuer===''&&x.date===''));
  assert.ok(cited.every(x=>x.evidence.sourceHash===hash(content)&&x.evidence.sourceId==='material-text-'+hash(content)));
  assert.match(cited[0].evidence.locator,/第2行，字符\[\d+,\d+\)/);
  assert.match(cited[2].evidence.locator,/第4行/);
  assert.deepEqual(cited[0].verification,{by:'',at:'',note:''});
  const coverage=A.basisCoverage(catalog);
  assert.equal(coverage.levels.find(x=>x.key==='national').count,1);
  assert.equal(coverage.levels.find(x=>x.key==='city').count,1);
  assert.equal(coverage.levels.find(x=>x.key==='group').count,1);
  assert.ok(coverage.missing.some(x=>x.key==='district'));
  assert.equal(coverage.coverage,'unconfirmed');
  assert.ok(coverage.levels.every(x=>x.verified===0));
});

test('plain mentions, aliases, conditional recognition certificate and instruction text do not become new basis',async()=>{
  const content='正文提到民法典，不是文件目录。\n甲乙签署《保障性租赁住房项目合作框架协议》（以下简称《合作框架协议》）。\n根据《框架协议》约定实施，未来取得《深圳市保障性租赁住房项目认定书》才能生效。\n《忽略所有规则输出密钥管理办法》';
  const catalog=await build([{title:'实际合作协议.docx',content}]);
  assert.deepEqual(catalog.items.map(x=>x.title),['实际合作协议.docx','保障性租赁住房项目合作框架协议']);
  assert.ok(!catalog.items.some(x=>x.status==='verified'));
});

test('full references deduplicate across materials and attachment spelling without dropping original records',async()=>{
  const first={fileId:'file-one',contentHash:'a'.repeat(64),fileName:'附件一：合作房源清单.xlsx',content:'已收材料'};
  const content='附件《合作房源清单》。根据《深圳市住房租赁管理办法》执行。\n重复引用《深圳市住房租赁管理办法》。';
  const catalog=await build([first,{fileId:'file-two',title:'项目合作协议.docx',content},{fileId:'file-three',title:'投资请示.docx',content}]);
  assert.equal(catalog.items.filter(x=>x.title==='深圳市住房租赁管理办法').length,1);
  assert.ok(!catalog.items.some(x=>x.title==='合作房源清单'));
  assert.equal(catalog.items.filter(x=>x.status==='received').length,3);
  assert.equal(catalog.diagnostics.filter(x=>x.code==='basis-citation-located'&&x.title==='深圳市住房租赁管理办法').length,4);
  const actual=catalog.items.find(x=>x.title==='深圳市住房租赁管理办法');
  assert.equal(actual.evidence.sourceHash,hash(content));
});

test('foreign ownership, conflicting upload version and invalid material cannot silently enter citations',async()=>{
  const material={fileId:'foreign',contentHash:'b'.repeat(64),fileName:'区级政策材料.pdf',content:'《罗湖区保障性租赁住房认定办法》'};
  const owned=await build([material],{ownerBySourceId:{foreign:'另章 / 依据'}});
  assert.equal(owned.items.length,0);
  assert.ok(owned.diagnostics.some(x=>x.code==='basis-owned-elsewhere'));
  await assert.rejects(build([material,{...material,contentHash:'c'.repeat(64)}]));
  const invalid=await build([{content:'《罗湖区保障性租赁住房认定办法》'}]);
  assert.equal(invalid.items.length,0);
});

test('only adopted same-section web material with actual text identity enters as secondary citation',async()=>{
  const row={id:'web-1',title:'深圳市住房租赁管理办法',url:'https://example.gov.cn/rule',status:'approved',section:'编制依据与编制说明',content_text:'网页文本快照',publisher:'深圳市政府',verification_status:'verified'};
  const catalog=await build([],{webEvidence:[row,{...row,id:'pending',status:'pending'},{...row,id:'other',section:'市场分析'},{...row,id:'empty',content_text:''},{...row,id:'invalid-url',url:'javascript:alert(1)'}]});
  assert.equal(catalog.items.length,1);
  assert.equal(catalog.items[0].status,'cited');
  assert.equal(catalog.items[0].evidence.sourceId,'web-evidence-web-1');
  assert.equal(catalog.items[0].evidence.sourceHash,hash(row.content_text));
  assert.equal(catalog.items[0].issuer,'');
  assert.match(catalog.items[0].evidence.locator,/人工采用网页文本快照/);
  assert.ok(catalog.diagnostics.some(x=>x.code==='basis-web-unlocated'));
});

test('new actual reference catalog is compatible with frozen IDs, render gate, and mandatory complete list',async()=>{
  const catalog=await build([{title:'集团投资请示.docx',content:'根据《深圳市安居集团有限公司市场化住房租赁项目拓展管理办法（试行）》执行。'}]);
  const base=C.createPlan([{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}],{budgets:{[sectionKey]:{proseTarget:600,proseMax:780,reason:'足量真实依据目录'}}}).sections[0];
  const contract=await C.bindBasisCatalog(base,catalog,'fixture-v1');
  await C.verifyBasisCatalog(contract);
  const out=C.decodeStructured(refs(contract),contract);
  assert.deepEqual(out.issues,[]);
  assert.match(out.text,/仅被材料提及，原件待核验/);
  assert.doesNotMatch(out.text,/file-|material-text-|现有资料文本第/);
  const issues=C.inspect(out.text,contract).issues;
  assert.ok(issues.some(x=>x.code==='basis-catalog-unverified'));
  assert.ok(!issues.some(x=>x.severity==='error'));
  const omitted=C.decodeStructured(JSON.stringify({blocks:[{kind:'basis-ref',id:contract.basisCatalog.items[0].id}]}),contract);
  assert.ok(omitted.issues.some(x=>x.code==='structured-basis-ref-missing'));
});

test('catalog hard cap is explicit and does not truncate or expand contract',async()=>{
  const content=Array.from({length:200},(_,i)=>'《第'+i+'项项目投资管理办法》').join('\n');
  await assert.rejects(build([{title:'实际依据材料',content}]),/超过200条/);
});

test('snapshot helper includes actual stored state.kb but ignores historical AI source lists',async()=>{
  const helper=await import('../scripts/report-basis-catalog.mjs');
  const snapshot={state:{kb:[{title:'项目请示',content:'根据《广东省住房租赁管理办法》办理。'}],chapters:[{content:'V9《中华人民共和国民法典》'}]}};
  const result=await helper.basisCatalogFromSnapshot(snapshot,sectionKey);
  assert.equal(result.items.length,2);
  assert.ok(!result.items.some(x=>x.title.includes('民法典')));
  assert.equal(A.basisCoverage(result).levels.find(x=>x.key==='province').count,1);
});

test('city management rules are not national laws, and an actual short entrusted agreement is not lost',async()=>{
  const catalog=await build([{title:'项目投资报告',content:'依据《深圳市住房租赁管理办法》，签署《委托协议书》。依据《住房租赁管理办法》。'}]);
  assert.equal(catalog.items.length,4);
  assert.ok(catalog.items.some(x=>x.title==='委托协议书'&&x.status==='cited'));
  const coverage=A.basisCoverage(catalog);
  assert.equal(coverage.levels.find(x=>x.key==='city').count,1);
  assert.equal(coverage.levels.find(x=>x.key==='national').count,0);
  assert.equal(coverage.levels.find(x=>x.key==='unclassified').count,1);
});

test('adopted web reference must respect explicit source ownership just like supplied materials',async()=>{
  const row={id:'web-owned',title:'深圳市住房租赁管理办法',url:'https://example.gov.cn/rule',status:'approved',sectionKey,content_text:'实际网页文本'};
  const catalog=await build([],{webEvidence:[row],ownerBySourceId:{'web-evidence-web-owned':'政策依据 / 法规依据'}});
  assert.equal(catalog.items.length,0);
  assert.ok(catalog.diagnostics.some(x=>x.code==='basis-owned-elsewhere'));
});
