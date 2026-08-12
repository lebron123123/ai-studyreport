import test from "node:test";
import assert from "node:assert/strict";
import {onRequestPost,BUILTIN_PARAM_RULES} from "../functions/api/aireport.js";
import {signToken} from "../functions/api/_auth.js";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const Gov=require("../paramgovernance.js");

function dbWithRulesAndCases(rules,cases,defaults){
  return {prepare(sql){
    const st={args:[]};
    return {bind(...args){st.args=args;return this;},async first(){
      if(/configs/.test(sql)&&st.args[0]==="calc_sensitivity") return null;
      if(/configs/.test(sql)&&st.args[0]==="calc_paramrules") return {data:JSON.stringify({rent:rules||[]})};
      if(/configs/.test(sql)&&st.args[0]==="calc_paramdefaults") return {data:JSON.stringify({rent:defaults||{}})};
      return null;
    },async all(){return {results:(cases||[]).map(x=>({name:x.name,location:x.location,params:JSON.stringify(x.params)}))};},async run(){return {success:true};}};
  }};
}
async function suggest(db,body){
  const env={DB:db,SESSION_SECRET:"test-secret"};
  const token=await signToken(env,1,"u");
  const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(Object.assign({action:"suggest",calcType:"rent",location:"深圳市龙华区"},body))});
  const res=await onRequestPost({request,env}); return res.json();
}

test("参数推荐：同区域案例标为第4级且要求人工确认",async()=>{
  const d=await suggest(dbWithRulesAndCases([],[{name:"同区A",location:"深圳市龙华区",params:{rent:48}}]),{});
  assert.equal(d.ok,true); assert.equal(d.sources.rent.sourceCode,"regional_case");
  assert.equal(d.sources.rent.sourceLevel,4); assert.equal(d.sources.rent.requiresManualConfirmation,true);
});

test("参数推荐：无案例时读取可维护的行业兜底表，不再笼统冒充默认值",async()=>{
  const d=await suggest(dbWithRulesAndCases([{key:"manageCoeff",value:0.85,basis:"龙华区管理系数档"}],[]),{});
  assert.equal(d.sources.manageCoeff.value,0.85);
  assert.equal(d.sources.manageCoeff.sourceCode,"industry_fallback");
  assert.match(d.sources.manageCoeff.from,/龙华区管理系数档/);
  assert.equal(d.sources.manageCoeff.requiresManualConfirmation,true);
});

test("参数推荐返回完整来源层级说明",async()=>{
  const d=await suggest(dbWithRulesAndCases([],[]),{});
  assert.equal(d.sourceHierarchy.length,7);
  assert.equal(Object.keys(d.sources).length,Object.keys(d.params).length);
  assert.equal(d.sources.rentDiscount.sourceCode,"expert_default");
  assert.match(d.sourceHierarchy[0],/Excel/);
  assert.match(d.sourceHierarchy[6],/专家默认值/);
});

test("参数推荐：后台尚未保存兜底表时仍启用内置行业规则",async()=>{
  const d=await suggest(dbWithRulesAndCases([],[]),{});
  assert.equal(d.sources.manageCoeff.sourceCode,"industry_fallback");
  assert.equal(d.sources.manageCoeff.value,0.9);
});

test("前端治理层与服务端推荐层的内置兜底值保持一致",()=>{
  for(const type of ["rent","gaibao","sale"]){
    const front=Object.fromEntries(Gov.fallbackRuleTable(type).map(x=>[x.key,x.value]));
    for(const rule of BUILTIN_PARAM_RULES[type]) assert.equal(rule.value,front[rule.key],type+"."+rule.key);
  }
});

test("后台专家默认值覆盖代码内置值，并标注为需人工确认的专家默认",async()=>{
  const d=await suggest(dbWithRulesAndCases([],[],{rentDiscount:0.72}),{});
  assert.equal(d.params.rentDiscount,0.72);
  assert.equal(d.sources.rentDiscount.sourceCode,"expert_default");
  assert.equal(d.sources.rentDiscount.requiresManualConfirmation,true);
});

