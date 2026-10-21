# 0922 可研根治任务暂停与续接检查点

## 1. 暂停原因和真实状态

用户明确要求“没 token 了，先巩固现在的成果”。暂停进一步修复、AI 调用、长测试和导出；不是任务完成。

当前代码、候选副本和验证记录均已在本机磁盘保留。未提交、推送、部署；不得把大量工作区改动全部当成本任务修改。原税务局、龙岗正式报告及已有 43 个待处理候选保持原样，后续不得覆盖。

**最重要的结论：43 节候选 HTML 机械检查通过，但最新 Word 导出丢失部分表格内容，59 页绝不能作为精简成功或完整报告验收证据。原候选 HTML 完整，无需重新调用 AI 生成。**

## 2. 已有成果与文件入口

- 共享成稿合同：`report-completion-contract.js`；固定职责预算、必要表分配、事实唯一归属、结构化槽位、总结依赖 freshness、数值/否定边界及有界定点返修等已接入当前本地链路。
- 当前界面资产版本：`20260922.root11`；生成规则版本：`20260922-program-prose-v8`。
- 生成与候选主链路：`report.js`、`functions/api/reportexecution.js`、`report-orchestration-client.js`、`report-argument.js` 及相关测试。
- 导出责任模块：`report-section-layout.js`、`export.js`、`docxgen.js`、表格模板模块、`local-server/report-pagination.js/.ps1`。
- 完整证据及 44/60 维评估：`docs/0922-report-root-evidence-review.md`。本文件用于明确暂停时的最新续接状态。

最新完整候选目录：

`outputs/report-standardization/full-review-2026-09-22T07-09-28-699Z-ae34d5`

关键文件为 `candidate.json`、`review-plan.json`、`composed-audit-sections.json`。该轮 43/43 节机械通过、0 AI 调用、sourceUnchanged=true；正文 31,364 字符、表内 17,944 字符、456 行、47 表。全部仍为未专业核实，factsVerified/readyForPublication=false，不能自动接受或签发。

人工语义复核收据：`outputs/report-standardization/0922-manual-final-qa-review.json`，包含 8 项有界措辞调整和 9 项总结依赖复核。它是代理 QA，不是用户事实审签。最终明细依赖哈希：`8884abb679a108dbb209e460747acdcfc855b994cda1e2998a51352af93793ba`。

源资料：`outputs/report-standardization/longgang-source.json`、`tax-source.json`。

龙岗源文件 SHA-256：`2e119a9d2806b44829f1b73715d2d3270709355ccdbebc3c8be56b32b5125310`；原稿 SHA-256：`eb9ffaa04d685af50424bd617fa9b6ebdf82dcefadf96fb824bfe4563832ee82`。

## 3. 已执行验证（不要混用版本）

|验证|记录|结果与边界|
|---|---|---|
|root11 独立 PostgreSQL 全量|`outputs/report-standardization/0922-root11-integration.log`|1459/1459，0 失败、0 跳过，143096.8326 ms；独立库已清理。真实 WPS 另测，不以该数冒充排版通过。|
|root11 隔离真实浏览器|`outputs/report-standardization/root-ui-2026-09-22T07-03-32-613Z-793b2e/ui-audit.json`|21/21，页面/控制台无新增错误，8 资产初载与刷新 hash 匹配。使用隔离 fixture/mock API，不是正式报告存储验收。|
|同一服务真实生成/RAG|`outputs/report-standardization/structured-live-2026-09-22T07-05-53-362Z-517581/summary.json`|generate 200、RAG 200/2 命中；不代表检索相关性已审签，不接受候选或修改正式项目。|
|最新完整 Word|`outputs/report-standardization/full-docx-2026-09-22T07-13-36-157Z-2c3693/audit.json`|失败。WPS/PDF 59 页；43 节正文保留，但 12 节表格不一致，OOXML47表/WPS46表。尚未逐页视觉验收。|

之后修改任何产品导出代码，以上全量结果只作为修复前证据；最终冻结版须按高风险导出变更重新验证。

