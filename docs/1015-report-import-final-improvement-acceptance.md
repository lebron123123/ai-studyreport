# 1015 已有报告完善：本轮最终改进技术验收

记录日期：2026-10-15。工作目录：C:/Users/HP/Desktop/ai-studyreport-local。这是当前本地版本的技术验收记录。代码回归、真实局部AI请求、待审候选恢复、最终V5结构/分页/目录、改动页视觉及成稿网页备份恢复已完成；全58页视觉汇总也已通过，见第5节。最终源码统计已由根任务实跑，见第7节。普通非提权沙箱只读检查成功；已有修改、原件、历史请求和冷备保留；未提交、推送或正式发布。

当前已完成：规则查漏与实际引用冲突门禁改进、生成等待和诊断改进、独立PostgreSQL全量回归、一次真实网页AI候选返回、163处编辑形成的V5完善审阅稿及实际58页/77目录核验。V3第44页空表续行已通过最小分页修复解决；V5的6张改动页视觉通过，52页与V3像素相同。待审候选与最终V5分别完成零新增AI的本地服务器备份、读回、刷新、返回和新浏览器恢复，最终Word导出SHA相同。真实AI候选只有251字符，没有达到要求的400–600字符，保持未采用；独立编辑成稿不能被说成网站自动生成的整稿。

## 1. 本轮改了什么

| 责任文件 | 已实现变化 | 保留的约束 |
| --- | --- | --- |
| report-import-quality.js；tests/report-import-quality.test.cjs | 比较数值时区分对象、阶段、单位和计租口径；提示有明确依据的表内算术、重复、年份格式及疑似异项目语境；只读兼容历史二维数组表格与新版cells表格 | 不替用户选择租金/预算/出租率，不批准新数字；未知表格布局不推算；原文和原表不修改 |
| report-import-review.js；tests/report-import-review.test.cjs | 冲突核验按sourceContext实际引用完整块及原请求主范围关联，避免引用市场段被同一附件其他章节数字误拦 | 真正涉及当前事实冲突仍拒绝；部分采用不能缩窄原请求范围绕过；legacy请求保持保守；数字guard不放宽 |
| report-import-ai.js；tests/report-import-ai-durable.test.cjs | 能力检查15秒单独计时，生成等待135秒，给上游120秒超时后的持久回执留接收余量 | 上游仅一次POST，不自动重试或切换模型；旧unknown请求不重放 |
| functions/api/_llm-providers.js、functions/api/generate.js；tests/report-import-ai-api.test.mjs | 增加传输阶段、耗时、HTTP状态、字节数及是否收到非空内容等白名单诊断 | 不记录提示词、响应正文或密钥；未宣称已经证明旧超时的供应商根因 |
| index.html | 当前quality版本20261015.3；review/ai版本20261015.2 | 加载最终经验证的模块版本，未新增侧栏入口 |

内容工作另行保留119处初稿计划、34处交叉审读调整、10处终审调整，合计163处，均有原件位置、原文/新文、理由和依据。相关证据在 `outputs/report-import/1015-final-improvement/content/`；它们是本地独立编辑成果，没有伪造网站AI采用记录。

## 2. 冻结版本与冷备

证据根目录：`outputs/report-import/1015-final-improvement/`。完整版本清单以 `regression/after-legacy-table/final-regression-manifest.json` 为准。

| 文件 | 最终SHA-256 |
| --- | --- |
| report-import-quality.js | a231ce6708c89e8bc2270815a04e5d2fcb88e40a02fd5bc7643627cad92bc4b2 |
| report-import-review.js | 102fdc2b00b1b7a02e32c1dae15c9d344a78e3a7fc3ef92034d8a9cd0c44a844 |
| report-import-ai.js | 0f7a58e8dc7cf6949016907d8b726ecd52851f5c7ec9113964eef45c51bd5caf |
| functions/api/_llm-providers.js | d1629fe9fcba392560bc78bcefbecb326aebcad8a1df32c0f22e5da2d4d84838 |
| functions/api/generate.js | a5d2e1eadf45306e223fc2b664006938c2e0c3308c3a4ce77aea745d66638f34 |
| index.html | a2f1579cd9a6d4155bad6dac33b505c556057b9bf61b05083256219b555c4361 |

