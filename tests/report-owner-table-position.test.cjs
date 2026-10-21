require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const C = require('../report-completion-contract.js');
const macroTemplate = require('../data/report-table-templates-gaibao-housing-v1.json').templates.find(template => template.id === 'gaibao-housing-table-16');

// Exact Tax3.1 body after its reviewed, table-only move. No factual values are
// filled in: all seven original rows, source attributes and prose are retained.
const tax31 = '<h3>3.1.1 深圳市宏观经济与人口概况</h3><p style="margin:0 0 10px;">本项目51套房源分布于深圳市罗湖区、福田区共6个居住小区，原请示拟改造后以保障性租赁住房形式面向市场出租，并提出按市场租金9折定价；该方案取值不等于已经确认的市场租金或已完成的保障性租赁住房认定。租赁需求最终取决于深圳市及项目所在城区的经济总量、产业结构、就业规模和人口集聚态势，因此宏观经济环境分析需以全市与城区两个层级、同一统计期的可比数据为基础。当前已提供的项目材料中，未包含深圳市及罗湖区、福田区的地区生产总值、财政预算收支、居民收入消费、常住人口及净流入等统计数据，本节证据尚未核实，相关判断暂不作确定性结论。从项目自身条件看，51套房源全部位于已建成入住的成熟居住小区内，周边轨道交通、公交、医疗、教育及生活配套在项目材料中已有地图查询记录，所列距离并非现场实测或已核验的步行路径，房源所在片区属于深圳城市建成区范围。这一事实说明项目所处区位具备承接城市就业人口居住需求的基础条件，但区位条件本身不能替代对区域经济总量和人口规模的量化判断。在缺少全市及城区经济、人口统计数据的条件下，无法对区域住房租赁需求的总量规模、增长趋势和支付能力作出定量结论，也不能据周边配套条件推断租赁需求旺盛。</p><h3>3.1.2 项目所在辖区经济与人口特征</h3><p style="margin:0 0 10px;">本项目房源在辖区分布上存在明显差异：罗湖区房源共50套、建筑面积约5506.81平方米，占总建筑面积约98%；福田区房源1套、建筑面积114.34平方米，占约2%。罗湖区房源又集中于银湖半山小区，该小区37套、建筑面积4249.9平方米，占项目总建筑面积约76%。这一分布结构意味着项目的租赁需求基础主要由罗湖区，特别是银湖半山所在片区的经济活力、就业岗位和人口集聚状况决定，福田区单套房源对项目整体需求判断的影响有限。从项目材料已记录的周边条件看，各房源点位所处片区的功能特征并不一致。银湖半山位于罗湖区金湖路6号，周边1公里至1.5公里范围内分布有泥岗、罗湖北、银湖、笋岗北等轨道交通站点，0.4公里至0.5公里范围内有罗湖区图书馆、深圳边检总站医院等公交站点，上述距离为地图查询记录，尚未核验现场路径和通勤时间。宝泉庄位于罗湖区红桂路1008号，周边0.6公里至0.9公里范围内有大塘龙、红岭、老街、园岭等轨道交通站点，0.1公里至0.2公里范围内分布有红桂中学西校区、红桂小学等教育设施。松园小区、碧波花园、愉天小区及福田区上梅林梅兴苑亦各有其轨道交通与生活配套条件。上述记录显示各房源点位的交通与生活配套组合不同，对潜在租赁客群的适配方向可能存在差别，但项目材料未提供各片区的经济与人口统计数据，尚不能据此判断各片区的租赁需求强弱。</p><h3>3.1.3 宏观经济与人口指标汇总</h3><p style="margin:0 0 10px;">本节所需的市区两级宏观经济与人口指标，包括地区生产总值、GDP同比增速、三次产业结构、常住人口、人口净流入及人均可支配收入，应按同一统计期分别列示深圳市与项目所在区的数据，以便进行同口径比较。当前项目材料未提供上述任何一项统计数据，无法填列具体数值。需特别说明的是，常住人口增量与人口净流入是两个不同口径，前者包含自然增长，不能直接作为净迁入规模使用；在未取得分项数据前，不得以常住人口增量替代人口净流入指标。<br>市区宏观经济与人口指标表</p><table class="rpt" data-canonical-template="gaibao-housing-table-16" data-report-table-scope="[&quot;&quot;,&quot;&quot;,[],[&quot;年&quot;,&quot;年&quot;]]" data-report-source-caption=""><tbody><tr><th>指标</th><th>项目所在市（统计年）</th><th>项目所在区（统计年）</th></tr><tr><td>地区生产总值（亿元）</td><td>待补</td><td>待补</td></tr><tr><td>GDP同比增速（%）</td><td>待补</td><td>待补</td></tr><tr><td>三次产业结构</td><td>待补</td><td>待补</td></tr><tr><td>常住人口（万人）</td><td>待补</td><td>待补</td></tr><tr><td>人口净流入（万人）</td><td>待补</td><td>待补</td></tr><tr><td>人均可支配收入（元/年）</td><td>待补</td><td>待补</td></tr></tbody></table><h3>3.1.4 宏观环境对本项目的支撑判断</h3><p style="margin:0 0 10px;">在市区两级经济与人口统计数据尚未取得的情况下，本节只能就宏观环境对本项目的支撑关系作出条件性判断。原请示拟按市场租金9折出租；本次测算采用的起始租金为45元/平方米/月、稳定期出租率假设为85%，并非已验证的市场成交条件，该假设能否实现，取决于项目所在片区就业人口的规模、收入水平及租赁支付能力。若区域经济总量和就业规模保持稳定、常住人口持续集聚，则项目所在成熟居住片区的租赁需求具备基本支撑；若区域经济或人口出现收缩，则出租率和租金水平可能低于测算假设，进而影响项目收益。上述判断的成立以取得并核实市区两级统计数据为前提，当前不能认定宏观环境已对本项目形成确定性支撑。后续需补充深圳市及罗湖区、福田区同一统计期的地区生产总值、财政预算收支、居民收入与消费、常住人口及人口净流入数据，并核实数据来源与统计口径，方可对区域租赁需求的总量、结构和支付能力作出定量判断，并据此检验测算所采用的租金水平与出租率假设是否具备市场基础。宏观经济环境资料待核验，相关判断暂不作确定性结论。</p>';

