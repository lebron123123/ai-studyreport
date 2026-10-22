const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.window=global;require('../nrcalc.js');
const source=fs.readFileSync(require.resolve('../calc.js'),'utf8'),helper=source.slice(source.indexOf('function buildCalcDigest(){'));
const base=require('./fixtures/nrcalc-reference.json').cases[0].params;
const params={...base,area:5621.15,units:51,rent:45,buildStartMonth:'2027-01',buildEndMonth:'2027-06',operateStartMonth:'2027-07',operateEndMonth:'2031-12',occupancyMode:'monthly-phases',rampOcc:.15,rampRates:[.15,.3,.5,.7],rampIntervalMonths:1,rampStartMonth:'2027-07',rampEndMonth:'2027-10',stableStartMonth:'2027-11',stableOcc:.85};
const digest=(p,r)=>{const ctx={calcParams:p,calcResult:r};vm.createContext(ctx);vm.runInContext(helper,ctx);return ctx.buildCalcDigest();};
test('月度爬坡摘要引用引擎的首个运营自然年平均值，不把首月当首年',()=>{
  const r=NRCalc.calc(NRCalc.fromParams(params)),before=JSON.stringify(r),out=digest(params,r);
  assert.ok(Math.abs(r.resiOccupancy[2027]-.5583333333333333)<1e-12);
  assert.match(out,/各阶段15%、30%、50%、70%/);assert.match(out,/2027（实际运营6个月）平均出租率55.8333%/);assert.match(out,/运营月平均出租率/);assert.doesNotMatch(out,/首年出租率15%/);assert.equal(JSON.stringify(r),before);
});
test('年度旧口径及出租出售分支保持原摘要语义，不改变引擎数值',()=>{
  const p={...params,occupancyMode:'annual',rampOcc:.15},r=NRCalc.calc(NRCalc.fromParams(p));
  for(const type of [undefined,'rent','sale']){
    const value={...r,...(type?{__ctype:type}:{})},out=digest(p,value);
    assert.match(out,/首年出租率15%，稳定期85%/);assert.doesNotMatch(out,/月度分段出租率/);assert.match(out,/年份\|住宅租金收入\(万元\)\|出租率\|/);
  }
  assert.equal(digest(params,null),null);
});
