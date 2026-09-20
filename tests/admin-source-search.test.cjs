const {test}=require('node:test');
const assert=require('node:assert/strict');
const {queries,safeUrl}=require('../admin-source-search.js');
test('batch query normalization and explicit limits',()=>{
  assert.deepEqual(queries(' 民法典\n\n民法典\r\n建设标准 '),['民法典','建设标准']);
  assert.throws(()=>queries(' '));
  assert.equal(queries(Array.from({length:30},(_,i)=>i).join('\n')).length,30);
  assert.equal(queries('文'.repeat(1000))[0].length,1000);
  assert.throws(()=>queries(Array.from({length:31},(_,i)=>i).join('\n')));
  assert.throws(()=>queries('a'.repeat(1001)));
});
test('source links reject active content and malformed URLs',()=>{
  assert.equal(safeUrl('javascript:alert(1)'),'');
  assert.equal(safeUrl('not a URL'),'');
  assert.equal(safeUrl('https://www.gov.cn/policy'),'https://www.gov.cn/policy');
});