质量/审阅冷备与manifest位于 `quality/`，生成冷备位于 `generation/before/`。首轮全量失败日志和原因在 `regression/` 原位保留；修复后完整成功证据另存 `regression/after-legacy-table/`，没有用成功日志覆盖失败证据。最终运行时静态文件读回SHA与上述版本一致，见 `runtime/final-readback.json`。

## 3. 验证结果及实际发现

### 3.1 模块与真实原稿

JavaScript语法检查通过。生成相关75项模块测试通过；审阅/来源相关77项通过；历史表格兼容修复后的quality/review/context/真实IndexedDB store直接相关104项通过，均0失败/0跳过。这些分组存在重叠，不能相加当作独立用例总数。

最后104项命令：

```powershell
node --require ./scripts/windows-browser-lockout-guard.cjs --test tests/report-import-quality.test.cjs tests/report-import-review.test.cjs tests/report-import-context.test.cjs tests/report-import-store.test.cjs
```

证据：`generation/verification.json`、`quality/review-scope-completion.json`、`quality/legacy-table-completion.json`。

两份真实DOCX重新经当前解析器解析，共559个块；规则提示由原6条变为22条，其中5条为有明确条件的表内算术提示。22条是待审问题，不是22个已证实错误，更不是专业评分。原件与工作稿均未被这项检查修改，浏览器的外部网络请求被阻止。最终复验证据：`quality/real-originals-1792053677870.json`。

原件SHA：

- 主报告：`03c986570b7840b76b65254675ff69046c466088ce6864b3bb49038965ad0a27`。
- 市场与定位附件：`4d99b62b23d74666b46d08f927b278c88231583e741b0230470c1476d3ed30ec`。

审阅门禁的真实原稿回放证明：引用市场无关段不再被附件其他财务段拦住；引用实际冲突段仍拒绝。完整10条数值差异未被删除；部分采用仍按原请求完整范围核验。证据：`quality/review-scope-real-replay-1792048417516.json`。

### 3.2 首轮失败与修复

首轮全量3101项中3098通过、3失败、0跳过。三个失败都来自历史二维数组表格在新质量算术检查中被当作新版cells读取，抛出TypeError；store正确中止保存并保留旧稿。它不是实际引用冲突门禁的问题。

修复只在quality模块增加只读表格归一化，同时用于算术、时期和事实提取；不改store事务、不删事实保护、不改原表。未知布局保留文本冲突检查但不进行推断算术。新增两项行为测试覆盖新旧结构一致、原件不变、未知布局及实际候选采用。首轮失败证据和旧表格保存在 `regression/legacy-table-root-cause.json`、`quality/legacy-table-before-manifest.json` 及对应冷备中。

### 3.3 最终独立PostgreSQL全量回归

最终命令：

```powershell
node --require ./scripts/windows-browser-lockout-guard.cjs outputs/report-import/1015-final-improvement/regression/after-legacy-table/run-final-regression.cjs
```

runner沿用 `scripts/run-postgres-tests.mjs`：创建独立本地PG库，执行schema及迁移，再以保护入口运行全量测试，最后清理同一个临时库。浏览器guard同时接入wrapper和PG内部测试入口。

| 项目 | 最终结果 |
| --- | --- |
| 时间 | 2026-10-15 08:44:24–08:49:20 UTC |
| 有效测试文件 | 422 |
| 测试数/通过 | 3103 / 3103 |
| 失败/跳过/取消/todo | 0 / 0 / 0 / 0 |
| 总耗时 | 296274ms（296.274秒） |
| Node测试耗时 | 290647.2115ms |
| 独立测试库 | studyreport_restore_1792053864336044148 |
| 清理 | 创建与DROP库名完全一致，cleanupConfirmed=true |
| 冻结验证 | 产品20文件、测试与PG/guard runner SHA全部未变化，changedAfterStart为空 |

