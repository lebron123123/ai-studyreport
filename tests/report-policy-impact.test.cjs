const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../report-output-policy.js'),wf=require('../project-workflow.js');
test('旧正文通用规则升级进入候选范围，接受、拒绝、撤销不会丢失版本语义',()=>{
 const s={content:'旧正文'};assert.equal(policy.needsContentReview(s),true);
 wf.setCandidate(s,'简明新正文','通用规则',{outputPolicyVersion:policy.contentVersion});
 assert.equal(policy.needsContentReview(s),true);wf.rejectCandidate(s);assert.equal(policy.needsContentReview(s),true);
 wf.setCandidate(s,'简明新正文','通用规则',{outputPolicyVersion:policy.contentVersion});wf.acceptCandidate(s);
 assert.equal(policy.needsContentReview(s),false);wf.undoSection(s);assert.equal(policy.needsContentReview(s),true);
 assert.equal(s.content,'旧正文');assert.equal(policy.needsContentReview({content:''}),false);
});
test('候选范围合并通用和小节规则，不重复；锁定、待确认单独计数',()=>{
 const src=fs.readFileSync('aireport.js','utf8'),ctx={window:{ReportOutputPolicy:policy},chapters:[{checked:true,sections:[{content:'a'},{content:'b',locked:true},{content:'c',pendingRevision:{}},{content:'d',outputPolicyVersion:policy.contentVersion},{content:'e',staleKind:'logic',syncStatus:'stale'}]}]};
 vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('function airCandidateImpactRows(){'),src.indexOf('function airChapterSyncLevel(')),ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.airReportLogicImpactSummary())),{total:4,unlocked:2,locked:1,pending:1});
});
