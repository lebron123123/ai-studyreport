require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../report-cover-metadata.js');
const aiDesc='【参数说明】本报告关键测算参数由系统依据历史项目类比自动推荐并计算，经测试确认。';
function capture(project={},options={}){return M.captureContext(project,{calcType:'gaibao',calcParams:{loan:384},...options});}
function oldLoan(id='old-4',loan=13892){return {id,version:4,calcType:'gaibao',params:{loan,secretSentinel:'MUST_NOT_EXPORT'}};}
function rentInvestment(value=13892){return {totalInvestment:value,invest:value,investEstimate:{summary:{buildInvestment:value,landCostTotal:0,preConstructionCostTotal:0,constructionCostTotal:value,indirectCostTotal:0,contingency:0}}};}
function field(result,key){return result.fields.find(f=>f.key===key);}

test('legacy registered estimates remain estimates, preserve units and never mutate project',()=>{
  for(const scale of [5240,'5,240','5240万元','约1亿元',0]){
    const project={name:'[系统测试]',scale},before=JSON.stringify(project),result=M.resolve(project,capture(project));
    assert.equal(JSON.stringify(project),before);assert.equal(field(result,'investment').label,'登记估算投资');
    assert.equal(field(result,'investment').value,typeof scale==='number'||scale==='5,240'?scale+'万元':scale);
    assert.equal(result.diagnostics.length,0);
  }
});
test('loan equality alone and AI explanation alone never invalidate registered estimate',()=>{
  for(const project of [{scale:13892},{scale:15000,desc:aiDesc},{scale:13892,desc:'人工登记说明'}]){
    const result=M.resolve(project,capture(project,{calcParams:{loan:13892}}));
    assert.equal(field(result,'investment').status,'registered-estimate');
  }
});
test('exact historical loan overlap plus AI trace and no independent evidence becomes pending, not a false total',()=>{
  const project={scale:13892,desc:aiDesc},before=JSON.stringify(project);
  const context=capture(project,{workflow:{currentCalcSnapshotId:'new-5',calcSnapshots:[oldLoan(),{id:'new-5',version:5,calcType:'gaibao',params:{loan:384}}]}});
  const result=M.resolve(project,context);
  assert.equal(field(result,'investment').status,'unverified-loan-overlap');
  assert.doesNotMatch(result.lines.join('\n'),/13892|384/);assert.equal(JSON.stringify(project),before);
  assert.deepEqual(result.diagnostics[0].matchingSnapshotIds,['old-4']);
  assert.equal(result.diagnostics[0].registeredValue,13892);
});
test('different amounts, invalid values and non-gaibao loans do not trigger loan-warning',()=>{
  for(const [scale,calcType,loan] of [[13892,'gaibao',13892.01],[13892,'rent',13892],['待核','gaibao',13892],['','gaibao',0]]){
    const p={scale,desc:aiDesc},result=M.resolve(p,capture(p,{calcType,calcParams:{loan}}));
    assert.ok(!result.diagnostics.some(x=>x.code==='legacy-ai-loan-overlap'));
  }
});
test('independently matching historical construction estimate preserves scale; raw field names alone are not proof',()=>{
  const project={scale:13892,desc:aiDesc};
  for(const valid of [true,false]){
    const independent={id:'rent-2',version:2,calcType:'rent',params:valid?rentInvestment():{totalInvestment:13892,invest:13892}};
    const context=capture(project,{workflow:{calcSnapshots:[oldLoan(),independent]}}),result=M.resolve(project,context);
    assert.equal(field(result,'investment').status,valid?'registered-estimate':'unverified-loan-overlap');
    assert.equal(context.matchingCalculations.length,valid?2:1);
  }
});
test('loan or engineering amount does not fill missing scale or become construction/all-in investment',()=>{
  const project={},result=M.resolve(project,capture(project,{calcParams:{loan:384,constructionCost:480,totalInvestment:545.21}}));
  assert.equal(field(result,'investment').status,'unverified');assert.doesNotMatch(result.lines.join('\n'),/384|480|545/);
  assert.equal(field(result,'constructionInvestment'),undefined);
  assert.equal(field(M.resolve({},null),'investment'),undefined,'ordinary project without scale/calculation keeps its old cover default');
});
test('gaibao independent estimate breakdown is recognized but copied investment aliases and broken totals are not',()=>{
  const project={scale:13892,desc:aiDesc};
  for(const mode of ['full','aliases','broken']){
    const params=mode==='aliases'?{totalInvestment:13892,invest:13892}:rentInvestment();params.loan=13892;
    if(mode==='broken')params.investEstimate.summary.landCostTotal=1;
    const result=M.resolve(project,capture(project,{calcParams:params}));
    assert.equal(field(result,'investment').status,mode==='full'?'registered-estimate':'unverified-loan-overlap');
    assert.equal(!!field(result,'constructionInvestment'),mode==='full');
  }
});
test('current verified construction estimate is separately labelled, conflicting aliases are not exported',()=>{
  for(const valid of [true,false]){
    const params=rentInvestment(50928.27);if(!valid)params.invest=50000;
    const result=M.resolve({},capture({},{calcType:'rent',calcParams:params}));
    if(valid){assert.match(field(result,'constructionInvestment').value,/50928.27万元（不等于批准总投资）/);assert.equal(field(result,'investment'),undefined);}
    else{assert.equal(field(result,'constructionInvestment'),undefined);assert.equal(field(result,'investment').status,'unverified');}
  }
});
test('zero is valid construction investment; incomplete breakdown cannot assert construction evidence',()=>{
  const zero=M.resolve({},capture({},{calcType:'rent',calcParams:rentInvestment(0)}));
  assert.equal(field(zero,'constructionInvestment').value,'0万元（不等于批准总投资）');
  const incomplete=rentInvestment();delete incomplete.investEstimate.summary.contingency;
  const p={scale:13892,desc:aiDesc};incomplete.loan=13892;
  const result=M.resolve(p,capture(p,{calcParams:incomplete}));
  assert.equal(field(result,'investment').status,'unverified-loan-overlap');assert.equal(field(result,'constructionInvestment'),undefined);
});
test('historical export cannot borrow current calculation, loan history or approve legacy scale',()=>{
  const project={scale:13892,desc:aiDesc};
  const context=capture(project,{historical:true,calcType:'rent',calcParams:rentInvestment(50928.27),workflow:{calcSnapshots:[oldLoan()]}});
  assert.equal(context.mode,'historical');assert.equal(context.currentCalculation,null);assert.deepEqual(context.matchingCalculations,[]);
  const result=M.resolve(project,context);assert.equal(field(result,'investment').status,'registered-estimate');assert.equal(field(result,'constructionInvestment'),undefined);
});
test('captured cover evidence is scalar-only; no report history, source text or parameter bulk is copied',()=>{
  const project={scale:13892,desc:aiDesc},workflow={calcSnapshots:[oldLoan()],reportVersions:[{body:'SECRET_BODY'}]};
  const context=capture(project,{workflow,calcParams:{loan:384,material:'SECRET_MATERIAL'}}),json=JSON.stringify(context);
  assert.doesNotMatch(json,/MUST_NOT_EXPORT|SECRET_BODY|SECRET_MATERIAL|reportVersions/);assert.ok(json.length<700,json.length);
  assert.equal(workflow.calcSnapshots[0].params.secretSentinel,'MUST_NOT_EXPORT');
});
test('multi-site cover only uses strictly confirmed points, without geocode explanations or unconfirmed names',()=>{
  const sites=Array.from({length:6},(_,i)=>({name:'已确认点位'+(i+1),address:'（按完整地址解析，精度门址）',confirmed:true}));
  sites.push({name:'未确认地址',confirmed:false},{name:'字符串非确认',confirmed:'true'});
  const result=M.resolve({location:'旧单地址',analysisSites:sites},null),location=field(result,'location');
  assert.equal(location.label,'已确认项目点位');for(let i=1;i<=6;i++)assert.match(location.value,new RegExp('已确认点位'+i));
  assert.doesNotMatch(location.value,/未确认地址|字符串非确认|精度|旧单地址/);
  assert.equal(field(M.resolve({location:'正常单地址'},null),'location').value,'正常单地址');
  assert.match(field(M.resolve({analysisSites:[{name:'未确认1'},{name:'未确认2'}]},null),'location').value,/【待补：/);
});
test('internal generation rule labels never become business industry; normal industry remains',()=>{
  for(const businessScenario of ['housing_conversion','commercial_renovation']){
    const result=M.resolve({industry:'改造项目双场景可研逐小节生成逻辑',businessScenario},null);
    assert.doesNotMatch(field(result,'industry').value,/生成逻辑/);assert.match(field(result,'industry').value,/改造/);
  }
  assert.equal(field(M.resolve({industry:'保障性住房'},null),'industry').value,'保障性住房');
});
test('browser module exposes only namespaced pure API',()=>{
  const context={};context.self=context;vm.runInNewContext(fs.readFileSync(require.resolve('../report-cover-metadata.js'),'utf8'),context);
  assert.deepEqual(Object.keys(context).sort(),['ReportCoverMetadata','self']);assert.equal(context.ReportCoverMetadata.version,M.version);
  assert.equal(context.ReportCoverMetadata.resolve({scale:100}).fields[0].label,'登记估算投资');
});

