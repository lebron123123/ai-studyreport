const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const ensure=source.slice(source.indexOf('async function ensureReportTableTemplates('),source.indexOf('function sectionFormalTemplates('));
const resolveType=source.slice(source.indexOf('function reportTableProjectType('),source.indexOf('async function ensureReportTableTemplates('));
const generate=source.slice(source.indexOf('async function generateSection('),source.indexOf('async function reportDurableSectionCall('));
function fixture({loadFailure=false,invalidSet=false,missingModule=false,type='gaibao-housing'}={}){
 const section={t:'研究结论',content:'保留已接受正文',pendingRevision:{after:'保留候选'},executionTask:{id:'retained-task'}},chapter={name:'项目结论',sections:[section]},events=[];
 let loaded=false,released,started;
 const gate=new Promise(resolve=>released=resolve),reached=new Promise(resolve=>started=resolve),stop=Error('SUMMARY_BOUNDARY');
 const context={chapters:[chapter],calcType:type==='gaibao-housing'?'gaibao':type||'sale',calcResult:null,rptCtype:'',window:{ReportCompletionContract:{}},reportTableProjectType:()=>type,
  ReportArgument:{summaryContext(rows,c,s,{completionPlan}){events.push('summary');assert.equal(completionPlan.planId,'loaded-plan');throw stop;}},
  reportCompletionPlan(){events.push('plan');assert.equal(loaded,true);return {planId:'loaded-plan'};},
  reportDurableSectionCall(){events.push('paid-call');throw Error('must not call model');},
  provStart(){events.push('collector');return {};}
 };
 context.window.ReportArgument=context.ReportArgument;
 if(!missingModule)context.window.ReportTableTemplates={load:async()=>{events.push('template-start');started();await gate;if(loadFailure)throw Error('HTTP 503');loaded=true;events.push('template-ready');return invalidSet?null:{templates:[{id:'formal-table'}]};}};
 context.window.ReportLogicCore=context.ReportLogicCore={load:async()=>{events.push('logic');}};context.rlProjectType=()=> 'gaibao';
 vm.createContext(context);vm.runInContext(ensure+'\n'+generate,context);
 return {section,chapter,events,context,stop,reached,release:()=>released(),run:()=>context.generateSection(chapter,section)};
}
test('actual generation waits for templates before summary plan and source, preserving old draft',async()=>{
 const f=fixture(),before=structuredClone(f.section),pending=f.run();await f.reached;
 assert.deepEqual(f.events,['logic','template-start']);assert.deepEqual(f.section,before);f.release();
 await assert.rejects(pending,error=>error===f.stop);assert.deepEqual(f.events,['logic','template-start','template-ready','plan','summary']);assert.deepEqual(f.section,before);
});
test('template library failures stop actual generation before plan, summary, model or draft mutation',async()=>{
 for(const options of [{loadFailure:true},{invalidSet:true},{missingModule:true}]){
  const f=fixture(options),before=structuredClone(f.section),pending=f.run();f.release();
  await assert.rejects(pending,error=>error.code==='REPORT_TABLE_TEMPLATES_NOT_READY'&&/原正文与候选稿已保留/.test(error.message));
  assert.equal(f.events.includes('plan'),false);assert.equal(f.events.includes('summary'),false);assert.equal(f.events.includes('paid-call'),false);assert.deepEqual(f.section,before);
 }
});
test('unsupported project types retain the existing no-template path',async()=>{
 const f=fixture({type:'',missingModule:true});assert.equal(await f.context.ensureReportTableTemplates(),null);assert.deepEqual(f.events,[]);
});
test('actual type resolver cannot hide a missing template module for supported projects',async()=>{
 for(const type of ['gaibao','gaibao-housing','gaibao-commercial','rent']){
  const f=fixture({type,missingModule:true}),before=structuredClone(f.section);vm.runInContext(resolveType,f.context);
  await assert.rejects(f.run(),error=>error.code==='REPORT_TABLE_TEMPLATES_NOT_READY'&&/模块未加载/.test(error.message));
  assert.deepEqual(f.section,before);assert.deepEqual(f.events,['logic']);
 }
 const unsupported=fixture({type:'sale',missingModule:true});vm.runInContext(resolveType,unsupported.context);
 assert.equal(await unsupported.context.ensureReportTableTemplates(),null);assert.deepEqual(unsupported.events,[]);
});
