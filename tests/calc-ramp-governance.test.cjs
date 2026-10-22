const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(interval){
 const s={console};s.window=s;vm.createContext(s);
 for(const f of ['nrcalc.js','paramgovernance.js','calc.js'])vm.runInContext(fs.readFileSync(f,'utf8'),s);
 s.p={...require('./fixtures/nrcalc-reference.json').cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-04',operateStartMonth:'2026-05',operateEndMonth:'2037-12',occupancyMode:'monthly-phases',rampStartMonth:'2026-05',rampEndMonth:'2026-08',stableStartMonth:'2026-09',rampIntervalMonths:interval,rampRates:interval===1?[.5,.6,.7,.8]:[.5,.7]};
 return s;
}
for(const interval of [1,2])test('result analysis preserves ramp grouping '+interval,()=>{
 const s=setup(interval),seen=[];
 const evaluate=p=>{seen.push(p);return s.NRCalc.calc(s.NRCalc.fromParams(p));};
 const original=JSON.stringify(s.p);
 const result=s.ParamGovernance.jointLowSensitivityValidation(s.p,['rampIntervalMonths','rentSpan','decoInt','costSpan','rent'].map(key=>({key,impactLevel:'low'})),[],evaluate);
 assert.equal(result.available,true);
 assert.equal(result.parameters.includes('rampIntervalMonths'),false);
 for(const p of seen){assert.equal(p.rampIntervalMonths,interval);assert.deepEqual(p.rampRates,s.p.rampRates);for(const k of ['rentSpan','decoInt'])assert.ok(Number.isInteger(p[k]));}
 assert.equal(JSON.stringify(s.p),original);
 const curve=s.ParamGovernance.singleParameterCurve(s.p,'decoInt',{lo:6,hi:15},evaluate,7);
 assert.ok(curve.every(x=>Number.isInteger(x.value)));
});
test('auxiliary scenario failure does not reject the successful result',()=>{
 const s=setup(1);s.escapeHtml=x=>x;
 vm.runInContext("scParams=p;scResult=runCalcEngine('gaibao',p);ParamGovernance.explainAnomalyImpacts=()=>{throw new Error('invalid auxiliary scenario')}",s);
 const before=vm.runInContext('JSON.stringify(scResult)',s);
 assert.match(vm.runInContext('parameterGovernanceHtml()',s),/主测算已完成/);
 assert.equal(vm.runInContext('JSON.stringify(scResult)',s),before);
});
