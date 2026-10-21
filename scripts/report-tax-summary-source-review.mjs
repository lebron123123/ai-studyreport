import './windows-browser-lockout-guard.cjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Offline evidence packaging only. No project, database, network, AI or browser access.
const root = path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const actualFile = path.join(root, 'generation-runner/resume-state-2026-10-13T04-17-49-639Z-47723552-tax-end.json');
const sourceFile = path.join(root, 'tax-source.json');
const outputFile = path.join(root, 'generation-runner/independent-tax-summary-source-167-122-20261013.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: evidence changed`);
};
const actualBytes = fs.readFileSync(actualFile);
const sourceBytes = fs.readFileSync(sourceFile);
requireEqual(sha(actualBytes), '4db2223340a4b7674cf9e3d57e3a1061cda8233dd526598bb6eca82dc645318f', 'Actual snapshot');
requireEqual(sha(sourceBytes), '9c4a403d3fd047c1d79b81ea296126b5d5b868e4717201b2dc853ff16d4baa99', 'Original source snapshot');
const actual = JSON.parse(actualBytes);
const original = JSON.parse(sourceBytes);
const body = (chapterIndex, sectionIndex) => {
  const section = actual.chapters[chapterIndex].sections[sectionIndex];
  return section.editedHtml || section.content || '';
};
const sectionBindings = {
  '1.6': { chapterIndex: 0, sectionIndex: 5, sha256: '6438303178798eaa4f4dcc8d805d7653109933d55c9ac8fd66699bdff1c2dcae' },
  '1.7': { chapterIndex: 0, sectionIndex: 6, sha256: '597a8175f42fc796cd39840fe3d396e513773920678f47a0312107dbb203c5c2' },
  '12.2': { chapterIndex: 11, sectionIndex: 1, sha256: '8b20722316c5ebadf850216b47802ad3679e95e95b6556735a26b6b6689a181f' },
  '9.3': { chapterIndex: 8, sectionIndex: 2, sha256: '3044756366cb71f329719004d1ff9c60ef65549732bc058a0d26dbbd2a1c6823' },
  '9.4': { chapterIndex: 8, sectionIndex: 3, sha256: '085160a594ec38079e5e4ac80fb948d2e3026372b29b3403a13c47417a771707' }
};
for (const [number, binding] of Object.entries(sectionBindings)) {
  requireEqual(sha(body(binding.chapterIndex, binding.sectionIndex)), binding.sha256, `Section ${number} actual body`);
}
const expectedKbHashes = [
  '3d99fd171c02b4a1088938432656132a991d65d537a0e9c76a3c47bbfaf30fe6',
  '2e67b8da353c9de4b10746bc292e16bcd899769028c27e083d728304bbd404b2',
  '6b3ee94d081e8becdfdb93c9900858980d31e1b5d02d98c9f151bd9c956f3f1e',
  '47211afe8de1a5eab748bf9859ea3722994e674c915aef9847fddb224018c1c3'
];
const kbBindings = original.state.kb.map((item, index) => {
  const contentSha = sha(item.content);
  requireEqual(contentSha, expectedKbHashes[index], `KB ${index} original content`);
  return { index, title: item.title, locator: `${sourceFile}#state.kb[${index}].content`, sha256: contentSha, shaScope: 'exact UTF-8 content field' };
});
const source = (index, pointer) => ({
  locator: `${kbBindings[index].locator} :: ${pointer}`,
  sha256: kbBindings[index].sha256,
  shaScope: 'exact UTF-8 whole KB content field',
  snapshotSha256: sha(sourceBytes)
});
const finance94 = {
  locator: `${actualFile}#chapters[8].sections[3] :: actual editedHtml||content; 9.4 sensitivity table and 9.4.2/9.4.3 limitations`,
  sha256: sectionBindings['9.4'].sha256,
  shaScope: 'exact UTF-8 actual section body',
  snapshotSha256: sha(actualBytes)
};

