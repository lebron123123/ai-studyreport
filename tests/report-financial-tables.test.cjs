const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
require('../scripts/windows-browser-lockout-guard.cjs');
const api=require('../report-financial-tables.js');
const htmlTable=rows=>'<table>'+rows.map((row,i)=>'<tr>'+row.map(value=>'<'+(i?'td':'th')+'>'+String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</'+(i?'td':'th')+'>').join('')+'</tr>').join('')+'</table>';
const synthetic=require('./fixtures/financial-public-synthetic.cjs');
const historical={tables:synthetic.legacyTables,summary:synthetic.currentSummary};
const oldTables=historical.tables.map(htmlTable);
function source(){
  const params={area:5620,rent:45,discount:4.6,collectMode:'rent_share',collectPct:20},years=[2027,2028,2029,2030,2031];
  const result={__ctype:'gaibao',allYears:years,income:{},cost:{},cf:{},resiOccupancy:{},resiRentPrice:{},summary:structuredClone(historical.summary),sens:[{label:'租金 +10%',irr:14.6666,npv:112.1234},{label:'租金 −10%',irr:null,npv:-12.3456}]};
  years.forEach((y,i)=>{
    result.income[y]={rent:i?258.0108:84.7388};result.cost[y]={collect:i?51.6022:16.9478,eng:i?106.6669:53.3335,op:i?40.5077:13.303,fin:i?2.0001:6.3095,total:i?200.7769:89.8938};
    result.cf[y]={inflow:result.income[y].rent,outflow:i?195.8398:420.7999,net:i?62.171:-336.0611,cumNet:i?62.171*i-336.0611:-336.0611};
    result.resiOccupancy[y]=i?0.85:0.5583;result.resiRentPrice[y]=45;
  });
  return {params,result,snapshot:{id:'[系统测试]calc-current',version:5,calcType:'gaibao',params:structuredClone(params),summary:structuredClone(result.summary)},projectId:'[系统测试]tax-project'};
}
test('source identity is deterministic and includes every adopted annual/sensitivity value',()=>{
  const current=source(),reordered=structuredClone(current);reordered.params=Object.fromEntries(Object.entries(reordered.params).reverse());
  assert.equal(api.signature(current),api.signature(reordered));
  for(const mutate of [c=>c.result.income[2027].rent++,c=>c.result.cost[2027].op++,c=>c.result.cf[2031].cumNet++,c=>c.result.sens[0].npv++,c=>c.result.resiOccupancy[2027]++,c=>c.snapshot.id+='other',c=>c.snapshot.version++,c=>c.projectId+='other']){
    const changed=structuredClone(current);mutate(changed);assert.notEqual(api.signature(current),api.signature(changed));
  }
});
test('first generation can bind an adopted source without old tables, with the same strict validation and no source mutation',()=>{
  const current=source(),before=JSON.stringify(current),binding=api.bindSource(current);
  assert.deepEqual(binding,{version:api.VERSION,projectId:current.projectId,snapshotId:current.snapshot.id,snapshotVersion:current.snapshot.version,sourceSignature:api.signature(current)});
  assert.equal(api.assertCurrent(binding,current),true);assert.equal(JSON.stringify(current),before);
  for(const mutate of [c=>delete c.snapshot,c=>delete c.result,c=>c.snapshot.params.area++,c=>c.snapshot.summary.totalIncome++,c=>c.snapshot.projectId='[系统测试]other',c=>c.snapshot.calcType='rent',c=>c.result.allYears=[],c=>c.result.allYears.push(2027)]){
    const changed=structuredClone(current);mutate(changed);const original=JSON.stringify(changed);
    assert.throws(()=>api.bindSource(changed),{code:'REPORT_FINANCIAL_SOURCE_INVALID'});assert.equal(JSON.stringify(changed),original);
  }
  const race=structuredClone(current);race.result.cf[2027].net++;
  assert.throws(()=>api.assertCurrent(binding,race),{code:'REPORT_FINANCIAL_SOURCE_INVALID'});
});
test('explicit refresh synchronizes synthetic legacy and canonical financial tables without changing any originals',{timeout:90000},async t=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    await page.goto('http://localhost:8080/[system-test]-financial-tables');
    for(const file of ['report-length-plan.js','report-completion-contract.js','report-financial-tables.js','report-table-templates.js','report-section-layout.js','nrcalc.js','rentcalc.js','saleestimate.js','salecalc.js'])await page.addScriptTag({path:path.resolve(file)});
    await page.evaluate(({context,oldTables})=>{window.context=context;window.oldTables=oldTables;}, {context:source(),oldTables});
    await t.test('fictional four-table fixture is replaced from one current source and repeated refresh is identical',async()=>{
      const r=await page.evaluate(()=>{
        const entries=[{key:'9.2',html:'<p>人工分析保持不变。</p>'+oldTables.join(''),context:{type:'gaibao-housing',chapter:'财务评价',section:'盈利能力分析',number:'9.2'}},{key:'9.3',text:'<p>重复的原财务表。</p>'+oldTables[0],context:{type:'gaibao-housing',chapter:'财务评价',section:'不确定性分析',number:'9.3'}}];
        const before=JSON.stringify(entries),originalContext=JSON.stringify(context),out=ReportFinancialTables.prepare(entries,context),again=ReportFinancialTables.prepare(out.entries,context);
        const box=document.createElement('div');box.innerHTML=out.entries.map(e=>e.html||e.text).join('');
        return {before,after:JSON.stringify(entries),originalContext,afterContext:JSON.stringify(context),out,again,rows:Array.from(box.querySelectorAll('table')).map(table=>({kind:table.dataset.reportCalcKind,snapshot:table.dataset.reportCalcSnapshot,version:table.dataset.reportCalcVersion,project:table.dataset.reportCalcProject,rows:Array.from(table.rows).map(row=>Array.from(row.cells).map(c=>c.textContent))}))};
      });
      assert.equal(r.before,r.after);assert.equal(r.originalContext,r.afterContext);assert.equal(r.out.updatedCount,5);assert.equal(r.out.binding.snapshotId,'[系统测试]calc-current');
      assert.deepEqual(r.out,r.again);assert.ok(r.out.entries[0].html.startsWith('<p>人工分析保持不变。</p>'));
      for(const table of r.rows){assert.equal(table.snapshot,'[系统测试]calc-current');assert.equal(table.version,'5');assert.equal(table.project,'[系统测试]tax-project');}
      const html=r.out.entries.map(e=>e.html||e.text).join('');
      for(const stale of ['31,111.11','22,222.22','888.88','444.44','66.66','2039'])assert.ok(!html.includes(stale),stale+' remains');
      assert.deepEqual(r.rows.map(x=>x.kind),['income','cost','summary','sensitivity','income']);
      assert.deepEqual(r.rows[0].rows[1],['2027','84.7388','55.83%','45']);
      assert.deepEqual(r.rows[1].rows[1],['2027','16.9478','53.3335','13.303','6.3095','89.8938']);
      assert.ok(r.rows[2].rows.some(row=>row[0]==='净利润'&&row[2]==='202.75'));
      assert.deepEqual(r.rows[3].rows.at(-1),['租金','−10%','—','-12.3456']);
    });
    await t.test('nonfinancial content is unchanged and directly marked manual/independent tables stay protected without a chosen snapshot',async()=>{
      const r=await page.evaluate(()=>{
        const plain='<p>报告正文与业务事实。</p><table><tr><th>项目</th><th>建筑面积</th></tr><tr><td>甲</td><td>123</td></tr></table>';
        const markers=['data-report-independent','data-report-manual','data-report-financial-manual','data-report-supplement'];
        const entries=[{html:plain},...markers.map(marker=>({html:oldTables.map(html=>html.replace('<table>','<table '+marker+'="true">')).join('')}))],before=JSON.stringify(entries),out=ReportFinancialTables.prepare(entries,{});
        return {entries,out,unchanged:before===JSON.stringify(entries),protected:out.entries.slice(1).map((entry,i)=>{const box=document.createElement('div');box.innerHTML=entry.html;return Array.from(box.querySelectorAll('table')).every(table=>table.getAttribute(markers[i])==='true'&&table.hasAttribute('data-report-independent'));}),detected:entries.map(e=>ReportFinancialTables.hasFinancialTables(e.html)),has:ReportFinancialTables.hasFinancialTables(oldTables[0])};
      });
      assert.equal(r.unchanged,true);assert.deepEqual(r.out.entries.slice(0,2),r.entries.slice(0,2));assert.deepEqual(r.protected,[true,true,true,true]);assert.equal(r.out.updatedCount,0);assert.equal(r.out.binding,null);assert.deepEqual(r.detected,[false,false,false,false,false]);assert.equal(r.has,true);
    });
    await t.test('ancestor protection survives table-only freezing and two explicit generations without changing sources',async()=>{
      const r=await page.evaluate(()=>{
        const markers=['data-report-independent','data-report-manual','data-report-financial-manual','data-report-supplement'];
        const samples=markers.flatMap(marker=>['div','figure'].map(tag=>({marker,html:'<'+tag+' '+marker+'="wrapper-value">'+oldTables[0]+'</'+tag+'>'})));
        samples.push({marker:'data-report-manual',html:'<div data-report-independent="false"><figure data-report-manual=""><section>'+oldTables[0]+'</section></figure></div>'});
        samples.push({marker:'data-report-manual',html:'<div data-report-manual="wrapper">'+oldTables[0].replace('<table>','<table data-report-manual="direct">')+'</div>'});
        const c=structuredClone(context),sourceBefore=JSON.stringify(c),entries=samples.map(sample=>({html:sample.html})),original=JSON.stringify(entries);
        const first=ReportFinancialTables.prepare(entries,c),frozen=first.entries.map(entry=>{
          const box=document.createElement('div');box.innerHTML=entry.html;return {html:box.querySelector('table').outerHTML};
        }),frozenBefore=JSON.stringify(frozen);
        const restored=JSON.parse(JSON.stringify(frozen)),second=ReportFinancialTables.prepare(restored,{});
        const tables=second.entries.map(entry=>{const box=document.createElement('div');box.innerHTML=entry.html;return box.querySelector('table');});
        return {first,second,frozen,original,originalAfter:JSON.stringify(entries),frozenBefore,frozenAfter:JSON.stringify(restored),sourceBefore,sourceAfter:JSON.stringify(c),markers:tables.map((table,i)=>table.getAttribute(samples[i].marker)),detected:second.entries.map(entry=>ReportFinancialTables.hasFinancialTables(entry.html)),nested:tables[8].getAttribute('data-report-independent'),direct:tables[9].getAttribute('data-report-manual'),values:tables.map(table=>table.textContent)};
      });
      assert.equal(r.original,r.originalAfter);assert.equal(r.frozenBefore,r.frozenAfter);assert.equal(r.sourceBefore,r.sourceAfter);
      assert.equal(r.first.updatedCount,0);assert.equal(r.first.binding,null);assert.equal(r.second.updatedCount,0);assert.equal(r.second.binding,null);
      assert.deepEqual(r.second.entries,r.frozen);assert.deepEqual(r.markers,[...Array(8).fill('wrapper-value'),'','direct']);assert.equal(r.nested,'false');assert.equal(r.direct,'direct');assert.ok(r.detected.every(value=>value===false));
      for(const value of r.values){assert.match(value,/2039/);assert.ok(!value.includes('84.7388'));}
    });
    await t.test('all 16 protection/placement combinations survive the real canonical template composer, freeze and JSON recovery',async()=>{
      const catalogue=fs.readFileSync(path.resolve('data/report-table-templates-gaibao-housing-v1.json'),'utf8');
      await page.route('**/data/report-table-templates-gaibao-housing-v1.json',r=>r.fulfill({contentType:'application/json',body:catalogue}));
      await page.route('**/api/reporttables?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,config:{version:1,status:'baseline',overrides:{}}})}));
      const r=await page.evaluate(async()=>{
        await ReportTableTemplates.load('gaibao-housing');
        const ctx={type:'gaibao-housing',chapter:'财务评价',section:'财务评价',number:'9.1'},templates=ReportTableTemplates.forSection(ctx.type,ctx.chapter,ctx.section),template=templates.find(t=>t.id==='gaibao-housing-table-11');
        if(!template)throw new Error('Real financial template was not loaded');
        const manual='<table><tr><th>指标名称</th><th>单位</th><th>数值</th><th>备注</th></tr><tr><td>净利润</td><td>万元</td><td>77777.55</td><td>人工核准值</td></tr><tr><td>全投资内部收益率（IRR）</td><td>%</td><td>77.777</td><td>人工核准值</td></tr></table>';
        const read=html=>{const box=document.createElement('div');box.innerHTML=html;return Array.from(box.querySelectorAll('table'));},expected=read(manual)[0].textContent;
        const contract=ReportCompletionContract.createPlan([{name:'财务评价',sections:[{t:'财务评价',numeric:true}]}]).sections[0],results=[],c=structuredClone(context),sourceBefore=JSON.stringify(c);
        for(const marker of ['data-report-manual','data-report-financial-manual','data-report-independent','data-report-supplement'])for(const placement of ['div','table','figure','figure-table']){
          const html=placement==='table'?manual.replace('<table>','<table '+marker+'="approved">'):placement==='figure-table'?'<figure data-template-id="'+template.id+'">'+manual.replace('<table>','<table '+marker+'="approved">')+'</figure>':'<'+placement+' '+(placement==='figure'?'data-template-id="'+template.id+'" ':'')+marker+'="approved">'+manual+'</'+placement+'>';
          const entries=[{key:'owner',html:html+oldTables[2],context:ctx}],original=JSON.stringify(entries),prepared=ReportFinancialTables.prepare(entries,c),composed=ReportSectionLayout.composeDocument(prepared.entries,ReportTableTemplates),bound=await ReportCompletionContract.bindFrozenTables(contract,composed[0],c.snapshot.id),frozen=JSON.parse(JSON.stringify(bound)),restored=[{key:'owner',html:frozen.frozenTables.tables.map(table=>table.html).join(''),context:ctx}],restoredBefore=JSON.stringify(restored),second=ReportFinancialTables.prepare(restored,c);
          const inspect=html=>{
            const tables=read(html),manualTables=tables.filter(table=>table.textContent.includes('77777.55'));
            return {manualTables:manualTables.length,manualText:manualTables[0]?.textContent,marker:manualTables[0]?.getAttribute(marker),independent:manualTables[0]?.hasAttribute('data-report-independent'),automaticManualValue:tables.filter(table=>!table.closest('[data-report-independent]')).some(table=>table.textContent.includes('77777.55')),current:tables.some(table=>!table.closest('[data-report-independent]')&&table.textContent.includes('202.75'))};
          };
          const manualOnly=read(second.entries[0].html).filter(table=>table.hasAttribute('data-report-independent')).map(table=>table.outerHTML).join(''),withoutSource=ReportFinancialTables.prepare([{html:manualOnly}],{});
          results.push({marker,placement,originalUnchanged:original===JSON.stringify(entries),restoredUnchanged:restoredBefore===JSON.stringify(restored),firstUpdated:prepared.updatedCount,secondUpdated:second.updatedCount,composed:inspect(composed[0]),second:inspect(second.entries[0].html),withoutSource:{updated:withoutSource.updatedCount,binding:withoutSource.binding,html:withoutSource.entries[0].html===manualOnly}});
        }
        return {results,expected,sourceUnchanged:sourceBefore===JSON.stringify(c),templates:templates.map(t=>t.id)};
      });
      assert.deepEqual(r.templates,['gaibao-housing-table-11']);assert.equal(r.results.length,16);assert.equal(r.sourceUnchanged,true);
      for(const result of r.results){
        const label=result.marker+'/'+result.placement;
        assert.equal(result.originalUnchanged,true,label);assert.equal(result.restoredUnchanged,true,label);assert.equal(result.firstUpdated,1,label);assert.equal(result.secondUpdated,1,label);
        for(const phase of [result.composed,result.second])assert.deepEqual(phase,{manualTables:1,manualText:r.expected,marker:'approved',independent:true,automaticManualValue:false,current:true},label);
        assert.deepEqual(result.withoutSource,{updated:0,binding:null,html:true},label);
      }
    });
    await t.test('mixed automatic/manual figures are wholly protected in either order before any replacement',async()=>{
      const r=await page.evaluate(()=>{
        const manual=oldTables[2].replace('<table>','<table data-report-financial-manual="approved">'),samples=[manual+oldTables[0],oldTables[0]+manual],results=[];
        for(const tables of samples){
          const entries=[{html:'<figure data-template-id="gaibao-housing-table-11">'+tables+'</figure>'}],before=JSON.stringify(entries),first=ReportFinancialTables.prepare(entries,{}),box=document.createElement('div');box.innerHTML=first.entries[0].html;
          const frozen=JSON.parse(JSON.stringify([{html:Array.from(box.querySelectorAll('table')).map(table=>table.outerHTML).join('')}])),second=ReportFinancialTables.prepare(frozen,{});
          results.push({unchanged:before===JSON.stringify(entries),firstUpdated:first.updatedCount,secondUpdated:second.updatedCount,binding:first.binding,protected:Array.from(box.querySelectorAll('table')).every(table=>table.hasAttribute('data-report-independent')),figureProtected:box.querySelector('figure').hasAttribute('data-report-independent'),identical:second.entries[0].html===frozen[0].html,values:Array.from(box.querySelectorAll('table')).map(table=>table.textContent)});
        }
        return {results,originals:[oldTables[2],oldTables[0]].map(html=>{const box=document.createElement('div');box.innerHTML=html;return box.querySelector('table').textContent;})};
      });
      for(const [i,result] of r.results.entries()){
        assert.equal(result.unchanged,true);assert.equal(result.firstUpdated,0);assert.equal(result.secondUpdated,0);assert.equal(result.binding,null);assert.equal(result.protected,true);assert.equal(result.figureProtected,true);assert.equal(result.identical,true);assert.deepEqual(result.values,i?r.originals.slice().reverse():r.originals);
      }
    });
    await t.test('canonical summary and cashflow tables are rebuilt, with safe text cells and numeric zero preserved',async()=>{
      const r=await page.evaluate(()=>{
        const c=structuredClone(context);c.result.summary.irr=null;c.result.summary.paybackInfo=null;c.snapshot.summary=structuredClone(c.result.summary);c.result.cf[2027].net=0;c.result.sens[0].label='<img src=x onerror=alert(1)> +10%';
        const cash='<table><tr><th>年份</th><th>现金流入（万元）</th><th>现金流出（万元）</th><th>净现金流量（万元）</th><th>累计净现金流量（万元）</th></tr><tr><td>2039</td><td>9999</td><td>0</td><td>9999</td><td>9999</td></tr></table>';
        const canonical='<figure data-template-id="gaibao-housing-table-11"><figcaption>财务测算指标</figcaption><table class="trusted" style="width:100%"><tr><th>指标名称</th><th>单位</th><th>测算值</th></tr></table></figure>';
        const out=ReportFinancialTables.prepare([{html:canonical+cash+oldTables[3]}],c),box=document.createElement('div');box.innerHTML=out.entries[0].html;
        return {out,styles:box.querySelector('table').getAttribute('style'),className:box.querySelector('table').className,images:box.querySelectorAll('img').length,tables:Array.from(box.querySelectorAll('table')).map(table=>Array.from(table.rows).map(row=>Array.from(row.cells).map(c=>c.textContent)))};
      });
      assert.equal(r.out.updatedCount,3);assert.equal(r.styles,'width:100%');assert.equal(r.className,'trusted');assert.equal(r.images,0);assert.equal(r.tables[1][1][3],'0');
      assert.ok(r.tables[0].some(row=>row[0]==='全投资内部收益率（IRR）'&&row[2]==='—'));assert.ok(r.tables[0].some(row=>row[2]==='未回正'));
      assert.equal(r.tables[2][2][0],'<img src=x onerror=alert(1)>');
    });
    await t.test('actual three-engine schemas retain construction years, payback semantics and current cashflow values',async()=>{
      const nrParams=require('./fixtures/nrcalc-reference.json').cases[0].params;
      const r=await page.evaluate(nrParams=>{
        const rentParams={buildStart:2026,buildYears:1,operateYears:20,firstMonths:12,area:20000,rent:45,rentSpan:3,rentRate:5,rampOcc:.85,stableOcc:.95,parkCount:200,parkPrice:300,parkRatio:.5,parkRampOcc:.85,parkStableOcc:.95,otherTotal:100,totalBuildArea:25000,manageCoeff:3,decorationCost:800,houseType:'公租房',totalInvestment:15000,landArea:8000,constructionCost:6000,loanAmount:9000,loanRate:3,firstRepayRatio:3,repayIncreaseRate:4.5,loanTotalYears:20,invest:15000,discountPct:3.5,investPlan:{2026:15000}};
        const saleParams={buildStart:2026,buildYears:2,operateYears:10,otherTotal:500,saleArea:56105,saleAvgPrice:12880,rate1:.5,rate2:.3,rate3:.2,commArea:20000,commRent:120,commRentSpan:3,commRentRate:5,commRampOcc:.7,commStableOcc:.9,commRentStableStart:2033,leaseMonths:12,parkCount:300,landCost:30000,constructionCost:40000,infraCost:5000,otherEngCost:3000,devCost:8000,saleConstructionCost:28000,saleInfraCost:3500,projectInputTax:200,landUseArea:25000,landFloorPrice:1000,totalInvestment:90000,loanAmount:50000,loanRate:3,loanTotalYears:12,repayStart:2030,repayAmount:10000,repayYears:4,discountPct:3.5};
        const estimate=SaleEstimate.estimate(saleParams,{}),saleFee=estimate.technical.residentialArea*saleParams.saleAvgPrice/10000*.015;
        let saleInput=SaleEstimate.bridge({...saleParams,saleRamp:{2028:.5,2029:.3,2030:.2}},estimate,0,saleFee);
        const saleProbe=SaleCalc.calc(saleInput,{}),buildFin=saleProbe.allYears.filter(y=>y<2028).reduce((sum,y)=>sum+saleProbe.loan[y].interest,0);
        saleInput=SaleEstimate.bridge(saleInput,estimate,buildFin,saleFee);saleInput.devCostPlan={2026:estimate.baseInvestment/2,2027:estimate.baseInvestment/2};
        const contexts=[['gaibao',nrParams,NRCalc.calc(NRCalc.fromParams(nrParams),{})],['rent',rentParams,RentCalc.calc(rentParams,{})],['sale',saleParams,SaleCalc.calc(saleInput,{})]].map(([type,params,result])=>({params,result,snapshot:{id:'[系统测试]'+type,version:1,calcType:type,params:structuredClone(params),summary:structuredClone(result.summary)}}));
        const observations=contexts.map(c=>{
          const before=JSON.stringify(c),html=(c.snapshot.calcType==='sale'?'':oldTables[0])+'<table data-report-calc-kind="cashflow"></table>'+oldTables[2],out=ReportFinancialTables.prepare([{html}],c),box=document.createElement('div');box.innerHTML=out.entries[0].html;
          const rows=kind=>Array.from(box.querySelector('table[data-report-calc-kind="'+kind+'"]')?.rows||[]).map(row=>Array.from(row.cells).map(cell=>cell.textContent));
          return {type:c.snapshot.calcType,unchanged:before===JSON.stringify(c),income:rows('income'),cashflow:rows('cashflow'),summary:rows('summary'),source:c.result};
        });
        const c=structuredClone(contexts[1]);c.result.summary.payback={year:2026,index:0,period:0};c.snapshot.summary=structuredClone(c.result.summary);
        const immediate=ReportFinancialTables.prepare([{html:oldTables[2]}],c).entries[0].html;
        c.result.operateArr=[];c.result.income[2027].resi=1;let inconsistent;
        try{ReportFinancialTables.prepare([{html:oldTables[0]}],c);}catch(e){inconsistent=e.message;}
        const active=structuredClone(contexts[0]);delete active.result.resiOccupancy[2026];let missingActive;
        try{ReportFinancialTables.prepare([{html:oldTables[0]}],active);}catch(e){missingActive=e.message;}
        const bound=ReportFinancialTables.prepare([{html:oldTables[0]}],contexts[1]).binding,race=structuredClone(contexts[1]);race.result.operateArr.pop();let operationRace;
        try{ReportFinancialTables.assertCurrent(bound,race);}catch(e){operationRace=e.message;}
        return {observations,immediate,inconsistent,missingActive,operationRace};
      },nrParams);
      assert.deepEqual(r.observations.map(x=>x.type),['gaibao','rent','sale']);
      for(const entry of r.observations){
        assert.equal(entry.unchanged,true);assert.ok(entry.summary.some(row=>row[0]==='全周期总收入'&&Number(row[2])===entry.source.summary.totalIncome));
        for(const [i,year] of entry.source.allYears.entries())assert.deepEqual(entry.cashflow[i+1].map((value,j)=>j?Number(value):value),[String(year),...['inflow','outflow','net','cumNet'].map(field=>entry.source.cf[year][field])]);
      }
      assert.deepEqual(r.observations[0].income[1],['2025','0','—','—']);assert.deepEqual(r.observations[1].income[1],['2026','0','—','—']);
      assert.ok(r.observations[1].summary.some(row=>row[0]==='累计净现金流回正年份'&&row[2]==='2045'&&row[3]==='投资回收期19.1652年（引擎值）'));
      for(const entry of r.observations.slice(1))assert.ok(entry.summary.some(row=>row[0]==='累计净现值（NPV）'&&row[3]==='折现率3.5%'));
      assert.match(r.immediate,/投资回收期0年（引擎值）/);assert.ok(!r.immediate.includes('测算期第0年'));
      assert.match(r.inconsistent,/非运营期存在住宅租金收入/);assert.match(r.missingActive,/出租率缺少有效数值/);assert.match(r.operationRace,/正文生成期间测算版本或结果已改变/);
    });
    await t.test('missing/mismatched adopted calculation and invalid annual data stop refresh with no partial source mutation',async()=>{
      const r=await page.evaluate(()=>{
        const mutations=[c=>delete c.snapshot,c=>c.snapshot.params.area++,c=>c.snapshot.summary.totalIncome++,c=>c.snapshot.projectId='[系统测试]other',c=>c.snapshot.calcType='rent',c=>delete c.result.cost[2027].op,c=>c.result.allYears.push(2027),c=>c.result.income[2027].rent=NaN];
        return mutations.map(mutate=>{
          const c=structuredClone(context);mutate(c);const entries=[{html:oldTables.join('')}],before=JSON.stringify(entries);let message,code;
          try{ReportFinancialTables.prepare(entries,c);}catch(e){message=e.message;code=e.code;}return {message,code,unchanged:before===JSON.stringify(entries)};
        });
      });
      assert.equal(r.length,8);for(const failure of r){assert.match(failure.message,/财务表同步已暂停/);assert.equal(failure.code,'REPORT_FINANCIAL_SOURCE_INVALID');assert.equal(failure.unchanged,true);}
    });
    await t.test('bound exact source rejects annual/sensitivity/snapshot/project races, not object key reordering',async()=>{
      const r=await page.evaluate(()=>{
        const binding=ReportFinancialTables.prepare([{html:oldTables[0]}],context).binding;
        const mutations=[c=>c.result.income[2027].rent++,c=>c.result.cost[2027].op++,c=>c.result.cf[2031].cumNet++,c=>c.result.sens[0].npv++,c=>c.snapshot.id+='other',c=>c.snapshot.version++,c=>c.projectId+='other'];
        const failures=mutations.map(mutate=>{const c=structuredClone(context);mutate(c);try{ReportFinancialTables.assertCurrent(binding,c);return null;}catch(e){return e.message;}});
        const reordered=structuredClone(context);reordered.params=Object.fromEntries(Object.entries(reordered.params).reverse());
        return {failures,same:ReportFinancialTables.assertCurrent(binding,context),reordered:ReportFinancialTables.assertCurrent(binding,reordered),empty:ReportFinancialTables.assertCurrent(null,{})};
      });
      assert.equal(r.same,true);assert.equal(r.reordered,true);assert.equal(r.empty,true);for(const message of r.failures)assert.match(message,/正文生成期间测算版本或结果已改变/);
    });
    await t.test('unknown program table kinds fail closed; no sensitivity results are not silently replaced with stale cases',async()=>{
      const r=await page.evaluate(()=>{
        let error;try{ReportFinancialTables.prepare([{html:'<table data-report-calc-kind="future-unknown"><tr><td>旧财务数值</td></tr></table>'}],context);}catch(e){error=e.message;}
        const c=structuredClone(context);delete c.result.sens;
        const out=ReportFinancialTables.prepare([{html:oldTables[3]}],c);return {error,html:out.entries[0].html};
      });
      assert.match(r.error,/无法同步的程序财务表/);assert.match(r.html,/待补：当前测算敏感性分析结果/);assert.ok(!r.html.includes('66.66'));
    });
    await t.test('all raw tables synchronize before canonical merge, so obsolete years and values cannot be unioned back',async()=>{
      const r=await page.evaluate(()=>{
        const cell=(text,col,role='static')=>({text,col,role});
        const template={id:'gaibao-housing-table-11',title:'财务测算指标表',segments:[{rows:[{cells:[cell('指标名称',0),cell('单位',1),cell('数值',2),cell('备注',3)]},{cells:[cell('全周期总收入',0),cell('万元',1),cell('',2,'value'),cell('',3,'value')]}]}]};
        const library={forSection:()=>[template],renderTemplate:ReportTableTemplates.renderTemplate};
        const entries=[{key:'a',html:oldTables[2],context:{type:'gaibao-housing',chapter:'财务评价',section:'财务评价',number:'9.1'}},{key:'b',html:oldTables[2]+oldTables[0],context:{type:'gaibao-housing',chapter:'财务评价',section:'盈利能力分析',number:'9.2'}}];
        const out=ReportFinancialTables.prepare(entries,context),composed=ReportSectionLayout.composeDocument(out.entries,library);
        return {composed};
      });
      const html=JSON.stringify(r.composed);assert.match(html,/202.75/);assert.match(html,/1200/);assert.ok(!html.includes('31,111.11'));assert.ok(!html.includes('2039'));assert.ok(!html.includes('444.44'));
    });
    await t.test('empty financial duties seed adopted tables only on explicit generation, without changing source or neighboring sections',async()=>{
      const r=await page.evaluate(()=>{
        const c=structuredClone(context);c.result.summary.totalEngCost=480;c.snapshot.summary=structuredClone(c.result.summary);c.result.loan={};
        c.result.allYears.forEach((y,i)=>{c.result.loan[y]={engineering:i?24:384,borrow:i?19.2:307.2};});
        const entries=[{key:'8.1',html:'<p>投资估算待生成。</p>'},{key:'8.2',html:'<p>资金来源待生成。</p>'},{key:'9.2',html:'<p>财务分析待生成。</p>'}],before=JSON.stringify(entries),sourceBefore=JSON.stringify(c);
        const plain=ReportFinancialTables.prepare(entries,c),investment=ReportFinancialTables.prepare(entries,c,{sectionKey:'8.1',requiredTables:[{title:'投资估算表'}]}),funding=ReportFinancialTables.prepare(investment.entries,c,{sectionKey:'8.2',requiredTables:[{title:'资金筹措表'}]}),summary=ReportFinancialTables.prepare(funding.entries,c,{sectionKey:'9.2',requiredTables:[{title:'财务评价指标表'}]}),again=ReportFinancialTables.prepare(summary.entries,c,{sectionKey:'9.2',requiredTables:[{title:'财务评价指标表'}]});
        const batch=ReportFinancialTables.prepare(entries,c,{sections:[{sectionKey:'8.1',requiredTables:[{title:'投资估算表'}]},{sectionKey:'8.2',requiredTables:[{title:'资金筹措表'}]},{sectionKey:'9.2',requiredTables:[{title:'财务评价指标表'}]}]});
        let duplicate;try{ReportFinancialTables.prepare(entries,c,{sections:[{sectionKey:'8.1',requiredTables:[]},{sectionKey:'8.1',requiredTables:[]}]});}catch(e){duplicate=e.code;}
        const box=document.createElement('div');box.innerHTML=summary.entries.map(e=>e.html).join('');const table=box.querySelector('[data-report-calc-kind="funding"]'),rows=Array.from(table.rows).map(row=>Array.from(row.cells).map(cell=>cell.textContent));
        const changed=structuredClone(c);changed.result.loan[2027].borrow+=1;let race;try{ReportFinancialTables.assertCurrent(funding.binding,changed);}catch(error){race=error.message;}
        return {plain,entries,unchanged:before===JSON.stringify(entries),sourceUnchanged:sourceBefore===JSON.stringify(c),summary,again,batch,duplicate,rows,race};
      });
      assert.equal(r.unchanged,true);assert.equal(r.sourceUnchanged,true);assert.deepEqual(r.plain.entries,r.entries);assert.equal(r.plain.updatedCount,0);assert.equal(r.plain.binding,null);assert.deepEqual(r.summary,r.again);
      assert.deepEqual(r.batch.entries,r.summary.entries);assert.deepEqual(r.batch.binding,r.summary.binding);assert.equal(r.duplicate,'REPORT_FINANCIAL_SOURCE_INVALID');
      assert.deepEqual(r.rows[1],['2027','384','307.2','76.8']);assert.deepEqual(r.rows.at(-1),['全周期合计','480','384','96']);assert.match(r.rows[0][3],/非审批资本金/);
      assert.match(r.summary.entries[0].html,/工程费用合计/);assert.match(r.summary.entries[0].html,/其他投资费用及批准总投资/);assert.match(r.summary.entries[2].html,/202.75/);assert.match(r.race,/正文生成期间测算版本或结果已改变/);
    });
    await t.test('first summary seed and frozen tables share the real canonical table and protected-note budget',async()=>{
      const template=JSON.parse(fs.readFileSync(path.resolve('data/report-table-templates-gaibao-housing-v1.json'),'utf8')).templates.find(t=>t.id==='gaibao-housing-table-11');
      const r=await page.evaluate(async template=>{
        const c=structuredClone(context);c.result.summary.monthlyXirr=12.2566;c.result.summary.annualIrr=14.59;c.result.summary.totalTax=26.4926;c.snapshot.summary=structuredClone(c.result.summary);
        const entry={key:'财务评价 / 财务评价',html:'<p>保留财务评价正文。</p>',context:{type:'gaibao-housing',chapter:'财务评价',section:'财务评价',number:'9.3'}},sourceBefore=JSON.stringify(c),entryBefore=JSON.stringify(entry);
        const library={forSection:type=>type==='gaibao-housing'?[template]:[],renderTemplate:ReportTableTemplates.renderTemplate,fromFigure:ReportTableTemplates.fromFigure};
        const seed=ReportFinancialTables.prepare([entry],c,{sectionKey:entry.key,requiredTables:[{title:'财务评价指标表'}]});
        const seededBox=document.createElement('div');seededBox.innerHTML=seed.entries[0].html;
        const raw=Array.from(seededBox.querySelectorAll('table')).map(t=>t.outerHTML).join('');
        const composed=ReportSectionLayout.composeDocument(seed.entries,library)[0],frozenComposed=ReportSectionLayout.composeDocument([{...entry,html:raw}],library)[0];
        const metrics=html=>{const m=ReportCompletionContract.measure(html);return {tableCount:m.tableCount,tableRows:m.tableRows,tableCharacters:m.tableCharacters};};
        const plan=ReportCompletionContract.createPlan([{name:'财务评价',sections:[{t:'财务评价'}]}]);
        plan.sections[0].requiredTables=[{title:'财务评价指标表',headers:['指标名称','单位'],terms:['IRR']}];
        const allocated=ReportCompletionContract.allocateTableBudgets(plan,[{key:entry.key,number:'9.3',text:composed}]);
        const frozen=await ReportCompletionContract.bindFrozenTables(allocated.sections[0],frozenComposed,'[系统测试]seed-source');
        const review=ReportCompletionContract.inspect(frozenComposed,frozen),again=ReportSectionLayout.composeDocument([{...entry,html:composed}],library)[0];
        const box=document.createElement('div');box.innerHTML=composed;
        return {unchanged:sourceBefore===JSON.stringify(c)&&entryBefore===JSON.stringify(entry),metrics:metrics(composed),frozenMetrics:metrics(frozenComposed),againMetrics:metrics(again),allocated:allocated.tableAllocation,requirements:allocated.sections[0].requirements,issues:review.issues,notes:box.querySelector('[data-report-field-differences]')?.textContent||'',html:composed};
      },template);
      assert.equal(r.unchanged,true);assert.equal(r.metrics.tableCount,2);assert.deepEqual(r.metrics,r.frozenMetrics);assert.deepEqual(r.metrics,r.againMetrics);
      assert.equal(r.allocated.status,'ready');assert.deepEqual(r.allocated.sections[0].actual,{...r.metrics,maxCellCharacters:r.allocated.sections[0].actual.maxCellCharacters});
      assert.equal(r.requirements.tableMax,2);assert.ok(r.requirements.tableRowsMax>=r.metrics.tableRows);assert.ok(r.requirements.tableCharsMax>=r.metrics.tableCharacters);
      assert.deepEqual(r.issues.filter(i=>i.severity==='error'),[]);assert.match(r.notes,/折现率4.6%/);assert.match(r.notes,/当前测算主指标/);assert.match(r.notes,/测算期第4年/);assert.match(r.html,/202.75/);
      assert.equal(r.allocated.caps.tableRows,600);assert.equal(r.allocated.caps.tableCharacters,30000);
    });
    await t.test('legacy program-summary wrapper is exposed narrowly; manual/canonical figures and rent/sale scope remain intact',async()=>{
      const r=await page.evaluate(()=>{
        const entry={key:'summary',html:'<p>原分析。</p>'},duties={sectionKey:'summary',requiredTables:[{title:'财务评价指标表'}]},seed=ReportFinancialTables.prepare([entry],context,duties),box=document.createElement('div');box.innerHTML=seed.entries[0].html;
        const raw=box.querySelector('table').outerHTML,legacy='<figure data-report-program-table="summary"><figcaption>财务评价指标表</figcaption>'+raw+'</figure>';
        const upgraded=ReportFinancialTables.prepare([{...entry,html:legacy}],context),again=ReportFinancialTables.prepare(upgraded.entries,context);
        const protectedCases=['data-report-manual','data-report-independent','data-report-financial-manual','data-report-supplement'].map(marker=>{
          const html=legacy.replace('<figure ','<figure '+marker+'="true" '),out=ReportFinancialTables.prepare([{...entry,html}],{});
          const box=document.createElement('div');box.innerHTML=out.entries[0].html;return {kept:!!box.querySelector('figure['+marker+']'),value:box.querySelector('table')?.textContent,updated:out.updatedCount};
        });
        const custom=legacy.replace('<figure ','<figure data-template-id="gaibao-housing-table-11" '),canonical=ReportFinancialTables.prepare([{...entry,html:custom}],context).entries[0].html;
        const scopes=['rent','sale'].map(type=>{
          const c=structuredClone(context);c.result.__ctype=type;c.snapshot.calcType=type;
          const out=ReportFinancialTables.prepare([{...entry,context:{type,chapter:'财务评价',section:'财务评价',number:'9.3'}}],c,duties),html=ReportSectionLayout.composeDocument(out.entries,{forSection:()=>[]})[0];return {type,html,again:ReportFinancialTables.prepare(out.entries,c,duties).entries[0].html===out.entries[0].html};
        });
        return {upgraded:upgraded.entries[0].html,stable:again.entries[0].html===upgraded.entries[0].html,protectedCases,canonical,scopes};
      });
      assert.doesNotMatch(r.upgraded,/<figure/);assert.match(r.upgraded,/rpt-table-caption/);assert.match(r.upgraded,/data-report-program-table="summary"/);assert.equal(r.stable,true);
      for(const p of r.protectedCases){assert.equal(p.kept,true);assert.equal(p.updated,0);assert.match(p.value,/202.75/);}
      assert.match(r.canonical,/<figure[^>]+data-template-id="gaibao-housing-table-11"/);
      for(const scope of r.scopes){assert.equal(scope.again,true);assert.match(scope.html,/202.75/);assert.doesNotMatch(scope.html,/gaibao-housing|data-template-id|data-report-field-differences/);}
    });
    await t.test('missing actual engineering payments or loans stop funding seeds; amortized engineering is never used as cash payments',async()=>{
      const r=await page.evaluate(()=>{
        const cases=[c=>{c.result.loan={2027:{borrow:10}};},c=>{c.result.loan={2027:{engineering:10}};},c=>{delete c.result.summary.totalEngCost;c.snapshot.summary=structuredClone(c.result.summary);}];
        const failures=cases.map((mutate,i)=>{const c=structuredClone(context);mutate(c);const entries=[{key:'duty',html:'<p>原稿。</p>'}],before=JSON.stringify(entries);let error;try{ReportFinancialTables.prepare(entries,c,{sectionKey:'duty',requiredTables:[{title:i===2?'投资估算表':'资金筹措表'}]});}catch(e){error={code:e.code,message:e.message};}return {error,unchanged:before===JSON.stringify(entries)};});
        const protectedHtml='<figure data-report-manual="approved"><table><tr><th>人工核定资金</th></tr><tr><td>123</td></tr></table></figure>',out=ReportFinancialTables.prepare([{key:'duty',html:protectedHtml}],{}, {sectionKey:'duty',requiredTables:[{title:'资金筹措表'}]});return {failures,out,protectedHtml};
      });
      for(const f of r.failures){assert.equal(f.error?.code,'REPORT_FINANCIAL_SOURCE_INVALID');assert.equal(f.unchanged,true);assert.match(f.error.message,/缺少有效数值/);}
      assert.equal(r.out.updatedCount,0);assert.equal(r.out.binding,null);assert.match(r.out.entries[0].html,/123/);assert.doesNotMatch(r.out.entries[0].html,/data-report-calc-kind/);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
