# 企业级 Agent 学习总成：从当前 AgentCore 到可治理智能体平台

> 本文是学习与架构总成，不是仓库开发规范。仓库根目录 `AGENTS.md` 只约束如何安全修改、测试和交付代码；两者不能混用。

## 一、先用通俗话理解 Agent

普通大模型是“问一句、答一句”。Agent 是“先理解目标，再选择工具，执行若干步骤，检查结果，必要时等待人工确认，最后把过程和结果保存下来”。企业级 Agent 比普通 Agent 多出的不是一个更长的提示词，而是五项工程能力：

1. **可执行**：模型只能决定调用什么，真实数字、文件、数据库修改由受控工具完成。
2. **可恢复**：任务不是浏览器里的一次函数调用，而是可保存的 Run；中断后可从 Checkpoint 恢复。
3. **可治理**：每个工具有版本、风险、权限、超时、幂等和审批规则。
4. **可追溯**：每轮模型、每次工具、输入摘要、结果摘要和错误都形成事件账本。
5. **可进化**：成功经验先成为 Skill Candidate，经过测试和管理员审核后才发布，不能让模型自行修改生产规则。

## 二、当前项目原有 AgentCore 是什么水平

原有 `agent-core.js` 已具备较好的业务型 Agent 基础：

- ReAct 多轮循环；
- 工具注册、参数校验和结果回填；
- 可研、测算、RAG、PPT、办公等业务工具；
- 回答自检、澄清和轮次上限；
- 用户长期记忆；
- 最终摘要调用日志。

它的核心优点是“业务适配强”，但原先仍是浏览器内的一次运行：页面关闭后执行上下文丢失，工具缺少统一风险元数据，日志只记录最终摘要，不能精确恢复到某一步，也没有 Skill 候选的审核闭环。

## 三、Hermes 等成熟项目最值得吸收的精华

本项目不照搬 Hermes 的全部 Python/终端生态，而吸收以下思想：

### 1. 工具定义是契约，不只是函数

工具必须同时描述：

```js
{
  name: "diagnose_population",
  version: "1.0.0",
  toolset: "report",
  risk: "read",
  requiresApproval: false,
  idempotent: true,
  timeoutMs: 20000
}
```

这样才能回答“谁可以调用、是否会改数据、失败能否重试、是否需要人工确认”。

### 2. 长任务必须外置状态

模型上下文不是数据库。企业任务的真实状态应存为：

```text
Run
 ├─ Step 1: model
 ├─ Step 2: tool / diagnose_population
 ├─ Checkpoint 2
 ├─ Step 3: model
 └─ completed / failed / waiting_approval
```

### 3. 上下文分层，不能把全部历史一股脑塞给模型

本项目采用四层：

- 指令层：系统规则和用户最新要求；
- 工作层：当前项目、阶段、参数和最近消息；
- 知识层：RAG、Wiki、生成规则和审核标准；
- 记忆/技能层：用户偏好、历史摘要、已审核 Skill。

指令层优先级最高；知识和记忆只能提供参考，不能覆盖当前用户明确要求。

### 4. 自我改进必须经过候选、评测、审批、发布

正确闭环是：

```text
成功运行 → 提炼候选技能 → 绑定证据Run → 自动测试 → 管理员审核 → 发布
```

生产规则、测算公式和审核标准绝不能由模型自动覆盖。

## 四、本次“提升50%”已经落地的代码

### 1. 服务端运行账本

数据库新增五类实体：

- `agent_runs`：任务身份、状态、项目、幂等键、输入输出和终态；
- `agent_run_steps`：模型轮次与工具步骤；
- `agent_checkpoints`：可恢复状态摘要；
- `agent_approvals`：高风险工具审批；
- `agent_skill_candidates`：待审核技能候选。

核心位置：

- `migrations/0008_agent_runtime.sql`
- `local-server/schema-postgres.sql`
- `functions/api/_agent-runtime.js`
- `functions/api/agentruns.js`
- `functions/api/agentskills.js`

### 2. AgentCore 兼容式接入

`agent-core.js` 保留原有调用方式，但每次运行会尽力：

```js
const created = await runtimeCall("create", {
  agentType: opt.agentType || "general",
  projectId: opt.projectId || "",
  query: opt.traceQuery || "",
  idempotencyKey: opt.idempotencyKey || ""
});
```

每轮模型、每次工具和工具后的 Checkpoint 都会写账本。账本服务暂时失败时，旧 Agent 仍可继续运行，避免一次架构升级拖垮可研、PPT和办公主链路。

### 3. 工具网关第一阶段

工具现在可声明：`version/risk/toolset/requiresApproval/idempotent/timeoutMs`。系统增加：

