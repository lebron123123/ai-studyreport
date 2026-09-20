import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {onRequestGet,onRequestPost,onRequestPatch,onRequestDelete} from '../functions/api/calcexperience.js';
import {signToken} from '../functions/api/_auth.js';
import {normalizeMetric,buildParameters,compareResults} from '../calc-experience-model.mjs';

test('经验库系统版复用真实引擎，参数修改重算且Excel原值不变',()=>{
  const sandbox={window:{},console};
  vm.createContext(sandbox);
  for(const file of ['nrcalc.js','calc.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),sandbox);
  const params=JSON.parse(fs.readFileSync(new URL('./fixtures/nrcalc-reference.json',import.meta.url),'utf8')).cases[0].params;
  const original=sandbox.calcExperienceCalculate('gaibao',params);
  const changed=sandbox.calcExperienceCalculate('gaibao',{...params,rent:params.rent+10});
  assert.notEqual(original.totalIncome,changed.totalIncome);
  assert.equal(original.totalIncome,sandbox.window.NRCalc.calc(sandbox.window.NRCalc.fromParams(params)).summary.totalIncome);
  const rows=[{metricKey:'totalIncome',metricValue:8888,unit:'万元'}];
  assert.equal(compareResults(rows,changed).find(x=>x.key==='totalIncome').excel,8888);
  assert.throws(()=>sandbox.calcExperienceCalculate('gaibao',{}),/请补充参数/);
});

test('出租率兼容历史100比例与引擎0.85，Excel原值独立于系统结果',()=>{
  assert.equal(normalizeMetric({metricKey:'rampOcc',metricValue:100,unit:'比例'}).metricValue,100);
  const normalized=normalizeMetric({metricKey:'stableOcc',metricValue:.85,unit:'比例'});
  assert.equal(normalized.metricValue,85);assert.equal(buildParameters([normalized]).stableOcc,.85);
  const comparison=compareResults([{metricKey:'totalIncome',metricValue:100,unit:'万元'}],{totalIncome:120});
  assert.deepEqual(comparison.find(x=>x.key==='totalIncome'),{key:'totalIncome',name:'全周期总收入',unit:'万元',computed:120,excel:100,difference:20});
  assert.equal(compareResults([{metricKey:'totalIncome',value:300,note:'测算结果'}],{}).find(x=>x.key==='totalIncome').excel,null);
});

test('个人记录隔离、可编辑、乐观锁、旧版留痕、集团修改重新审核',async()=>{
  const f=fixture();try{
    const owner=await signToken(f.env,101,'owner'),other=await signToken(f.env,102,'other'),admin=await signToken(f.env,1,'admin');
    const input={scope:'private',projectName:'[系统测试]自测',projectType:'gaibao',metrics:[{metricKey:'rampOcc',metricName:'首年出租率',metricValue:100,unit:'比例'}]};
    const created=await call(onRequestPost,f.env,owner,'POST',input);assert.equal(created.data.status,'confirmed');
    for(const token of [other,admin]){
      assert.equal((await call(onRequestGet,f.env,token,'GET',null,'?scope=private')).data.records.length,0);
      assert.equal((await call(onRequestDelete,f.env,token,'DELETE',null,'?id='+created.data.id)).status,403);
      assert.equal((await call(onRequestPost,f.env,token,'POST',{...input,action:'edit',recordId:created.data.id,revision:1})).status,403);
    }
    assert.equal((await call(onRequestGet,f.env,owner)).data.records.length,0);
    const own=(await call(onRequestGet,f.env,owner,'GET',null,'?scope=private')).data;
    assert.equal(own.metrics[0].value,100);assert.equal(own.metrics[0].ratioPct,100);assert.equal(own.benchmarks.length,0);
    assert.equal((await call(onRequestPatch,f.env,admin,'PATCH',{action:'confirm',recordId:created.data.id})).status,403);
    const edit={...input,action:'edit',recordId:created.data.id,revision:1,projectName:'[系统测试]修改',payload:{calculation:{summary:{totalIncome:20}}}};
    assert.equal((await call(onRequestPost,f.env,owner,'POST',edit)).status,200);
    assert.equal((await call(onRequestPost,f.env,owner,'POST',edit)).status,409);
    assert.equal(f.connection.prepare('SELECT COUNT(*) n FROM calc_experience_history').get().n,1);
    const reloaded=(await call(onRequestGet,f.env,owner,'GET',null,'?scope=private')).data.records[0];
    assert.equal(reloaded.revision,2);assert.equal(reloaded.payload.calculation.summary.totalIncome,20);
    const group=await call(onRequestPost,f.env,owner,'POST',{...input,scope:'group'});
    await call(onRequestPatch,f.env,admin,'PATCH',{action:'confirm',recordId:group.data.id});
    assert.equal((await call(onRequestPost,f.env,owner,'POST',{...input,scope:'group',action:'edit',recordId:group.data.id,revision:1})).data.status,'pending');
    assert.equal((await call(onRequestGet,f.env,other)).data.records.length,0);
    assert.equal((await call(onRequestDelete,f.env,owner,'DELETE',null,'?id='+created.data.id)).status,200);
  }finally{f.connection.close();}
});

function fixture(){
  const connection=new DatabaseSync(':memory:');
  connection.exec(fs.readFileSync(new URL('../migrations/0037_calc_experience_library.sql',import.meta.url),'utf8'));
  connection.exec(fs.readFileSync(new URL('../migrations/0038_calc_experience_workspaces.sql',import.meta.url),'utf8'));
  const makeDb=()=>({prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return connection.prepare(sql).get(...args)||null;},async all(){return {results:connection.prepare(sql).all(...args)};},async run(){const result=connection.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}});
  const db=makeDb();let tail=Promise.resolve();db._transaction=work=>{const op=tail.catch(()=>{}).then(async()=>{connection.exec('BEGIN');try{const value=await work(makeDb());connection.exec('COMMIT');return value;}catch(error){connection.exec('ROLLBACK');throw error;}});tail=op;return op;};
  return {connection,env:{DB:db,SESSION_SECRET:'calc-experience-test-secret',ADMIN_USERS:'admin'}};
}
async function call(handler,env,token,method='GET',body=null,query=''){
  const request=new Request('http://test/api/calcexperience'+query,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const response=await handler({env,request});return {status:response.status,data:await response.json()};
}

test('经验数据经管理员审核后才进入区间，普通用户只能申请删除自己的数据',async()=>{
  const f=fixture();try{
    const userToken=await signToken(f.env,101,'user'),adminToken=await signToken(f.env,1,'admin');
    const created=await call(onRequestPost,f.env,userToken,'POST',{projectName:'[系统测试]经验项目',projectType:'gaibao',region:'深圳',baseYear:2026,metrics:[{category:'income',metricKey:'totalIncome',metricName:'全周期总收入',metricValue:21000,unit:'万元'},{category:'cost',metricKey:'costRatio',metricName:'成本占比',metricValue:.42,unit:'比例',ratioPct:42}]});
    assert.equal(created.status,200);assert.equal(created.data.status,'pending');assert.equal(created.data.saved,2);
    const ownPending=await call(onRequestGet,f.env,userToken);assert.equal(ownPending.data.records.length,1);assert.equal(ownPending.data.benchmarks.length,0);assert.equal(ownPending.data.records[0].ownedByMe,true);
    const strangerToken=await signToken(f.env,102,'stranger'),stranger=await call(onRequestGet,f.env,strangerToken);assert.equal(stranger.data.records.length,0);
    const forbiddenDelete=await call(onRequestDelete,f.env,userToken,'DELETE',null,'?id='+created.data.id);assert.equal(forbiddenDelete.status,403);
    const confirmed=await call(onRequestPatch,f.env,adminToken,'PATCH',{action:'confirm',recordId:created.data.id,note:'测试确认'});assert.equal(confirmed.data.status,'confirmed');
    const visible=await call(onRequestGet,f.env,strangerToken);assert.equal(visible.data.records.length,1);assert.equal(visible.data.benchmarks.length,2);assert.equal(visible.data.benchmarks[0].sampleCount,1);
    const requestDelete=await call(onRequestPost,f.env,userToken,'POST',{action:'requestDelete',recordId:created.data.id,reason:'测试清理'});assert.equal(requestDelete.status,200);
    const adminView=await call(onRequestGet,f.env,adminToken);assert.equal(adminView.data.deleteRequests.length,1);
    const approved=await call(onRequestPatch,f.env,adminToken,'PATCH',{action:'approveDelete',requestId:adminView.data.deleteRequests[0].id});assert.equal(approved.data.status,'approved');
    const removed=await call(onRequestGet,f.env,userToken);assert.equal(removed.data.records.length,0);assert.equal(removed.data.benchmarks.length,0);
  }finally{f.connection.close();}
});

test('经验库限制项目类型、空指标和超量上传',async()=>{
  const f=fixture();try{
    const token=await signToken(f.env,103,'user');
    assert.equal((await call(onRequestPost,f.env,token,'POST',{projectName:'X',projectType:'unknown',metrics:[{metricName:'收入',metricValue:1}]})).status,400);
    assert.equal((await call(onRequestPost,f.env,token,'POST',{projectName:'X',projectType:'rent',metrics:[]})).status,400);
    const metrics=Array.from({length:801},(_,i)=>({metricName:'指标'+i,metricValue:i}));assert.equal((await call(onRequestPost,f.env,token,'POST',{projectName:'X',projectType:'rent',metrics})).status,413);
  }finally{f.connection.close();}
});

test('经验库入口、上传格式和当前测算提取已接入前台',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),air=fs.readFileSync(new URL('../aireport.js',import.meta.url),'utf8'),calc=fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../calc-experience-library.js',import.meta.url),'utf8'),monthPicker=fs.readFileSync(new URL('../calc-month-picker.js',import.meta.url),'utf8');
  assert.match(html,/calc-experience-library\.js/);assert.match(html,/calc-experience-library\.css/);assert.match(air,/财务测算经验库/);assert.match(air,/air-open-calc-experience/);
  assert.match(calc,/function calcOpenExperienceLibrary/);assert.match(calc,/id="scExperienceLibrary"/);assert.match(app,/data-calc-experience/);assert.match(app,/经验数据库/);
  assert.match(ui,/录入当前测算/);assert.match(ui,/上传 Excel \/ CSV \/ JSON/);assert.match(ui,/申请删除/);assert.match(ui,/经验区间只使用管理员确认的数据/);
  assert.match(ui,/手动新增数据/);assert.match(ui,/应用到当前测算/);assert.match(ui,/data-series-years/);assert.match(ui,/按类别填写指标/);
  assert.match(calc,/calcApplyExperienceMetrics/);assert.match(calc,/期限与项目规模/);assert.match(calc,/c_repayPlanYears/);assert.match(calc,/c_repayPlanValues/);
  assert.match(ui,/record\.projectType===context\.projectType/);
  assert.match(html,/calc-month-picker\.js/);assert.match(html,/calc-month-picker\.css/);assert.doesNotMatch(calc,/id="c_buildStartMonth" type="month"/);
  assert.match(calc,/data-calc-month/);assert.match(monthPicker,/data-cmp-pick-year/);assert.match(monthPicker,/快速跳到年份/);assert.match(monthPicker,/MONTHS=/);
});

