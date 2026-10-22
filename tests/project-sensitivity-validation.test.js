const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function env(){const c={setTimeout};c.window=c;vm.createContext(c);for(const f of ['nrcalc.js','sensitivity-core.js','project-sensitivity.js','project-sensitivity-global.js','project-sensitivity-validation.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);return c;}
const p={...require('./fixtures/nrcalc-reference.json').cases[0].params,buildStartMonth:'2026-01',buildEndMonth:'2026-09',operateStartMonth:'2026-10',operateEndMonth:'2037-12',rampStartMonth:'2026-10',rampEndMonth:'2026-12',stableStartMonth:'2027-01',occupancyMode:'monthly-phases',rampIntervalMonths:1,rampRates:[.6,.8,.95],costSpan:1,costRate:0,collectPct:50,sharePct:30,firstDecoLoanPct:80,debtModel:'monthly-v2'};
const rec=(id,rent=p.rent)=>({id,projectName:'[系统测试]'+id,projectType:'gaibao',revision:1,params:{...p,rent}});
test('calibration excludes holdouts and duplicate project identities; facts not replaced',()=>{
 const V=env().ProjectSensitivityValidation,base=rec('base'),refs=[rec('a',10),rec('b',30),rec('holdout',999),{...rec('a2',100),projectId:'a'},rec('c',50)];
 const r=V.calibrate(base,refs,[rec('holdout')]);assert.equal(r.rows.find(x=>x.key==='rent').median,30);assert.equal(r.rows.find(x=>x.key==='rent').count,3);assert.equal(r.rows.find(x=>x.key==='rent').calibrated,true);assert.ok(!r.rows.some(x=>['area','units','mode','operateStartMonth'].includes(x.key)));assert.equal(r.excluded[0],'holdout');
 assert.throws(()=>V.calibrate(base,[rec('a')],[rec('a')]),/没有可比/);
});
test('real engine holdout comparison, manual override, no mutation, reference overlap rejection',async()=>{
 const c=env(),V=c.ProjectSensitivityValidation,base=rec('base'),refs=[rec('ref')],cal=V.calibrate(base,refs),values=Object.fromEntries(cal.rows.map(r=>[r.key,r.value]));const hold=rec('hold',p.rent*1.1),before=JSON.stringify(hold);
 const r=await V.validate(base,[hold,base],cal,values,['rent'],{});assert.equal(r.rows[0].irrError,0);assert.equal(r.rows[0].npvError,0);assert.equal(r.summary.n,1);assert.equal(r.summary.rate,1);assert.ok(r.summary.interval[0]<.95);assert.equal(r.rows[1].independent,false);assert.equal(JSON.stringify(hold),before);
 const changed=await V.validate(base,[hold],cal,{...values,rent:p.rent*.8},[],{});assert.ok(changed.rows[0].irrError>0);assert.ok(!changed.rows[0].replaced.some(x=>x.key==='area'));
 await assert.rejects(V.validate(base,refs,cal,values,[],{}),/不得参与/);
 const bad=await V.validate(base,[hold],cal,{...values,rent:NaN},[],{});assert.equal(bad.summary.n,1);assert.equal(bad.summary.passed,0);assert.match(bad.rows[0].error,/经验值/);
 await assert.rejects(V.validate(base,[hold],cal,values,[],{},{cancelled:()=>true}),/取消/);
});
test('stability repeats distinct seeds and reports deterministic selection separately',async()=>{
 const c=env(),V=c.ProjectSensitivityValidation;let seeds=[];c.ProjectSensitivityGlobal.analyze=async(_p,_c,o)=>{seeds.push(o.seed);return {N:o.N,baseline:{npv:100},table:[{key:'rent',label:'租金',STi:.5+seeds.length*.01,Si:.3,sobolRank:1,combinedRank:1,irrImpact:{maxDeviation:1},npvImpact:{maxDeviation:5}}]};};
 const r=await V.stability(p,{}, {},{irr:.1,npv:.1,weighted:.1},{N:1000,repeats:3,seed:9});assert.deepEqual(seeds,[9,10,11]);assert.equal(r.table[0].selectionFrequency,1);assert.ok(r.table[0].stiMax>r.table[0].stiMin);assert.equal(r.runs[0].N,1000);
});
test('zero NPV uses absolute tolerance; errors retained in denominator',async()=>{
 const c=env(),V=c.ProjectSensitivityValidation,base=rec('base'),cal=V.calibrate(base,[rec('ref')]),values=Object.fromEntries(cal.rows.map(r=>[r.key,r.value]));c.ProjectSensitivity.evaluate=()=>({irr:10,npv:0});
 const r=await V.validate(base,[rec('hold')],cal,values,[],{});assert.equal(r.rows[0].npvRelative,null);assert.equal(r.rows[0].pass,true);
});
