const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const root = path.resolve(__dirname, '..');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  let clicks = 0;
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => { window.checkLogin = () => false; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'fixture.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: {} }) });
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) body = body.toString().replace(/<script src="auth\.js[^>]*><\/script>/, '');
    await route.fulfill({ body, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
  });
  try {
    await page.goto('http://fixture.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof renderCalcModule === 'function' && typeof bindCalcEvents === 'function');
    const click = async selector => { await page.locator(selector).click(); clicks += 1; };
    const types = ['gaibao', 'rent', 'sale'];
    for (const type of types) {
      for (let repeat = 0; repeat < 5; repeat += 1) {
        await page.evaluate(() => { appMode = 'calc'; scStep = 0; calcType = null; scParams = null; scResult = null; renderSheet(); });
        await click(`[data-sct="${type}"]`);
        await click('#scNext1');
        await page.waitForSelector('#scRun');
        if (type !== 'gaibao') {
          await click('[data-is-shift="-1"]');
          await click('[data-is-shift="1"]');
          await click('#isReset');
          if (type === 'rent') await click('#isRefresh');
        }
        await click('#scRun');
        await page.waitForFunction(() => scStep === 2 && !!scResult);
        assert.ok(await page.locator('#scExcel').isEnabled());
        assert.ok(await page.locator('#scWord').isEnabled());
        await click('#scBack1');
        await page.waitForSelector('#scRun');
        await click('#scBack0');
      }
    }
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    console.log(JSON.stringify({
      ok: true,
      buttonTypes: 14,
      clicks,
      repeat: 5,
      consoleErrors,
      states: ['三类模型选择', '下一步/返回', '三类执行测算', '结果返回修改', '出租/出售工期前移后移与恢复', '出租投资计划刷新', 'Word/Excel入口可用']
    }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
