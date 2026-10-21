import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildTaxSummaryStructure,replaceExact,correctTax93FinancialText,buildTax93ParagraphCorrections,repairEscapedTax17GapBoundary} from '../scripts/report-tax-summary-deterministic.mjs';
import {applyExactStructureOperations} from '../scripts/report-runner-bounded-repair.mjs';

// These tests call only the pure proposal builder, never prepare/dry-run/admission.
const base=new URL('../outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/',import.meta.url);
const actualFile=new URL('generation-runner/resume-state-2026-10-13T04-17-49-639Z-47723552-tax-end.json',base);
const sourceFile=new URL('tax-source.json',base);
const actualBytes=fs.readFileSync(actualFile),sourceBytes=fs.readFileSync(sourceFile);
const actual=JSON.parse(actualBytes),source=JSON.parse(sourceBytes);
const options={actualFile:fileURLToPath(actualFile),sourceFile:fileURLToPath(sourceFile)};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const copy=value=>structuredClone(value);
const count=(text,quote)=>text.split(quote).length-1;
const section=(state,number)=>{const[c,s]=number.split('.').map(n=>Number(n)-1);return state.chapters[c].sections[s];};
const actualBody=s=>s.editedHtml||s.content||'';
const selectedBody=s=>s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||actualBody(s);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const build=state=>buildTaxSummaryStructure(state||actual,options);
function result(number){const proposal=build(),row=proposal.rows.find(r=>r.key==='tax:'+number);return {proposal,row,before:selectedBody(section(actual,number)),after:applyExactStructureOperations(selectedBody(section(actual,number)),row).after};}
function subsection(text,title){const marker='### '+title+'\n\n',start=text.indexOf(marker);assert.ok(start>=0,'missing subsection '+title);const end=text.indexOf('\n\n### ',start+marker.length);return text.slice(start+marker.length,end<0?text.length:end);}
function namedTable(text,title){const marker=title+'\n\n';assert.equal(count(text,marker),1);const found=text.slice(text.indexOf(marker)+marker.length).match(/^<table\b[^>]*>[\s\S]*?<\/table>/);assert.ok(found,'table must immediately follow its title');return found[0];}
const tableRows=text=>[...text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map(cell=>cell[1]));
const headings13=['项目名称','项目本体基本情况','改造前户型及物业现状','改造条件与政策符合性'];
const gaps13=headings13.map(title=>title+'资料待核验，相关判断暂不作确定性结论。');

test('9.3 source corrections pin two full plain paragraphs, not their enclosing HTML',()=>{
  const current=JSON.parse(fs.readFileSync(new URL('generation-runner/resume-state-2026-10-13T07-41-06-581Z-14533379-tax-end.json',base))),body=actualBody(section(current,'9.3'));
  const rows=buildTax93ParagraphCorrections(body);assert.equal(rows.length,2);
  let after=body;for(const row of rows){assert.ok(!/[<&]/.test(row.quote));assert.equal(count(body,row.quote),1);after=replaceExact(after,row.quote,row.replacementText);}
  assert.equal(after,correctTax93FinancialText(body));
  assert.deepEqual(after.match(/<table\b[\s\S]*?<\/table>/g),body.match(/<table\b[\s\S]*?<\/table>/g));
  assert.deepEqual(after.match(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/g),body.match(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/g));
  assert.throws(()=>buildTax93ParagraphCorrections(body+body),/paragraph required/);
  assert.throws(()=>buildTax93ParagraphCorrections(body.replace(rows[0].quote,'<strong>'+rows[0].quote+'</strong>')),/Plain paragraph/);
  assert.throws(()=>buildTax93ParagraphCorrections(after),/paragraph required/);
});

