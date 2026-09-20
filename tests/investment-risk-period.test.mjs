import test from 'node:test';
import assert from 'node:assert/strict';
import {investmentRiskPeriod as view} from '../functions/api/_investment-risk-period.mjs';
const risk={id:'r',projectId:'p',createdDate:'2026-08-01',status:'open',level:'high'};
test('周月结转未结；指标重叠不重复相加；不变更等级',()=>{
 const input=[risk,{...risk,id:'new',createdDate:'2026-09-08',escalatedDate:'2026-09-09',dueDate:'2026-09-09'}];
 for(const period of ['week','month']){
  const r=view({asOf:'2026-09-09',period,risks:input});
  assert.deepEqual(r.totals,{unique:2,unresolved:2,carryover:1,added:1,escalated:1,due:1});
  assert.equal(r.items[0].level,'high');assert.equal(r.semantics,'current-retrospective');
 }
 assert.equal(input[0].carryover,undefined);
});
test('旧关闭与缓释不冒充有效关闭；项目ID隔离；重复记录拒绝',()=>{
 const r=view({asOf:'2026-09-09',risks:[{...risk,status:'closed'},{...risk,projectId:'p2',status:'mitigated'},{...risk,id:'closed',status:'closed',closureVerified:true}]});
 assert.equal(r.totals.unresolved,2);
 assert.throws(()=>view({asOf:'2026-09-09',risks:[risk,risk]}),/重复/);
});
test('空覆盖、失败、过期和未来检查均不能健康；周起点跨年',()=>{
 assert.equal(view({asOf:'2026-09-09',risks:[{...risk,createdDate:'bad',dueDate:'2026-09-99'}]}).items[0].dateUnknown,true);
 assert.equal(view({asOf:'2027-01-01'}).startDate,'2026-12-28');
 assert.equal(view({asOf:'2026-09-09'}).coverage.status,'unknown');
 const good={status:'complete',checkedAt:100,now:200,maxAgeMs:100};
 assert.equal(view({asOf:'2026-09-09',coverage:[good]}).coverage.status,'complete');
 for(const bad of [{...good,status:'failed'},{...good,now:201},{...good,checkedAt:201}])assert.equal(view({asOf:'2026-09-09',coverage:[good,bad]}).coverage.status,'unknown');
});
