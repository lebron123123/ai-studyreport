const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={setTimeout};c.window=c;vm.createContext(c);for(const f of ['nrcalc.js','sensitivity-core.js','project-sensitivity.js','project-sensitivity-global.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
const G=c.ProjectSensitivityGlobal;
test('dates remain project boundaries even with supplied ranges; rule policy gates selection only',()=>{
 const dates={buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01'};
 const rows=G.inventory({...dates,rent:60},Object.fromEntries(Object.keys(dates).map(k=>[k,['2025-01','2030-12']])));
 assert.ok(rows.filter(r=>r.kind==='month').every(r=>r.reason.includes('时间边界')));
 const p=G.compose({...dates,rent:60},rows.filter(r=>!r.reason),[.9]);for(const key of Object.keys(dates))assert.equal(p[key],dates[key]);
 assert.equal(G.policy('discount'),'fixed');assert.equal(G.policy('decoRatio'),'fixed');assert.equal(G.policy('decoInt'),'fixed');assert.equal(G.policy('loanRate'),'assumed');assert.equal(G.policy('firstDecoLoanPct'),'assumed');assert.equal(G.policy('rent'),'actual');
 const r={policy:'fixed',weightedScore:1,npvRelative:1,irrImpact:{maxDeviation:10}};
 const criteria={irr:.1,npv:.1,weighted:.1};assert.equal(G.recommend(r,criteria),false);r.policy='assumed';assert.equal(G.recommend(r,criteria),true);
});
test('weighted strict boundaries, negative and near-zero NPV',()=>{
 const rows=[{irrImpact:{maxDeviation:.1},npvImpact:{maxDeviation:10}},{irrImpact:{maxDeviation:1},npvImpact:{maxDeviation:100}}];
 const scored=G.scoreImpacts(rows,-100);assert.equal(scored[0].weightedScore,.1);assert.equal(scored[0].npvRelative,.1);
 assert.equal(G.recommend(scored[0],{irr:.1,npv:.1,weighted:.1}),false);
 assert.equal(G.recommend(scored[1],{irr:null,npv:null,weighted:.1}),true);
 assert.equal(G.scoreImpacts(rows,.5)[0].npvRelative,null);
 assert.equal(G.scoreImpacts([{irrImpact:{maxDeviation:0},npvImpact:{maxDeviation:0}}],0)[0].weightedScore,0);
});
test('relative bounds, fixed text and zero-value coverage; STi never auto-selects',()=>{
 const rows=G.inventory({loanRate:2.6,rentRate:0,stableOcc:1,mode:'lease',sharePct:30});
 assert.deepEqual(Array.from(rows.find(r=>r.key==='loanRate').bounds),[2.08,3.12]);
 assert.ok(rows.find(r=>r.key==='mode').reason);assert.ok(rows.find(r=>r.key==='sharePct').reason);
 assert.ok(rows.find(r=>r.key==='rentRate').reason.startsWith('固定值'));
 assert.equal(G.recommend({STi:.9,irrImpact:{maxDeviation:.01},npvImpact:{maxDeviation:1}},{sti:.001,irr:1,npv:null}),false);
});
test('global estimator recovers additive variance contributions, zero effect and SRC',async()=>{
 const r=await G.estimate(3,x=>x[0]+2*x[1],{N:4000});
 assert.ok(Math.abs(r.table[0].STi-.2)<.025);assert.ok(Math.abs(r.table[1].STi-.8)<.06);assert.equal(r.table[2].STi,0);
 assert.ok(Math.abs(r.table[1].src)>.8);assert.ok(Math.abs(r.table[2].src)<1e-8);assert.ok(r.table[1].combinedRank<r.table[0].combinedRank);
});
test('global estimator detects pure interactions missed by rank correlation',async()=>{
 const r=await G.estimate(2,x=>(x[0]-.5)*(x[1]-.5),{N:4000});
 for(const row of r.table){assert.ok(row.STi>.9&&row.STi<1.1);assert.ok(Math.abs(row.spearmanRho)<.06);assert.ok(row.STiHigh>=row.STiLow);}
});
test('invalid values and cancellation fail closed, no invalid pair dropping',async()=>{
 await assert.rejects(G.estimate(2,()=>null,{N:20}),/有效XIRR/);
 await assert.rejects(G.estimate(2,()=>1,{N:20}),/没有可辨识/);
 await assert.rejects(G.estimate(2,x=>x[0],{N:20,cancelled:()=>true}),/取消/);
});
test('actual monthly engine, coverage, deterministic seed, linked dates and no mutation',async()=>{
 const p={...require('./fixtures/nrcalc-reference.json').cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',occupancyMode:'monthly-phases',rampIntervalMonths:1,rampRates:[.6,.8,.95],costSpan:1,costRate:0,collectPct:50,sharePct:30,firstDecoLoanPct:80,debtModel:'monthly-v2'};
 const ranges=Object.fromEntries(G.inventory(p).filter(r=>!r.reason).map(r=>[r.key,[r.value,r.value]]));ranges.rent=[p.rent*.95,p.rent*1.05];ranges.discount=[5,7];
 const before=JSON.stringify(p),r=await G.analyze(p,{}, {N:16,ranges});
 assert.equal(JSON.stringify(p),before);assert.equal(r.coverage.length,c.ProjectSensitivity.inventory(p).length);
 assert.equal(r.table.find(x=>x.key==='discount').STi,0);assert.ok(r.coverage.find(x=>x.key==='rampStartMonth').reason.includes('时间边界'));
 assert.equal(r.baseline.irr,c.ProjectSensitivity.evaluate(p,{}).irr);
 assert.equal(r.globalTotal,16*(r.table.length+2));assert.equal(r.total,r.globalTotal+r.table.reduce((n,x)=>n+x.points.length,0));assert.ok(r.table.every(x=>Number.isFinite(x.STi)));
 const discount=r.table.find(x=>x.key==='discount');assert.equal(discount.irrImpact.maxDeviation,0);assert.ok(discount.npvImpact.maxDeviation>0);
 assert.equal(G.recommend(discount,{sti:.001,irr:null,npv:1}),true);
 for(const row of r.table)for(const point of row.points){const actual=c.ProjectSensitivity.evaluate(c.ProjectSensitivity.change(p,row.key,point.value),{});assert.equal(point.irr,actual.irr);assert.equal(point.npv,actual.npv);}
});
test('multi-point impacts find interior extrema, categorical values and cancellation',async()=>{
 const sandbox={setTimeout,ProjectSensitivity:{change:(p,k,v)=>({...p,[k]:v}),evaluate:p=>({irr:1-(p.x-.5)**2,npv:p.x*10})}};sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('project-sensitivity-global.js','utf8'),sandbox);
 const rows=[{key:'x',value:0,kind:'number',bounds:[0,1]}];
 const result=await sandbox.ProjectSensitivityGlobal.impacts({x:0},{},rows,{irr:.75,npv:0});
 assert.equal(result[0].irrImpact.max,1);assert.equal(result[0].irrImpact.maxDeviation,.25);assert.equal(result[0].points.length,9);
 await assert.rejects(sandbox.ProjectSensitivityGlobal.impacts({x:0},{},rows,{irr:.75,npv:0},{cancelled:()=>true}),/取消/);
});