test('1.7 escaped fixed boundary repair preserves all words and all other bytes',()=>{
  const current=JSON.parse(fs.readFileSync(new URL('generation-runner/resume-state-2026-10-13T07-36-02-976Z-343bb4f5-tax-end.json',base))),body=actualBody(section(current,'1.7'));
  const fixed=repairEscapedTax17GapBoundary(body);
  assert.equal(fixed.after.replace(fixed.to,fixed.from),body);
  assert.equal(fixed.from.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),fixed.to);
  assert.throws(()=>repairEscapedTax17GapBoundary(body+body),/match once/);
  assert.throws(()=>repairEscapedTax17GapBoundary(fixed.after),/match once/);
});
const facts13=[
  ['改造按房源现状分两档推进，均以拎包入住为交付目标。银湖半山37套已完成精装修且为使用过状态，因长期空置存在','原研究按当时记录的房源现状提出两档改造路径，均以拎包入住为拟交付目标。银湖半山37套均已完成精装修且为使用过的房源，部分房源因长期空置存在'],
  ['松园小区7套中有2套登记房源已拆分为4套一房，属既有改造状态；','原材料记载松园小区7套中有2套登记房源已拆分为4套一房，属于材料记载的既有改造状态，非本次现状核验结果；']
];
const facts15=[
  ['改造按房源现状分两档推进：银湖半山37套已完成精装修','原研究按当时记录的房源现状提出两档改造路径：银湖半山37套已完成精装修'],
  ['投资估算存在三个不同口径','投资估算存在两个不同口径'],
  ['第三，项目登记投资规模13892万元与上述两个口径的关系及构成尚未说明，不能相互替代。','本节不采用缺少原始材料支持的其他投资额；全口径批准总投资仍待补。'],
  ['这意味着总投资控制并不由房源数量或面积主导，而由老旧房源的改造深度决定。','这表明老旧房源的改造深度对投资控制有重要影响，不能仅按房源数量或面积判断成本。'],
  ['构成总投资的主要不确定来源','构成总投资的重要不确定来源之一'],
  ['全周期总收入1116.78万元','本次测算期总收入1116.78万元'],
  ['若租金下降与装修造价上升同时发生，IRR存在跌破8%的可能，该组合情景未在单因素分析中体现。','租金下降与装修造价上升同时发生的组合情景尚未测算，不能据此判断是否跌破8%，后续需另行计算。'],
  ['松园西街104、105两套登记房源已有拆分现状：','原材料记载松园西街104、105两套登记房源已有拆分现状，尚非本次现状核验结果：'],
  ['该权利行使将占用可对外出租房源，影响租金收入的可预期性。','该权利可能影响可出租资源配置和投资方留存收益，影响程度取决于最终条款及匹配房源安排。']
];
const originalUnits=source.state.kb[3].content.split(/\r?\n/).flatMap(line=>{
  const m=line.match(/^\d+,.*,(?:罗湖区|福田区),(\d+(?:\.\d+)?),居住用房,(\d+)房,待出租$/);
  return m?[{line,areaCents:Math.round(Number(m[1])*100),rooms:Number(m[2])}]:[];
});
const unitTotals=units=>[String(units.length),(units.reduce((sum,u)=>sum+u.areaCents,0)/100).toString()];

test('real 04:17 actual and original source are pinned, not substitute projections',()=>{
  assert.equal(sha(actualBytes),'4db2223340a4b7674cf9e3d57e3a1061cda8233dd526598bb6eca82dc645318f');
  assert.equal(sha(sourceBytes),'9c4a403d3fd047c1d79b81ea296126b5d5b868e4717201b2dc853ff16d4baa99');
  assert.equal(actualBody(section(actual,'1.3')),'');
  assert.ok(section(actual,'1.3').pendingRevision.after);
  assert.equal(sha(selectedBody(section(actual,'1.5'))),'058e793ba976462a6be5930e2b0a3ceee71f86bf7da0f26ca0aeaccf02a82d4a');
  assert.deepEqual(unitTotals(originalUnits),['51','5621.15']);
});

