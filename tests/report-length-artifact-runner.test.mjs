import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buildParagraphChunks,validateLengthArtifact,artifactRunSummary,parseLengthResponse,recoverLengthResponse,assembleLengthProposal,assertArtifactIntent,assertArtifactAcknowledgement,assertArtifactTask} from '../scripts/report-length-artifact-runner.mjs';
test('task submission or mixed success never reports completed artifacts or actual billing',()=>{
 const incomplete=artifactRunSummary([{id:'a',status:'completed',taskId:'known'},{id:'b',status:'blocked'}],4,2);
 assert.equal(incomplete.complete,false);assert.equal(incomplete.completed,1);assert.equal(incomplete.notDispatched,2);assert.equal(incomplete.confirmedTaskAcks,1);assert.equal(incomplete.paidCalls,undefined);
 const completed=[{id:'a',status:'completed',taskId:'known'}];
 assert.equal(artifactRunSummary(completed,1,0).complete,false);
 assert.equal(artifactRunSummary(completed,1,0,[{status:'blocked'}],1).complete,false);
 const assembled=artifactRunSummary(completed,1,0,[{status:'semantic-review-pending'}],1);
 assert.equal(assembled.complete,true);assert.equal(assembled.semanticReviewRequired,true);assert.equal(assembled.pageAcceptance,'not-measured');
});
test('paragraph business headings stay outside editable prose',()=>{
 const body='<p data-report-heading-level="3">一、运营条件</p><p><strong>（一）前置条件</strong></p><p>许可尚需核对。</p>';
 const plan=buildParagraphChunks(body,{targetProse:20});
 assert.equal(plan.paragraphs.length,1);assert.equal(plan.paragraphs[0].text,'许可尚需核对。');
});
const response=text=>({replacements:[{id:'p0',text}],additions:[],tables:[]});
test('known output envelope and plain line breaks recover without rewriting facts',()=>{
 const raw=JSON.stringify({task:'编辑',output:response('面积200平方米。\n许可尚待核验。')}),before=raw;
 const result=recoverLengthResponse(raw,['p0']);
 assert.equal(result.response.replacements[0].text,'面积200平方米。 许可尚待核验。');assert.equal(raw,before);
 assert.deepEqual(result.evidence.transformations,['unwrap-output-envelope','normalize-plain-prose-newlines']);
 assert.equal(result.evidence.rawPreserved,true);assert.equal(result.evidence.normalizedParagraphs[0].id,'p0');
});
test('truncated envelope recovers only an already closed unique complete output',()=>{
 const payload=response('面积200平方米，许可待核验。'),prefix='{"task":"编辑","output":',raw=prefix+JSON.stringify(payload)+',"completeSection":"<table>此处被截断';
 const result=recoverLengthResponse(raw,['p0']);
 assert.deepEqual(result.response,payload);assert.equal(result.evidence.extractedRange.start,prefix.length);
 assert.deepEqual(result.evidence.transformations,['extract-complete-output-from-truncated-envelope']);
 for(const bad of [prefix+JSON.stringify(payload).slice(0,-2),prefix+JSON.stringify(payload)+',"output":'+JSON.stringify(payload)+',"tail":"',prefix+JSON.stringify({replacements:[],additions:[],tables:[]})+',"tail":"'])assert.throws(()=>recoverLengthResponse(bad,['p0']));
});
test('ambiguous JSON, invented keys, missing paragraphs and non-prose normalization fail closed',()=>{
 const raw=JSON.stringify(response('正文'));
 for(const value of [raw.replace('"text":"正文"','"text":"旧","text":"正文"'),raw.replace('"text":"正文"','"text":"旧","te\\u0078t":"正文"'),JSON.stringify({output:response('正文'),surprise:true}),JSON.stringify(response('<p>正文</p>\n另一段')),JSON.stringify({...response('正文'),tables:[{}]})])assert.throws(()=>parseLengthResponse(value,['p0']));
 assert.throws(()=>parseLengthResponse(raw,['p0','p1']),/paragraph set/);
 const emptyOperations=recoverLengthResponse(JSON.stringify({replacements:[{id:'p0',text:'正文'}]}),['p0']);
 assert.deepEqual(emptyOperations.response,response('正文'));assert.deepEqual(emptyOperations.evidence.transformations,['explicit-empty-additions','explicit-empty-tables']);
});
test('assembly exposes missing/invalid chunks separately from unmeasured and over-reference proposals',()=>{
 const body='<h3>分类</h3><p>面积200平方米，许可尚待核验。</p>',section={sectionNumber:'2.1',targetProse:4},plan=buildParagraphChunks(body,section);
 assert.equal(assembleLengthProposal(body,section,plan,[]).status,'pending');
 assert.equal(assembleLengthProposal(body,section,plan,[{raw:'{"replacements":'}]).status,'blocked');
 const result=assembleLengthProposal(body,section,plan,[{raw:JSON.stringify({task:'编辑',output:response('面积200平方米，许可待核验。')})}]);
 assert.equal(result.status,'semantic-review-pending');assert.equal(result.referenceTargetExceeded,true);assert.equal(result.pageAcceptance,'not-measured');assert.equal(result.responseRecovery[0].status,'recovered');
});
test('saved request binds source, job, project and exact payload before any recovery',()=>{
 const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),body={projectId:'qa',sectionKey:'一 / 二',user:'原始输入'},source='原正文';
 const intent={job:'2.1-0',projectId:'qa',bodySha256:hash(source),requestSha256:hash(JSON.stringify(body)),body};
 assert.doesNotThrow(()=>assertArtifactIntent(intent,{id:'2.1-0',body,source}));
 for(const expected of [{id:'2.2-0',body,source},{id:'2.1-0',body:{...body,user:'另一输入'},source},{id:'2.1-0',body,source:'新版正文'}])assert.throws(()=>assertArtifactIntent(intent,expected),/never auto-repost/);
 assert.throws(()=>assertArtifactIntent({...intent,body:{...body,user:'缓存篡改'}},{id:'2.1-0',body,source}),/never auto-repost/);
});
test('real POST-shaped acknowledgement is allowed before GET fills the immutable hash',()=>{
 const ack={id:'task',runId:'run',task:{id:'task',runId:'run',reused:false}};
 assert.doesNotThrow(()=>assertArtifactAcknowledgement(ack));
 assert.throws(()=>assertArtifactAcknowledgement({...ack,runId:'other'}),/identity/);
 const task={id:'task',runId:'run',status:'queued',graph:[{key:'context_snapshot',hash:'a'.repeat(64)}]};
 assert.doesNotThrow(()=>assertArtifactTask(task,ack));assert.throws(()=>assertArtifactTask({...task,graph:[]},ack),/hash/);
});
test('dead/missing/stale or different immutable tasks stop immediately retaining original task ID',()=>{
 const original={id:'task',runId:'run',status:'running',graph:[{key:'context_snapshot',hash:'a'.repeat(64)}]},ack={id:'task',runId:'run',task:original};
 for(const status of ['dead','missing','failed','invalidated','cancelled','canceled'])assert.throws(()=>assertArtifactTask({...original,status},ack),e=>e.taskId==='task'&&e.message.includes(status));
 assert.throws(()=>assertArtifactTask({...original,rulesChanged:true},ack),/rules changed/);
 assert.throws(()=>assertArtifactTask({...original,id:'another'},ack),/identity/);
 assert.throws(()=>assertArtifactTask({...original,graph:[{key:'context_snapshot',hash:'b'.repeat(64)}]},ack),/hash/);
 for(const status of ['queued','retry','running','completed'])assert.doesNotThrow(()=>assertArtifactTask({...original,status},ack));
});
test('bounded length plan preserves headings, tables and marked gaps outside edits',()=>{
 const body='<h3>1.1 分类</h3><p>本项目面积为200平方米，现有材料尚未明确。需核实范围。</p><p>【待补：原件】</p><table><tr><td><p>20</p></td></tr></table>';
 const section={targetProse:30,protected:{literalGapChecks:[{literal:'【待补：原件】',requiredAfter:1}]}},plan=buildParagraphChunks(body,section);
 assert.equal(plan.paragraphs.length,1);
 const result=validateLengthArtifact(body,section,{replacements:[{id:'p0',text:'面积200平方米，需核实范围。'}],additions:[],tables:[]},plan);
 assert.ok(result.after.endsWith('<p>【待补：原件】</p><table><tr><td><p>20</p></td></tr></table>'));
 assert.equal(result.semanticReviewRequired,true);
 assert.throws(()=>validateLengthArtifact(body,section,{replacements:[{id:'p0',text:'面积需核实。'}],additions:[],tables:[]},plan),/Numeric token lost/);
});
test('missing, duplicate, HTML and stale paragraph edits are not accepted',()=>{
 const body='<h3>标题</h3><p>现有资料说明。</p>',section={targetProse:15},plan=buildParagraphChunks(body,section);
 for(const replacements of [[],[{id:'p0',text:'<b>改</b>'}],[{id:'p0',text:'修改'},{id:'p0',text:'再次'}]])assert.throws(()=>validateLengthArtifact(body,section,{replacements,additions:[],tables:[]},plan));
 assert.throws(()=>validateLengthArtifact(body.replace('说明','证明'),section,{replacements:[{id:'p0',text:'修改'}],additions:[],tables:[]},plan),/changed/);
});
