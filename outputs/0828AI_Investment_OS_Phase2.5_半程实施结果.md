# AI Investment OS Phase 2.5 半程实施结果

日期：2026-08-28

## 一、校准建议可行性结论

总体结论：**可行，方向正确，可直接开发，但需要复用现有能力而不是重复建设。**

建议中最有价值的五项是：

1. 项目数据从第一天就带组织、部门、所有者、可见性和保密级别边界；
2. 生命周期阶段不能冒充项目真实完成率；
3. Project Intelligence Read Model 必须先于更多项目页面形成；
4. Gate、Milestone、Deliverable 要成为企业项目进度的事实来源；
5. 页面 AI 必须消费统一 Project Context Contract，而不是各自拼 Prompt。

需要调整的部分：

- 项目清单、Project Brain、投资全周期八阶段和 Golden Project 评测入口已经存在，不应重新造一套；
- `projects/:id` 的独立路由可留到门户重构后半程，当前先把统一数据模型接入现有投资全周期项目驾驶舱；
- 地图、文件智能和大型数据门户不属于本次前半程，先确保项目边界、数据契约和真实进度正确；
- Golden Project 不能由系统虚构，现阶段只保留机制，必须由真实项目资料驱动验收。

## 二、本次完成的“前50%”

### 1. Project Domain 与项目权限边界

新增项目档案和项目成员关系：

- `organization_id`
- `department_id`
- `owner_user_id`
- `visibility`
- `confidentiality_level`
- `lifecycle_stage`
- `current_gate_id`
- OWNER / EDITOR / VIEWER 三级项目角色

旧项目首次进入时会自动建立 OWNER 边界，不要求人工搬迁历史项目。

### 2. Project Context Contract

统一上下文包含：

- 项目、组织、用户与角色；
- 生命周期、当前 Gate；
- 当前页面、当前对象类型和对象 ID；
- Facts、Parameters、Metrics、Evidence 快照；
- 当前 Scenario、最新决策、开放风险和待确认事项；
- 当前用户可以查看、编辑、管理成员、管理权限、审签的权限集合。

这为后续财务、市场、文件、决策页面的上下文 AI 提供统一输入契约。

### 3. Project Intelligence Read Model V1

新增统一项目只读模型，集中输出：

- project / stage / gate；
- progress / dataHealth / kpis；
- files / risks / decisions / recentChanges / nextActions；
- milestones / deliverables / memberships；
- contextContract。

项目总览不再分别从多个模块临时拼装数据。

### 4. 真实项目进度

新增：

- ProjectGate；
- ProjectMilestone；
- ProjectDeliverable。

真实进度仅由里程碑完成度与必需阶段成果共同计算。若尚未配置，页面明确显示“真实进度待配置”，不再把“可研与尽调”“测算完成”等生命周期状态换算成虚假百分比。

### 5. 现有项目驾驶舱接入

投资全周期项目工作区新增 Project Intelligence 总览：

- 总投资、IRR（只读取白箱测算结果）；
- 数据健康分；
- 开放风险与逾期任务；
- 当前 Gate；
- 近期里程碑；
- 阶段成果；
- 当前项目角色；
- OWNER/EDITOR 可新增 Gate、里程碑和成果。

## 三、本次没有做的后50%

1. 独立 `/projects/:id/*` 企业门户路由与保存视图；
2. Project Data Registry 的完整下钻、冲突与待确认工作台；
3. Project File Intelligence；
4. Decision → Parameter → Calculation → Metric → Artifact 的完整门户化页面；
5. Market & Spatial Workspace V1；
6. Executive Brief、Portfolio Brain 与正式管理层看板；
7. 企业 SSO、完整 RBAC、租户级权限管理 UI；
8. 真实 Golden Project 数据装载与3—6个月连续验证。

## 四、验证结果

- 新增 Project Intelligence 纯逻辑测试：4项通过；
- 新增 Project Intelligence API 测试：2项通过；
- 相邻 Project Brain、Investment Ops、Project Manager 回归：20项通过；
- 浏览器真实验证：首页进入投资全周期、项目列表、项目总览、真实进度、角色及三个维护入口均正常，控制台无新增错误；
- 全仓回归：**368/368 通过**。

## 五、下一步建议

下一批优先顺序：

1. 选定1个真实 Golden Project，录入负责人、Gate、里程碑和阶段成果；
2. 建 Project Data Registry，让关键数字两次点击内看到来源和计算过程；
3. 建 Project File Intelligence，把文件、事实、参数和证据接入统一项目上下文；
4. 再做正式项目门户路由和高密度下钻界面；
5. 最后扩展 Market & Spatial，不先做脱离投资研判的漂亮地图。