默认源码发现命令为 `rg --files -g '*test.js' -g '*test.cjs' -g '*test.mjs'`，共427项。仅排除以下5个不可执行历史冷备，每项均在manifest记录原因；不把它们统计成跳过。outputs下仍活跃的测试保留在422文件中。

1. `outputs/report-import/1014-local-review-baseline/import_parser/report-import-store.test.cjs`。
2. `outputs/report-import/1014-real-originals/parser-audit/post-fix/before/report-import-core.test.js`。
3. `outputs/report-import/1014-real-originals/ui-code-baseline-20261014-030436/report-import-ui.test.cjs`。
4. `outputs/report-import/1015-final-improvement/generation/before/tests/report-import-ai-durable.test.cjs`。
5. `outputs/report-import/1015-final-improvement/generation/before/tests/report-import-ai-api.test.mjs`。

隐藏扫描仅作附录，额外18项均为 `.dsh-filess` 历史备份，不属于本次源码发现口径；依赖/vendor不扩展为本项目测试。quality的 `.before`、`.scope-before`、`.legacy-table-before` 快照并非可执行测试后缀。

最终证据：[结果](../outputs/report-import/1015-final-improvement/regression/after-legacy-table/final-regression-result.json)、[清单](../outputs/report-import/1015-final-improvement/regression/after-legacy-table/final-regression-manifest.json)、[日志](../outputs/report-import/1015-final-improvement/regression/after-legacy-table/final-regression.log)。

## 4. 最终服务与一次真实AI请求

`runtime/server-start.json` 记录以正常网络权限启动新版服务，PID23412。`runtime/after-restart-smoke.json` 中项目列表、导入请求能力GET、旧generate GET及两项研究资料读取API均返回200，页面静态文件SHA一致。这里的GET/资料读取只证明对应接口；不能替代旧AI生成主链实际正文或联网搜索生成全面验收。

`runtime/final-readback.json` 记录一次新的真实网页局部请求：

| 项目 | 结果 |
| --- | --- |
| requestId | e8328b8b-8da1-457d-b4f0-4a11ff86e51c |
| 请求次数 | 1次生成POST，0次回执GET，0次云POST |
| 返回 | deepseek-cloud，HTTP200，body_complete，ready |
| 耗时 | 3405ms，仅这一条请求样本 |
| 候选范围 | source-b148的局部补充 |
| 长度 | 251字符、228汉字；要求400–600字符，未达标 |
| 状态 | 待人工审阅，0采用；原件和overlay未变 |
| usage | prompt1632、completion374、total2006 tokens |
| 费用 | billingConfirmed=false；usage不代表核实账单 |
| 备份 | 5076930字节，SHA b71792e090f2c279cfadb733053cce11623070ea6168ded9984b3c66a256d2cd |

没有为字数不足补发或切模型；历史unknown请求保持原件、ID和状态，未查询或重放。本次成功证明当前精确范围请求可取得候选，不能证明旧120秒超时的具体根因已消除，也不能形成供应商长期可靠性或整稿专业质量结论。待审候选的网页备份恢复与最终V5成稿恢复已分别通过，见4.1和4.2。


### 4.1 待审候选真实备份和恢复

`candidate-preservation/evidence.json` 与 `audit-readback.json` 已通过：在本地服务器独立账号82的真实index页面，完整备份→10块上传+1次publish→完整读回→源稿刷新→首页返回→新隔离浏览器恢复→再次刷新。当前完整备份为5110019字节，SHA `cbd476204f440ec013b93ca36dfa33aadbb2cbac2b382188d145b2b2062d3ceb`。

此流程0新增AI POST、0回执GET、0候选采用；requestId仍为e8328b8b-8da1-457d-b4f0-4a11ff86e51c，ready候选在独立draft/fileId映射后完整保留，仍251字符、未批准。两原件SHA不变，导出Word与未修改的原主稿SHA一致，证明未采用候选没有混入正文。源稿刷新、返回再进入、新浏览器恢复和再刷新均通过，前后静态SHA一致，正式项目数均0，无新增页面或控制台错误。

