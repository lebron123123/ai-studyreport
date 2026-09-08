/* 只重组现有导航节点，保留原 ID、监听器与权限入口。 */
(function () {
  "use strict";
  function install() {
    const side = document.querySelector('.side');
    if (!side || side.querySelector('.admin-nav-groups')) return;
    const groups = [
      ['可研编制', '▤', ['btnRefresh','btnNew','btnSeed','btnAiRules','btnExamples','btnGoldenEval']],
      ['测算与研判', '▦', ['btnCalcCfg','btnAnalysisLogic']],
      ['知识与资料', '▣', ['btnRag','btnMaterials','btnWebResearch','btnWiki','btnContrib']],
      ['项目数据', '▥', ['btnCases','btnPopulation','btnAnalysisReview']],
      ['PPT 管理', '▱', ['btnPptTemplates','btnPptAssets']],
      ['系统运维', '⚙', ['btnAgent','btnStats']]
    ];
    const container = document.createElement('div');
    container.className = 'admin-nav-groups';
    side.insertBefore(container, side.querySelector('.nav-item'));
    const panels = [];
    for (const [label, icon, ids] of groups) {
      const nodes = ids.map(id => document.getElementById(id)).filter(Boolean);
      if (!nodes.length) continue;
      const group = document.createElement('details');
      group.className = 'admin-nav-group';
      const summary = document.createElement('summary');
      summary.innerHTML = '<span class="admin-nav-icon" aria-hidden="true">'+icon+'</span><span>'+label+'</span><span class="admin-nav-chevron" aria-hidden="true">›</span>';
      const children = document.createElement('div');
      children.className = 'admin-nav-children';
      nodes.forEach(node => {
        node.setAttribute('role','button'); node.tabIndex = 0;
        node.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); }
        });
        children.appendChild(node);
      });
      group.append(summary,children);container.appendChild(group);panels.push(group);
      // 用户打开大类时关闭其他类；只收起当前组时不强制重新展开。
      summary.addEventListener('click', () => { if (!group.open) panels.forEach(other => { if (other !== group) other.open = false; }); });
    }
    side.querySelectorAll(':scope > .nav-sep').forEach(node => node.remove());
    let lastActive = null;
    function syncActive() {
      const active = container.querySelector('.nav-item.active');
      panels.forEach(group => group.classList.toggle('has-active', !!active && group.contains(active)));
      container.querySelectorAll('.nav-item').forEach(node => {
        if (node === active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
      });
      if (active && active !== lastActive) panels.forEach(group => { group.open = group.contains(active); });
      lastActive = active;
    }
    syncActive();
    // 兼容页面内部“返回知识库”等程序化跳转，不接管原点击逻辑。
    const observer = new MutationObserver(records => {
      if (records.some(r => r.target.classList.contains('nav-item'))) syncActive();
    });
    observer.observe(container,{subtree:true,attributes:true,attributeFilter:['class']});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