## 4. 已定位、尚未修复的两个阻断问题

### A. 冻结表格缺少编辑属性时，被空模板替换

- 隔离副本构建器 `scripts/build-report-full-review.mjs` 冻结 HTML 时去掉 `data-row/data-col/data-role`，但保留 `rpt-template-card` 包装。
- `export.js` 约 194–218 行和 `report-section-layout.js` 约 184–215 行重新从目录取得空模板，仅按这些属性填值；属性缺失即静默丢失实际 DOM 行/格/值。
- 异常 12 节：1.3、1.5、3.2、3.3、3.5、3.6、5.1、6.1、6.2、7.2、9.3、11.1。
- 对应逻辑格数：163→123、115→85、65→65、84→49、103→89、213→129、35→35、63→35、72→54、115→55、171→63、252→35。同格数也有内容变空，不能仅查表数/格数。
- 典型 11.1 从 36 行/252 格变成 5 行/35 格。43 节正文均无 missingParagraphs/missingSourceParagraphs。
- `composedUnchanged=false` 与 Word 逐格不一致完全对应；第一次清空后第二次 idempotent=true 不代表安全。
- 生产冻结入口当前允许这些属性，因此本次直接触发点在隔离构建器，但共用 compose/export 的不安全降级仍须修复，不能仅给测试补属性掩盖。

建议从实际 figure/table DOM 读取结构，采用一个共享适配器供 compose/export 消费：保留文字、实际 tr/td、额外行、colspan/rowspan、列宽；编辑属性只能是可选提示，不得作为内容存在的前提。不能简单降为二维普通表，因为会丢合并格。

必要回归：缺映射属性、额外行、合并格、空值、缺段、未知模板和这 12 节逐格一致性。不要重跑 AI，不改原稿，不放宽完整性门禁。

### B. 相邻普通表被 WPS 合并

- 全部 43 个小节书签页区间有效；分页 diagnostics=available，reason 为空。
- 唯一表数差异在 3.6：OOXML 4 表，WPS 3 表。
- 全文唯一直接相邻 `</w:tbl><w:tbl>` 就在该节前两张历史租金表；各为 3 行 6 列，中间没有 `w:p`。WPS 合并为一表。
- 责任位置 `docxgen.js` 约 142、224 行：普通表返回 Table 后直接连续拼接。
- 最小修复方向：公共输出串联仅在连续 Table 之间插入普通空 Paragraph，保持文本、数值、字号和表形不变。
- 验收：OOXML 不再有直接相邻表，两表原内容/行数不变；真实 WPS 恢复 47 表，3.6 恢复 4 个表页区间。无需修改 PS1 书签算法，不能把期望 47 改为 46。

## 5. 暂停前最后一个局部修改

`scripts/check-report-full-docx.mjs` 增加 PDF 文本提取 fallback：bundled Poppler 只有 pdfinfo/pdftoppm，缺 pdftotext 时使用 bundled pdfjs-dist 提取文本；标记为非 layout 文本。`node --check` 已通过，**尚未重新完整执行**，不把它记为运行通过。

当前源代码与结构化配置统计（已执行 `node scripts/count-source-code.mjs`）：2,590 文件，189,061,093 字节，180.30 MiB，200,677 行。后续改代码须重跑，不沿用该数。

## 6. 下一次最短续接顺序

1. 先 `git status --short`，阅读本文件及已有证据；保留工作区及原始/正式资料，不回滚混合改动。
2. 修 A/B 两个责任模块的最小补丁，先跑对应结构/行为测试；不重生成 43 节，不重跑已成功 AI。
3. 检查完整候选和当前 composition/模板契约是否兼容；必要时仅做保留来源与哈希的零 AI 重新构建，不能静默改被冻结内容。
4. 再用 `scripts/check-report-full-docx.mjs` 导出同一完整候选，逐段逐格核对，再实际 WPS 分页和每页视觉检查；失败则留在候选/未验收状态。
5. 最终冻结后按导出高风险准入完成全量独立数据库回归、受影响真实浏览器路径与文件版本一致性；不要因旧结果通过跳过修复后的验证。
6. 更新证据、源码统计和最终说明，只有实际完成后才称根治完成。不得仅凭一个项目页数变少宣称所有项目稳定高质量。