test('proposal retains exact paid identities and remains explicitly unaccepted and uncertified',()=>{
  const proposal=build();assert.deepEqual(proposal.rows.map(r=>r.key),['tax:1.3','tax:1.5']);
  assert.equal(proposal.newPaidAiCalls,0);assert.equal(proposal.projectWrites,0);
  assert.equal(proposal.notAccepted,true);assert.equal(proposal.notSemanticCertification,true);
  for(const row of proposal.rows){const s=section(actual,row.key.split(':')[1]);
    assert.equal(row.taskId,s.executionTask.id);assert.equal(row.actualBodySha256,sha(actualBody(s)));
    assert.equal(row.bodySha256,sha(selectedBody(s)));assert.equal(row.operations.length,1);
    assert.equal(row.operations[0].offset,0);assert.equal(row.operations[0].exactHtml,selectedBody(s));
    assert.equal(row.expectedAfterSha256,sha(row.operations[0].replacementHtml));
    assert.equal(row.originalPaidTaskUnchanged,true);assert.equal(row.originalCandidatePreserved,true);
    assert.equal(row.semanticReviewRequired,true);assert.equal(row.factsVerified,false);
  }
});

test('repeated builds leave every actual, candidate, task and input file byte unchanged',()=>{
  const input=freeze(copy(actual)),before=JSON.stringify(input);
  const tasks=['1.3','1.5'].map(n=>JSON.stringify(section(input,n).executionTask));
  assert.deepEqual(build(input),build(input));assert.equal(JSON.stringify(input),before);
  assert.deepEqual(['1.3','1.5'].map(n=>JSON.stringify(section(input,n).executionTask)),tasks);
  assert.deepEqual(fs.readFileSync(actualFile),actualBytes);assert.deepEqual(fs.readFileSync(sourceFile),sourceBytes);
});