这次验证只适用于本地网站服务器；接口名称中的云备份不表示已经公有云部署。最终完善稿V5的恢复另列4.2，不与待审候选场景混用。

### 4.2 最终V5成稿的网页交付与恢复

[最终成稿网页证据](../outputs/report-import/1015-final-improvement/report-delivery/evidence.json) 于2026-10-15 09:30–09:31 UTC通过。在本地网站独立账号82中导入3份文件：V5作为主稿，原主报告和市场定位原附件作为参考。原件字节哈希保留，网页导出Word的SHA与V5最终文件完全相同：`3fdbc254b072cb24e12866cd7a5a23daa391dc9665736b32cfdaf55a6161a1ea`。

完整备份5688840字节，11块上传+1次publish，档案ID及备份SHA为 `18bfc8efd91b3102dffa9c6f5ee2cbb034c293859e86383dd592412be8f1d3a9`。完整服务器读回、源稿刷新、离开后返回、新隔离浏览器恢复及恢复后刷新均通过。0新增AI POST、0回执查询、0页面/控制台/阻止请求错误；正式项目数前后均为0。根任务另看过最终页面截图。

这证明当前本地网站可以保留、导出并恢复这一份独立编辑的V5成稿；没有把它冒充网页AI自动生成的整稿，也没有将第4节的偏短候选混入正文。它不构成公有云发布、跨设备全覆盖或生产容量认证。

## 5. V5最终成品与附件审查

文件：`deliverables/税务局保障性租赁住房项目_1015完善审阅稿_V5_验收版.docx`。

- DOCX SHA：`3fdbc254b072cb24e12866cd7a5a23daa391dc9665736b32cfdaf55a6161a1ea`。
- 实际渲染PDF SHA：`927e9e87d651a999a535e6d21cb02199990206cf9373c6b74b21e9a883bc9c77`。
- 163处编辑操作逐项精确投影；14张原表XML一致，其他原部件不变；44处完整待补红色；两原件未改。
- 隔离LibreOffice26.2.6真实渲染58页，输出58张页面图。77目录项、77书签与实际标题目的页全吻合，全部目录文字可见。
- V3第44页空表续行已解决；V5第5、43–47页共6页逐张视觉通过，原表XML保持不变。其余52页与已逐页审查的V3逐像素相同，复用对应逐页视觉记录；全58页汇总覆盖并通过。根任务另直接复看V5第44、46页。
- 所有中间版本与原件均保留。分页只作必要调整，不以删内容、缩字或改表值解决版面问题。

证据：[V5结构审计](../outputs/report-import/1015-final-improvement/content/final-docx-structural-audit-v5.json)、[实际分页/目录](../outputs/report-import/1015-final-improvement/content/final-render-verification-v5.json)、[改动页视觉](../outputs/report-import/1015-final-improvement/content/visual-qa-v5-changed-pages.json)、[逐像素比对](../outputs/report-import/1015-final-improvement/content/v5-page-pixel-comparison.json)。结构审计先于排版，其中actualPaginationVerified=false、visualInspectionPerformed=false是当时阶段字段；当前分页以final-render-verification-v5.json为准，最终全58页视觉由 [视觉验收汇总](../outputs/report-import/1015-final-improvement/content/final-visual-acceptance-v5.json) 确认；final-render-verification-v5.json中的visualInspection=pending同样是该阶段字段，不改写历史阶段记录冒充当时已验。

原附件5张图已逐张查看，记录于 [原图审查](../outputs/report-import/1015-final-improvement/source-image-review/visual-review.json)。image1的市场租金图可见AI生成标识，不能作为已核实统计数据；其余图分别存在原裁切、分辨率、效力或效果图边界。没有将这些图片自动导入主稿作为事实证据；它们完整保留在原附件中。视觉可读不等于OCR提取、版权核验或市场数据认证。

