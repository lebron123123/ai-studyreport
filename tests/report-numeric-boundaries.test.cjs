const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const table=value=>'<table><tr><th>数值</th></tr><tr><td>'+value+'</td></tr></table>';
test('相邻表尾数字与下表年份表头不拼出虚假年单位',()=>{
  for(const value of ['86.82','100.00']){
    const before=table(value)+'<table><tr><th>年份</th></tr><tr><td>2026</td></tr></table>';
    const after='<p>复核说明。</p>'+table(value)+'\n\n<table><tr><th>年份</th></tr><tr><td>2026</td></tr></table>';
    assert.deepEqual(C.compareFacts(before,after).missing,[]);
    assert.deepEqual(C.compareFacts(before,value+'；2026').missing,[]);
  }
});
test('单元格、行、段落、换行与 Markdown 单元格的单位不跨边界',()=>{
  const cases=[
    '<table><tr><td>86.82</td><td>年</td></tr></table>',
    '<table><tr><td>86.82</td></tr><tr><td>年</td></tr></table>',
    '<p>86.82</p><p>年份</p>','<div>86.82</div><div>年份</div>',
    '86.82<br>年份','86.82\n年份','86.82\r\n年份',
    '|数值|单位|\n|---|---|\n|86.82|年|','86.82\t年'
  ];
  for(const before of cases)assert.deepEqual(C.compareFacts(before,'86.82').missing,[],before);
});
test('平方米与㎡仅作精确别名规范化，支持普通同行空格及行内标记',()=>{
  for(const expression of ['31平方米','31 平方米','31　平方米','31&nbsp;平方米','31&#160;平方米','<span>31</span><strong>平方米</strong>','31㎡']){
    const q=C.compareFacts(expression,'31㎡');assert.deepEqual(q.missing,[],expression);assert.equal(q.factsVerified,false);
    assert.deepEqual(C.compareFacts('31㎡',expression).missing,[],expression);
  }
  assert.deepEqual(C.compareFacts('占比23.7％','占比23.7%').missing,[]);
});
test('不进行单位换算或数值宽松匹配，真实数字变化和遗漏继续提示',()=>{
  for(const [before,after,missing] of [
    ['31平方米','32㎡',['31㎡']],['31平方米','31',['31㎡']],
    ['31万元','310000元',['31万元']],['6年','72个月',['6年']],
    ['100.00%','100%',['100.00%']],['86.82万元','86.82年',['86.82万元']],
    ['31\n平方米','31平方米',['31']]
  ]){const q=C.compareFacts(before,after);assert.deepEqual(q.missing,missing);assert.equal(q.issues[0].code,'numeric-difference');assert.equal(q.factsVerified,false);}
});
test('词法修正不改变全局 measure 或原输入，脚本与注释不成为数值事实',()=>{
  const before=table('86.82')+'<p>年份2026</p><p>面积31 平方米</p><!-- 999年 --><script>888年</script>';
  const copy=before,metrics=C.measure(before);assert.deepEqual(C.compareFacts(before,'86.82；2026；31㎡').missing,[]);
  assert.equal(before,copy);assert.deepEqual(C.measure(before),metrics);
});
