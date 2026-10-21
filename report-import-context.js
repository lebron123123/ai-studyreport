/* Explicit reference selection for an imported draft. No project globals or requests. */
(function (root, factory) {
  'use strict';
  const api = factory(() => typeof module === 'object' && module.exports
    ? require('./report-completion-contract.js') : root.ReportCompletionContract,
  () => typeof module === 'object' && module.exports
    ? require('./report-writing-standard.js') : root.ReportWritingStandard);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReportImportContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getEvidence, getWriting) {
  'use strict';
  const LIMITS = Object.freeze({ files: 5, referenceCharacters: 6000, fileCharacters: 1000000, sourceCharacters: 2000000, fileBlocks: 50000, queryTerms: 80 });
  const OFFSET_BASIS = 'parsed-block-text-newline-utf16-v1';
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
  function blocksOf(file) {
    const blocks = file.parsed?.blocks;
    if (!Array.isArray(blocks) || blocks.length > LIMITS.fileBlocks) fail('CONTEXT_INVALID', '资料段落结构无效或数量超限，请保留原件并缩小资料范围');
    const seen = new Set();
    for (const block of blocks) {
      if (!block || !id(block.id) || seen.has(block.id) || typeof block.text !== 'string') fail('CONTEXT_INVALID', '资料存在缺失或重复的原文位置，未选取参考片段');
      seen.add(block.id);
    }
    return blocks;
  }
  function directory(draft, blocks, at) {
    if (!Array.isArray(draft.outline || [])) fail('CONTEXT_INVALID', '主报告目录结构无效，请先校正目录');
    const indexes = new Map(blocks.map((block, index) => [block.id, index])), seen = new Set(), rows = [];
    for (const item of draft.outline || []) {
      if (!item || !indexes.has(item.blockId) || seen.has(item.blockId) || !Number.isInteger(item.level) || item.level < 1 || item.level > 6) fail('CONTEXT_INVALID', '主报告目录位置或级别无效，请先校正目录');
      seen.add(item.blockId);
      const title = item.title == null ? blocks[indexes.get(item.blockId)].text : item.title;
      if (typeof title !== 'string' || !title.trim() || title.length > 12000) fail('CONTEXT_INVALID', '主报告目录标题无效，请先校正目录');
      rows.push({ blockId: item.blockId, title, level: item.level, index: indexes.get(item.blockId) });
    }
    const path = [];
    for (const row of rows.sort((a, b) => a.index - b.index)) {
      if (row.index > at) break;
      while (path.length && path[path.length - 1].level >= row.level) path.pop();
      path.push({ blockId: row.blockId, title: row.title, level: row.level });
    }
    return path;
  }
  function termsFor(path, blockText, instruction = '', legacy = false) {
    // Search terms describe the user's task, not verified facts. Preserve priority:
    // explicit task, current accepted prose, then the chapter's broader vocabulary.
    const withoutNumber = text => text.replace(/^\s*(?:第[零〇一二两三四五六七八九十百千万\d]+[章节篇部]|[（(]?[一二三四五六七八九十百]+[）)、.．]|\d+(?:\.\d+)*[.、．\s]+)\s*/u, '');
    const text = legacy ? (path.length ? path.map(item => withoutNumber(item.title)).join(' ') : withoutNumber(blockText)) : [instruction, withoutNumber(blockText), ...path.map(item => withoutNumber(item.title))].join(' ');
    const terms = [], seen = new Set(), generic = new Set(['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十', '项目', '报告', '研究', '可行', '行性', '性研', '究报', '的项', '相关', '情况', '内容', '分析', '本章', '本节', '概述']);
    const add = term => { if (!generic.has(term) && !seen.has(term) && terms.length < LIMITS.queryTerms) { seen.add(term); terms.push(term); } };
    for (const token of text.match(/[\p{Script=Han}]+|[A-Za-z][A-Za-z0-9_-]{1,39}/gu) || []) {
      if (/^[A-Za-z]/.test(token)) add(token);
      else for (let i = 0; i < token.length - 1 && terms.length < LIMITS.queryTerms; i++) add(token.slice(i, i + 2));
      if (terms.length >= LIMITS.queryTerms) break;
    }
    return terms;
  }
  function sourceOf(file, evidence) {
    const blocks = blocksOf(file), spans = [];
    let characters = Math.max(0, blocks.length - 1);
    for (const block of blocks) characters += block.text.length;
    if (characters > LIMITS.fileCharacters) fail('CONTEXT_LIMIT', '所选单份资料的已解析文字超过 100 万字，请缩小资料范围；没有截断原件');
    let offset = 0;
    for (const [blockIndex, block] of blocks.entries()) {
      spans.push({ blockId: block.id, blockIndex, start: offset, end: offset + block.text.length });
      offset += block.text.length + 1;
    }
    const text = blocks.map(block => block.text).join('\n');
    return { text, spans, characters, fingerprint: evidence.fingerprint(blocks.map(block => ({ id: block.id, text: block.text }))) };
  }
  function rules(directoryPath, writingProfileId = 'auto') {
    const standard = getWriting();
    if (!standard?.defaults || !standard?.sectionProfile || !standard?.prompt || !Array.isArray(standard.PROFILE_IDS)) fail('CONTEXT_UNAVAILABLE', '现有专业行文标准尚未加载，请刷新后重试');
    if (writingProfileId !== 'auto' && !standard.PROFILE_IDS.includes(writingProfileId)) fail('CONTEXT_INVALID', '请选择有效的专业写法，不能传入自定义规则');
    if (!Array.isArray(directoryPath) || directoryPath.length > 6 || directoryPath.some(item => !item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 12000)) fail('CONTEXT_INVALID', '当前目录路径无效，未套用专业行文标准');
    const config = standard.defaults(), title = directoryPath.at(-1)?.title || '', chapter = directoryPath.slice(0, -1).map(item => item.title).join(' / ');
    // Use the shared classifier for basis headings, including descendants. Only a
    // finite profile selector reaches prompt(); document text never becomes writingLogic.
    const basis = directoryPath.some(item => standard.sectionProfile({ title: item.title }, config).id === 'basis');
    const context = { title, chapter, ...(basis ? { basis: true } : {}), ...(writingProfileId !== 'auto' ? { profileId: writingProfileId } : {}) };
    const profile = standard.sectionProfile(context, config);
    return { schemaVersion: 1, standardVersion: standard.VERSION, ruleVersion: standard.RULE_VERSION, requestedProfileId: writingProfileId, profileId: profile.id, label: profile.label, prompt: standard.prompt(config, context) };
  }
  function buildVersion(draft, options = {}, legacy = false) {
    if (!draft || !id(draft.id) || !id(draft.owner) || !Array.isArray(draft.files)) fail('CONTEXT_INVALID', '缺少当前独立工作稿身份，未选取参考资料');
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('CONTEXT_INVALID', '参考资料选择格式无效');
    const evidence = getEvidence();
    if (!evidence?.evidenceWindows || !evidence?.fingerprint) fail('CONTEXT_UNAVAILABLE', '现有章节选材模块尚未加载，请刷新后重试');
    const selected = options.referenceFileIds == null ? [] : options.referenceFileIds;
    if (!Array.isArray(selected) || selected.some(value => !id(value)) || new Set(selected).size !== selected.length) fail('CONTEXT_INVALID', '参考资料选择包含无效或重复编号，请重新选择');
    if (selected.length > LIMITS.files) fail('CONTEXT_LIMIT', '每次最多选择 5 份参考资料，请缩小范围；没有自动忽略已选资料');
    const filesById = new Map();
    for (const file of draft.files) {
      if (!file || !id(file.id) || filesById.has(file.id)) fail('CONTEXT_INVALID', '工作稿存在缺失或重复的文件编号，未选取参考资料');
      filesById.set(file.id, file);
    }
    const mains = draft.files.filter(file => file.role === 'main');
    if (mains.length !== 1 || !id(mains[0].hash)) fail('CONTEXT_INVALID', '主报告身份或原件校验值无效');
    const main = mains[0], blocks = blocksOf(main), at = blocks.findIndex(block => block.id === options.blockId);
    if (at < 0) fail('CONTEXT_SCOPE', '所选主报告原文位置不存在');
    const manual = options.referenceBlockIds == null ? [] : options.referenceBlockIds;
    if (!Array.isArray(manual) || manual.length > 30 || manual.some(row => !row || !id(row.fileId) || !id(row.blockId) || !selected.includes(row.fileId)) || new Set(manual.map(row => row.fileId + '\u0000' + row.blockId)).size !== manual.length) fail('CONTEXT_INVALID', '手选参考段落须属于已选文件，不能重复，最多 30 段');
    if (options.instruction != null && (typeof options.instruction !== 'string' || options.instruction.length > 2000)) fail('CONTEXT_INVALID', '完善要求格式无效或过长');
    if (options.workingText != null && (typeof options.workingText !== 'string' || options.workingText.length > 12000)) fail('CONTEXT_INVALID', '当前工作稿范围过长，请缩小选择');
    const directoryPath = directory(draft, blocks, at), queryTerms = termsFor(directoryPath, legacy ? blocks[at].text : (options.workingText ?? blocks[at].text), options.instruction || '', legacy);
    const result = { schemaVersion: 1, selectionVersion: 2, owner: draft.owner, draftId: draft.id, mainFileId: main.id, mainSourceHash: main.hash, blockId: options.blockId, directoryPath, writingProfileId: options.writingProfileId === undefined ? 'auto' : options.writingProfileId, writingRules: rules(directoryPath, options.writingProfileId), queryTerms, referenceFileIds: [...selected], referenceBlockIds: manual.map(row => ({ fileId: row.fileId, blockId: row.blockId })), offsetBasis: OFFSET_BASIS, files: [], references: [], coverage: 'none', message: '' };
    if (legacy) { delete result.selectionVersion; delete result.referenceBlockIds; }
    // Validate every selection and the total before any retrieval. Nothing is silently dropped.
    const sources = []; let total = 0;
    for (const fileId of selected) {
      const file = filesById.get(fileId);
      if (!file) fail('CONTEXT_SCOPE', '所选参考资料不属于当前工作稿，请重新选择');
      if (!['special', 'reference', 'calculation'].includes(file.role)) fail('CONTEXT_SCOPE', '参考资料须选择当前工作稿的补充文件，不能把主报告当作附件');
      if (!id(file.hash) || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 1000) fail('CONTEXT_INVALID', '参考资料名称或原件校验值无效');
      const source = file.parsed == null ? null : sourceOf(file, evidence);
      total += source?.characters || 0;
      if (total > LIMITS.sourceCharacters) fail('CONTEXT_LIMIT', '所选资料的已解析文字合计超过 200 万字，请缩小范围；没有截断原件');
      sources.push({ file, source });
    }
    const perFileBudget = selected.length ? Math.min(2600, Math.floor(LIMITS.referenceCharacters / selected.length)) : 0;
    for (const { file, source } of sources) {
      const row = { fileId: file.id, name: file.name, role: file.role, sourceHash: file.hash, parsedFingerprint: source?.fingerprint || null, status: 'unparsed', coverage: 'none', parsedCharacters: source?.characters || 0, excerptCharacters: 0, message: '只保留原件，尚无可读取的解析文字；本次未提供给 AI。' };
      result.files.push(row);
      if (!source) continue;
      if (!source.text.trim()) { row.status = 'empty'; row.message = '已解析文字为空，图片内容未做 OCR；本次未提供参考片段。'; continue; }
      const chosen = manual.filter(row => row.fileId === file.id);
      if (chosen.some(row => !source.spans.some(span => span.blockId === row.blockId))) fail('CONTEXT_SCOPE', '手选参考段落已缺失，请重新选择');
      // Existing window retrieval supplies a search signal. Only complete parsed blocks
      // are emitted: tables retain every row and header rather than a middle-cell slice.
      const windows = evidence.evidenceWindows([{ title: file.name, content: source.text }], queryTerms, perFileBudget);
      for (const window of windows) {
        const start = window.offset, end = start + window.text.length;
        if (!Number.isSafeInteger(start) || start < 0 || end > source.text.length || source.text.slice(start, end) !== window.text) fail('CONTEXT_INVALID', '参考片段与原文位置校验不一致，未提供给 AI');
      }
      if (legacy) {
        // Version-locked replay validates already saved requests only. New plans
        // always use whole blocks and cannot opt into this former window selection.
        const used = new Set();
        for (const window of windows) {
          const start = window.offset, end = start + window.text.length, key = start + ':' + end;
          if (used.has(key)) continue; used.add(key);
          const positions = source.spans.filter(span => span.start < end && span.end > start).map(span => ({ blockId: span.blockId, blockIndex: span.blockIndex, startOffset: Math.max(start, span.start) - span.start, endOffset: Math.min(end, span.end) - span.start }));
          if (!positions.length || !window.text.trim()) continue;
          result.references.push({ label: file.name, text: window.text, fileId: file.id, sourceHash: file.hash, offset: start, endOffset: end, positions }); row.excerptCharacters += window.text.length;
        }
        row.status = row.excerptCharacters ? 'matched' : 'no_match'; row.coverage = row.excerptCharacters ? 'selected_excerpts' : 'none';
        row.message = row.excerptCharacters ? '仅提供当前目录关键词命中的原文片段，不代表完整资料审查或事实已核实。' : '当前目录关键词未命中可用片段，不代表未上传或资料中没有相关内容；本次未提供参考片段。';
        continue;
      }
      const ranked = source.spans.map(span => {
        const text = source.text.slice(span.start, span.end);
        const score = queryTerms.reduce((sum, term, index) => sum + (text.includes(term) ? Math.max(1, LIMITS.queryTerms - index) : 0), 0);
        return { ...span, text, score };
      }).filter(span => span.text.trim() && (chosen.length ? chosen.some(item => item.blockId === span.blockId) : span.score > 0)).sort((a, b) => chosen.length ? a.blockIndex - b.blockIndex : b.score - a.score || a.blockIndex - b.blockIndex);
      const budget = chosen.length ? LIMITS.referenceCharacters : perFileBudget;
      if (chosen.length && ranked.length !== chosen.length) fail('CONTEXT_SCOPE', '手选参考包含空段落，无法作为正文证据');
      const included = [];
      for (const span of ranked) {
        if (included.length >= 30 || (!chosen.length && included.length >= 4)) break;
        if (span.text.length > budget || row.excerptCharacters + span.text.length > budget || result.references.reduce((sum, item) => sum + item.text.length, 0) + span.text.length > LIMITS.referenceCharacters) {
          if (chosen.length || !included.length) fail('CONTEXT_LIMIT', '完整参考段落或表格超过本次 6000 字总预算或单份分配预算，请缩小资料选择；没有截断原文、表头或表格');
          continue;
        }
        included.push(span);
        result.references.push({ label: file.name, text: span.text, fileId: file.id, sourceHash: file.hash, blockType: file.parsed.blocks[span.blockIndex].type, selection: chosen.length ? 'manual' : 'ranked', offset: span.start, endOffset: span.end, positions: [{ blockId: span.blockId, blockIndex: span.blockIndex, startOffset: 0, endOffset: span.text.length }] });
        row.excerptCharacters += span.text.length;
      }
      row.status = row.excerptCharacters ? 'matched' : 'no_match';
      row.coverage = row.excerptCharacters ? 'selected_excerpts' : 'none';
      row.message = row.excerptCharacters ? '提供完整段落或整表，按完善要求、当前工作稿及目录选材；仍不代表完整资料审查或事实已核实。' : '完善要求、当前工作稿和目录未命中可用片段，不代表未上传或资料中没有相关内容；可手选原文段落。';
    }
    result.coverage = result.references.length ? 'partial' : 'none';
    result.message = !selected.length ? '未选择参考资料；本次仅使用主稿选定范围。' : result.references.length ? '仅使用明确选中的资料片段；未命中、未解析资料不作为已读取证据，片段不代表完整审核。' : '已选资料本次未提供可用参考片段；不会自动启用其他附件。';
    return result;
  }
  function validateLegacy(draft, snapshot) {
    if (!snapshot || snapshot.selectionVersion != null || snapshot.schemaVersion !== 1) fail('CONTEXT_INVALID', '不是支持回验的历史参考快照');
    const rebuilt = buildVersion(draft, { blockId: snapshot.blockId, referenceFileIds: snapshot.referenceFileIds, writingProfileId: snapshot.writingProfileId }, true);
    if (JSON.stringify(rebuilt) !== JSON.stringify(snapshot)) fail('CONTEXT_STALE', '历史参考资料、位置或专业规则已经变化');
    return rebuilt;
  }
  return Object.freeze({ LIMITS, OFFSET_BASIS, build: (draft, options) => buildVersion(draft, options), validateLegacy, rules });
});
