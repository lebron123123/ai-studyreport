const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),B=require('../report-business-structure.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const bindingSource=source.slice(source.indexOf('function reportBusinessStructureBinding('),source.indexOf('\nfunction reportBusinessHeadings('));
const planSource=source.slice(source.indexOf('function reportCompletionPlan('),source.indexOf('\nasync function reportBasisMaterialItems('));
const heads=['改造设计原则','空间与功能调整','公共区域改造','施工责任','改造效果预测','集中改造实施方案','公共区域及配套改造方案','改造效果表达'];
const body=labels=>labels.map(t=>'<h3>'+t+'</h3><p>'+t+'的完整原分析，应核对工程方案及项目资料，不把尚未确认事项当成事实。</p>').join('');
const fixed=[...heads.slice(0,4),...heads.slice(5),heads[4]];
function fixture({otherConflict=false}={}){
 const chapter={name:'改造运营方案',sections:[{t:'改造实施计划及效果',content:'old-plain',editedHtml:body(heads),executionTask:{id:'original-task'}}]},chapters=[chapter];
 if(otherConflict)chapters.push({name:'其他章',sections:[{t:'其他节',content:body(['末类','首类'])}]});
 const workflow={reportVersions:[{id:'accepted-history',status:'accepted',accepted:true,chapters:[{name:chapter.name,sections:[{t:chapter.sections[0].t,content:body(heads.slice(0,5))}]}]}]};
 const rules=(name,title)=>name===chapter.name?heads.slice(5).concat(heads[4]).map((t,i)=>({chapter:name,section:'6.1'+title,subsection:'6.1.'+(i+1)+' '+t,status:'published',projectType:'gaibao'})):['首类','末类'].map((t,i)=>({chapter:name,section:'1.1'+title,subsection:'1.1.'+(i+1)+' '+t,status:'published',projectType:'gaibao'}));
 const box=vm.createContext({chapters,projectWorkflow:workflow,project:{name:'测试副本'},calcParams:{},kbEntries:[],ReportBusinessStructure:B,ReportCompletionContract:C,
  window:{ReportBusinessStructure:B,ReportLogicCore:{match:(_type,name,title)=>rules(name,title),current:()=>({data:{}})}},
  reportCompletionFacts:()=>[],reportGenerationRulesIdentity:()=>({version:'exact'}),reportFinancialIdentity:()=>({}),rlProjectType:()=> 'gaibao',rlProjectText:()=>'',rlBusinessScenario:()=> 'housing_conversion',
  reportCompletionEntries:override=>chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:override?.sectionKey===c.name+' / '+s.t?override.html:s.editedHtml||s.content||''})))});
 vm.runInContext(bindingSource+'\n'+planSource,box);
 const call=override=>vm.runInContext('reportCompletionPlan',box)(override);
 return {box,chapters,workflow,section:chapter.sections[0],call,key:chapter.name+' / '+chapter.sections[0].t};
}
test('real completion plan checks corrected order using a virtual section, preserving every live and accepted-history byte',()=>{
 const h=fixture(),before=JSON.stringify({chapters:h.chapters,workflow:h.workflow});
 assert.throws(()=>h.call(),/业务标题顺序冲突/);
 const result=h.call({sectionKey:h.key,html:body(fixed)});
 assert.deepEqual(JSON.parse(JSON.stringify(result.sections[0].requiredHeadings)).map(x=>x.text),fixed);
 assert.equal(JSON.stringify({chapters:h.chapters,workflow:h.workflow}),before);
 assert.equal(h.section.editedHtml,body(heads));
});
test('projected completion plan still rejects bad candidate order and conflicts in an untouched section',()=>{
 const h=fixture();assert.throws(()=>h.call({sectionKey:h.key,html:body(heads)}),/业务标题顺序冲突/);
 const other=fixture({otherConflict:true}),before=JSON.stringify(other.chapters);
 assert.throws(()=>other.call({sectionKey:other.key,html:body(fixed)}),/业务标题顺序冲突/);
 assert.equal(JSON.stringify(other.chapters),before);
});
test('omitting a published business class does not remove its requirement from the projected contract',()=>{
 const h=fixture(),candidate=body(fixed.filter(x=>x!=='公共区域及配套改造方案')),plan=h.call({sectionKey:h.key,html:candidate}),contract=plan.sections[0];
 assert.ok(contract.requiredHeadings.some(x=>x.text==='公共区域及配套改造方案'));
 assert.ok(C.inspect(candidate,contract).issues.some(x=>x.severity==='error'&&/heading/.test(x.code)));
});
module.exports={fixture,body,heads,fixed};
