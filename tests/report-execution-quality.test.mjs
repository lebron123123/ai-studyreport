import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import L from '../report-length-plan.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {startReportSection,readReportSection,repairReportSection,reportCandidateQuality,reportQualityRepairState,reportQualityFailureSummary,reportGenerationPolicyChanged,reportCandidateOutput,reportRepairPromptContext,reportSlotRepairPlan,reportApplySlotPatch,reportRepairContract,reportSectionOutputBudget,reportBoundOutputTokens,reportRestoreHeadingSlots,reportStructureRepairPlan,reportApplyStructurePatch} from '../functions/api/reportexecution.js';
import {executeLlmTask,settleAgentJob} from '../functions/api/_agent-enterprise.js';

const contract={version:'20260921-root-v1',planId:'[系统测试]plan',sectionKey:'经营方案 / 合作安排',requirements:{proseTarget:50,proseMax:100,tableMax:1,tableRowsMax:8,cellCharsMax:100},requiredFacts:[],requiredTables:[]};
const C=globalThis.ReportCompletionContract;

test('精确业务标题缺失slot仅从本组合法正文恢复元数据，不改raw、标题层级、正文或事实状态',()=>{
  const bound=C.normalize({...contract,lengthPolicy:'advisory-v1',requiredHeadings:[{level:3,text:'人口就业基础'},{level:3,text:'租赁需求变化'}]});
  const blocks=[{kind:'heading',level:3,text:'人口就业基础'},{kind:'paragraph',slot:'finding',text:'当前判断有条件，不能认定已经验证。'},{kind:'heading',level:3,text:'租赁需求变化'},{kind:'paragraph',slot:'evidence',text:'原段与数字45保留。'}],raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  const output=reportCandidateOutput(snapshot,raw),quality=reportCandidateQuality(snapshot,raw);
  assert.equal(output.raw,output.structuredText);assert.equal(raw,JSON.stringify({blocks}));
  assert.equal(output.metadataRepairs.length,2);assert.equal(quality.status==='blocked',false);assert.equal(quality.factsVerified,false);
  const restored=JSON.parse(output.structuredText).blocks;
  assert.deepEqual(restored.filter(b=>b.kind==='paragraph'),blocks.filter(b=>b.kind==='paragraph'));
  assert.deepEqual(restored.filter(b=>b.kind==='heading').map(({slot,...b})=>b),blocks.filter(b=>b.kind==='heading'));
  for(const bad of [
    {...blocks[0],level:4}, {...blocks[0],text:'另一个标题'}, {...blocks[0],slot:'invalid'}, {...blocks[0],extra:'不应吞掉'},
  ]){
    const badRaw=JSON.stringify({blocks:[bad,blocks[1]]});assert.equal(reportRestoreHeadingSlots(badRaw,bound).structuredText,badRaw);
  }
  for(const body of [{kind:'paragraph',slot:'invalid',text:'原段'},{kind:'paragraph',slot:'finding',text:'非法\n段落'},{kind:'table-ref',id:'未知'}]){
    const badRaw=JSON.stringify({blocks:[blocks[0],body]});assert.equal(reportRestoreHeadingSlots(badRaw,bound).structuredText,badRaw);
  }
  const duplicate=JSON.stringify({blocks:[blocks[0],blocks[1],blocks[0],blocks[1]]});assert.equal(reportRestoreHeadingSlots(duplicate,bound).structuredText,duplicate);
});

function structureFixture(){
  const bound=C.normalize({...contract,lengthPolicy:'advisory-v1',requirements:{...contract.requirements,proseTarget:900,proseMax:1200,tableCharsMax:600},requiredHeadings:[{level:3,text:'分析口径'},{level:3,text:'人口就业基础'},{level:3,text:'判断与条件'}],requiredTables:[{title:'需求与产品匹配分析表',headers:[],terms:['需求','产品']}]});
  const blocks=[{kind:'heading',slot:'finding',level:3,text:'分析口径'},{kind:'paragraph',slot:'finding',text:'既有原分析和45元租金及条件完整保留。'},{kind:'heading',slot:'conditions',level:3,text:'判断与条件'},{kind:'paragraph',slot:'conditions',text:'租住需求缺少同口径人口与就业样本，现阶段无法确定产品吸纳规模；取得覆盖通勤范围和目标客群的调查样本后，再校验需求与产品匹配条件。'}],raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  const prior={structuredText:raw,quality:reportCandidateQuality(snapshot,raw)};
  return {bound,blocks,raw,snapshot,prior};
}

test('缺失主题和定性表只追加指定块，原文、标题和事实不变，原质量门槛仍逐项检查',()=>{
  const {bound,blocks,raw,snapshot,prior}=structureFixture(),plan=reportStructureRepairPlan(prior,bound);
  assert.ok(plan);assert.deepEqual(plan.targets.map(t=>t.id),['heading-1','table-0']);
  assert.equal(prior.quality.issues.find(i=>i.code==='missing-table').repairable,false,'不能全局放宽原缺表门槛');
  assert.equal(prior.quality.failure.protocolRepairEligible,false);assert.equal(prior.quality.targetedRepair.version,plan.version);
  assert.equal(reportQualityRepairState(snapshot,prior.quality).canTargetedRetry,true);
  assert.equal(reportQualityRepairState(snapshot,prior.quality,true).canRetry,false);
  assert.equal(reportQualityRepairState({...snapshot,qualityRepair:{round:2}},prior.quality).canRetry,false);
  const additions=[{id:'heading-1',text:'人口就业联系应按已知资料解释。缺乏同口径统计时仅作条件判断，不编造人口或就业规模。'},{id:'table-0',table:{headers:['需求分层','产品匹配条件'],rows:[['通勤租住需求','产品适配需由真实材料核验'],['家庭需求','产品与需求尚待核验']]}}];
  const output=reportCandidateOutput({...snapshot,qualityStructurePatch:plan},JSON.stringify({additions})),next=reportCandidateQuality({...snapshot,qualityStructurePatch:plan},JSON.stringify({additions}));
  assert.deepEqual(output.issues,[]);assert.equal(next.status,'passed');assert.equal(next.factsVerified,false);
  const actual=JSON.parse(output.structuredText).blocks;assert.deepEqual(actual.filter(b=>blocks.some(old=>JSON.stringify(old)===JSON.stringify(b))),blocks);
  assert.deepEqual(C.headingOutline(output.text),bound.requiredHeadings);assert.equal(C.measure(output.text).tableCount,1);
  assert.equal(JSON.stringify({blocks}),raw,'原始块未被修改');
  const context=reportRepairPromptContext({user:'当前项目真实依据'},prior,bound);
  assert.equal(context.structurePatch.version,plan.version);assert.equal(context.slotPatch,undefined);assert.match(context.instruction,/不重写、不删减、不替换/);assert.ok(context.user.includes(raw));
  const budget=reportSectionOutputBudget(bound,plan),policy=readFileSync(new URL('../functions/api/reportexecution.js',import.meta.url),'utf8').match(/const GENERATION_POLICY_VERSION='([^']+)'/)[1];
  assert.equal(reportBoundOutputTokens({...snapshot,qualityStructurePatch:plan,generationPolicyVersion:policy,outputBudget:budget}),budget.maxTokens);
});

test('确认篇幅的缺失主题补写不沿用旧段落硬压缩；旧合同与整批响应安全上限继续拦截',()=>{
  const {bound,raw,prior}=structureFixture(),plan=reportStructureRepairPlan(prior,bound);
  const text='有依据的业务分析应保留完整因果、比较条件与待核验边界。'.repeat(20);
  assert.ok(text.length>plan.targets[0].hardMax&&text.length<plan.proseSafetyMax);
  const table={id:'table-0',table:{headers:['需求','产品'],rows:[['通勤需求尚待核验','适配应以真实样本核验']]}};
  const patch=JSON.stringify({additions:[{id:'heading-1',text},table]});
  const result=reportApplyStructurePatch(patch,plan);
  assert.deepEqual(result.issues,[]);assert.ok(result.structuredText.includes(text));
  assert.deepEqual(JSON.parse(result.structuredText).blocks.filter(b=>JSON.parse(raw).blocks.some(x=>JSON.stringify(x)===JSON.stringify(b))),JSON.parse(raw).blocks);
  const strict=C.normalize({...bound,lengthPolicy:undefined}),strictPlan=reportStructureRepairPlan({structuredText:raw},strict);
  assert.ok(strictPlan);assert.equal(strictPlan.lengthPolicy,undefined);
  assert.equal(reportApplyStructurePatch(patch,strictPlan).structuredText,raw);
  const huge=JSON.stringify({additions:[{id:'heading-1',text:'字'.repeat(plan.proseSafetyMax+1)},table]});
  assert.equal(reportApplyStructurePatch(huge,plan).issues[0].code,'structured-structure-patch');
  assert.equal(reportApplyStructurePatch(patch,{...plan,proseSafetyMax:NaN}).structuredText,raw);
  const bothMissing=JSON.parse(raw);bothMissing.blocks.splice(0,2);
  const bothPlan=reportStructureRepairPlan({structuredText:JSON.stringify(bothMissing)},bound);
  const additions=bothPlan.targets.map(t=>t.kind==='heading'?{id:t.id,text:'字'.repeat(Math.ceil(bothPlan.proseSafetyMax/2)+1)}:table);
  assert.equal(reportApplyStructurePatch(JSON.stringify({additions}),bothPlan).issues[0].code,'structured-structure-patch','合计而非每段分别执行响应保护');
  const prompt=reportRepairPromptContext({user:'真实材料'},prior,bound);
  assert.match(prompt.user,/hardMax只是篇幅建议/);
  const budget=reportSectionOutputBudget(bound,plan);
  assert.equal(budget.maxTokens,Math.max(4000,(plan.proseSafetyMax+bound.requirements.tableCharsMax)*2+1024));
});

test('缺口补丁越界、数值或遗漏整批拒绝并保留原blocks；第二轮仍只能补同一原缺口',()=>{
  const {bound,raw,snapshot,prior}=structureFixture(),plan=reportStructureRepairPlan(prior,bound);
  const good=[{id:'heading-1',text:'主题分析待核验，不作确定性判断。'},{id:'table-0',table:{headers:['需求','产品'],rows:[['需求待核验','产品适配待核验']]}}];
  for(const additions of [good.slice(0,1),[...good,good[0]],[{...good[0],slot:'finding'},good[1]],[{...good[0],id:'heading-99'},good[1]],[good[0],{...good[1],table:{headers:['需求','产品'],rows:[['已确认需求','45元']]}}],[good[0],{...good[1],table:{headers:['需求','产品'],rows:[['需求','产品']],title:'改名'}}]]){
    const patched=reportApplyStructurePatch(JSON.stringify({additions}),plan);
    assert.equal(patched.structuredText,raw);assert.equal(patched.issues[0].code,'structured-structure-patch');
    const next=reportCandidateQuality({...snapshot,qualityStructurePatch:plan},JSON.stringify({additions}));
    assert.equal(next.status,'blocked');assert.ok(reportStructureRepairPlan({structuredText:patched.structuredText,quality:next},bound));
  }
  for(const code of ['missing-fact','gap-reference-count','model-output-truncated','new-unknown-error'])assert.equal(reportStructureRepairPlan({...prior,quality:{issues:[{code,severity:'error',repairable:true}]}},bound),null);
});

