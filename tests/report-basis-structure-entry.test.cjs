require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),B=require('../report-business-structure.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const entry=part('function reportBusinessStructureBinding(','\nfunction reportBusinessHeadings(')+'\n'+part('function reportCompletionPlan(','\nasync function reportBasisMaterialItems(');
const key='项目总论 / 编制依据与编制说明';
const taxonomy=[{level:3,text:'编制依据'},{level:4,text:'法律法规层面'},{level:4,text:'政策文件层面'},...['市级','集团','国家'].map(text=>({level:5,text:text+'层面依据'})),{level:4,text:'技术标准与规范层面'},{level:4,text:'项目专项依据'}];
const gaps=['法律法规层面','技术标准与规范层面'].map(text=>'【待补：编制依据 / '+text+'尚未登记可引用依据文件】');
const oldBody='<h3>1.1.1 编制依据</h3><h4>法律法规层面</h4><p>【待补：本分类尚未登记可引用依据文件】</p><h4>政策文件层面</h4>'+['市级','集团','国家'].map((text,i)=>'<h5>'+text+'层面依据</h5><p>《登记文件'+i+'》</p>').join('')+'<h4>技术标准与规范层面</h4><p>【待补：本分类尚未登记可引用依据文件】</p><h4>项目专项依据</h4><p>《项目协议》</p>'+['市级','集团','国家'].map((text,i)=>'<h3>1.1.'+(i+2)+' '+text+'</h3><p>【待补：本分类尚未登记可引用依据文件】</p>').join('');
const ruleRows=['市级','集团','国家'].map((text,i)=>({chapter:'项目总论',section:'1.1编制依据与编制说明',subsection:'1.1.'+(i+2)+text,status:'published'}));
const items=Array.from({length:10},(_,i)=>({title:'登记文件'+i,ownerKey:key,status:i<4?'received':'cited',required:true,evidence:{sourceId:'fixture-'+i,sourceHash:String(i).repeat(64),locator:'测试原件位置'},verification:{},groups:i<6?taxonomy.slice(0,1).concat(taxonomy[2],taxonomy[3+i%3]):[taxonomy[0],taxonomy.at(-1)]}));
const refs=c=>JSON.stringify({blocks:c.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))});
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture({body=oldBody,saved=true,ordinary=false}={}){
 const chapter={name:ordinary?'运营方案':'项目总论',checked:true,sections:[{t:ordinary?'管理方案':'编制依据与编制说明',content:body,editedHtml:null,executionTask:{id:'original-task'},pendingRevision:null}]},chapters=[chapter],section=chapter.sections[0];
 const sectionKey=chapter.name+' / '+section.t;
 if(saved)section.completionContract=C.createPlan(chapters,{projectType:'gaibao',structures:{[sectionKey]:{version:B.VERSION,sourceHash:'91fab809',requiredHeadings:taxonomy.concat(['市级','集团','国家'].map(text=>({level:3,text})))}}}).sections[0];
 const workflow={reportVersions:[]},box={chapters,projectWorkflow:workflow,project:{name:'[系统测试]依据结构'},calcParams:{},kbEntries:[],ReportBusinessStructure:B,ReportCompletionContract:C,
  ReportLogicCore:{match:()=>ordinary?[]:ruleRows,current:()=>({data:{}})},reportCompletionFacts:()=>[],reportGenerationRulesIdentity:()=>({version:'fixture'}),reportFinancialIdentity:()=>({}),rlProjectType:()=> 'gaibao',rlProjectText:()=>'',rlBusinessScenario:()=> 'housing_conversion',
  reportCompletionEntries:override=>chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:override?.sectionKey===c.name+' / '+s.t?override.html:s.editedHtml||s.content||''})))};
 box.window=box;vm.createContext(box);vm.runInContext(entry,box);
 return {box,chapters,section,workflow,key:sectionKey,plan:override=>box.reportCompletionPlan(override)};
}
async function canonical(){
 const chapters=[{name:'项目总论',sections:[{t:'编制依据与编制说明'}]}],binding=B.resolve({chapterName:'项目总论',sectionTitle:'编制依据与编制说明',projectType:'gaibao',businessScenario:'housing_conversion',currentSource:oldBody,rules:ruleRows});
 const raw=C.createPlan(chapters,{projectType:'gaibao',structures:{[key]:binding}}).sections[0];
 const c=await C.bindBasisCatalog(raw,{items},'basis-entry-fixture');return {text:C.decodeStructured(refs(c),c).text,contract:c};
}
test('real projected plan retains eight declared categories behind six rendered headings across JSON restore',async()=>{
 const h=fixture(),out=await canonical(),before=JSON.stringify({chapters:h.chapters,workflow:h.workflow});
 assert.equal(C.headingOutline(out.text).length,6);assert.equal(h.section.completionContract.requiredHeadings.length,11);
 const plan=h.plan({sectionKey:key,html:out.text}),c=await C.bindBasisCatalog(plan.sections[0],{items},'projected-entry-fixture');
 assert.deepEqual(plain(c.requiredHeadings),taxonomy);assert.equal(JSON.stringify({chapters:h.chapters,workflow:h.workflow}),before);
 assert.deepEqual(C.inspect(out.text,c).issues.filter(x=>x.severity==='error'),[]);
 for(const gap of gaps)assert.ok(out.text.includes(gap));
 for(const item of items)assert.equal(out.text.split('《'+item.title+'》').length-1,1);
 // Like the real Tax workflow, retain the accepted pre-migration HTML. A
 // heading-only contract cannot invent evidence that a published root moved.
 h.workflow.reportVersions.push({id:'accepted-original',status:'accepted',accepted:true,chapters:plain(h.chapters)});
 h.section.content=out.text;h.section.completionContract=plain(c);h.box.chapters=plain(h.chapters);
 const restored=h.plan().sections[0];
 assert.deepEqual(plain(restored.requiredHeadings),taxonomy);assert.deepEqual(plain(restored.structureBinding),plain(c.structureBinding));
 assert.equal(restored.planId,c.planId);assert.equal(h.box.chapters[0].sections[0].content,out.text);
});
test('canonical missing categories cannot disappear by removing their notices, changing file text or adding prose',async()=>{
 const h=fixture(),out=await canonical(),c=await C.bindBasisCatalog(h.plan({sectionKey:key,html:out.text}).sections[0],{items},'negative-entry-fixture');
 for(const changed of [out.text.replace(gaps[0],''),out.text.replace('《登记文件0》','《另一文件》'),out.text+'\n\n全部政策已确认适用。'])assert.ok(C.inspect(changed,c).issues.some(x=>x.code==='basis-catalog-content'&&x.severity==='error'));
 assert.equal(h.section.content,oldBody);assert.equal(h.section.executionTask.id,'original-task');
});
test('pending, QA and override contracts cannot add taxonomy or change plan identity',async()=>{
 const h=fixture(),out=await canonical(),before=h.plan({sectionKey:key,html:out.text});
 const untrusted={...plain(h.section.completionContract),requiredHeadings:[{level:3,text:'候选伪分类'}]};
 h.section.pendingRevision={after:'<h3>候选伪分类</h3>',completionContract:untrusted};h.section.qa={currentContract:untrusted};
 const after=h.plan({sectionKey:key,html:out.text,completionContract:untrusted});
 assert.equal(after.planId,before.planId);assert.deepEqual(plain(after.sections[0].requiredHeadings),taxonomy);
});
test('without an adopted contract the canonical visible outline is not invented into eight categories',async()=>{
 const out=await canonical(),h=fixture({body:out.text,saved:false});h.box.ReportLogicCore.match=()=>[];
 h.section.pendingRevision={completionContract:out.contract};h.section.qa={currentContract:out.contract};
 assert.equal(h.plan().sections[0].requiredHeadings.length,6);
 const empty=fixture({body:'',saved:false});empty.box.ReportLogicCore.match=()=>[];empty.section.completionContract=out.contract;
 assert.equal(empty.plan().sections[0].requiredHeadings,undefined);
});
test('wrong adopted section, project type and basis identity fail closed without touching original state',async()=>{
 const out=await canonical();
 for(const change of [c=>c.sectionKey='其他章 / 编制依据',c=>c.projectType='rent',c=>c.requirements.basis=false,c=>c.structureBinding.sourceHash='!invalid',c=>c.requiredHeadings[0].level=6]){
  const h=fixture();change(h.section.completionContract);const before=JSON.stringify(h.chapters);
  assert.throws(()=>h.plan({sectionKey:key,html:out.text}));assert.equal(JSON.stringify(h.chapters),before);
 }
});
test('legacy contract without a structure binding remains compatible but cannot supply absent headings',async()=>{
 const out=await canonical(),h=fixture({body:out.text});delete h.section.completionContract.structureBinding;h.box.ReportLogicCore.match=()=>[];
 assert.equal(h.plan().sections[0].requiredHeadings.length,6);
});
test('original adopted body is migration evidence, not a false same-name-root deletion rule',async()=>{
 const body=oldBody.replace('<h3>1.1.2 市级</h3><p>【待补：本分类尚未登记可引用依据文件】</p>','<h3>1.1.2 市级</h3><p>《独立市级记录》</p>');
 const out=await canonical(),h=fixture({body}),before=JSON.stringify(h.chapters);
 const result=h.plan({sectionKey:key,html:out.text+'\n\n### 市级\n\n《独立市级记录》'}).sections[0];
 assert.ok(result.requiredHeadings.some(x=>x.level===3&&x.text==='市级'));assert.ok(!result.requiredHeadings.some(x=>x.level===3&&['集团','国家'].includes(x.text)));
 assert.equal(JSON.stringify(h.chapters),before);
});

