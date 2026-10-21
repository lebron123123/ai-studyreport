'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright');

test('隔离候选来源 UI：43 历史不误当新版；范围明确选择、取消、重复打开、JSON/刷新无 AI',{timeout:120000},async()=>{
  if(process.platform==='win32')assert.equal(chromium.__nrWindowsLockoutGuard,true,'浏览器必须启用 Windows 锁定防护');
  const fixturePath='/tests/fixtures/report-candidate-origin-browser.html';
  const allowedPaths=new Set([fixturePath,'/project-workflow.js','/aireport.js']);
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],blockedRequests=[],requestedPaths=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  // Never touch the running service: only these three read-only files are fulfilled.
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://localhost:8080'||!allowedPaths.has(url.pathname)||route.request().method()!=='GET'){
      blockedRequests.push({origin:url.origin,path:url.pathname,method:route.request().method()});return route.abort();
    }
    requestedPaths.push(url.pathname);
    const file=path.join(__dirname,'..',url.pathname.slice(1));
    return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html':'application/javascript',body:fs.readFileSync(file)});
  });
  const snapshot=()=>page.evaluate(()=>JSON.stringify(nrCandidateOriginFixtureSnapshot()));
  const callLog=()=>page.evaluate(()=>__candidateOriginCalls);
  const openScope=async()=>{await page.locator('.air-doc-update-impacted').click();await page.locator('#airCandidateScope').waitFor();};
  try{
    await page.goto('http://localhost:8080'+fixturePath,{waitUntil:'load'});
    await page.waitForFunction(()=>window.__fixtureReady||window.__fixtureError);
    assert.equal(await page.evaluate(()=>window.__fixtureError),undefined);
    assert.equal(await page.locator('#fixtureTotal').innerText(),'43');
    assert.equal(await page.locator('#fixtureCurrentCount').innerText(),'0');
    assert.equal(await page.locator('#fixtureLegacyCount').innerText(),'43');
    assert.match(await page.locator('#fixtureBar').innerText(),/已保存候选 43 个.*43 个历史\/旧计划候选，非当前新版/);
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    const legacyBefore=await snapshot();
    await page.locator('#fixtureTotal').click();
    assert.equal(await snapshot(),legacyBefore);assert.deepEqual(await callLog(),[]);
    // Opening/cancelling repeatedly must neither call generation nor change a draft.
    for(let index=0;index<5;index++){
      await openScope();
      assert.equal(await page.locator('#airCandidateScope').count(),1);
      assert.equal(await page.locator('input[name="airCandidateScope"][value="affected"]').isChecked(),true);
      assert.equal(await page.locator('[data-scope-replace]').isChecked(),false);
      assert.equal(await page.locator('[data-scope-start]').isDisabled(),true);
      assert.match(await page.locator('#airCandidateScope [role="status"]').innerText(),/已有 43 个待审候选/);
      await page.locator('[data-scope-close]').last().click();
      assert.equal(await page.locator('#airCandidateScope').count(),0);
      assert.equal(await snapshot(),legacyBefore);assert.deepEqual(await callLog(),[]);
    }
    // A repeated open replaces the scope dialog and resets its explicit choices.
    await openScope();await page.locator('[data-scope-replace]').check();
    await page.evaluate(()=>airOpenCandidateScope());
    assert.equal(await page.locator('#airCandidateScope').count(),1);
    assert.equal(await page.locator('[data-scope-replace]').isChecked(),false);
    await page.locator('[data-scope-close]').first().click();

    await openScope();await page.locator('input[name="airCandidateScope"][value="all"]').check();
    await page.locator('[data-scope-replace]').check();await page.locator('[data-scope-start]').click();
    assert.deepEqual(await callLog(),[{regenerateAll:true,replaceExisting:true}]);
    assert.match(await page.locator('#fixtureStatus').innerText(),/隔离未调用AI/);
    assert.equal(await snapshot(),legacyBefore);
    await openScope();await page.locator('input[name="airCandidateScope"][value="all"]').check();await page.locator('[data-scope-start]').click();
    await openScope();await page.locator('[data-scope-replace]').check();await page.locator('[data-scope-start]').click();
    assert.deepEqual(await callLog(),[{regenerateAll:true,replaceExisting:true},{regenerateAll:true,replaceExisting:false},{regenerateAll:false,replaceExisting:true}]);

    await page.locator('#fixtureCurrent').click();
    assert.equal(await page.locator('#fixtureTotal').innerText(),'43');
    assert.equal(await page.locator('#fixtureCurrentCount').innerText(),'3');
    assert.equal(await page.locator('#fixtureLegacyCount').innerText(),'40');
    assert.equal(await page.locator('.air-doc-accept-candidates').innerText(),'批量接受候选稿（3）');
    const currentBefore=await snapshot();
    await page.locator('.air-doc-accept-candidates').click();
    assert.equal(await page.evaluate(()=>__candidateOriginAcceptClicks),1);
    assert.equal(await snapshot(),currentBefore,'隔离接受入口不执行正式接受流程');
    await page.locator('#fixtureBusy').check();
    assert.equal(await page.locator('.air-doc-update-impacted').isDisabled(),true);
    assert.equal(await page.locator('.air-doc-accept-candidates').isDisabled(),true);
    await page.evaluate(()=>airOpenCandidateScope());assert.equal(await page.locator('#airCandidateScope').count(),0);
    await page.locator('#fixtureBusy').uncheck();

    await page.locator('#fixtureLocked').click();
    assert.match(await page.locator('#fixtureBar').innerText(),/43 个已锁定/);
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    await openScope();await page.locator('[data-scope-close]').last().click();
    await page.locator('#fixtureEmpty').click();
    assert.equal(await page.locator('#fixtureTotal').innerText(),'0');
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    await openScope();
    assert.equal(await page.locator('[data-scope-replace]').count(),0);
    assert.equal(await page.locator('[data-scope-start]').isDisabled(),true);
    await page.locator('input[name="airCandidateScope"][value="all"]').check();
    assert.equal(await page.locator('[data-scope-start]').isDisabled(),false);
    await page.locator('[data-scope-close]').last().click();

    // Real JSON serialization/restore does not manufacture missing plan/contract fields.
    await page.locator('summary').filter({hasText:'JSON 序列化恢复'}).click();
    await page.locator('#fixtureJson').fill(currentBefore);await page.locator('#fixtureRestore').click();
    assert.equal(await snapshot(),currentBefore);
    assert.equal(await page.locator('.air-doc-accept-candidates').innerText(),'批量接受候选稿（3）');
    await page.locator('#fixtureJson').fill(legacyBefore);await page.locator('#fixtureRestore').click();
    assert.equal(await snapshot(),legacyBefore);
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    assert.equal(await page.evaluate(()=>chapters.flatMap(chapter=>chapter.sections).some(section=>'completionContract' in section.pendingRevision||'completionInputPlanId' in section.pendingRevision)),false);
    await page.locator('#fixtureJson').fill('{invalid');await page.locator('#fixtureRestore').click();
    assert.match(await page.locator('#fixtureStatus').innerText(),/恢复失败，原模拟数据未变/);
    assert.equal(await snapshot(),legacyBefore);

    await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.__fixtureReady||window.__fixtureError);
    assert.equal(await snapshot(),legacyBefore,'刷新重建同一固定历史样本，不读正式存储');
    assert.equal(await page.locator('#fixtureLegacyCount').innerText(),'43');
    assert.equal(await page.locator('.air-doc-accept-candidates').count(),0);
    assert.deepEqual(await callLog(),[]);
    assert.match(await page.locator('#fixtureStatus').innerText(),/隔离未调用AI.*0 次/);
    assert.deepEqual(blockedRequests,[],'没有鉴权、API、AI或其他外部请求');
    assert.deepEqual([...new Set(requestedPaths)].sort(),[...allowedPaths].sort());
    assert.deepEqual(errors,[],'控制台与页面无新增错误');
  }finally{await context.close();await browser.close();}
});