完整导出命令（运行时要保持正常权限、隐藏窗口，不读写正式数据库）：

```powershell
& 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/check-report-full-docx.mjs outputs/report-standardization/full-review-2026-09-22T07-09-28-699Z-ae34d5 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules' --render 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin'
```

本地服务暂停时 PID 18752、端口 8080，正常网络启动 root11；PID 仅作记录，下次必须重新核验。不要为续接无故重启服务。日志 `0922-root11-server.log/error.log`。

## 7. 不可越过的业务与验收边界

- 用户选择的龙岗“待确认基准”为 2026-08-24 协议：5973㎡、195 套、首期 6 年，改造投入优先抵扣后净收益分成、无保底租金。旧 20000㎡/500 套/12 年固定租金测算存在冲突；不能靠改文字消除冲突，不能擅改测算或宣称财务可行。
- 110 页目标、120 页上限是统一成稿约束，不许截断、缩字体、删除真实表格、捏造事实来达标；不同项目仍须保留必要差异。
- 新稿事实未审签、Word 未验收；不覆盖旧版本或自动接受候选。
- 44/60 维历史综合分沿用：覆盖 73.84、生产成熟度 74.92、真实数据资产代理分 64.33；无提升、无下降，不把方案/待验收结果加分。当前优先项：完整导出闭环、真实项目专业审签与独立留出、最终运行版本及发布门禁。
- 本次按用户要求暂停，后续仅在用户恢复工作后继续上述修复。

## 8. 已恢复后的 root13 收尾记录（追加，不覆盖历史暂停及失败）

用户恢复工作后，本轮完成原断点 A/B 的通用导出修复及分页补强。以上 root11 暂停状态、59 页失败产物和历史测试次数原样保留；当前技术状态以本节精确版本与证据为准。

### 8.1 当前修复与版本

- 共享 `ReportTableTemplates.fromFigure` 从实际 DOM 读取行、格、合并、空值和分段，组合及导出不再因旧属性缺失/过期而用空模板覆盖用户表格；标题、备注、嵌套容器及原顺序保真，重复组合不重复内容。
- 相邻原生 Word 表格增加最小分隔，修复 WPS 合表；普通表格行补齐 `cantSplit`，保留重复表头。未缩字、未截断、未删表或备注压页。
- 当前导出资源 `20260922.root13`，模板 `report-docx-20260922-pagination-v3`。QA 单独保存真实 `composedHtml`；仅忽略顶层纯空白文本的严格内容等价门禁替代字节误报，原字节诊断仍保留。

### 8.2 冻结验收索引

证据根目录：`outputs/report-standardization/`。

- `0922-root13-integration.log`：完整独立 PostgreSQL 回归 **1478/1478 通过，0 失败、0 跳过、0 取消**，退出码 0，耗时 85,129.5878 ms；38 项迁移，最新 0038。测试库 `studyreport_restore_1790129643637022432` 已清理，独立只读查询确认不存在。
- 定向运行 `tests/report-docx-adjacent-tables.test.cjs` 与 `tests/report-full-docx-composition.test.mjs`，显式载入真实 43 节 fixture：**6/6 通过、0 跳过**；真实 7 节顶层空白差异与改字、改值、删备注、换序拒绝用例均覆盖。
- `root-ui-2026-09-23T02-13-44-298Z-3c6239/ui-audit.json`：**21/21**；首入/刷新后 **9 个入口资源哈希**均匹配本地，无新增页面/控制台异常。真实页面使用内存隔离数据、API 全拦截，不代表正式账号持久化或生产保存验收。
- `structured-live-2026-09-23T01-50-17-243Z-784b0b/`：同服务真实生成/RAG/只读测算配置冒烟通过；不是全篇重生成或候选接受，RAG 相关性仍待独立审核。
- `full-review-2026-09-23T02-14-12-176Z-321897/candidate.json`：**43/43 节机械通过**，原稿未变。
- `full-docx-2026-09-23T02-16-02-129Z-c993d5/audit.json`：**43 节、47 表、2346 逻辑格 / 2334 物理格、WPS 71 页**完整技术审计通过，`errors=[]`，120 页门禁通过；同目录保留 DOCX、PDF 和 71 张页图。7 节仅字节级顶层空白不同，内容差异 0，重复组合幂等。
- **视觉状态：待补。** 主线程正在核验本轮 root13 的 71 张页图，未收到结论前不记为视觉验收通过；后续只追加结论，不修改历史失败记录。