该稿是审阅稿，未新增专业批准的财务假设、实际调研、工程检测或正式附件。预算、租金、出租率、计租期和原表勾稽需责任方核实；权属、协议、现行政策与安全条件仍待补。不同Word/WPS/字体环境可能重新分页。

## 6. 评分及下一步优先级

44/60维逐条当前证据和边界见 [持续评估](1015-report-import-improvement-assessment.md)。本轮不抬分：44维能力覆盖73.84、生产成熟度加权代理73.54、真实数据资产成熟度代理61.33、60维战略平均73.18；评分提升项和下降项均无。

本稿文字阶段为67/90；最终全58页视觉及网页恢复通过后，成果与恢复项计8/10，合计75/100的编辑自评，已记录在final-visual-acceptance-v5.json。这不是专业认证或应用稳定质量认证。即使成果拿满10分也只有77/100，达到80分首先需要补齐并批准业务事实。

优先顺序：第一，统一预算、租金、出租及计租口径并复算原表，补权属、协议、政策和现场资料；第二，责任方按V5的待补和冲突清单逐项确认专业结论，保留短候选未采用状态，不自动补发；第三，专业批准后建立跨项目独立留出评测集。上下文压缩55、真实项目验证52、专业真值/留出55仍阻塞稳定80分承诺，不保证再做固定轮数就达标。

正式部署还需实际分段加载、持久任务重启恢复及最终4核8GB环境至少60分钟混合压力测试；当前自动回归、单次3405ms生成和58页成稿均不是生产容量认证。

## 7. 最终验收状态与源码统计

| 项目 | 当前状态 | 适用边界 |
| --- | --- | --- |
| 待审候选网页备份恢复 | 通过，见4.1及candidate-preservation两个JSON | 本地服务器；0新增AI/0回执GET/0采用；候选偏短仍待审 |
| 最终V5成稿网页导入恢复 | 通过，见4.2；3文件、5688840字节、11块+1publish、导出SHA等于V5；刷新/返回/新浏览器恢复/再刷新通过 | 本地服务器独立稿，正式项目0；不是公有云发布 |
| V5实际排版与视觉 | 163处/14表/44红待补/58页/77目录全部核验；6张改动页视觉通过，52页像素相同；全58页覆盖并通过 | 不同终端可能重排 |
| 本稿最终质量分 | 文字67/90；成果与恢复8/10，合计75/100编辑自评 | 非专业认证；仍未达到80分 |
| 最终源码计数 | 根任务2026-10-15按最终代码执行node scripts/count-source-code.mjs：2799文件、192789756字节、183.86MiB、234994行 | 固定口径为JS/MJS/CJS/HTML/CSS/SQL/Python/JSON；排除.git、node_modules、outputs、.dsh-filess、.tmp、local-data、tools/vendor |

[最终综合复核](../outputs/report-import/1015-final-improvement/final-audit-result.json) 于2026-10-15 09:36 UTC通过，重新核对445个文件：20个产品文件、422个测试文件、3个runner，与3103项通过时的冻结版本均相同。两原件哈希未变，全58页视觉、V5网页导出/恢复、候选未采用保留均通过。

最终源码统计与本轮代码收尾数字一致，但这里引用的是根任务最终交付重新执行的回执，已保存在上述综合复核中。文档和outputs证据不计入有效源码；源码体积不是运行性能或生产容量指标。

本技术记录保留在仓库内。完整44维持续评估和60维战略复核另按AGENTS.md第9节新增保存到 `C:/Users/HP/Desktop/复刻网站消化/study/AI办公网站/`，文件名分别为 `1015项目企业级能力44维持续评估.md` 和 `1015项目企业级能力60维战略复核.md`，复制后SHA读回一致，未覆盖已有文件。准备副本与清单位于 `outputs/report-import/1015-final-improvement/assessment-archive/`。归档不产生AI请求、不改变服务或产品文件、不写正式项目、不清理用户数据。后续若更改产品或成品，应记录新版本并按实际影响复验。
