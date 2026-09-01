# AI Investment OS Phase 2.5 后半程实施结果

日期：2026-08-28

## 一、结论

Phase 2.5 后半程已经完成。原定企业级项目门户七项工作已全部落地，现有“投资全周期项目驾驶舱”从单页项目卡片升级为具备独立路由、统一数据注册、文件版本治理、决策影响下钻、市场空间摘要和项目级权限边界的项目工作区。

本次没有另造一套OA，也没有让AI接管白箱数字。系统继续以现有项目、测算、证据、决策和分析结果为事实源，只新增统一读模型与治理入口。

## 二、已完成能力

### 1. Project Data Registry

- 汇总项目事实、白箱指标、报告证据和审核通过的文件提取值；
- 统一展示当前值、状态、来源和版本；
- 自动识别同键不同值冲突与缺失项；
- 数据行可展开，经“数据项 → 来源记录 → 文件/Sheet/单元格或版本”两次点击完成溯源。

### 2. Project File Intelligence

- 同名文件再次登记时自动形成新版本，旧版标记为 superseded，不覆盖历史；
- 结构化提取先进入 candidate 候选层；
- 仅 OWNER 可以通过或驳回候选；
- 审核通过后才写入正式、带版本的项目事实或指标；
- 页面可查看文件版本链、提取状态和审核入口。

### 3. 独立项目门户路由

每个项目拥有可刷新恢复的独立地址：

- `#project/{projectId}/overview`
- `#project/{projectId}/data`
- `#project/{projectId}/files`
- `#project/{projectId}/decisions`
- `#project/{projectId}/spatial`
- `#project/{projectId}/members`

刷新后保留项目和当前工作台；浏览器前进/后退可恢复页面；关闭项目门户后回到此前页面。

### 4. Decision → Change → Impact

- 将决定、变更集、测算情景、报告成果串成影响链；
- 显示“决定 → 参数 → 指标 → 章节/成果”的传播关系；
- 继续复用既有白箱测算快照、参数依赖图和报告版本，不生成第二套数值。

### 5. Market & Spatial Workspace V1

- 统一展示项目圈层、已审核观察、POI结构、核心空间指标和OD来源去向；
- 只消费已审核/已批准数据；
- 无数据时明确空状态，不以地图装饰或AI猜测代替真实数据。

### 6. 项目成员与权限

- 项目级 OWNER / EDITOR / VIEWER 三层角色；
- API按项目成员重新鉴权，不依赖前端隐藏按钮；
- OWNER可管理成员、可见范围、组织、部门和保密级别；
- 非项目成员无法读取工作区；OWNER不能被误删除。

### 7. 企业项目工作区界面

- 六个高密度工作台集中在同一项目门户；
- 项目总览继续消费 Project Intelligence Read Model V1；
- 数据、文件、决策、空间和成员页面按职责拆分；
- 旧项目首次进入自动建立所有者边界，无需整体迁移。

## 三、关键数据与代码位置

| 能力 | 核心代码/数据 |
|---|---|
| 企业工作区纯逻辑 | `project-enterprise.js` |
| 工作区页面与路由 | `project-workspace-ui.js`、`project-manager.js`、`ui-route-state.js`、`auth.js` |
| 工作区API | `functions/api/projectworkspace.js` |
| 数据库迁移 | `migrations/0015_project_enterprise_workspace.sql` |
| 本地Postgres基线 | `local-server/schema-postgres.sql` |
| 浏览器装配 | `index.html` |
| 自动测试 | `tests/project-enterprise.test.js`、`tests/project-workspace-ui.test.js`、`tests/projectworkspace-api.test.js` |

新增正式数据表：`project_files`、`project_file_extractions`、`project_data_issues`。原有 `project_profiles`、`project_memberships`、项目事实、指标、证据、决策和分析表继续复用。

## 四、验证结果

- JavaScript语法检查：相关变更文件全部通过；
- 新增后半程模块与API测试：11项通过；
- Phase 2.5 前后半程新增测试合计：17项通过；
- 浏览器真实验收：六个工作台均可进入，独立URL正确，无“加载失败”；
- 刷新恢复：在“成员权限”独立地址刷新后，项目门户与当前页自动恢复；
- 空数据状态：数据注册表、文件、空间等页面不造数；
- 全仓回归：**379/379通过，0失败**。

## 五、Phase 2.5 是否结束

是。前半程的项目边界、统一上下文、Read Model、真实进度，与后半程的数据注册、文件治理、独立门户、决策影响、市场空间和成员权限已经连成完整底座。

后续工作不再属于“补完Phase 2.5代码框架”，而是进入生产验证阶段：

1. 装入1—3个真实项目，补齐文件、事实、指标和成员；
2. 用真实项目验证冲突、版本替换、影响链和审签；
3. 在目标服务器做50人并发与长任务压测；
4. 建立SLO告警和连续运行记录。

本次仅完成本地代码，没有提交或推送Git。

## 六、当前有效源码规模

按可执行/可编译源码口径统计（JS/MJS/CJS/HTML/CSS/SQL/Python，排除 `node_modules`、`outputs` 和 DeepSeek Harness 的 `.dsh-filess` 重复备份）：

- 285个有效源码文件；
- 共 `7,183,396` 字节，约 `718.34万字节`（6.85 MiB）；
- 约 `62,532` 行代码。

这里特意排除了 `.dsh-filess` 重复备份，避免再次把备份文件误计为正式代码而造成规模突然增加或减少的错觉。