test('数值资金表、冻结引用缺失、错层及既有标题乱序不准走定性追加修复',async()=>{
  const {bound,raw,prior}=structureFixture();
  for(const title of ['资金筹措表','投资估算表','财务评价指标表','风险收益金额表'])assert.equal(reportStructureRepairPlan({...prior,quality:undefined},C.normalize({...bound,requiredTables:[{title,headers:[],terms:[]}]})),null,title);
  const frozen=await C.bindFrozenTables(bound,'<table><tr><th>需求</th><th>产品</th></tr><tr><td>通勤需求</td><td>产品适配待核验</td></tr></table>','[系统测试]frozen');
  assert.equal(reportStructureRepairPlan({structuredText:raw},frozen),null);
  const value=JSON.parse(raw);value.blocks[2].level=4;value.blocks.push({kind:'heading',slot:'finding',level:3,text:'人口就业基础'});
  assert.equal(reportStructureRepairPlan({structuredText:JSON.stringify(value)},bound),null);
  const reversed=JSON.parse(raw);reversed.blocks=[...reversed.blocks.slice(2),...reversed.blocks.slice(0,2)];
  assert.equal(reportStructureRepairPlan({structuredText:JSON.stringify(reversed)},bound),null);
});

test('失败分类区分格式、结构、篇幅、截断及事实，不把可修复事实错误当首稿协议重试',()=>{
  const q=(...codes)=>({status:'blocked',issues:codes.map(code=>({code,severity:'error',repairable:true}))});
  for(const [codes,categories,eligible] of [
    [['structured-json'],['format'],true],
    [['structured-heading','heading-structure-missing','structured-slot-count'],['structure'],true],
    [['structured-slot-budget'],['length'],false],
    [['structured-json','model-output-truncated'],['format','truncation'],false],
    [['missing-evidence-marker','frozen-table-missing'],['evidence'],false],
    [['structured-json','missing-fact'],['format','evidence'],false],
    [['output-format-version'],['version'],false],
    [['new-unknown-gate'],['other'],false]
  ]){
    const quality=q(...codes),before=JSON.stringify(quality),failure=reportQualityFailureSummary(quality);
    assert.deepEqual(failure.categories,categories);assert.equal(failure.protocolRepairEligible,eligible);assert.equal(JSON.stringify(quality),before);
    assert.equal(reportQualityRepairState({},quality).canProtocolRetry,eligible);
    assert.equal(reportQualityRepairState({},quality,true).canProtocolRetry,false);
    assert.equal(reportQualityRepairState({qualityRepair:{round:2}},quality).canProtocolRetry,false);
  }
  assert.equal(reportQualityFailureSummary({status:'unverified',issues:[{code:'structured-slot-budget',severity:'warning'}]}),null);
  assert.equal(reportQualityFailureSummary({status:'blocked',issues:[{code:'structured-json',severity:'error',repairable:false}]}).protocolRepairEligible,false);
  const raw='仅有正文，尚未遵循JSON协议。',result=reportCandidateQuality({qualityContract:contract,outputFormat:C.OUTPUT_FORMAT},raw);
  assert.equal(result.failure.protocolRepairEligible,true);assert.equal(result.factsVerified,false);assert.equal(reportCandidateOutput({qualityContract:contract,outputFormat:C.OUTPUT_FORMAT},raw).raw,raw);
});

test('生成策略漂移只阻断旧任务返修，不把历史可读输出变成新请求',()=>{
  const current=readFileSync(new URL('../functions/api/reportexecution.js',import.meta.url),'utf8').match(/const GENERATION_POLICY_VERSION='([^']+)'/)[1];
  assert.equal(reportGenerationPolicyChanged({qualityContract:contract,generationPolicyVersion:current}),false);
  assert.equal(reportGenerationPolicyChanged({qualityContract:contract,generationPolicyVersion:'prior'}),true);
  assert.equal(reportGenerationPolicyChanged({qualityContract:contract}),true);
  assert.equal(reportGenerationPolicyChanged({}),false,'无成稿合同的历史普通文本不引入假版本冲突');
});
test('历史编号标题误报回归：合同与输出统一去编号，必要标题和下级分析仍完整保留',()=>{
  for(const [parent,children,numbered] of [
    ['政策风险',[],true],
    ['投资估算',['投资范围','工程费用','资金安排','估算条件'],false],
    ['改造实施计划及效果',['实施范围','施工安排','交付条件','运营衔接','实施效果'],false],
    ['客群定位',['租赁需求','客群特征'],true],
  ]){
    const requiredHeadings=[{level:3,text:'1. '+parent},...children.map((text,index)=>({level:4,text:(index+1)+'、'+text}))];
    const bound=C.normalize({...contract,lengthPolicy:'advisory-v1',requiredHeadings});
    const blocks=[{kind:'heading',slot:'finding',level:3,text:(numbered?'1. ':'')+parent},{kind:'paragraph',slot:'finding',text:'原有分析保留。'},...children.flatMap(text=>[{kind:'heading',slot:'finding',level:4,text},{kind:'paragraph',slot:'finding',text:'必要条件待核实。'}])];
    const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
    const quality=reportCandidateQuality(snapshot,raw,'completed',{finishReason:'stop'}),output=reportCandidateOutput(snapshot,raw);
    assert.equal(quality.status==='blocked',false,parent+'不因编号或标题成本误报失败');
    assert.equal(quality.issues.some(issue=>/^(structured-heading|heading-structure)/.test(issue.code)),false,parent);
    assert.deepEqual(C.headingOutline(output.text),[{level:3,text:parent},...children.map(text=>({level:4,text}))]);
    assert.equal(output.structuredText,raw,'编号规范化不覆盖模型原始JSON');
    assert.ok(output.text.includes('原有分析保留。'));
    assert.equal(output.text.split('必要条件待核实。').length-1,children.length);
  }
});

test('历史一字超限回归：新确认计划只警告并保留全文，旧硬预算合同仍不能静默放宽',()=>{
  const advisory=C.normalize({...contract,lengthPolicy:'advisory-v1'}),slot=C.outputSlots(advisory).find(value=>value.slot==='finding');
  const text='甲'.repeat(slot.hardMax+1),raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text}]});
  const quality=reportCandidateQuality({qualityContract:advisory,outputFormat:C.OUTPUT_FORMAT},raw);
  assert.equal(quality.status==='blocked',false);
  assert.ok(quality.issues.some(issue=>issue.code==='structured-slot-budget'&&issue.severity==='warning'&&issue.repairable===false));
  assert.equal(reportCandidateOutput({qualityContract:advisory,outputFormat:C.OUTPUT_FORMAT},raw).text,text);
  const legacy=reportCandidateQuality({qualityContract:contract,outputFormat:C.OUTPUT_FORMAT},raw);
  assert.equal(legacy.status,'blocked');
  assert.ok(legacy.issues.some(issue=>issue.code==='structured-slot-budget'&&issue.severity==='error'));
});

test('真实标题跳级或改变所属层级仍阻断，不能为消除失败自动重排或补标题',()=>{
  const bound=C.normalize({...contract,lengthPolicy:'advisory-v1',requiredHeadings:[{level:3,text:'结论'},{level:4,text:'实施条件'}]}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  for(const blocks of [
    [{kind:'heading',slot:'finding',level:4,text:'实施条件'},{kind:'paragraph',slot:'finding',text:'原文仍待审签。'}],
    [{kind:'heading',slot:'finding',level:3,text:'结论'},{kind:'heading',slot:'finding',level:3,text:'实施条件'},{kind:'paragraph',slot:'finding',text:'原文仍待审签。'}],
  ]){
    const raw=JSON.stringify({blocks}),quality=reportCandidateQuality(snapshot,raw);
    assert.equal(quality.status,'blocked');
    assert.ok(quality.issues.some(issue=>['structured-heading-level','heading-structure-missing'].includes(issue.code)));
    assert.equal(reportCandidateOutput(snapshot,raw).structuredText,raw);
    assert.ok(reportCandidateOutput(snapshot,raw).text.includes('原文仍待审签。'));
  }
});

test('新计划篇幅仅警戒；原文完整保留且协议返修不会隐性压缩，事实及截断仍阻断',()=>{
  const chapters=[{name:'运营方案',sections:[{t:'运营管理'}]}],budgets={};
  const lengthPlan={...L.createPlan(chapters),confirmedAt:'2026-10-08T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary(budgets).fingerprint}};
  assert.equal(L.validatePlan(lengthPlan,chapters).valid,true);
  const c=C.createPlan(chapters,{projectType:'rent',lengthPlan,budgets}).sections[0];
  assert.equal(c.lengthPolicy,'advisory-v1');
  const limit=C.outputSlots(c).find(s=>s.slot==='finding').hardMax,text='原有必要分析。'.repeat(limit),raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text}]}),snapshot={qualityContract:c,outputFormat:C.OUTPUT_FORMAT};
  const quality=reportCandidateQuality(snapshot,raw),prior={structuredText:raw,quality};
  assert.equal(quality.status,'unverified');assert.equal(quality.failure,null);
  assert.ok(quality.issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='warning'&&i.repairable===false));
  assert.equal(reportCandidateOutput(snapshot,raw).structuredText,raw);assert.ok(reportCandidateOutput(snapshot,raw).text.includes(text));
  assert.equal(reportSlotRepairPlan(prior,c),null);assert.equal(reportQualityRepairState(snapshot,quality).canRetry,false);
  const context=reportRepairPromptContext({user:'项目事实待核实'},{...prior,quality:{...quality,status:'blocked',issues:[...quality.issues,{code:'structured-json',severity:'error',repairable:true,message:'须补全JSON结构'}]}},c);
  assert.match(context.instruction,/不得因篇幅警告删减/);assert.doesNotMatch(context.instruction,/缩减到hardMax|不得原样返回已超限段落|最多\d+字/);assert.ok(context.user.includes(raw));
  const truncated=reportCandidateQuality(snapshot,raw,'completed',{finishReason:'length'});
  assert.equal(truncated.status,'blocked');assert.deepEqual(truncated.failure.categories,['truncation']);assert.equal(truncated.failure.protocolRepairEligible,false);
  const facts=reportCandidateQuality({...snapshot,qualityContract:C.normalize({...c,requiredMarkers:['【待补：签约条件】']})},raw);
  assert.equal(facts.status,'blocked');assert.equal(facts.failure.protocolRepairEligible,false);assert.ok(facts.issues.some(i=>i.code==='missing-evidence-marker'));
});

