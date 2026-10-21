const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const table=(rows=2,value='0')=>'<table>'+Array.from({length:rows},(_,i)=>'<tr><td>项目'+i+'</td><td>'+value+'</td></tr>').join('')+'</table>';
const make=(count=43,options={})=>C.createPlan([{name:'项目报告',sections:Array.from({length:count},(_,i)=>({t:'事项'+(i+1)}))}],options);
const entries=plan=>plan.sections.map((s,i)=>({key:s.sectionKey,number:'1.'+(i+1),text:'本节说明'+i}));
const total=(plan,key)=>plan.sections.reduce((n,s)=>n+s.requirements[key],0);

test('完整表格成本为底线，从全篇固定池分配；表格集中不再因小节旧配额误拦',()=>{
  const p=make(),e=entries(p);e[0].text=table(60);e[1].text=table(2)+table(3,'-2')+table(4,'0.00');
  const before=JSON.stringify({p,e}),a=C.allocateTableBudgets(p,e);
  assert.equal(JSON.stringify({p,e}),before);assert.equal(a.tableAllocation.status,'ready');
  assert.equal(a.tableAllocation.version,C.TABLE_ALLOCATION_VERSION);assert.equal(a.tableAllocation.basePlanId,p.planId);
  assert.equal(a.tableAllocation.totals.actual.tableRows,69);assert.equal(a.tableAllocation.totals.floor.tableRows,69);
  assert.ok(a.sections[0].requirements.tableRowsMax>=60);assert.ok(a.sections[1].requirements.tableMax>=3);
  assert.equal(total(a,'tableRowsMax'),600);assert.equal(total(a,'tableCharsMax'),30000);
  assert.equal(a.proseTotal,p.proseTotal);assert.equal(a.maxPages,130);
  for(let i=0;i<p.sections.length;i++)for(const key of ['proseTarget','proseMax','cellCharsMax','imageMax'])assert.equal(a.sections[i].requirements[key],p.sections[i].requirements[key]);
  assert.equal(C.reviewDocument(e,a).status,'passed');
});

test('无表43节不预留不存在的职责表；只有真实缺失必要表预留最小几何，不造数据',()=>{
  const p=make(),e=entries(p),a=C.allocateTableBudgets(p,e);
  assert.equal(a.tableAllocation.status,'ready');assert.equal(a.tableAllocation.totals.floor.tableRows,0);
  assert.equal(a.tableAllocation.totals.reserve.tableCount,0);
  p.sections[0].requiredTables=[{title:'现金流表',headers:['项目','金额'],terms:['净现金流']}];
  const b=C.allocateTableBudgets(p,e),r=b.tableAllocation.sections.find(s=>s.sectionKey===e[0].key);
  assert.equal(r.reserve.tableCount,1);assert.equal(r.reserve.tableRows,2);assert.ok(r.reserve.tableCharacters>0);
  assert.equal(b.tableAllocation.status,'ready');assert.ok(C.inspect(e[0].text,b.sections[0]).issues.some(i=>i.code==='missing-table'));
  assert.equal(C.reviewDocument(e,b).status,'blocked');assert.equal(e[0].text,'本节说明0');
});

test('有效跨节表引用按所有者计一次；悬空引用不能规避必要表预算',()=>{
  const p=C.createPlan([{name:'现金流',sections:[{t:'现金流汇总'},{t:'现金流评价'}]}]),e=entries(p);
  e[0].text='<table><tr><th>项目</th><th>金额</th></tr><tr><td>净现金流</td><td>0</td></tr></table>';
  e[1].text='<p class="rpt-table-reference">详见第1.1节现金流量表。</p>';
  const a=C.allocateTableBudgets(p,e);assert.equal(a.tableAllocation.status,'ready');assert.equal(a.tableAllocation.totals.actual.tableCount,1);assert.equal(a.tableAllocation.totals.reserve.tableCount,0);
  assert.equal(C.reviewDocument(e,a).status,'passed');
  const bad=structuredClone(e);bad[1].text=bad[1].text.replace('1.1','99.9');
  const b=C.allocateTableBudgets(p,bad);assert.equal(b.tableAllocation.status,'blocked');assert.ok(b.tableAllocation.issues.some(i=>i.code==='table-allocation-reference-target-missing'));
});

test('超过600行或30000表字符无可行分配，不扩大上限且全篇验收阻断',()=>{
  for(const html of [table(601),table(201,'字'.repeat(150))]){
    const p=make(2),e=entries(p);e[0].text=html;
    const a=C.allocateTableBudgets(p,e);assert.equal(a.tableAllocation.status,'blocked');assert.equal(a.tableAllocation.totals.allocated,null);
    assert.ok(a.tableAllocation.sections.every(s=>s.allocated===null));assert.ok(a.tableAllocation.issues.some(i=>i.code==='table-allocation-capacity'));
    assert.equal(a.tableRowsTotal,600);assert.equal(a.tableCharactersTotal,30000);assert.equal(e[0].text,html);
    const q=C.reviewDocument(e,a);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='table-allocation-capacity'));
  }
  const p=make(2);p.tableRowsTotal=601;assert.equal(C.allocateTableBudgets(p,entries(p)).tableAllocation.status,'blocked');
});