const exportSource=fs.readFileSync(require.resolve('../export.js'),'utf8');
function exportFixture(){
  const context={project:{scale:13892,desc:aiDesc},projectWorkflow:{calcSnapshots:[oldLoan()]},chapters:[],calcResult:null,calcParams:{loan:384},rptCtype:'',calcType:'gaibao',getDocNo:()=>'',document:{querySelectorAll:()=>[]},ReportCoverMetadata:M};
  context.window=context;vm.createContext(context);vm.runInContext(exportSource,context);return context;
}
test('real export payload passes lightweight current evidence and keeps historical exports financially separate',()=>{
  const c=exportFixture(),before=JSON.stringify(c.projectWorkflow),p=c.buildExportPayload({stateOnly:true});
  assert.equal(p.coverContext.currentCalculation.calcType,'gaibao');assert.equal(p.coverContext.matchingCalculations[0].id,'old-4');
  const h=c.buildExportPayload({version:{version:9,chapters:[]}});assert.equal(h.coverContext.mode,'historical');assert.equal(h.coverContext.currentCalculation,null);
  assert.equal(JSON.stringify(c.projectWorkflow),before);assert.equal(c.project.scale,13892);
});
test('real lazy-loader includes cover module even if old builder exists, and can retry a failed load',async()=>{
  const c=exportFixture();delete c.ReportCoverMetadata;c.docx={};c.buildDocxDocument=()=>{};
  const urls=[];let fail=true;c.loadScript=async url=>{urls.push(url);if(/report-cover-metadata/.test(url)){if(fail)throw Error('test unavailable');c.ReportCoverMetadata=M;}};
  await assert.rejects(c.ensureDocxLib(),/test unavailable/);fail=false;await c.ensureDocxLib();
  assert.equal(urls.filter(s=>s.startsWith('report-cover-metadata.js?v=20261013.cover1')).length,2);
  const count=urls.length;await c.ensureDocxLib();assert.equal(urls.length,count);
});
test('real DOCX package contains corrected cover, red full pending marker, and unchanged body numbers/table',async()=>{
  const D=require('../docx.umd.js'),build=require('../docxgen.js'),Zip=require('../local-server/node_modules/jszip');
  const project={name:'[系统测试]封面',scale:13892,desc:aiDesc,industry:'改造项目双场景可研逐小节生成逻辑',businessScenario:'housing_conversion',analysisSites:Array.from({length:6},(_,i)=>({name:'已确认点位'+(i+1),confirmed:true}))};
  const payload={project,coverContext:capture(project,{workflow:{calcSnapshots:[oldLoan()]}}),chapters:[{cn:'一',name:'项目总论',sections:[{title:'项目规模',blocks:[{type:'p',text:'工程费用480万元，不等于批准总投资。'},{type:'table',rows:[['指标','数值'],['工程费用','480']]}]}]}]};
  const before=JSON.stringify(payload),buffer=await D.Packer.toBuffer(build(D,payload)),zip=await Zip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  assert.equal(JSON.stringify(payload),before);assert.doesNotMatch(xml,/13892|逐小节生成逻辑/);for(let i=1;i<=6;i++)assert.match(xml,new RegExp('已确认点位'+i));
  assert.match(xml,/工程费用480万元，不等于批准总投资。/);assert.match(xml,/<w:tbl>/);
  const pending=[...xml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(m=>m[0]).find(r=>r.includes('【待补：核实投资规模'));
  assert.ok(pending);assert.match(pending,/w:color w:val="C62828"/);assert.match(pending,/未作为总投资】/);
  assert.equal(build.templateVersion,'report-docx-20261013-cover-metadata-v7');
  assert.match(await zip.file('docProps/custom.xml').async('string'),new RegExp(build.templateVersion));
});