test('新候选的业务标题进入返修合同；完整返修删标题仍被阻断，原合同不变',()=>{
  const input=C.createPlan([{name:'运营方案',sections:[{t:'运营管理'}]}],{projectType:'gaibao'}).sections[0],before=JSON.stringify(input);
  const blocks=[{kind:'heading',slot:'finding',level:3,text:'收楼安排'},{kind:'paragraph',slot:'finding',text:'按已确认合同执行。'},{kind:'heading',slot:'finding',level:4,text:'合同约定'},{kind:'paragraph',slot:'finding',text:'缺项须核实。'},{kind:'heading',slot:'finding',level:3,text:'运营职责'},{kind:'paragraph',slot:'finding',text:'按责任分工落实。'}];
  const raw=JSON.stringify({blocks}),prior={structuredText:raw,quality:{issues:[{code:'missing-evidence-marker',severity:'error',repairable:true,message:'缺完整标记'}]}},bound=reportRepairContract(prior,input);
  assert.deepEqual(bound.requiredHeadings,[{level:3,text:'收楼安排'},{level:4,text:'合同约定'},{level:3,text:'运营职责'}]);assert.equal(JSON.stringify(input),before);
  const snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  assert.equal(reportCandidateQuality(snapshot,raw).status,'passed');
  assert.ok(reportCandidateQuality(snapshot,JSON.stringify({blocks:blocks.filter(b=>b.kind!=='heading')})).issues.some(i=>i.code==='heading-structure-missing'));
  const context=reportRepairPromptContext({user:'核实材料'},prior,input);
  assert.match(context.instruction,/保留所有业务heading/);assert.doesNotMatch(context.instruction,/每槽只用一个paragraph/);
  assert.deepEqual(reportRepairContract({...prior,structuredText:'坏JSON'},input).requiredHeadings,undefined);
  const basis=C.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]).sections[0];assert.equal(reportRepairContract(prior,basis).requiredHeadings,undefined);
  assert.deepEqual(reportRepairContract({...prior,structuredText:'坏JSON'},bound).requiredHeadings,bound.requiredHeadings);
});
test('历史硬预算标题成本计入定点精简；只改原段，不挤掉标题或增加整节预算',()=>{
  const c=C.normalize({...C.createPlan([{name:'运营方案',sections:[{t:'运营管理'}]}],{projectType:'rent'}).sections[0],lengthPolicy:undefined}),limit=C.outputSlots(c).find(s=>s.slot==='finding').hardMax;
  const headings=[{kind:'heading',slot:'finding',level:3,text:'收楼安排'},{kind:'heading',slot:'finding',level:3,text:'运营职责'}];
  for(const repeated of [false,true]){
    const blocks=repeated?[headings[0],{kind:'paragraph',slot:'finding',text:'稿'.repeat(Math.floor(limit/2))},headings[1],{kind:'paragraph',slot:'finding',text:'稿'.repeat(limit-Math.floor(limit/2))}]:[headings[0],{kind:'paragraph',slot:'finding',text:'稿'.repeat(limit)}];
    const raw=JSON.stringify({blocks}),snapshot={qualityContract:c,outputFormat:C.OUTPUT_FORMAT},prior={structuredText:raw,quality:reportCandidateQuality(snapshot,raw)};
    assert.equal(prior.quality.status,'blocked');const plan=reportSlotRepairPlan(prior,c);assert.ok(plan);
    const cost=blocks.filter(b=>b.kind==='heading').reduce((n,b)=>n+b.text.length,0);assert.equal(plan.targets.reduce((n,t)=>n+t.hardMax,0),limit-cost);
    const replacements=plan.targets.map(t=>({...('blockIndex' in t?{blockIndex:t.blockIndex}:{}),slot:t.slot,text:'按已确认条件执行。'}));
    const output=reportApplySlotPatch(JSON.stringify({replacements}),plan);assert.deepEqual(output.issues,[]);
    assert.deepEqual(JSON.parse(output.structuredText).blocks.filter(b=>b.kind==='heading'),blocks.filter(b=>b.kind==='heading'));
    const bound=reportRepairContract(prior,c);assert.equal(reportCandidateQuality({...snapshot,qualityContract:bound},output.structuredText).status,'passed');
  }
});
test('遗漏已有匹配冻结表允许原样引用返修，真正缺表或不匹配原表仍阻断',async()=>{
  const html='<table><tr><th>参数</th><th>数值</th></tr><tr><td>租金</td><td>45</td></tr></table>';
  const bound=await C.bindFrozenTables({...contract,requiredTables:[{title:'参数表',headers:['参数','数值'],terms:['租金']}]},html,'[系统测试]available-table');
  const snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT},raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'租金参数待确认。'}]});
  const quality=reportCandidateQuality(snapshot,raw);
  assert.equal(quality.issues.find(i=>i.code==='missing-table').repairable,true);
  assert.equal(reportQualityRepairState(snapshot,quality).canRetry,true);
  const fixed=reportCandidateQuality(snapshot,JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'租金参数待确认。'},{kind:'table-ref',id:bound.frozenTables.tables[0].id}]}));
  assert.equal(fixed.issues.some(i=>i.severity==='error'),false);
  for(const other of [{...bound,frozenTables:undefined},{...bound,requiredTables:[{title:'资金表',headers:['借款','期限']}]}]){
    const q=reportCandidateQuality({...snapshot,qualityContract:other},raw);
    assert.equal(q.issues.find(i=>i.code==='missing-table').repairable,false);
    assert.equal(reportQualityRepairState(snapshot,q).canRetry,false);
  }
});
async function slotFixture(){
  const tables=['<table><tr><th>项目</th><th>万元</th></tr><tr><td>工程</td><td><span style="font-weight:bold">100.00</span></td></tr></table>','<table><tr><th>阶段</th><th>期限</th></tr><tr><td>首期</td><td>6年</td></tr></table>'];
  const bound=await C.bindFrozenTables({...contract,responsibility:'说明条件，不作无依据肯定结论',requirements:{...contract.requirements,proseTarget:700,proseMax:910,tableMax:2}},tables.join(''), '[系统测试]slot-draft');
  const slots=C.outputSlots(bound),blocks=[{kind:'paragraph',slot:'finding',text:'保留合格结论，100.00万元并非已批准投资。'},{kind:'paragraph',slot:'evidence',text:'依据'.repeat(slots[1].hardMax)},{kind:'table-ref',id:bound.frozenTables.tables[0].id},{kind:'paragraph',slot:'conditions',text:'风险'.repeat(slots[2].hardMax)},{kind:'table-ref',id:bound.frozenTables.tables[1].id},{kind:'paragraph',slot:'decision',text:'首期6年；条件未核实，不得直接实施。'}];
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  return {bound,tables,blocks,raw,snapshot,prior:{rawText:raw,structuredText:raw,quality:reportCandidateQuality(snapshot,raw)}};
}
async function rejectedPatchFixture(){
  const f=await slotFixture(),lengths={finding:210,evidence:225,conditions:308,decision:207};
  const blocks=f.blocks.map(block=>block.kind==='paragraph'?{...block,text:'稿'.repeat(lengths[block.slot])}:block);
  const raw=JSON.stringify({blocks});
  return {...f,blocks,raw,prior:{rawText:raw,structuredText:raw,quality:reportCandidateQuality(f.snapshot,raw)}};
}
// New tasks receive the authoritative role profile. Legacy fixtures above stay
// unchanged so archived four-slot snapshots remain independently covered.
async function serverSlotFixture(rejected=false){
  const f=await slotFixture(),sectionKey='经济评价 / 财务分析';
  const bound=await C.bindFrozenTables({...f.bound,frozenTables:undefined,sectionKey,writingStandard:{config:globalThis.ReportWritingStandard.normalize(),context:{projectType:'rent',chapter:'经济评价',title:'财务分析'}}},f.tables.join(''),'[系统测试]slot-draft');
  const limits=Object.fromEntries(C.outputSlots(bound).map(s=>[s.slot,s.hardMax])),map={finding:'operating',evidence:'returns',conditions:'conditions',decision:'drivers'};
  const blocks=[0,1,2,5,4,3].map(i=>f.blocks[i]).map(b=>b.kind==='paragraph'?{...b,slot:map[b.slot],text:(rejected?['operating','conditions']:['returns','conditions']).includes(map[b.slot])?'稿'.repeat(limits[map[b.slot]]+20):'经营条件仍待核实。'}:{...b,id:bound.frozenTables.tables[f.bound.frozenTables.tables.findIndex(t=>t.id===b.id)].id});
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  return {...f,bound,blocks,raw,snapshot,prior:{rawText:raw,structuredText:raw,quality:reportCandidateQuality(snapshot,raw)}};
}
test('新职责同槽多段按原块序号定点精简，共享预算且不改邻段与冻结表',async()=>{
  const f=await serverSlotFixture(),blocks=f.blocks.flatMap(b=>b.kind==='paragraph'&&b.slot==='returns'?[{...b,text:b.text.slice(0,200)},{...b,text:b.text.slice(200)}]:[b]),raw=JSON.stringify({blocks});
  const prior={rawText:raw,structuredText:raw,quality:reportCandidateQuality(f.snapshot,raw)};
  assert.equal(prior.quality.status,'blocked');const plan=reportSlotRepairPlan(prior,f.bound);assert.equal(plan.version,'paragraph-patch-v2');assert.equal(prior.structuredText,raw);
  const returns=plan.targets.filter(t=>t.slot==='returns');assert.equal(returns.length,2);assert.equal(returns.reduce((n,t)=>n+t.hardMax,0),C.outputSlots(f.bound).find(s=>s.slot==='returns').hardMax);
  const replacements=plan.targets.map(t=>({blockIndex:t.blockIndex,slot:t.slot,text:'原条件仍需核实。'}));
  const output=reportApplySlotPatch(JSON.stringify({replacements}),plan);assert.deepEqual(output.issues,[]);
  const next=JSON.parse(output.structuredText);for(let i=0;i<blocks.length;i++)if(!plan.targets.some(t=>t.blockIndex===i))assert.deepEqual(next.blocks[i],blocks[i]);
  assert.equal(reportCandidateQuality(f.snapshot,output.structuredText).status,'passed');
  for(const bad of [[...replacements,{blockIndex:0,slot:blocks[0].slot,text:'越权'}],replacements.map((r,i)=>i? r:{...r,slot:'unknown'}),[...replacements,replacements[0]],replacements.slice(1),replacements.map(({blockIndex,...r})=>r)])assert.equal(reportApplySlotPatch(JSON.stringify({replacements:bad}),plan).structuredText,plan.base);
  assert.match(reportRepairPromptContext({user:'已核实依据'},prior,f.bound).instruction,/blockIndex/);
});
test('定点计划只取服务端超限槽，替换不动合格段、表引用、块顺序和原始对象',async()=>{
  const f=await slotFixture(),plan=reportSlotRepairPlan(f.prior,f.bound),before=JSON.stringify(plan);
  assert.deepEqual(plan.targets.map(t=>t.slot),['evidence','conditions']);assert.equal(plan.version,'paragraph-patch-v1');
  for(const target of plan.targets){assert.ok(target.previousLength>target.hardMax);assert.ok(target.target<target.hardMax);}
  const raw=JSON.stringify({replacements:[{slot:'conditions',text:'风险需核实。'},{slot:'evidence',text:'依据仅限已核实条款。'}]}),patched=reportApplySlotPatch(raw,plan),value=JSON.parse(patched.structuredText);
  assert.deepEqual(patched.issues,[]);assert.equal(JSON.stringify(plan),before);assert.equal(f.prior.rawText,f.raw);
  assert.deepEqual(value.blocks.map(b=>b.kind==='paragraph'?b.slot:b.id),f.blocks.map(b=>b.kind==='paragraph'?b.slot:b.id));
  for(const i of [0,2,4,5])assert.deepEqual(value.blocks[i],f.blocks[i]);
  const output=reportCandidateOutput({...f.snapshot,qualitySlotPatch:plan},raw);assert.equal(output.structuredText,patched.structuredText);
  for(const table of f.tables)assert.ok(output.text.includes(table));
  const quality=reportCandidateQuality({...f.snapshot,qualitySlotPatch:plan},raw);assert.equal(quality.status,'passed');assert.equal(quality.factsVerified,false);
});

