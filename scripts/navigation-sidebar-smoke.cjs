const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const css = [...fs.readFileSync('index.html', 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    await page.setContent(`<style>${css}</style><div class="app"><div class="toc"><div class="toc-title">可研报告工坊</div><div class="toc-subtitle">AI 投资分析工作台</div><div id="tocList"></div></div></div>`);
    await page.addScriptTag({ path: 'app.js' });
    await page.evaluate(() => {
      window.hits = {};
      window.openProjectsPanel = () => hits.investment = (hits.investment || 0) + 1;
      window.openProjectCityMap = () => hits.map = (hits.map || 0) + 1;
      window.scStep = 0; window.rvStep = 0;
      for (const id of ['homeAiReport','homeCalc','homeReport','homeReview','homeOffice','homePersonalKnowledge','homeAnalysis']) {
        const card = document.createElement('button'); card.id = id; card.hidden = true;
        card.onclick = () => hits[id] = (hits[id] || 0) + 1; document.body.append(card);
      }
      renderTOC();
    });
    assert.deepEqual(await page.locator('.toc-group-label').allTextContents(), ['投资管理','可研与测算','AI办公','知识与数据']);
    assert.deepEqual(await page.locator('.toc-item > span:nth-child(2)').allTextContents(), ['投资全周期','AI可研生成','财务测算','可研生成','可研智能审查','AI办公助手','个人知识库','项目数据分析','项目地图']);
    for (let round = 0; round < 5; round++) {
      await page.evaluate(() => renderTOC());
      for (const item of await page.locator('.toc-item').all()) await item.click();
    }
    assert.deepEqual(Object.values(await page.evaluate(() => hits)), Array(9).fill(5));
    await page.screenshot({ path: 'outputs/navigation-sidebar.png' });
    for (const mode of ['calc','review','report','aireport','office','personalKnowledge','analysis']) {
      await page.evaluate(mode => { appMode = mode; renderTOC(); }, mode);
      assert.equal(await page.locator('[data-project-manager]').count(), 1);
      assert.equal(await page.locator('[data-home="homeProjectMap"]').count(), 1);
      await page.locator('[data-home="homeProjectMap"]').click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: 9 sidebar entries × 5 clicks; 7 workspace map entries; order and singleton investment; 0 browser errors. Downstream handlers isolated (no production writes).');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