- 单工具超时；
- 单次任务工具总数上限；
- 相同工具+相同参数重复调用熔断；
- Agent 总运行时间上限；
- destructive 工具默认等待人工确认；
- 工具步骤写入风险等级和所属场景。

### 4. 四层上下文契约

`functions/api/_agent-contracts.js` 和 `AgentCore.buildContextLayers()` 已定义统一数据结构。当前是兼容式注入，后续再按 Token 预算做动态压缩和检索。

### 5. Skill Candidate 骨架

`AgentCore.proposeSkill()` 可把经验提交到 `/api/agentskills`。候选默认状态为 `candidate`；只有管理员能够 approve/reject。当前故意不自动发布，这是企业治理边界。

### 6. 可观测界面

后台“Agent调用记录”在旧摘要日志之外，增加 Run/Step 运行账本概览，可看到运行中、待审批、步骤数和工具调用数。

## 五、核心代码如何阅读

### 1. 生命周期

```js
createAgentRun()
  -> appendAgentStep(kind="model")
  -> appendAgentStep(kind="tool")
  -> saveAgentCheckpoint()
  -> finishAgentRun(status="completed|failed|cancelled")
```

### 2. 工具风险控制

```js
const meta = normalizeToolMeta(name, def);
if (meta.requiresApproval && !approved) {
  await runtimeCall("approvalCreate", ...);
  // 不执行真实工具
}
```

### 3. 幂等

`agent_runs` 对 `(user_id, idempotency_key)` 建唯一约束。同一用户重复提交同一业务动作时可以复用原 Run，避免重复生成、重复扣费或重复写数据。页面侧尚未全量配置业务幂等键，后续按工作流逐项接入。

### 4. Checkpoint 为什么只存摘要

检查点保存恢复所需的阶段、轮次、已调用工具和工作状态，不保存完整敏感材料和超长工具结果。完整业务事实仍在项目数据库、RAG、测算快照和文件台账中，Checkpoint 只保存引用和执行状态。

## 六、升级前后能力变化

| 能力 | 升级前 | 本批后 |
|---|---|---|
| Agent循环 | 浏览器内ReAct | 保留并增加运行边界 |
| 运行状态 | 最终摘要 | Run+Step+Checkpoint+终态 |
| 工具治理 | 业务自行约束 | 统一风险/版本/超时/审批元数据 |
| 可恢复性 | 刷新后依赖业务页面状态 | 已有检查点底座，后台Worker续跑待下一阶段 |
| 多Agent | 各模块各自调用 | 已有统一运行契约，调度器待下一阶段 |
| 上下文 | 系统词+历史+记忆 | 四层上下文契约 |
| 自我学习 | 用户记忆 | Skill Candidate+管理员审核骨架 |
| 可观测性 | 最终调用日志 | 逐轮、逐工具、运行状态可观察 |

本批不是“完整企业Agent终态”。它完成了约一半的关键底座；真正后台续跑、跨Agent协作、自动评测和正式Skill发布仍是下一阶段。

## 七、下一阶段建议顺序

1. **后台 Worker 与恢复执行**：把不依赖浏览器 DOM 的工具迁到服务端执行器；租约、心跳、重试和死信队列。
2. **场景 Agent 编排**：可研主Agent、数据Agent、测算Agent、审查Agent、PPT Agent通过受控handoff协作。
3. **上下文预算器**：按任务动态选择规则、知识、历史和技能，工具调用与结果成对压缩。
4. **评测门禁**：建立事实准确率、工具成功率、规则命中率、恢复成功率、成本和时延基准。
5. **Skill正式发布**：候选技能自动回放测试，管理员可查看差异、审批、回滚版本。
6. **部门和数据权限**：项目、部门、密级、工具权限、数据行级权限统一进入策略引擎。

## 八、学习时最容易混淆的三个概念

### Agent 与工作流

工作流的步骤提前确定；Agent 可以根据当前结果动态选工具。企业系统通常是“确定性工作流包住 Agent”，而不是让 Agent 自由控制一切。

### Memory 与 Knowledge

Memory 是用户偏好和历史任务摘要；Knowledge 是有来源、有版本、有权限的正式知识。Memory 不能当政策依据。

### Skill 与 Tool

Tool 是可执行能力，如查RAG、跑测算、导出Word；Skill 是一套经过验证的任务方法，告诉 Agent 在什么条件下以什么顺序调用哪些 Tool。

## 九、验收清单

- 创建 Agent 任务后能获得 `runId`；
- 模型轮次和工具调用会形成 Step；
- 工具执行后形成 Checkpoint；
- destructive 工具未经确认不执行；
- 同参数重复工具调用会熔断；
- 运行超时和工具超时有明确错误；
- 用户只能读取自己的运行；
- Skill 候选不能自行发布；
- 运行账本接口失败不影响旧主链路；
- 后台可以看到最近 Run 状态。