test('同槽多段按块预留完整缺口，合格同槽邻段仍进入只读上下文',async()=>{
  const f=await serverSlotFixture(),marker='【待补：'+ '经营口径'.repeat(30)+'】';
  const bound=C.normalize({...f.bound,requiredMarkers:[marker]}),limit=C.outputSlots(bound).find(s=>s.slot==='conditions').hardMax;
  const blocks=f.blocks.flatMap(b=>b.kind==='paragraph'&&b.slot==='conditions'?[{...b,text:marker+'险'.repeat(limit)},{...b,text:'其余经营条件仍待确认。'}]:b.kind==='paragraph'&&b.slot==='drivers'?[b,{...b,text:'融资边界仍待审批。'}]:[b]);
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT},prior={rawText:raw,structuredText:raw,quality:reportCandidateQuality(snapshot,raw)};
  const context=reportRepairPromptContext({user:'不重送扩写要求'},prior,bound);
  assert.equal(context.slotPatch.version,'paragraph-patch-v2');
  const targets=context.slotPatch.targets;assert.equal(targets.filter(t=>t.slot==='conditions').reduce((n,t)=>n+t.hardMax,0),limit);
  assert.ok(targets.find(t=>t.text.includes(marker)).hardMax>=marker.length);
  const modelTargets=JSON.parse(context.user.split('【指定槽位、预算及原文】\n')[1].split('\n【已由程序保留')[0]);
  assert.ok(modelTargets.find(t=>t.text.includes(marker)).target>=marker.length);
  const retained=JSON.parse(context.user.split('【已由程序保留的同节段落，仅供避重，不得改写】\n')[1].split('\n【只供核对')[0]);
  assert.equal(retained.filter(p=>p.slot==='drivers').length,2);
  const replacements=targets.map(t=>({blockIndex:t.blockIndex,slot:t.slot,text:t.text.includes(marker)?marker:'条件仍待确认。'}));
  assert.notEqual(reportCandidateQuality({...snapshot,qualitySlotPatch:context.slotPatch},JSON.stringify({replacements})).status,'blocked');
  const lost=replacements.map(r=>({...r,text:'删掉完整缺口不能通过。'}));
  assert.ok(reportCandidateQuality({...snapshot,qualitySlotPatch:context.slotPatch},JSON.stringify({replacements:lost})).issues.some(i=>i.code==='missing-evidence-marker'));
});
test('坏定点补丁保留完整base并阻断；未知、重复、缺槽及额外结构不能写入',async()=>{
  const f=await slotFixture(),plan=reportSlotRepairPlan(f.prior,f.bound),row={slot:'evidence',text:'短依据'},other={slot:'conditions',text:'风险待核对'};
  const bad=['not json','null','[]',JSON.stringify({replacements:[]}),JSON.stringify({replacements:[row]}),JSON.stringify({replacements:[row,row,other]}),JSON.stringify({replacements:[row,{...other,slot:'decision'}]}),JSON.stringify({replacements:[row,{...other,text:' '}]}),JSON.stringify({replacements:[row,{...other,text:4}]}),JSON.stringify({replacements:[row,{...other,id:'forged'}]}),JSON.stringify({replacements:[row,other],blocks:[]}),JSON.stringify({blocks:f.blocks})];
  for(const raw of bad){
    const result=reportApplySlotPatch(raw,plan);assert.equal(result.structuredText,plan.base);assert.equal(result.issues[0].code,'structured-slot-patch');
    const quality=reportCandidateQuality({...f.snapshot,qualitySlotPatch:plan},raw);assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='structured-slot-patch'));
  }
  for(const text of ['<script>alert(1)</script>','段落一\n段落二']){
    const raw=JSON.stringify({replacements:[row,{...other,text}]}),quality=reportCandidateQuality({...f.snapshot,qualitySlotPatch:plan},raw);
    assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>/^structured-paragraph-/.test(i.code)));
  }
});
test('第二轮依据合并JSON重选仍超限槽；混合结构错误不启用定点精简',async()=>{
  const f=await slotFixture(),plan=reportSlotRepairPlan(f.prior,f.bound),limit=plan.targets.find(t=>t.slot==='conditions').hardMax;
  const raw=JSON.stringify({replacements:[{slot:'evidence',text:'第一轮已精简并保留。'},{slot:'conditions',text:'险'.repeat(limit+1)}]}),snapshot={...f.snapshot,qualitySlotPatch:plan},output=reportCandidateOutput(snapshot,raw);
  const prior={rawText:raw,structuredText:output.structuredText,quality:reportCandidateQuality(snapshot,raw)},next=reportSlotRepairPlan(prior,f.bound);
  assert.deepEqual(next.targets.map(t=>t.slot),['conditions']);assert.equal(JSON.parse(next.base).blocks[1].text,'第一轮已精简并保留。');assert.equal(next.base,output.structuredText);
  const context=reportRepairPromptContext({system:'规则',user:'无关旧长稿'.repeat(100)},prior,f.bound);assert.deepEqual(context.slotPatch,next);assert.ok(context.user.includes('conditions'));assert.ok(!context.user.includes('无关旧长稿'));assert.ok(context.user.includes('第一轮已精简并保留'));
  assert.equal(reportSlotRepairPlan({...f.prior,quality:{issues:[...f.prior.quality.issues,{code:'structured-table-ref-missing',severity:'error'}]}},f.bound),null);
  assert.equal(reportSlotRepairPlan({...f.prior,structuredText:'invalid JSON'},f.bound),null);
  const retry=reportRepairPromptContext({system:'规则',user:'原依据'},{...prior,quality:{issues:[{code:'structured-slot-patch',severity:'error',repairable:true,message:'补丁格式错误'}]}},f.bound);
  assert.deepEqual(retry.slotPatch.targets.map(t=>t.slot),['conditions']);assert.equal(retry.slotPatch.base,output.structuredText);
  assert.ok(retry.user.includes('第一轮已精简并保留。'));assert.ok(retry.user.includes('补丁格式错误'));assert.ok(!retry.user.includes('原依据'));
});

test('真实失败形态：首轮越权多改decision整批拒绝，次轮仍只精简finding与conditions',async()=>{
  const f=await rejectedPatchFixture(),first=reportSlotRepairPlan(f.prior,f.bound);
  assert.deepEqual(first.targets.map(t=>[t.slot,t.previousLength,t.hardMax]),[['finding',210,208],['conditions',308,234]]);
  const rejectedRaw=JSON.stringify({replacements:[{slot:'finding',text:'短'.repeat(131)},{slot:'conditions',text:'险'.repeat(210)},{slot:'decision',text:'越'.repeat(148)}]});
  const snapshot={...f.snapshot,qualitySlotPatch:first},output=reportCandidateOutput(snapshot,rejectedRaw),quality=reportCandidateQuality(snapshot,rejectedRaw);
  assert.equal(output.structuredText,f.raw);assert.equal(quality.status,'blocked');
  assert.match(quality.issues.find(i=>i.code==='structured-slot-patch').message,/未授权槽位 "decision"/);
  const prior={rawText:rejectedRaw,structuredText:output.structuredText,quality},context=reportRepairPromptContext({user:'旧长稿不能重新扩写'},prior,f.bound);
  assert.deepEqual(context.slotPatch.targets,first.targets);assert.equal(context.slotPatch.base,first.base);
  assert.match(context.user,/上轮补丁协议错误/);assert.match(context.user,/decision/);assert.doesNotMatch(context.user,/旧长稿不能重新扩写/);
  const validRaw=JSON.stringify({replacements:[{slot:'finding',text:'短'.repeat(131)},{slot:'conditions',text:'险'.repeat(210)}]});
  const finalSnapshot={...f.snapshot,qualitySlotPatch:context.slotPatch},final=reportCandidateOutput(finalSnapshot,validRaw),value=JSON.parse(final.structuredText);
  assert.equal(reportCandidateQuality(finalSnapshot,validRaw).status,'passed');
  for(const i of [1,2,4,5])assert.deepEqual(value.blocks[i],f.blocks[i]);
  for(const table of f.tables)assert.ok(final.text.includes(table));
  assert.equal(prior.rawText,rejectedRaw);assert.equal(prior.structuredText,f.raw);
  assert.equal(reportQualityRepairState({qualityRepair:{round:2}},quality).canRetry,false);
});

test('补丁协议错误不能掩盖保留base的真实结构或事实错误，也不信任仅raw补丁',async()=>{
  const f=await rejectedPatchFixture(),protocol={code:'structured-slot-patch',severity:'error',repairable:true,message:'上轮格式错误'},prior={...f.prior,quality:{issues:[protocol]}};
  assert.ok(reportSlotRepairPlan(prior,f.bound),'仅报告协议错误时也从完整base重算真实超限槽');
  assert.equal(reportSlotRepairPlan({...prior,structuredText:null},f.bound),null);
  assert.equal(reportSlotRepairPlan({...prior,structuredText:JSON.stringify({blocks:f.blocks.filter(b=>b.kind!=='table-ref')})},f.bound),null);
  const withMissingFact=C.normalize({...f.bound,requiredFacts:[{key:'test-fact',label:'必须保留事项',value:'未获审批不能实施',required:true,status:'pending'}]});
  assert.equal(reportSlotRepairPlan(prior,withMissingFact),null,'重验base必需事实，不依赖上一轮错误数组是否完整');
  const valid={...prior,structuredText:JSON.stringify({blocks:f.blocks.map(b=>b.kind==='paragraph'?{...b,text:'合格。'}:b)})};
  assert.equal(reportSlotRepairPlan(valid,f.bound),null,'没有真实超限槽不得凭协议错误臆造目标');
});
test('返修保留原始JSON槽位和证据，但将具体修订与预算放在最终指令',()=>{
  const original={system:'原始规则',user:'原始已核实证据'},raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'evidence',text:'待确认条款'}]});
  const context=reportRepairPromptContext(original,{rawText:raw,text:'解码正文不应代替JSON',quality:{issues:[{severity:'error',repairable:true,message:'evidence 超过硬上限'}]}},contract);
  assert.ok(context.user.includes(raw));assert.ok(context.user.includes(original.user));assert.ok(!context.user.includes('解码正文不应代替JSON'));
  assert.ok(context.user.endsWith(context.instruction));assert.match(context.instruction,/evidence 超过硬上限/);assert.match(context.instruction,/target/);
  assert.equal(original.system,'原始规则');assert.equal(context.user.split('【待修复候选').length-1,1);
});

test('非篇幅错误返修禁止缩写；原有分组、完整缺口及冻结表仍受原合同检查',async()=>{
  const f=await slotFixture(),marker='【待补：实施进度与职责须确认】',bound=C.normalize({...f.bound,requiredMarkers:[marker]});
  const prior={...f.prior,quality:{issues:[{code:'structured-slot-count',severity:'error',repairable:true,message:'最多三个段落'},{code:'missing-evidence-marker',severity:'error',repairable:true,message:'缺完整标记'}]}};
  const context=reportRepairPromptContext({system:'旧扩写规则',user:'原始证据，逐条扩写全部事项'},prior,bound);
  assert.equal(context.slotPatch,undefined);assert.match(context.instruction,/完整JSON返修/);assert.match(context.instruction,/非篇幅问题禁止缩写/);assert.match(context.instruction,/未涉及错误的段落原样保留/);assert.match(context.instruction,/保留原有职责槽和段落分组/);assert.doesNotMatch(context.instruction,/每槽只用一个paragraph|最多两句|一至两句|\.6/);
  assert.doesNotMatch(context.instruction,/背景事实台账|原始证据，逐条扩写/);
  assert.ok(context.user.endsWith(context.instruction));assert.ok(context.instruction.includes(marker));
  assert.match(context.instruction,/这个小节主要是讲\/主要是分析/);
  for(const t of bound.frozenTables.tables)assert.ok(context.instruction.includes(t.id));
  const blocks=f.blocks.map(b=>b.kind==='paragraph'?{...b,text:b.slot==='conditions'?marker:'保留必要限制。'}:b);
  const snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT};
  assert.notEqual(reportCandidateQuality(snapshot,JSON.stringify({blocks})).status,'blocked');
  assert.equal(reportCandidateQuality(snapshot,JSON.stringify({blocks:blocks.filter(b=>b.kind!=='table-ref')})).status,'blocked');
  assert.equal(reportCandidateQuality(snapshot,JSON.stringify({blocks:blocks.map(b=>b.slot==='conditions'?{...b,text:'限制待核实。'}:b)})).status,'blocked');
});