test('人工预算不自动调大，原表长单元格不自动放宽180字限制',()=>{
  const key='项目报告 / 事项1',p=make(2,{budgets:{[key]:{reason:'已审签固定上限',tableRowsMax:2}}}),e=entries(p);e[0].text=table(3);
  const a=C.allocateTableBudgets(p,e);assert.equal(a.tableAllocation.status,'blocked');assert.equal(a.sections[0].requirements.tableRowsMax,2);assert.ok(a.tableAllocation.issues.some(i=>i.code==='table-allocation-manual'));
  const p2=make(2),e2=entries(p2);e2[0].text=table(2,'字'.repeat(181));
  const b=C.allocateTableBudgets(p2,e2);assert.equal(b.tableAllocation.status,'blocked');assert.equal(b.sections[0].requirements.cellCharsMax,180);assert.ok(b.tableAllocation.issues.some(i=>i.code==='table-allocation-cell'));
});

test('完整唯一小节输入是前提，局部快照/重复/未知/非文本均阻断',()=>{
  const p=make(3),e=entries(p);
  for(const bad of [e.slice(1),[...e,e[0]],[...e,{key:'未知',text:''}],e.map((x,i)=>i?x:{...x,text:null})]){
    const a=C.allocateTableBudgets(p,bad);assert.equal(a.tableAllocation.status,'blocked');assert.equal(a.tableAllocation.totals.allocated,null);
    assert.equal(C.reviewDocument(e,a).status,'blocked');
  }
  for(const bad of [{}, {...p,sections:[null]}, {...p,sections:p.sections.map((s,i)=>i?s:{...s,requirements:{...s.requirements,tableRowsMax:-1}})}])assert.equal(C.allocateTableBudgets(bad,e).tableAllocation.status,'blocked');
});

test('分配可重复、顺序无关，正文变化不改计划，表内容/合并结构改变则改计划',()=>{
  const p=make(4),e=entries(p);e[0].text='<p>旧正文。</p>'+table(35);
  const a=C.allocateTableBudgets(p,e),b=C.allocateTableBudgets(p,[...e].reverse()),again=C.allocateTableBudgets(a,e);
  assert.equal(a.planId,b.planId);assert.equal(again.planId,a.planId);assert.deepEqual(again,a);
  const body=structuredClone(e);body[0].text=body[0].text.replace('旧正文','变化很大的新正文');assert.equal(C.allocateTableBudgets(p,body).planId,a.planId);
  const changed=structuredClone(e);changed[0].text=changed[0].text.replace('<td>0</td>','<td>1</td>');assert.notEqual(C.allocateTableBudgets(p,changed).planId,a.planId);
  changed[0].text=table(35).replace('<td>0</td>','<td colspan="1">0</td>');assert.notEqual(C.allocateTableBudgets(p,changed).planId,a.planId);
});

test('合并格、零、负值完整保留，只计实际表格行及物理单元格',()=>{
  const p=make(2),e=entries(p),html='<table><tr><th rowspan="2">项目</th><th colspan="2">金额</th></tr><tr><td>含税</td><td>不含税</td></tr><tr><td>收入</td><td>0</td><td>-10.05</td></tr></table>';
  e[0].text=html;const a=C.allocateTableBudgets(p,e),m=C.measure(html),row=a.tableAllocation.sections.find(s=>s.sectionKey===e[0].key);
  assert.equal(a.tableAllocation.status,'ready');assert.equal(row.actual.tableRows,3);assert.equal(row.actual.tableCharacters,m.tableCharacters);assert.equal(e[0].text,html);
});

test('冻结原表已超额度为不可AI修复，普通新生表超额仍可修复',async()=>{
  const p=make(2),raw=table(35),c=await C.bindFrozenTables(p.sections[0],raw,'test-snapshot');
  const q=C.inspect(raw,c),budget=q.issues.find(i=>i.code==='budget-tableRows');assert.ok(budget);assert.equal(budget.repairable,false);assert.match(budget.message,/冻结原表本身/);
  assert.equal(C.inspect('当前候选遗漏原表',c).issues.find(i=>i.code==='budget-tableRows').repairable,false);
  assert.equal(C.inspect(raw,p.sections[0]).issues.find(i=>i.code==='budget-tableRows').repairable,true);
  const e=entries(p);e[0].text=raw;const a=C.allocateTableBudgets(p,e),bound=await C.bindFrozenTables(a.sections[0],raw,'test-snapshot');
  assert.equal(C.inspect(raw,bound).status,'passed');
});

test('分配后伪改额度/元数据/版本不能通过整篇验收；旧未分配计划仍兼容',()=>{
  const p=make(3),e=entries(p),a=C.allocateTableBudgets(p,e);
  assert.equal(C.reviewDocument(e,p).status,'passed');
  for(const mutate of [x=>x.sections[0].requirements.tableRowsMax++,x=>x.tableAllocation.sections[0].floor.tableRows++,x=>x.tableAllocation.version='old',x=>x.tableAllocation.manifest[0].tablesFingerprint='forged',x=>x.tableAllocation.status='blocked']){
    const bad=structuredClone(a);mutate(bad);const q=C.reviewDocument(e,bad);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='table-allocation-invalid'));
  }
});
