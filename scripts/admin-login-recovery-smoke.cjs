// Isolated browser acceptance: fake credentials and APIs, no user data access.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let logged=false,authorized=true,offline=false,loginCalls=0;
 await page.route('http://login.test/**',async r=>{
  const url=new URL(r.request().url());
  if(url.pathname==='/')return r.fulfill({contentType:'text/html',body:'<html><body></body></html>'});
  if(offline)return r.abort();
  let status=200,data={ok:true};const body=r.request().postDataJSON();
  if(url.pathname==='/api/auth'){
   loginCalls++;await new Promise(resolve=>setTimeout(resolve,100));
   if(body.password==='test-account'){logged=true;data={ok:true,token:'fake-test-token',username:'test'};}
   else {status=401;data={ok:false,error:'账号或密码错误'};}
  }else if(!logged){status=401;data={ok:false,error:'未登录'};}
  else if(!authorized){status=403;data={ok:false,error:'非管理员账号'};}
  else if(body.pass!=='test-admin'){status=403;data={ok:false,error:'管理员密码错误'};}
  return r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 async function boot(){await page.goto('http://login.test/');await page.addScriptTag({content:fs.readFileSync('admin-login-recovery.js','utf8')});await page.evaluate(()=>{globalThis.authHeaders=()=>({'Content-Type':'application/json'});AdminLoginRecovery.open().then(()=>document.body.dataset.ready='yes');});}
 await boot();await page.getByText('登录网站管理员账号',{exact:true}).waitFor();
 await page.locator('#agGo').click();assert.equal(await page.locator('#agErr').innerText(),'请输入密码。');
 await page.locator('#agName').fill('test');await page.locator('#agPass').fill('wrong');await page.locator('#agGo').click();await page.getByText('账号或密码错误',{exact:true}).waitFor();
 await page.locator('#agPass').fill('test-account');await page.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});
 await page.getByText('后台二次安全验证',{exact:true}).waitFor();assert.equal(loginCalls,2);
 await page.locator('#agPass').fill('wrong');await page.locator('#agGo').click();await page.getByText('管理员密码错误',{exact:true}).waitFor();
 await page.locator('#agPass').fill('test-admin');await page.locator('#agGo').click();await page.waitForFunction(()=>document.body.dataset.ready==='yes');
 await boot();await page.waitForFunction(()=>document.body.dataset.ready==='yes');
 logged=false;await boot();await page.getByText('登录网站管理员账号',{exact:true}).waitFor();
 logged=true;authorized=false;await page.locator('#agRetry').click();await page.getByText('当前账号无后台权限',{exact:true}).waitFor();
 offline=true;await page.locator('#agRetry').click();await page.getByText('请求失败或超时，请重试；项目草稿未删除。',{exact:true}).waitFor();
 offline=false;authorized=true;await page.locator('#agRetry').click();await page.getByText('后台二次安全验证',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: empty, bad login, duplicate submit, secondary password, success, refresh, expired session, denied, network retry; no page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
