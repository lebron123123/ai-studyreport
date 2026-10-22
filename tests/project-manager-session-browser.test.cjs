const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

test('项目库 401 提醒重新登录，登录后可重新读取项目', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.route('http://session-test.local/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/projects') {
        const authorized = route.request().headers().authorization === 'Bearer fresh';
        return route.fulfill({status:authorized?200:401,contentType:'application/json',body:JSON.stringify(authorized?{ok:true,list:[{id:'p1',name:'恢复后的项目',type:'rent',updated_at:1}],nextOffset:null}:{ok:false,error:'未登录或登录已过期'})});
      }
      return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
    });
    await page.goto('http://session-test.local/');
    await page.evaluate(() => {
      window.sessionToken='expired';
      window.expiredCount=0;
      window.ResearchUI={listRecords:async()=>({items:[],nextOffset:null})};
      window.ProjectWorkspaceUI={parseRoute:()=>null};
    });
    await page.addScriptTag({path:path.join(__dirname,'..','project-manager.js')});
    const open = () => page.evaluate(() => ProjectManager.open({userId:'user',headers:()=>({Authorization:'Bearer '+window.sessionToken}),onAuthExpired:()=>{window.expiredCount++;},currentId:()=>null}));
    await open();
    assert.equal(await page.evaluate(() => window.expiredCount),1);
    await page.evaluate(() => {window.sessionToken='fresh';});
    await open();
    assert.equal(await page.locator('#pmList').getByText('恢复后的项目').count(),1);
    assert.equal(await page.evaluate(() => window.expiredCount),1);
  } finally { await browser.close(); }
});

test('登录过期后显示登录框，重新登录保留项目位置并触发重读', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.route('http://login-test.local/**', route => route.request().url().endsWith('/api/auth')
      ? route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,token:'fresh',username:'tester'})})
      : route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><div id="projPanel">原项目界面</div></body></html>'}));
    await page.goto('http://login-test.local/');
    await page.addScriptTag({path:path.join(__dirname,'..','auth.js')});
    await page.evaluate(() => {
      localStorage.setItem('fs_token','expired');
      window.startOptions=[];
      window.reopenCount=0;
      window.startApp=async options=>{window.startOptions.push(options);};
      window.openProjectsPanel=()=>{window.reopenCount++;};
      requireLoginAgain();
    });
    assert.equal(await page.locator('#gate').count(),1);
    assert.equal(await page.evaluate(() => localStorage.getItem('fs_token')),null);
    await page.locator('#auName').fill('tester');
    await page.locator('#auPass').fill('password');
    await page.locator('#auSubmit').click();
    await page.waitForFunction(() => window.reopenCount===1);
    assert.equal(await page.locator('#gate').count(),0);
    assert.equal(await page.evaluate(() => localStorage.getItem('fs_token')),'fresh');
    assert.equal(await page.evaluate(() => window.startOptions[0].skipProjectPanel),true);
  } finally { await browser.close(); }
});
