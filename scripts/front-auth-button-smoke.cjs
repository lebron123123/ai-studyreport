// Isolated front-office auth button regression. Fake credentials and API only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0;
    await page.route('http://auth.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' });
      requests += 1;
      const body = route.request().postDataJSON();
      if (body.password === 'network') return route.abort();
      if (!body.username || body.password !== 'correct1' || (body.action === 'register' && body.invite !== 'invite')) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '测试校验失败' }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'fixture-token', username: body.username }) });
    });
    await page.goto('http://auth.test/');
    await page.addScriptTag({ content: fs.readFileSync('auth.js', 'utf8') });
    await page.evaluate(() => { globalThis.startApp = () => { document.body.dataset.started = 'yes'; }; });

    for (let round = 0; round < 5; round += 1) {
      await page.evaluate(() => { clearAuth(); showLoginModal(); });
      await page.locator('[data-m="register"]').click();
      await page.locator('#auName').fill('[系统测试]用户');
      await page.locator('#auPass').fill('bad');
      await page.locator('#auInvite').fill('bad');
      await page.locator('#auSubmit').click();
      await page.getByText('测试校验失败', { exact: true }).waitFor();
      await page.locator('#auInvite').fill('invite');
      await page.locator('#auPass').fill('correct1');
      await page.locator('#auSubmit').click();
      await page.waitForFunction(() => !document.getElementById('gate'));

      await page.evaluate(() => { document.body.dataset.started = ''; clearAuth(); showLoginModal(); });
      await page.locator('[data-m="login"]').click();
      await page.locator('#auName').fill('[系统测试]用户');
      await page.locator('#auPass').fill('network');
      await page.locator('#auSubmit').click();
      await page.getByText('网络错误，请重试', { exact: true }).waitFor();
      await page.locator('#auPass').fill('correct1');
      await page.locator('#auSubmit').click();
      await page.waitForFunction(() => !document.getElementById('gate'));
    }
    assert.deepEqual(errors, []);
    assert.equal(requests, 20);
    console.log(JSON.stringify({ ok: true, buttonTypes: 3, clicks: 30, repeat: 5, requests, consoleErrors: errors, states: ['登录/注册切换', '注册失败/成功', '登录断网重试'] }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
