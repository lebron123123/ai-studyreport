import './windows-browser-lockout-guard.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness,checkSourceUnchanged} from './report-generation-acceptance.mjs';
import {applyExactStructureOperations,browserBoundedAdmission} from './report-runner-bounded-repair.mjs';

const ROOT=path.resolve('.'),BASE=path.join(ROOT,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5'),OUT=path.join(BASE,'generation-runner');
const ID='f4395f64-af1b-43bd-b809-580b5ec9406b',NAME='[系统测试]全量报告验收-tax-8c14644b';
const ACTUAL='resume-state-2026-10-13T04-17-49-639Z-47723552-tax-end.json';
const ACTUAL_SHA='4db2223340a4b7674cf9e3d57e3a1061cda8233dd526598bb6eca82dc645318f';
const SOURCE_SHA='9c4a403d3fd047c1d79b81ea296126b5d5b868e4717201b2dc853ff16d4baa99';
export const deterministicSha=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
const clone=value=>JSON.parse(JSON.stringify(value));
const section=(chapters,number)=>{const[c,s]=number.split('.').map(n=>+n-1);return chapters[c].sections[s];};
const actualBody=s=>s.editedHtml||s.content||'';
const selectedBody=s=>s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||actualBody(s);
export function replaceExact(text,from,to){assert(typeof from==='string'&&from&&text.split(from).length===2,'Exact replacement must match once');return text.replace(from,to);}
// Mixed Markdown must start the safe HTML table on its own line. Inline <p>
// before <table> is ordinary escaped text in the existing MD parser.
const table=(title,headers,rows,independent=false)=>title+'\n\n<table'+(independent?' data-report-independent="true"':'')+'><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
const sourceEvidence=(file,sha256,locator)=>({locator:file+(locator?' :: '+locator:''),sha256});

export function buildTaxSummaryStructure(actual,{actualFile,sourceFile}={}){
  const sources=[sourceEvidence(sourceFile,SOURCE_SHA,'state.kb[0] 合作草案附件一、2.1/4.1/9.1；state.kb[1] 请示；state.kb[2] 研究第4—10页；state.kb[3] 房源清单')];
  const rows=[];
  for(const number of ['1.3','1.5']){
    const s=section(actual.chapters,number),before=selectedBody(s);let after=before;
    assert(s.executionTask?.id,'Original paid task identity required');
    if(number==='1.3'){
      assert(actualBody(s)===''&&!!s.pendingRevision?.after,'1.3 must remain the original unaccepted full candidate');
      after=replaceExact(after,'改造按房源现状分两档推进，均以拎包入住为交付目标。银湖半山37套已完成精装修且为使用过状态，因长期空置存在','原研究按当时记录的房源现状提出两档改造路径，均以拎包入住为拟交付目标。银湖半山37套均已完成精装修且为使用过的房源，部分房源因长期空置存在');
      after=replaceExact(after,'松园小区7套中有2套登记房源已拆分为4套一房，属既有改造状态；','原材料记载松园小区7套中有2套登记房源已拆分为4套一房，属于材料记载的既有改造状态，非本次现状核验结果；');
      const gapTitles=['项目名称','项目本体基本情况','改造前户型及物业现状','改造条件与政策符合性'];
      const gaps=gapTitles.map(title=>title+'资料待核验，相关判断暂不作确定性结论。');
      for(const gap of gaps)after=replaceExact(after,'\n\n'+gap,'');
      const scale=table('项目规模指标表',['点位','原产权套数','建筑面积（平方米）'],[
        ['银湖半山','37','4249.9'],['宝泉庄','3','419.63'],['松园小区','7','584.76'],['碧波花园','1','121.92'],['愉天小区','2','130.6'],['梅兴苑','1','114.34'],['合计','51','5621.15']
      ]);
      const types=table('改造前户型及物业现状表',['房型','原产权套数','建筑面积（平方米）','材料记载现状'],[
        ['2房','6','541.74','银湖半山；原研究记载已精装并使用过，部分损坏'],['3房','43','4684.67','含银湖29套及其余14套；现状须逐套复核'],['4房','1','125.03','银湖半山；原研究记载已精装并使用过'],['6房复式','1','269.71','银湖半山；原研究记载已精装并使用过'],['合计','51','5621.15','原产权口径；松园拆分单元及合法性待核']
      ]);
      after+='\n\n### 项目名称\n\n当前项目登记名称为“市税务局第一批合作房源改造为保障性租赁住房项目”，用于识别本批合作房源，不等同于已批准的立项名称。'+gaps[0];
      after+='\n\n### 项目本体基本情况\n\n下表按合作草案附件及原房源清单列示合作规模，不代表权属、测绘及当前可交付状态已核验。\n\n'+scale+'\n\n'+gaps[1];
      after+='\n\n### 改造前户型及物业现状\n\n下表汇总原产权清单房型；松园登记房源的既有拆分不改变原产权套数，实际运营单元须另核。层高、得房率及当前逐套物业状况未取得有效核验资料。\n\n'+types+'\n\n'+gaps[2];
      after+='\n\n### 改造条件与政策符合性\n\n前述纳保户型、单点规模、权属及协议条件须结合有效政策和主管部门书面意见闭合；原材料提出的整体纳保路径不是认定结果。'+gaps[3];
    }else{
      assert(deterministicSha(before)==='058e793ba976462a6be5930e2b0a3ceee71f86bf7da0f26ca0aeaccf02a82d4a','1.5 exact original body changed');
      after=replaceExact(after,'改造按房源现状分两档推进：银湖半山37套已完成精装修','原研究按当时记录的房源现状提出两档改造路径：银湖半山37套已完成精装修');
      after=replaceExact(after,'投资估算存在三个不同口径','投资估算存在两个不同口径');
      after=replaceExact(after,'第三，项目登记投资规模13892万元与上述两个口径的关系及构成尚未说明，不能相互替代。','本节不采用缺少原始材料支持的其他投资额；全口径批准总投资仍待补。');
      after=replaceExact(after,'这意味着总投资控制并不由房源数量或面积主导，而由老旧房源的改造深度决定。','这表明老旧房源的改造深度对投资控制有重要影响，不能仅按房源数量或面积判断成本。');
      after=replaceExact(after,'构成总投资的主要不确定来源','构成总投资的重要不确定来源之一');
      after=replaceExact(after,'全周期总收入1116.78万元','本次测算期总收入1116.78万元');
      after=replaceExact(after,'若租金下降与装修造价上升同时发生，IRR存在跌破8%的可能，该组合情景未在单因素分析中体现。','租金下降与装修造价上升同时发生的组合情景尚未测算，不能据此判断是否跌破8%，后续需另行计算。');
      after=replaceExact(after,'松园西街104、105两套登记房源已有拆分现状：','原材料记载松园西街104、105两套登记房源已有拆分现状，尚非本次现状核验结果：');
      after=replaceExact(after,'该权利行使将占用可对外出租房源，影响租金收入的可预期性。','该权利可能影响可出租资源配置和投资方留存收益，影响程度取决于最终条款及匹配房源安排。');
      const frozen=before.match(/<table\b[^>]*data-report-calc-kind="investment"[\s\S]*?<\/table>/g);
      assert(frozen?.length===1&&deterministicSha(frozen[0])==='1e36ea5d1692fc735e5040baed9c26be0107b4bc236adbdf33b8a7dc44adf4d2','Exact frozen investment table required');
      after=replaceExact(after,'\n\n'+frozen[0],'');
      after=replaceExact(after,'\n\n投资估算与经济效益资料待核验，相关判断暂不作确定性结论。','\n\n投资估算表\n\n'+frozen[0]+'\n\n投资估算与经济效益资料待核验，相关判断暂不作确定性结论。');
      const beforeTypes=table('改造前户型及物业现状表',['房型','层高','套数','建筑面积（平方米）','得房率'],[
        ['2房','待核','6','541.74','待核'],['3房','待核','43','4684.67','待核'],['4房','待核','1','125.03','待核'],['6房复式','待核','1','269.71','待核'],['合计（原产权）','待核','51','5621.15','待核']
      ],true);
      const afterTypes=table('改造后户型及房源表',['房型','层高','套数','建筑面积（平方米）','得房率'],[
        ['银湖：改造后房型待核','待核','37（原产权）','4249.9（原产权）','待核'],['其余5小区：改造后房型待核','待核','14（原产权）','1371.25（原产权）','待核'],['合计：实际运营单元待核','待核','51（原产权）','5621.15（原产权）','待核']
      ],true);
      const marker='\n\n### 改造目标及改造后户型\n\n';
      const at=after.indexOf(marker);assert(at>=0,'Housing subsection required');
      const ending=after.indexOf('\n\n### 投资估算与经济效益',at);assert(ending>=0,'Following subsection required');
      const para=after.slice(at+marker.length,ending);
      after=after.slice(0,at)+marker+para+'\n\n'+beforeTypes+'\n\n改造后房型、单元数及面积未经方案认定，以下仅以两组原产权规模说明待核范围，不将其冒充已批准的改造后户型。\n\n'+afterTypes+after.slice(ending);
      assert(after.split(frozen[0]).length===2,'Frozen investment bytes must remain once');
    }
    const edited=applyExactStructureOperations(before,{bodySha256:deterministicSha(before),operations:[{offset:0,exactHtml:before,replacementHtml:after}]});
    rows.push({key:'tax:'+number,projectId:ID,taskId:s.executionTask.id,actualBodySha256:deterministicSha(actualBody(s)),bodySha256:deterministicSha(before),operations:[{offset:0,exactHtml:before,replacementHtml:after}],expectedAfterSha256:edited.afterSha256,sources,notFormatOnly:true,semanticReviewRequired:true,factsVerified:false,originalPaidTaskUnchanged:true,originalCandidatePreserved:true});
  }
  return {version:'evidence-backed-tax-summary-exact-recovery-v1',actualFile,actualSha256:ACTUAL_SHA,sourceFile,sourceSha256:SOURCE_SHA,projectId:ID,projectName:NAME,rows,newPaidAiCalls:0,projectWrites:0,notAccepted:true,notSemanticCertification:true};
}

async function wx(name,value){const file=path.join(OUT,name),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(file,bytes,{flag:'wx'});assert(deterministicSha(await fs.readFile(file))===deterministicSha(bytes),'Immutable output readback failed');return {file,sha256:deterministicSha(bytes),bytes:bytes.length};}
async function exact(file,expected){const bytes=await fs.readFile(file);assert(deterministicSha(bytes)===expected,'Frozen input changed: '+path.basename(file));return JSON.parse(bytes);}

export function correctTax93FinancialText(text){
  text=replaceExact(text,'若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。','租金下降与装修造价上升同时发生的组合情景尚未测算，不能据所列单因素情景判断是否跌破8%；后续如需判断，应另行开展组合情景测算。');
  return replaceExact(text,'各年净现金流应另按工程付款、融资本息、税费等现金项目核对','各年净现金流应另按工程实际付款、收楼及运营支出、利息和税费等项目现金流核对；归还本金另列还本付息表，不重复计入项目IRR现金流');
}

export function buildTax93ParagraphCorrections(body){
  const changes=[
    ['tax-93-no-unmeasured-combined-threshold','若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。','租金下降与装修造价上升同时发生的组合情景尚未测算，不能据所列单因素情景判断是否跌破8%；后续如需判断，应另行开展组合情景测算。'],
    ['tax-93-project-cashflow-interest-not-principal','各年净现金流应另按工程付款、融资本息、税费等现金项目核对','各年净现金流应另按工程实际付款、收楼及运营支出、利息和税费等项目现金流核对；归还本金另列还本付息表，不重复计入项目IRR现金流']
  ];
  const paragraphs=[...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match=>match[1]);
  return changes.map(([id,from,to])=>{
    const matches=paragraphs.filter(text=>text.includes(from));
    assert(matches.length===1,'Exact ordinary paragraph required: '+id);
    const quote=matches[0];assert(!/[<&]/.test(quote),'Plain paragraph text required: '+id);
    const replacementText=replaceExact(quote,from,to);
    assert(body.split(quote).length===2,'Full paragraph must match once: '+id);
    return {key:'tax:9.3',id,quote,replacementText,quoteSha256:deterministicSha(quote),replacementSha256:deterministicSha(replacementText)};
  });
}

export async function prepareTax93Paragraphs(){
  const name='resume-state-2026-10-13T07-41-06-581Z-14533379-tax-end.json',sha256='db63e90f07c96a405b7a37e21fe7225c066ecc3fa13ab6ed9322b3d590933ddf';
  const file=path.join(OUT,name),actual=await exact(file,sha256),s=section(actual.chapters,'9.3'),body=actualBody(s),calcFile=path.join(ROOT,'nrcalc.js'),calcSha=deterministicSha(await fs.readFile(calcFile));
  const corrections=buildTax93ParagraphCorrections(body).map(row=>({...row,sources:[sourceEvidence(file,sha256,'actual9.4 单因素敏感性表，未求组合或盈亏临界值'),sourceEvidence(path.join(BASE,'tax-source.json'),SOURCE_SHA,'原KB不含组合计算结果'),sourceEvidence(calcFile,calcSha,'项目现金流含利息，不重复扣本金')],reason:'撤回未实算组合阈值；项目现金流与本金偿还分表，原数字、标题及全部表格不变。'}));
  let after=body;for(const row of corrections)after=replaceExact(after,row.quote,row.replacementText);
  assert(after===correctTax93FinancialText(body),'Only the two independently reviewed sentences may change');
  return wx('tax93-exact-two-paragraph-source-v3-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{version:'tax93-exact-two-paragraph-source-v3',actualFile:file,actualSha256:sha256,projectId:ID,sectionPreconditions:[{key:'tax:9.3',projectId:ID,taskId:s.executionTask?.id||null,actualBodySha256:deterministicSha(body),bodySha256:deterministicSha(selectedBody(s))}],corrections,expectedAfterSha256:deterministicSha(after),newPaidAiCalls:0,projectWrites:0,notAccepted:true,notSemanticCertification:true});
}

export function repairEscapedTax17GapBoundary(text){
  const from='<p style="margin:0 0 10px;">&lt;div class="report-gap-boundaries"&gt;&lt;p&gt;&lt;strong&gt;资料核验边界（未定位到具体主题）&lt;/strong&gt;&lt;/p&gt;&lt;p&gt;问题、建议与结论资料待核验，相关判断暂不作确定性结论。&lt;/p&gt;&lt;/div&gt;</p>';
  const to='<div class="report-gap-boundaries"><p><strong>资料核验边界（未定位到具体主题）</strong></p><p>问题、建议与结论资料待核验，相关判断暂不作确定性结论。</p></div>';
  return {from,to,after:replaceExact(text,from,to)};
}

export async function prepareTax17GapBoundary(){
  const name='resume-state-2026-10-13T07-36-02-976Z-343bb4f5-tax-end.json',sha256='ce20ef279edcccb269d7e3a13c42481ad9558a4e4e97486f1f5155b67af2316b';
  const file=path.join(OUT,name),actual=await exact(file,sha256),s=section(actual.chapters,'1.7'),body=actualBody(s),fixed=repairEscapedTax17GapBoundary(body);
  const proposal={version:'tax17-exact-escaped-gap-preserve-v1',actualFile:file,actualSha256:sha256,projectId:ID,rows:[{key:'tax:1.7',projectId:ID,taskId:s.executionTask?.id||null,actualBodySha256:deterministicSha(body),bodySha256:deterministicSha(selectedBody(s)),operations:[{offset:body.indexOf(fixed.from),exactHtml:fixed.from,replacementHtml:fixed.to}],expectedAfterSha256:deterministicSha(fixed.after),factsVerified:false,semanticReviewRequired:true,source:'Exact existing boundary words retained; only escaped structural tags restored.',notFormatOnly:false}],newPaidAiCalls:0,projectWrites:0,notAccepted:true};
  return wx('tax17-exact-escaped-gap-preserve-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',proposal);
}

export async function prepareTaxSummaryDeterministic(){
  const actualFile=path.join(OUT,ACTUAL),sourceFile=path.join(BASE,'tax-source.json');
  const actual=await exact(actualFile,ACTUAL_SHA);await exact(sourceFile,SOURCE_SHA);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
  const structure=buildTaxSummaryStructure(actual,{actualFile,sourceFile});
  const structureReceipt=await wx('tax-summary-13-15-exact-recovery-'+stamp+'.json',structure);
  const oldReviewFile=path.join(OUT,'independent-tax-summary-source-167-122-20261013.json');
  const oldReview=await exact(oldReviewFile,'9ca15265e18c00ebeabd7be930a62230c1dd3cc796e574ec905828c59e8c48a5');
  const source=clone(oldReview),last=source.corrections.find(row=>row.id==='tax-122-investment-after-all-prerequisites');
  assert(deterministicSha(last.replacementText)==='1ddef570091ea332a80eb6853deacd653cca89eb35d60604668eb5c10213c143','Independently reviewed replacement changed');
  last.replacementText=replaceExact(last.replacementText,'建议按以下顺序推进：','建议落实以下工作：');last.replacementSha256=deterministicSha(last.replacementText);
  assert(last.replacementSha256==='e9650bd24b0b46cee4538990153afdf41ba42778e3b88619ca1cbf2cb1c62cb3','Exact residual correction changed');
  source.originalIndependentReview={file:oldReviewFile,sha256:'9ca15265e18c00ebeabd7be930a62230c1dd3cc796e574ec905828c59e8c48a5'};
  source.sectionPreconditions=['1.6','1.7','12.2'].map(number=>{const s=section(actual.chapters,number);return {key:'tax:'+number,projectId:ID,taskId:s.executionTask?.id||null,actualBodySha256:deterministicSha(actualBody(s)),bodySha256:deterministicSha(selectedBody(s))};});
  source.residualCorrection={reason:'工作清单非实施先后顺序，保留各项生效/交付前提；原件不变',newPaidAiCalls:0,notAccepted:true};
  const sourceReceipt=await wx('tax-summary-167-122-exact-source-v2-'+stamp+'.json',source);
  const s93=section(actual.chapters,'9.3'),body93=actualBody(s93),from='若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。';
  assert(body93.split(from).length===2,'9.3 original unsupported combination must match once');
  const quote=body93.split('\n\n').find(p=>p.includes(from));assert(quote&&!quote.startsWith('<table'),'9.3 full ordinary paragraph required');
  const replacementText=correctTax93FinancialText(quote);
  const s94=section(actual.chapters,'9.4');
  const calcFile=path.join(ROOT,'nrcalc.js'),calcSha=deterministicSha(await fs.readFile(calcFile));
  const financialSource={version:'tax-93-unmeasured-combination-exact-source-v2',actualFile,actualSha256:ACTUAL_SHA,notAccepted:true,notSemanticCertification:true,newPaidAiCalls:0,projectWrites:0,sectionPreconditions:[{key:'tax:9.3',projectId:ID,taskId:s93.executionTask?.id||null,actualBodySha256:deterministicSha(body93),bodySha256:deterministicSha(selectedBody(s93))}],corrections:[{key:'tax:9.3',id:'tax-93-no-unmeasured-combined-threshold-and-project-cashflow',quote,replacementText,quoteSha256:deterministicSha(quote),replacementSha256:deterministicSha(replacementText),sources:[sourceEvidence(actualFile,ACTUAL_SHA,'chapters[8].sections[3] actual9.4 单因素敏感性表，未求组合或盈亏临界值'),sourceEvidence(sourceFile,SOURCE_SHA,'原KB不含该组合计算结果'),sourceEvidence(calcFile,calcSha,'348–366 项目现金流包含财务费用利息，不重复扣还本')],reason:'撤回未实算组合阈值，区分项目现金流利息与本金偿还；保留原数字、其他分析和全部表格。'}]};
  const financeReceipt=await wx('tax93-unmeasured-combination-exact-source-'+stamp+'.json',financialSource);
  return {structure:structureReceipt,source:sourceReceipt,financialFinding:financeReceipt,newPaidAiCalls:0,projectWrites:0,notAccepted:true};
}

export async function dryRunTaxSummaryStructure(proposalFile){
  const bytes=await fs.readFile(proposalFile),proposal=JSON.parse(bytes);assert(proposal.projectId===ID&&proposal.rows?.length===2,'Exact two-section proposal required');
  const snapshot=await loadSnapshots(BASE),isolation=await loadIsolation(snapshot),session=isolation.sessions.tax;
  assert(session.target.id===ID&&session.target.name===NAME,'Exact retained Tax copy required');
  const formalBefore={};for(const key of Object.keys(snapshot.sources))formalBefore[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);
  assert(Object.values(formalBefore).every(Boolean),'Formal source changed');
  const remoteBefore=await session.request('/api/projects?id='+ID),checkpointBefore=await fs.readFile(path.join(OUT,'checkpoint.json'));
  let h;const results=[];let error=null;
  try{
    h=await openProductionHarness(isolation,'tax',{readOnly:true,allowAi:false});
    await h.page.evaluate(()=>{window.__qaDispatchPaused=true;});
    await h.page.evaluate(id=>openAiReportProject(id),ID);
    await h.page.waitForFunction(()=>aiReportChatLoaded&&!aiReportRestoreLoading,{timeout:60000});
    await h.page.evaluate(async()=>{await ReportLogicCore.load(rlProjectType());await ensureReportTableTemplates();persistReportDraft=async()=>({ok:true,remote:true,offlineSimulation:true});});
    const state=await h.page.evaluate(()=>({identity:reportCandidateInputIdentity(),plan:reportCompletionPlan(),chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),financial:reportFinancialIdentity()}));
    for(const row of proposal.rows){
      const number=row.key.split(':')[1],prep=await h.page.evaluate(number=>{const[ci,si]=number.split('.').map(x=>+x-1),s=chapters[ci].sections[si];return {text:s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||'',sourceIdentity:reportCandidateInputIdentity(),originalSection:ProjectWorkflow.clone(s),taskId:s.executionTask?.id||null};},number);
      assert(prep.taskId===row.taskId&&deterministicSha(prep.text)===row.bodySha256,'Current selected body/task changed: '+number);
      const after=applyExactStructureOperations(prep.text,row).after;
      const result=await h.page.evaluate(browserBoundedAdmission,{expected:ID,number,prep,text:after,proof:{version:'independent-exact-structure-recovery-v1',semanticReviewRequired:true,newPaidAiCalls:0,untargetedBytesPreserved:true,notOriginalAiReceipt:true,offlineSimulation:true,factsVerified:false}});
      const tableAudit=await h.page.evaluate(({expected,actual})=>{
        const signatures=text=>[...(text.match(/<table\b[\s\S]*?<\/table>/g)||[])].map(html=>{
          const table=new DOMParser().parseFromString(html,'text/html').querySelector('table');
          const identity={};for(const a of table.attributes)if(/^data-report-calc-/.test(a.name))identity[a.name]=a.value;
          return {identity,rows:[...table.rows].map(tr=>[...tr.cells].map(td=>({tag:td.tagName,text:td.textContent,rowSpan:td.rowSpan,colSpan:td.colSpan})))};
        });
        const before=signatures(expected),after=signatures(actual),escapedTable=/&lt;\/?(?:table|thead|tbody|tr|th|td)\b/i.test(actual);
        return {passed:!escapedTable&&before.length>0&&JSON.stringify(before)===JSON.stringify(after),escapedTable,expected:before,actual:after};
      },{expected:after,actual:result.content||''});
      results.push({number,result,tableAudit,proposalAfterSha256:deterministicSha(after),actualAfterSha256:deterministicSha(result.content||''),notRemoteSaved:true});
    }
    const final=await h.page.evaluate(()=>({identity:reportCandidateInputIdentity(),chapters:ProjectWorkflow.clone(chapters),workflow:ProjectWorkflow.clone(projectWorkflow),financial:reportFinancialIdentity()}));
    assert(final.identity===state.identity&&deterministicSha(final.workflow)===deterministicSha(state.workflow)&&deterministicSha(final.financial)===deterministicSha(state.financial),'Semantic source/workflow/financial identity changed');
    for(let ci=0;ci<state.chapters.length;ci++)for(let si=0;si<state.chapters[ci].sections.length;si++)if(!(ci===0&&[2,4].includes(si)))assert(deterministicSha(state.chapters[ci].sections[si])===deterministicSha(final.chapters[ci].sections[si]),'Untargeted section changed');
    for(const result of results){const before=section(state.chapters,result.number),after=section(final.chapters,result.number);assert(deterministicSha(before.executionTask)===deterministicSha(after.executionTask),'Original paid task changed');}
    results.push({finalSourceUnchanged:true,untargetedSectionsUnchanged:41,originalTasksUnchanged:true,initialPlanId:state.plan.planId,finalPlanId:await h.page.evaluate(()=>reportCompletionPlan().planId)});
    assert(!h.errors.length&&!h.ledger.some(row=>row.isAi&&row.allowed),'Read-only harness attempted unexpected write/AI');
  }catch(caught){error={name:caught.name,message:caught.message};}
  finally{if(h)await h.close();}
  const remoteAfter=await session.request('/api/projects?id='+ID),formalAfter={};for(const key of Object.keys(snapshot.sources))formalAfter[key]=await checkSourceUnchanged(snapshot.sources[key].sourceIdentity);
  assert(deterministicSha(remoteBefore)===deterministicSha(remoteAfter),'Remote project changed during offline admission');assert(deterministicSha(checkpointBefore)===deterministicSha(await fs.readFile(path.join(OUT,'checkpoint.json'))),'Checkpoint changed during offline admission');
  assert(Object.values(formalAfter).every(Boolean),'Formal source changed after offline admission');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
  const rows=results.filter(row=>row.number),technicalPassed=!error&&rows.length===2&&rows.every(row=>row.result.status==='semantic-review-pending'&&!row.result.errors?.length&&row.result.content?.trim()&&row.tableAudit.passed);
  const receipt=await wx('tax-summary-13-15-real-admission-dryrun-'+stamp+'.json',{version:'tax-summary-real-admission-readonly-dryrun-v1',at:new Date().toISOString(),proposalFile,proposalSha256:deterministicSha(bytes),results,error,technicalPassed,formalBefore,formalAfter,remoteUnchanged:true,checkpointUnchanged:true,newPaidAiCalls:0,projectWrites:0,notAdopted:true,notSemanticCertification:true});
  return {...receipt,error,technicalPassed,rows:rows.map(row=>({number:row.number,status:row.result.status,errors:row.result.errors,tableAuditPassed:row.tableAudit.passed,actualAfterSha256:row.actualAfterSha256}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  const run=args.length===1&&args[0]==='--prepare-93'?prepareTax93Paragraphs():args.length===1&&args[0]==='--prepare-gap17'?prepareTax17GapBoundary():args.length===1&&args[0]==='--prepare'?prepareTaxSummaryDeterministic():args.length===2&&args[0]==='--dry-run'?dryRunTaxSummaryStructure(path.resolve(args[1])):args.length===0?Promise.resolve({status:'not-executed',newPaidAiCalls:0,projectWrites:0}):Promise.reject(Error('Only --prepare, --prepare-gap17, --prepare-93 or --dry-run FILE is allowed; no write/AI mode exists'));
  run.then(result=>{console.log(JSON.stringify(result));if(result.technicalPassed===false)process.exitCode=2;}).catch(error=>{console.error(JSON.stringify({error:error.message,newPaidAiCalls:0,projectWrites:0}));process.exitCode=1;});
}
