# 企业级Agent核心代码学习与实施蓝图

> 日期：2026年8月26日  
> 适用项目：AI可研报告生成系统  
> 技术基线：浏览器原生JavaScript + Node/Hono + PostgreSQL + 现有Cloudflare API适配层  
> 说明：本文代码是进入正式开发前的核心骨架，字段和接口已经按当前项目设计，但尚未写入生产代码。正式实施时必须按 `AGENTS.md` 分阶段落地和测试。

## 一、先理解当前AgentCore和目标Agent Runtime的区别

当前 `agent-core.js` 已经完成：

- 工具注册与白名单；
- 轻量参数校验；
- 有限轮ReAct循环；
- 工具调用轨迹；
- 自查和澄清；
- 用户长期记忆；
- 多模型Provider故障切换。

它的问题不是“没有Agent”，而是运行循环主要在浏览器中。目标架构应变成：

```text
前台可研/PPT/办公对话
        │ 创建任务、提交确认、查看进度
        ▼
Agent Run API
        │
        ├── Runtime状态机：Run → Step → Checkpoint → Approval
        ├── Context：Memory + Project State + Wiki/RAG + Skill
        ├── Tool Gateway：Schema + 权限 + 超时 + 重试 + 幂等 + 审计
        ├── Model Router：主推理 / 摘要 / OCR视觉 / 网络提取
        └── Event Stream：thinking / tool / approval / completed / failed
        │
        ▼
PostgreSQL + 异步Worker
```

前端不再负责保证任务完成，只负责发起任务、显示状态、人工确认和恢复进入。

## 二、核心数据结构

### 2.1 Run、Step、Checkpoint和Approval

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL UNIQUE,
  user_id         BIGINT NOT NULL,
  department_id   TEXT DEFAULT '',
  project_id      TEXT DEFAULT '',
  agent_type      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  current_step    INTEGER NOT NULL DEFAULT 0,
  input_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  parent_run_id   TEXT DEFAULT '',
  error_code      TEXT DEFAULT '',
  error_message   TEXT DEFAULT '',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_scope
  ON agent_runs(user_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_steps (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL,
  step_no         INTEGER NOT NULL,
  step_type       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  input_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_name       TEXT DEFAULT '',
  attempt         INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT DEFAULT '',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE(run_id, step_no)
);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL,
  step_no         INTEGER NOT NULL,
  state_json      JSONB NOT NULL,
  state_hash      TEXT NOT NULL,
  parent_id       BIGINT,
  created_at      BIGINT NOT NULL,
  UNIQUE(run_id, step_no, state_hash)
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id              BIGSERIAL PRIMARY KEY,
  approval_id     TEXT NOT NULL UNIQUE,
  run_id          TEXT NOT NULL,
  step_no         INTEGER NOT NULL,
  action_type     TEXT NOT NULL,
  risk_level      TEXT NOT NULL,
  request_json    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  decided_by      BIGINT,
  decision_note   TEXT DEFAULT '',
  created_at      BIGINT NOT NULL,
  decided_at      BIGINT
);
```

关键点：

- `run_id` 是一次业务任务，不等同于浏览器会话。
- `idempotency_key` 防止用户连续点击造成重复生成、重复发布或重复扣费。
- `step_no` 是恢复边界；完成一步就写Checkpoint。
- `approval_id` 是独立审批对象，不能用Session ID代替授权凭证。

### 2.2 Skill候选、版本与绑定

```sql
CREATE TABLE IF NOT EXISTS agent_skills (
  id              BIGSERIAL PRIMARY KEY,
  skill_key       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  business_type   TEXT NOT NULL,
  chapter_key     TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',
  published_ver   INTEGER NOT NULL DEFAULT 0,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
  id              BIGSERIAL PRIMARY KEY,
  skill_id        BIGINT NOT NULL,
  version         INTEGER NOT NULL,
  content_json    JSONB NOT NULL,
  source_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_summary  TEXT DEFAULT '',
  created_by      BIGINT NOT NULL,
  created_at      BIGINT NOT NULL,
  UNIQUE(skill_id, version)
);

CREATE TABLE IF NOT EXISTS agent_skill_candidates (
  id              BIGSERIAL PRIMARY KEY,
  candidate_id    TEXT NOT NULL UNIQUE,
  skill_id        BIGINT,
  source_run_id   TEXT NOT NULL,
  base_version    INTEGER NOT NULL DEFAULT 0,
  proposal_json   JSONB NOT NULL,
  diff_json       JSONB NOT NULL,
  eval_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending',
  reviewed_by     BIGINT,
  review_note     TEXT DEFAULT '',
  created_at      BIGINT NOT NULL,
  reviewed_at     BIGINT
);