DOCX SHA-256：`4e5d1f00e8cc4e5e3fcce84590377b6a462e16cabe918d2af528099864c306cf`。PDF SHA-256：`49cd6ab2d117e0ee0038577ea081d1cad1baf5ed5a7893e85d76a56634a94c4e`。71 页仅针对这一 QA 产物，含 QA 提示；更换字体或排版引擎仍可能重排。

### 8.3 原件、业务边界与后续

原件 `longgang-source.json` 文件 SHA-256 仍为 `2e119a9d2806b44829f1b73715d2d3270709355ccdbebc3c8be56b32b5125310`，正文 SHA-256 仍为 `eb9ffaa04d685af50424bd617fa9b6ebdf82dcefadf96fb824bfe4563832ee82`。没有覆盖正式报告、接受候选、改变正式测算参数、提交、推送或部署。

当前可证明通用技术链路已补齐以上缺口；不能把它写成事实和财务结论已审签、所有未来项目完美或准确率达到 95%。`factsVerified=false`、`financialConclusionCertified=false`、`readyForPublication=false` 的专业边界继续保留。协议稿经营口径冲突仍须独立核实和重算，不靠压页消除。

三类历史评分保持 **73.84 / 74.92 / 64.33（代理）**，无升降；44/60 维只更新相关证据，不因单项目技术通过加分。源码冻结统计：**2596 文件、189,120,547 字节、180.36 MiB、201,520 行**。下一步优先：补齐本轮逐页视觉结论；协议事实/财务参数核验与人工审签；独立项目和正式环境持续验证。详细证据及范围见 `docs/0922-report-root-evidence-review.md` 第 9 节。

### 8.4 最终视觉收尾追加（2026-09-23 UTC）

**root13 全 71 页视觉技术验收已完成**，覆盖 1–24、25–48、49–71 三段；变化/新增页面逐页查看，完全一致页面按精确哈希/像素证据继承此前逐页实测。未发现新增裁切、溢出、乱码、意外空白页或拆行。43 节、47 表、71 页与完整逐格审计一致，技术闭环通过；此追加更新前文“视觉待补”状态。

最终记录：`outputs/report-standardization/full-docx-2026-09-23T02-16-02-129Z-c993d5/final-acceptance.json`；末段记录：同目录 `visual-review-pages-49-71.json`，前两段 `visual-review-pages-01-24.json`、`visual-review-pages-25-48.json` 已齐全。机器 `audit.json` 的 `visualAcceptance=false` 是看图前状态，**不改历史记录**；最终以 `final-acceptance.json` 的 `visualTechnicalPassed=true` 及三份 manifest 为准，产物和原件哈希与本节前述一致。

冻结源已有的重复/空白/同名引用、风险概率及影响待填、协议与面积及旧测算口径冲突继续保留为人工审阅项，不算导出新增，也不补造数据。`factsVerified`、`financialConclusionCertified`、`readyForPublication` 仍为 false；未覆盖原稿、采用候选、提交或部署。Windows WPS 的 71 页技术验收不等于跨排版引擎认证或所有未来项目完美；LibreOffice 运行时缺失，未做跨引擎认证。后续重点为事实/财务专业审签、独立项目和正式环境验证；本轮技术收尾停止于此。
