const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(require.resolve('../calc.js'),'utf8');

function setup(confirmLatest=true){
  const button={};
  const opened=[];
  const record={id:'experience-1',projectType:'gaibao',scope:'group',revision:2,payload:{params:{principalRepayMode:'rent-surplus'}}};
  const sandbox={
    window:{CalcExperienceLibrary:{close(){}}},
    CalcExperienceLibrary:{close(){},async open(options){opened.push(options);}},
    document:{getElementById:id=>id==='scUpdateExperience'?button:null,querySelectorAll:()=>[]},
    sessionStorage:{getItem:()=>null,setItem(){}},
    getUser:()=> 'tester',currentProjectId:'project-1',authHeaders:()=>({Authorization:'Bearer test'}),
    fetch:async()=>({ok:true,status:200,json:async()=>({ok:true,records:[record],metrics:[{recordId:record.id,metricKey:'area',value:100,unit:'㎡'}]})}),
    confirm:()=>confirmLatest,alert:message=>{throw new Error(message);},
    renderTOC(){},renderSheet(){},setTimeout(){},console
  };
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox);
  vm.runInContext("bindInvestmentScheduleEvents=()=>{};bindParameterGovernanceEvents=()=>{};readCalcForm=()=>scParams;calcType='gaibao';scStep=1;scParams={area:100,principalRepayMode:'principal-percent'};calcExperienceSource={record:{id:'experience-1',projectType:'gaibao',scope:'group',revision:1,payload:{params:{principalRepayMode:'principal-percent'}}},metrics:[],projectId:'project-1'};calcDraftContext=calcDraftKey();bindCalcEvents();",sandbox);
  return {button,opened,sandbox};
}

test('经验项目新版还本方式经确认后同步到测算及更新弹窗',async()=>{
  const {button,opened,sandbox}=setup();
  await button.onclick();
  assert.equal(opened.length,1);
  assert.equal(opened[0].params.principalRepayMode,'rent-surplus');
  assert.equal(opened[0].updateSource.record.revision,2);
  assert.equal(vm.runInContext('scParams.principalRepayMode',sandbox),'rent-surplus');
});

test('拒绝覆盖当前测算时不打开旧版更新弹窗',async()=>{
  const {button,opened,sandbox}=setup(false);
  await button.onclick();
  assert.equal(opened.length,0);
  assert.equal(vm.runInContext('scParams.principalRepayMode',sandbox),'principal-percent');
});

test('浏览器中更新按钮读取最新经验版本并呈现新版还本方式',async()=>{
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.route('http://calc-sync.local/**',route=>{
      if(new URL(route.request().url()).pathname==='/api/calcexperience')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,records:[{id:'experience-1',projectType:'gaibao',scope:'group',revision:2,payload:{params:{principalRepayMode:'rent-surplus'}}}],metrics:[{recordId:'experience-1',metricKey:'area',value:100,unit:'㎡'}]})});
      return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><button id="scUpdateExperience">更新当前项目测算版本</button></body></html>'});
    });
    await page.goto('http://calc-sync.local/');
    await page.addScriptTag({path:path.join(__dirname,'..','calc.js')});
    await page.evaluate(()=>{
      window.getUser=()=> 'tester';window.currentProjectId='project-1';window.authHeaders=()=>({});
      window.renderTOC=()=>{};window.renderSheet=()=>{};
      window.bindInvestmentScheduleEvents=()=>{};window.bindParameterGovernanceEvents=()=>{};
      window.readCalcForm=()=>scParams;
      window.CalcExperienceLibrary={close(){},async open(options){window.synced={mode:options.params.principalRepayMode,revision:options.updateSource.record.revision};}};
      window.confirm=()=>true;window.alert=message=>{throw new Error(message);};
      calcType='gaibao';scStep=1;scParams={area:100,principalRepayMode:'principal-percent'};
      calcExperienceSource={record:{id:'experience-1',projectType:'gaibao',scope:'group',revision:1,payload:{params:{principalRepayMode:'principal-percent'}}},metrics:[],projectId:'project-1'};
      calcDraftContext=calcDraftKey();bindCalcEvents();
    });
    await page.locator('#scUpdateExperience').click();
    await page.waitForFunction(()=>Boolean(window.synced));
    assert.deepEqual(await page.evaluate(()=>window.synced),{mode:'rent-surplus',revision:2});
  }finally{await browser.close();}
});