CREATE TABLE IF NOT EXISTS agent_skill_bindings (
  id              BIGSERIAL PRIMARY KEY,
  skill_id        BIGINT NOT NULL,
  binding_type    TEXT NOT NULL,
  binding_key     TEXT NOT NULL,
  config_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(skill_id, binding_type, binding_key)
);
```

`content_json`建议结构：

```json
{
  "purpose": "生成项目区位与现状小节",
  "appliesWhen": ["rent", "nonresidential"],
  "requiredMaterials": [],
  "optionalMaterials": [],
  "toolSequence": ["search_project_location", "query_poi", "search_wiki"],
  "writingSteps": [],
  "outputContract": {},
  "reviewRules": [],
  "nonApplicableCases": [],
  "evidenceRequirements": []
}
```

## 三、服务端Agent Runtime核心代码

建议新增 `local-server/agent-runtime.js`，不要继续把复杂逻辑塞进前端 `agent-core.js`。

```js
// local-server/agent-runtime.js
import crypto from "node:crypto";

const FINAL = new Set(["completed", "failed", "cancelled"]);

export function createAgentRuntime({ db, modelRouter, toolGateway, contextBuilder, emit }) {
  async function createRun(input, actor) {
    const runId = crypto.randomUUID();
    const now = Date.now();
    const idem = String(input.idempotencyKey || `${input.agentType}:${actor.userId}:${now}`);

    const existing = await db.prepare(
      "SELECT run_id,status FROM agent_runs WHERE user_id=? AND idempotency_key=?"
    ).bind(actor.userId, idem).first();
    if (existing) return existing;

    await db.prepare(
      `INSERT INTO agent_runs
       (run_id,user_id,department_id,project_id,agent_type,status,input_json,
        idempotency_key,parent_run_id,created_at,updated_at)
       VALUES(?,?,?,?,?,'queued',?,?,?,?,?)`
    ).bind(
      runId, actor.userId, actor.departmentId || "", input.projectId || "",
      input.agentType, JSON.stringify(input.payload || {}), idem,
      input.parentRunId || "", now, now
    ).run();

    await emit(runId, "run_queued", { agentType: input.agentType });
    return { run_id: runId, status: "queued" };
  }

  async function executeRun(runId, actor) {
    let run = await loadAuthorizedRun(runId, actor);
    if (FINAL.has(run.status)) return run;

    await updateRun(runId, { status: "running" });
    await emit(runId, "run_started", {});

    try {
      const checkpoint = await latestCheckpoint(runId);
      let state = checkpoint ? checkpoint.state_json : await initialState(run, actor);

      while (!state.done) {
        const stepNo = Number(state.stepNo || 0) + 1;
        const step = await planNextStep(run, state, actor);
        await saveStep(runId, stepNo, step, "running");
        await emit(runId, "step_started", { stepNo, type: step.type });

        if (step.requiresApproval) {
          const approval = await createApproval(runId, stepNo, step, actor);
          await updateRun(runId, { status: "waiting_approval", current_step: stepNo });
          await emit(runId, "approval_required", approval);
          return { run_id: runId, status: "waiting_approval", approval };
        }

        const result = await executeStep(step, { run, state, actor, stepNo });
        state = reduceState(state, step, result);
        await finishStep(runId, stepNo, result);
        await saveCheckpoint(runId, stepNo, state);
        await updateRun(runId, { current_step: stepNo });
        await emit(runId, "step_completed", { stepNo, summary: result.summary });
      }

      await updateRun(runId, { status: "completed", output_json: state.output });
      await emit(runId, "run_completed", { output: state.output });
      return { run_id: runId, status: "completed", output: state.output };
    } catch (error) {
      const classified = classifyRuntimeError(error);
      await updateRun(runId, {
        status: classified.retryable ? "retryable" : "failed",
        error_code: classified.code,
        error_message: classified.safeMessage
      });
      await emit(runId, "run_failed", classified);
      throw error;
    }
  }

  async function executeStep(step, ctx) {
    if (step.type === "tool") {
      return toolGateway.execute(step.toolName, step.args, {
        actor: ctx.actor,
        projectId: ctx.run.project_id,
        runId: ctx.run.run_id,
        idempotencyKey: `${ctx.run.run_id}:${ctx.stepNo}:${step.toolName}`
      });
    }
    if (step.type === "model") {
      const context = await contextBuilder.build(ctx.run, ctx.state, step);
      return modelRouter.complete(step.modelTask, context);
    }
    if (step.type === "deterministic") return step.run(ctx.state);
    throw new Error(`UNKNOWN_STEP_TYPE:${step.type}`);
  }

  return { createRun, executeRun };
}
```

这里最重要的不是循环写法，而是每个副作用都经过Step、Checkpoint、授权和幂等边界。

## 四、统一工具网关

### 4.1 工具定义

```js
// local-server/agent-tool-registry.js
const registry = new Map();

