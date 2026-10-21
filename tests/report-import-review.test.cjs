require('../scripts/windows-browser-lockout-guard.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Review=require('../report-import-review.js');
const paragraph=(id,text,extra={})=>({id,type:'paragraph',text,html:'<p data-source-block="'+id+'">'+text+'</p>',...extra});
function draft(){return {owner:'alice',id:'draft-a',revision:1,confirmed:true,outline:[{blockId:'h1',title:'概况',level:1},{blockId:'h2',title:'子节',level:2},{blockId:'h3',title:'下一章',level:1}],protectedBlockIds:['p1'],files:[{id:'file-a',role:'main',hash:'source-sha',parsed:{blocks:[paragraph('h1','概况',{headingLevel:1}),paragraph('p1','租金为 100元，面积 20㎡。'),paragraph('h2','子节',{headingLevel:2}),paragraph('p2','方案需要说明。'),{id:'t1',type:'table',text:'测算 50万元',html:'<table><tr><td>50万元</td></tr></table>'},paragraph('rich','红色提示',{html:'<p><span style="color:#ff0000">红色提示</span></p>'}),paragraph('image','配图',{html:'<p>配图<img src="data:image/png;base64,abc"></p>'}),paragraph('h3','下一章',{headingLevel:1}),paragraph('other','其他 999元。')]}}]};}
function run(d,action,id='request-a'){return {...d,reviewState:Review.apply(d,action,{requestId:id,now:100}),revision:d.revision+1};}
const begin=(blockId='p1',mode='append',scope='paragraph')=>({type:'begin',blockId,mode,scope,instruction:'说明实施安排'});
const complete=(text='补充实施安排。',blockId='p1',requestId='request-a')=>({type:'complete',requestId,changes:[{blockId,text}]});

test('legacy draft has no overlay; protected paragraph permits append and preserves source',()=>{
 const original=draft(),snapshot=structuredClone(original);let d=run(original,begin());
 assert.equal(d.reviewState.requests[0].context.blocks[0].protected,true);
 d=run(d,complete());assert.equal(d.reviewState.requests[0].changes[0].beforeText,'');assert.deepEqual(Review.project(d).find(b=>b.blockId==='p1').appendTexts,[]);
 d=run(d,{type:'accept',candidateId:'request-a'});const block=Review.project(d).find(b=>b.blockId==='p1');assert.equal(block.text,'租金为 100元，面积 20㎡。');assert.deepEqual(block.appendTexts,[{candidateId:'request-a',text:'补充实施安排。'}]);assert.deepEqual(original,snapshot);assert.deepEqual(d.files,original.files);
});
test('section follows actual source order through children and stops at next peer heading',()=>{
 const d=draft();d.outline.reverse();const context=Review.plan(d,begin('h1','append','section'));
 assert.deepEqual(context.blockIds,['p1','p2','rich']);assert.deepEqual(context.scopeBlockIds,['h1','p1','h2','p2','t1','rich','image']);assert(context.allowedNumbers.includes('50万元'));assert(!context.allowedNumbers.includes('999元'));assert(context.skippedBlocks.some(b=>b.blockId==='t1'));
 assert.throws(()=>Review.plan(d,begin('p1','append','section')),e=>e.code==='REVIEW_SCOPE');
});
test('rewrite refuses protected, formatted, heading, table, image and tracked paragraphs',()=>{
 const d=draft();for(const id of ['p1','rich','h1','t1','image'])assert.throws(()=>Review.plan(d,begin(id,'rewrite')),e=>e.code==='REVIEW_SCOPE');
 d.files[0].parsed.blocks.push(paragraph('track','原始修订',{html:'<p><del>原始</del><ins>修订</ins></p>'}));assert.throws(()=>Review.plan(d,begin('track','rewrite')),/复杂/);
 const context=Review.plan(d,begin('h1','rewrite','section'));assert.deepEqual(context.blockIds,['p2']);
});
test('scope and addition limits reject explicitly without truncation or state mutation',()=>{
 const d=draft(),blocks=d.files[0].parsed.blocks;blocks.splice(1,0,...Array.from({length:11},(_,i)=>paragraph('extra'+i,'普通正文')));assert.throws(()=>Review.plan(d,begin('h1','append','section')),e=>e.code==='REVIEW_LIMIT');
 const big=draft();big.files[0].parsed.blocks[1]=paragraph('p1','文'.repeat(12001));assert.throws(()=>Review.plan(big,begin()),e=>e.code==='REVIEW_LIMIT');
 const running=run(draft(),begin()),snapshot=structuredClone(running);assert.throws(()=>run(running,complete('字'.repeat(1501))),e=>e.code==='REVIEW_LIMIT');assert.deepEqual(running,snapshot);
});
test('append allows only source numbers in scope and rejects reference or invented digits including Chinese/fullwidth',()=>{
 const d=run(draft(),begin());for(const text of ['增加 999元。','增加 100万元。','增加 １２３元。','增加三百户。'])assert.throws(()=>run(d,complete(text)),e=>e.code==='REVIEW_NUMBERS');
 assert.equal(run(d,complete('租金按 100元说明。')).reviewState.requests[0].status,'ready');
});
test('Chinese prose is not misclassified as numbers, while business counts and compound units stay guarded',()=>{
 const d=run(draft(),begin('p2'));assert.equal(run(d,complete('进一步完善运营管理和统一流程。','p2')).reviewState.requests[0].status,'ready');
 assert.deepEqual(Review.numbers('进一步、统一、一般、充分'),[]);assert.deepEqual(Review.numbers('八十五% 八成 九折 第三章 一、 42.44元/㎡·月'),['八十五%','八成','九折','第三章','一','42.44元/㎡·月']);
 const base=draft();base.protectedBlockIds=[];base.files[0].parsed.blocks[1]=paragraph('p1','租金 42.44元/㎡·月。');const running=run(base,begin('p1','rewrite'));
 assert.throws(()=>run(running,complete('租金按 42.44元/年核算。')),e=>e.code==='REVIEW_NUMBERS');
 const numeric=draft();numeric.files[0].parsed.blocks[3]=paragraph('p2','规模为 100。');const magnitude=run(numeric,begin('p2'));assert.throws(()=>run(magnitude,complete('规模为 100万。','p2')),e=>e.code==='REVIEW_NUMBERS');assert.deepEqual(Review.numbers('用量 100m³，金额五万元，数量 100万'),['100m³','五万元','100万']);
});
test('section context excludes original image data and keeps read-only figure and table positions',()=>{
 const d=draft();d.files[0].parsed.blocks.find(b=>b.id==='image').html='<p><img src="data:image/png;base64,'+'X'.repeat(2000000)+'"></p>';
 const context=Review.plan(d,begin('h1','append','section'));assert.equal(JSON.stringify(context).includes('base64'),false);assert(JSON.stringify(context).length<10000);assert(context.skippedBlocks.some(b=>b.blockId==='image'));assert(context.skippedBlocks.some(b=>b.blockId==='t1'));
});
test('rewrite preserves numeric token sequence, decimal precision, signs and units',()=>{
 const base=draft();base.protectedBlockIds=[];base.files[0].parsed.blocks[1]=paragraph('p1','租金 -100.00元，面积 20㎡，比例 5%。');const d=run(base,begin('p1','rewrite'));
 for(const text of ['租金 100.00元，面积 20㎡，比例 5%。','租金 -100元，面积 20㎡，比例 5%。','租金 -100.00元，面积 20亩，比例 5%。','租金 -100.00元，比例 5%。'])assert.throws(()=>run(d,complete(text)),e=>e.code==='REVIEW_NUMBERS');
 const ready=run(d,complete('核定租金 -100.00元，面积 20㎡，比例 5%。'));assert.equal(ready.reviewState.requests[0].changes[0].beforeText,base.files[0].parsed.blocks[1].text);
});
test('unknown, repeated, empty and oversize changes reject the complete candidate atomically',()=>{
 const running=run(draft(),begin()),before=structuredClone(running);
 for(const changes of [[{blockId:'outside',text:'文字'}],[{blockId:'p1',text:''}],[{blockId:'p1',text:'文字'},{blockId:'p1',text:'重复'}],[]])assert.throws(()=>run(running,{type:'complete',requestId:'request-a',changes}));
 assert.deepEqual(running,before);
});
test('changed identity, source, protection, outline or working overlay invalidates late candidates',()=>{
 const running=run(draft(),begin());for(const mutate of [d=>d.owner='bob',d=>d.id='other',d=>d.files[0].id='other',d=>d.files[0].hash='other',d=>d.files[0].parsed.blocks[1].text='变动原文',d=>d.protectedBlockIds=[],d=>d.outline[0].title='改名']){const changed=structuredClone(running);mutate(changed);assert.throws(()=>run(changed,complete()),e=>e.code==='REVIEW_STALE');}
 const ready=run(running,complete());ready.protectedBlockIds=[];assert.throws(()=>run(ready,{type:'accept',candidateId:'request-a'}),e=>e.code==='REVIEW_STALE');
});
test('single pending includes ready state; fail and cancel keep history and reject late responses',()=>{
 let d=run(draft(),begin());assert.throws(()=>run(d,begin(),'b'),e=>e.code==='REVIEW_PENDING');d=run(d,{type:'fail',requestId:'request-a',message:'请求失败'});assert.throws(()=>run(d,complete()),e=>e.code==='REVIEW_STATE');
 d=run(d,begin(),'request-b');d=run(d,{type:'cancel',requestId:'request-b'});d=run(d,begin(),'request-c');d=run(d,complete('新的建议。','p1','request-c'));assert.throws(()=>run(d,begin(),'request-d'),e=>e.code==='REVIEW_PENDING');
 d=run(d,{type:'reject',candidateId:'request-c'});assert.deepEqual(d.reviewState.requests.map(r=>r.status),['failed','cancelled','rejected']);assert.equal(Review.project(d).find(b=>b.blockId==='p1').appendTexts.length,0);
});
test('accept and latest undo survive JSON round trip while preserving earlier accepted changes',()=>{
 let d=draft();d.protectedBlockIds=[];d=run(d,begin('p2','rewrite'));d=run(d,complete('方案需要补充说明。','p2'));d=run(d,{type:'accept',candidateId:'request-a'});
 d=run(d,begin('p2'),'request-b');d=run(d,complete('补充实施安排。','p2','request-b'));d=run(d,{type:'accept',candidateId:'request-b'});d=JSON.parse(JSON.stringify(d));assert.equal(Review.project(d).find(b=>b.blockId==='p2').appendTexts.length,1);
 d=run(d,{type:'undo'});let block=Review.project(d).find(b=>b.blockId==='p2');assert.equal(block.text,'方案需要补充说明。');assert.equal(block.appendTexts.length,0);d=run(d,{type:'undo'});assert.equal(Review.project(d).find(b=>b.blockId==='p2').text,'方案需要说明。');assert.deepEqual(d.reviewState.requests.map(r=>r.status),['undone','undone']);
});
test('undo invalidates later running or ready proposals without erasing them, and new order numbers stay monotonic',()=>{
 let d=run(draft(),begin());d=run(d,complete());d=run(d,{type:'accept',candidateId:'request-a'});d=run(d,begin(),'request-b');
 const undoneWhileRunning=run(d,{type:'undo'});assert.throws(()=>run(undoneWhileRunning,complete('补充安排。','p1','request-b')),e=>e.code==='REVIEW_STALE');assert.equal(undoneWhileRunning.reviewState.requests[1].status,'running');
 d=run(d,complete('补充安排。','p1','request-b'));d=run(d,{type:'undo'});assert.throws(()=>run(d,{type:'accept',candidateId:'request-b'}),e=>e.code==='REVIEW_STALE');assert.equal(d.reviewState.requests[1].status,'ready');
 d=run(d,{type:'reject',candidateId:'request-b'});d=run(d,begin(),'request-c');d=run(d,complete('新的补充。','p1','request-c'));d=run(d,{type:'accept',candidateId:'request-c'});assert.equal(d.reviewState.requests[2].acceptedOrder,2);assert.equal(Review.project(d).find(b=>b.blockId==='p1').appendTexts.length,1);assert.throws(()=>run(d,{type:'accept',candidateId:'request-c'}),e=>e.code==='REVIEW_STATE');
});
test('completion records bounded explanation and whitelisted numeric usage only',()=>{
 const running=run(draft(),begin()),action={...complete(),explanation:'建议尚未经事实核实。',meta:{provider:'test',model:'fixture',requestId:'response-a',finishReason:'stop',secret:'must-not-save',usage:{input_tokens:10,output_tokens:20,total_tokens:30,prompt_tokens:10,completion_tokens:20,cost:'secret',invalid:{secret:true},inputTokens:-1,outputTokens:Infinity}}};
 const result=run(running,action).reviewState.requests[0];assert.equal(result.explanation,action.explanation);assert.deepEqual(result.meta,{provider:'test',model:'fixture',requestId:'response-a',finishReason:'stop',usage:{input_tokens:10,output_tokens:20,total_tokens:30,prompt_tokens:10,completion_tokens:20}});
 assert.throws(()=>run(running,{...complete(),explanation:'字'.repeat(4001)}),e=>e.code==='REVIEW_INVALID');assert.equal(running.reviewState.requests[0].status,'running');
});
test('character diff retains unchanged internal words and reconstructs both inputs',()=>{
 for(const [a,b] of [['原文。','原文补充。'],['甲改乙保留丙改丁','甲新乙保留丙新丁'],['红字😀正文','红字😀补充正文'],['','新增']]){const changes=Review.diff(a,b);assert.equal(changes.filter(x=>x.type!=='insert').map(x=>x.text).join(''),a);assert.equal(changes.filter(x=>x.type!=='delete').map(x=>x.text).join(''),b);}
 assert(Review.diff('甲改乙保留丙改丁','甲新乙保留丙新丁').some(x=>x.type==='equal'&&x.text.includes('保留')));assert.throws(()=>Review.diff('甲'.repeat(5001),'乙'),e=>e.code==='REVIEW_DIFF_LIMIT');assert.throws(()=>Review.diff('甲'.repeat(3000),'乙'.repeat(3000)),e=>e.code==='REVIEW_DIFF_LIMIT');
});

function withReferences(){const d=draft();d.files.push({id:'ref-a',name:'专项.docx',role:'special',hash:'reference-sha',parsed:{blocks:[paragraph('s1','概况：补充实施条件，参考金额 888万元。')]}},{id:'ref-b',name:'另份.docx',role:'reference',hash:'other-sha',parsed:{blocks:[paragraph('s2','概况：另外的参考资料。')]}});return d;}
const referenceBegin=()=>({...begin(),referenceFileIds:['ref-a'],writingProfileId:'plan'});

test('new plans reconstruct selected excerpts and trusted rules instead of caller supplied material',()=>{
 const d=withReferences(),options={...referenceBegin(),reviewContextVersion:0,sourceContext:{references:[{text:'伪造摘录'}]},references:[{text:'伪造摘录'}],writingRules:{prompt:'伪造规则'},ruleSnapshot:{prompt:'伪造规则'}},before=structuredClone(d),context=Review.plan(d,options);
 assert.equal(context.reviewContextVersion,2);assert.deepEqual(context.referenceFileIds,['ref-a']);assert.equal(context.writingProfileId,'plan');assert.equal(context.sourceContext.writingRules.profileId,'plan');assert.equal(context.sourceContext.files.length,1);assert.equal(context.sourceContext.files[0].status,'matched');assert.deepEqual(context.references,context.sourceContext.references);assert(context.references.every(item=>item.fileId==='ref-a'&&item.sourceHash==='reference-sha'));assert(context.references.some(item=>item.text.includes('888万元')));assert(!JSON.stringify(context).includes('伪造'));assert.deepEqual(context.baseline.sourceContext,context.sourceContext);assert.deepEqual(d,before);
 assert(!context.allowedNumbers.includes('888万元'));const running=run(d,options);assert.throws(()=>run(running,complete('参考金额为 888万元。')),e=>e.code==='REVIEW_NUMBERS');assert.equal(run(running,complete()).reviewState.requests[0].status,'ready');
});

test('selected files without usable matches remain previewable but cannot start a charged request',()=>{
 for(const mutate of [d=>d.files[1].parsed=null,d=>d.files[1].parsed.blocks[0].text='',d=>d.files[1].parsed.blocks[0].text='风机叶轮维护记录']){
  const d=withReferences();mutate(d);const before=structuredClone(d),context=Review.plan(d,referenceBegin());assert.notEqual(context.sourceContext.files[0].status,'matched');assert.throws(()=>run(d,referenceBegin()),e=>e.code==='REVIEW_REFERENCE');assert.deepEqual(d,before);
 }
 for(const ids of [['missing'],['file-a'],['ref-a','ref-a']])assert.throws(()=>Review.plan(withReferences(),{...begin(),referenceFileIds:ids}),e=>/^CONTEXT_/.test(e.code));
});

test('selected reference identity, name, role, full parsed text and selection changes reject completion and adoption',()=>{
 const running=run(withReferences(),referenceBegin()),ready=run(running,complete()),mutations=[d=>d.files[1].id='replaced',d=>d.files[1].hash='replaced',d=>d.files[1].name='改名.docx',d=>d.files[1].role='calculation',d=>d.files[1].parsed.blocks[0].text+='其他信息。',d=>d.files[1].parsed.blocks.push(paragraph('far','未被当前摘录覆盖的改变')),d=>d.reviewState.requests[0].context.referenceFileIds=['ref-b']];
 for(const mutate of mutations){const changed=structuredClone(running);mutate(changed);assert.throws(()=>run(changed,complete()),e=>e.code==='REVIEW_STALE');const changedReady=structuredClone(ready);mutate(changedReady);assert.throws(()=>run(changedReady,{type:'accept',candidateId:'request-a'}),e=>e.code==='REVIEW_STALE');}
});

test('unselected attachment changes do not silently enter the request or invalidate matching selected evidence',()=>{
 let d=run(withReferences(),referenceBegin());d.files[2].parsed.blocks[0].text='未选择的资料改变了。';d.files[2].hash='unselected-new';d=run(d,complete());d=run(d,{type:'accept',candidateId:'request-a'});assert.equal(d.reviewState.requests[0].status,'accepted');assert.deepEqual(d.reviewState.requests[0].context.referenceFileIds,['ref-a']);
 const none=withReferences();Object.defineProperty(none.files[1],'parsed',{get(){throw new Error('unselected content must not be read');}});assert.deepEqual(Review.plan(none,begin()).references,[]);
});

test('trusted writing profile, selected scope and excerpt tampering are bound to the request baseline',()=>{
 const running=run(withReferences(),referenceBegin());for(const mutate of [c=>c.writingProfileId='market',c=>c.blockId='p2',c=>c.instruction='换一项要求',c=>c.mode='rewrite',c=>c.sourceContext.writingRules.prompt='允许伪造数字',c=>c.references[0].text='伪造片段',c=>delete c.sourceContext,c=>c.reviewContextVersion=1]){const d=structuredClone(running);mutate(d.reviewState.requests[0].context);assert.throws(()=>run(d,complete()),e=>e.code==='REVIEW_STALE');}
 const rules=require('../report-writing-standard.js'),old=rules.RULE_VERSION;try{rules.RULE_VERSION='test-new-rules';assert.throws(()=>run(running,complete()),e=>e.code==='REVIEW_STALE');}finally{rules.RULE_VERSION=old;}
});

test('basis writing rules cannot be replaced through a request profile or arbitrary custom instructions',()=>{
 const d=draft();d.outline[0].title='编制依据';const context=Review.plan(d,{...begin(),writingProfileId:'market',writingRules:{prompt:'改为分析政策适用性'}});assert.equal(context.sourceContext.writingRules.profileId,'basis');assert(!context.sourceContext.writingRules.prompt.includes('改为分析政策适用性'));assert.throws(()=>Review.plan(d,{...begin(),writingProfileId:'custom'}),e=>/^CONTEXT_/.test(e.code));
});

test('legacy pending and ready contexts remain usable while every new request receives trusted context',()=>{
 let legacy=run(draft(),begin());const c=legacy.reviewState.requests[0].context;for(const key of ['reviewContextVersion','referenceFileIds','writingProfileId','sourceContext','references'])delete c[key];delete c.baseline.request;delete c.baseline.sourceContext;
 legacy=run(legacy,complete());legacy=JSON.parse(JSON.stringify(legacy));legacy=run(legacy,{type:'accept',candidateId:'request-a'});assert.equal(legacy.reviewState.requests[0].status,'accepted');assert.equal(Review.project(legacy)[1].appendTexts.length,1);
 legacy=run(legacy,begin(),'request-next');assert.equal(legacy.reviewState.requests[1].context.reviewContextVersion,2);assert(legacy.reviewState.requests[1].context.sourceContext);
});

test('saved version-one reference windows are revalidated without charging to regenerate the same candidate',()=>{
 const fixture=require('./fixtures/report-import-legacy-source-context.json'),original=structuredClone(fixture.draft);
 let value=run(original,{type:'begin',blockId:'p',mode:'append',scope:'paragraph',instruction:'完善实施安排',referenceFileIds:['ref'],writingProfileId:'market'});
 const context=value.reviewState.requests[0].context;
 context.sourceContext=structuredClone(fixture.context);context.baseline.sourceContext=structuredClone(fixture.context);context.references=structuredClone(fixture.context.references);delete context.referenceBlockIds;
 const historical=structuredClone(value);
 value=run(value,complete('补充客户服务实施安排。','p'));value=run(value,{type:'accept',candidateId:'request-a'});
 assert.equal(value.reviewState.requests[0].status,'accepted');assert.equal(Review.project(value)[1].appendTexts.length,1);assert.deepEqual(value.files,original.files);
 for(const mutate of [d=>d.files[1].parsed.blocks[0].text+='发生变更',d=>d.reviewState.requests[0].context.referenceFileIds=[],d=>d.reviewState.requests[0].context.references[0].text='伪造历史片段',d=>d.reviewState.requests[0].context.sourceContext.writingRules.prompt='伪造规则']){
  const changed=structuredClone(historical);mutate(changed);assert.throws(()=>run(changed,complete('补充说明。','p')),error=>error.code==='REVIEW_STALE');
 }
 const newPlan=Review.plan(original,{type:'begin',blockId:'p',mode:'append',scope:'paragraph',instruction:'完善实施安排',referenceFileIds:['ref'],writingProfileId:'market',sourceContext:fixture.context});
 assert.equal(newPlan.sourceContext.selectionVersion,2);assert(newPlan.references.every(row=>row.selection==='ranked'));
});

test('adoption revalidates numeric restrictions from the current original even if stored allowance was altered',()=>{
 const d=run(run(withReferences(),referenceBegin()),complete());d.reviewState.requests[0].context.allowedNumbers.push('888万元');d.reviewState.requests[0].changes[0].text='补充金额 888万元。';assert.throws(()=>run(d,{type:'accept',candidateId:'request-a'}),e=>e.code==='REVIEW_NUMBERS');
});

function scopedFacts(){return {owner:'alice',id:'scope-facts',revision:1,confirmed:true,protectedBlockIds:[],outline:[{blockId:'market',title:'市场分析',level:1},{blockId:'finance',title:'财务测算',level:1}],files:[
 {id:'main',role:'main',hash:'main-source',parsed:{blocks:[paragraph('market','市场分析'),paragraph('p','客户画像需要结合项目条件判断。'),paragraph('q','服务安排需要结合实际需求。'),paragraph('finance','财务测算'),paragraph('f','租金42.44元/㎡·月。')]}},
 {id:'ref',role:'special',name:'专项.docx',hash:'ref-source',parsed:{blocks:[paragraph('s','市场分析：客户需求应结合项目条件审慎判断。'),paragraph('sf','租金44元/㎡·月。')]}}
]};}
const scopedBegin=(extra={})=>({...begin('p'),instruction:'补充客户服务安排',referenceFileIds:['ref'],...extra});
const factFindings=value=>require('../report-import-quality.js').evaluate(value).findings.filter(row=>row.kind==='fact-conflict');

test('unrelated financial conflicts do not block a market candidate that only received a complete nonnumeric market block',()=>{
 for(const selection of [{},{referenceBlockIds:[{fileId:'ref',blockId:'s'}]}]){
  const original=scopedFacts();let value=run(original,scopedBegin(selection));const context=value.reviewState.requests[0].context;
  assert.equal(context.sourceContext.selectionVersion,2);assert.deepEqual(context.sourceContext.references.flatMap(row=>row.positions.map(position=>position.blockId)),['s']);
  const findings=factFindings(value);assert.equal(findings.length,1);assert.equal(findings[0].status,'open');
  value=run(value,complete('补充客户服务组织和反馈安排。','p'));value=run(value,{type:'accept',candidateId:'request-a'});
  assert.equal(value.reviewState.requests[0].status,'accepted');assert.equal(value.reviewState.requests[0].factConfirmation,undefined);assert.equal(factFindings(value)[0].status,'open');assert.deepEqual(value.files,original.files);
 }
});

test('actually referenced conflicting facts still require a recorded source choice and explicit confirmation',()=>{
 let value=run(scopedFacts(),scopedBegin({referenceBlockIds:[{fileId:'ref',blockId:'sf'}]}));
 assert.deepEqual(value.reviewState.requests[0].context.references[0].positions.map(row=>row.blockId),['sf']);value=run(value,complete('补充客户服务组织和反馈安排。','p'));
 assert.throws(()=>run(value,{type:'accept',candidateId:'request-a',factConfirmation:true}),error=>error.code==='REVIEW_FACTS');
 const finding=factFindings(value)[0];value=run(value,{type:'quality-decision',findingId:finding.id,decision:'confirmed',note:'保留主稿已有数字，参考口径仍须在最终签审时核对。',sourceLocation:finding.locations.find(row=>row.fileId==='main')});
 assert.throws(()=>run(value,{type:'accept',candidateId:'request-a'}),error=>error.code==='REVIEW_FACTS');
 value=run(value,{type:'accept',candidateId:'request-a',factConfirmation:true});assert.equal(value.reviewState.requests[0].factConfirmation.numericPermission,'original-only');assert.equal(value.reviewState.requests[0].factConfirmation.findings[0].findingId,finding.id);
});

test('facts in the requested main scope remain gated even when the selected reference excerpt is nonnumeric',()=>{
 let value=run(scopedFacts(),scopedBegin({blockId:'f',referenceBlockIds:[{fileId:'ref',blockId:'s'}]}));value=run(value,complete('保留原稿测算口径，补充运营安排。','f'));
 assert.throws(()=>run(value,{type:'accept',candidateId:'request-a',factConfirmation:true}),error=>error.code==='REVIEW_FACTS');
});

test('partial adoption cannot discard referenced conflicts or bypass numeric validation of unselected candidate blocks',()=>{
 let value=run(scopedFacts(),scopedBegin({blockId:'market',scope:'section',referenceBlockIds:[{fileId:'ref',blockId:'sf'}]}));value=run(value,{type:'complete',requestId:'request-a',changes:[{blockId:'p',text:'补充客户服务安排。'},{blockId:'q',text:'补充运营衔接安排。'}]});
 assert.throws(()=>run(value,{type:'accept',candidateId:'request-a',blockIds:['p'],factConfirmation:true}),error=>error.code==='REVIEW_FACTS');
 const changed=structuredClone(value);changed.reviewState.requests[0].changes[1].text='参考租金44元/㎡·月。';assert.throws(()=>run(changed,{type:'accept',candidateId:'request-a',blockIds:['p'],factConfirmation:true}),error=>error.code==='REVIEW_NUMBERS');
 const mainScope=scopedFacts();mainScope.files[0].parsed.blocks[2]=paragraph('q','租金42.44元/㎡·月。');let section=run(mainScope,scopedBegin({blockId:'market',scope:'section',referenceBlockIds:[{fileId:'ref',blockId:'s'}]}));section=run(section,{type:'complete',requestId:'request-a',changes:[{blockId:'p',text:'补充客户服务安排。'},{blockId:'q',text:'补充运营衔接安排。'}]});
 assert.throws(()=>run(section,{type:'accept',candidateId:'request-a',blockIds:['p'],factConfirmation:true}),error=>error.code==='REVIEW_FACTS');
});

test('legacy reference-window requests retain conservative file-wide fact gating outside their saved excerpt',()=>{
 const fixture=require('./fixtures/report-import-legacy-source-context.json'),original=structuredClone(fixture.draft),snapshot=structuredClone(fixture.context),evidence=require('../report-completion-contract.js');
 original.files[0].parsed.blocks.push(paragraph('finance','财务测算'),paragraph('f','租金42.44元/㎡·月。'));original.outline.push({blockId:'finance',title:'财务测算',level:1});
 original.files[1].parsed.blocks.push(paragraph('padding','与市场章节无关的设备资料。'.repeat(300)),paragraph('sf','租金44元/㎡·月。'));
 const blocks=original.files[1].parsed.blocks,text=blocks.map(row=>row.text).join('\n'),windows=evidence.evidenceWindows([{title:'专项.docx',content:text}],snapshot.queryTerms,2600);let offset=0;const spans=blocks.map((row,blockIndex)=>{const span={blockId:row.id,blockIndex,start:offset,end:offset+row.text.length};offset=span.end+1;return span;});
 snapshot.references=windows.map(window=>({label:'专项.docx',text:window.text,fileId:'ref',sourceHash:'ref-sha',offset:window.offset,endOffset:window.offset+window.text.length,positions:spans.filter(span=>span.start<window.offset+window.text.length&&span.end>window.offset).map(span=>({blockId:span.blockId,blockIndex:span.blockIndex,startOffset:Math.max(window.offset,span.start)-span.start,endOffset:Math.min(window.offset+window.text.length,span.end)-span.start}))}));
 Object.assign(snapshot.files[0],{parsedFingerprint:evidence.fingerprint(blocks.map(row=>({id:row.id,text:row.text}))),parsedCharacters:text.length,excerptCharacters:snapshot.references.reduce((sum,row)=>sum+row.text.length,0)});
 assert(snapshot.references.length);assert(!snapshot.references.some(row=>row.positions.some(position=>position.blockId==='sf')));assert.deepEqual(require('../report-import-context.js').validateLegacy(original,snapshot),snapshot);
 let value=run(original,{...begin('p'),instruction:'完善实施安排',referenceFileIds:['ref'],writingProfileId:'market',referenceBlockIds:[{fileId:'ref',blockId:'r'}]});const context=value.reviewState.requests[0].context;context.sourceContext=structuredClone(snapshot);context.baseline.sourceContext=structuredClone(snapshot);context.references=structuredClone(snapshot.references);delete context.referenceBlockIds;
 value=run(value,complete('补充客户服务组织安排。','p'));assert.throws(()=>run(value,{type:'accept',candidateId:'request-a',factConfirmation:true}),error=>error.code==='REVIEW_FACTS');
});
