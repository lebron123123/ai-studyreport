const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={setTimeout};ctx.window=ctx;vm.createContext(ctx);for(const f of ['nrcalc.js','project-sensitivity.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const P=ctx.ProjectSensitivity;
const fixture=()=>({...require('./fixtures/nrcalc-reference.json').cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',occupancyMode:'monthly-phases',rampIntervalMonths:1,rampRates:[.6,.8,.95],costSpan:1,costRate:0,collectPct:50,sharePct:30,collectRentPct:20,collectReductionPct:30,projectSharePct:60,shareStartMonth:'2026-10',operateCostMode:'per-unit',operateRentPct:15.7,firstDecoLoanPct:80,debtModel:'monthly-v2'});
test('inventory covers every current form input, every project leaf, and unknown fields explicitly',()=>{
 const p=fixture();p.futureInput=7;const rows=P.inventory(p),keys=rows.map(x=>x.key);
 const form=fs.readFileSync('calc.js','utf8').split('function calcFormHtml(params){')[1].split('function readCalcForm(){')[0];
 const formKeys=[...form.matchAll(/['"]c_(\w+)['"]/g)].map(m=>m[1]);
 for(const key of formKeys)assert.ok(keys.includes(key)||key==='rampOcc',key);
 assert.ok(keys.includes('rampRates.2'));assert.match(rows.find(x=>x.key==='futureInput').reason,/未登记/);
 assert.match(rows.find(x=>x.key==='loan').reason,/派生/);
});
test('actual project baseline, full perturbation, unknown/failed cases retained, no mutation',async()=>{
 const p=fixture(),before=JSON.stringify(p),r=await P.analyze(p,{}, {ranges:{area:[19000,21000],rent:[70,-1]}});
 assert.equal(JSON.stringify(p),before);assert.equal(r.baseline.irr,ctx.NRCalc.calc(ctx.NRCalc.fromParams(p)).summary.monthlyXirr);
 assert.ok(r.rows.find(x=>x.key==='rent').scenarios[1].error);
 const discount=r.rows.find(x=>x.key==='discount');assert.equal(discount.scenarios[1].delta.irr,0);assert.notEqual(discount.scenarios[1].delta.npv,0);
 assert.equal(r.rows.length,P.inventory(p).length);
 for(const row of r.rows)assert.ok(row.reason||row.scenarios.length>=2);
 const changed=r.rows.find(x=>x.key==='area').scenarios[1].output;
 assert.notEqual(changed.months.reduce((n,m)=>n+m.engineering,0),r.baseline.months.reduce((n,m)=>n+m.engineering,0));
 assert.notEqual(changed.months.reduce((n,m)=>n+m.interest,0),r.baseline.months.reduce((n,m)=>n+m.interest,0));
});
test('dates and ramps preserve explicit linked scenarios; zero/null and incomplete inputs',async()=>{
 const p=fixture(),delayed=P.change(p,'operateStartMonth','2026-11');
 assert.equal(delayed.rampStartMonth,'2026-11');assert.equal(delayed.rampEndMonth,'2027-01');assert.equal(delayed.operateEndMonth,p.operateEndMonth);
 assert.equal(P.change(p,'stableStartMonth','2027-02').rampRates.length,4);
 assert.equal(P.change(p,'rampIntervalMonths',2).rampRates.length,2);
 assert.equal(P.change(p,'rampRates.0',.5).rampOcc,.5);
 assert.throws(()=>P.evaluate({...p,rent:undefined},{}),/不完整/);
 assert.throws(()=>P.evaluate({...p,debtModel:'legacy-annual'},{}),/旧年度模型/);
 assert.throws(()=>P.evaluate({...p,stableOcc:1.2},{}),/无效/);
 await assert.rejects(P.analyze(p,{}, {cancelled:()=>true}),/取消/);
});
test('admin inline scripts parse and project panel is connected to existing admin entry',()=>{
 const html=fs.readFileSync('admin.html','utf8');for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 assert.match(html,/ProjectSensitivityUI.mount/);assert.match(html,/project-sensitivity-global-ui.js/);
});
