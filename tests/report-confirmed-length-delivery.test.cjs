const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js'),L=require('../report-length-plan.js');

function fixture(chapters,options={}){
  chapters=chapters||[{name:'业务分析',sections:Array.from({length:43},(_,i)=>({t:'业务主题'+(i+1)}))}];
  const lengthPlan={...L.createPlan(chapters,options),confirmedAt:'2026-10-09T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  return {chapters,lengthPlan};
}
function proseAtTotal(plan,total){
  let left=total;
  return plan.sections.map((s,i)=>{
    const n=i===plan.sections.length-1?left:Math.floor(total*s.target/plan.totalTarget);left-=n;
    return {key:s.key,text:String.fromCodePoint(0x4e00+i).repeat(n)};
  });
}

test('确认7.5万字后，4.95万/6万字不能假报完整；90%和110%按同一正文口径核对',()=>{
  const {lengthPlan}=fixture(),before=JSON.stringify(lengthPlan);
  for(const actual of [49493,59993,67499]){
    const q=C.reviewLength(proseAtTotal(lengthPlan,actual),lengthPlan);
    assert.equal(q.applicable,true);assert.equal(q.status,'short');assert.equal(q.target,75000);assert.equal(q.actual,actual);
    assert.equal(q.min,67500);assert.equal(q.max,82500);assert.equal(q.shortfall,67500-actual);assert.equal(q.targetShortfall,75000-actual);
    assert.equal(q.sections.length,43);assert.ok(q.sections.some(s=>s.shortfall>0));assert.equal(q.professionalQualityVerified,false);assert.equal(q.paginationRequired,true);
  }
  for(const actual of [67500,75000,82500])assert.equal(C.reviewLength(proseAtTotal(lengthPlan,actual),lengthPlan).status,'within-range');
  const over=C.reviewLength(proseAtTotal(lengthPlan,82501),lengthPlan);assert.equal(over.status,'over');assert.match(over.message,/不自动删减/);
  assert.equal(JSON.stringify(lengthPlan),before);
});

test('按用户改选目标计算范围，不写死7.5万；薄弱小节只定位，不按单节底线拒收',()=>{
  const {lengthPlan}=fixture(undefined,{proseTotal:50000,targetPages:80}),entries=proseAtTotal(lengthPlan,50000);
  const removed=entries[0].text.length-1;entries[0].text='甲';entries[1].text+='乙'.repeat(removed);
  const q=C.reviewLength(entries,lengthPlan);
  assert.equal(q.status,'within-range');assert.equal(q.target,50000);assert.equal(q.min,45000);assert.equal(q.max,55000);
  assert.ok(q.sections[0].shortfall>0);assert.equal(q.sections[0].actual,1);assert.equal(q.chapters[0].thinSections.includes(entries[0].key),true);
});

test('依据清单不凑600字，也不列入薄弱分析；纯依据目录不强求正文分析字数',()=>{
  const chapters=[{name:'总论',sections:[{t:'编制依据'},...Array.from({length:42},(_,i)=>({t:'经营主题'+i}))]}],{lengthPlan}=fixture(chapters),entries=proseAtTotal(lengthPlan,75000);
  entries[0].text='《已核实文件》';
  const q=C.reviewLength(entries,lengthPlan),basis=q.sections[0];
  assert.equal(q.status,'within-range');assert.equal(basis.basis,true);assert.equal(basis.min,0);assert.equal(basis.shortfall,0);assert.equal(basis.targetShortfall,0);
  assert.equal(q.chapters[0].thinSections.includes(entries[0].key),false);
  const only=fixture([{name:'法规依据',sections:[{t:'国家文件'},{t:'地方文件'}]}],{proseTotal:1000});
  const list=C.reviewLength(only.lengthPlan.sections.map(s=>({key:s.key,text:'《真实文件》'})),only.lengthPlan);
  assert.equal(list.basisOnly,true);assert.equal(list.min,0);assert.equal(list.status,'within-range');assert.ok(list.sections.every(s=>s.shortfall===0));
});

test('表格、图片、空白不抬高正文数，标题、标点与数字沿用现行measure口径',()=>{
  const {lengthPlan}=fixture([{name:'业务',sections:[{t:'分析'},{t:'方案'}]}],{proseTotal:1000}),entries=[
    {key:lengthPlan.sections[0].key,text:'<h3>标题</h3><p>甲 12。\n乙</p><table><tr><td>'+('表'.repeat(20000))+'</td></tr></table><img src="x">'},
    {key:lengthPlan.sections[1].key,text:'丙'.repeat(900)}
  ];
  const q=C.reviewLength(entries,lengthPlan),expected=entries.reduce((n,e)=>n+C.measure(e.text).proseCharacters,0);
  assert.equal(q.actual,expected);assert.equal(q.actual,907);assert.equal(q.status,'within-range');
});

test('缺节、空正文、重复和陌生key不能冒充完成或重复累加；短目录不承诺整本目标',()=>{
  const {lengthPlan}=fixture(),entries=proseAtTotal(lengthPlan,75000);
  let q=C.reviewLength(entries.slice(1),lengthPlan);assert.equal(q.status,'incomplete');assert.deepEqual(q.missingSections,[entries[0].key]);
  q=C.reviewLength(entries.map((e,i)=>i?e:{...e,text:'<p> </p>'}),lengthPlan);assert.equal(q.status,'incomplete');assert.equal(q.sections[0].present,false);
  q=C.reviewLength([...entries,entries[0],{key:'陌生 / 章节',text:'假'.repeat(100000)}],lengthPlan);
  assert.equal(q.status,'incomplete');assert.equal(q.actual,75000);assert.deepEqual(q.invalidEntries.map(e=>e.code),['duplicate-section','unknown-section']);
  const partial=fixture([{name:'业务',sections:[{t:'方案'}]}]);
  q=C.reviewLength([{key:partial.lengthPlan.sections[0].key,text:'甲'.repeat(3600)}],partial.lengthPlan);assert.equal(q.status,'incomplete');assert.equal(q.partialOutline,true);
});

test('未确认旧计划不强制改写；确认计划被篡改不作有效交付范围',()=>{
  const {lengthPlan}=fixture(),entries=proseAtTotal(lengthPlan,75000),old={...lengthPlan};delete old.confirmedAt;
  assert.equal(C.reviewLength(entries,undefined).applicable,false);assert.equal(C.reviewLength(entries,old).status,'unconfirmed');
  assert.equal(C.reviewLength(entries,{...lengthPlan,budgetResolution:{policy:'legacy'}}).applicable,false);
  const stale={...lengthPlan,proseTotal:80000},q=C.reviewLength(entries,stale);assert.equal(q.applicable,false);assert.equal(q.status,'invalid-plan');assert.ok(q.errors.length);
});

test('整篇成稿检查不能让短稿passed，超量只提醒不自动压缩；原未确认检查兼容',()=>{
  const {chapters,lengthPlan}=fixture(),plan=C.createPlan(chapters,{lengthPlan});
  const short=C.reviewDocument(proseAtTotal(lengthPlan,49493),plan);
  assert.equal(short.status,'blocked');assert.equal(short.lengthReview.status,'short');assert.equal(short.depthAdvisory,null);assert.ok(short.issues.some(i=>i.code==='document-length-short'&&i.repairable===false));
  const enough=C.reviewDocument(proseAtTotal(lengthPlan,75000),plan);assert.equal(enough.status,'passed');assert.equal(enough.lengthReview.status,'within-range');assert.equal(enough.professionalQualityVerified,false);
  const over=C.reviewDocument(proseAtTotal(lengthPlan,82501),plan);assert.equal(over.status,'unverified');assert.ok(over.issues.some(i=>i.code==='document-length-over'&&i.severity==='warning'));
  const legacy=C.createPlan(chapters),old=C.reviewDocument(proseAtTotal(lengthPlan,49493),legacy);assert.equal(old.status,'passed');assert.equal(old.lengthReview.applicable,false);
});

test('已确认生成与补齐提示写足详实分析，保留主题结构，不靠注水或机械压缩',()=>{
  const {chapters,lengthPlan}=fixture(),contract=C.createPlan(chapters,{lengthPlan}).sections[0],prompt=C.structuredPrompt(contract),repair=C.repairPrompt({issues:[]},contract);
  assert.match(prompt,/用户已确认的全篇篇幅分配/);assert.match(prompt,/90%–110%/);assert.match(prompt,/接近已确认目标完成详实分析/);assert.match(prompt,/单槽无硬性最小字数/);assert.doesNotMatch(prompt,/target不是最低字数|target是建议目标，不是最低字数/);
  assert.match(repair,/保留原有有效段落/);assert.match(repair,/依据清单不扩写/);assert.match(repair,/不能冒充已写足/);assert.match(repair,/不能删除业务标题或压平结构/);
});
