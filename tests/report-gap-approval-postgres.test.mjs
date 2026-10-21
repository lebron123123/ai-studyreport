import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {reviewReportGaps,loadReportGapApprovals} from '../functions/api/_report-gap-approval.js';
import {loadReportWritingPolicy,projectReportGapPolicy} from '../functions/api/_report-writing-policy.js';
import {loadDeliveryGapContext,deliveryGapQuality} from '../functions/api/_delivery-gaps.js';
import {deliverySnapshot} from '../functions/api/_delivery-snapshot.js';
import {createResearch,saveResearchRun,readResearch,restartResearch} from '../functions/api/_research-store.js';
import {signToken} from '../functions/api/_auth.js';
import * as projects from '../functions/api/projects.js';
import * as execution from '../functions/api/reportexecution.js';
const W=globalThis.ReportGapWorkflow,target=testDatabaseUrl();
test('真实PG：签名人工核实、CAS保存、刷新验证、资料失效和跨项目/轮次隔离',{skip:!target},async t=>{
  const DB=createD1Shim(target),env={DB,DEPLOY_MODE:'local',SESSION_SECRET:crypto.randomUUID(),RESEARCH_IDENTITY_ENABLED:'1'},pid=crypto.randomUUID();
  try{
    const user=Number((await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id),token=await signToken(env,user,'test-admin');
    await DB.prepare("CREATE TABLE IF NOT EXISTS report_logic_sets (id TEXT PRIMARY KEY,project_type TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',data TEXT NOT NULL,source_name TEXT DEFAULT '',created_at BIGINT NOT NULL,created_by TEXT DEFAULT '',published_at BIGINT)").run();
    const logic={projectType:'rent',globalRequirements:{rent:'只列项目经营条件，不写论文背景。'},rules:[{id:'population',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析本项目已核实人口需求'}]};
    const version=Number((await DB.prepare("SELECT COALESCE(MAX(version),0) AS n FROM report_logic_sets WHERE project_type='rent'").first()).n)+1,logicId=crypto.randomUUID();
    await DB.prepare('INSERT INTO report_logic_sets(id,project_type,name,version,status,data,created_at,published_at) VALUES(?,?,?,?,?,?,?,?)').bind(logicId,'rent','[系统测试]签名核实需求',version,'published',JSON.stringify(logic),Date.now(),Date.now()).run();
    const original={project:{name:'[系统测试]签名核实',location:'龙岗区'},calcType:'rent',calcParams:{area:10},kb:[{id:'m1',title:'[系统测试]统计原件',content:'本项目服务范围常住人口为1000人，统计期为2025年末。'}],chapters:[{name:'市场分析',sections:[{t:'人口需求',content:'用户正式正文保持不变',locked:true,candidate:{text:'已有候选保持不变'}}]}]};
    const policy=await loadReportWritingPolicy(env,original,'rent',''),opts={projectKey:pid,projectType:'rent',logicData:policy.logicData,requirementOverrides:{},sectionKey:'市场分析 / 人口需求'};
    function activate(saved,key=pid){const d=W.create(W.fromSaved(saved,{...opts,projectKey:key}));saved.workflow=W.apply(saved.workflow||{},d.registry,{projectKey:key,sourceRevision:d.sourceRevision,confirmed:true,actorId:String(user),sectionKeys:d.sectionKeys});return d;}
    const post=async(api,body)=>{const r=await api.onRequestPost({env,request:new Request('http://test/api/test',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};};
    await post(projects,{id:pid,name:original.project.name,data:original});
    const initialized=await post(projects,{id:pid,name:original.project.name,data:original});assert.equal(initialized.status,200);
    const saved=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data),d=activate(saved),initial=initialized.data.updatedAt;
    await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(saved),pid).run();
    const base={projectId:pid,expectedUpdatedAt:initial,sourceRevision:d.sourceRevision,gapId:d.registry.records[0].id,action:'confirmGap',confirmed:true,status:'satisfied',reason:'已逐项核对统计原文、人口对象及统计期，适用于本项目需求分析。',evidence:{materialId:'m1',quote:'本项目服务范围常住人口为1000人',locator:'原材料第1段'}};
    const before=JSON.stringify(saved);
    await t.test('明确人工确认、引用真实原文和编辑权限为必需；失败不签发不改原稿',async()=>{
      for(const bad of [{confirmed:false},{sourceRevision:'old'},{expectedUpdatedAt:initial-1},{reason:'核实'},{evidence:{...base.evidence,quote:'这是原材料中不存在的虚假数字。'}},{evidence:{...base.evidence,materialId:'absent'}}])await assert.rejects(reviewReportGaps(env,user,{...base,...bad}));
      await assert.rejects(reviewReportGaps({...env,SESSION_SECRET:''},user,base),/签名密钥/);
      await assert.rejects(reviewReportGaps(env,user+100000,base),/权限/);
      assert.equal((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data,before);
    });
    const result=await reviewReportGaps(env,user,base);assert.equal(result.trustedApprovals.length,1);assert.equal(result.registry.records[0].status,'satisfied');assert.equal(result.requiresSave,true);assert.equal(result.formalApproval,false);
    assert.equal((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data,before,'核实收据不覆盖可写项目，必须正常CAS保存');
    saved.workflow.reportGapRegistry=result.registry;saved.workflow.reportGapReceipts={[base.gapId]:result.receipt};
    const save=await post(projects,{id:pid,name:saved.project.name,data:saved,expectedUpdatedAt:initial});assert.equal(save.status,200,JSON.stringify(save.data));const current=Number((await DB.prepare('SELECT updated_at FROM projects WHERE id=?').bind(pid).first()).updated_at);
    await t.test('CAS保存后刷新验签可关闭关键缺口；generation与delivery共用可信收据，不认证事实准确率',async()=>{
      const verified=await post(execution,{action:'verifyGaps',projectId:pid,expectedUpdatedAt:current});assert.equal(verified.status,200,JSON.stringify(verified.data));assert.equal(verified.data.gaps.registry.records[0].status,'satisfied');
      const trusted=await loadReportGapApprovals(env,saved,W.fromSaved(saved,opts));assert.equal(trusted.length,1);
      assert.equal(projectReportGapPolicy(saved,{...opts,trustedApprovals:trusted}).registry.records[0].status,'satisfied');
      const authority=await loadDeliveryGapContext(env,user,pid,saved),quality=deliveryGapQuality(deliverySnapshot(saved,4,authority));assert.equal(quality.passed,true,JSON.stringify(quality));assert.equal(quality.factsVerified,false);
      assert.deepEqual(saved.chapters,original.chapters);assert.equal(Number((await DB.prepare("SELECT COUNT(*) AS n FROM project_events WHERE project_id=? AND event_type='report.gap.human-confirmed'").bind(pid).first()).n),1);
    });
    await t.test('关闭收据撤销或签名密钥变化使旧候选过期；保留旧任务和正文可读',async()=>{
      const task=await execution.startReportSection(env,user,{projectId:pid,projectType:'rent',logicVersion:version,sectionKey:'市场分析 / 人口需求',system:'[系统测试]仅排队，不执行外部模型',user:'基于已保存证据分析需求。'});
      assert.equal((await execution.readReportSection(env,user,task.id)).rulesChanged,false);
      assert.equal((await execution.readReportSection({...env,SESSION_SECRET:crypto.randomUUID()},user,task.id)).rulesChanged,true,'真实验签失效应撤销当前候选资格');
      const live=await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first(),copy=JSON.parse(live.data);delete copy.workflow.reportGapReceipts;
      try{
        await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(copy),pid).run();
        const old=await execution.readReportSection(env,user,task.id);assert.equal(old.rulesChanged,true);assert.equal(old.id,task.id);
        assert.deepEqual(copy.chapters,original.chapters);
      }finally{await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(live.data,pid).run();}
      assert.equal((await execution.readReportSection(env,user,task.id)).rulesChanged,false);
    });
    await t.test('伪造、改签名、改状态、跨项目、换资料与换规则均不能沿用已关闭状态',async()=>{
      for(const mutate of [s=>s.workflow.reportGapReceipts[base.gapId].signature='0'.repeat(64),s=>s.workflow.reportGapReceipts[base.gapId].approval.status='not-applicable',s=>s.kb[0].content+='修订',s=>s.project.location='其他区']){const copy=structuredClone(saved);mutate(copy);assert.deepEqual(await loadReportGapApprovals(env,copy,W.fromSaved(copy,opts)),[]);}
      assert.deepEqual(await loadReportGapApprovals(env,saved,W.fromSaved(saved,{...opts,projectKey:'other-project'})),[]);
      const changed=structuredClone(opts);changed.logicData.rules[0].requiredSources+='及就业';assert.deepEqual(await loadReportGapApprovals(env,saved,W.fromSaved(saved,changed)),[]);
      const forged=structuredClone(saved);delete forged.workflow.reportGapReceipts;assert.deepEqual(await loadReportGapApprovals(env,forged,W.fromSaved(forged,opts)),[]);assert.equal(W.create(W.fromSaved(forged,opts)).registry.records[0].status,'unverified');
      const metadataOnly=structuredClone(saved);metadataOnly.kb[0].uploadedAt=Date.now();metadataOnly.kb[0].uiExpanded=true;assert.equal((await loadReportGapApprovals(env,metadataOnly,W.fromSaved(metadataOnly,opts))).length,1,'无关材料UI元信息不能使共享源版本失配');
      const late=await post(projects,{id:pid,name:saved.project.name,data:saved,expectedUpdatedAt:initial});assert.equal(late.status,409);await assert.rejects(reviewReportGaps(env,user,base),/已更新/);
    });
    await t.test('不适用必须说明理由，属于人工业务判断，不伪造材料核实',async()=>{
      await assert.rejects(reviewReportGaps(env,user,{...base,expectedUpdatedAt:current,status:'not-applicable',reason:'不适用'}),/12至/);
      const out=await reviewReportGaps(env,user,{...base,expectedUpdatedAt:current,status:'not-applicable',reason:'当前项目不涉及该统计对象，该项不作为本项目经营结论依据。'});assert.equal(out.receipt.evidence,null);assert.equal(out.registry.records[0].status,'not-applicable');assert.equal(out.formalApproval,false);
    });
    await t.test('私人研究版本、轮次、用户绑定；历史轮次不可签发，资料未变化不能跨轮次重放',async()=>{
      const study=await createResearch(DB,user,{requestId:crypto.randomUUID(),title:'[系统测试]私人核实'}),key=study.researchId+':'+study.runId,researchSaved=structuredClone(original),rd=activate(researchSaved,key);
      await saveResearchRun(DB,user,{...study,epoch:1,expectedVersion:1,requestId:crypto.randomUUID(),state:{draft:researchSaved}});
      const identity={researchId:study.researchId,runId:study.runId,epoch:1,expectedVersion:2},input={...base,projectId:undefined,research:identity,sourceRevision:rd.sourceRevision,gapId:rd.registry.records[0].id};
      const out=await reviewReportGaps(env,user,input);assert.equal(out.approval.projectKey,key);researchSaved.workflow.reportGapRegistry=out.registry;researchSaved.workflow.reportGapReceipts={[input.gapId]:out.receipt};
      await saveResearchRun(DB,user,{...identity,requestId:crypto.randomUUID(),state:{draft:researchSaved}});
      await assert.rejects(reviewReportGaps(env,user,input),/更新|版本/);
      const verify=await reviewReportGaps(env,user,{action:'verifyGaps',research:{...identity,expectedVersion:3}});assert.equal(verify.trustedApprovals.length,1);
      await assert.rejects(reviewReportGaps(env,user+100000,{action:'verifyGaps',research:{...identity,expectedVersion:3}}));
      const next=await restartResearch(DB,user,{...identity,expectedVersion:3,requestId:crypto.randomUUID(),mode:'blank'});assert.ok(next.runId);
      assert.deepEqual(await loadReportGapApprovals(env,researchSaved,W.fromSaved(researchSaved,{...opts,projectKey:study.researchId+':'+next.runId})),[]);
      await assert.rejects(reviewReportGaps(env,user,{...input,research:{...identity,expectedVersion:3}}),/历史|变化|停用|轮次/);
      assert.equal((await readResearch(DB,user,study.researchId,study.runId)).run.state.draft.chapters[0].sections[0].content,'用户正式正文保持不变');
    });
    await t.test('历史无ID材料可用共享内容身份核实；相同材料重复时拒绝歧义',async()=>{
      const study=await createResearch(DB,user,{requestId:crypto.randomUUID(),title:'[系统测试]无ID材料核实'}),key=study.researchId+':'+study.runId,legacy=structuredClone(original);delete legacy.kb[0].id;
      const derived=activate(legacy,key),materialId=W.materialId(legacy.kb[0]);assert.match(materialId,/^material-content:/);
      await saveResearchRun(DB,user,{...study,epoch:1,expectedVersion:1,requestId:crypto.randomUUID(),state:{draft:legacy}});
      const identity={researchId:study.researchId,runId:study.runId,epoch:1,expectedVersion:2},input={...base,projectId:undefined,research:identity,sourceRevision:derived.sourceRevision,gapId:derived.registry.records[0].id,evidence:{...base.evidence,materialId}};
      const out=await reviewReportGaps(env,user,input);assert.equal(out.registry.records[0].status,'satisfied');assert.equal(out.receipt.evidence.materialId,materialId);
      legacy.kb.push(structuredClone(legacy.kb[0]));const duplicate=activate(legacy,key);await saveResearchRun(DB,user,{...identity,requestId:crypto.randomUUID(),state:{draft:legacy}});
      await assert.rejects(reviewReportGaps(env,user,{...input,research:{...identity,expectedVersion:3},sourceRevision:duplicate.sourceRevision}),/唯一原材料/);
    });
  }finally{await DB._close();}
});
