(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReportImportCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const LIMITS = Object.freeze({ fileBytes: 50 * 1024 * 1024, expandedBytes: 120 * 1024 * 1024,
    partBytes: 24 * 1024 * 1024, imageBytes: 12 * 1024 * 1024, entries: 5000, xmlDepth: 120 });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const elements = node => Array.from(node ? node.childNodes : []).filter(n => n.nodeType === 1);
  const isW = (node, name) => node && node.namespaceURI === W && node.localName === name;
  const child = (node, name) => elements(node).find(n => isW(n, name));
  const children = (node, name) => elements(node).filter(n => isW(n, name));
  const attr = (node, name) => node ? (node.getAttributeNS(W, name) || '') : '';
  const descendants = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
  function fail(message, code) { const error = new Error(message); error.code = code || 'INVALID_DOCX'; throw error; }
  function integer(value, fallback, max) { const n = Number(value); return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback; }

  // Inspect declared sizes before giving the package to the ZIP reader. Actual streamed
  // bytes are capped too: declarations alone cannot safely constrain a damaged ZIP.
  function inspectZip(bytes, limits) {
    if (bytes.byteLength > limits.fileBytes) fail('文件超过 50 MiB，请拆分补充资料后重试；原文件没有修改。', 'FILE_TOO_LARGE');
    if (bytes.byteLength < 22) fail('文件不是有效的 Word .docx 压缩包。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
      if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
    }
    if (end < 0) fail('无法读取 Word 压缩包目录；请重新另存为 .docx。');
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || size === 0xffffffff || offset === 0xffffffff) fail('暂不支持分卷或 ZIP64 Word 文件。');
    if (count > limits.entries || offset + size > end) fail('Word 压缩包目录超出安全读取范围。', 'ZIP_LIMIT');
    let cursor = offset, total = 0;
    const names = new Set();
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('Word 压缩包目录已损坏。');
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
      const next = cursor + 46 + nameLength + extra + comment;
      if (next > end || expanded === 0xffffffff || compressed === 0xffffffff) fail('Word 压缩包目录格式不受支持。');
      const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some(s => s === '..') || names.has(name) || /[\u0000-\u001f]/.test(name)) fail('Word 包含不安全或重复的文件路径。');
      names.add(name);
      if ((flags & 1) || ![0, 8].includes(method)) fail('暂不支持加密或特殊压缩的 Word 文件，请先另存为普通 .docx。');
      total += expanded;
      if (expanded > limits.partBytes || total > limits.expandedBytes || (expanded > 2 * 1024 * 1024 && expanded > Math.max(1, compressed) * 500)) fail('Word 解压内容超过安全读取范围；没有截断导入。', 'ZIP_LIMIT');
      cursor = next;
    }
    if (cursor !== offset + size) fail('Word 压缩包目录长度不一致。');
    return { entryCount: count, expandedBytes: total };
  }
  function readPart(entry, limit) {
    if (!entry) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0, stopped = false;
      const stream = entry.internalStream('uint8array');
      stream.on('data', chunk => {
        if (stopped) return;
        size += chunk.length;
        if (size > limit) { stopped = true; stream.pause(); const e = new Error('Word 解压内容超过安全读取范围；没有截断导入。'); e.code = 'ZIP_LIMIT'; reject(e); return; }
        chunks.push(chunk);
      }).on('error', () => { stopped = true; const error = new Error('Word 内部部件解压失败；请重新另存为 .docx，原文件没有修改。'); error.code = 'INVALID_DOCX'; reject(error); }).on('end', () => {
        if (stopped) return;
        const bytes = new Uint8Array(size); let cursor = 0;
        chunks.forEach(chunk => { bytes.set(chunk, cursor); cursor += chunk.length; });
        resolve(bytes);
      }).resume();
    });
  }
  function parseXml(bytes, Parser, label, limits) {
    if (!bytes) return null;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { fail(label + ' 不是有效的 UTF-8 XML，请另存为标准 .docx。'); }
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(label + ' 含有不受支持的 XML 外部实体声明。');
    const doc = new Parser().parseFromString(text, 'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) fail(label + ' XML 已损坏，未导入半份正文。');
    const stack = [[doc.documentElement, 0]];
    while (stack.length) {
      const item = stack.pop();
      if (item[1] > limits.xmlDepth) fail(label + ' 结构嵌套超过安全读取范围。', 'XML_LIMIT');
      elements(item[0]).forEach(n => stack.push([n, item[1] + 1]));
    }
    return doc;
  }
  function properties(node) {
    const result = {};
    for (const name of ['b', 'i', 'strike']) {
      const el = child(node, name);
      if (el) result[name] = !['0', 'false', 'off'].includes(attr(el, 'val'));
    }
    const underline = child(node, 'u');
    if (underline) result.u = attr(underline, 'val') !== 'none';
    const color = attr(child(node, 'color'), 'val');
    if (/^[\da-f]{6}$/i.test(color)) result.color = color;
    const size = Number(attr(child(node, 'sz'), 'val'));
    if (size >= 8 && size <= 144) result.size = size / 2;
    const vertical = attr(child(node, 'vertAlign'), 'val');
    if (['superscript', 'subscript'].includes(vertical)) result.vertical = vertical;
    return result;
  }
  function styleHtml(html, props) {
    if (props.b) html = '<strong>' + html + '</strong>';
    if (props.i) html = '<em>' + html + '</em>';
    const style = [];
    if (props.color) style.push('color:#' + props.color);
    if (props.size) style.push('font-size:' + props.size + 'pt');
    const decoration = [props.u ? 'underline' : '', props.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (decoration) style.push('text-decoration:' + decoration);
    if (props.vertical) html = (props.vertical === 'superscript' ? '<sup>' : '<sub>') + html + (props.vertical === 'superscript' ? '</sup>' : '</sub>');
    return style.length ? '<span style="' + style.join(';') + '">' + html + '</span>' : html;
  }
  function inferHeading(text) {
    const value = text.trim();
    if (!value || value.length > 140 || /[。；！？!?]$/.test(value)) return null;
    if (/^第[零〇一二三四五六七八九十百\d]+[章节篇部]\s*\S/.test(value)) return { level: 1, source: 'manual-number', confidence: 'suggested' };
    const decimal = value.match(/^(\d{1,3}(?:[.．]\d{1,3}){1,5})(?:[、.．\s]|(?=[\u3400-\u9fff]))\s*\S/);
    if (decimal) return { level: Math.min(6, decimal[1].split(/[.．]/).length), source: 'manual-number', confidence: 'suggested' };
    if (/^[一二三四五六七八九十百]+[、．.]\s*\S/.test(value)) return { level: 1, source: 'manual-number', confidence: 'suggested' };
    if (/^[（(][一二三四五六七八九十百]+[）)]\s*\S/.test(value)) return { level: 2, source: 'manual-number', confidence: 'suggested' };
    return null;
  }
  function imageMime(bytes) {
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return 'image/gif';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    return '';
  }
  function base64(bytes) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
    if (typeof root.btoa === 'function') return root.btoa(result);
    return Buffer.from(bytes).toString('base64');
  }
  function resolveTarget(target) {
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/') || target.includes('\\')) return null;
    const parts = ['word'];
    for (const part of target.split('/')) {
      if (part === '..') { if (parts.length <= 1) return null; parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }

  async function parseDocx(input, options) {
    options = options || {};
    const fileName = String(options.fileName || (input && input.name) || '原稿.docx');
    if (!/\.docx$/i.test(fileName)) fail('本阶段支持 .docx 原稿；请用 Word 或 WPS 将 .doc 另存为 .docx。', 'UNSUPPORTED_FILE');
    const Zip = options.JSZip || root.JSZip, Parser = options.DOMParser || root.DOMParser;
    if (!Zip || !Parser) fail('Word 读取组件尚未就绪，请刷新页面后重试。', 'DEPENDENCY_MISSING');
    if (input && Number.isFinite(input.size) && input.size > LIMITS.fileBytes) fail('文件超过 50 MiB，请拆分补充资料后重试。', 'FILE_TOO_LARGE');
    const raw = input && typeof input.arrayBuffer === 'function' ? await input.arrayBuffer() : input;
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (!bytes) fail('无法读取原稿文件。');
    const zipInfo = inspectZip(bytes, LIMITS);
    let zip;
    try { zip = await Zip.loadAsync(bytes, { checkCRC32: false, createFolders: false }); }
    catch (_) { fail('Word 压缩包无法解压；请重新另存为 .docx。'); }
    let actualExpandedBytes = 0;
    const boundedPart = async (name, limit) => {
      const part = await readPart(zip.file(name), Math.min(limit, LIMITS.expandedBytes - actualExpandedBytes));
      if (part) actualExpandedBytes += part.length;
      return part;
    };
    const xmlPart = async name => parseXml(await boundedPart(name, LIMITS.partBytes), Parser, name, LIMITS);
    const doc = await xmlPart('word/document.xml');
    if (!doc || !isW(doc.documentElement, 'document')) fail('没有找到有效的 Word 正文；请上传普通 .docx 文件。');
    const body = child(doc.documentElement, 'body');
    if (!body) fail('Word 文件没有正文结构。');
    const warningMap = new Map();
    const warn = (code, message, count) => {
      const existing = warningMap.get(code);
      if (existing) existing.count += count || 1;
      else warningMap.set(code, { code, message, count: count || 1 });
    };
    warn('LAYOUT_APPROXIMATION', '网页保留正文结构和常用格式，不等同于 Word 排版；页眉页脚、分页、字体替换和复杂版式请对照原文件。');
    const stylesDoc = await xmlPart('word/styles.xml'), styles = new Map();
    let defaultRun = {}, defaultParagraphStyle = '';
    if (stylesDoc) {
      const defaults = descendants(stylesDoc, 'docDefaults')[0];
      defaultRun = properties(child(child(defaults, 'rPrDefault'), 'rPr'));
      for (const node of descendants(stylesDoc, 'style')) {
        const id = attr(node, 'styleId'), p = child(node, 'pPr');
        if (attr(node, 'type') === 'paragraph' && attr(node, 'default') === '1') defaultParagraphStyle = id;
        styles.set(id, { basedOn: attr(child(node, 'basedOn'), 'val'), name: attr(child(node, 'name'), 'val'),
          level: attr(child(p, 'outlineLvl'), 'val'), numId: attr(child(child(p, 'numPr'), 'numId'), 'val'),
          toc: [id, attr(child(node, 'name'), 'val')].some(value => /^(?:toc\s*[1-9]|toc\s*heading|目录\s*[1-9]|目录标题)$/i.test(value)),
          run: properties(child(node, 'rPr')) });
      }
    }
    function resolveStyle(id, seen) {
      seen = seen || new Set();
      if (!id || !styles.has(id) || seen.has(id)) return { run: {}, level: '', name: '', numId: '', toc: false };
      seen.add(id); const own = styles.get(id), parent = resolveStyle(own.basedOn, seen);
      return { run: { ...parent.run, ...own.run }, level: own.level === '' ? parent.level : own.level, name: own.name || parent.name,
        numId: own.numId === '' ? parent.numId : own.numId, toc: own.toc || parent.toc };
    }
    // Cache provenance affects navigation only. Ordinary content controls and the
    // saved TOC text remain source blocks with the same IDs and original order.
    const cachedTocParagraphs = new WeakSet(), fieldStack = [];
    const isTocInstruction = text => /^\s*TOC(?:\s|\\|$)/i.test(text);
    function indexCachedToc(node, inToc, paragraphNode) {
      if (isW(node, 'p')) paragraphNode = node;
      if (isW(node, 'sdt')) {
        const props = child(node, 'sdtPr');
        inToc = inToc || !!(props && descendants(props, 'docPartGallery').some(n => /^(?:Table of Contents|目录)$/i.test(attr(n, 'val').trim())));
      }
      if (isW(node, 'fldSimple')) inToc = inToc || isTocInstruction(attr(node, 'instr'));
      if (paragraphNode) {
        if (inToc) cachedTocParagraphs.add(paragraphNode);
        fieldStack.forEach(field => field.paragraphs.add(paragraphNode));
      }
      if (isW(node, 'fldChar')) {
        if (attr(node, 'fldCharType') === 'begin') fieldStack.push({ instruction: '', paragraphs: new Set(paragraphNode ? [paragraphNode] : []) });
        else if (attr(node, 'fldCharType') === 'end') {
          const field = fieldStack.pop();
          if (field && isTocInstruction(field.instruction)) field.paragraphs.forEach(p => cachedTocParagraphs.add(p));
        }
      } else if (isW(node, 'instrText') && fieldStack.length) fieldStack[fieldStack.length - 1].instruction += node.textContent;
      elements(node).forEach(n => indexCachedToc(n, inToc, paragraphNode));
    }
    // Only closed complex fields qualify; a damaged, unclosed TOC must not hide
    // every later heading. TOC styles/content controls still identify their rows.
    indexCachedToc(body, false, null);
    const unclosedTocFields = fieldStack.filter(field => isTocInstruction(field.instruction)).length;
    if (unclosedTocFields) warn('TOC_FIELD_UNCLOSED', '原稿的自动目录域未闭合，无法可靠判定缓存范围；已保留原文和后续标题，请手工核对目录。', unclosedTocFields);
    const relDoc = await xmlPart('word/_rels/document.xml.rels'), relations = new Map();
    if (relDoc) for (const rel of elements(relDoc.documentElement)) {
      if (rel.localName === 'Relationship') relations.set(rel.getAttribute('Id'), { target: rel.getAttribute('Target'), type: rel.getAttribute('Type'), external: rel.getAttribute('TargetMode') === 'External' });
    }
    const assets = [], imageById = new Map(), imageByPath = new Map();
    const imageIds = new Set(Array.from(doc.getElementsByTagName('*')).filter(n => n.localName === 'blip' || n.localName === 'imagedata').map(n => n.getAttributeNS(R, 'embed') || n.getAttributeNS(R, 'id') || n.getAttributeNS(R, 'link')).filter(Boolean));
    for (const id of imageIds) {
      const rel = relations.get(id), target = rel && !rel.external && resolveTarget(rel.target);
      if (!target || !rel.type || !rel.type.endsWith('/image') || !zip.file(target)) { warn('IMAGE_UNAVAILABLE', '部分图片为外部链接或缺失，网页未联网读取；请对照原文件。'); imageById.set(id, null); continue; }
      if (imageByPath.has(target)) { imageById.set(id, imageByPath.get(target)); continue; }
      const data = await boundedPart(target, LIMITS.imageBytes), mime = imageMime(data);
      if (!mime) { warn('IMAGE_UNSUPPORTED', '存在网页不支持的图片格式（如 EMF、WMF 或 SVG）；原文件仍完整保留。'); imageById.set(id, null); continue; }
      const image = { id: 'image-' + (assets.length + 1), part: target, mime, bytes: data.length, dataUrl: 'data:' + mime + ';base64,' + base64(data) };
      assets.push(image); imageById.set(id, image); imageByPath.set(target, image);
    }
    const counts = { paragraphs: 0, tables: 0, images: 0 }, outline = [];
    let embeddedImageCharacters = 0;
    function drawing(node) {
      const refs = Array.from(node.getElementsByTagName('*')).filter(n => n.localName === 'blip' || n.localName === 'imagedata');
      let html = '', text = '';
      for (const ref of refs) {
        const id = ref.getAttributeNS(R, 'embed') || ref.getAttributeNS(R, 'id') || ref.getAttributeNS(R, 'link'), asset = imageById.get(id);
        const descriptionNode = Array.from(node.getElementsByTagName('*')).find(n => n.localName === 'docPr');
        const description = descriptionNode ? descriptionNode.getAttribute('descr') || descriptionNode.getAttribute('name') || '原文图片' : '原文图片';
        if (asset) {
          embeddedImageCharacters += asset.dataUrl.length;
          if (embeddedImageCharacters > LIMITS.expandedBytes) fail('原稿中重复图片的预览体积过大，请拆分文件后导入；没有截断原文。', 'PREVIEW_LIMIT');
          counts.images++; html += '<img src="' + asset.dataUrl + '" alt="' + esc(description) + '" data-source-image="' + asset.id + '" style="max-width:100%;height:auto">';
        }
        else { html += '<span class="rfi-image-missing">[图片暂无法预览]</span>'; text += '[图片暂无法预览]'; }
      }
      for (const textbox of descendants(node, 'txbxContent')) {
        warn('TEXTBOX_LAYOUT', '文本框文字已读取，但位置和排版需对照原文件。');
        const result = renderChildren(textbox, '', false); html += result.html; text += result.text;
      }
      if (!refs.length && !descendants(node, 'txbxContent').length) { warn('DRAWING_UNSUPPORTED', '存在图表、公式绘图或形状，网页仅提供占位提示，请对照原文件。'); html += '<span>[原文绘图，需在原文件查看]</span>'; }
      if (Array.from(node.getElementsByTagName('*')).some(n => n.localName === 'anchor')) warn('FLOATING_IMAGE', '浮动图片按正文顺序展示，环绕和锚点位置请对照原文件。');
      return { html, text };
    }
    function inline(node, inherited) {
      if (node.nodeType !== 1) return { html: '', text: '' };
      if (isW(node, 'pPr') || isW(node, 'rPr')) return { html: '', text: '' };
      if (isW(node, 't') || isW(node, 'delText')) return { html: esc(node.textContent), text: node.textContent };
      if (node.localName === 'oMath' || node.localName === 'oMathPara') {
        warn('MATH_LAYOUT', '数学公式已保留可读取字符，但分数、上下标等结构暂未完整还原，请对照原文件。');
        const characters = Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 't')).map(n => n.textContent).join(' ');
        const text = '[公式字符：' + characters + '（结构请对照原文件）]';
        return { html: '<span class="rfi-math">' + esc(text) + '</span>', text };
      }
      if (node.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/math' && node.localName === 't') return { html: esc(node.textContent), text: node.textContent };
      if (isW(node, 'tab')) return { html: '\t', text: '\t' };
      if (isW(node, 'br') || isW(node, 'cr')) return { html: '<br>', text: '\n' };
      if (isW(node, 'noBreakHyphen')) return { html: '‑', text: '‑' };
      if (isW(node, 'softHyphen')) return { html: '\u00ad', text: '\u00ad' };
      if (isW(node, 'drawing') || isW(node, 'pict') || isW(node, 'object')) return drawing(node);
      if (isW(node, 'instrText') || isW(node, 'fldChar')) return { html: '', text: '' };
      if (isW(node, 'footnoteReference') || isW(node, 'endnoteReference')) return { html: '<sup>[注]</sup>', text: '[注]' };
      if (isW(node, 'sym')) { warn('SYMBOL_UNSUPPORTED', '存在特殊字体符号，网页显示占位，需对照原文件。'); return { html: '[特殊符号]', text: '[特殊符号]' }; }
      if (isW(node, 'hyperlink')) warn('LINK_AS_TEXT', '原文链接已按文字展示，不自动打开外部地址。');
      let props = inherited;
      if (isW(node, 'r')) props = { ...inherited, ...resolveStyle(attr(child(child(node, 'rPr'), 'rStyle'), 'val')).run, ...properties(child(node, 'rPr')) };
      const parts = elements(node).map(n => inline(n, props));
      let html = parts.map(p => p.html).join('');
      const text = parts.map(p => p.text).join('');
      if (isW(node, 'r')) html = styleHtml(html, props);
      if (isW(node, 'ins') || isW(node, 'del') || isW(node, 'moveFrom') || isW(node, 'moveTo')) {
        warn('TRACKED_CHANGES', '原稿含修订记录；插入和删除文字均保留标记，尚未替您接受或拒绝修订。');
        const deleted = isW(node, 'del') || isW(node, 'moveFrom');
        html = '<' + (deleted ? 'del' : 'ins') + ' data-original-revision="true">' + html + '</' + (deleted ? 'del' : 'ins') + '>';
      }
      if (node.localName === 'AlternateContent') warn('ALTERNATE_CONTENT', '存在兼容绘图内容，可能同时显示替代文字；请对照原文件核实。');
      return { html, text };
    }
    function paragraph(node, id, topLevel) {
      counts.paragraphs++;
      const p = child(node, 'pPr'), styleId = attr(child(p, 'pStyle'), 'val'), style = resolveStyle(styleId);
      const parts = elements(node).map(n => inline(n, { ...defaultRun, ...style.run }));
      const text = parts.map(n => n.text).join('');
      const cachedToc = cachedTocParagraphs.has(node) || style.toc;
      let level = attr(child(p, 'outlineLvl'), 'val') || style.level, heading = null;
      if (level !== '' && Number(level) >= 0 && Number(level) <= 5) heading = { level: Number(level) + 1, source: 'word-outline', confidence: 'explicit' };
      else {
        const match = (styleId + ' ' + style.name).match(/(?:heading|标题)\s*([1-6])/i);
        if (match) heading = { level: Number(match[1]), source: 'word-style', confidence: 'explicit' };
        else heading = inferHeading(text);
      }
      if (cachedToc) {
        heading = null;
        if (topLevel) warn('CACHED_TOC', '原稿中的缓存目录已保留在原文中，不重复列入正文章节目录。');
      } else if (topLevel && !heading && /^\s*\d{1,3}[、．.]\s*[^\d\s]/.test(text)) {
        warn('POSSIBLE_HEADINGS', '仅用 1.、2. 等编号的段落已保留为正文，未自动确定标题级别；该文件作为主稿导入时，可在目录确认中手工标记。');
      }
      const alignment = attr(child(p, 'jc'), 'val'), css = ['white-space:pre-wrap'];
      if (['left', 'right', 'center', 'both', 'justify'].includes(alignment)) css.push('text-align:' + (alignment === 'both' ? 'justify' : alignment));
      const numId = attr(child(child(p, 'numPr'), 'numId'), 'val') || (styleId ? style.numId : resolveStyle(defaultParagraphStyle).numId);
      if (numId && numId !== '0') warn('AUTOMATIC_NUMBERING', '存在自动编号（包括标题样式继承的编号）；网页保留正文文字，尚未还原这些编号，请对照原文件核对标题与编号。');
      const tag = heading && topLevel ? 'h' + heading.level : 'p';
      const html = '<' + tag + ' data-source-block="' + id + '" style="' + css.join(';') + '">' + (parts.map(n => n.html).join('') || '<br>') + '</' + tag + '>';
      if (heading && topLevel && text.trim()) outline.push({ blockId: id, title: text.trim(), ...heading });
      return { id, type: 'paragraph', text, html, headingLevel: heading && topLevel ? heading.level : null, styleId };
    }
    function table(node, id) {
      counts.tables++;
      const rows = [], active = new Map(); let rowIndex = 0;
      for (const row of children(node, 'tr')) {
        const cells = []; let column = integer(attr(child(child(row, 'trPr'), 'gridBefore'), 'val'), 0, 1000);
        const nextActive = new Map();
        for (const cell of children(row, 'tc')) {
          const props = child(cell, 'tcPr'), span = Math.max(1, integer(attr(child(props, 'gridSpan'), 'val'), 1, 1000));
          const merge = child(props, 'vMerge'), continuation = merge && attr(merge, 'val') !== 'restart';
          const cellId = id + '-r' + rowIndex + '-c' + column, content = renderChildren(cell, cellId, false);
          const existing = active.get(column);
          if (continuation && existing && existing.colSpan === span) {
            existing.rowSpan++;
            // Damaged merged cells can still carry unique text: keep it visibly.
            if (content.text.trim()) { existing.html += content.html; existing.text += '\n' + content.text; warn('MERGED_CELL_CONTENT', '纵向合并的后续单元格含文字，已保留在合并格内，请核对顺序。'); }
            for (let c = column; c < column + span; c++) nextActive.set(c, existing);
          } else {
            if (continuation) warn('MERGE_RECOVERED', '部分表格合并标记不完整，已保留单元格内容，请核对原文件。');
            const item = { id: cellId, col: column, colSpan: span, rowSpan: 1, text: content.text, html: content.html };
            cells.push(item);
            if (merge) for (let c = column; c < column + span; c++) nextActive.set(c, item);
          }
          column += span;
        }
        rows.push({ cells }); active.clear(); nextActive.forEach((v, k) => active.set(k, v)); rowIndex++;
      }
      const text = rows.map(row => row.cells.map(cell => cell.text).join('\t')).join('\n');
      const html = '<table data-source-block="' + id + '"><tbody>' + rows.map(row => '<tr>' + row.cells.map(cell => '<td colspan="' + cell.colSpan + '" rowspan="' + cell.rowSpan + '">' + cell.html + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      return { id, type: 'table', text, html, rows };
    }
    function renderChildren(node, prefix, topLevel) {
      const blocks = []; let index = 0;
      for (const element of elements(node)) {
        const id = (prefix || 'source') + '-b' + index++;
        if (isW(element, 'p')) blocks.push(paragraph(element, id, topLevel));
        else if (isW(element, 'tbl')) blocks.push(table(element, id));
        else if (isW(element, 'sdt')) { const content = child(element, 'sdtContent'); if (content) blocks.push(...renderChildren(content, id, topLevel).blocks); }
        else if (['customXml', 'ins', 'del', 'moveFrom', 'moveTo'].some(name => isW(element, name))) {
          if (!isW(element, 'customXml')) warn('TRACKED_CHANGES', '原稿含修订记录；插入和删除文字均保留标记，尚未替您接受或拒绝修订。');
          const nested = renderChildren(element, id, topLevel).blocks;
          for (const block of nested) {
            if (isW(element, 'del') || isW(element, 'moveFrom')) block.html = '<del data-original-revision="true">' + block.html + '</del>';
            else if (isW(element, 'ins') || isW(element, 'moveTo')) block.html = '<ins data-original-revision="true">' + block.html + '</ins>';
          }
          blocks.push(...nested);
        } else if (isW(element, 'altChunk')) {
          warn('ALTCHUNK_UNSUPPORTED', '原稿包含外嵌文档内容，网页无法完整展开；请在 Word 中展开后重新另存为 .docx。');
          blocks.push({ id, type: 'unsupported', text: '[外嵌文档，请查看原文件]', html: '<p data-source-block="' + id + '">[外嵌文档，请查看原文件]</p>' });
        } else if (element.localName === 'oMath' || element.localName === 'oMathPara') {
          const content = inline(element, defaultRun);
          blocks.push({ id, type: 'unsupported', text: content.text, html: '<p data-source-block="' + id + '">' + content.html + '</p>' });
        } else if (isW(element, 'subDoc')) {
          warn('SUBDOCUMENT_UNSUPPORTED', '原稿包含关联子文档，网页未联网读取，请在原文件中核对。');
          blocks.push({ id, type: 'unsupported', text: '[关联子文档，请查看原文件]', html: '<p data-source-block="' + id + '">[关联子文档，请查看原文件]</p>' });
        }
      }
      return { blocks, html: blocks.map(b => b.html).join(''), text: blocks.map(b => b.text).join('\n') };
    }
    for (const item of [['commentRangeStart', 'COMMENTS', '原稿包含批注；网页正文暂未展开批注，请查看原文件。'], ['footnoteReference', 'NOTES', '原稿包含脚注或尾注；正文保留注释位置，注释内容请查看原文件。'], ['endnoteReference', 'NOTES', '原稿包含脚注或尾注；正文保留注释位置，注释内容请查看原文件。'], ['instrText', 'FIELDS', '原稿包含目录、页码或计算域；网页展示已保存的可见结果，不重新计算。'], ['fldSimple', 'FIELDS', '原稿包含目录、页码或计算域；网页展示已保存的可见结果，不重新计算。'], ['vanish', 'HIDDEN_TEXT', '原稿含隐藏文字，网页会显示这些文字以便核对，请对照原文件。']]) {
      const count = descendants(doc, item[0]).length; if (count) warn(item[1], item[2], count);
    }
    const result = renderChildren(body, '', true);
    if (!result.blocks.length) fail('原稿没有可读取的正文段落或表格，请核对文件。', 'EMPTY_DOCUMENT');
    const hasUnsupported = ['ALTCHUNK_UNSUPPORTED', 'SUBDOCUMENT_UNSUPPORTED', 'IMAGE_UNAVAILABLE', 'IMAGE_UNSUPPORTED', 'DRAWING_UNSUPPORTED', 'SYMBOL_UNSUPPORTED', 'NOTES', 'MATH_LAYOUT', 'AUTOMATIC_NUMBERING', 'ALTERNATE_CONTENT', 'COMMENTS', 'TRACKED_CHANGES', 'TOC_FIELD_UNCLOSED'].some(code => warningMap.has(code));
    return { schemaVersion: 1, fileName, blocks: result.blocks, outline, plainText: result.text, assets,
      warnings: Array.from(warningMap.values()), completeness: hasUnsupported ? 'needs-original-check' : 'body-imported',
      stats: { ...counts, characters: result.text.length, sourceBytes: bytes.length, zipEntries: zipInfo.entryCount, declaredExpandedBytes: zipInfo.expandedBytes, actualReadBytes: actualExpandedBytes } };
  }
  return Object.freeze({ parseDocx, inferHeading, escapeHtml: esc, LIMITS });
});
