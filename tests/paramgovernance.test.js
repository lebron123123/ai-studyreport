const test = require("node:test");
const assert = require("node:assert/strict");
const Gov = require("../paramgovernance.js");

test("参数来源严格按项目Excel→正式资料→规则→案例→兜底排序",()=>{
  const a=Gov.resolveParameter({projectDocument:45,regionalCase:40,industryFallback:35});
  assert.equal(a.value,45); assert.equal(a.sourceCode,"project_document"); assert.equal(a.requiresManualConfirmation,false);
  const b=Gov.resolveParameter({regionalCase:{value:40,evidence:[{name:"A"}]},industryFallback:35});
  assert.equal(b.sourceCode,"regional_case"); assert.equal(b.requiresManualConfirmation,true); assert.equal(b.evidence.length,1);
  const c=Gov.resolveParameter({}); assert.equal(c.value,null); assert.equal(c.sourceCode,"missing");
});

test("行业兜底表可查询并允许按key覆盖",()=>{
  const base=Gov.fallbackRuleTable("rent");
  assert.ok(base.some(x=>x.key==="loanRate"&&x.value===3));
  const edited=Gov.fallbackRuleTable("rent",[{key:"loanRate",value:3.1,basis:"内部更新"}]);
  assert.equal(edited.find(x=>x.key==="loanRate").value,3.1);
  assert.equal(edited.find(x=>x.key==="loanRate").basis,"内部更新");
});

test("敏感参数分为核心、重要、一般、低影响且不累计STi",()=>{
  const table=Array.from({length:20},(_,i)=>({key:"p"+i,combinedRank:i+1,STi:i===0?0.4:0.01}));
  const out=Gov.classifyParameters(table);
  assert.equal(out[0].impactLevel,"core");
  assert.ok(out.some(x=>x.impactLevel==="important"));
  assert.ok(out.some(x=>x.impactLevel==="general"));
  assert.ok(out.some(x=>x.impactLevel==="low"));
});

test("硬规则异常检测覆盖范围、档位、参数关系和销售率合计",()=>{
  const defs=[{k:"stableOcc",label:"稳定期出租率",lo:0.8,hi:0.98}];
  let issues=Gov.anomalyChecks("rent",{stableOcc:0.97,rampOcc:0.98,manageCoeff:3,loanRate:4},defs);
  assert.ok(issues.some(x=>x.key==="manageCoeff"&&x.severity==="error"));
  assert.ok(issues.some(x=>/首年出租率不能高于/.test(x.message)));
  assert.ok(issues.some(x=>x.key==="loanRate"));
  issues=Gov.anomalyChecks("sale",{rate1:0.8,rate2:0.4,rate3:0},[]);
  assert.ok(issues.some(x=>/超过100%/.test(x.message)));
});

test("无补贴面积时不检查惰性的补贴参数，同一管理系数不重复报警",()=>{
  const defs=[{k:"subsidyDiscount",label:"补贴折扣系数",lo:0.2,hi:1},{k:"manageCoeff",label:"管理系数",lo:0.5,hi:1}];
  const issues=Gov.anomalyChecks("rent",{subsidyArea:0,subsidyDiscount:1,manageCoeff:3},defs);
  assert.equal(issues.filter(x=>x.key==="subsidyDiscount").length,0);
  assert.equal(issues.filter(x=>x.key==="manageCoeff").length,1);
  assert.match(issues.find(x=>x.key==="manageCoeff").message,/允许档位/);
});

test("单参数曲线只调用白箱评估器并返回有序场景点",()=>{
  const evalFn=p=>({summary:{irr:p.rent/10,totalNpv:p.rent*2}});
  const curve=Gov.singleParameterCurve({rent:40},"rent",{lo:30,hi:50},evalFn,5);
  assert.deepEqual(curve.map(x=>x.value),[30,35,40,45,50]);
  assert.deepEqual(curve.map(x=>x.irr),[3,3.5,4,4.5,5]);
});

test("低敏感参数联合扰动按P95阈值验收",()=>{
  const classified=[{key:"a",impactLevel:"low"},{key:"b",impactLevel:"low"},{key:"c",impactLevel:"core"}];
  const evalFn=p=>({summary:{irr:5+p.a*0.001+p.b*0.001+p.c}});
  const out=Gov.jointLowSensitivityValidation({a:100,b:100,c:0},classified,[],evalFn,{samples:32,perturb:0.1,maxIrrDeltaPp:0.5});
  assert.equal(out.available,true); assert.equal(out.parameterCount,2); assert.equal(out.pass,true);
  assert.ok(out.p95<=0.5);
});

test("异常原因由规则目标与白箱复算生成，不使用自由文本猜测",()=>{
  const issues=Gov.anomalyChecks("rent",{loanRate:4},[],[]);
  const explained=Gov.explainAnomalyImpacts({loanRate:4},issues,p=>({summary:{irr:10-p.loanRate}}));
  const loan=explained.find(x=>x.key==="loanRate");
  assert.equal(loan.impactAvailable,true);
  assert.equal(loan.referenceValue,3);
  assert.match(loan.explanation,/白箱IRR由 6\.00% 变为 7\.00%/);
});

test("六层异常体系如实标识无数据层等待，不伪装RF已经启用",()=>{
  let layers=Gov.anomalyLayerStatus(0,false);
  assert.deepEqual(layers.slice(0,3).map(x=>x.status),["active","active","active"]);
  assert.equal(layers[3].status,"waiting");assert.equal(layers[5].status,"waiting");
  layers=Gov.anomalyLayerStatus(120,true);assert.equal(layers[5].status,"ready");
});

test("规则建议只形成草稿且不猜项目事实或错误关联知识依据",()=>{
  const rows={loanRate:{key:"loanRate",label:"贷款年利率",impactLevel:"重要",confirmation:"required",ruleValue:null,min:null,max:null,basis:"",evidenceRefs:[],status:"builtin"},rent:{key:"rent",label:"起始租金",role:"market_stat",ruleValue:null,status:"builtin"}};
  const out=Gov.suggestDraftRows(rows,"rent",[{id:"wiki:1",label:"Wiki｜贷款年利率政策",sourceRef:"公司制度"},{id:"wiki:2",label:"Wiki｜无关资料"}]);
  assert.equal(out.loanRate.status,"draft");assert.equal(out.loanRate.ruleValue,3);assert.equal(out.loanRate.evidenceRefs.length,1);
  assert.equal(out.rent.status,"builtin");assert.equal(out.rent.ruleValue,null);
});

test("已经显示的内置规则也会转成待审核草稿，但不会自动保存或发布",()=>{
  const rows={loanRate:{key:"loanRate",label:"贷款年利率",impactLevel:"重要",confirmation:"required",ruleValue:3,min:2.7,max:3.3,basis:"公司审查指引",evidenceRefs:[],status:"builtin"}};
  const out=Gov.suggestDraftRows(rows,"rent",[]);assert.equal(out.loanRate.status,"draft");assert.match(out.loanRate.suggestionReason,/内置基线转待审核版本/);
});
