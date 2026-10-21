/* Existing-report workspace: immutable originals, explicitly requested local AI candidates. */
(function (root) {
  'use strict';
  let state = null, host = null, store = null, libraryPromise = null, monitor = null, referenceTimer = null;
  const MAX_FILE = 30 * 1024 * 1024, MAX_BATCH = 100 * 1024 * 1024;
  const roles = { main: '主报告', special: '专项稿', reference: '参考资料', calculation: '测算资料' };
  const owner = () => typeof root.getUser === 'function' ? String(root.getUser() || '') : '';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => n < 1024 * 1024 ? Math.ceil(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
  const options = (value, entries) => entries.map(([key, label]) => '<option value="' + esc(key) + '"' + (String(value) === String(key) ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  const main = () => state.draft && state.draft.files.find(f => f.role === 'main');
  const currentFile = () => state.draft && (state.draft.files.find(f => f.id === state.fileId) || main());
  const active = captured => captured === state && captured.owner === owner();
  function fresh(user) { return { owner: user, page: 'upload', list: [], draft: null, mainFile: null, extras: [], title: '', dirty: false, busy: false, message: '', error: '', selected: '', fileId: '', filter: 'headings', reviewInstruction: '', reviewMode: 'append', reviewScope: 'paragraph', reviewView: 'working', referenceFileIds: [], referenceBlockIds: [], cloudItems: null, writingProfileId: 'auto', reviewTask: null, unsavedReview: null }; }
  function errorText(error) {
    if (error.code === 'CONFLICT') return '这个工作稿已在其他页面更新。当前修改仍在页面中；请另存副本，或重新读取已保存版本。';
    if (error.code === 'AUTH_CHANGED' || error.code === 'OWNER_REQUIRED') return '登录账号已变化。已停止这次操作，请重新进入；原账号的已保存工作稿仍保留。';
    if (error.code === 'TIMEOUT') return '本浏览器保存超时，未确认保存成功。请保留此页，稍后点“保存工作稿”重试。';
    if (error.code === 'STORAGE' || error.name === 'QuotaExceededError') return '本浏览器暂时无法保存（空间不足或存储被限制）。未清理已有资料；当前文件仍在页面中，请保留原件并重试保存。';
    return String(error.message || '操作未完成，请重试。');
  }
  function fail(error) { state.error = errorText(error); state.message = ''; }
  function changed() { state.dirty = true; state.error = ''; state.message = ''; updateStatus(); }
  function updateStatus() {
    const label = host && host.querySelector('[data-ri-status]');
    if (label) label.textContent = state.busy ? '正在处理…' : state.unsavedReview ? 'AI 建议尚未保存' : state.dirty ? '有未保存修改' : state.draft ? '已保存到当前浏览器' : '原稿导入 · 第一步';
  }
  function lastKey() { return 'report-import:last:' + encodeURIComponent(state.owner); }
  function remember() { try { sessionStorage.setItem(lastKey(), state.draft.id); } catch (_) {} }
  async function loadLibraries() {
    if (root.JSZip) return;
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'assets/vendor/jszip-3.10.1.min.js';
      const timer = setTimeout(() => { script.remove(); reject(new Error('文档读取组件加载超时，请检查网站连接后重试。')); }, 20000);
      script.onload = () => { clearTimeout(timer); root.JSZip ? resolve() : reject(new Error('文档读取组件未就绪。')); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('文档读取组件加载失败，请检查网站连接后重试。')); };
      document.head.appendChild(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }
  async function run(work) {
    if (state.busy) return;
    const captured = state;
    captured.busy = true; captured.error = ''; captured.message = ''; draw();
    try { await work(captured); } catch (error) { if (active(captured)) fail(error); }
    finally { captured.busy = false; if (active(captured)) draw(); }
  }
  function requireActive(captured) { if (!active(captured)) { const e = new Error('登录账号已变化'); e.code = 'AUTH_CHANGED'; throw e; } }
  function acceptDraft(draft, page) {
    state.draft = draft; state.title = draft.title; state.dirty = false;
    state.unsavedReview = null; state.reviewInstruction = draft.reviewState?.requests?.at(-1)?.context?.instruction || '';
    const previous = draft.reviewState?.requests?.at(-1)?.context;
    state.referenceFileIds = [...(previous?.referenceFileIds || [])]; state.referenceBlockIds = [...(previous?.referenceBlockIds || [])]; state.writingProfileId = previous?.writingProfileId || 'auto';
    state.filter = 'headings';
    state.fileId = draft.files.find(f => f.role === 'main').id;
    state.selected = draft.outline[0]?.blockId || '';
    state.page = page || (draft.confirmed ? 'read' : 'outline'); remember();
  }
  async function reloadList(captured) { const list = await store.list(); if (active(captured)) captured.list = list; }
  async function importFiles(captured) {
    if (!captured.mainFile) throw new Error('请先选择一份 Word 主报告。');
    const files = [{ file: captured.mainFile, role: 'main' }, ...captured.extras];
    if (files.length > 21) throw new Error('每次最多选择 1 份主报告和 20 份补充资料。');
    if (files.some(f => f.file.size > MAX_FILE)) throw new Error('单份文件不能超过 30 MB。请保留原件，拆分补充资料后再导入。');
    if (files.reduce((n, f) => n + f.file.size, 0) > MAX_BATCH) throw new Error('本次文件合计超过 100 MB，请减少补充资料后再导入。');
    if (!/\.docx$/i.test(captured.mainFile.name)) throw new Error('主报告目前支持 .docx。旧版 .doc 或 PDF 请先在 Word/WPS 中另存为 .docx。');
    await loadLibraries(); requireActive(captured);
    const prepared = [];
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      captured.message = '正在读取 ' + (i + 1) + ' / ' + files.length + '：' + item.file.name; draw();
      let parsed = null;
      if (/\.docx$/i.test(item.file.name)) parsed = await root.ReportImportCore.parseDocx(await item.file.arrayBuffer(), { fileName: item.file.name, JSZip: root.JSZip });
      requireActive(captured);
      prepared.push({ name: item.file.name, role: item.role, blob: item.file, parsed });
    }
    const parsed = prepared[0].parsed;
    const draft = await store.createDraft({ title: captured.title.trim() || captured.mainFile.name.replace(/\.docx$/i, ''), files: prepared, outline: parsed.outline, confirmed: false, protectedBlockIds: parsed.blocks.map(b => b.id) });
    requireActive(captured); acceptDraft(draft, 'outline'); captured.mainFile = null; captured.extras = [];
    captured.message = '原件和独立工作稿已保存。请核对目录；目录调整不会改动原文。'; await reloadList(captured);
  }
  async function save(captured, confirmed) {
    if (!captured.draft) return;
    if (captured.draft.outline.some(item => !String(item.title || '').trim())) throw new Error('目录标题不能为空。请填写显示名称，或把该段设为“正文”。');
    const snapshot = { ...captured.draft, title: captured.title.trim() || captured.draft.title, confirmed: confirmed == null ? captured.draft.confirmed : confirmed };
    const result = await store.save(snapshot, captured.draft.revision);
    requireActive(captured); captured.draft = result; captured.title = result.title; captured.dirty = false; remember();
    if (confirmed) captured.page = 'read';
    captured.message = '已保存到当前浏览器。原始文件和原文内容未改变。'; await reloadList(captured);
  }
  async function fork(captured) {
    if (captured.unsavedReview) throw new Error('请先点“仅重试保存建议”，保住已返回的建议后再另存副本。');
    const edits = { title: captured.title + '（副本）', outline: structuredClone(captured.draft.outline), confirmed: captured.draft.confirmed, protectedBlockIds: [...captured.draft.protectedBlockIds] };
    if (edits.outline.some(item => !String(item.title || '').trim())) throw new Error('目录标题不能为空，请填写后再另存副本。');
    const snapshot = await store.exportSnapshot(captured.draft.id, captured.draft.revision, { historical: true });
    const restored = await store.importSnapshot(snapshot); requireActive(captured);
    const draft = await store.save({ ...restored, ...edits }, restored.revision);
    requireActive(captured); acceptDraft(draft); captured.message = '已另存独立副本，原工作稿保持不变。'; await reloadList(captured);
  }
  function offerDownload(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function backup(captured, cloud) {
    if (captured.unsavedReview) throw new Error('请先保存已返回的建议，再备份完整工作稿。');
    if (captured.dirty) await save(captured);
    const snapshot = await store.exportSnapshot(captured.draft.id, captured.draft.revision);
    const pack = await root.ReportImportBackup.create(snapshot); requireActive(captured);
    if (cloud) {
      const receipt = await root.ReportImportCloud.create().save(pack.blob, { title: captured.draft.title, draftId: captured.draft.id, revision: captured.draft.revision });
      requireActive(captured); captured.message = '当前版本已备份到网站服务器，并完整读回校验。版本 ' + receipt.revision + '；后续修改需再次备份。';
    } else { offerDownload(pack.blob, pack.fileName); captured.message = '已下载完整备份：含原件、工作稿、候选与采用记录。请妥善保存备份文件。'; }
  }
  async function restoreBackup(captured, blob) {
    await loadLibraries(); requireActive(captured);
    const snapshot = await root.ReportImportBackup.read(blob, { owner: captured.owner }); requireActive(captured);
    const draft = await store.importSnapshot(snapshot); requireActive(captured); acceptDraft(draft); await reloadList(captured);
    captured.message = '已恢复为一份新的独立工作稿，原有工作稿保持不变。';
  }
  async function exportWord(captured, mode = 'review') {
    if (captured.unsavedReview) throw new Error('请先保存已返回的建议。');
    if (captured.dirty) await save(captured);
    await loadLibraries(); requireActive(captured);
    const original = await store.getOriginal(main().id); requireActive(captured);
    const result = await root.ReportImportDelivery.exportDocx(captured.draft, original.blob, { mode }); requireActive(captured);
    offerDownload(result.blob, result.fileName); captured.message = (mode === 'clean' ? '已导出当前工作稿，包含已采用内容，不显示本次修改标记。' : mode === 'tracked' ? '已导出 Word 修订版，可在 Word 中接受或拒绝修改；修订颜色随软件设置，看不到增删时请选择“所有标记”。' : '已导出修改标红对照版，用固定红字显示已采用内容相对导入原文的修改：新增带下划线，删除带删除线，打开即可查看。') + (mode !== 'clean' && result.receipt?.coarseDiffBlocks?.length ? '其中 ' + result.receipt.coarseDiffBlocks.length + ' 段较长，采用整段对照，不代表逐字差异。' : '') + '待审候选未写入；请核对分页，此下载不代表正式成稿验收通过。';
  }
  function cloudPanel() {
    return '<section class="ri-card ri-cloud"><h3>备份与跨设备恢复</h3><p class="ri-muted">完整备份保留原件和完善记录。恢复时另建工作稿；服务器备份归当前账号所有。</p><label class="ri-field">恢复完整备份<input id="riRestore" type="file" accept=".rbackup"></label><button class="ri-secondary" data-ri-action="cloud-list">读取服务器备份列表</button>' + (state.cloudItems ? (state.cloudItems.length ? state.cloudItems.map(item => '<div class="ri-cloud-item"><span>' + esc(item.title) + ' · 版本 ' + item.revision + ' · ' + esc(new Date(item.createdAt).toLocaleString('zh-CN')) + '</span><button class="ri-secondary" data-ri-cloud-restore="' + esc(item.id) + '">恢复为新工作稿</button></div>').join('') : '<p>当前账号暂无服务器备份。</p>') : '') + '</section>';
  }
  function deliveryPanel() {
    return '<section class="ri-card ri-delivery"><h3>导出与备份</h3><p class="ri-muted">Word 下载只包含你已采用的内容。修改标红对照版与本次导入原文比较，用固定红字、下划线和删除线显示修改，打开即可查看；当前工作稿隐藏本次修改标记，待补提示仍保留。未采用候选只保存在完整备份中。</p><div class="ri-review-actions"><button class="ri-primary" data-ri-action="export-word">下载修改标红对照版</button><button class="ri-secondary" data-ri-action="export-clean">下载当前工作稿</button><button class="ri-secondary" data-ri-action="backup">下载完整备份</button><button class="ri-secondary" data-ri-action="cloud-save">备份当前版本到服务器</button></div><details class="ri-tracked-export"><summary>可选：在 Word 中接受或拒绝修改</summary><p class="ri-muted">Word 修订版同样只对照已采用内容与本次导入原文。修订颜色随软件设置；看不到增删时，请在 Word/WPS 选择“所有标记”。</p><button class="ri-secondary" data-ri-action="export-tracked">下载 Word 修订版</button></details><p class="ri-footnote">原稿已有格式与修订保留，不能据颜色推断上传前的修改。分页需实际核对，下载不代表正式成稿验收通过。服务器备份按次保存，本机修改不会自动同步。</p></section>';
  }
  async function download(captured, id) {
    const file = await store.getOriginal(id); requireActive(captured);
    const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    captured.message = '已取出保存的原始文件。';
  }
  function warnings(file) {
    const items = file?.parsed?.warnings || [];
    return '<details class="ri-notes"' + (items.length ? ' open' : '') + '><summary>导入核对说明' + (items.length ? ' · ' + items.length + ' 项' : '') + '</summary><p>网页用于阅读和整理目录，分页与 Word 可能不同。原文件完整保留，可随时下载核对。</p>' + (items.length ? '<ul>' + items.map(w => '<li>' + esc(w.message || w) + '</li>').join('') + '</ul>' : '<p>未发现解析器已知的复杂格式提示，仍请核对关键表格与图片。</p>') + '</details>';
  }
  function uploadPage() {
    return '<section class="ri-upload-grid"><div class="ri-card"><span class="ri-kicker">01 / 原稿导入</span><h2>从已有报告继续完善</h2><p class="ri-muted">先保留原稿，确认章节结构，再逐步补充内容。</p>'
      + '<label class="ri-field">工作稿名称<input id="riTitle" value="' + esc(state.title) + '" placeholder="选择主报告后自动填写" maxlength="200"></label>'
      + '<label class="ri-drop"><span class="ri-upload-icon" aria-hidden="true">↑</span><strong>选择主报告</strong><span>Word .docx · 单份不超过 30 MB</span><input id="riMain" type="file" accept=".docx"' + (state.busy ? ' disabled' : '') + '></label>'
      + (state.mainFile ? '<div class="ri-file-selected"><b>' + esc(state.mainFile.name) + '</b><span>' + size(state.mainFile.size) + ' · 主报告</span></div>' : '')
      + '<div class="ri-supplement"><label class="ri-field">补充资料（可选）<input id="riExtras" type="file" multiple accept=".docx,.pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg"' + (state.busy ? ' disabled' : '') + '></label><p class="ri-muted">专项稿、参考文件和测算资料分别标记。Word 可阅读，其他格式先保留原件；合计不超过 100 MB。</p>'
      + state.extras.map((item, i) => '<div class="ri-extra"><span title="' + esc(item.file.name) + '">' + esc(item.file.name) + '<small>' + size(item.file.size) + '</small></span><select aria-label="' + esc(item.file.name) + '的资料角色" data-ri-role="' + i + '">' + options(item.role, Object.entries(roles).filter(([key]) => key !== 'main')) + '</select><button class="ri-text-btn" data-ri-remove="' + i + '" aria-label="移除' + esc(item.file.name) + '">移除</button></div>').join('') + '</div>'
      + '<button class="ri-primary" data-ri-action="import"' + (!state.mainFile || state.busy ? ' disabled' : '') + '>保存原件并识别目录 <span aria-hidden="true">→</span></button><p class="ri-footnote">本步骤在浏览器内读取文件，不启动 AI 生成。</p></div>'
      + '<aside class="ri-card ri-library"><h2>我的导入工作稿</h2><p class="ri-muted">当前账号在此浏览器保存的工作稿。</p>'
      + (state.list.length ? state.list.map(d => '<button class="ri-draft" data-ri-open="' + esc(d.id) + '"><strong>' + esc(d.title) + '</strong><span>' + (d.confirmed ? '目录已确认' : '待确认目录') + ' · ' + d.fileCount + ' 份文件</span><small>' + esc(new Date(d.updatedAt).toLocaleString('zh-CN')) + '</small><b aria-hidden="true">↗</b></button>').join('') : '<div class="ri-empty"><span aria-hidden="true">▤</span><h3>还没有导入工作稿</h3><p>上传第一份主报告后，即可在这里继续打开。</p></div>')
      + '<button class="ri-secondary" data-ri-action="refresh-list">刷新列表</button></aside></section>' + cloudPanel();
  }
  function outlinePage() {
    const file = main(), blocks = file.parsed.blocks;
    const candidates = state.filter === 'all' ? blocks.filter(b => b.type === 'paragraph' || state.draft.outline.some(o => o.blockId === b.id)) : blocks.filter(b => state.draft.outline.some(o => o.blockId === b.id));
    return '<div class="ri-step-head"><div><h2>核对原稿目录</h2><p class="ri-muted">识别 ' + state.draft.outline.length + ' 个标题。标题级别和显示名称可调整，原文顺序与文字保持不变。</p></div><button class="ri-primary" data-ri-action="confirm">确认目录，进入原文工作区 →</button></div>' + warnings(file)
      + '<div class="ri-outline-tools"><label>显示 <select id="riFilter">' + options(state.filter, [['all', '全部段落（可补标标题）'], ['headings', '仅已识别标题']]) + '</select></label><span>把误识别的标题设为“正文”；漏识别的段落可设为一至六级标题。</span></div>'
      + '<div class="ri-outline-list">' + (candidates.length ? candidates.map(block => {
        const heading = state.draft.outline.find(o => o.blockId === block.id);
        return '<div class="ri-outline-row' + (heading ? ' is-heading' : '') + '" data-ri-block="' + esc(block.id) + '"><div><small>原文位置 ' + (blocks.indexOf(block) + 1) + (heading ? ' · ' + (heading.source === 'manual' ? '已人工调整' : '自动识别，请核对') : '') + '</small><p>' + esc(block.text || '（空段落）') + '</p>'
          + (heading ? '<label>目录显示名称<input data-ri-heading-title="' + esc(block.id) + '" value="' + esc(heading.title) + '" maxlength="300"></label>' : '') + '</div><select aria-label="段落' + esc(block.id) + '标题级别" data-ri-level="' + esc(block.id) + '">' + options(heading?.level || 0, [[0, '正文'], [1, '一级标题'], [2, '二级标题'], [3, '三级标题'], [4, '四级标题'], [5, '五级标题'], [6, '六级标题']]) + '</select></div>';
      }).join('') : '<div class="ri-empty">没有识别到标题。切换“全部段落”后，可手动标记；也可按原文直接阅读。</div>') + '</div>';
  }
  function readPage() {
    const file = currentFile(), outline = file.id === main().id ? state.draft.outline : file.parsed?.outline || [];
    return '<div class="ri-step-head"><div><h2>原文与完善工作区</h2><p class="ri-muted">原稿完整保留。AI 建议先审阅，接受后才显示在工作稿中。</p></div><button class="ri-secondary" data-ri-action="outline">调整主报告目录</button></div>'
      + '<div class="ri-reader-grid"><aside class="ri-reader-nav"><label class="ri-field">阅读文件<select id="riFile">' + options(file.id, state.draft.files.map(f => [f.id, roles[f.role] + ' · ' + f.name])) + '</select></label><h3>原稿目录 <small>' + outline.length + '</small></h3><nav aria-label="原稿章节">' + (outline.length ? outline.map(o => '<button data-ri-anchor="' + esc(o.blockId) + '" style="padding-left:' + (10 + (Math.min(6, o.level) - 1) * 11) + 'px">' + esc(o.title) + '</button>').join('') : '<p class="ri-muted">暂无目录，可逐段阅读。</p>') + '</nav></aside>'
      + '<section class="ri-reader-main"><div class="ri-document-bar"><strong>' + esc(file.name) + '</strong><label>查看 <select id="riReviewView">' + options(state.reviewView, [['working', '查看修改标记'], ['clean', '当前工作稿'], ['original', '导入原文']]) + '</select></label><button class="ri-text-btn" data-ri-download="' + esc(file.id) + '">下载原件</button></div>' + changeSummary(file) + warnings(file)
      + '<article class="ri-document" aria-label="' + (file.id !== main().id || state.reviewView === 'original' ? '导入原文' : state.reviewView === 'clean' ? '当前工作稿' : '已采用修改对照') + '">' + (file.parsed ? file.parsed.blocks.map(b => '<section class="ri-source-block" id="ri-source-' + esc(b.id) + '" data-ri-select="' + esc(b.id) + '"><div class="ri-block-content" data-ri-content="' + esc(b.id) + '"></div></section>').join('') : '<div class="ri-empty"><h3>此资料已保留原件</h3><p>当前仅支持 Word .docx 的结构化阅读。可下载此文件在对应软件中查看。</p></div>') + '</article></section>'
      + '<aside class="ri-reader-aside"><span class="ri-kicker">原稿保护</span><h3>内容保留状态</h3><p class="ri-muted">默认在原文后补充。只有明确解除保护的纯文字段落才允许改写；表格、图片和标题保持原样。</p><div id="riBlockPanel"></div><hr><a href="#riReviewPanel">↓ 完善要求与差异审阅</a><p class="ri-muted">每次由你点击生成，不自动重试。采用记录先存于当前浏览器，可下载完整备份或备份到服务器。</p></aside></div>' + reviewPanel() + qualityPanel() + deliveryPanel() + cloudPanel();
  }
  function changeSummary(file) {
    if (file.id !== main().id) return '<div class="ri-change-summary" data-ri-change-summary>参考资料仅显示导入原文，主报告的修改标记不应用于参考资料。</div>';
    const original = new Map(file.parsed.blocks.map(block => [block.id, block.text]));
    const projected = root.ReportImportReview.project(state.draft);
    const changed = projected.filter(block => block.text !== original.get(block.blockId) || block.appendTexts.some(item => item.text));
    const rewritten = changed.filter(block => block.text !== original.get(block.blockId)).length;
    const appended = changed.reduce((sum, block) => sum + block.appendTexts.filter(item => item.text).length, 0);
    const text = changed.length ? '相对本次导入原文，已有 ' + changed.length + ' 处文字修改：改写 ' + rewritten + ' 段，补充 ' + appended + ' 段。' : '本稿没有网页内已采用的文字修改。';
    return '<div class="ri-change-summary" data-ri-change-summary><strong>' + text + '</strong><p>只统计仍然生效的已采用内容；待审候选、已撤销修改不计入。无法据此判断上传前是否已在其他软件修改。</p>'
      + (state.reviewView === 'working' ? '<div class="ri-change-legend" aria-label="修改标记图例"><span><ins>新增或替换后的文字</ins></span><span><del>已删去的文字</del></span><span class="ri-pending-marker">【待补：缺少资料】</span></div><p>新增为红色下划线，删除为红色删除线，待补为红字黄底。原稿已有红字照原样显示，不代表本次新增。</p>' : '<p>' + (state.reviewView === 'clean' ? '当前工作稿显示已采用结果，隐藏本次增删标记；待补提示继续显示。' : '正在查看导入时的原文，已采用修改请切换到“查看修改标记”。') + '</p>') + '</div>';
  }
  const reviewRequests = () => state.draft?.reviewState?.requests || [];
  function reviewSelection() {
    if (currentFile()?.id !== main()?.id) throw new Error('请切回主报告，再选择要完善的段落。补充资料不会自动并入正文。');
    if (!state.selected) throw new Error('先点选主报告中的一段文字，或从目录选择章节。');
    return root.ReportImportReview.plan(state.draft, { mode: state.reviewMode, scope: state.reviewScope, blockId: state.selected, instruction: state.reviewInstruction.trim() || '预览所选范围', referenceFileIds: state.referenceFileIds, referenceBlockIds: state.referenceBlockIds, writingProfileId: state.writingProfileId });
  }
  const referenceReady = plan => !!plan && !(plan.sourceContext?.files || []).some(file => file.status !== 'matched');
  function sourcePreview(context, saved = false) {
    if (!context) return '<p class="ri-muted">' + (saved ? '此历史请求未记录参考附件与专业规则快照。' : '选择主报告中的正文后，可预览本次取材与写法。') + '</p>';
    const files = context.files || [], labels = { matched: '已找到相关片段', no_match: '未找到相关片段', unparsed: '尚未解析文字', empty: '没有可读取文字' };
    return '<div class="ri-reference-context"><p><b>' + (saved ? '本次请求保存的来源' : '本次将发送的参考片段') + '</b> · ' + esc(context.writingRules?.label || '通用写法') + '</p>'
      + '<p class="ri-muted">所属章节：' + esc((context.directoryPath || []).map(item => item.title).join(' → ') || '未归入目录') + '</p>'
      + (files.length ? files.map(file => '<section class="ri-reference-file"><strong>' + esc(file.name) + '</strong><span class="ri-reference-status' + (file.status === 'matched' ? '' : ' is-missing') + '">' + esc(labels[file.status] || file.status) + '</span><p class="ri-muted">' + esc(file.message || '') + '</p>'
        + (context.references || []).filter(ref => ref.fileId === file.fileId).map(ref => '<details class="ri-reference-excerpt"><summary>' + esc(ref.label) + ' · 查看原文片段</summary><p class="ri-muted">原文位置 ' + esc((ref.positions || []).map(p => p.blockIndex + 1).join('、')) + '；位置按导入段落记录，不是 Word 页码。</p><blockquote>' + esc(ref.text) + '</blockquote>' + (ref.positions?.length ? '<button class="ri-text-btn" data-ri-source-file="' + esc(ref.fileId) + '" data-ri-source-block="' + esc(ref.positions[0].blockId) + '">打开这份资料的原文位置</button>' : '') + '</details>').join('') + '</section>').join('') : '<p class="ri-muted">未选择参考附件，本次只使用所选主稿文字。</p>')
      + '<p class="ri-footnote">' + esc(context.message || '仅截取与当前章节相关的部分文字，仍须核对资料。') + ' 取到片段不等于事实已经核实，也不代表 AI 使用了每条片段。</p>'
      + (context.writingRules ? '<details class="ri-reference-rules"><summary>查看本次复用的可研写作规则</summary><pre>' + esc(context.writingRules.prompt) + '</pre></details>' : '')
      + (!saved && files.some(file => file.status !== 'matched') ? '<p class="ri-reference-warning" role="status">所选资料还有未取得片段的文件。请换一个相关段落，或取消勾选该文件后再生成；本次不会悄悄忽略它。</p>' : '') + '</div>';
  }
  function referenceControls(plan) {
    const files = state.draft.files.filter(file => file.role !== 'main');
    const profiles = [['auto', '按当前章节自动选择'], ['basis', '依据清单'], ['description', '事实与范围'], ['market', '市场与项目影响'], ['demand', '客群与需求匹配'], ['pricing', '可比定价与取值'], ['financial', '财务结果与条件'], ['risk', '风险与针对性措施'], ['conclusion', '结论与决策边界'], ['plan', '方案与实施安排']];
    return '<div class="ri-reference-controls"><h3>本次参考哪些资料</h3><p class="ri-muted">勾选后，按当前章节从资料中选取相关片段。最多 5 份；未勾选的附件不会发送给 AI。</p>'
      + (files.length ? files.map(file => '<label class="ri-reference-choice"><input type="checkbox" data-ri-reference="' + esc(file.id) + '"' + (state.referenceFileIds.includes(file.id) ? ' checked' : '') + '><span>' + esc(file.name) + '<small>' + esc(roles[file.role] || '参考资料') + (file.parsed ? ' · 可检索文字' : ' · 仅保留原件，尚无可检索文字') + '</small></span></label>').join('') : '<p class="ri-muted">这份工作稿尚未上传参考附件。</p>')
      + files.filter(file => state.referenceFileIds.includes(file.id) && file.parsed).map(file => '<details class="ri-manual-source"><summary>指定参考段落：' + esc(file.name) + '</summary><p class="ri-footnote">不勾选时自动匹配；勾选后只取这些完整段落或表格。超过本次容量会提示缩小范围。</p>' + file.parsed.blocks.filter(b => b.text?.trim()).map((block, i) => '<label><input type="checkbox" data-ri-ref-block="' + esc(block.id) + '" data-ri-ref-file="' + esc(file.id) + '"' + ((state.referenceBlockIds || []).some(r => r.fileId === file.id && r.blockId === block.id) ? ' checked' : '') + '>第 ' + (file.parsed.blocks.indexOf(block) + 1) + ' 处 · ' + esc(block.text.slice(0, 110)) + '</label>').join('') + '</details>').join('')
      + '<label class="ri-field">专业写法<select id="riWritingProfile">' + options(state.writingProfileId, profiles) + '</select></label><p class="ri-footnote">共用 AI 可研生成的专业行文规则，可按当前章节调整。依据类标题仍只列依据清单。</p><div id="riReferenceContext">' + sourcePreview(plan?.sourceContext) + '</div></div>';
  }
  function qualityPanel() {
    if (!root.ReportImportQuality) return '';
    let result; try { result = root.ReportImportQuality.evaluate(state.draft); } catch (e) { return '<section class="ri-card"><p role="alert">' + esc(errorText(e)) + '</p></section>'; }
    const status = { open: '待处理', confirmed: '已人工确认', 'needs-data': '仍待补资料', 'not-applicable': '已登记不适用' };
    return '<section class="ri-card ri-quality" id="riQualityPanel"><h2>整稿查漏与口径确认</h2><p>共 ' + result.summary.total + ' 项提示，仍待处理 ' + result.summary.open + ' 项，其中关键项 ' + result.summary.criticalOpen + ' 项。</p><p class="ri-muted">' + esc(result.message) + '</p>' + result.findings.map(f => '<details class="ri-quality-finding" data-ri-finding="' + esc(f.id) + '"><summary>' + esc(status[f.status]) + ' · ' + esc(f.message) + '</summary>' + f.locations.map(loc => '<blockquote>' + esc((state.draft.files.find(file => file.id === loc.fileId)?.name || '') + (loc.blockIndex == null ? '' : ' · 第 ' + (loc.blockIndex + 1) + ' 处')) + '<p>' + esc(loc.text) + '</p></blockquote>').join('') + (f.decision ? '<p>上次记录：' + esc(f.decision.note) + '</p>' : '') + '<label class="ri-field">处理说明（至少 5 字）<textarea data-ri-quality-note rows="2" maxlength="2000">' + esc(f.decision?.note || '') + '</textarea></label>' + (f.kind === 'fact-conflict' ? '<label class="ri-field">确认采用的依据位置<select data-ri-quality-source><option value="">请选择并在说明中写清对象、时期和口径</option>' + f.locations.map((loc, i) => '<option value="' + i + '">' + esc((state.draft.files.find(file => file.id === loc.fileId)?.name || '') + ' · 第 ' + (loc.blockIndex + 1) + ' 处 · ' + loc.value) + '</option>').join('') + '</select></label>' : '') + '<div class="ri-review-actions"><button class="ri-secondary" data-ri-quality-decision="confirmed">记录人工确认</button><button class="ri-secondary" data-ri-quality-decision="needs-data">登记待补资料</button>' + (!['fact-conflict', 'professional-review'].includes(f.kind) ? '<button class="ri-secondary" data-ri-quality-decision="not-applicable">登记不适用</button>' : '') + '</div></details>').join('') + '<p class="ri-footnote">记录口径不会自动改动原数字。80 分验收分别看事实 30、内容 25、分析 20、审阅追溯 15、成果与恢复 10 分，需逐项实际审阅。</p></section>';
  }
  function pendingRanges(text) { return Array.from(String(text).matchAll(/【待补：[\s\S]*?】/g), match => [match.index, match.index + match[0].length]); }
  function pendingMarkup(text, offset = 0, ranges = pendingRanges(text)) {
    let result = '', cursor = 0;
    for (const [start, end] of ranges) {
      const from = Math.max(0, start - offset), to = Math.min(text.length, end - offset);
      if (from >= to) continue;
      result += esc(text.slice(cursor, from)) + '<span class="ri-pending-marker">' + esc(text.slice(from, to)) + '</span>'; cursor = to;
    }
    return result + esc(text.slice(cursor));
  }
  function highlightPendingMarkers(element) {
    // Add reading hints without changing the imported source or flattening its existing runs.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = [];
    let node, text = '';
    while ((node = walker.nextNode())) { nodes.push({ node, offset: text.length }); text += node.nodeValue; }
    const ranges = pendingRanges(text);
    for (const item of nodes) {
      if (item.node.parentElement?.closest('.ri-pending-marker')) continue;
      const value = item.node.nodeValue;
      const overlaps = ranges.filter(([start, end]) => end > item.offset && start < item.offset + value.length);
      if (!overlaps.length) continue;
      const template = document.createElement('template'); template.innerHTML = pendingMarkup(value, item.offset, overlaps);
      item.node.replaceWith(template.content);
    }
  }
  function diffMarkup(before, after) {
    try {
      let oldOffset = 0, newOffset = 0;
      const oldPending = pendingRanges(before), newPending = pendingRanges(after);
      return root.ReportImportReview.diff(before, after).map(part => {
        const marked = pendingMarkup(part.text, part.type === 'delete' ? oldOffset : newOffset, part.type === 'delete' ? oldPending : newPending);
        if (part.type !== 'insert') oldOffset += part.text.length;
        if (part.type !== 'delete') newOffset += part.text.length;
        return part.type === 'insert' ? '<ins>' + marked + '</ins>' : part.type === 'delete' ? '<del>' + marked + '</del>' : marked;
      }).join('');
    }
    catch (error) { if (error.code !== 'REVIEW_DIFF_LIMIT') throw error; return '<small class="ri-adopted-label">本段较长，显示全文前后对照；未执行逐字标记。</small><del>' + pendingMarkup(before) + '</del><br><ins>' + pendingMarkup(after) + '</ins>'; }
  }
  function candidateChoice(candidate) {
    const key = 'report-import:choice:' + encodeURIComponent(state.owner) + ':' + state.draft.id + ':' + candidate.id;
    if (state.candidateChoice?.key !== key) {
      let ids = candidate.changes.map(change => change.blockId);
      try { const saved = JSON.parse(sessionStorage.getItem(key)); if (Array.isArray(saved)) ids = ids.filter(id => saved.includes(id)); } catch (_) {}
      state.candidateChoice = { key, ids };
    }
    return state.candidateChoice;
  }
  function reviewPanel() {
    let plan = null, selectionError = '';
    try { plan = reviewSelection(); } catch (error) { selectionError = errorText(error); }
    const requests = reviewRequests(), running = requests.find(r => r.status === 'running' || r.status === 'outcome_unknown'), candidate = requests.find(r => r.status === 'ready');
    const latestAccepted = [...requests].reverse().find(r => r.status === 'accepted');
    const statuses = { running: '请求未结束', outcome_unknown: '结果待回查', ready: '待审阅', accepted: '已采用', rejected: '已拒绝', undone: '已撤销采用', failed: '未生成成功', cancelled: '已停止接收' };
    return '<section id="riReviewPanel" class="ri-review-panel"><div class="ri-step-head"><div><span class="ri-kicker">局部完善</span><h2>先看建议，再决定是否采用</h2><p class="ri-muted">发送所选主稿文字、你勾选的参考片段与完善要求，按可研专业写法生成候选。未经确认的数字继续保留。</p></div>' + (latestAccepted ? '<button class="ri-secondary" data-ri-action="undo-review">撤销最近一次采用</button>' : '') + '</div>'
      + '<div class="ri-review-compose"><div><label class="ri-field">完善方式<select id="riReviewMode">' + options(state.reviewMode, [['append', '保留原文，在后面补充'], ['rewrite', '改写已解除保护的纯文字段落']]) + '</select></label><label class="ri-field">本次范围<select id="riReviewScope">' + options(state.reviewScope, [['paragraph', '所选段落'], ['section', '所选章节（按已确认目录）']]) + '</select></label>'
      + '<div class="ri-scope-summary">' + (plan ? '<b>本次涉及 ' + plan.blocks.length + ' 段正文</b><p>' + esc(plan.blocks.map(b => b.text.slice(0, 48)).join(' / ')) + '</p>' + (plan.skippedBlocks?.length ? '<p>另有 ' + plan.skippedBlocks.length + ' 处标题、表图或受保护内容保持原样。</p>' : '') : esc(selectionError)) + '</div></div>'
      + '<div><label class="ri-field">你希望怎样完善<textarea id="riReviewInstruction" rows="4" maxlength="2000" placeholder="例如：补充一段运营管理建议，保留租金、出租率及原有结论，不新增未经核实的数据。">' + esc(state.reviewInstruction) + '</textarea></label><p class="ri-footnote">每次最多 10 段、12,000 字；补充总量最多 1,500 字。改写不调整原数字。表图、原有复杂格式不参与改写。</p><button class="ri-primary" data-ri-action="generate-review"' + (!referenceReady(plan) || !state.reviewInstruction.trim() || running || candidate || state.unsavedReview || state.busy ? ' disabled' : '') + '>生成一次 AI 建议</button><p class="ri-footnote">点击会调用已配置的 AI 服务，可能产生费用；失败不自动重试或切换模型。AI 建议仍须人工核实。</p></div></div>'
      + referenceControls(plan)
      + (running ? '<div class="ri-review-pending" role="status"><strong>' + (state.reviewTask ? '正在生成本次建议…' : '上次请求尚未确认结果') + '</strong><p>' + (state.reviewTask ? '原文未改变。可以停止接收；后台仍可能完成并产生费用。' : '请回查同一次请求。结果未确认前保留记录，不重新生成。') + '</p>' + (state.reviewTask ? '<button class="ri-secondary" data-ri-action="cancel-review">停止接收本次建议</button>' : running.durable ? '<button class="ri-secondary" data-ri-action="recover-review">回查这一次结果（不重新生成）</button>' : '<p>此历史请求没有服务器回执，请人工核对结果与费用。</p>') + '</div>' : '')
      + (state.unsavedReview ? '<div class="ri-review-pending"><strong>建议尚未保存，请保留本页</strong><p>原文未改变。可以只重试保存这份建议，不再调用 AI。</p><button class="ri-secondary" data-ri-action="save-review">仅重试保存建议</button></div>' : '')
      + (candidate ? '<div class="ri-candidate"><h3>待审候选 · 尚未采用</h3>' + sourcePreview(candidate.context.sourceContext, true) + '<p class="ri-muted">本次为所选 ' + candidate.context.blocks.length + ' 段中的 ' + candidate.changes.length + ' 段提供建议，其余段落保持原样。</p>' + (candidate.explanation ? '<p class="ri-scope-summary">AI 说明（未经核实）：' + esc(candidate.explanation) + '</p>' : '') + '<p class="ri-muted">红色下划线为新增内容，删除线为建议删去的文字。原文已有红字保留在上方原文阅读区，不与修改标记混用。</p>' + candidate.changes.map(change => '<section class="ri-change"><label><input type="checkbox" data-ri-accept-block="' + esc(change.blockId) + '"' + (candidateChoice(candidate).ids.includes(change.blockId) ? ' checked' : '') + '>采用这一段</label><h4>原文位置 · 第 ' + (main().parsed.blocks.findIndex(block => block.id === change.blockId) + 1) + ' 处' + '</h4><div class="ri-diff-grid"><div><small>' + (candidate.context.mode === 'append' ? '保留的原段落' : '本次修改前') + '</small><p data-ri-review-before>' + esc(candidate.context.mode === 'append' ? candidate.context.blocks.find(b => b.blockId === change.blockId)?.text : change.beforeText) + '</p></div><div><small>' + (candidate.context.mode === 'append' ? '建议补充在后面' : '建议改写 · 差异') + '</small><p data-ri-review-after>' + diffMarkup(change.beforeText || '', change.text) + '</p></div></div></section>').join('') + '<label class="ri-fact-confirm"><input type="checkbox" id="riFactConfirmation">如存在数值差异，我已在整稿查漏中记录依据并核实本次内容。</label><div class="ri-review-actions"><button class="ri-primary" data-ri-action="accept-review">接受勾选的建议</button><button class="ri-secondary" data-ri-action="reject-review">拒绝本次建议</button></div><p class="ri-footnote">接受后保存到独立工作稿，修改标记继续保留。原始文件不变。</p></div>' : '<div class="ri-review-empty">没有待审建议。选择范围并填写要求后，可生成一次候选。</div>')
      + (requests.length ? '<details class="ri-review-history"><summary>完善记录 · ' + requests.length + ' 次</summary>' + [...requests].reverse().map(r => '<div><b>' + esc(statuses[r.status] || r.status) + '</b><span>' + esc(r.context?.instruction || '') + '</span>' + (r.message ? '<p>' + esc(r.message) + '</p>' : '') + '<details><summary>查看这次使用的资料范围与规则</summary>' + sourcePreview(r.context?.sourceContext, true) + '</details></div>').join('') + '</details>' : '') + '</section>';
  }
  function refreshReviewPanel() {
    const panel = host?.querySelector('#riReviewPanel'); if (!panel || state.busy) return;
    clearTimeout(referenceTimer);
    const expanded = [...panel.querySelectorAll('.ri-manual-source')].map(node => node.open);
    panel.outerHTML = reviewPanel();
    host.querySelectorAll('.ri-manual-source').forEach((node, i) => { node.open = !!expanded[i]; }); bindReview();
  }
  async function reviewAction(captured, action) {
    if (captured.dirty) await save(captured);
    const result = await store.review(captured.draft.id, captured.draft.revision, action);
    requireActive(captured); captured.draft = result; captured.dirty = false; remember();
    return result;
  }
  async function generateReview(captured) {
    if (!captured.reviewInstruction.trim()) throw new Error('请先填写本次完善要求。');
    if (!referenceReady(reviewSelection())) throw new Error('所选资料未全部取得相关片段，请调整范围或取消勾选后再生成。');
    await reviewAction(captured, { type: 'begin', durable: true, mode: captured.reviewMode, scope: captured.reviewScope, blockId: captured.selected, instruction: captured.reviewInstruction.trim(), referenceFileIds: captured.referenceFileIds, referenceBlockIds: captured.referenceBlockIds, writingProfileId: captured.writingProfileId });
    const request = captured.draft.reviewState.requests.find(r => r.status === 'running');
    const task = { requestId: request.id, draftId: captured.draft.id, revision: captured.draft.revision, fileId: captured.fileId, blockId: captured.selected, controller: new AbortController(), panel: null };
    captured.reviewTask = task; draw(); task.panel = host?.querySelector('#riReviewPanel');
    const assertCurrent = () => {
      requireActive(captured);
      if (task.controller.signal.aborted || captured.reviewTask !== task || !task.panel?.isConnected || host?.querySelector('#riReviewPanel') !== task.panel || captured.draft.id !== task.draftId || captured.draft.revision !== task.revision || captured.fileId !== task.fileId || captured.selected !== task.blockId) throw new Error('已离开本次范围或停止接收，旧建议不会写入工作稿。');
    };
    let result = null, awaitingCandidate = true;
    try {
      const response = await root.ReportImportAI.generate({ ...request.context, requestId: request.id, signal: task.controller.signal, assertCurrent });
      awaitingCandidate = false;
      assertCurrent();
      const proposal = { type: 'complete', requestId: request.id, changes: response.edits.map(edit => ({ blockId: edit.blockId, text: edit.afterText })), explanation: response.explanation, meta: response.meta };
      root.ReportImportReview.apply(captured.draft, proposal);
      result = proposal;
      // Keep a returned suggestion in memory if its local save fails. Never pay for a retry just to save it.
      captured.unsavedReview = result;
      await reviewAction(captured, result);
      captured.unsavedReview = null;
      captured.message = '建议已保存，尚未改动工作稿。请逐项审阅后接受或拒绝。';
    } catch (error) {
      if (awaitingCandidate && error.code === 'TIMEOUT') {
        error = Object.assign(new Error('AI 生成超时，未取得完整候选；原文和工作稿仍保留。' + error.message + '。若请求已发出，请先核对本次结果与费用，避免重复生成。'), { code: 'AI_TIMEOUT', posted: error.posted });
      }
      if (active(captured) && captured.draft.id === task.draftId && !result) {
        try { await reviewAction(captured, { type: task.controller.signal.aborted ? 'cancel' : 'fail', requestId: request.id, confirmedNoCharge: error.posted === false || error.confirmedNoCharge === true, message: errorText(error) }); }
        catch (_) { /* The unresolved request remains recoverable; never discard its prior revision. */ }
      }
      throw error;
    } finally { if (captured.reviewTask === task) captured.reviewTask = null; }
  }
  async function recoverReview(captured) {
    const request = captured.draft.reviewState.requests.find(r => r.durable && ['running', 'outcome_unknown'].includes(r.status));
    if (!request) throw new Error('没有可回查的服务器请求。');
    const draftId = captured.draft.id, revision = captured.draft.revision;
    const assertCurrent = () => { requireActive(captured); if (captured.draft.id !== draftId || captured.draft.revision !== revision) throw new Error('工作稿版本已变化，未接收旧候选。'); };
    const response = await root.ReportImportAI.recover({ ...(request.receiptContext || request.context), requestId: request.id, assertCurrent }); assertCurrent();
    const proposal = { type: 'complete', recovered: true, requestId: request.id, changes: response.edits.map(edit => ({ blockId: edit.blockId, text: edit.afterText })), explanation: response.explanation, meta: response.meta };
    root.ReportImportReview.apply(captured.draft, proposal); captured.unsavedReview = proposal;
    await reviewAction(captured, proposal); captured.unsavedReview = null; captured.message = '已找回同一次请求的建议，没有重新调用 AI。请审阅后再采用。';
  }
  function bindReview() {
    host.querySelector('#riReviewInstruction')?.addEventListener('input', e => {
      state.reviewInstruction = e.target.value; const captured = state, button = host.querySelector('[data-ri-action="generate-review"]');
      let plan = null; try { plan = reviewSelection(); } catch (_) {}
      if (button) button.disabled = !referenceReady(plan) || !state.reviewInstruction.trim() || state.busy || !!state.unsavedReview || reviewRequests().some(r => r.status === 'running' || r.status === 'outcome_unknown' || r.status === 'ready');
      clearTimeout(referenceTimer); referenceTimer = setTimeout(() => {
        if (!active(captured) || state.busy) return;
        const preview = host?.querySelector('#riReferenceContext'); if (preview) { preview.innerHTML = sourcePreview(plan?.sourceContext); bindSourceLinks(); }
      }, 180);
    });
    host.querySelectorAll('[data-ri-accept-block]').forEach(el => { el.onchange = () => {
      const candidate = reviewRequests().find(request => request.status === 'ready'); if (!candidate) return;
      const choice = candidateChoice(candidate); choice.ids = [...host.querySelectorAll('[data-ri-accept-block]:checked')].map(node => node.dataset.riAcceptBlock);
      try { sessionStorage.setItem(choice.key, JSON.stringify(choice.ids)); } catch (_) {}
    }; });
    for (const [selector, field] of [['#riReviewMode', 'reviewMode'], ['#riReviewScope', 'reviewScope'], ['#riWritingProfile', 'writingProfileId']]) host.querySelector(selector)?.addEventListener('change', e => { state[field] = e.target.value; refreshReviewPanel(); });
    host.querySelectorAll('[data-ri-reference]').forEach(el => { el.onchange = () => { const ids = new Set(state.referenceFileIds); el.checked ? ids.add(el.dataset.riReference) : ids.delete(el.dataset.riReference); state.referenceFileIds = [...ids]; state.referenceBlockIds = (state.referenceBlockIds || []).filter(r => ids.has(r.fileId)); refreshReviewPanel(); }; });
    host.querySelectorAll('[data-ri-ref-block]').forEach(el => { el.onchange = () => { const { riRefFile: fileId, riRefBlock: blockId } = el.dataset; state.referenceBlockIds = (state.referenceBlockIds || []).filter(r => r.fileId !== fileId || r.blockId !== blockId); if (el.checked) state.referenceBlockIds.push({ fileId, blockId }); refreshReviewPanel(); }; });
    bindSourceLinks();
    host.querySelectorAll('#riReviewPanel [data-ri-action]').forEach(el => { el.onclick = () => {
      const action = el.dataset.riAction;
      const selectedBlocks = [...host.querySelectorAll('[data-ri-accept-block]:checked')].map(node => node.dataset.riAcceptBlock), factConfirmation = !!host.querySelector('#riFactConfirmation')?.checked;
      if (action === 'cancel-review' && state.reviewTask) { state.reviewTask.controller.abort(); el.disabled = true; return; }
      return run(async captured => {
        const requests = reviewRequests(), ready = requests.find(r => r.status === 'ready'), running = requests.find(r => r.status === 'running');
        if (action === 'generate-review') return generateReview(captured);
        if (action === 'recover-review') return recoverReview(captured);
        if (action === 'save-review' && captured.unsavedReview) { await reviewAction(captured, captured.unsavedReview); captured.unsavedReview = null; captured.message = '建议已保存，未再次调用 AI。'; return; }
        if (action === 'cancel-review' && running) { await reviewAction(captured, { type: 'cancel', requestId: running.id }); captured.message = '已结束未确认记录，没有重新调用 AI。'; }
        if ((action === 'accept-review' || action === 'reject-review') && ready) { await reviewAction(captured, { type: action === 'accept-review' ? 'accept' : 'reject', candidateId: ready.id, blockIds: selectedBlocks, factConfirmation }); captured.message = action === 'accept-review' ? '本次建议已采用并保存到工作稿。原件不变，可撤销本次采用。' : '已拒绝本次建议，工作稿正文未改变。'; }
        if (action === 'undo-review') { await reviewAction(captured, { type: 'undo' }); captured.message = '已撤销最近一次采用，记录与原件仍保留。'; }
      });
    }; });
  }
  function bindSourceLinks() {
    host.querySelectorAll('[data-ri-source-file]').forEach(el => { el.onclick = () => { if (state.busy) return; state.fileId = el.dataset.riSourceFile; state.selected = el.dataset.riSourceBlock; draw(); host.querySelector('[id="ri-source-' + CSS.escape(state.selected) + '"]')?.scrollIntoView({ block: 'center' }); }; });
  }
  // Allow only reader markup; even a tampered local record cannot execute or fetch external content.
  function safeFragment(html) {
    const template = document.createElement('template'); template.innerHTML = String(html || '');
    const tags = new Set(['P', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'INS', 'SUP', 'SUB', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI']);
    for (const el of [...template.content.querySelectorAll('*')]) {
      if (!tags.has(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent)); continue; }
      for (const attr of [...el.attributes]) {
        const value = attr.value;
        if (['colspan', 'rowspan', 'start', 'value'].includes(attr.name) && /^\d{1,4}$/.test(value)) continue;
        if (attr.name === 'alt' && el.tagName === 'IMG') continue;
        if (attr.name === 'src' && el.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)) continue;
        if (attr.name === 'style') {
          const allowed = /^(color|background-color|font-weight|font-style|text-decoration|text-align|vertical-align|white-space|font-size|margin-left|padding-left|width|max-width|height)$/;
          const declarations = [...el.style].filter(key => allowed.test(key)).map(key => [key, el.style.getPropertyValue(key)]).filter(([, val]) => !/url|expression|var\(|[<>]/i.test(val));
          el.removeAttribute('style'); for (const [key, val] of declarations) el.style.setProperty(key, val); continue;
        }
        el.removeAttribute(attr.name);
      }
      if (el.tagName === 'IMG' && !el.hasAttribute('src')) el.replaceWith(document.createTextNode('【图片未在阅读区显示，请下载原件核对】'));
    }
    return template.content;
  }
  function blockPanel() {
    const panel = host.querySelector('#riBlockPanel'); if (!panel) return;
    const file = currentFile(), block = file?.parsed?.blocks.find(b => b.id === state.selected);
    if (!block) { panel.innerHTML = '<p class="ri-muted">点选原文中的一段、表格或图片，可查看保留标记。</p>'; return; }
    panel.innerHTML = '<small>原文位置 ' + (file.parsed.blocks.indexOf(block) + 1) + '</small><p class="ri-block-summary">' + esc((block.text || '表格或图片').slice(0, 180)) + '</p>'
      + (file.id === main().id ? '<label class="ri-check"><input id="riProtected" type="checkbox"' + (state.draft.protectedBlockIds.includes(block.id) ? ' checked' : '') + '> 后续完善时保留此处原文</label>' : '<p class="ri-muted">补充资料只作为参考，未并入主报告。</p>');
    const checkbox = panel.querySelector('#riProtected'); if (checkbox) { checkbox.disabled = state.busy; checkbox.onchange = () => { const ids = new Set(state.draft.protectedBlockIds); checkbox.checked ? ids.add(block.id) : ids.delete(block.id); state.draft.protectedBlockIds = [...ids]; changed(); refreshReviewPanel(); }; }
  }
  function draw() {
    clearTimeout(referenceTimer);
    if (!host?.isConnected || !state) return;
    if (state.owner !== owner()) { host.innerHTML = '<div class="ri-empty"><h2>登录状态已变化</h2><p>请重新进入“已有报告完善”，读取当前账号的工作稿。</p></div>'; return; }
    if (!state.owner) { host.innerHTML = '<div class="ri-empty"><h2>请先登录</h2><p>登录后可按账号保存和重新打开导入工作稿。</p></div>'; return; }
    host.innerHTML = '<header class="ri-header"><div><span class="ri-kicker">已有报告完善</span><h1>' + (state.draft ? esc(state.draft.title) : '保留原稿，接着完善') + '</h1><p>独立工作稿 · 本机保存，可按版本备份到服务器</p></div><div class="ri-header-actions"><span data-ri-status></span>' + (state.draft ? '<button class="ri-secondary" data-ri-action="library">工作稿列表</button><button class="ri-secondary" data-ri-action="fork">另存副本</button><button class="ri-primary" data-ri-action="save">保存工作稿</button>' : '') + '</div></header>'
      + '<div class="ri-storage-note">请保留原始文件并下载完整备份。更换浏览器后，可用同一账号恢复备份；未备份的本机修改无法从服务器找回。</div>'
      + '<nav class="ri-steps" aria-label="原稿导入步骤">' + [['upload', '01', '上传原稿'], ['outline', '02', '确认目录'], ['read', '03', '原文工作区']].map(([key, n, title]) => '<button data-ri-page="' + key + '"' + (key !== 'upload' && (!state.draft || key === 'read' && !state.draft.confirmed) ? ' disabled' : '') + (state.page === key ? ' aria-current="step"' : '') + '><span>' + n + '</span>' + title + '</button>').join('') + '</nav>'
      + '<div class="ri-message" role="status" aria-live="polite">' + esc(state.message) + '</div>'
      + (state.error ? '<div class="ri-error" role="alert">' + esc(state.error) + (state.draft ? '<button class="ri-text-btn" data-ri-action="reload">重新读取已保存版本</button>' : '') + '</div>' : '')
      + '<div class="ri-body"' + (state.busy ? ' aria-busy="true"' : '') + '>' + (state.page === 'outline' && state.draft ? outlinePage() : state.page === 'read' && state.draft ? readPage() : uploadPage()) + '</div>';
    if (state.busy) { host.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = true; }); const cancel = host.querySelector('[data-ri-action="cancel-review"]'); if (cancel && state.reviewTask) cancel.disabled = false; }
    if (state.page === 'read' && state.draft) {
      const blocks = new Map((currentFile().parsed?.blocks || []).map(block => [block.id, block]));
      const working = state.reviewView !== 'original' && currentFile().id === main().id ? new Map(root.ReportImportReview.project(state.draft).map(block => [block.blockId, block])) : new Map();
      const showChanges = state.reviewView === 'working';
      host.querySelectorAll('[data-ri-content]').forEach(el => {
        const source = blocks.get(el.dataset.riContent), block = working.get(el.dataset.riContent);
        if (block && block.text !== source.text) el.innerHTML = (showChanges ? '<small class="ri-adopted-label">已采用改写 · 相对导入原文</small>' : '') + '<p class="ri-adopted-diff">' + (showChanges ? diffMarkup(source.text, block.text) : pendingMarkup(block.text)) + '</p>';
        else el.appendChild(safeFragment(source?.html));
        for (const addition of block?.appendTexts || []) el.insertAdjacentHTML('beforeend', '<div class="' + (showChanges ? 'ri-adopted-addition' : 'ri-working-addition') + '">' + (showChanges ? '<small class="ri-adopted-label">已采用补充</small>' : '') + '<p>' + (showChanges ? '<ins>' : '') + pendingMarkup(addition.text) + (showChanges ? '</ins>' : '') + '</p></div>');
        if (block) highlightPendingMarkers(el);
      }); blockPanel();
    }
    updateStatus(); bind();
  }
  function canDiscard() { return !(state.dirty || state.mainFile || state.extras.length || state.unsavedReview) || root.confirm('当前修改、AI 建议或所选文件尚未保存。确定离开吗？已保存版本仍会保留。'); }
  function resetUpload() { if (!canDiscard()) return; const list = state.list; state = fresh(owner()); state.list = list; try { sessionStorage.removeItem(lastKey()); } catch (_) {} draw(); }
  function bind() {
    host.querySelector('#riRestore')?.addEventListener('change', e => { const file = e.target.files[0]; if (file && canDiscard()) run(captured => restoreBackup(captured, file)); });
    host.querySelectorAll('[data-ri-cloud-restore]').forEach(el => { el.onclick = () => { if (!canDiscard()) return; run(async captured => { const pack = await root.ReportImportCloud.create().download(el.dataset.riCloudRestore); requireActive(captured); await restoreBackup(captured, pack.blob); }); }; });
    host.querySelectorAll('[data-ri-quality-decision]').forEach(el => { el.onclick = () => {
      const panel = el.closest('[data-ri-finding]'), findingId = panel.dataset.riFinding, note = panel.querySelector('[data-ri-quality-note]').value;
      const finding = root.ReportImportQuality.evaluate(state.draft).findings.find(row => row.id === findingId), selected = panel.querySelector('[data-ri-quality-source]')?.value;
      const sourceLocation = selected != null && selected !== '' ? finding.locations[Number(selected)] : undefined;
      run(async captured => { await reviewAction(captured, { type: 'quality-decision', findingId, decision: el.dataset.riQualityDecision, note, sourceLocation }); captured.message = '已保存人工处理记录。原文和数值未自动修改。'; });
    }; });
    host.querySelector('#riTitle')?.addEventListener('input', e => { state.title = e.target.value; });
    host.querySelector('#riMain')?.addEventListener('change', e => { const file = e.target.files[0]; if (!file) return; state.mainFile = file; if (!state.title) state.title = file.name.replace(/\.docx$/i, ''); state.error = ''; draw(); });
    host.querySelector('#riExtras')?.addEventListener('change', e => { for (const file of e.target.files) { if (!state.extras.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) state.extras.push({ file, role: 'reference' }); } draw(); });
    host.querySelectorAll('[data-ri-role]').forEach(el => { el.onchange = () => { state.extras[Number(el.dataset.riRole)].role = el.value; }; });
    host.querySelectorAll('[data-ri-remove]').forEach(el => { el.onclick = () => { state.extras.splice(Number(el.dataset.riRemove), 1); draw(); }; });
    host.querySelectorAll('[data-ri-open]').forEach(el => { el.onclick = () => { if (!canDiscard()) return; run(async captured => { const draft = await store.load(el.dataset.riOpen); requireActive(captured); acceptDraft(draft); }); }; });
    host.querySelectorAll('[data-ri-page]').forEach(el => { el.onclick = () => { const page = el.dataset.riPage; if (page === 'upload') resetUpload(); else { state.page = page; draw(); } }; });
    host.querySelector('#riFilter')?.addEventListener('change', e => { state.filter = e.target.value; draw(); });
    host.querySelectorAll('[data-ri-level]').forEach(el => { el.onchange = () => {
      const id = el.dataset.riLevel, old = state.draft.outline.find(o => o.blockId === id), block = main().parsed.blocks.find(b => b.id === id);
      state.draft.outline = state.draft.outline.filter(o => o.blockId !== id);
      if (+el.value) state.draft.outline.push({ blockId: id, title: old?.title || block.text, level: +el.value, source: 'manual', confidence: 1 });
      const order = new Map(main().parsed.blocks.map((b, i) => [b.id, i])); state.draft.outline.sort((a, b) => order.get(a.blockId) - order.get(b.blockId));
      state.draft.confirmed = false; changed(); draw();
    }; });
    host.querySelectorAll('[data-ri-heading-title]').forEach(el => { el.oninput = () => { const heading = state.draft.outline.find(o => o.blockId === el.dataset.riHeadingTitle); heading.title = el.value; heading.source = 'manual'; state.draft.confirmed = false; const readTab = host.querySelector('[data-ri-page="read"]'); if (readTab) readTab.disabled = true; changed(); }; });
    host.querySelector('#riFile')?.addEventListener('change', e => { state.fileId = e.target.value; state.selected = ''; draw(); });
    host.querySelector('#riReviewView')?.addEventListener('change', e => { state.reviewView = e.target.value; draw(); });
    host.querySelectorAll('[data-ri-anchor]').forEach(el => { el.onclick = () => { if (state.busy) return; state.selected = el.dataset.riAnchor; host.querySelector('[id="ri-source-' + CSS.escape(state.selected) + '"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); blockPanel(); refreshReviewPanel(); }; });
    host.querySelectorAll('[data-ri-select]').forEach(el => { el.onclick = () => { if (state.busy) return; state.selected = el.dataset.riSelect; host.querySelectorAll('.ri-source-block').forEach(block => block.classList.toggle('is-selected', block === el)); blockPanel(); refreshReviewPanel(); }; });
    host.querySelectorAll('[data-ri-download]').forEach(el => { el.onclick = () => run(captured => download(captured, el.dataset.riDownload)); });
    host.querySelectorAll('[data-ri-action]').forEach(el => { el.onclick = () => {
      const action = el.dataset.riAction;
      if (action === 'library') return resetUpload();
      if (action === 'outline') { state.page = 'outline'; state.fileId = main().id; draw(); return; }
      if (action === 'reload' && !canDiscard()) return;
      return run(async captured => {
        if (action === 'import') await importFiles(captured);
        if (action === 'save') await save(captured);
        if (action === 'confirm') await save(captured, true);
        if (action === 'fork') await fork(captured);
        if (action === 'backup') await backup(captured, false);
        if (action === 'cloud-save') await backup(captured, true);
        if (action === 'export-word') await exportWord(captured);
        if (action === 'export-clean') await exportWord(captured, 'clean');
        if (action === 'export-tracked') await exportWord(captured, 'tracked');
        if (action === 'cloud-list') { const items = await root.ReportImportCloud.create().list(); requireActive(captured); captured.cloudItems = items; captured.message = '已读取当前账号最近 100 份服务器备份。'; }
        if (action === 'refresh-list') await reloadList(captured);
        if (action === 'reload') { const draft = await store.load(captured.draft.id); requireActive(captured); acceptDraft(draft); }
      });
    }; });
    bindReview();
  }
  async function mount(element) {
    if (state?.reviewTask) state.reviewTask.controller.abort();
    host = element; host.classList.add('report-import');
    if (!store) store = root.ReportImportStore.create({ getOwner: owner });
    if (!state || state.owner !== owner()) state = fresh(owner());
    draw(); if (!state.owner || state.busy) return;
    const captured = state;
    await run(async () => {
      await reloadList(captured); requireActive(captured);
      let last = ''; try { last = sessionStorage.getItem(lastKey()) || ''; } catch (_) {}
      if (!captured.draft && last && captured.list.some(d => d.id === last)) { const draft = await store.load(last); requireActive(captured); acceptDraft(draft); }
    });
    if (!monitor) monitor = setInterval(() => { if (host?.isConnected && state && state.owner !== owner()) { state = fresh(owner()); mount(host); } }, 750);
  }
  root.addEventListener('storage', e => { if (e.key === 'fs_user' || e.key === 'fs_token' || e.key === null) { if (host?.isConnected && state?.owner !== owner()) { state = fresh(owner()); mount(host); } } });
  root.addEventListener('beforeunload', e => { if (state && (state.dirty || state.busy || state.mainFile || state.extras.length || state.unsavedReview)) { e.preventDefault(); e.returnValue = ''; } });
  root.ReportImportUI = { mount };
})(window);
