const test=require('node:test'),assert=require('node:assert/strict'),L=require('../investment-lifecycle.js');
const actual=(extra={})=>({metricKey:'revenue',value:90,periodStart:'2026-01-01',periodEnd:'2026-12-31',unit:'万元',currency:'CNY',basis:'rent:income.total',sourceRef:'财务账单',sourceEvidenceId:'evidence-1',confirmed:true,expectedVersion:0,requestKey:'request-0001',version:1,...extra});
test('actual values require source, finite value, dates, basis and explicit confirmation',()=>{
  assert.equal(L.normalizeActual(actual({value:0})).value,0);
  for(const patch of [{value:null},{value:NaN},{value:Infinity},{value:'90'},{metricKey:'irr'},{periodStart:'2026-02-30'},{confirmed:false},{currency:'USD'},{unit:'元'},{sourceEvidenceId:''},{expectedVersion:-1},{requestKey:''}])assert.throws(()=>L.normalizeActual(actual(patch)));
});
test('actual correction replaces only its own version and does not fabricate variance attribution',()=>{
  const base=actual(),next=actual({version:2,value:110}),forecast={annualValues:[{...base,value:100}]},result=L.compareActuals(forecast,[base,next]);assert.equal(result.length,1);assert.equal(result[0].delta,10);assert.equal(result[0].attribution.quantity,null);assert.equal(result[0].attribution.unexplained,10);
  assert.equal(L.compareActuals(forecast,[actual({periodEnd:'2026-11-30'})])[0].comparable,false);assert.equal(L.compareActuals({annualValues:[{...base,value:0}]},[next])[0].relativeDelta,null);
});
test('change preview lists exact parameter paths and never approves target',()=>{
  const before={kind:'forecast',parameters:{rent:30,cost:{price:10}},dependencies:{snapshotId:'s1'},annualValues:[actual({value:100})]},after={parameters:{rent:40,cost:{price:10}},dependencies:{snapshotId:'s2'},annualValues:[actual({value:120})]},copy=JSON.stringify(before),r=L.previewChange(before,after);assert.deepEqual(r.parameters.map(x=>x.path),['rent']);assert.equal(r.annual[0].delta,20);assert.equal(r.formalApproval,false);assert.equal(JSON.stringify(before),copy);
});
test('portfolio keeps period, basis and contract layers separate; no IRR or occupancy average',()=>{
  const result=L.aggregateActuals([{projectId:'a',actuals:[actual(),actual({metricKey:'paid',value:20}),actual({metricKey:'irr',value:5}),actual({metricKey:'occupancy',unit:'%',value:90})]},{projectId:'b',actuals:[actual({value:10}),actual({value:20,periodEnd:'2026-11-30'})]}]);assert.equal(result.groups.length,3);assert.equal(result.groups.find(x=>x.metricKey==='revenue'&&x.periodEnd==='2026-12-31').value,100);assert.equal(result.groups.find(x=>x.metricKey==='paid').value,20);
});