const specifications = [
  {
    number: '1.6', id: 'tax-16-historical-condition-boundary', prefix: '改造路径按房源现状分档：',
    paragraphSha: '378ea73390718eb38a72a330c72db4b92f56e78eac8f913666ed8f1c40053c4a',
    replacements: [['改造路径按房源现状分档：银湖半山37套已完成精装修但长期空置，存在', '原研究按当时记录的房源现状提出分档改造路径：银湖半山37套均已完成精装修且为使用过的房源，部分房源因长期空置存在']],
    sources: [source(2, '研究报告第4页：精装修、使用过、部分因长期空置损坏；第5/6/10页：其余房源及改造成本估算')],
    reason: '区分2026年8月研究记录与当前逐套勘查结果，恢复部分损坏及曾使用的原始限定。'
  },
  {
    number: '1.6', id: 'tax-16-effectiveness-and-handover', prefix: '实施进度受两项前置条件约束：',
    paragraphSha: 'e7d9b3ab32ce7a6ba1fd8850a4b882d9ea7be56ec3155e219807864498d1d614',
    replacements: [['实施进度受两项前置条件约束：', '实施进度受协议生效和房源交付条件约束：']],
    sources: [source(0, '合作协议草案9.1三项并列生效条件、2.1协议生效后5日内现状交付'), source(1, '请示第二（三）原改造工期')],
    reason: '原段列三项生效条件及交付节点，不能笼统称为两项前置条件。'
  },
  {
    number: '1.6', id: 'tax-16-calculation-scope-and-unmeasured-combination', prefix: '本次测算运营期为',
    paragraphSha: 'c16a517955d8cca71bb5bf97d12b013cc03815f265ddc81170e6b2feaf57d8b5',
    replacements: [['全周期总收入1116.78万元', '本次测算期总收入1116.78万元'], ['若两项不利因素同时发生，存在跌破8%的可能', '两项不利因素同时发生的组合情景尚未测算，不能据此判断是否跌破8%，后续需另行计算']],
    sources: [source(0, '合作协议草案3.1首期合作期限12年'), finance94],
    reason: '保留原金额，明确仅当前测算区间；9.4只有单因素情景，未给组合结果或临界值。'
  },
  {
    number: '1.7', id: 'tax-17-temporary-housing-not-necessarily-project-stock', prefix: '核心商务条款仍未闭合。',
    paragraphSha: '13309b6744feeb27ef7f1268ae54d837131463b68a6e5cf7b4ad97b8c0878d53',
    replacements: [['该权利直接扣减可对外出租房源', '该权利可能影响可出租资源配置和投资方留存收益，具体影响取决于最终条款及匹配房源安排']],
    sources: [source(0, '合作协议草案4.1合作房源或乙方统筹房源、4.2留空上限与等经济价值调剂、5.4统筹匹配'), source(1, '请示第三（三）可协调其他运营管理房产')],
    reason: '临时用房可能匹配其他统筹房源，不能断言必扣本项目房源。'
  },
  {
    number: '1.7', id: 'tax-17-unverified-investment-controllability', prefix: '本项目方向符合',
    paragraphSha: '6387c485aa9c2d4dd4493698c3828fb6adcd4ec1a021cabe95422b8197428b76',
    replacements: [['改造投入强度相对可控', '改造投入仍需在逐套详勘与分项预算完成后评估其可控性']],
    sources: [source(2, '研究报告第4页部分管线需更换；第10页宝泉庄无法完成整体勘查、成本按经验预留'), source(1, '请示第四项545.21万元原方案估算；未构成最终批准总投资')],
    reason: '存在未勘查和经验预留项，不能将前期判断升级为当前造价可控结论。'
  },
  {
    number: '1.7', id: 'tax-17-calculation-revenue-scope', prefix: '按当前测算假设，',
    paragraphSha: '6bacb4093f992c4c679e70a69b9e14e35b462c99062c495220ace496f25d37a3',
    replacements: [['全周期总收入1116.78万元', '本次测算期总收入1116.78万元']],
    sources: [source(0, '合作协议草案3.1首期合作期限12年'), finance94],
    reason: '仅收紧期限含义，不重算或变更任何数字；当前段自身已明确测算期短于合作期。'
  },
  {
    number: '12.2', id: 'tax-122-no-single-veto-or-unverified-legal-claim', prefix: '本项目下一步工作的推进顺序，',
    paragraphSha: '8550869ad1b7a0d882b3be092792ea056fd180274018dec54961e0275eebe4fc',
    replacements: [['其中认定书取得同时是项目合法运营和享受保租房政策支持的前提', '其中认定书取得是草案约定的合作生效及按保租房项目推进的前提之一'], ['因此，纳保路径确认是当前唯一具有否决性的节点，其余工作均应围绕该节点组织并控制投入节奏。', '因此，纳保路径确认是当前关键前置节点之一，应与协议签署盖章、内部投资决策及其他合规条件同步闭合，并据此控制投入节奏。']],
    sources: [source(0, '合作协议草案9.1全部三项条件同时满足，任一未达成均不发生协议效力；2.2认定及审批申报责任')],
    reason: '认定不是唯一否决节点；本次只核对草案，不冒充现行法律效力核验。'
  },
  {
    number: '12.2', id: 'tax-122-temporary-housing-and-proceeds-conditional', prefix: '与纳保并列的第二项前置条件',
    paragraphSha: 'f98a5274df1ba8c9f3d011a5733a55a859c4a4529dc4cd9bb927e6382a46871a',
    replacements: [['这两项条款直接决定可对外出租的房源规模和投资方留存收益', '这两项条款可能影响可出租资源配置和投资方留存收益，影响程度取决于最终条款及匹配房源安排']],
    sources: [source(0, '合作协议草案4.1/4.2统筹房源与参数留空，5.1全部实际租金及租赁收入归乙方'), source(1, '请示第三（一）收益分成初步思路、第三（三）其他运营房产安排')],
    reason: '收益条款未定稿，临时用房安排并不必然占用本项目房源。'
  },
  {
    number: '12.2', id: 'tax-122-historical-residential-vs-current-map-candidates', prefix: '上述判断受以下未闭合条件约束：',
    paragraphSha: '4f407b0b25fe81205860b01205dd234dfb3a9a6906e6f21baf6fb0dde0e645bb',
    replacements: [['周边竞品租金与出租率数据尚未取得，租金水平缺乏市场验证', '周边地图候选竞品的当前租金与出租率数据尚未取得，研究报告所列历史住宅样本尚未核验为当前可比成交记录，当前租金假设仍待市场验证']],
    sources: [source(2, '研究报告第11/12页住宅点状样本及租金出租率；第13/14页原方案租金研判与收入预估')],
    reason: '已有2026年8月历史住宅样本，不可泛称全部竞品数据未取得；不将历史样本冒充当前成交。'
  },
  {
    number: '12.2', id: 'tax-122-investment-after-all-prerequisites', prefix: '建议按以下顺序推进：',
    paragraphSha: '17757e08e972885153eea95869e10fcb2fae9e740ff175807d003018dff85066',
    replacements: [['在取得认定书前，仅开展测绘、设计、报批准备等必要前期工作，改造资金投入按认定结果分批安排，避免全部51套同步投入；', '在协议三项生效条件全部达成前，如需开展测绘、设计、报批准备等必要前期工作，应另行取得书面依据并明确费用分担；实质改造投入应在协议生效、房源交付及相关实施条件落实后按实际安排推进，避免在前置条件未闭合时对全部51套同步投入；']],
    sources: [source(0, '合作协议草案9.1三项生效条件、2.1房源交付；2.2投入支出责任'), source(1, '请示第六项申请立项并启动可研等前期工作，并非已获批准记录')],
    reason: '避免只修首段而继续留下取得认定书即可安排实质投入的暗示；前期工作书面依据及费用分担是建议，不冒充已签条款。'
  }
];