test('经验记录只把同类型输入参数和分年计划应用到当前测算',()=>{
  const source=fs.readFileSync(new URL('../calc.js',import.meta.url),'utf8');
  const prefix=source.slice(0,source.indexOf('function renderCalcModule'));
  let closed=0,rendered=0;
  const sandbox={
    window:{CalcExperienceLibrary:{close(){closed++;}}},
    CalcExperienceLibrary:{close(){closed++;}},
    renderTOC(){rendered++;},renderSheet(){rendered++;},
    document:{getElementById(){return null;}},setTimeout(callback){callback();},console
  };
  vm.runInNewContext(prefix+';globalThis.__apply=calcApplyExperienceMetrics;globalThis.__state=()=>({calcType,scParams,scStep,scResult});',sandbox);
  const applied=sandbox.__apply({projectType:'gaibao'},[
    {metricKey:'rent',value:58},
    {metricKey:'repayPlan.2028',value:500},
    {metricKey:'repayPlan.2029',value:650},
    {metricKey:'totalIncome',value:99999},
    {metricKey:'note',value:123}
  ]);
  const state=sandbox.__state();
  assert.equal(applied,3);
  assert.equal(state.calcType,'gaibao');
  assert.equal(state.scStep,1);
  assert.equal(state.scResult,null);
  assert.equal(state.scParams.rent,58);
  assert.deepEqual({...state.scParams.repayPlan},{2028:500,2029:650});
  assert.equal(state.scParams.totalIncome,undefined);
  assert.equal(state.scParams.note,undefined);
  assert.equal(closed,1);
  assert.equal(rendered,2);
});
