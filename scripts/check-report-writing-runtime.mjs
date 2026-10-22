// Real local service, bounded synthetic prose samples; never edits formal reports.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {reportSectionOutputBudget} from '../functions/api/reportexecution.js';
import '../report-writing-standard.js';
import '../report-completion-contract.js';
const root=path.resolve('.'),base='http://localhost:8080',checks=[];
const db=createD1Shim(process.env.DATABASE_URL);
const out=path.join(root,'outputs/report-standardization','writing-runtime-'+new Date().toISOString().replace(/[:.]/g,'-'));
const idle=process.argv.includes('--idle-check');
const structureOnly=process.argv.includes('--structure-check');
const depthOnly=process.argv.includes('--depth-check');
let depthFixture=null;
try{
  if(idle){
    const rows=(await db.prepare("SELECT status,COUNT(*) AS count FROM agent_jobs WHERE status IN ('running','leased') GROUP BY status").all()).results||[];
    console.log(JSON.stringify({scope:'read-only current job check',active:rows}));
    if(rows.some(row=>Number(row.count)>0))throw Error('Active jobs exist; do not restart');
  }else{
    await fs.mkdir(out,{recursive:true});
    const users=(await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').all()).results||[];
    assert.equal(users.length,1,'Expected exactly one previously verified local account');
    const token=await signToken(process.env,users[0].id,users[0].username);
    async function request(name,url,body,timeout=90000){
      const start=Date.now();
      const response=await fetch(base+url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
      const data=await response.json();checks.push({name,status:response.status,ok:response.ok,durationMs:Date.now()-start});
      assert.ok(response.ok,name+': '+String(data.error||response.status));return data;
    }
    const site=await fetch(base,{signal:AbortSignal.timeout(10000)}),html=await site.text();assert.equal(site.status,200);
    assert.ok(!(structureOnly&&depthOnly),'Select only one bounded sample mode');
    const assets=['report-writing-standard.js','report-gap-registry.js','report-gap-workflow.js','report-gap-ui.js','report-standards-ui.js','report.js','export.js','report-completion-contract.js','report-section-layout.js','md.js','aireport.js','report-argument.js','report-output-policy.js','report-orchestration-client.js'];
    const assetHashes=[];
    for(const file of assets){
      assert.ok(html.includes(file),'Missing asset '+file);
      const response=await fetch(base+'/'+file,{signal:AbortSignal.timeout(10000)});
      const actual=Buffer.from(await response.arrayBuffer()),local=await fs.readFile(path.join(root,file));
      const sha256=crypto.createHash('sha256').update(actual).digest('hex');
      assert.equal(sha256,crypto.createHash('sha256').update(local).digest('hex'));
      assetHashes.push({file,sha256,bytes:actual.length});
    }
    checks.push({name:'final-assets-match-local',ok:true,assets:assets.length,assetHashes});
    const diagnostic=await request('actual-ai-generation','/api/generate',{kind:'batch',system:'你是接口诊断助手。只输出一句中文。',messages:[{role:'user',content:'[系统测试]只回答：报告生成接口正常。不要调用工具。'}],max_tokens:80});
    const reply=(diagnostic.content||[]).map(x=>x.text||'').join('');assert.ok(reply.trim());checks.at(-1).responseCharacters=reply.length;
    const rag=await request('adjacent-rag-retrieval','/api/rag',{action:'query',query:'[系统测试]保障性租赁住房政策',topK:2});assert.equal(rag.ok,true);checks.at(-1).matches=rag.matches?.length||0;
    for(const type of ['gaibao-housing','rent','sale']){
      const tables=await request('table-template-'+type,'/api/reporttables?projectType='+type);assert.equal(tables.ok,true);checks.at(-1).publishedVersion=tables.config?.version;
    }
    const samples=[
      {type:'rent',chapter:'市场分析',title:'需求分析',facts:'项目共100套房源。企业书面征集40套意向，意向不是正式租约；另有20人电话咨询但未确认是否重复。其余需求尚未核验。不要相加为60套已落实需求。'},
      {type:'sale',chapter:'市场分析',title:'定价分析',facts:'登记的两项可比案例单价分别为每平方米20000元和22000元，面积口径相同；装修和楼层差异尚未核验，没有已确认调整系数。仅作可比范围，不得推导确定售价或收益。'},
      {type:'gaibao',chapter:'经济效益分析',title:'财务评价',facts:'既有测算登记年收入600万元、日常运营支出400万元。尚未提供投资现金流、借款本息、所得税及回报指标。只可判断所列收入覆盖所列运营支出，不能认定项目总体盈利或投资可行。'}
    ];
    for(const sample of structureOnly||depthOnly?[]:samples){
      const system=globalThis.ReportWritingStandard.prompt(undefined,{projectType:sample.type,chapter:sample.chapter,title:sample.title})+'\n这是[系统测试]隔离样例。只写150至250字的两段正文，不要标题、表格或写作说明。只用提供的事实，不调用外部工具。';
      const generated=await request('style-sample-'+sample.type,'/api/generate',{kind:'batch',system,messages:[{role:'user',content:sample.facts}],max_tokens:1600},120000);
      const prose=(generated.content||[]).map(x=>x.text||'').join('');assert.ok(prose.trim());
      const review=globalThis.ReportWritingStandard.inspect(prose,undefined,sample);
      checks.at(-1).characters=prose.length;checks.at(-1).mechanicalWarnings=review.issues.length;checks.at(-1).semanticCertified=false;
      await fs.writeFile(path.join(out,sample.type+'-sample.json'),JSON.stringify({...sample,prose,review},null,2),{flag:'wx'});
      console.log(sample.type+': '+prose.length+' characters, '+review.issues.length+' mechanical warnings; manual review still required');
    }
    if(depthOnly){
      const C=globalThis.ReportCompletionContract;
      // Match the real published housing-conversion outline and current budget,
      // rather than assigning the isolated section the entire report budget.
      const published=await request('depth-published-logic','/api/reportlogic?projectType=gaibao');
      assert.equal(published.ok,true);assert.ok(published.set?.version);
      const box=createContext({window:{},fetch:async()=>({ok:true,json:async()=>published})});
      runInContext(await fs.readFile(path.join(root,'report-logic-core.js'),'utf8'),box);
      await box.window.ReportLogicCore.load('gaibao');
      const chapters=JSON.parse(JSON.stringify(box.window.ReportLogicCore.outline('gaibao',{businessScenario:'housing_conversion'}).chapters)),plan=C.createPlan(chapters,{projectType:'gaibao'});
      const sectionKey='项目市场分析 / 供需态势与市场结论',section=plan.sections.find(row=>row.sectionKey===sectionKey);
      assert.ok(section,'Published outline is missing the selected market responsibility');
      assert.equal(plan.sections.length,43);
      const requiredHeadings=[{level:3,text:'需求证据与产品匹配'},{level:3,text:'可比租金与竞争边界'},{level:3,text:'招租节奏与调整条件'}];
      // All facts are fabricated test fixtures with verified status *inside the
      // synthetic scenario*. They are not records from any real project.
      const facts=[
        {key:'supply',label:'项目供应房源',value:'100套',required:true},
        {key:'area',label:'项目总可租面积',value:'5000平方米',required:false},
        {key:'unique-needs',label:'去重后的项目需求接触对象',value:'66名',required:true},
        {key:'intent',label:'签署入住意向确认的对象',value:'18名',required:true},
        {key:'target-rent',label:'已登记测算起始租金假设',value:'45元/平方米/月',required:true},
        {key:'stabilized-occupancy',label:'已登记稳定期出租率假设',value:'85%',required:true}
      ].map(fact=>({...fact,status:'confirmed',source:'[系统测试]隔离合成事实台账；不属于正式项目',owner:sectionKey}));
      const contract=C.normalize({...section,requiredFacts:facts,requiredHeadings,writingStandard:{config:globalThis.ReportWritingStandard.defaults(),context:{projectType:'gaibao',chapter:'项目市场分析',title:'供需态势与市场结论',profileId:'market',writingLogic:'依据需求证据、产品匹配和同口径竞品解释项目影响，区分测算假设与已落实条件；不能把意向当租约，不能从市场分析直接认定投资可行。'}}});
      const evidence='[系统测试]以下为完全隔离的虚构非居改保案例，事实在本样例内已核验；不是税务局、罗湖或任何正式项目资料。不得写入、采用或替换正式项目。\n'+
        '【产品和区位】城东存量办公楼拟改造100套住房，总可租面积5000平方米；80套为45平方米，20套为70平方米，面积口径不含公共走廊。45平方米产品服务单人及双人租户，70平方米产品面向两人家庭。公交实测工作日高峰到产业园约20分钟，到轨道站步行约12分钟；抽样线路只有两条，未覆盖夜班出行。楼内登记有共享洗衣区和公共活动室，未登记餐饮配套。不要把这些设施写成已竣工、已取得审批或已经运营。\n'+
        '【去重需求及约束】两家企业书面反馈分别36名和22名员工潜在需求；个人登记21名，其中13名与企业名单重复，核查姓名与联系电话后合计66名独立接触对象。只有18名签署不构成租约的入住意向确认；其余48名仅完成问询，均未支付定金，也未签租赁合同。18名意向对象中14名偏好45平方米、4名偏好70平方米，不能把66名全部认定为已落实需求。20份访谈显示12人接受单程通勤不超过30分钟，8人要求不超过20分钟；样本来自企业名单，不能代表片区全体租户。接受租金区间的访谈为40至46元/平方米/月，未测试较长通勤下的同等支付意愿。\n'+
        '【同口径竞品】三个已走访租赁楼宇均为12个月标准租期、含家具的住房产品，租金不包含水电和物业费。A距目标产业园公交约18分钟、面积45至60平方米，现执行租金45元/平方米/月，管理方提供的近三个月平均出租率85%；B通勤约25分钟、面积40至55平方米，42元/平方米/月，出租率80%；C通勤约12分钟、面积50至70平方米，48元/平方米/月，出租率90%。租金已用合同样本核查，但出租率来自各管理方汇总而非独立全量租约审计。A附共享洗衣区，B没有公共活动室，C临近轨道站且配套较完善。三项不能代表完整市场；没有经批准的区位、面积、装修调整系数，不能用简单平均或出租率差异计算确定的本项目租金溢价。\n'+
        '【已登记方案与触发条件】起始租金45元/平方米/月、稳定期出租率85%是财务测算输入假设，不是保证收益或已实际实现的状态。运营启动后前六个月出租率计划依次20%、35%、50%、60%、75%、85%，起算点是正式运营首月，不是建设首月。现有18名意向不能证明首月20套已经落实，更不足以证明稳定期85套能够租出。方案明确将企业团租与个人招租分轨登记：先核查身份和房型，再签约交付；不以名单代替租约。每月分别核对有效新增咨询、预约看房、签约和退租，不叠加跨月重复客户。连续两个月实际出租率低于对应计划10个百分点时，提交原因复核，先区分产品错配、通勤与价格阻力，再审议房型投放及租金调整；不得未经审批自动降低租金或改变已登记财务参数。\n'+
        '【判断边界】没有全区供应总量、竞品未来入市计划及所有客户预算资料，不能推出整体供不应求。没有完整投资现金流、借款偿付、所得税和收益率验收材料，本市场节不能认定项目财务可行或承诺收益。市场结论应解释需求证据与供应规模差距、不同房型的匹配程度、竞品可比与不可比部分、分期出租率计划为什么仍依赖持续转化，并说明触发措施的针对性。只用已给事实推进分析，不外部搜索，不制造人口、就业增速、政策、定价系数或新测算结果。';
      const outputBudget=reportSectionOutputBudget(contract),system=C.structuredPrompt(contract)+'\n这是详实首稿小样，不是摘要返修。按本节职责和约'+contract.requirements.proseTarget+'字建议目标解释必要的比较依据、因果、边界及项目影响；有足量证据，不把三个主题压成几句。不为达到字数复述事实、注水或造数。只输出完整合法blocks JSON，不加围栏、写作说明，不调用工具。';
      // Ordinary /api/generate keeps its 4000-token guard. A larger envelope
      // must be authorized by the exact persisted report contract and run.
      assert.equal(contract.requirements.proseTarget,2383,'Depth fixture must use the current 84k profile');
      assert.equal(outputBudget.maxTokens,13084,'Unexpected current detail output budget');
      const projectId='system-test-report-depth-'+crypto.randomUUID(),name='[系统测试]详实首稿市场分析验收 '+new Date().toISOString();
      assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first(),null);
      depthFixture={projectId,name,ownerId:users[0].id,formalProjectWrites:false,adoption:false,cleanup:'preserved with task and call audit; no formal project deletion'};
      await fs.writeFile(path.join(out,'depth-fixture.json'),JSON.stringify(depthFixture,null,2),{flag:'wx'});
      const created=await request('depth-fixture-create','/api/projects',{id:projectId,name,data:{calcType:'gaibao',project:{name,businessScenario:'housing_conversion'},chapters:[]}},20000);
      assert.equal(created.ok,true);
      const before=await db.prepare('SELECT id,user_id,name,data FROM projects WHERE id=?').bind(projectId).first();
      assert.equal(before?.name,name);assert.equal(Number(before.user_id),Number(users[0].id));
      assert.deepEqual(JSON.parse(before.data).chapters,[],'Test project unexpectedly has an adopted report');
      const input={projectId,projectType:'gaibao',logicVersion:published.set.version,sectionKey,system,user:evidence,qualityContract:contract};
      const started=await request('actual-detailed-market-first-draft','/api/reportexecution',input,20000);
      assert.equal(started.ok,true);assert.ok(started.task?.id);assert.ok(started.task?.runId);
      depthFixture={...depthFixture,taskId:started.task.id,runId:started.task.runId};
      await fs.writeFile(path.join(out,'depth-task.json'),JSON.stringify(depthFixture,null,2),{flag:'wx'});
      const persisted=await db.prepare('SELECT project_id,user_id,input_json FROM report_section_tasks WHERE id=? AND run_id=?').bind(started.task.id,started.task.runId).first();
      assert.equal(persisted?.project_id,projectId);assert.equal(Number(persisted.user_id),Number(users[0].id));
      const snapshot=JSON.parse(persisted.input_json),boundContract=C.normalize(snapshot.qualityContract),boundBudget=reportSectionOutputBudget(boundContract);
      const queued=await db.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(started.task.runId).first(),payload=JSON.parse(queued.payload_json);
      assert.equal(snapshot.outputBudget.maxTokens,outputBudget.maxTokens);assert.deepEqual(snapshot.outputBudget,boundBudget);
      assert.equal(payload.maxTokens,boundBudget.maxTokens);assert.equal(payload.reportSectionTaskId,started.task.id);
      const callStart=Date.now();let generated=started.task;
      while(!['completed','dead','cancelled','invalidated'].includes(generated.status)&&Date.now()-callStart<360000){
        await new Promise(resolve=>setTimeout(resolve,2000));
        const polled=await request('depth-task-read','/api/reportexecution?id='+encodeURIComponent(started.task.id),undefined,20000);
        assert.equal(polled.ok,true);generated=polled.task;
      }
      await fs.writeFile(path.join(out,'depth-task-result.json'),JSON.stringify(generated,null,2),{flag:'wx'});
      assert.equal(generated.status,'completed',generated.error||'Depth task did not finish; preserved for inspection, never auto-resubmitted');
      const ledgers=(await db.prepare('SELECT reserved_output,actual_output,status,response_json FROM agent_call_ledger WHERE run_id=?').bind(started.task.runId).all()).results||[];
      assert.equal(ledgers.length,1,'The first draft must have exactly one billed model call');
      const ledger=ledgers[0],modelResult=JSON.parse(ledger.response_json),governance=await db.prepare('SELECT budget_output_tokens,output_tokens FROM agent_run_governance WHERE run_id=?').bind(started.task.runId).first();
      assert.equal(Number(ledger.reserved_output),boundBudget.maxTokens);assert.equal(ledger.status,'settled');
      assert.equal(Number(governance.budget_output_tokens),boundBudget.chainTokens);assert.equal(Number(governance.output_tokens),Number(ledger.actual_output));
      const after=await db.prepare('SELECT id,user_id,name,data FROM projects WHERE id=?').bind(projectId).first();
      assert.deepEqual(after,before,'Isolated first draft must not adopt or mutate project data');
      const raw=generated.rawText||'',decoded=C.decodeStructured(raw,boundContract),review=C.inspect(decoded.text,boundContract),writingReview=globalThis.ReportWritingStandard.inspect(decoded.text,boundContract.writingStandard.config,boundContract.writingStandard.context),headings=C.headingOutline(decoded.text);
      const measurement={proseTarget:boundContract.requirements.proseTarget,proseHardMax:boundContract.requirements.proseMax,proseCharacters:review.metrics.proseCharacters,totalRenderedCharacters:decoded.text.length,rawCharacters:raw.length,requestedMaxTokens:outputBudget.maxTokens,boundMaxTokens:boundBudget.maxTokens,ledgerReservedOutput:Number(ledger.reserved_output),governanceChainBudget:Number(governance.budget_output_tokens),modelCallCount:ledgers.length,generationDurationMs:Date.now()-callStart,provider:generated.provider,model:generated.model,usage:generated.usage||null,finishReason:modelResult.finishReason||null,truncated:modelResult.truncated===true,qualityStatus:review.status,serverQuality:generated.quality,headings,decodeIssues:decoded.issues,qualityIssues:review.issues,writingIssues:writingReview.issues,depthAdvisory:review.depthAdvisory||null,semanticCertified:false,wholeReportCertified:false,autoRepair:false,formalProjectWrites:false,adoption:false,testFixture:depthFixture};
      checks.push({name:'actual-detailed-market-first-draft-result',ok:true,...measurement});
      await fs.writeFile(path.join(out,'depth-first-draft.json'),JSON.stringify({scope:'isolated synthetic market first draft via durable worker; named test fixture/audit retained, no formal project writes or adoption; not whole-report acceptance',contract:boundContract,evidence,system,outputBudget:boundBudget,raw,decoded,review,writingReview,measurement},null,2),{flag:'wx'});
      await fs.writeFile(path.join(out,'depth-first-draft.txt'),decoded.text,{flag:'wx'});
      console.log(JSON.stringify({name:'depth-first-draft',...measurement}));
      assert.ok(raw.trim(),'First draft is empty');
      assert.equal(measurement.truncated,false,'First draft was truncated; raw preserved, no auto-repair');
      assert.deepEqual(decoded.issues,[],'First draft structured protocol failed; raw preserved, no auto-repair');
      assert.deepEqual(headings,requiredHeadings,'First draft lost the three business headings; raw preserved, no auto-repair');
      assert.notEqual(review.status,'blocked','First draft contract blocked; raw preserved, no auto-repair');
      assert.notEqual(generated.quality?.status,'blocked','Server first-draft quality blocked; raw preserved, no auto-repair');
    }
    if(structureOnly){
      const C=globalThis.ReportCompletionContract;
      const contract=C.normalize({...C.createPlan([{name:'运营方案',sections:[{t:'运营管理'}]}],{projectType:'gaibao'}).sections[0],requiredHeadings:[{level:3,text:'收楼安排'},{level:4,text:'合同约定'},{level:3,text:'运营职责'}]});
      const generated=await request('actual-structured-headings','/api/generate',{kind:'batch',system:C.structuredPrompt(contract)+'\n这是[系统测试]隔离样例。每个主题只写一句简短正文，不凑字数、不调用工具；只输出JSON。',messages:[{role:'user',content:'收楼方式为每月实际租金的20%，合同尚未签署；运营责任待确认。不能认定已落实。按收楼安排、其下合同约定、运营职责三个主题组织。'}],max_tokens:1600},120000);
      const raw=(generated.content||[]).map(x=>x.text||'').join(''),decoded=C.decodeStructured(raw,contract),review=C.inspect(decoded.text,contract);
      await fs.writeFile(path.join(out,'structure-sample.json'),JSON.stringify({raw,decoded,review},null,2),{flag:'wx'});
      assert.deepEqual(decoded.issues,[]);assert.notEqual(review.status,'blocked');assert.deepEqual(C.headingOutline(decoded.text),contract.requiredHeadings);
      checks.at(-1).headings=contract.requiredHeadings;checks.at(-1).qualityStatus=review.status;checks.at(-1).mechanicalWarnings=review.issues.length;checks.at(-1).semanticCertified=false;
      const docx=await fs.readFile(path.join(root,'outputs/report-standardization/0930-structure-qa.docx'));
      const start=Date.now(),response=await fetch(base+'/api/report-pagination',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',accept:'multipart/form-data'},body:docx,signal:AbortSignal.timeout(90000)});
      assert.equal(response.status,200,'Actual Word download preparation failed');
      const form=await response.formData(),receipt=JSON.parse(form.get('receipt'));assert.equal(receipt.ok,true);assert.ok(receipt.pages>0);assert.equal(receipt.toc?.updated,true);
      await fs.writeFile(path.join(out,'prepared-structure.docx'),Buffer.from(await form.get('document').arrayBuffer()),{flag:'wx'});
      checks.push({name:'actual-word-download-preparation',ok:true,durationMs:Date.now()-start,pages:receipt.pages,toc:receipt.toc,contentQualityCertified:false});
    }
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),scope:'real local runtime; isolated synthetic first drafts, not real-report acceptance; no formal project writes or adoption',passed:true,...(depthFixture?{depthFixture}:{}),checks},null,2),{flag:'wx'});
    console.log('PASS '+out);
  }
}catch(error){
  if(!idle){await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'failed.json'),JSON.stringify({at:new Date().toISOString(),checks,...(depthFixture?{depthFixture}:{}),error:error.message},null,2),{flag:'wx'});}
  throw error;
}finally{await db._close();}