test('长缺口误放业务槽时整节移回conditions，不靠删标记或扩大该槽预算',async()=>{
  const f=await slotFixture(),marker='【待补：'+ '实施依据'.repeat(28)+'】',bound=C.normalize({...f.bound,requiredMarkers:[marker]});
  const blocks=f.blocks.map(b=>b.slot==='evidence'?{...b,text:marker+'业务'.repeat(140)}:b.slot==='conditions'?{...b,text:'风险尚待确认。'}:b);
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT},prior={rawText:raw,structuredText:raw,quality:reportCandidateQuality(snapshot,raw)};
  assert.equal(reportSlotRepairPlan(prior,bound),null);
  const context=reportRepairPromptContext({system:'规则',user:'原始依据'},prior,bound);
  assert.equal(context.slotPatch,undefined);assert.match(context.instruction,/放conditions/);assert.ok(context.instruction.includes(marker));
  const corrected=blocks.map(b=>b.kind==='paragraph'?{...b,text:b.slot==='conditions'?marker:'业务条件仍须核实。'}:b);
  assert.notEqual(reportCandidateQuality(snapshot,JSON.stringify({blocks:corrected})).status,'blocked');
  assert.equal(reportCandidateQuality(snapshot,JSON.stringify({blocks:corrected.map(b=>b.slot==='conditions'?{...b,text:'已核实。'}:b)})).status,'blocked');
});
test('生成完成与质量通过分离；缺合同不伪造验收，事实检查永不自动确证',()=>{
  assert.equal(reportCandidateQuality({},'原有正文').status,'unverified');
  const pending=reportCandidateQuality({qualityContract:contract},'','queued');assert.equal(pending.status,'unverified');
  const complete=reportCandidateQuality({qualityContract:contract},'按照已确认协议执行。');assert.equal(complete.status,'passed');assert.equal(complete.factsVerified,false);
  const blocked=reportCandidateQuality({qualityContract:contract},'长正文'.repeat(80));assert.equal(blocked.status,'blocked');assert.equal(reportQualityRepairState({},blocked).canRetry,true);
  assert.equal(reportQualityRepairState({qualityRepair:{round:2}},blocked).exhausted,true);
  assert.equal(reportQualityRepairState({},blocked,true).canRetry,false);
  assert.equal(reportQualityRepairState({}, {status:'blocked',issues:[{code:'unknown',severity:'error'}]}).canRetry,false);
  const factsContract={...contract,requiredFacts:[{label:'首期合作期限',value:'6年',status:'confirmed',required:true,source:'协议原文'}]};
  const missingFact=reportCandidateQuality({qualityContract:factsContract},'本项目合作条件需要复核。');
  assert.equal(missingFact.status,'blocked');assert.equal(reportQualityRepairState({},missingFact).canRetry,true);
  assert.equal(reportCandidateQuality({qualityContract:factsContract},'首期合作期限为6年。').factsVerified,false);
  const missingTable=reportCandidateQuality({qualityContract:{...contract,requiredTables:[{title:'协议条件',headers:['条款','已确认内容']}]}},'条件需要复核。');
  assert.equal(missingTable.status,'blocked');assert.equal(reportQualityRepairState({},missingTable).canRetry,false);
});
test('无效合同及小节串用在数据库和模型请求前拒绝',async()=>{
  const env={DB:{_transaction(){throw new Error('不应进入数据库');}}};
  await assert.rejects(startReportSection(env,1,{qualityContract:{...contract,version:'old'},sectionKey:contract.sectionKey}),/版本/);
  await assert.rejects(startReportSection(env,1,{qualityContract:contract,sectionKey:'另一小节'}),/不一致/);
});
test('新输出协议与历史纯文本隔离，保留原始候选，不把错误JSON当成通过',()=>{
  const snapshot={qualityContract:contract,outputFormat:'report-blocks-v1'};
  const raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'仅依据已核实资料。'}]});
  assert.equal(reportCandidateOutput(snapshot,raw).text,'仅依据已核实资料。');
  assert.equal(reportCandidateQuality(snapshot,raw).status,'passed');
  assert.equal(reportCandidateQuality(snapshot,'仅依据已核实资料。').status,'blocked');
  assert.equal(reportCandidateOutput({},'历史原文').text,'历史原文');
  assert.equal(reportCandidateQuality({...snapshot,outputFormat:'future-v9'},raw).status,'blocked');
  assert.equal(reportCandidateOutput({...snapshot,outputFormat:'future-v9'},raw).text,raw);
});

test('定点返修仅消除实际超预算，不降为六成摘要；判断链、只读邻段和事实边界保持',async()=>{
  const f=await slotFixture(),before=JSON.stringify(f),original={system:'旧扩写规则',user:'无关旧长稿'},context=reportRepairPromptContext(original,f.prior,f.bound);
  const targets=JSON.parse(context.user.split('【指定槽位、预算及原文】\n')[1].split('\n【已由程序保留')[0]);
  assert.equal(targets.length,context.slotPatch.targets.length);
  for(const [i,target] of targets.entries()){
    assert.equal(target.target,context.slotPatch.targets[i].target);
    assert.equal(target.hardMax,context.slotPatch.targets[i].hardMax);assert.equal(target.text,context.slotPatch.targets[i].text);
  }
  const retained=JSON.parse(context.user.split('【已由程序保留的同节段落，仅供避重，不得改写】\n')[1].split('\n【只供核对')[0]);
  assert.deepEqual(retained,f.blocks.filter(b=>b.kind==='paragraph'&&['finding','decision'].includes(b.slot)).map(({slot,text})=>({slot,text})));
  for(const table of f.tables)assert.ok(!context.user.includes(table),'冻结原表不送模型重写');
  assert.ok(!context.user.includes(original.user));assert.equal(JSON.stringify(f),before);assert.equal(original.system,'旧扩写规则');
  assert.match(context.instruction,/缩减到各段hardMax以内即可/);assert.match(context.instruction,/不为达到target额外压缩/);assert.match(context.instruction,/不限制句数/);assert.match(context.instruction,/判断依据、因果关系、分析边界、全部项目事实与数字/);assert.match(context.instruction,/不得原样返回已超限段落/);
  assert.doesNotMatch(context.instruction,/一至两句|最多两句|不必保留所有数字|六成|60%/);
  assert.match(context.instruction,/必需事实required=true在完整小节保留/);assert.match(context.instruction,/待确认状态/);assert.doesNotMatch(context.instruction,/宁可返回超限/);
  const prompt=C.structuredPrompt(f.bound);assert.match(prompt,/不逐句改写原稿/);assert.match(prompt,/两至三项决定性事实/);assert.match(prompt,/不在风险后再加同义的待补清单/);
});

test('定点返修仍显式携带关键缺口，原段目标不得小于必需标记',async()=>{
  const f=await slotFixture(),marker='【待补：'+ '经营口径'.repeat(45)+'】';
  const bound=C.normalize({...f.bound,requiredMarkers:[marker]}),slot=C.outputSlots(bound).find(x=>x.slot==='conditions');
  const blocks=[{kind:'paragraph',slot:'finding',text:'事实仍待核实。'},{kind:'paragraph',slot:'conditions',text:marker+'险'.repeat(slot.hardMax)},...bound.frozenTables.tables.map(t=>({kind:'table-ref',id:t.id}))];
  const raw=JSON.stringify({blocks}),snapshot={qualityContract:bound,outputFormat:C.OUTPUT_FORMAT},prior={rawText:raw,structuredText:raw,quality:reportCandidateQuality(snapshot,raw)};
  const context=reportRepairPromptContext({system:'规则',user:'证据'},prior,bound);
  assert.ok(context.slotPatch);assert.match(context.user,/必须完整保留的关键缺口/);assert.ok(context.user.includes(marker));
  const targets=JSON.parse(context.user.split('【指定槽位、预算及原文】\n')[1].split('\n【已由程序保留')[0]);
  assert.ok(targets[0].target>=marker.length);assert.equal(targets[0].hardMax,slot.hardMax);
  const quality=reportCandidateQuality({...snapshot,qualitySlotPatch:context.slotPatch},JSON.stringify({replacements:[{slot:'conditions',text:'风险待确认。'}]}));
  assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(x=>x.code==='missing-evidence-marker'));
});

test('模型明确声明必需内容与预算冲突时阻断，不能把失败记录作为正文接受',async()=>{
  const f=await slotFixture(),context=reportRepairPromptContext({system:'规则',user:'证据'},f.prior,f.bound);
  const raw=JSON.stringify({repairFailure:{code:'required-content-over-budget',slots:['conditions'],reason:'已完成职责摘要，但必须保留的具体限制仍超过硬预算'}});
  assert.match(context.instruction,/repairFailure/);
  const snapshot={...f.snapshot,qualitySlotPatch:context.slotPatch},output=reportCandidateOutput(snapshot,raw),quality=reportCandidateQuality(snapshot,raw);
  assert.equal(output.structuredText,context.slotPatch.base);assert.equal(quality.status,'blocked');assert.equal(quality.factsVerified,false);
  assert.ok(quality.issues.some(i=>i.code==='structured-slot-patch'));assert.ok(!output.text.includes('已完成职责摘要'));
  for(const table of f.tables)assert.ok(output.text.includes(table));
});

test('首稿与完整返修按正文、生成表和协议预算分配Token，局部补丁不支付只读邻段的输出',async()=>{
  const small=reportSectionOutputBudget(contract),largeContract={...contract,requirements:{...contract.requirements,proseTarget:2400,proseMax:3120,tableCharsMax:2200}},large=reportSectionOutputBudget(largeContract);
  assert.ok(large.maxTokens>small.maxTokens);assert.ok(large.maxTokens>4000);assert.ok(large.maxTokens<=16384);assert.equal(large.chainTokens,large.maxTokens*3);
  const reducedTable=reportSectionOutputBudget({...largeContract,requirements:{...largeContract.requirements,tableCharsMax:100}});assert.ok(reducedTable.maxTokens<large.maxTokens);
  const basis=reportSectionOutputBudget({...largeContract,requirements:{...largeContract.requirements,basis:true}});assert.equal(basis.maxTokens,reportSectionOutputBudget({...largeContract,requirements:{...largeContract.requirements,basis:true,tableCharsMax:0}}).maxTokens);
  const f=await slotFixture(),before=JSON.stringify(f.bound),plan=reportSlotRepairPlan(f.prior,f.bound),patch=reportSectionOutputBudget(f.bound,plan),complete=reportSectionOutputBudget(f.bound);
  assert.ok(patch.maxTokens<=complete.maxTokens);assert.equal(JSON.stringify(f.bound),before);
  const refOnly={...f.bound,requirements:{...f.bound.requirements,tableCharsMax:18000}};assert.equal(reportSectionOutputBudget(refOnly).maxTokens,complete.maxTokens,'冻结表仅输出ID，不把HTML复制进模型输出预算');
  assert.deepEqual(reportSectionOutputBudget(null),{version:'report-output-budget-v1',maxTokens:4000,chainTokens:4000});
  assert.throws(()=>reportSectionOutputBudget({...largeContract,requirements:{...largeContract.requirements,proseMax:20000}}),/16384.*未截断或缩写/);
});