let browser, page;
test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  page = await browser.newPage();
  for (const file of ['report-table-templates.js', 'report-section-layout.js']) {
    await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
  }
});
test.after(async () => { await browser?.close(); });

test('real Tax3.1 canonical table stays after 3.1.3, byte-stable through repeated composition and frozen verification', async () => {
  assert.equal(createHash('sha256').update(tax31).digest('hex'), '6ad8956f9c4e69a9a81fb15dbdd3062495eafe5d0d175f4e6c4b29b7e378eb63');
  const result = await page.evaluate(({ html, template }) => {
    const parse = value => new DOMParser().parseFromString(value, 'text/html');
    const original = parse(html).querySelector('table');
    const context = { type: 'gaibao-housing', chapter: '项目市场分析', section: '宏观经济环境', number: '3.1' };
    const library = { forSection: () => [template], renderTemplate: ReportTableTemplates.renderTemplate };
    let round = 0;
    const compose = value => ReportSectionLayout.composeDocument([{ key: '项目市场分析 / 宏观经济环境', context: { ...context, replayRound: round++ }, html: value }], library)[0];
    const history = [html];
    for (let i = 0; i < 3; i++) history.push(compose(history.at(-1)));
    const final = parse(history.at(-1)), table = final.querySelector('table');
    const first = history[1], diff = [...html].findIndex((char, i) => char !== first[i]);
    return { history, table: table.outerHTML, original: original.outerHTML, count: final.querySelectorAll('table').length,
      previous: table.previousElementSibling?.outerHTML, next: table.nextElementSibling?.textContent,
      difference: { at: diff, before: html.slice(Math.max(0, diff - 80), diff + 160), after: first.slice(Math.max(0, diff - 80), diff + 160), lengths: [html.length, first.length] },
      comments: [...final.body.childNodes].filter(node => node.nodeType === 8).length };
  }, { html: tax31, template: macroTemplate });
  assert.equal(result.difference.at, -1, JSON.stringify(result.difference));
  assert.deepEqual(result.history.map(html => createHash('sha256').update(html).digest('hex')), Array(4).fill(createHash('sha256').update(tax31).digest('hex')));
  assert.equal(result.table, result.original);
  assert.equal(result.count, 1);
  assert.match(result.previous, /市区宏观经济与人口指标表<\/p>$/);
  assert.equal(result.next, '3.1.4 宏观环境对本项目的支撑判断');
  assert.equal(result.comments, 0, 'internal position markers must never enter saved or exported HTML');
  const contract = C.createPlan([{ name: '项目市场分析', sections: [{ t: '宏观经济环境', numeric: true }] }]).sections[0];
  const frozen = await C.bindFrozenTables(contract, tax31, 'tax31-reviewed-table-move');
  for (const html of result.history) {
    assert.deepEqual(await C.verifyFrozenTables(frozen, html, 'tax31-reviewed-table-move'), frozen);
    assert.equal(C.inspect(html, frozen).issues.some(issue => issue.code.startsWith('frozen-table-')), false);
  }
});

test('an owned figure stays in its original nested location with physical spans, captions, notes and siblings unchanged', async () => {
  const result = await page.evaluate(() => {
    const figure = '<figure data-template-id="owned-span-table" data-report-table-scope="fixed"><figcaption>原表标题</figcaption>'
      + '<table><tbody><tr><th rowspan="2">项目</th><th colspan="2">金额</th></tr><tr><th>含税</th><th>不含税</th></tr>'
      + '<tr><td>工程</td><td>109</td><td>100</td></tr></tbody></table><p>表内注释：原始合并关系保留。</p></figure>';
    const html = '<h3>6.1.1 先行分析</h3><div class="owned-evidence"><p>表前分析。</p>' + figure
      + '<p>表后独有分析。</p></div><h3>6.1.2 后续分类</h3><p>节末结论。</p>';
    const template = { id: 'owned-span-table', title: '原表标题', segments: [] };
    const library = { forSection: () => [template], renderTemplate: ReportTableTemplates.renderTemplate };
    const context = { type: 'test', chapter: '经营模式', section: '核心条款', number: '6.1' };
    let round = 0;
    const compose = value => ReportSectionLayout.composeDocument([{ key: '经营模式 / 核心条款', context: { ...context, replayRound: round++ }, html: value }], library)[0];
    const once = compose(html), twice = compose(once), third = compose(twice);
    const doc = new DOMParser().parseFromString(third, 'text/html');
    return { html, once, twice, third, figure, finalFigure: doc.querySelector('figure').outerHTML,
      count: doc.querySelectorAll('figure').length, parent: doc.querySelector('figure').parentElement.className };
  });
  assert.equal(result.once, result.html);
  assert.equal(result.twice, result.html);
  assert.equal(result.third, result.html);
  assert.equal(result.finalFigure, result.figure);
  assert.equal(result.count, 1);
  assert.equal(result.parent, 'owned-evidence');
});