test("行业规则可按地区停用，且可配置是否必须人工确认",async()=>{
  const rules=[{key:"manageCoeff",value:0.8,basis:"南山区档位",region:"南山区",manualRequired:false,enabled:true}];
  const d1=await suggest(dbWithRulesAndCases(rules,[]),{location:"深圳市南山区"});
  assert.equal(d1.params.manageCoeff,0.8); assert.equal(d1.sources.manageCoeff.requiresManualConfirmation,false);
  const d2=await suggest(dbWithRulesAndCases(rules,[]),{location:"深圳市龙华区"});
  assert.equal(d2.params.manageCoeff,0.85); assert.equal(d2.sources.manageCoeff.sourceCode,"expert_default");
});

test("参数目录接口返回三类专家默认值、行业规则和关键字段",async()=>{
  const env={DB:dbWithRulesAndCases([],[]),SESSION_SECRET:"test-secret"};
  const token=await signToken(env,1,"u");
  const request=new Request("http://test/api/aireport?catalog=1",{headers:{authorization:"Bearer "+token}});
  const res=await (await import("../functions/api/aireport.js")).onRequestGet({request,env});
  const d=await res.json(); assert.equal(d.ok,true); assert.equal(d.defaults.rent.rent,32); assert.ok(d.rules.rent.length); assert.equal(d.keyFields.sale.length,7);
  for(const type of ["rent","sale","gaibao"]){
    assert.deepEqual(Object.keys(d.meta[type]).sort(),Object.keys(d.defaults[type]).sort());
    for(const [key,m] of Object.entries(d.meta[type])){assert.ok(m.label&&m.label!==key,type+"."+key+"缺少中文名");assert.ok(m.unit,type+"."+key+"缺少单位");assert.equal(m.derived,false);}
  }
  assert.equal(d.roleOptions.length,5);assert.equal(d.sourcePolicyOptions.length,5);assert.equal(d.volatilityOptions.length,5);assert.equal(d.confirmOptions.length,3);
});

test("项目事实参数不会拿其他项目中位数冒充本项目数据",async()=>{
  const d=await suggest(dbWithRulesAndCases([],[{name:"案例A",location:"深圳市龙华区",params:{area:99999}}]),{});
  assert.equal(d.params.area,34330);assert.equal(d.sources.area.sourceCode,"expert_default");assert.equal(d.sources.area.requiresManualConfirmation,true);
});

test("行业经验参数优先读取已发布规则，不被案例中位数覆盖",async()=>{
  const rules=[{key:"manageCoeff",value:0.8,basis:"现行区域档位",enabled:true,role:"industry_benchmark"}];
  const d=await suggest(dbWithRulesAndCases(rules,[{name:"旧案例",location:"深圳市龙华区",params:{manageCoeff:0.5}}]),{});
  assert.equal(d.params.manageCoeff,0.8);assert.equal(d.sources.manageCoeff.sourceCode,"industry_fallback");
});

test("行业规则只在地区、项目类型和有效期均匹配时生效，并返回知识依据",async()=>{
  const evidenceRefs=[{id:"asset:a1",type:"asset",label:"《出租类测算指引》",version:"v2"}];
  const rules=[{key:"manageCoeff",value:0.8,basis:"南山区出售类规则",region:"南山区",projectType:"出售类",effectiveDate:"2026-01-01",expiryDate:"2099-12-31",evidenceRefs,enabled:true}];
  const yes=await suggest(dbWithRulesAndCases(rules,[]),{location:"深圳市南山区",projectType:"出售类"});
  assert.equal(yes.params.manageCoeff,0.8);assert.deepEqual(yes.sources.manageCoeff.evidence,evidenceRefs);
  const no=await suggest(dbWithRulesAndCases(rules,[]),{location:"深圳市南山区",projectType:"出租类"});
  assert.equal(no.sources.manageCoeff.sourceCode,"expert_default");
});