test('非居改保真实43节75k详实计划逐节具有足够出站预算，均在明确16k上限内',async()=>{
  const seed=JSON.parse(readFileSync(new URL('../data/report-logic-gaibao-v1.json',import.meta.url),'utf8'));
  const box=createContext({window:{},fetch:async()=>({ok:true,json:async()=>({ok:true,set:{id:'[系统测试]budget-outline',version:seed.version,projectType:'gaibao',data:seed}})})});
  runInContext(readFileSync(new URL('../report-logic-core.js',import.meta.url),'utf8'),box);await box.window.ReportLogicCore.load('gaibao');
  const chapters=JSON.parse(JSON.stringify(box.window.ReportLogicCore.outline('gaibao',{businessScenario:'housing_conversion'}).chapters)),plan=C.createPlan(chapters);
  assert.equal(plan.sections.length,43);assert.equal(plan.totalTarget,75000);
  for(const c of plan.sections){
    const budget=reportSectionOutputBudget(c);assert.ok(budget.maxTokens>4000,c.sectionKey);assert.ok(budget.maxTokens<=16384,c.sectionKey);assert.equal(budget.chainTokens,budget.maxTokens*3);
    assert.ok(budget.maxTokens>=c.requirements.proseMax*2,c.sectionKey+'完整正文必须有预算');
  }
});

test('Token预算与生成策略绑定：历史保持4000，新任务预算缺失、伪造或不匹配全部阻断',()=>{
  const policyVersion=readFileSync(new URL('../functions/api/reportexecution.js',import.meta.url),'utf8').match(/const GENERATION_POLICY_VERSION='([^']+)'/)[1];
  const current={qualityContract:contract,generationPolicyVersion:policyVersion,outputBudget:reportSectionOutputBudget(contract)};
  assert.equal(reportBoundOutputTokens(current),current.outputBudget.maxTokens);
  assert.equal(reportBoundOutputTokens({...current,generationPolicyVersion:'prior-policy'}),4000);assert.equal(reportBoundOutputTokens({}),4000);
  for(const bad of [{...current,outputBudget:null},{...current,outputBudget:{...current.outputBudget,maxTokens:16384}},{...current,outputBudget:{...current.outputBudget,chainTokens:1}},{...current,outputBudget:{...current.outputBudget,version:'fake'}}])assert.throws(()=>reportBoundOutputTokens(bad),/绑定.*输出预算|输出预算.*绑定合同/);
});

test('模型Token截断不是完整首稿：即使JSON闭合仍阻断，原稿、标题、表和数字不被自动裁剪',async()=>{
  const f=await slotFixture(),blocks=f.blocks.map(b=>b.kind==='paragraph'?{...b,text:'项目合作首期6年，工程100.00万元尚未批准；条件未核实，不得直接实施。'}:b),raw=JSON.stringify({blocks}),snapshot=f.snapshot;
  assert.equal(reportCandidateQuality(snapshot,raw,'completed',{finishReason:'stop'}).status,'passed');
  for(const meta of [{finishReason:'length'},{truncated:true}]){
    const quality=reportCandidateQuality(snapshot,raw,'completed',meta);assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='model-output-truncated'));assert.equal(reportQualityRepairState(snapshot,quality).canRetry,true);
    const output=reportCandidateOutput(snapshot,raw);assert.equal(output.structuredText,raw);assert.ok(output.text.includes('100.00万元'));for(const table of f.tables)assert.ok(output.text.includes(table));
    const context=reportRepairPromptContext({user:'原证据'}, {rawText:raw,structuredText:raw,quality}, f.bound);assert.equal(context.slotPatch,undefined);assert.match(context.instruction,/非篇幅问题禁止缩写/);assert.match(context.user,/原始候选已保留/);
  }
  const incomplete=raw.slice(0,-6),quality=reportCandidateQuality(snapshot,incomplete,'completed',{finishReason:'length'});assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='structured-json'));assert.equal(reportCandidateOutput(snapshot,incomplete).raw,incomplete);
  assert.equal(reportCandidateQuality(snapshot,raw,'queued',{finishReason:'length'}).status,'unverified');
});