export function registerAgentTool(definition) {
  if (!definition?.name || typeof definition.run !== "function") {
    throw new Error("INVALID_TOOL_DEFINITION");
  }
  registry.set(definition.name, Object.freeze({
    version: 1,
    risk: "read",
    timeoutMs: 15_000,
    maxRetries: 1,
    idempotent: true,
    requiredPermissions: [],
    ...definition
  }));
}

export function getTool(name) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`UNKNOWN_TOOL:${name}`);
  return tool;
}

export function listToolSchemas(toolset) {
  return [...registry.values()]
    .filter(t => toolset.includes(t.name))
    .map(t => t.schema);
}
```

业务工具示例：

```js
registerAgentTool({
  name: "calculate_rent_project",
  version: 2,
  risk: "deterministic",
  idempotent: true,
  requiredPermissions: ["calc:rent:execute"],
  schema: {
    type: "function",
    function: {
      name: "calculate_rent_project",
      description: "使用出租类白箱引擎计算，不允许模型自行计算财务结果",
      parameters: {
        type: "object",
        required: ["projectId", "snapshotId"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          snapshotId: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    }
  },
  validate(args) {
    if (!args.projectId || !args.snapshotId) return { ok: false, error: "缺少项目或快照" };
    return { ok: true };
  },
  async run(args, ctx) {
    return ctx.services.rentCalculation.runFromSnapshot(args.snapshotId);
  }
});
```

### 4.2 执行策略

```js
// local-server/agent-tool-gateway.js
export function createToolGateway({ authorize, audit, services }) {
  async function execute(name, args, ctx) {
    const tool = getTool(name);
    const validation = tool.validate ? tool.validate(args) : { ok: true };
    if (!validation.ok) throw safeError("TOOL_ARGS_INVALID", validation.error);

    const allowed = await authorize({
      actor: ctx.actor,
      projectId: ctx.projectId,
      permissions: tool.requiredPermissions,
      risk: tool.risk
    });
    if (!allowed) throw safeError("TOOL_FORBIDDEN", "没有执行该工具的权限");

    if (["write", "publish", "delete", "formula"].includes(tool.risk)) {
      return { requiresApproval: true, tool: name, args: redactArgs(args) };
    }

    const started = Date.now();
    try {
      const output = await withTimeout(
        () => tool.run(args, { ...ctx, services }),
        tool.timeoutMs
      );
      await audit.success({ name, ctx, durationMs: Date.now() - started, output });
      return { ok: true, output, summary: summarizeToolOutput(output) };
    } catch (error) {
      const classified = classifyToolError(error);
      await audit.failure({ name, ctx, durationMs: Date.now() - started, classified });
      throw classified;
    }
  }
  return { execute };
}
```

### 4.3 场景Toolsets

```js
export const AGENT_TOOLSETS = Object.freeze({
  report_materials: ["search_wiki", "search_project_files", "list_material_gaps"],
  report_writing: ["search_wiki", "get_calc_snapshot", "draft_report_section"],
  report_review: ["get_report_section", "get_calc_snapshot", "run_review_rules"],
  calc_rent: ["get_calc_snapshot", "calculate_rent_project", "preview_calc_impact"],
  ppt_design: ["parse_material", "search_assets", "render_slide_preview"],
  admin_skill: ["get_skill", "create_skill_candidate", "evaluate_skill_candidate"]
});
```

每次Run只传入一个或少数几个Toolset，不能默认暴露所有工具。

## 五、Memory、State、Wiki和Skill四层上下文

```js
// local-server/agent-context.js
export function createContextBuilder({ memoryRepo, projectRepo, rag, skillRepo, tokenBudget }) {
  async function build(run, state, step) {
    const [memory, projectFacts, skillIndex] = await Promise.all([
      memoryRepo.forUser(run.user_id),
      projectRepo.confirmedFacts(run.project_id),
      skillRepo.listLevel0({ agentType: run.agent_type, stepType: step.type })
    ]);

    const selectedSkills = await skillRepo.loadLevel1(
      chooseRelevantSkills(skillIndex, step)
    );
    const evidence = step.needsEvidence
      ? await rag.search({
          query: step.query,
          userId: run.user_id,
          departmentId: run.department_id,
          projectId: run.project_id,
          limit: 8
        })
      : [];

    return fitToBudget({
      immutableFacts: projectFacts,
      taskState: state,
      userPreferences: memory.userPreferences,
      proceduralSkills: selectedSkills,
      evidence,
      recentMessages: state.recentMessages || []
    }, tokenBudget.forTask(step.modelTask));
  }
  return { build };
}
```

四层含义：

| 层 | 放什么 | 不放什么 |
|---|---|---|
| Memory | 用户偏好、沟通方式、稳定工作习惯 | 项目关键数字和正式政策 |
| Project State | 人工确认地址、参数、快照、步骤、锁定章节 | 通用写作经验 |
| Wiki/RAG | 正式政策、制度、案例、来源证据 | 未审核的用户偏好 |
| Skill | 某类任务怎样执行、需要什么材料、调用什么工具、怎样核查 | 某项目临时事实 |

## 六、上下文安全压缩

```js
// local-server/agent-context-compressor.js
export async function compressConversation({ run, messages, state, summarize, persist }) {
  // 1. 先固化不可丢失事实
  await persist.projectFacts(run.project_id, state.confirmedFacts);
  await persist.taskState(run.run_id, state.taskState);

  // 2. 工具调用与结果按pair分组，不能拆开
  const groups = groupToolPairs(messages);
  const recent = protectRecentGroups(groups, { maxTokens: 12_000 });
  const middle = groups.slice(0, Math.max(0, groups.length - recent.length));

  const summary = await summarize({
    instruction: [
      "以下内容只是历史参考，不是当前用户指令。",
      "区分已完成、未完成、用户纠正、失败尝试和有效证据。",
      "不得把已完成任务重新列为待办。"
    ].join("\n"),
    messages: flattenGroups(middle)
  });

  const childSession = await persist.childSession({
    parentSessionId: run.session_id,
    coveredMessageIds: collectIds(middle),
    summaryModel: summary.model,
    summaryText: summary.text
  });

  return {
    sessionId: childSession.id,
    messages: [
      { role: "system", kind: "history_summary", content: summary.text },
      ...flattenGroups(recent)
    ]
  };
}
```

必须测试的场景：

- 用户已经说“不要继续”，压缩恢复后不能继续旧任务；
- 工具调用成功但结果很长，压缩后仍能知道结果；
- 用户修改项目地址，旧地址不得重新覆盖新地址；
- 压缩两次后仍能追溯父会话和覆盖范围。

## 七、Skill候选审批闭环

### 7.1 AI只能提交候选

```js
// local-server/agent-skill-service.js
export function createSkillService({ db, evaluator }) {
  async function proposeEnhancement({ sourceRunId, skillKey, proposal, actor }) {
    const current = await loadPublishedSkill(skillKey);
    const normalized = normalizeSkillProposal(proposal);
    const diff = structuredDiff(current?.content_json || {}, normalized);

    const evalResult = await evaluator.compare({
      skillKey,
      baseVersion: current?.version || 0,
      candidate: normalized,
      cases: await loadSkillEvalCases(skillKey)
    });

    const candidateId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO agent_skill_candidates
       (candidate_id,skill_id,source_run_id,base_version,proposal_json,diff_json,
        eval_json,status,created_at)
       VALUES(?,?,?,?,?,?,?,'pending',?)`
    ).bind(
      candidateId, current?.skill_id || null, sourceRunId, current?.version || 0,
      JSON.stringify(normalized), JSON.stringify(diff), JSON.stringify(evalResult), Date.now()
    ).run();
    return { candidateId, diff, evalResult, status: "pending" };
  }

  async function approveCandidate(candidateId, editedProposal, admin) {
    requirePermission(admin, "skill:publish");
    return db.transaction(async tx => {
      const candidate = await lockCandidate(tx, candidateId);
      if (candidate.status !== "pending") throw new Error("CANDIDATE_ALREADY_DECIDED");

      const content = normalizeSkillProposal(editedProposal || candidate.proposal_json);
      const skill = await ensureSkill(tx, content);
      const version = Number(skill.published_ver || 0) + 1;
      await insertSkillVersion(tx, skill.id, version, content, candidate, admin);
      await publishSkillVersion(tx, skill.id, version);
      await markCandidateApproved(tx, candidateId, admin.userId);
      return { skillKey: skill.skill_key, version };
    });
  }

  return { proposeEnhancement, approveCandidate };
}
```

### 7.2 管理员必须看到的内容

- 哪次项目、哪段对话触发；
- 原Skill版本；
- 新增、修改、删除的结构化差异；
- 引用材料及来源；
- 在真实案例上的前后评分；
- 适用范围和不适用边界；
- 发布影响：哪些业务类型、章节和新项目会采用；
- 回滚按钮。

## 八、MCP如何接入而不破坏现有工具治理

MCP不是另一套越权工具系统，只是外部工具协议适配器。

```js
// local-server/agent-mcp-adapter.js
export function registerMcpTools(mcpClient, policy) {
  return mcpClient.listTools().then(remoteTools => {
    for (const remote of remoteTools) {
      const localName = `mcp_${mcpClient.serverId}_${remote.name}`;
      registerAgentTool({
        name: localName,
        version: remote.version || 1,
        risk: policy.riskFor(remote.name),
        timeoutMs: policy.timeoutFor(remote.name),
        requiredPermissions: policy.permissionsFor(remote.name),
        schema: convertMcpSchema(remote, localName),
        validate: args => validateJsonSchema(remote.inputSchema, args),
        run: (args, ctx) => mcpClient.callTool(remote.name, args, {
          signal: ctx.signal,
          traceId: ctx.runId
        })
      });
    }
  });
}
```

必须满足：

- MCP服务端必须登记所有者、用途、网络地址和数据密级；
- MCP返回结果仍要脱敏、限长和记录证据ID；
- 外部MCP失败不能中断测算、RAG等无关能力；
- 禁止MCP动态注册公式修改、正式发布和删除工具；
- OA或集团接口将来可通过MCP接入，但仍要经过公司网络和权限条件。

## 九、统一事件流与前端恢复

### 9.1 事件表

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, id);
```

### 9.2 前端只消费统一事件

```js
// agent-run-client.js
async function followAgentRun(runId, afterId, onEvent) {
  let cursor = Number(afterId || 0);
  while (true) {
    const res = await fetch(`/api/agentruns?runId=${encodeURIComponent(runId)}&after=${cursor}`,
      { headers: window.authHeaders ? window.authHeaders() : {} });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "任务状态读取失败");

    for (const event of data.events || []) {
      cursor = Math.max(cursor, event.id);
      onEvent(event);
    }
    if (["completed", "failed", "cancelled"].includes(data.run.status)) return data.run;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

未来可把轮询替换为SSE/WebSocket，但事件数据和前端处理契约不变。

## 十、API入口骨架

```js
// functions/api/agentruns.js
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

export async function onRequestPost(context) {
  const env = adaptEnv(context.env);
  const user = await verifyAuth(context.request, env);
  if (!user) return json({ ok: false, error: "未登录" }, 401);

  const body = await context.request.json();
  if (body.action === "create") {
    const input = validateCreateRun(body);
    const run = await env.AGENT_RUNTIME.createRun(input, user);
    return json({ ok: true, run });
  }
  if (body.action === "approve" || body.action === "reject") {
    const result = await env.AGENT_RUNTIME.decideApproval(body, user);
    return json({ ok: true, result });
  }
  if (body.action === "cancel") {
    const result = await env.AGENT_RUNTIME.cancelRun(body.runId, user);
    return json({ ok: true, result });
  }
  return json({ ok: false, error: "未知操作" }, 400);
}

export async function onRequestGet(context) {
  const env = adaptEnv(context.env);
  const user = await verifyAuth(context.request, env);
  if (!user) return json({ ok: false, error: "未登录" }, 401);

  const url = new URL(context.request.url);
  const runId = url.searchParams.get("runId");
  const after = Number(url.searchParams.get("after") || 0);
  const result = await env.AGENT_RUNTIME.getRunWithEvents(runId, after, user);
  return json({ ok: true, ...result });
}
```

## 十一、核心回归测试示例

```js
import test from "node:test";
import assert from "node:assert/strict";

test("相同幂等键不会创建两个Run", async () => {
  const first = await runtime.createRun(input, actor);
  const second = await runtime.createRun(input, actor);
  assert.equal(second.run_id, first.run_id);
});

test("页面离开后可从最后Checkpoint继续", async () => {
  await runtime.executeRun(runId, actor, { stopAfterStep: 2 });
  const before = await repo.latestCheckpoint(runId);
  const resumed = await runtime.executeRun(runId, actor);
  assert.equal(before.step_no, 2);
  assert.equal(resumed.status, "completed");
  assert.equal(toolSpy.callsFor("write_report_section"), 1);
});

test("无项目权限不能通过已知runId查看或审批", async () => {
  await assert.rejects(
    () => runtime.getRunWithEvents(runId, 0, otherDepartmentUser),
    /FORBIDDEN/
  );
});

test("AI提出Skill增强后不会直接改变正式版本", async () => {
  const before = await skills.getPublished("rent.location_analysis");
  await skills.proposeEnhancement(proposal);
  const after = await skills.getPublished("rent.location_analysis");
  assert.equal(after.version, before.version);
});

test("工具调用和结果在压缩中不被拆开", async () => {
  const compressed = await compressConversation(fixture);
  assert.equal(hasOrphanToolCall(compressed.messages), false);
  assert.equal(hasOrphanToolResult(compressed.messages), false);
});

test("MCP失败不影响相邻白箱测算工具", async () => {
  mcpServer.failNext(new Error("network unavailable"));
  await assert.rejects(() => gateway.execute("mcp_oa_search", {}, ctx));
  const calc = await gateway.execute("calculate_rent_project", calcArgs, ctx);
  assert.equal(calc.ok, true);
});
```

## 十二、建议的实际文件拆分

```text
local-server/
  agent-runtime.js             # Run/Step状态机
  agent-worker.js              # 队列消费和恢复
  agent-tool-registry.js       # 工具定义
  agent-tool-gateway.js        # 权限、超时、重试、审计
  agent-context.js             # 四层上下文
  agent-context-compressor.js  # 安全压缩与谱系
  agent-skill-service.js       # Skill候选、审批和版本
  agent-model-router.js        # 主模型与辅助模型链
  agent-event-store.js         # 统一事件
  agent-mcp-adapter.js         # MCP适配器

functions/api/
  agentruns.js                 # Run查询、创建、恢复、取消
  agentapprovals.js            # 审批
  agentskills.js               # Skill候选和发布

migrations/
  00xx_agent_runtime.sql
  00xx_agent_skills.sql

tests/
  agent-runtime.test.js
  agent-tool-gateway.test.js
  agent-context-compressor.test.js
  agent-skill-service.test.js
  agent-mcp-adapter.test.js
```

现有 `agent-core.js` 暂时保留，作为旧页面兼容层和短问答客户端；新长流程逐个迁移，不一次性替换。

## 十三、正式实施顺序

### 第一批：最小Run底座

- 只建Run、Step、Checkpoint、Event；
- 接入一个低风险流程；
- 验证刷新、关闭页面、重复点击和服务重启；
- 暂不接Skill、不接MCP、不接多Agent。

### 第二批：工具网关与统一审批

- 把3—5个代表工具迁入新网关；
- 接入读、测算、写入、发布四类风险；
- 完成权限、超时、幂等、错误隔离和审计测试。

### 第三批：上下文治理

- 建立Memory/State/Wiki/Skill分层；
- 加入L0/L1/L2技能加载；
- 加入上下文压缩和会话谱系；
- 用30轮以上项目对话验证事实不丢失。

### 第四批：Skill增强闭环

- 从“管理员增强本节规则”接入候选生成；
- 增加差异、依据、评测、审批、版本和回滚；
- 不允许AI自动发布。

### 第五批：MCP、隔离和高级运行

- 工具网关稳定后再接MCP；
- 文档解析/OCR/网络抓取迁入受限Worker；
- 有明确并行收益时再加入只读子Agent；
- 长流程复杂度达到阈值后再选择性接LangGraph。

## 十四、你学习这套代码时应抓住的五个核心

1. **Run是业务任务，不是一次模型请求。** 一个Run可以包含多次模型调用、工具调用和人工审批。
2. **Checkpoint保存的是可恢复业务状态。** 不能只保存聊天文本。
3. **Tool Gateway是企业Agent最重要的安全和稳定边界。** MCP、内部API和本地函数最终都应走同一网关。
4. **Skill是可执行经验，不是普通知识。** 它必须有适用范围、步骤、工具、输出契约、核查规则和版本。
5. **自我改进必须是候选制。** AI可以总结和提议，但正式规则、测算口径和报告模板只能由人审批发布。

把以上五点真正落地后，项目Agent能力才会从“前端能循环调用工具”升级为“企业可恢复、可治理、可审计、可学习的业务运行平台”。
