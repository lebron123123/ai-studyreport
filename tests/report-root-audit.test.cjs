const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const Contract=require('../report-completion-contract.js');
const execute=promisify(execFile),root=path.resolve(__dirname,'..');

test('offline audit preserves partial QA states, untouched source and production input identity',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'report-audit-qa-'));
  const draft={project:{name:'[系统测试]离线审核'},calcParams:{area:100,operateYears:6},workflow:{reportCompletion:{facts:[{key:'operateYears',label:'运营年限',value:'12',status:'verified',source:'既有待核对材料'}]}},chapters:[{name:'测试独立章节',sections:[
    {t:'局部试验一',editedHtml:'<p>未修改原文甲</p>'},{t:'局部试验二',editedHtml:'<p>未修改原文乙</p>'},
    {t:'保护原件',editedHtml:'<p data-original="yes">保护原件中的独有事实</p>'},{t:'缺省保留',editedHtml:'<p data-original="yes">未列入候选的原始事实</p>'}
  ]}]};
  const candidate={partial:true,sourceHash:createHash('sha256').update(JSON.stringify(draft)).digest('hex'),results:[
    {ci:0,si:0,chapter:'测试独立章节',title:'局部试验一',status:'unverified',after:'局部精简后的候选甲',tables:[]},
    {ci:0,si:1,chapter:'测试独立章节',title:'局部试验二',status:'blocked',after:'局部精简后的候选乙',tables:[]},
    {ci:0,si:2,chapter:'测试独立章节',title:'保护原件',status:'protected',after:'保护项不应替换成这段文字',tables:[]}
  ]};
  const sourcePath=path.join(temp,'source.json'),candidatePath=path.join(temp,'candidate.json');
  const source=JSON.stringify({name:draft.project.name,state:draft}),candidateText=JSON.stringify(candidate);
  await fs.writeFile(sourcePath,source);await fs.writeFile(candidatePath,candidateText);
  const run=await execute(process.execPath,['--require',path.join(root,'scripts/windows-browser-lockout-guard.cjs'),'scripts/audit-report-root-contract.mjs','--source',sourcePath,'--label','system-test-partial','--type','gaibao-housing','--candidate',candidatePath],{cwd:root,maxBuffer:4*1024*1024});
  const output=run.stdout.match(/Isolated audit: (.+)/)?.[1]?.trim();assert.ok(output);
  const audit=JSON.parse(await fs.readFile(path.join(output,'audit.json'),'utf8'));
  assert.equal(audit.sourcesUnchanged,true);assert.equal(audit.documents.length,2);
  const qa=audit.documents[1],html=await fs.readFile(path.join(output,'system-test-partial-candidate.html'),'utf8');
  assert.equal(qa.qaOnly,true);assert.equal(qa.idempotent,true);
  assert.equal(qa.inputVersion,Contract.fingerprint({projectName:draft.project.name,params:draft.calcParams,type:'gaibao'}));
  assert.equal(qa.plan.sections[0].requiredFacts.find(f=>f.key==='operateYears').status,'conflict');
  assert.deepEqual(qa.candidate.application.map(r=>r.status),['unverified','blocked','protected','not-in-partial-candidate']);
  assert.deepEqual(qa.candidate.application.map(r=>r.applied),[true,true,false,false]);
  assert.ok(qa.candidate.application.every(r=>r.qaOnly));
  assert.match(html,/局部精简后的候选甲/);assert.match(html,/局部精简后的候选乙/);
  assert.match(html,/<p data-original="yes">保护原件中的独有事实<\/p>/);
  assert.match(html,/<p data-original="yes">未列入候选的原始事实<\/p>/);
  assert.doesNotMatch(html,/保护项不应替换/);
  assert.equal(await fs.readFile(sourcePath,'utf8'),source);assert.equal(await fs.readFile(candidatePath,'utf8'),candidateText);
});