## 十、关联资料

- `0826企业级Agent框架评估与升级实施方案.md`：完整差距和分批路线；
- `0826企业级Agent核心代码学习与实施蓝图.md`：更详细的数据结构和伪代码；
- `0826项目企业级能力43维持续评估.md`：全项目持续评分基线；
- 仓库根目录 `AGENTS.md`：仅工程协作、最小修改和测试准入规范。

## 十一、第二阶段：五项企业能力已落地（以本节为最新状态）

前文第六、七节记录的是第一阶段状态。本节为第二阶段完成后的最新状态。

### 1. 后台续跑与恢复

浏览器内 Agent 仍适合需要页面交互的任务；不依赖 DOM 的长任务可以提交到 `agent_jobs`。本地服务器启动独立 Worker，通过租约抢占任务，并持续发送心跳。页面关闭不会终止 Worker。进程中断后，租约过期的任务可被重新领取；执行器先读取最新 Checkpoint，已完成步骤不会重复调用。

```js
const job = await claimAgentJob(env, workerId, 45000);
const auth = await reauthorizeAgentJob(env, job);
if (!auth.ok) throw new Error(auth.error);
await executeAgentJob(env, job);
await settleAgentJob(env, job, true);
```

失败任务按 1秒、2秒、4秒……指数退避重试，达到 `max_attempts` 后进入 `dead`，保留错误原因，用户可以取消或人工重放。云端部署可通过 `/api/agentworker` 由定时任务触发同一执行器。

### 2. 受控多 Agent 编排

多 Agent 不是让多个模型自由聊天，而是由主 Run 拆出最多4个子 Run。子 Run 记录 `parent_run_id` 和 `root_run_id`，每批最多并行2个；主 Agent只在子任务完成后综合。重试时使用固定幂等键复用子 Run，并从检查点恢复已有结果。

```js
tasks = [
  { role: "research", query: "核查资料与证据" },
  { role: "review", query: "依据规则复核结论" }
];
// 子Agent只完成明确分工，主Agent负责消重、冲突说明和最终结论。
```

### 3. Token、模型与费用预算

每次非流式模型调用返回 `provider`、`model` 和 `usage`。系统将输入Token、输出Token、时延及费用写入 `agent_run_usage`，并汇总到 `agent_run_governance`。费用不会猜：只有管理员配置 `LLM_COSTS_JSON` 后才核算，否则后台明确显示“待配置单价”。

每个 Run 可设置输入Token、输出Token和费用上限。Agent每轮调用前检查预算，超过上限停止，不会仅依赖全站每日次数限额。

### 4. Skill 评测、发布与回滚

对话经验不再直接变成公司标准，正式流程为：

`候选 → 建立不可变版本 → 至少2个用例评测 → 管理员发布 → 使用 → 必要时回滚`

当前自动门禁检查技能说明、用途边界、来源证据和评测用例，总分达到80才允许发布。人工“通过”只代表初审，不能绕过评测。发布表只指向当前有效版本，回滚时切回上一版本，历史版本不被覆盖。

### 5. 部门、项目与密级 ABAC

权限不只在进入页面时检查。Agent创建任务时检查一次，后台 Worker 真正执行前再检查一次，浏览器 Agent 每次工具调用前也重新检查：

- 用户是否仍存在；
- 数据密级是否不高于用户 `clearance`；
- 项目是否本人所有，或是否存在 `agent_project_access` 授权；
- 部门是否匹配；
- read/write/approve/admin 动作是否在授权范围内。

管理员可授予或撤销用户对某一项目的动作权限；权限在任务排队期间被撤销，后台任务也会在真正执行前停止。

## 十二、第二阶段验收证据

- Agent专项测试：7/7；
- 全仓库自动化回归：315/315；
- 真实PostgreSQL后台任务：主Agent 1个、子Agent 2个、主Agent汇总1次；
- 实测模型调用3次，输入Token 120、输出Token 36；
- 主任务状态 `completed`，父子谱系2条，检查点2个；
- 测试数据使用 `[系统测试]` 标识并在结束后精确清理；
- 本地服务重启后首页、AI可研页面、新 Agent API 均正常；
- 原AI可研已形成内容、材料缺口标记、重写与AI修改等原链路未被破坏。

## 十三、当前边界

后台续跑已经是真实能力，但只有提交到服务端执行器的任务可以关页续跑。依赖浏览器 DOM、人工弹窗或页面内临时对象的历史工具，仍需按场景逐批迁移后才能后台执行。多 Agent 当前限制为最多4个子任务、每批2个并发，是为了在50人并发环境下先保证可控；不是无限扩张的“Agent群”。