const corrections = specifications.map(specification => {
  const binding = sectionBindings[specification.number];
  const currentBody = body(binding.chapterIndex, binding.sectionIndex);
  const matches = currentBody.split('\n\n').filter(paragraph => paragraph.startsWith(specification.prefix));
  if (matches.length !== 1) throw new Error(`${specification.id}: paragraph selector is not unique`);
  const quote = matches[0];
  requireEqual(sha(quote), specification.paragraphSha, `${specification.id} exact original paragraph`);
  if (currentBody.split(quote).length !== 2) throw new Error(`${specification.id}: whole original paragraph is not unique`);
  let replacementText = quote;
  for (const [from, to] of specification.replacements) {
    if (replacementText.split(from).length !== 2) throw new Error(`${specification.id}: exact phrase is not unique`);
    replacementText = replacementText.replace(from, to);
  }
  if (quote === replacementText) throw new Error(`${specification.id}: unchanged proposal`);
  return {
    key: `tax:${specification.number}`,
    id: specification.id,
    quote,
    replacementText,
    quoteSha256: sha(quote),
    replacementSha256: sha(replacementText),
    actualBodySha256: binding.sha256,
    actualSnapshotSha256: sha(actualBytes),
    sourceSnapshotSha256: sha(sourceBytes),
    uniqueWholeParagraphMatches: 1,
    sources: [
      { locator: sourceFile, sha256: sha(sourceBytes), shaScope: 'entire immutable source JSON file' },
      finance94,
      ...specification.sources.filter(item => item.locator !== finance94.locator)
    ],
    reason: specification.reason,
    proposedOnly: true,
    notAccepted: true,
    semanticPass: false
  };
});

