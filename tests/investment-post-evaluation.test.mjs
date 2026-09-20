import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvaluationComparison as compare,normalizeContractClause as clause} from '../investment-post-evaluation.mjs';
const metric={metricKey:'revenue',periodStart:'2026-01-01',periodEnd:'2026-12-31',unit:'万元',currency:'CNY',basis:'不含税',value:100};
test('A43 后评价季度实际不与全年目标直接判差',()=>{const x=compare([metric],[{...metric,id:'a',periodEnd:'2026-03-31',version:1,value:20}]);assert.equal(x.rows[0].delta,null);assert.equal(x.coverage.ratio,0);assert.equal(x.score,null);});
test('A44 预测IRR不冒充已实现值',()=>assert.throws(()=>compare([{...metric,metricKey:'irr'}],[]),/IRR/));
test('A45 缺失、不适用与来源失效分别计数',()=>{const targets=[metric,{...metric,metricKey:'paid'},{...metric,metricKey:'performed'}];const x=compare(targets,[{...metric,id:'a',version:1,requiresReview:true}],[{...metric,metricKey:'paid',reason:'没有支付义务'}]);assert.deepEqual(x.coverage,{total:3,applicable:2,compared:0,missing:1,invalid:1,notApplicable:1,ratio:0});assert.equal(x.score,null);});
test('不适用按完整业务口径定位，不排除同名的另一币种或单位',()=>{
 const other={...metric,currency:'USD'},x=compare([metric,other],[],[{...metric,reason:'本人民币指标不适用'}]);
 assert.equal(x.rows[0].status,'not_applicable');assert.equal(x.rows[1].status,'missing');assert.equal(x.coverage.applicable,1);
 for(const change of [{unit:'元'},{currency:'USD'},{basis:'含税'},{periodEnd:'2026-03-31'}])assert.throws(()=>compare([metric],[],[{...metric,...change,reason:'不适用'}]),/完整口径/);
 assert.throws(()=>compare([metric],[],[{metricKey:'revenue',periodStart:metric.periodStart,periodEnd:metric.periodEnd,reason:'遗漏单位'}]),/字段/);
 assert.throws(()=>compare([metric],[],[{...metric,reason:'一'},{...metric,reason:'二'}]),/重复/);
});
test('后评价同口径最新实际、0目标和无有效指标不伪造百分比',()=>{const x=compare([{...metric,value:0}],[{...metric,id:'a',version:1,value:5},{...metric,id:'b',version:2,value:7}]);assert.equal(x.rows[0].delta,7);assert.equal(x.rows[0].relativeDelta,null);assert.equal(compare([metric],[],[{...metric,reason:'不适用'}]).coverage.ratio,null);assert.throws(()=>compare([metric,metric],[]),/重复/);});
const base={clauseId:'payment-1',title:'首期付款',quote:'生效后30天支付首期款',locator:'第3页第2条',obligor:'甲方',condition:'完成交付',conditionStatus:'unknown',lifecycle:'effective',triggerDate:'2026-01-01',offsetDays:30};
test('A35 未知及未成立条件不按上传日或输入日期起算',()=>{for(const conditionStatus of ['unknown','unmet'])assert.equal(clause({...base,conditionStatus}).deadline,null);assert.throws(()=>clause({...base,conditionStatus:'met'}),/证据/);});
test('协议签署、生效、变更、终止分别控制起算',()=>{const b={...base,conditionStatus:'met',triggerEvidenceId:'fact-1',triggerLocator:'第2页'};assert.equal(clause(b).deadline,'2026-01-31');assert.equal(clause({...b,lifecycle:'signed'}).deadline,null);assert.equal(clause({...b,lifecycle:'terminated'}).activated,false);assert.throws(()=>clause({...b,triggerDate:'2026-02-30'}),/日期/);});