const target=testDatabaseUrl();
test('真实隔离库：两轮修复共享根预算、并发幂等、失败候选保留、变源阻断',{skip:!target},async t=>{
  const DB=createD1Shim(target),env={DB,DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'},projectId=crypto.randomUUID();
  async function finish(runId,text,blocks=null,responseOverride=null,options={}){
    await DB.prepare("UPDATE agent_jobs SET status='running',lease_owner='quality-test',lease_expires_at=?,attempts=attempts+1 WHERE run_id=?").bind(Date.now()+60000,runId).run();
    const job=await DB.prepare('SELECT * FROM agent_jobs WHERE run_id=?').bind(runId).first(),snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE run_id=?').bind(runId).first()).input_json),original=globalThis.fetch;let calls=0,outgoing;
    const response=responseOverride||(blocks?{blocks}:snapshot.qualitySlotPatch?{replacements:snapshot.qualitySlotPatch.targets.map(t=>({slot:t.slot,text:typeof text==='function'?text(t):text}))}:{blocks:[{kind:'paragraph',slot:C.outputSlots(snapshot.qualityContract)[0].slot,text}]});
    globalThis.fetch=async(url,init)=>{calls++;outgoing=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(response)},finish_reason:options.finishReason||'stop'}],usage:{prompt_tokens:5,completion_tokens:20}}),{headers:{'content-type':'application/json'}});};
    try{
      await executeLlmTask(env,job,{...JSON.parse(job.payload_json),...options.payload});await settleAgentJob(env,job,true);assert.equal(calls,1);
      const expected=snapshot.outputBudget?.maxTokens||4000;assert.equal(outgoing.max_tokens,expected);
      if(options.expectedQuery!==undefined)assert.equal(outgoing.messages.find(m=>m.role==='user').content,options.expectedQuery,'完整上下文送达Provider适配器，不按100k截断');
      const ledger=await DB.prepare('SELECT reserved_output,response_json FROM agent_call_ledger WHERE run_id=?').bind(runId).first();assert.equal(Number(ledger.reserved_output),outgoing.max_tokens);
      assert.equal(JSON.parse(ledger.response_json).finishReason,options.finishReason||'stop');
    }finally{globalThis.fetch=original;}
  }
  try{
    const user=Number((await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id),data={project:{name:'[系统测试]篇幅修复'},chapters:[{name:'经营方案',sections:[{t:'合作安排',content:'正式原文保持不变'}]}]};
    await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,user,data.project.name,JSON.stringify(data),Date.now()).run();
    const input={projectId,sectionKey:contract.sectionKey,system:'只写真实资料',user:'合同：条件待确认。',qualityContract:contract},root=await startReportSection(env,user,input),long='需核对实施条件。'.repeat(40);
    await finish(root.runId,long);
    await t.test('只读轮询不启动修复；模型完成仍标记质量阻断',async()=>{
      const a=await readReportSection(env,user,root.id),b=await readReportSection(env,user,root.id);
      assert.equal(a.status,'completed');assert.equal(a.quality.status,'blocked');assert.equal(a.graph[3].status,'quality_blocked');assert.equal(b.repair.round,0);
      assert.equal(a.outputFormat,'report-blocks-v1');assert.equal(JSON.parse(a.rawText).blocks[0].text,long);
      const queued=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(root.runId).first()).payload_json);assert.match(queued.system,/report-blocks-v1/);
      const n=await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first();assert.equal(Number(n.n),1);
    });
    await t.test('详实首稿的出站预算不再被worker截成4000；治理与台账一致，伪造预算或跨run拒绝',async()=>{
      const completeContext='[系统测试]详实首稿完整160k上下文：'+'事实'.repeat(80000)+'[完整上下文尾标]',detailed={...contract,requirements:{...contract.requirements,proseTarget:3200,proseMax:4160,tableCharsMax:100}},task=await startReportSection(env,user,{...input,user:completeContext,qualityContract:detailed});
      const snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json),payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(task.runId).first()).payload_json);
      assert.ok(payload.maxTokens>4000);assert.equal(payload.maxTokens,snapshot.outputBudget.maxTokens);assert.equal(reportBoundOutputTokens(snapshot),payload.maxTokens);
      const sentence='项目保留收益60%；运营首月启动合作分成，未核实条件不得直接实施。',blocks=C.outputSlots(snapshot.qualityContract).map(s=>({kind:'paragraph',slot:s.slot,text:sentence.repeat(Math.max(1,Math.floor(s.target/sentence.length)))}));
      const serialized=JSON.stringify({blocks});assert.ok(serialized.length>2500);
      await assert.rejects(finish(task.runId,'',blocks,null,{payload:{maxTokens:4000}}),/输出预算.*不一致/);
      await assert.rejects(finish(task.runId,'',blocks,null,{payload:{reportSectionTaskId:root.id,maxTokens:payload.maxTokens}}),/轮次不一致/);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM agent_call_ledger WHERE run_id=?').bind(task.runId).first()).n),0,'校验失败不得预留调用或请求模型');
      await finish(task.runId,'',blocks,null,{expectedQuery:completeContext});
      const read=await readReportSection(env,user,task.id);assert.equal(read.rawText,serialized);assert.equal(read.structuredText,serialized);assert.ok(read.text.length>2500);assert.equal(read.quality.issues.some(i=>i.code==='model-output-truncated'),false);
      const governance=await DB.prepare('SELECT budget_output_tokens FROM agent_run_governance WHERE run_id=?').bind(task.runId).first();assert.equal(Number(governance.budget_output_tokens),snapshot.outputBudget.chainTokens);
      assert.equal((await readReportSection(env,user,root.id)).rawText,JSON.stringify({blocks:[{kind:'paragraph',slot:C.outputSlots(JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(root.id).first()).input_json).qualityContract)[0].slot,text:long}]}),'邻任务原始首稿不改');
    });
    await t.test('实际排版收敛：完整原文与派生目标贯穿创建、持久化、worker及只读恢复，正常计划不变',async()=>{
      const initialLengthSource='<p>'+'核'.repeat(4302)+'</p>',referenceBudget={referenceOnly:true,target:2900,actual:4302,min:1598,scope:'details',documentSha256:'a'.repeat(64),measuredPages:137,targetPages:120,targetPageRange:{min:110,max:130},confirmedProseTotal:84500};
      const qualityContract=await C.bindInitialLengthConvergence({...contract,lengthPolicy:'advisory-v1',requirements:{...contract.requirements,proseTarget:1598,proseMax:2078,tableCharsMax:100}},initialLengthSource,{permitId:'[系统测试]permit',idempotencyKey:'[系统测试]idempotency',batchId:'[系统测试]batch',referenceBudget});
      const query=JSON.stringify({source:initialLengthSource,referenceBudget}),converging={...input,user:query,initialLengthSource,qualityContract};
      const task=await startReportSection(env,user,converging),snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json),payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(task.runId).first()).payload_json);
      assert.equal(snapshot.initialLengthSource,initialLengthSource);assert.equal(snapshot.user,query);assert.equal(payload.query,query);
      assert.deepEqual(snapshot.qualityContract.initialLengthConvergence,qualityContract.initialLengthConvergence);
      assert.equal(snapshot.qualityContract.requirements.proseTarget,1598);assert.equal(snapshot.qualityContract.requirements.proseMax,2078);assert.equal(C.outputSlots(snapshot.qualityContract).reduce((n,s)=>n+s.target,0),2900);
      assert.equal(C.programProseBudget(snapshot.qualityContract).outputProseMax,4302);assert.equal(reportBoundOutputTokens(snapshot),snapshot.outputBudget.maxTokens);assert.equal(payload.maxTokens,snapshot.outputBudget.maxTokens);assert.ok(payload.maxTokens>4000);
      assert.match(payload.system,/本次收敛正文参考目标2900字/);assert.doesNotMatch(payload.system,/正文目标1598字|接近已确认目标完成详实分析/);
      const replay=await startReportSection(env,user,converging);assert.equal(replay.reused,true);assert.equal(replay.id,task.id);
      const beforeCount=Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n);
      for(const bad of [{...converging,initialLengthSource:undefined},{...converging,initialLengthSource:initialLengthSource+'变更'},{...converging,qualityContract:{...qualityContract,initialLengthConvergence:{...qualityContract.initialLengthConvergence,sourceProseCharacters:6000,referenceBudget:{...referenceBudget,actual:6000}}}}])await assert.rejects(startReportSection(env,user,bad),/完整原文.*不一致/);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n),beforeCount,'不合法原文不得排队或产生半任务');
      const blocks=C.outputSlots(snapshot.qualityContract).map(s=>({kind:'paragraph',slot:s.slot,text:'保留原有分析，条件未落实不得认定已完成。'}));
      await finish(task.runId,'',blocks,null,{expectedQuery:query});
      const read=await readReportSection(env,user,task.id),again=await readReportSection(env,user,task.id);assert.equal(read.status,'completed');assert.equal(read.rawText,JSON.stringify({blocks}));assert.equal(again.rawText,read.rawText);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n),beforeCount,'重复读取不追加任务');
      const recovered=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json);await C.verifyInitialLengthConvergence(recovered.qualityContract,recovered.initialLengthSource);
      const interrupted=await startReportSection(env,user,{...converging,user:query+'\n[系统测试]协议截断恢复'});await finish(interrupted.runId,'',blocks,null,{finishReason:'length'});
      const retry=await repairReportSection(env,user,interrupted.id),retrySnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(retry.id).first()).input_json);
      assert.equal(retrySnapshot.initialLengthSource,initialLengthSource);assert.deepEqual(retrySnapshot.qualityContract.initialLengthConvergence,qualityContract.initialLengthConvergence);await C.verifyInitialLengthConvergence(retrySnapshot.qualityContract,retrySnapshot.initialLengthSource);
      await finish(retry.runId,'',blocks);assert.equal((await readReportSection(env,user,interrupted.id)).quality.issues.some(i=>i.code==='model-output-truncated'),true,'显式协议重试不覆盖原任务证据');
      assert.deepEqual(JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(projectId).first()).data),data,'生成与恢复不改正式项目正文');
    });
    await t.test('显式500k输入保护线拒绝超量上下文，不截断入队或创建半任务',async()=>{
      const count=Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n);
      await assert.rejects(startReportSection(env,user,{...input,user:'界'.repeat(500001)}),/小节上下文过大/);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n),count);
    });
    await t.test('已闭合JSON的length输出保留收费台账及候选，完成但阻断，不自动再次生成',async()=>{
      const task=await startReportSection(env,user,{...input,user:'[系统测试]供应商截断回执'});await finish(task.runId,'按已确认条件执行。',null,null,{finishReason:'length'});
      const first=await readReportSection(env,user,task.id),second=await readReportSection(env,user,task.id);
      assert.equal(first.status,'completed');assert.equal(first.quality.status,'blocked');assert.ok(first.quality.issues.some(i=>i.code==='model-output-truncated'));assert.equal(first.graph[3].status,'quality_blocked');assert.equal(second.rawText,first.rawText);assert.equal(second.repair.round,0);
      const ledger=await DB.prepare('SELECT status,response_json FROM agent_call_ledger WHERE run_id=?').bind(task.runId).first();assert.equal(ledger.status,'settled');assert.equal(JSON.parse(ledger.response_json).truncated,true);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM agent_call_ledger WHERE run_id=?').bind(task.runId).first()).n),1);
      const child=await repairReportSection(env,user,task.id),childSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(child.id).first()).input_json);
      assert.equal(childSnapshot.qualitySlotPatch,undefined);assert.match(childSnapshot.qualityRepairInstruction,/非篇幅问题禁止缩写/);assert.equal(Number((await DB.prepare('SELECT budget_output_tokens FROM agent_run_governance WHERE run_id=?').bind(child.runId).first()).budget_output_tokens),childSnapshot.outputBudget.maxTokens);
      await finish(child.runId,'按已确认条件执行。');assert.equal((await readReportSection(env,user,task.id)).rawText,first.rawText);
    });
    await t.test('没有成稿合同的历史报告调用仍限4000，不受任意maxTokens请求放宽',async()=>{
      const task=await startReportSection(env,user,{...input,user:'[系统测试]普通输出上限',qualityContract:null});
      const snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json);assert.equal(snapshot.outputBudget,undefined);
      await finish(task.runId,'普通正文',null,{blocks:[{kind:'paragraph',slot:'finding',text:'普通正文'}]},{payload:{maxTokens:16000}});
      assert.equal(Number((await DB.prepare('SELECT budget_output_tokens FROM agent_run_governance WHERE run_id=?').bind(task.runId).first()).budget_output_tokens),4000);
    });
    const repairs=await Promise.all([repairReportSection(env,user,root.id),repairReportSection(env,user,root.id)]),first=repairs[0];assert.equal(first.id,repairs[1].id);
    await finish(first.runId,long);
    const second=await repairReportSection(env,user,first.id);await finish(second.runId,long);
    await t.test('最多两轮，不覆盖旧候选或正式正文，子任务使用原始上下文与共享预算',async()=>{
      const read=await readReportSection(env,user,second.id);assert.equal(read.repair.round,2);assert.equal(read.repair.canRetry,false);assert.equal(read.repair.exhausted,true);
      await assert.rejects(repairReportSection(env,user,second.id),/两轮/);
      assert.equal((await readReportSection(env,user,root.id)).text,long);assert.equal((await readReportSection(env,user,first.id)).text,long);
      const original=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(projectId).first()).data);assert.equal(original.chapters[0].sections[0].content,'正式原文保持不变');
      const g=await DB.prepare('SELECT * FROM agent_run_governance WHERE run_id=?').bind(second.runId).first();assert.equal(g.root_run_id,root.runId);assert.equal(g.parent_run_id,first.runId);
      const rootSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE run_id=?').bind(root.runId).first()).input_json),g0=await DB.prepare('SELECT * FROM agent_run_governance WHERE run_id=?').bind(root.runId).first();assert.equal(Number(g0.budget_output_tokens),rootSnapshot.outputBudget.chainTokens);assert.equal(Number(g0.output_tokens),60);
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(second.runId).first()).payload_json);assert.match(payload.system,/paragraph-patch-v1/);assert.match(payload.query,/指定槽位、预算及原文/);assert.ok(!payload.query.includes('【待修复候选'));
      assert.deepEqual(Object.keys(JSON.parse(read.rawText)),['replacements']);assert.equal(JSON.parse(read.structuredText).blocks[0].text,long);
      await assert.rejects(repairReportSection(env,user+999,root.id),/权限/);
    });
    await t.test('生成策略升级不修改旧结果，但拒绝向旧策略任务追加返修分支',async()=>{
      const old=await startReportSection(env,user,{...input,user:'[系统测试]旧策略任务'});await finish(old.runId,long);
      const row=await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(old.id).first(),snapshot=JSON.parse(row.input_json);
      assert.ok(snapshot.generationPolicyVersion,'新合同必须将生成策略版本纳入任务快照');
      snapshot.generationPolicyVersion='[系统测试]prior-policy';
      await DB.prepare('UPDATE report_section_tasks SET input_json=? WHERE id=?').bind(JSON.stringify(snapshot),old.id).run();
      const before=await readReportSection(env,user,old.id),count=Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n);
      assert.equal(before.status,'completed');assert.equal(before.text,long);assert.equal(JSON.parse(before.rawText).blocks[0].text,long);
      assert.equal(before.rulesChanged,true);assert.equal(before.repair.canRetry,false);assert.equal(before.repair.canProtocolRetry,false);assert.match(before.warning,/规则已更新/);
      await assert.rejects(repairReportSection(env,user,old.id),/规则已更新|跨版本|新版计划/);
      const after=await readReportSection(env,user,old.id);assert.equal(after.rawText,before.rawText);assert.equal(after.runId,before.runId);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n),count);
    });
    await t.test('服务端绑定工作稿原表及SHA；重复任务幂等，伪造清单和危险原表在排队前拒绝',async()=>{
      const table='<table class="rpt"><tr><th rowspan="2">项目</th><th colspan="2">金额（万元）</th></tr><tr><th>首期</th><th>合计</th></tr><tr><td>工程</td><td><span style="font-weight:bold">100.00</span></td><td>100.00</td></tr></table>';
      const sourceHtml='<p>工作稿表，不代表已核实事实。</p>'+table,sourceSnapshotId='[系统测试]draft-1';
      const frozenInput={...input,user:'[系统测试]冻结原表任务',sourceHtml,sourceSnapshotId},task=await startReportSection(env,user,frozenInput);
      const snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json),bound=snapshot.qualityContract,manifest=bound.frozenTables;
      assert.equal(manifest.sourceSnapshotId,sourceSnapshotId);assert.equal(manifest.sourceDigest,createHash('sha256').update(sourceHtml).digest('hex'));
      assert.equal(manifest.tables.length,1);assert.equal(manifest.tables[0].html,table);assert.equal(manifest.tables[0].sha256,createHash('sha256').update(table).digest('hex'));
      const replay=await startReportSection(env,user,frozenInput);assert.equal(replay.id,task.id);assert.equal(replay.reused,true);
      const count=Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n);
      for(const mutate of [c=>{c.frozenTables.tables[0].html=c.frozenTables.tables[0].html.replace('100.00','999.00');},c=>{c.frozenTables.sourceDigest='0'.repeat(64);},c=>{c.frozenTables.tables[0].id='ft-'+'0'.repeat(64);},c=>{c.frozenTables.sourceSnapshotId='[系统测试]other-draft';}]){
        const forged=structuredClone(bound);mutate(forged);
        await assert.rejects(startReportSection(env,user,{...frozenInput,qualityContract:forged}),/冻结原表|快照不一致/);
      }
      await assert.rejects(startReportSection(env,user,{...input,user:'[系统测试]缺原稿',qualityContract:bound}),/缺少.*原始工作稿/);
      await assert.rejects(startReportSection(env,user,{...frozenInput,sourceHtml:table.replace('<td>工程','<td onclick="alert(1)">工程')}),/不安全/);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_section_tasks WHERE project_id=?').bind(projectId).first()).n),count,'拒绝的输入不能产生新模型任务');
      await finish(task.runId,'', [{kind:'paragraph',slot:C.outputSlots(bound)[0].slot,text:'按工作稿原表列示，数据待人工核对。'},{kind:'table-ref',id:manifest.tables[0].id}]);
      const result=await readReportSection(env,user,task.id);assert.equal(result.quality.status,'passed');assert.equal(result.quality.factsVerified,false);assert.ok(result.text.includes(table));
      assert.equal(JSON.parse(result.rawText).blocks[1].id,manifest.tables[0].id);assert.equal(result.graph[3].status,'awaiting_human_review');
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(task.runId).first()).payload_json);assert.match(payload.system,/table-ref/);assert.ok(payload.system.includes(manifest.tables[0].id));
      const updated=await startReportSection(env,user,{...frozenInput,sourceHtml:sourceHtml.replaceAll('100.00','105.00')});assert.notEqual(updated.id,task.id,'原表数值变化必须得到新任务身份');
      assert.equal((await readReportSection(env,user,task.id)).text,result.text,'新原表任务不得改写旧候选');
    });
    await t.test('真实任务两轮定点精简：第二轮只改剩余超限槽，保留第一轮合格段和冻结原表',async()=>{
      const f=await serverSlotFixture(),sourceHtml=f.tables.join(''),task=await startReportSection(env,user,{...input,sectionKey:f.bound.sectionKey,user:'[系统测试]定点两轮',sourceHtml,sourceSnapshotId:'[系统测试]slot-draft',qualityContract:f.bound});
      await finish(task.runId,'',f.blocks);
      const initialQuality=await readReportSection(env,user,task.id);assert.ok(reportSlotRepairPlan(initialQuality,JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json).qualityContract),JSON.stringify(initialQuality.quality));
      const child=await repairReportSection(env,user,task.id),childSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(child.id).first()).input_json);
      assert.equal(childSnapshot.generationPolicyVersion,JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json).generationPolicyVersion);assert.deepEqual(childSnapshot.qualitySlotPatch.targets.map(t=>t.slot),['returns','conditions']);
      await finish(child.runId,t=>t.slot==='returns'?'第一轮精简依据，待核实。':'险'.repeat(t.hardMax+1));
      const firstRead=await readReportSection(env,user,child.id);assert.equal(firstRead.quality.status,'blocked');assert.equal(firstRead.repair.canRetry,true);
      assert.equal(JSON.parse(firstRead.rawText).replacements[0].text,'第一轮精简依据，待核实。');assert.equal(JSON.parse(firstRead.structuredText).blocks[1].text,'第一轮精简依据，待核实。');
      const last=await repairReportSection(env,user,child.id),lastSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(last.id).first()).input_json);
      assert.equal(lastSnapshot.qualitySlotPatch.base,firstRead.structuredText);assert.deepEqual(lastSnapshot.qualitySlotPatch.targets.map(t=>t.slot),['conditions']);
      await finish(last.runId,'关键风险与实施条件仍待核实。');
      const final=await readReportSection(env,user,last.id),value=JSON.parse(final.structuredText);assert.equal(final.quality.status,'passed');assert.equal(final.quality.factsVerified,false);assert.equal(final.repair.round,2);assert.equal(final.graph[3].status,'awaiting_human_review');
      assert.deepEqual(JSON.parse(final.rawText).replacements,[{slot:'conditions',text:'关键风险与实施条件仍待核实。'}]);assert.equal(value.blocks[1].text,'第一轮精简依据，待核实。');
      for(const i of [0,2,3,4])assert.deepEqual(value.blocks[i],f.blocks[i]);for(const table of f.tables)assert.ok(final.text.includes(table));
      assert.equal((await readReportSection(env,user,task.id)).rawText,f.raw);assert.equal((await readReportSection(env,user,child.id)).rawText,firstRead.rawText);
      assert.equal(Number((await DB.prepare('SELECT output_tokens FROM agent_run_governance WHERE run_id=?').bind(task.runId).first()).output_tokens),60);
      await assert.rejects(repairReportSection(env,user,last.id),/不适合自动/);
    });
    await t.test('越权补丁拒绝后第二轮仍是定点协议，原候选/成功槽/原表不变且共享两轮预算',async()=>{
      const f=await serverSlotFixture(true),task=await startReportSection(env,user,{...input,sectionKey:f.bound.sectionKey,user:'[系统测试]越权补丁有界恢复',sourceHtml:f.tables.join(''),sourceSnapshotId:'[系统测试]slot-draft',qualityContract:f.bound});
      await finish(task.runId,'',f.blocks);
      const first=await repairReportSection(env,user,task.id),rejected={replacements:[{slot:'operating',text:'经营条件仍待核实。'},{slot:'conditions',text:'风险条件仍待核实。'},{slot:'drivers',text:'未授权的额外改写。'}]};
      await finish(first.runId,'',null,rejected);
      const read=await readReportSection(env,user,first.id);assert.equal(read.quality.status,'blocked');assert.equal(read.structuredText,f.raw);assert.equal(read.rawText,JSON.stringify(rejected));assert.equal(read.repair.canRetry,true);
      const last=await repairReportSection(env,user,first.id),snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(last.id).first()).input_json);
      assert.equal(snapshot.generationPolicyVersion,JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json).generationPolicyVersion);assert.equal(snapshot.qualityRepair.round,2);
      assert.deepEqual(snapshot.qualitySlotPatch.targets.map(t=>t.slot),['operating','conditions']);assert.equal(snapshot.qualitySlotPatch.base,f.raw);
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(last.runId).first()).payload_json);
      assert.match(payload.system,/paragraph-patch-v1/);assert.match(payload.query,/上轮补丁协议错误/);assert.doesNotMatch(payload.query,/待修复候选/);
      await finish(last.runId,'经营及实施条件仍待核实。');
      const final=await readReportSection(env,user,last.id),value=JSON.parse(final.structuredText);assert.equal(final.quality.status,'passed');assert.equal(final.quality.factsVerified,false);
      for(const i of [1,2,3,4])assert.deepEqual(value.blocks[i],f.blocks[i]);for(const table of f.tables)assert.ok(final.text.includes(table));
      assert.equal((await readReportSection(env,user,task.id)).rawText,f.raw);assert.equal((await readReportSection(env,user,first.id)).rawText,JSON.stringify(rejected));
      const rootSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json),governance=await DB.prepare('SELECT * FROM agent_run_governance WHERE run_id=?').bind(task.runId).first();assert.equal(Number(governance.budget_output_tokens),rootSnapshot.outputBudget.chainTokens);assert.equal(Number(governance.output_tokens),60);
      await assert.rejects(repairReportSection(env,user,last.id),/不适合自动/);
    });
    await t.test('实际入队的结构缺口仅追加绑定主题和定性表，拒绝越界后原块仍保留并受两轮预算约束',async()=>{
      const f=structureFixture(),task=await startReportSection(env,user,{...input,sectionKey:f.bound.sectionKey,user:'[系统测试]真实结构缺口追加；当前项目租金45，未核条件不得认定。',qualityContract:f.bound});
      // Production binds rule-role slots when enqueuing; fixture output must use
      // that real contract rather than the standalone fixture's generic slots.
      const boundInput=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(task.id).first()).input_json);
      f.blocks=f.blocks.map(b=>b.slot==='finding'?{...b,slot:C.outputSlots(boundInput.qualityContract)[0].slot}:b);f.raw=JSON.stringify({blocks:f.blocks});
      await finish(task.runId,'',f.blocks);
      const before=await readReportSection(env,user,task.id);assert.equal(before.quality.status,'blocked');assert.equal(before.repair.canTargetedRetry,true,JSON.stringify(before.quality));
      const [child,replay]=await Promise.all([repairReportSection(env,user,task.id),repairReportSection(env,user,task.id)]);assert.equal(child.id,replay.id);
      const snapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(child.id).first()).input_json);
      assert.equal(snapshot.qualityStructurePatch.version,'missing-structure-patch-v1');assert.equal(snapshot.qualitySlotPatch,undefined);assert.equal(snapshot.qualityStructurePatch.base,f.raw);
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(child.runId).first()).payload_json);assert.match(payload.system,/missing-structure-patch-v1/);assert.match(payload.query,/当前项目租金45/);
      const rejected={additions:[{id:'heading-1',text:'非法补丁不得覆盖原分析。'},{id:'table-0',table:{headers:['需求','产品'],rows:[['虚造数值','45元']]}}]};
      await finish(child.runId,'',null,rejected);
      const blocked=await readReportSection(env,user,child.id);assert.equal(blocked.structuredText,f.raw);assert.equal(blocked.rawText,JSON.stringify(rejected));assert.equal(blocked.quality.status,'blocked');assert.equal(blocked.repair.canTargetedRetry,true);
      const last=await repairReportSection(env,user,child.id),lastSnapshot=JSON.parse((await DB.prepare('SELECT input_json FROM report_section_tasks WHERE id=?').bind(last.id).first()).input_json);
      assert.equal(lastSnapshot.qualityStructurePatch.base,f.raw);assert.equal(lastSnapshot.qualityRepair.round,2);
      const additions=[{id:'heading-1',text:'已知资料支持按人口就业联系判断需求，但缺乏同口径统计，仍须核验。'},{id:'table-0',table:{headers:['需求分层','产品匹配条件'],rows:[['通勤需求','产品适配待核验'],['家庭需求','产品适配待核验']]}}];
      await finish(last.runId,'',null,{additions});
      const final=await readReportSection(env,user,last.id),blocks=JSON.parse(final.structuredText).blocks;
      assert.equal(final.quality.status,'passed');assert.equal(final.quality.factsVerified,false);assert.equal(final.repair.canRetry,false);assert.equal(final.graph[3].status,'awaiting_human_review');
      assert.deepEqual(blocks.filter(b=>f.blocks.some(old=>JSON.stringify(old)===JSON.stringify(b))),f.blocks);assert.deepEqual(C.headingOutline(final.text),f.bound.requiredHeadings);assert.equal(C.measure(final.text).tableCount,1);
      assert.equal((await readReportSection(env,user,task.id)).rawText,f.raw);assert.equal((await readReportSection(env,user,child.id)).rawText,JSON.stringify(rejected));
      const saved=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(projectId).first()).data);assert.equal(saved.chapters[0].sections[0].content,'正式原文保持不变');
      const governance=await DB.prepare('SELECT output_tokens FROM agent_run_governance WHERE run_id=?').bind(task.runId).first();assert.equal(Number(governance.output_tokens),60);
      await assert.rejects(repairReportSection(env,user,last.id),/不适合自动/);
    });
    await t.test('项目原始材料发生变化后拒绝旧计划继续自动修复',async()=>{
      data.kb=[{title:'新协议',content:'合同期限已变化'}];await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(data),projectId).run();
      await assert.rejects(repairReportSection(env,user,root.id),/源数据已变更/);
    });
    const fresh=await startReportSection(env,user,{...input,user:'新材料下独立初稿'});await finish(fresh.runId,'按照已确认协议执行。');
    assert.equal((await readReportSection(env,user,fresh.id)).graph[3].status,'awaiting_human_review');
    await assert.rejects(repairReportSection(env,user,fresh.id),/不适合自动/);
  }finally{await DB._close();}
});
