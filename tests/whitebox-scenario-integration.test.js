const test=require("node:test");
const assert=require("node:assert/strict");
global.window={};
require("../nrcalc.js"); require("../rentcalc.js"); require("../investestimate.js"); require("../salecalc.js");
const Sens=require("../sensitivity-core.js");
const Gov=require("../paramgovernance.js");

function fixture(type){
  const reg=Sens.REGISTRY[type], params=Object.fromEntries(reg.params.map(d=>[d.k,(d.lo+d.hi)/2]));
  const evaluate=p=>({summary:{irr:reg.evalIrr(reg.params.map(d=>p[d.k]),{}),totalNpv:0}});
  return {reg,params,evaluate};
}

for(const type of ["gaibao","rent","sale"]){
  test(type+"：白箱单参数曲线逐点调用真实引擎并得到可计算IRR",()=>{
    const {reg,params,evaluate}=fixture(type), def=reg.params.find(d=>d.k.includes("rent")||d.k.includes("Price"))||reg.params[0];
    const curve=Gov.singleParameterCurve(params,def.k,def,evaluate,7);
    assert.equal(curve.length,7);
    assert.ok(curve.filter(x=>Number.isFinite(x.irr)).length>=5);
  });
}

test("出租类：低影响参数联合扰动由真实RentCalc+InvestEstimate复算，不走近似模型",()=>{
  const {reg,params,evaluate}=fixture("rent");
  const lowKeys=new Set(reg.params.slice(-4).map(x=>x.k));
  const classified=reg.params.map(d=>({key:d.k,impactLevel:lowKeys.has(d.k)?"low":"core"}));
  const out=Gov.jointLowSensitivityValidation(params,classified,reg.params,evaluate,{samples:24,perturb:0.1,maxIrrDeltaPp:0.5});
  assert.equal(out.available,true); assert.equal(out.samples,24); assert.equal(out.parameterCount,4);
  assert.ok(Number.isFinite(out.p95));
});
