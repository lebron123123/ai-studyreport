// Repeated browser-button regression for the production AI PPT workspace.
// All project/API state is isolated in memory; no user project is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const root = path.resolve(__dirname, '..');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const consoleErrors = [];
  const projects = [];
  const versions = [];
  let serial = 0;
  let clicks = 0;
  let apiWrites = 0;
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => { window.checkLogin = () => false; });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'fixture.test') return route.abort();
    if (url.pathname === '/api/pptprojects') {
      const body = request.postDataJSON();
      if (body.action === 'list') return route.fulfill({ json: { ok: true, items: projects.map(({ data, ...row }) => row) } });
      if (body.action === 'get') return route.fulfill({ json: { ok: true, item: structuredClone(projects.find(row => row.id === body.id)) } });
      if (body.action === 'create') {
        apiWrites += 1;
        const item = { id: `ppt-${++serial}`, title: body.title, templateId: body.templateId, revision: 1, updatedAt: Date.now(), data: body.data };
        projects.unshift(item);
        return route.fulfill({ json: { ok: true, item: structuredClone(item) } });
      }
      if (body.action === 'save') {
        apiWrites += 1;
        const item = projects.find(row => row.id === body.id);
        versions.unshift({ id: `version-${versions.length + 1}`, revision: item.revision, label: body.label, created_at: Date.now() });
        Object.assign(item, { title: body.title, templateId: body.templateId, data: body.data, revision: item.revision + 1, updatedAt: Date.now() });
        return route.fulfill({ json: { ok: true, item: structuredClone(item) } });
      }
      if (body.action === 'versions') return route.fulfill({ json: { ok: true, versions: structuredClone(versions.slice(0, 5)) } });
      if (body.action === 'restore') {
        apiWrites += 1;
        const item = projects.find(row => row.id === body.id); item.revision += 1; item.updatedAt = Date.now();
        return route.fulfill({ json: { ok: true, item: structuredClone(item) } });
      }
      if (body.action === 'delete') {
        apiWrites += 1;
        const index = projects.findIndex(row => row.id === body.id); if (index >= 0) projects.splice(index, 1);
        return route.fulfill({ json: { ok: true } });
      }
    }
    if (url.pathname === '/api/ppttemplates') return route.fulfill({ json: { ok: true, items: [] } });
    if (url.pathname === '/api/pptjobs') {
      apiWrites += 1;
      const body = request.postDataJSON();
      return route.fulfill({ json: { ok: true, item: { id: `job-${serial}`, stage: body.stage || 'outline' } } });
    }
    if (url.pathname === '/api/ppt-export') return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body: Buffer.from('isolated-ppt-smoke') });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, config: {}, items: [] } });
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) body = body.toString().replace(/<script src="auth\.js[^>]*><\/script>/, '');
    await route.fulfill({ body, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
  });
  const visible = selector => page.locator(`${selector}:visible`).first();
  const click = async selector => { await visible(selector).click(); clicks += 1; };
  try {
    await page.goto('http://fixture.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof renderPptWorkspace === 'function' && window.PptWorkspace);
    await page.evaluate(() => { appMode = 'office'; officeView = 'ppt'; renderSheet(); });
    await visible('#pptWelcomeNew').waitFor();
    await click('#pptWelcomeNew');
    await visible('#pptV2Analyze').waitFor();
    await visible('#pptSource').fill('系统测试材料：项目已完成初步论证，需要形成决策汇报和风险措施。');
    for (let i = 0; i < 5; i += 1) {
      await click('#pptV2Analyze');
      await visible('#pptV2BackMaterials').waitFor();
      await click('#pptV2BackMaterials');
      await visible('#pptV2Analyze').waitFor();
    }
    await click('#pptV2Analyze');
    await visible('#pptV2ShowOutline').waitFor();
    for (let i = 0; i < 5; i += 1) {
      await click('#pptV2ShowOutline');
      await visible('#pptV2ConfirmOutline').waitFor();
      await page.locator('[data-v2-nav="analysis"]:visible').click(); clicks += 1;
      await visible('#pptV2ShowOutline').waitFor();
    }
    await click('#pptV2ShowOutline');
    await visible('#pptV2AddChapter').waitFor();
    const resetOutline = async () => {
      await page.evaluate(() => {
        const p=PptWorkspace.state.current.data;
        p.outlineTree=[
          {id:'ch_a',title:'项目概况',children:[{id:'sec_a',title:'核心判断',claim:'条件具备',bullets:['建议推进'],layoutId:'bullets'}]},
          {id:'ch_b',title:'实施路径',children:[{id:'sec_b',title:'风险措施',claim:'风险可控',bullets:['分步实施'],layoutId:'risk'}]}
        ];
        p.workflow={...(p.workflow||{}),stage:'outline',v2Phase:'outline'};
        renderSheet();
      });
      await visible('#pptV2AddChapter').waitFor();
    };
    for (let i = 0; i < 5; i += 1) {
      await resetOutline(); await click('#pptV2AddChapter');
      await page.locator('[data-v2-del-ch]:visible').last().click(); clicks += 1;
      await page.locator('[data-v2-add]:visible').first().click(); clicks += 1;
      await page.locator('[data-v2-del-sec]:visible').last().click(); clicks += 1;
      await page.locator('[data-v2-promote]:visible').first().click(); clicks += 1;
    }
    await resetOutline();
    await click('#pptV2ConfirmOutline');
    await visible('[data-v2-system="intelligent"]').waitFor();
    for (let i = 0; i < 5; i += 1) {
      await click('[data-v2-system="placeholder"]');
      await click('[data-v2-system="intelligent"]');
    }
    const templateCount = await page.locator('[data-v2-template]:visible').count();
    assert.ok(templateCount >= 4, '智能模板按钮不足4个');
    for (let template = 0; template < 4; template += 1) {
      for (let i = 0; i < 5; i += 1) { await page.locator('[data-v2-template]:visible').nth(template).click(); clicks += 1; }
    }
    for (let i = 0; i < 5; i += 1) {
      await click('#pptV2BackOutline');
      await click('#pptV2ConfirmOutline');
    }
    await click('#pptV2Generate');
    await visible('#pptV2EditAll').waitFor();
    const ensureDesign = async () => {
      await page.evaluate(() => {
        const p = PptWorkspace.state.current.data;
        p.workflow = { ...(p.workflow || {}), stage: 'design', v2Phase: 'design' };
        PptWorkspace.state.chatEditorOpen = false;
        document.querySelector('.ppt-chat-drawer')?.remove();
        renderSheet();
      });
      await page.waitForTimeout(100);
      if (!await visible('#pptV2EditAll').count()) {
        const state = await page.evaluate(() => ({ appMode, officeView, stage: PptWorkspace.state.current?.data?.workflow, sourceText: PptWorkspace.state.current?.data?.sourceText, hasAnalysis: !!PptWorkspace.state.current?.data?.materialAnalysis, slideCount: PptWorkspace.state.current?.data?.slides?.length, editorOpen: PptWorkspace.state.chatEditorOpen, text: document.getElementById('sheet')?.innerText?.slice(0, 500) }));
        throw new Error(`PPT设计态未恢复：${JSON.stringify(state)}`);
      }
    };
    for (let i = 0; i < 5; i += 1) {
      await ensureDesign();
      await click('#pptV2EditAll');
      await visible('#pptAddSlide').waitFor();
      await click('#pptAddSlide');
      await click('#pptDeleteSlide');
      await click('[data-ppt-editor-mode="single"]');
      await click('[data-ppt-editor-mode="all"]');
      await click('[data-close-ppt-drawer]');
      await ensureDesign();
      await click('[data-v2-slide="0"]');
      await visible('[data-close-ppt-drawer]').waitFor();
      await click('[data-close-ppt-drawer]');
    }
    for (let i = 0; i < 5; i += 1) {
      await click('#pptV2ToPreflight');
      await visible('#pptV2RunQa').waitFor();
      await click('#pptV2RunQa');
      await click('#pptV2Export');
      await page.waitForFunction(() => !document.getElementById('pptExport').disabled);
      await page.locator('[data-v2-nav="design"]:visible').click(); clicks += 1;
      await visible('#pptV2ToPreflight').waitFor();
    }
    for (let i = 0; i < 5; i += 1) {
      await click('#pptNew');
      await visible('[data-ppt-delete]').waitFor();
      await click('[data-ppt-delete]');
      await visible('#pptNew').waitFor();
    }
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    assert.equal(projects.length, 1, '隔离测试项目数量未恢复');
    console.log(JSON.stringify({
      ok: true,
      buttonTypes: 30,
      clicks,
      repeat: 5,
      apiWrites,
      consoleErrors,
      states: ['创建/新建/删除隔离项目', '材料分析/返回', '六步导航', '章节和子节增删/升级', '两套生成体系', '四类智能模板', '大纲返回/确认', '逐页生成', '整套/单页编辑抽屉', '增页/删页', '复核', 'PPT导出']
    }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