test('ambiguous duplicate roots with substantive content fail closed instead of silently merging records',async()=>{
 const out=await canonical(),h=fixture({body:oldBody+'<h3>市级</h3><p>《独立市级记录》</p>'}),before=JSON.stringify(h.chapters);
 assert.throws(()=>h.plan({sectionKey:key,html:out.text+'\n\n### 市级\n\n《独立市级记录》'}),/业务标题顺序冲突/);
 assert.equal(JSON.stringify(h.chapters),before);
});
test('accepted divergent heading paths are not forced over a new current tree',()=>{
 const h=fixture({body:'### 新依据类别\n\n《实际新记录》'});h.box.ReportLogicCore.match=()=>[];
 assert.deepEqual(plain(h.plan().sections[0].requiredHeadings),[{level:3,text:'新依据类别'}]);
});
test('ordinary sections do not inherit basis contract headings or validate unrelated old metadata',()=>{
 const h=fixture({ordinary:true,body:'### 管理职责\n\n原有管理分析。'});h.section.completionContract={invalid:true};
 const before=JSON.stringify(h.chapters),c=h.plan().sections[0];assert.deepEqual(plain(c.requiredHeadings),[{level:3,text:'管理职责'}]);assert.equal(JSON.stringify(h.chapters),before);
});
