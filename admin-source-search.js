/* 管理员按需批量寻源；搜索摘要不是原文，审核不是发布。 */
(function (global) {
  "use strict";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function queries(value) {
    const list = [...new Set(String(value || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
    if (!list.length) throw new Error("请每行输入一项文件名或检索需求");
    if (list.length > 30 || list.some(x => x.length > 1000)) throw new Error("每批最多 30 项，每项最多 1000 字；请拆分后搜索");
    return list;
  }
  function safeUrl(value) { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch (_) { return ""; } }
  async function request(path, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch(path, {method:"POST", headers:Object.assign({"Content-Type":"application/json"}, global.authHeaders ? global.authHeaders() : {}), body:JSON.stringify(body), signal:controller.signal});
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "后台请求失败，请重试");
      return data;
    } catch (e) { throw new Error(e.name === "AbortError" ? "请求超时，请重试；已提交的资料可到审核页核对" : e.message === "Failed to fetch" ? "后台暂不可达，请检查本地服务后重试" : e.message); }
    finally { clearTimeout(timer); }
  }
  global.mountAdminSourceSearch = function (host) {
    const panel = document.createElement("section");
    panel.className = "contrib-card admin-source-search";
    panel.innerHTML = '<h2>批量搜索政策与资料</h2><p class="sub">每行一个文件名或问题。搜索 → 查看来源 → 勾选提交资料审核 → 正式资料台账发布后进入 RAG。不会生成经验卡，也不会改动报告。</p><label>要找什么<textarea data-as="queries" rows="5" placeholder="深圳市保障性租赁住房项目认定办法 最新有效版本&#10;既有建筑维护与改造通用规范 GB 55022-2021 官方原文" style="width:100%;box-sizing:border-box"></textarea></label><div class="bar"><label><input type="checkbox" data-as="official" checked>限定 gov.cn 政府网站（其他官方域名可取消限制）</label></div><div class="bar"><button class="btn" data-as="search">开始批量搜索</button><button class="btn ghost" data-as="stop" disabled>停止后续任务</button><button class="btn ghost" data-as="submit" disabled>提取选中来源并提交资料审核</button></div><p class="sub">搜索结果暂存在本页；刷新会清空本页列表，已提交资料保存在后台。提取内容可能截断，发布日期、效力和完整性仍需人工核验。无法提取的文件不会以摘要冒充原文提交。</p><div data-as="status" role="status" aria-live="polite">尚未搜索</div><div data-as="results"></div>';
    host.prepend(panel);
    panel.querySelector('p.sub').textContent='搜索 → 勾选并提取正文 → 在本页核对分类 → 管理员审核通过并发布。自动分流并建立RAG索引；未核对的保留待核验。';
    panel.querySelector('[data-as="submit"]').textContent='提取选中来源，核对并发布';
    const upload = document.createElement('div');
    upload.className = 'bar';
    upload.innerHTML = '<label class="btn ghost">上传图片识别<input data-as="images" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:block;margin-top:8px"></label><span class="sub">每批30项、每项1000字。可选最多5张截图，每张不超过8MB；也可在搜索框直接粘贴截图。图片由本地服务OCR，不自动搜索或入库。</span>';
    panel.querySelector('label').before(upload);
    const el = key => panel.querySelector('[data-as="' + key + '"]');
    let rows = [], busy = false, stopped = false;
    panel.addEventListener('contribution-published',event=>{const row=rows.find(r=>r.reviewId===event.detail.id);if(row){row.state='已审核发布，索引已建立';render();}});
    const status = text => { el("status").textContent = text; };
    function controls() {
      el("search").disabled = busy; el("queries").disabled = busy; el("official").disabled = busy;
      el("images").disabled = busy;
      el("stop").disabled = !busy; el("submit").disabled = busy || !rows.some(r => r.selected && !r.submitted);
      panel.querySelectorAll("[data-row]").forEach(box => { box.disabled = busy || rows[Number(box.dataset.row)].submitted; });
    }
    function render() {
      el("results").innerHTML = rows.map((r, i) => '<article class="contrib-card"><label><input type="checkbox" data-row="'+i+'" '+(r.selected?'checked':'')+'> '+esc(r.title || r.url)+'</label><div class="contrib-meta">查询：'+esc(r.query)+'｜'+esc(r.publisher || "发布单位待核")+'｜'+esc(r.publishedAt || "日期待核")+'</div><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">查看来源网页</a><details><summary>搜索摘要（不是原文）</summary><p>'+esc(r.snippet || "无摘要")+'</p></details><p>'+esc(r.state || "未提交；请核对标题、来源与适用范围")+'</p></article>').join("");
      panel.querySelectorAll("[data-row]").forEach(box => { box.onchange = () => { rows[Number(box.dataset.row)].selected = box.checked; controls(); }; });
      controls();
    }
    el("stop").onclick = () => { stopped = true; status("正在结束当前请求；随后停止，已完成结果保留"); };
    async function recognize(files) {
      if (busy) return;
      if (!files.length || files.length > 5) { status('每次请选择1至5张图片'); return; }
      if (files.some(f => !['image/png','image/jpeg','image/webp'].includes(f.type) || f.size > 8*1024*1024)) { status('仅支持PNG、JPG、WebP图片，每张不超过8MB；未开始识别'); return; }
      busy = true; stopped = false; controls();
      const failures = []; let done = 0;
      for (const file of files) {
        if (stopped || !panel.isConnected) break;
        status('图片识别 ' + done + '/' + files.length + '：' + file.name);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
          for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
          const data = await request('/api/local-ocr', {dataBase64:btoa(binary)});
          if (!String(data.text || '').trim()) throw new Error('未识别到文字，请使用更清晰的截图');
          // 原样追加，保留已有输入；OCR换行、名称和文号交给用户确认，不静默截断。
          el('queries').value = [el('queries').value.trim(),String(data.text).trim()].filter(Boolean).join('\n');
        } catch (e) { failures.push(file.name + '：' + e.message); }
        done++;
      }
      busy = false; controls(); el('images').value = '';
      status((stopped ? '已停止识别 ' : '识别完成 ') + done + '/' + files.length + '。结果已追加到搜索框，请检查名称、文号，并整理为每行一项，再点击搜索。' + failures.join('；'));
    }
    el('images').onchange = () => recognize(Array.from(el('images').files || []));
    el('queries').addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.items || []).filter(x => x.kind === 'file').map(x => x.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); recognize(files); }
    });
    el("search").onclick = async () => {
      let tasks; try { tasks = queries(el("queries").value); } catch (e) { status(e.message); return; }
      if (busy) return;
      busy = true; stopped = false; rows = []; render();
      const failures = []; let done = 0;
      for (const q of tasks) {
        if (stopped || !panel.isConnected) break;
        status("搜索中 " + done + "/" + tasks.length + "：" + q);
        try {
          const data = await request("/api/webresearch", {action:"search", query:q + (el("official").checked ? " site:gov.cn" : ""), requirement:"后台资料寻源", maxQueries:1, maxResults:5, limit:5});
          const found = data.results || [];
          if (!found.length) failures.push(q + "：" + (data.skipped ? data.stopReason : "未找到结果，请调整名称或取消域名限制"));
          for (const r of found) { const url = safeUrl(r.url); if (url && !rows.some(x => x.url === url)) rows.push({...r, url, query:q, selected:false, submitted:false}); }
        } catch (e) { failures.push(q + "：" + e.message); }
        done++; render();
      }
      busy = false; render(); status((stopped ? "已停止 " : "搜索完成 ") + done + "/" + tasks.length + "，" + rows.length + " 条候选来源。" + failures.join("；"));
    };
    el("submit").onclick = async () => {
      if (busy) return;
      const selected = rows.filter(r => r.selected && !r.submitted);
      busy = true; stopped = false; controls(); let done = 0;
      for (const row of selected) {
        if (stopped || !panel.isConnected) break;
        status("提取并提交 " + done + "/" + selected.length);
        try {
          const {document:doc} = await request("/api/webresearch", {action:"fetch", url:row.url, evidenceId:row.evidenceId});
          if (!doc || typeof doc.text !== "string" || doc.text.trim().length < 80) throw new Error("未取得可用正文；请从来源网站下载文件后走资料上传，未提交摘要");
          const data = await request("/api/contributions", {action:"submit", item:{kind:"material", title:row.title || doc.title || row.url, content:doc.text, source_ref:row.url, meta:{idempotencyKey:"admin-source-search", sourceChannel:"admin_web_search", sourceUrl:row.url, fetchedUrl:doc.url, evidenceId:row.evidenceId, fetchedAt:doc.fetchedAt, extractionStatus:doc.extractStatus, documentType:"网页提取文本", effectStatus:"unknown", note:"后台批量寻源：网页提取文本，可能截断；不是完整原件。标题、正文对应关系、效力、适用范围及完整性须人工审核。"}}});
          row.submitted = true; row.selected = false; row.state = (data.existing ? "已在资料审核链路，未重复提交" : "已提交资料审核，尚未发布到 RAG") + "（" + data.id + "）";
          row.reviewId=data.id;
        } catch (e) { row.state = "未完成：" + e.message + "；可勾选重试"; }
        done++; render();
      }
      busy = false; render(); status((stopped ? "已停止 " : "正文提取结束 ") + done + "/" + selected.length + "。请在下方核对正文、来源、分类后审核发布；不操作则保留待核验。");
      try{
        const ids=new Set(rows.map(r=>r.reviewId).filter(Boolean));
        const lists=await Promise.all(['pending','approved'].map(status=>request('/api/contributions',{action:'listReview',status})));
        const reviewRows=lists.flatMap(d=>d.items||[]).filter(r=>ids.has(r.id));
        panel.querySelector('[data-source-review]')?.remove();
        const review=document.createElement('div');review.dataset.sourceReview='';
        review.innerHTML=reviewRows.map(r=>'<article class="contrib-card"><h3>'+esc(r.title)+'</h3><a href="'+esc(safeUrl(r.source_ref))+'" target="_blank" rel="noopener noreferrer">核对原始来源</a><details><summary>展开已提取正文（请核验完整性）</summary><pre style="white-space:pre-wrap;max-height:360px;overflow:auto">'+esc(r.content)+'</pre></details><p>'+ (r.meta?.publication?.state==='published'?'已发布，可检索':'尚未发布，待管理员核对')+'</p><button class="btn" data-capprove="'+esc(r.id)+'">审核通过并发布</button></article>').join('');
        reviewRows.forEach((r,i)=>{if(r.meta?.publication?.state==='published')review.querySelectorAll('article')[i].querySelector('button').remove();});
        panel.append(review);global.mountContributionBatch(review,reviewRows);
      }catch(e){status('资料已保存，读取本页审核区失败：'+e.message+'。可到知识投稿审核继续，不需重新提交。');}
    };
  };
  if (typeof module === "object" && module.exports) module.exports = {queries, safeUrl};
})(typeof window !== "undefined" ? window : globalThis);
