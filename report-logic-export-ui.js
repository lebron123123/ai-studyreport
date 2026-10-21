/* 可研逻辑导出入口：每次下载重新读取发布快照，不保存或发布编辑内容。 */
(function reportLogicExportUIModule(global) {
  "use strict";

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function mount(container, options) {
    if (!container) throw new Error("缺少逻辑下载区域");
    options = options || {};
    if (container.__reportLogicExportHandle) container.__reportLogicExportHandle.destroy();
    let busy = false, destroyed = false, controller = null, catalog = [];
    const selected = new Set();
    const section = element("section", null, "rle-panel");
    section.setAttribute("aria-label", "下载可研生成逻辑");
    const style = element("style");
    style.textContent = ".rle-panel{margin:16px 0;padding:16px 18px;border:1px solid var(--line,#d8e3ed);border-radius:10px;background:#f5f9fd}.rle-panel h3{margin:0 0 8px;font-size:15px}.rle-note{margin:0 0 12px;color:var(--soft,#536576);font-size:12px;line-height:1.7}.rle-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rle-actions button{white-space:normal}.rle-panel button:disabled{opacity:.55;cursor:not-allowed}.rle-status{margin-top:10px;white-space:pre-wrap;font-size:13px;line-height:1.6}.rle-status[data-state=error]{color:#a92828}.rle-status[data-state=success]{color:#226840}.rle-batch{margin-top:14px;padding-top:14px;border-top:1px solid var(--line,#d8e3ed)}.rle-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:9px;margin:12px 0}.rle-choice{display:flex;align-items:flex-start;gap:8px;padding:9px;background:#fff;border:1px solid var(--line,#d8e3ed);border-radius:6px}.rle-choice input{flex-shrink:0;margin-top:3px}.rle-count{font-size:12px;color:var(--soft,#536576)}";
    section.append(style, element("h3", "下载最新逻辑表"), element("p", "默认下载服务器最新已发布逻辑，包含版本总览、全篇逻辑、章节与小节逻辑、专业成稿标准、版本变化。下载不会发布修改或改写报告。", "rle-note"));
    const actions = element("div", null, "rle-actions");
    function button(text, action, parent) {
      const node = element("button", text, "btn sm ghost");
      node.type = "button";
      node.dataset.rleAction = action;
      (parent || actions).append(node);
      return node;
    }
    const currentButton = button("下载当前类型最新逻辑", "current");
    const batchButton = button("批量下载逻辑", "batch");
    const draftButton = button("下载本次编辑稿（未发布）", "draft");
    draftButton.hidden = typeof options.isEditing === "function" ? !options.isEditing() : true;
    section.append(actions);
    const batchPanel = element("div", null, "rle-batch");
    batchPanel.hidden = true;
    batchPanel.append(element("b", "选择要汇报的报告类型"), element("p", "各类型分别导出；点击下载时会再次读取最新发布版本。", "rle-note"));
    const choices = element("div", null, "rle-choices");
    const batchActions = element("div", null, "rle-actions");
    const allButton = button("全选", "all", batchActions);
    const noneButton = button("清空选择", "none", batchActions);
    const downloadButton = button("下载所选类型最新逻辑", "selected", batchActions);
    const closeButton = button("收起", "close", batchActions);
    const count = element("span", "", "rle-count");
    batchActions.append(count);
    batchPanel.append(choices, batchActions);
    section.append(batchPanel);
    const status = element("div", "", "rle-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.append(status);
    container.replaceChildren(section);

    function alive() { return !destroyed && container.contains(section) && container.isConnected; }
    function message(text, state) {
      if (!alive()) return;
      status.textContent = text;
      status.dataset.state = state || "info";
    }
    function controls() {
      if (!alive()) return;
      section.setAttribute("aria-busy", String(busy));
      section.querySelectorAll("button, input").forEach(node => { node.disabled = busy; });
      downloadButton.disabled = busy || selected.size === 0;
      allButton.disabled = busy || catalog.length === 0;
      noneButton.disabled = busy || selected.size === 0;
      count.textContent = "已选 " + selected.size + " 个类型";
    }
    function available(snapshot) {
      if (!global.ReportLogicExport || typeof global.ReportLogicExport.scopes !== "function" || typeof global.ReportLogicExport.download !== "function") throw new Error("逻辑下载组件尚未加载，请刷新页面后重试；当前编辑内容请先保留。");
      const result = global.ReportLogicExport.scopes(snapshot);
      if (!Array.isArray(result)) throw new Error("服务器返回的逻辑类型目录不完整，请稍后手动重试。");
      return result;
    }
    async function freshSnapshot() {
      const timeout = Number(options.requestTimeoutMs) > 0 ? Math.min(Number(options.requestTimeoutMs), 120000) : 30000;
      controller = new AbortController();
      const requestController = controller;
      const timer = setTimeout(() => requestController.abort(), timeout);
      try {
        const headers = typeof global.authHeaders === "function" ? global.authHeaders() : {};
        const response = await fetch("/api/reportlogicexport", { method: "GET", headers, credentials: "same-origin", cache: "no-store", signal: requestController.signal });
        if (response.status === 401) throw new Error("登录已过期，请重新登录后再下载。当前编辑内容仍保留在页面中。");
        if (response.status === 403) throw new Error("当前账号没有导出后台逻辑的权限，请联系管理员。");
        if (!response.ok) throw new Error("服务器暂时无法读取最新逻辑，请稍后手动重试。当前编辑内容未改动。");
        let result;
        try { result = await response.json(); } catch (_) { throw new Error("服务器返回的逻辑快照无法解析，请稍后手动重试。"); }
        if (!result || result.ok !== true) throw new Error("服务器未返回完整的最新逻辑，请稍后手动重试。");
        return result;
      } catch (error) {
        if (requestController.signal.aborted) throw new Error("读取最新逻辑超时，请检查连接后手动重试；没有自动重试，也没有发布当前编辑内容。");
        if (error instanceof TypeError || /fetch failed|failed to fetch|networkerror|load failed|ECONN|EACCES/i.test(String(error && error.message))) throw new Error("无法连接逻辑服务，请检查网络和服务状态后手动重试。当前编辑内容未改动。");
        throw error;
      } finally {
        clearTimeout(timer);
        if (controller === requestController) controller = null;
      }
    }
    async function run(task, loading) {
      if (busy || !alive()) return;
      busy = true;
      controls();
      message(loading, "loading");
      try { await task(); }
      catch (error) { message(error && error.message || "逻辑表下载失败，请稍后手动重试。", "error"); }
      finally { busy = false; controls(); }
    }
    function renderChoices() {
      choices.replaceChildren();
      catalog.forEach(scope => {
        const label = element("label", null, "rle-choice");
        const input = element("input");
        input.type = "checkbox";
        input.dataset.rleScope = scope.key;
        input.checked = selected.has(scope.key);
        input.onchange = () => { if (input.checked) selected.add(scope.key); else selected.delete(scope.key); controls(); };
        label.append(input, element("span", scope.label || scope.key));
        choices.append(label);
      });
      controls();
    }
    async function download(keys, draft) {
      if (!keys.length || keys.some(key => !key)) throw new Error("请先选择需要下载的报告类型。");
      const snapshot = await freshSnapshot();
      if (!alive()) return;
      const latest = available(snapshot);
      const missing = keys.filter(key => !latest.some(scope => scope.key === key));
      if (missing.length) throw new Error("所选类型已变更或不再有已发布逻辑，请重新打开批量选择后再下载；本次未生成缺项表格。");
      message("已读取最新逻辑，正在生成 Excel…", "loading");
      await global.ReportLogicExport.download(snapshot, keys, draft ? { draft } : {});
      message(draft ? "已生成本次编辑稿（未发布、未保存）。下载没有保存或发布当前修改。" : "已生成 " + keys.length + " 个类型的最新已发布逻辑表，请在浏览器下载列表查看。", "success");
    }
    currentButton.onclick = () => run(() => download([typeof options.getCurrentScope === "function" ? options.getCurrentScope() : ""]), "正在读取当前类型的最新发布逻辑…");
    batchButton.onclick = () => run(async () => {
      batchPanel.hidden = false;
      const snapshot = await freshSnapshot();
      if (!alive()) return;
      catalog = available(snapshot);
      selected.clear();
      const current = typeof options.getCurrentScope === "function" ? options.getCurrentScope() : "";
      if (catalog.some(scope => scope.key === current)) selected.add(current);
      renderChoices();
      message(catalog.length ? "请选择需要下载的类型，再点击“下载所选类型最新逻辑”。" : "当前没有可下载的已发布逻辑。请先在后台发布对应类型。", catalog.length ? "info" : "empty");
    }, "正在读取可下载的类型…");
    draftButton.onclick = () => run(async () => {
      const draft = typeof options.getDraft === "function" ? options.getDraft() : null;
      if (!draft || !draft.set || !draft.scope) throw new Error("当前没有可导出的编辑稿，请先进入逻辑编辑。");
      await download([draft.scope], draft);
    }, "正在整理本次编辑稿，并读取版本依据…");
    allButton.onclick = () => { catalog.forEach(scope => selected.add(scope.key)); renderChoices(); };
    noneButton.onclick = () => { selected.clear(); renderChoices(); };
    downloadButton.onclick = () => run(() => download(Array.from(selected)), "正在重新读取所选类型的最新发布逻辑…");
    closeButton.onclick = () => { batchPanel.hidden = true; message(""); };
    controls();
    const handle = { destroy() { destroyed = true; if (controller) controller.abort(); if (container.__reportLogicExportHandle === handle) delete container.__reportLogicExportHandle; } };
    container.__reportLogicExportHandle = handle;
    return handle;
  }
  global.ReportLogicExportUI = Object.freeze({ mount });
})(window);
