/* Deterministic review checklist for imported drafts. No model, score or fact certification. */
(function (root, factory) {
  'use strict';
  const api = factory(() => typeof module === 'object' && module.exports ? require('./report-import-review.js') : root.ReportImportReview,
    () => typeof module === 'object' && module.exports ? require('./report-completion-contract.js') : root.ReportCompletionContract);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ReportImportQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getReview, getContract) {
  'use strict';
  const fail = message => { throw Object.assign(new Error(message), { code: 'QUALITY_INVALID' }); };
  const RUBRIC = Object.freeze([{ topic: 'facts', label: '事实与数值口径', weight: 30 }, { topic: 'coverage', label: '结构与必要内容', weight: 25 }, { topic: 'analysis', label: '分析与项目适配', weight: 20 }, { topic: 'review', label: '可追溯与人工审阅', weight: 15 }, { topic: 'delivery', label: 'Word 成果与可恢复性', weight: 10 }]);
  const factTypes = [
    { topic: 'rent', label: '租金', labelPattern: /租金|租赁单价|租赁价格|出租均价/, pattern: /(?:租金|租赁单价|租赁价格|出租均价)[^\d\n。；]{0,26}(\d+(?:\.\d+)?)\s*(元(?:\s*[/／·]\s*(?:平方米|㎡|m²|m2|月|年))*)/gu },
    { topic: 'occupancy', label: '出租率/入住率', labelPattern: /出租率|入住率|租赁率/, pattern: /(?:出租率|入住率|租赁率)[^\d\n。；]{0,26}(\d+(?:\.\d+)?)\s*([%％])/gu },
    { topic: 'renovation', label: '改造费用/投资', labelPattern: /改造.*(?:费|成本|投资)|装修.*(?:费|成本|投资)|项目总(?:投资|成本)/, pattern: /(?:(?:改造|装修)[^\d\n。；]{0,12}(?:费(?:用)?|成本|投资)|项目总(?:投资|成本))[^\d\n。；]{0,26}(\d+(?:\.\d+)?)\s*(亿元|万元|元)(?![\d])/gu }
  ];
  const clean = text => String(text || '').replace(/\s+/g, '');
  const number = text => { const value = clean(text).replace(/[,，]/g, '').replace(/^约/, ''); return /^-?\d+(?:\.\d+)?%?$/.test(value) ? Number(value.replace('%', '')) : null; };
  const normalizedUnit = unit => clean(unit).replace(/平方米|m²|m2/g, '㎡').replace(/[／·]/g, '/').replace('％', '%');
  function tableRows(block) {
    if (block.type !== 'table' || !Array.isArray(block.rows)) return null;
    const rows = block.rows.map(row => {
      if (Array.isArray(row) && row.every(cell => typeof cell === 'string' || typeof cell === 'number' && Number.isFinite(cell))) return { cells: row.map(text => ({ text: String(text), colSpan: 1, rowSpan: 1 })) };
      return Array.isArray(row?.cells) && row.cells.every(cell => cell && typeof cell.text === 'string') ? row : null;
    });
    return rows.every(Boolean) ? rows : null;
  }
  const periodOf = text => /稳定|第三年|第3[-—至]12年/.test(text) ? '稳定期' : /首年|第一年|第1年/.test(text) ? '首年' : /第二年|第2年/.test(text) ? '第二年' : (text.match(/(?:20\d{2}年|第[一二三四五六七八九十\d]+年)/)?.[0] || '未注明阶段');
  // Only compare a shared object, unit and stage. Background statistics and unknown
  // table layouts remain review material; a percentage alone is not a conflict.
  function factScope(type, context, objects, subjectHint) {
    const label = context.label || context.text, before = context.before || label, full = context.text;
    if (/敏感性|盈亏平衡|下降|上升|增减|波动|摊销|折旧/.test(before) || /收入/.test(label) && type.topic === 'rent') return null;
    let subject = subjectHint;
    if (!subject) {
      const matches = objects.filter(value => before.includes(value)).sort((a, b) => before.lastIndexOf(b) - before.lastIndexOf(a));
      subject = /项目整体|项目平均|本次合作|项目总|整批/.test(before) ? '项目整体' : matches[0];
      const projectExplicit = /(?:本|该)项目|预测项目|项目出租率|项目租金|项目整体|项目平均|项目总|本次合作|方案/.test(before);
      if (!subject && !projectExplicit && !/^(?:平均)?(?:租金|出租率|入住率|租赁率|改造费用|改造成本|装修成本)/.test(before.trim())) return null;
      if (!subject && /全市|全区|同比|截至|竞品|可比|集中式公寓|现有房源|已有房源/.test(before) && !projectExplicit) return null;
      subject ||= '项目整体';
    }
    const period = type.topic === 'occupancy' ? periodOf(before) : '未注明阶段';
    const basis = type.topic === 'rent' ? /折后|折标准/.test(before) ? '折后' : /市场(?:平均)?租金/.test(label) ? '市场评估' : '拟采用' : '拟采用';
    const shape = type.topic === 'rent' && /主力户型|三房户型/.test(full) && subject !== '项目整体' ? '主力户型' : '整体';
    return { subject, period, basis, shape };
  }
  function factContexts(block, text) {
    if (block.type !== 'table' || !Array.isArray(block.rows)) return text.split(/[。；;\n]/).filter(Boolean).map(sentence => ({ text: sentence, ...(/预测项目出租率如下/.test(text) && /首年|第[二三]年|稳定期/.test(sentence) ? { subject: '项目整体' } : {}) }));
    const rows = block.rows.map(row => (row.cells || []).map(cell => String(cell.text || ''))), headers = rows[0] || [], contexts = [];
    const objectColumn = headers.findIndex(cell => /^(?:项目名称|小区(?:名称)?|房源名称)$/.test(clean(cell)));
    const periodColumn = headers.findIndex(cell => /^(?:年度|年份|运营阶段)$/.test(clean(cell)));
    const keyColumn = headers.findIndex(cell => /^(?:参数名称|指标名称)$/.test(clean(cell))), valueColumn = headers.findIndex(cell => /^(?:数值|参数值)$/.test(clean(cell)));
    for (const [rowOffset, row] of rows.slice(1).entries()) {
      if (block.rows[rowOffset + 1].cells.some(cell => (cell.colSpan || 1) !== 1 || (cell.rowSpan || 1) !== 1)) continue;
      if (keyColumn >= 0 && valueColumn >= 0) contexts.push({ text: row[keyColumn] + '：' + row[valueColumn], label: row[keyColumn], rowIndex: rowOffset + 1, subject: '项目整体' });
      for (const [columnIndex, header] of headers.entries()) {
        if (objectColumn < 0 && periodColumn < 0 && rows.length > 2) continue;
        if (!factTypes.some(type => type.labelPattern.test(header))) continue;
        const value = row[columnIndex] || '', unit = header.match(/亿元|万元|元(?:\s*[/／·]\s*(?:平方米|㎡|m²|m2|月|年))*|[%％]/u)?.[0] || '';
        if (number(value) === null) continue;
        const object = objectColumn >= 0 ? clean(row[objectColumn]) : '';
        const total = /^(?:合计|总计|平均|整体)$/.test(object) || objectColumn >= 0 && !object && rowOffset === rows.length - 2;
        contexts.push({ text: normalizedUnit(header) + '：' + value + (/%|％/.test(value) ? '' : unit), label: (periodColumn >= 0 ? row[periodColumn] + ' ' : '') + clean(header), rowIndex: rowOffset + 1, columnIndex, subject: total || periodColumn >= 0 ? '项目整体' : object || undefined });
      }
    }
    return contexts;
  }
  function arithmeticChecks(block) {
    if (block.type !== 'table' || !Array.isArray(block.rows)) return [];
    if (block.rows[0]?.cells?.some(cell => (cell.colSpan || 1) !== 1 || (cell.rowSpan || 1) !== 1)) return [];
    const rows = block.rows.map(row => (row.cells || []).map(cell => String(cell.text || ''))), headers = (rows[0] || []).map(clean), checks = [];
    const column = pattern => headers.findIndex(value => pattern.test(value));
    const area = column(/^(?:出租|总)?面积[（(](?:㎡|平方米)[）)]$/), unit = column(/^(?:平均)?租金[（(]元[\/／](?:㎡|平方米)[\/／]月[）)]$/);
    const singleArea = column(/^单套平均面积[（(](?:㎡|平方米)[）)]$/), singleRent = column(/^(?:单套月租|平均单套租金)[（(]元(?:[\/／]月)?[）)]$/), totalRent = column(/^月合计[（(]元[）)]$/);
    const object = column(/项目名称|小区名称/);
    function compare(rowIndex, columnIndex, expected, actual, formula, tolerance = 1) {
      if (expected !== null && actual !== null && Number.isFinite(expected) && Math.abs(expected - actual) > tolerance + 1e-8) checks.push({ rowIndex, columnIndex, formula, expected: Math.round(expected * 100) / 100, actual, object: rows[rowIndex]?.[object] || rows[rowIndex]?.[0] || '' });
    }
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]; if (/合计|总计/.test(row.join(' '))) continue;
      if (block.rows[rowIndex].cells.some(cell => (cell.colSpan || 1) !== 1 || (cell.rowSpan || 1) !== 1)) continue;
      for (const [areaIndex, rentIndex] of [[area, totalRent], [singleArea, singleRent]]) {
        if ([areaIndex, rentIndex, unit].some(index => index < 0) || row.length !== headers.length) continue;
        const a = number(row[areaIndex]), u = number(row[unit]), actual = number(row[rentIndex]);
        if (a !== null && u !== null) compare(rowIndex, rentIndex, a * u, actual, row[areaIndex] + ' × ' + row[unit], Math.max(actual !== null && actual % 10 === 0 ? 5 : 1, Math.abs(a * u) * 0.0001));
      }
    }
    if (totalRent >= 0) {
      const totals = rows.map((row, index) => /合计|总计/.test(row.slice(0, totalRent).join(' ')) ? index : -1).filter(index => index > 1);
      if (totals.length === 1) { const index = totals[0], values = rows.slice(1, index).map(row => number(row[totalRent])); if (values.every(value => value !== null)) compare(index, totalRent, values.reduce((a, b) => a + b, 0), number(rows[index][totalRent]), '同列明细求和', values.length); }
    }
    const weights = rows.findIndex(row => /^权重$/.test(clean(row[0]))), prices = rows.findIndex(row => /^调整后租金价格$/.test(clean(row[0]))), result = rows.findIndex(row => /^建议本项目市场租金$/.test(clean(row[0])));
    if (weights > 0 && prices > 0 && result > 0 && rows[weights].length === rows[prices].length && rows[weights].slice(1).every(value => /^\d+(?:\.\d+)?[%％]$/.test(clean(value)))) {
      const w = rows[weights].slice(1).map(value => number(value.replace('％', '%'))), p = rows[prices].slice(1).map(number);
      if (p.every(value => value !== null) && Math.abs(w.reduce((a, b) => a + b, 0) - 100) < 0.0001) compare(result, 1, w.reduce((sum, value, i) => sum + value * p[i] / 100, 0), number(rows[result][1]), p.map((value, i) => value + ' × ' + w[i] + '%').join(' + '));
    }
    return checks;
  }
  const categories = [
    ['overview', '项目概况与建设目标', /概况|概述|总论|项目基本/], ['basis', '编制与政策依据', /依据|政策|法规/],
    ['market', '市场与需求分析', /市场|需求|客户|客群/], ['plan', '建设或改造实施方案', /改造|建设方案|工程方案|实施方案/],
    ['operation', '运营与实施安排', /运营|实施|进度|组织|合作模式/], ['finance', '投资及财务口径', /投资|财务|资金|经济评价|融资/],
    ['risk', '风险与对策', /风险|对策/], ['conclusion', '结论与建议', /结论|建议/]
  ];
  function evaluate(draft) {
    if (!draft || !draft.owner || !draft.id || !Array.isArray(draft.files)) fail('工作稿身份或文件结构无效，未进行整稿检查');
    const main = draft.files.find(file => file.role === 'main');
    if (!main?.parsed?.blocks || !Array.isArray(draft.outline || [])) fail('尚无可读取的主报告或目录');
    const review = getReview(), contract = getContract();
    if (!review?.project || !contract?.fingerprint) fail('整稿检查依赖尚未加载，请刷新页面');
    const projection = new Map(review.project(draft).map(row => [row.blockId, row]));
    const findings = [], decisions = draft.reviewState?.qualityDecisions || [], facts = new Map(), allText = [];
    const objects = [...new Set(main.parsed.blocks.filter(block => block.type === 'table').flatMap(block => {
      const rows = tableRows(block) || [], headers = rows[0]?.cells || [], column = headers.findIndex(cell => /^(?:项目名称|小区(?:名称)?|房源名称)$/.test(clean(cell.text)));
      return column < 0 ? [] : rows.slice(1).map(row => clean(row.cells?.[column]?.text)).filter(value => value.length >= 2 && !/合计|总计|平均|^—$/.test(value));
    }))];
    const projectLocation = main.parsed.blocks.find(block => /项目建设地点[：:]/.test(block.text));
    const projectDistricts = projectLocation?.text.match(/[\u4e00-\u9fff]{2,3}区/g)?.map(value => value.replace(/^市/, '')) || [];
    if (!Array.isArray(decisions)) fail('人工处理历史格式无效，请保留备份后核对');
    const documentFingerprint = contract.fingerprint({ outline: draft.outline || [], files: draft.files.map(file => ({ id: file.id, hash: file.hash, parsed: file.parsed?.blocks?.map(block => ({ id: block.id, text: block.text })) || null })), working: [...projection.values()] });
    let scannedBlocks = 0, unparsedFiles = 0;
    const locate = (file, block, text, index) => ({ fileId: file.id, blockId: block.id, blockIndex: index, sourceHash: file.hash, text });
    function add(kind, severity, topic, message, locations, extra = {}) {
      const identity = JSON.stringify({ owner: draft.owner, draftId: draft.id, kind, topic, locations, ...extra, ...(!locations.length ? { documentFingerprint } : {}) });
      const id = 'quality_' + contract.fingerprint(identity);
      const decision = [...decisions].reverse().find(row => row && row.owner === draft.owner && ['confirmed', 'needs-data', 'not-applicable'].includes(row.decision) && row.findingId === id && row.evidenceKey === identity);
      findings.push({ id, kind, severity, topic, message, locations, evidence: locations.map(row => ({ ...row })), evidenceKey: identity, status: decision ? decision.decision : 'open', ...(decision ? { decision: structuredClone(decision) } : {}), ...extra });
    }
    for (const file of draft.files) {
      if (!file.parsed?.blocks) { unparsedFiles++; add('unparsed', 'warning', 'coverage', '文件仅保留原件，没有可检查的解析文字；图片也未自动 OCR。', [{ fileId: file.id, sourceHash: file.hash, blockId: null, text: file.name || '' }]); continue; }
      const paragraphs = [];
      for (const [index, block] of file.parsed.blocks.entries()) {
        if (typeof block.text !== 'string') fail('原稿存在无效文字块');
        scannedBlocks++;
        const current = file.id === main.id ? projection.get(block.id) : null;
        const text = current ? [current.text, ...current.appendTexts.map(row => row.text)].join('\n') : block.text;
        if (file.id === main.id) allText.push(text);
        const location = locate(file, block, text, index);
        // Read legacy string matrices without rewriting saved originals. Unknown
        // layouts retain plain-text checks but cannot support inferred table math.
        const structuredRows = tableRows(block), checkBlock = block.type === 'table' ? { ...block, rows: structuredRows } : block;
        if (file.id === main.id && /【待补[：:]|\bTODO\b|待核实|待确认/.test(text)) add('missing-data', 'warning', 'coverage', '正文仍有待补或待核实内容，需要补充依据后再确认。', [location]);
        if (/(?:^|[^\d])(?:19|20)\d{3,}年/.test(text)) add('year-format', 'warning', 'editorial', '发现五位或更多位的年份写法，请对照原始资料核对；系统不猜测正确年份。', [location]);
        if (block.type === 'paragraph') {
          const body = text.replace(/^\s*[（(]\d+[）)]\s*/, '').trim();
          if (body.length >= 60) {
            const earlier = paragraphs.find(row => body.startsWith(row.body) || row.body.startsWith(body));
            if (earlier) add('duplicate-paragraph', 'warning', 'editorial', '两处正文含相同的连续论述，请核对是否重复；较长段落的新增说明仍应保留。', [earlier.location, location]);
            paragraphs.push({ body, location });
          }
        }
        const otherDistrict = text.match(/为([\u4e00-\u9fff]{2,3}区)[\d一二三四五六七八九十]+个重点片区/)?.[1];
        if (projectLocation && projectDistricts.length && /项目所在片区/.test(text) && otherDistrict && !projectDistricts.some(value => value.endsWith(otherDistrict))) add('project-location-check', 'warning', 'facts', '本段把项目所在片区归入“' + otherDistrict + '”，与主稿建设地点不一致，疑似引用范围或异项目文字问题；请确认，系统不据此删稿或认证政策。', [locate(main, projectLocation, projectLocation.text, main.parsed.blocks.indexOf(projectLocation)), location]);
        for (const check of arithmeticChecks(checkBlock)) add('table-arithmetic', 'warning', 'facts', '表内可复算关系不一致：' + check.formula + ' = ' + check.expected + '，原列 ' + check.actual + '。请核对取整、未列调整及输入口径，不自动改为复算值。', [{ ...location, rowIndex: check.rowIndex, columnIndex: check.columnIndex }], { calculation: check });
        if (block.type === 'table') {
          const rows = structuredRows?.map(row => row.cells.map(cell => cell.text)) || [], headers = (rows[0] || []).map(clean), monthly = headers.findIndex(value => /^月租金收入[（(]元[）)]$/.test(value)), annual = headers.findIndex(value => /^年租金收入[（(]万元[）)]$/.test(value));
          if (monthly >= 0 && annual >= 0) for (const [rowIndex, row] of rows.entries()) {
            const m = number(row[monthly]), a = number(row[annual]);
            if (rowIndex && m !== null && a !== null && /半年|[1-9]个月/.test(row.join(' ')) && !/年化/.test(row.join(' ')) && Math.abs(m * 12 - a * 10000) <= 200) add('period-basis-check', 'warning', 'facts', '该行年收入接近月收入乘十二，但备注提到不足一年的计租期。请区分年化指标与实际首期现金流，不擅自按六个月或其他月数修改。', [{ ...location, rowIndex }]);
          }
        }
        for (const type of factTypes) {
          for (const context of factContexts(checkBlock, text)) for (const match of context.text.matchAll(new RegExp(type.pattern.source, type.pattern.flags))) {
            // A unit cost must never be captured as a total cost just because the
            // money token ends before the slash.
            if (type.topic === 'renovation' && /^\s*[/／·]/.test(context.text.slice(match.index + match[0].length))) continue;
            const before = context.text.slice(0, match.index + match[0].length), label = context.label || before.slice(Math.max(before.lastIndexOf('，'), before.lastIndexOf(',')) + 1);
            const scope = factScope(type, { ...context, before: context.label || before, label }, objects, context.subject); if (!scope) continue;
            const unit = normalizedUnit(match[2]), value = match[1] + unit, scale = unit === '亿元' ? 1e8 : unit === '万元' ? 1e4 : 1, canonicalUnit = /^(?:亿元|万元)$/.test(unit) ? '元' : unit;
            const key = JSON.stringify([type.topic, scope, canonicalUnit]), rows = facts.get(key) || [];
            if (!rows.some(row => row.value === value && row.location.fileId === file.id && row.location.blockId === block.id)) rows.push({ value, numeric: Number(match[1]) * scale, tolerance: Math.pow(10, -(match[1].split('.')[1]?.length || 0)) * scale / 2, label: type.label, topic: type.topic, scope: { ...scope, unit: canonicalUnit }, location: { ...location, ...(context.rowIndex !== undefined ? { rowIndex: context.rowIndex } : {}) } });
            facts.set(key, rows);
          }
        }
      }
    }
    for (const rows of facts.values()) {
      if (!rows.some((row, index) => rows.slice(index + 1).some(other => Math.abs(row.numeric - other.numeric) > Math.max(row.tolerance, other.tolerance) + 1e-8))) continue;
      const scope = rows[0].scope;
      add('fact-conflict', 'critical', rows[0].topic, scope.subject + ' · ' + scope.period + ' · ' + scope.basis + '的' + rows[0].label + '存在不同值；已按对象、阶段和单位分组，仍须确认版本及适用方案，系统不会自动选一个。', rows.map(row => ({ ...row.location, value: row.value })), { values: [...new Set(rows.map(row => row.value))], scope });
    }
    const byNumber = new Map(), byTitle = new Map(), outline = draft.outline || [], blocksById = new Map(main.parsed.blocks.map((block, index) => [block.id, { block, index }]));
    for (const item of outline) {
      const source = blocksById.get(item.blockId); if (!source) fail('目录指向不存在的原文位置');
      const title = String(item.title || source.block.text).trim(), number = title.match(/^\s*(\d+(?:\.\d+)+)(?=\s|[、．.]|[^\d.])/u)?.[1];
      const normalized = title.replace(/^\s*(?:第[一二三四五六七八九十百\d]+章|\d+(?:\.\d+)*[.、．\s]*)\s*/, '').replace(/\s+/g, '');
      const loc = locate(main, source.block, title, source.index);
      if (number) { const rows = byNumber.get(number) || []; rows.push(loc); byNumber.set(number, rows); }
      if (normalized) { const rows = byTitle.get(normalized) || []; rows.push(loc); byTitle.set(normalized, rows); }
    }
    for (const [number, locations] of byNumber) if (locations.length > 1) add('duplicate-number', 'warning', 'structure', '目录编号 ' + number + ' 重复，请确认是否同一层级误编号；不会自动重排原稿。', locations);
    for (const [title, locations] of byTitle) if (locations.length > 1) add('duplicate-title', 'warning', 'structure', '目录标题“' + title + '”重复，请人工确认业务分类是否不同。', locations);
    const titles = outline.map(row => row.title || blocksById.get(row.blockId)?.block.text || '').join('\n');
    for (const [topic, label, matcher] of categories) if (!matcher.test(titles)) add('section-check', 'warning', topic, '目录未识别到“' + label + '”。可能使用其他标题，请定位确认或登记不适用，不能据此断言缺章。', []);
    const ordered = outline.map(item => ({ ...item, ...blocksById.get(item.blockId) })).sort((a, b) => a.index - b.index);
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i], next = ordered[i + 1]?.index ?? main.parsed.blocks.length;
      if (next === item.index + 1 && ordered[i + 1]?.level > item.level) continue;
      const body = main.parsed.blocks.slice(item.index + 1, next).map(block => { const row = projection.get(block.id); return [row?.text || '', ...(row?.appendTexts || []).map(change => change.text)].join('\n'); }).join('\n');
      if (body.trim().length < 30) add('thin-section', 'warning', 'analysis', '标题下可检查正文较少，请人工判断是否只有标题、表格或论证不足；字数本身不代表质量。', [locate(main, item.block, item.title || item.block.text, item.index)]);
    }
    add('professional-review', 'critical', 'facts', '项目范围、合法合规依据、测算假设和结论仍需专业人员对照证据确认。机器检查不证明事实正确，也不自动给报告打 80 分。', []);
    add('delivery-review', 'warning', 'delivery', '最终 Word 的图表、红色修改、分页及备份恢复须按同一工作稿实际检查，不能由文字扫描代替。', []);
    const summary = { total: findings.length, open: findings.filter(row => row.status === 'open' || row.status === 'needs-data').length, criticalOpen: findings.filter(row => row.severity === 'critical' && !['confirmed', 'not-applicable'].includes(row.status)).length, confirmed: findings.filter(row => row.status === 'confirmed').length, scannedFiles: draft.files.length - unparsedFiles, scannedBlocks, mainCharacters: allText.join('\n').length, unparsedFiles };
    return { schemaVersion: 1, owner: draft.owner, draftId: draft.id, findings, summary, rubric: RUBRIC.map(row => ({ ...row })), score: null, factsVerified: false, method: 'deterministic-checklist', message: '这是本机规则查漏与人工处理记录；未调用 AI 审读整篇、未认证事实、未自动评分。' };
  }
  return Object.freeze({ evaluate, RUBRIC });
});