const document = {
  schema: 'independent-tax-summary-source-corrections/v1',
  createdAt: new Date().toISOString(),
  reviewer: '/root/report_resume_map/tax_summary_fix_crosscheck',
  status: 'findings-and-proposals-only-not-pass',
  fullReadDeclaration: '独立全文阅读真实actual 1.6、1.7、12.2、全部4份原KB及财务actual 9.3、9.4；未仅根据父Agent线索作判断。逐项建议只在精确原段哈希与完整文本唯一命中后打包。',
  projectWrites: 0,
  paidAiCalls: 0,
  browserLaunches: 0,
  productionCodeChanges: 0,
  actualFile,
  actualFileSha256: sha(actualBytes),
  sourceFile,
  sourceFileSha256: sha(sourceBytes),
  sectionBindings,
  originalKbBindings: kbBindings,
  financeEvidence: finance94,
  corrections,
  separateFindings: [
    {
      id: 'tax-93-unmeasured-combination-not-fact-truth',
      key: 'tax:9.3',
      actualBodySha256: sectionBindings['9.3'].sha256,
      locator: `${actualFile}#chapters[8].sections[2] :: 9.3.6`,
      quote: '若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。',
      finding: '9.3自身仍含未实算组合情景的阈值推断；9.4仅单因素已测表，不能将9.3该句作为摘要事实真值。此项不纳入本文件10项正文修正，不自动改财务章节。',
      sources: [finance94],
      semanticPass: false
    },
    {
      id: 'tax-93-full-cycle-label-scope-not-fact-truth',
      key: 'tax:9.3',
      actualBodySha256: sectionBindings['9.3'].sha256,
      locator: `${actualFile}#chapters[8].sections[2] :: 9.3.2/9.3.3及冻结财务表`,
      quote: '全周期总收入1116.78万元',
      finding: '9.3正文与冻结表仍使用全周期标签，但同节明确2027年7月至2031年12月54个月、短于12年合作期。应由财务表责任模块解释或修正显示口径，不直接修改冻结表或数字；不能拿标签当完整12年结果。',
      sources: [source(0, '合作协议草案3.1首期12年'), finance94],
      semanticPass: false
    }
  ],
  limitations: [
    '未独立核对当前地图检索原产物，银湖半山周边8个候选竞品的点位归属与检索距离仍需对应检索记录验证。',
    '未核验现行政策法律效力；仅核对原始材料及草案的记载。',
    '未重算财务模型；未变更任何数值，9.3不是无条件可信的事实真值。',
    '未写项目、未接受候选、未作semantic pass、未声称报告完成。'
  ]
};
if (document.corrections.length !== 10) throw new Error('Expected exactly 10 proposals');
const outputBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
fs.writeFileSync(outputFile, outputBytes, { flag: 'wx' });
requireEqual(sha(fs.readFileSync(outputFile)), sha(outputBytes), 'Review output readback');
console.log(JSON.stringify({ outputFile, sha256: sha(outputBytes), bytes: outputBytes.length, corrections: corrections.length, exactWholeParagraphUniqueMatches: corrections.every(item => item.uniqueWholeParagraphMatches === 1), semanticPass: false, projectWrites: 0, paidAiCalls: 0, browserLaunches: 0 }));