test('1.3 adds four necessary headings and exactly two actual table structures',()=>{
  const {before,after}=result('1.3');
  for(const title of headings13)assert.equal(count(after,'### '+title+'\n\n'),1);
  for(const heading of before.match(/^### .+$/gm))assert.equal(count(after,heading+'\n\n'),1);
  assert.equal((after.match(/<table\b/g)||[]).length,2);
  assert.equal((after.match(/<\/table>/g)||[]).length,2);
  assert.match(subsection(after,'项目名称'),/不等同于已批准的立项名称/);
});

test('1.3 preserves all original substantive bytes except the two specified fact corrections',()=>{
  const {before,after}=result('1.3');let expected=before;
  for(const[from,to]of facts13){assert.equal(count(expected,from),1);expected=expected.replace(from,to);}
  for(const gap of gaps13){assert.equal(count(expected,'\n\n'+gap),1);expected=expected.replace('\n\n'+gap,'');}
  assert.equal(after.slice(0,after.indexOf('\n\n### 项目名称\n\n')),expected);
});

test('1.3 relocates each generic gap exactly once under its corresponding new heading',()=>{
  const {after}=result('1.3');
  for(let i=0;i<gaps13.length;i++){assert.equal(count(after,gaps13[i]),1);assert.ok(subsection(after,headings13[i]).includes(gaps13[i]));}
});

test('1.3 scale and housing tables agree with the original property records, not split operating units',()=>{
  const {after}=result('1.3');
  const scale=tableRows(namedTable(after,'项目规模指标表'));
  assert.deepEqual(scale[0],['点位','原产权套数','建筑面积（平方米）']);
  for(const site of ['银湖半山','宝泉庄','松园小区','碧波花园','愉天小区','梅兴苑']){
    assert.deepEqual(scale.find(row=>row[0]===site).slice(1),unitTotals(originalUnits.filter(u=>u.line.includes(site==='松园小区'?'松园西街':site))));
  }
  assert.deepEqual(scale.at(-1),['合计',...unitTotals(originalUnits)]);
  const types=tableRows(namedTable(after,'改造前户型及物业现状表'));
  for(const rooms of [2,3,4,6])assert.deepEqual(types.find(row=>row[0]===(rooms===6?'6房复式':rooms+'房')).slice(1,3),unitTotals(originalUnits.filter(u=>u.rooms===rooms)));
  assert.deepEqual(types.at(-1).slice(1,3),unitTotals(originalUnits));
  assert.match(types.at(-1)[3],/原产权口径；松园拆分单元及合法性待核/);
});

test('1.5 frozen investment table occurs byte-for-byte once in investment, not housing',()=>{
  const {before,after}=result('1.5');
  const frozen=before.match(/<table\b[^>]*data-report-calc-kind="investment"[\s\S]*?<\/table>/g);
  assert.equal(frozen.length,1);assert.equal(sha(frozen[0]),'1e36ea5d1692fc735e5040baed9c26be0107b4bc236adbdf33b8a7dc44adf4d2');
  assert.equal(count(after,frozen[0]),1);assert.equal((after.match(/data-report-calc-kind="investment"/g)||[]).length,1);
  assert.equal(namedTable(after,'投资估算表'),frozen[0]);
  const investment=subsection(after,'投资估算');assert.ok(investment.includes('投资估算表\n\n'+frozen[0]));
  assert.ok(investment.indexOf(frozen[0])<investment.indexOf('投资估算与经济效益资料待核验'));
  assert.ok(!subsection(after,'改造目标及改造后户型').includes(frozen[0]));
});

test('1.5 new housing tables use original-title scale and expressly leave actual operating units unverified',()=>{
  const {after}=result('1.5'),housing=subsection(after,'改造目标及改造后户型');
  assert.equal((after.match(/<table\b/g)||[]).length,3);
  const beforeRows=tableRows(namedTable(housing,'改造前户型及物业现状表'));
  for(const rooms of [2,3,4,6]){const row=beforeRows.find(r=>r[0]===(rooms===6?'6房复式':rooms+'房'));assert.deepEqual([row[2],row[3]],unitTotals(originalUnits.filter(u=>u.rooms===rooms)));assert.equal(row[1],'待核');assert.equal(row[4],'待核');}
  assert.deepEqual(beforeRows.at(-1),['合计（原产权）','待核','51','5621.15','待核']);
  const afterRows=tableRows(namedTable(housing,'改造后户型及房源表')).slice(1);
  assert.deepEqual(afterRows,[['银湖：改造后房型待核','待核','37（原产权）','4249.9（原产权）','待核'],['其余5小区：改造后房型待核','待核','14（原产权）','1371.25（原产权）','待核'],['合计：实际运营单元待核','待核','51（原产权）','5621.15（原产权）','待核']]);
  assert.match(housing,/改造后房型、单元数及面积未经方案认定/);
  assert.match(housing,/不将其冒充已批准的改造后户型/);
  for(const title of ['改造前户型及物业现状表','改造后户型及房源表'])assert.match(namedTable(housing,title),/^<table data-report-independent="true">/);
  assert.ok(!after.includes('data-report-supplement'));
});

test('9.3 corrects only unsupported combination and cashflow basis; tables and other numbers remain exact',()=>{
  const before=actualBody(section(actual,'9.3')),after=correctTax93FinancialText(before);
  assert.match(after,/归还本金另列还本付息表，不重复计入项目IRR现金流/);
  assert.ok(!after.includes('融资本息、税费等现金项目核对'));
  assert.deepEqual(after.match(/<table\b[\s\S]*?<\/table>/g),before.match(/<table\b[\s\S]*?<\/table>/g));
  assert.deepEqual(after.match(/\d+(?:\.\d+)?/g),before.match(/\d+(?:\.\d+)?/g));
  for(const quote of ['若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。','各年净现金流应另按工程付款、融资本息、税费等现金项目核对']){
    assert.throws(()=>correctTax93FinancialText(before.replace(quote,'')),/match once/);
    assert.throws(()=>correctTax93FinancialText(before+quote),/match once/);
  }
  assert.equal(actualBody(section(actual,'9.3')),before);
});

test('1.5 retains every original substantive paragraph with only the specified source corrections',()=>{
  const {before,after}=result('1.5');
  for(const[from]of facts15)assert.equal(count(before,from),1);
  for(const paragraph of before.split('\n\n').filter(p=>p&&!p.startsWith('### ')&&!p.startsWith('<table'))){
    let expected=paragraph;for(const[from,to]of facts15)expected=expected.replace(from,to);
    assert.equal(count(after,expected),1,'lost, duplicated or altered original paragraph: '+paragraph.slice(0,45));
  }
});

test('1.5 removes unsupported investment and combined-IRR assertions without changing measured single factors',()=>{
  const {after}=result('1.5');assert.ok(!after.includes('13892'));
  assert.ok(!after.includes('全周期总收入1116.78万元'));
  assert.ok(!after.includes('IRR存在跌破8%的可能'));
  assert.equal(count(after,facts15[6][1]),1);
  for(const text of ['IRR分别为16.08%和8.29%','IRR分别为14.65%和9.81%','IRR降至11.27%','IRR降至8.66%'])assert.equal(count(after,text),1);
});

test('both sections require the original paid task and do not mutate failed inputs',()=>{
  for(const number of ['1.3','1.5']){const input=copy(actual);delete section(input,number).executionTask;const before=JSON.stringify(input);assert.throws(()=>build(input),/Original paid task identity required/);assert.equal(JSON.stringify(input),before);}
});

test('1.3 refuses accepted actual content or a missing full original candidate',()=>{
  for(const change of [s=>{s.content='already adopted';},s=>{s.pendingRevision.after='';}]){const input=copy(actual);change(section(input,'1.3'));assert.throws(()=>build(input),/original unaccepted full candidate/);}
});

for(const[index,quote]of [...facts13.map(([from])=>from),...gaps13].entries()){
  test('1.3 rejects duplicate and missing exact quote '+(index+1),()=>{
    for(const mode of ['duplicate','missing']){const input=copy(actual),s=section(input,'1.3');
      s.pendingRevision.after=mode==='duplicate'?s.pendingRevision.after+'\n\n'+quote:s.pendingRevision.after.replace(quote,'[negative test: absent exact quote]');
      const before=JSON.stringify(input);assert.throws(()=>build(input),/Exact replacement must match once/);assert.equal(JSON.stringify(input),before);
    }
  });
}

test('1.5 rejects changed or duplicate original quotes and missing or duplicate frozen investment bytes',()=>{
  const original=selectedBody(section(actual,'1.5')),frozen=original.match(/<table\b[^>]*data-report-calc-kind="investment"[\s\S]*?<\/table>/)[0];
  for(const text of [original.replace(facts15[0][0],'[missing exact quote]'),original+'\n\n'+facts15[0][0],original.replace(frozen,''),original+'\n\n'+frozen]){
    const input=copy(actual),s=section(input,'1.5');if(s.editedHtml)s.editedHtml=text;else s.content=text;
    const before=JSON.stringify(input);assert.throws(()=>build(input),/1.5 exact original body changed/);assert.equal(JSON.stringify(input),before);
  }
});

test('literal replacement and proposal application reject absent, ambiguous or stale input',()=>{
  assert.equal(replaceExact('before target after','target','fixed'),'before fixed after');
  for(const[text,quote]of [['target target','target'],['original','missing'],['original','']])assert.throws(()=>replaceExact(text,quote,'fixed'),/match once/);
  const {row,before}=result('1.3');assert.throws(()=>applyExactStructureOperations(before+'changed',row),/body hash/);
  assert.throws(()=>applyExactStructureOperations(before,{...row,operations:[{...row.operations[0],offset:1}]}),/CAS mismatch/);
});

test('real Markdown renderer preserves all proposed tables, rows and frozen bytes instead of escaping them',()=>{
  const require=createRequire(import.meta.url),C=require('../report-completion-contract.js');
  const context=vm.createContext({console,ReportCompletionContract:C});context.window=context;
  vm.runInContext(fs.readFileSync(new URL('../md.js',import.meta.url),'utf8'),context);
  for(const[number,tables,rows]of [['1.3',2,14],['1.5',3,13]]){
    const {after}=result(number),html=context.MD.renderHtml(after);
    assert.equal((html.match(/<table\b/g)||[]).length,tables);
    assert.equal((html.match(/<tr\b/g)||[]).length,rows);
    assert.ok(!/&lt;\/?(?:table|thead|tbody|tr|th|td)\b/i.test(html));
    for(const table of after.match(/<table\b[\s\S]*?<\/table>/g))assert.equal(count(html,table),1);
  }
});
