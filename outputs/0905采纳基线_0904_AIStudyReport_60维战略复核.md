# 0904 AI StudyReport 项目企业级能力60维战略复核

评估对象：lebron123123/ai-studyreport。代码快照：b672a4c6adfa906b0cb035759c669eaaa6b9a945；提交时间：2026-09-04 12:33:59 +08:00。此次只审阅及验证，未修改、提交或推送项目代码。

## 1. 核心判断

这是具备较强垂直业务积累的投资项目智能平台原型，核心可研与白箱测算值得继续投入；企业化正在推进，但当前证据不足以认定为92.8分的成熟生产系统。建议进入有负责人兜底的小范围验证，并先修复任务一致性与评测可信度问题。

定位继续保持“现有OA/数据平台之上的投资项目智能层”，以Project Brain串联事实、测算、报告、审查和版本。无需因为这次重新打分推倒重来。近期把资源投入真实交付与可靠性，暂缓增加无关功能。

## 2. 与历史评估的关系

检索到的历史记录包括87.0、88.6及约92.8分，不能把它们直接当成同口径时间序列。当前仓库自身AGENTS.md要求：未进主流程最高59；无行为测试最高69；无版本/权限/审计最高84；无真实项目最高89；95分以上必须有多个真实项目和持续生产指标。

历史 outputs/0903项目企业级能力44维持续评估_Codex架构落地.md 中出现“成本控制98分但还待真实项目节省比例”“交互恢复98分但还待真实浏览器刷新恢复”等情况，与上述上限不一致。分数校正代表证据口径收紧，不代表代码倒退。不能因为模型名称变化自动给项目加分。

确实已改善：CI配置、canonical与runtime seed一致性、发布manifest、数据库队列、项目角色、原件对象存储。旧评估中的“缺CI”“74/165双基线仍未解决”不应继续作为当前已证实问题。本次通过的非居改保权威规则数是74；出租类137。这里证明的是仓库当前基线一致，不证明每一条业务规则完整或部署数据库已经同步。

需要下调认定：新Task Graph是否接进真实主流程；反馈评测是否独立可信；规则发布是否真正影响生成；任务取消与超时接管是否安全；真实Golden与容量是否达到生产级。

## 3. 范围、实际验证与限制

- 已直接克隆并检查上述Git提交；网页抓取未成功，主要证据来自本地同版本代码。
- 全仓 node --test：495项，493通过，2跳过，0失败。两项跳过与本机真实PPT模板/混合导出有关。
- JavaScript语法检查：297文件通过。
- Release Consistency Gate：通过。出租137规则/14章；非居改保74规则/13章；逻辑表模板出租33、非居改保住宅14、商业22；对应物理表70、14、22。
- 数据库迁移：20个文件静态检查通过；未设置TEST_DATABASE_URL，因此真实PostgreSQL空库/重复/旧库升级验证跳过。CI已配置该步骤，但本次未获取远端运行结果、分支保护或发布阻断证据。
- 最小函数核查确认 settleAgentJob 结算SQL只按id匹配；构造两条自行提交的training/holdout指标可通过场景级eligibility。该核查不等于线上漏洞利用或真实数据库竞态复现。
- 未登录部署站点、未执行浏览器全流程、未调用真实付费模型、未跑生产压力测试、未核对原始签发Word、未做备份恢复或HA演练。因此本报告是代码与自动测试审计，不是生产验收证书。
- 源码统计脚本口径：358文件、9,991,980字节、9.53MiB、76,900行。包括其规则下的第三方vendor文件及结构化配置，不能据此声称全部为原创代码。

## 4. 三类分数及计算方法

|指标|本次分数|解释|
|---|---:|---|
|60维能力证据平均分|70.0/100|下表60项等权平均，表示实现与证据成熟度，不是“完成了70%的需求”|
|44维核心能力平均分|70.2/100|便于按仓库44维规范保留基线|
|生产成熟度加权分|69.8/100|采用下列6组权重，避免用功能广度掩盖权限/可靠性|
|真实数据资产成熟度|59.0/100|第34、44、53项平均；已存在带来源信息的候选，正式签发及独立验证仍不足|

分数是本次审计判断，非统计测量；小数只用于保证计算可复算，约±5分更能反映审计不确定性。除实际运行的检查外，表中模块评价多为代码抽查，不能视为逐项独立生产验收。历史同口径分项不足，不编造“提升X分”；未见可靠新证据的能力标为待验证。

|生产评分组|权重|采用维度编号|
|---|---:|---|
|业务正确性|25%|2、4、5、6、8、21、46、47、48、49|
|身份权限与安全|20%|14、28、29、30、31、32、56|
|任务可靠性与恢复|20%|3、9、10、11、12、13、25、40、41、51、52|
|工程与发布|15%|26、27、35、37、42、57、58、59|
|容量、运维与成本|10%|33、36、38、39、55、60|
|真实评测与反馈|10%|34、43、44、53|

生产综合只取上述不重复编号的维度；其余用于诊断与战略判断，不追加得分。多个维度引用同一模块时共享证据，不把它们理解成多个独立交付成果。

## 5. 最有价值的优势

1. **垂直业务建模扎实。** 不只通用写作：住房场景、租赁/出售/改造财务测算、章节规则、专业表格、复核、证据和项目阶段都有对应代码。
2. **白箱测算是核心资产。** 确定性引擎负责数值，AI负责组织和解释；现有默认值与真实引擎扰动回归有意义。但正确公式也会被错误输入误导，仍需独立基准核对。
3. **规则治理已经具备工程基础。** 当前canonical、seed和manifest一致性实际通过，比单纯维护提示词可靠；场景化表格也有独立版本机制。
4. **受控寻源确实有接线。** functions/api/webresearch.js调用ReportQueryPlanner，按结果质量及来源情况决定早停。不能把新任务图未接线错误泛化成“所有新模块都没接线”。
5. **企业运行能力开始落到代码。** DB队列、Worker心跳、执行前重新鉴权、项目OWNER/EDITOR/VIEWER和哈希原件存储都存在。没有Redis不代表没有队列，也没有必要为组件名称直接换架构。
6. **测试底座可利用。** 当前无失败的自动测试提供回归保护；下一步应增加高价值行为测试，而非单纯增加测试数量。

## 6. 优先修复的具体问题

### P0-A：新任务编排未证明进入真实业务主流程

证据：index.html加载report-orchestration-client.js；客户端提供createContext/createWorkflow/completeNode等方法。对当前仓库前端业务JS及HTML的检索中，未找到ReportOrchestrationClient的实际业务调用。reportorchestration API和Task Graph纯逻辑有代码及测试，tests/report-orchestration-contract.test.js只检查API函数导出与迁移表名。

影响：接口存在不能证明用户点“生成报告”后真正创建工作流、保存节点结果、恢复中断或局部重跑。这里保留动态调用可能性的边界，本次未用浏览器证实实际调用；已见的静态证据不足以声称闭环完成。

动作：选一个报告场景，把页面按钮接入上下文快照、工作流、节点状态和审批，保留旧流程可回退。
验收：一次真实生成能查到workflowId/contextHash；断网刷新可恢复；改一个参数只失效其下游；重复点击不重复收费或生成最终成果。

### P0-B：任务租约和取消的结算边界不完整

证据：functions/api/_agent-enterprise.js的settleAgentJob成功与失败UPDATE均只限定id；未限定当前lease_owner、租约代次和running状态。local-server/agent-worker.js心跳失败被吞掉；agentjobs.js取消后清理租约，但在途executeAgentJob仍可能继续运行。

影响：旧Worker超时后任务已被新Worker接管，旧执行返回仍有机会覆盖任务状态；取消状态也可能被迟到的完成回写覆盖。并且executeLlmTask在settle前已写usage、checkpoint和run结果，仅给settle补条件还不够。

动作：增加fencing token/租约代次，所有状态及成果写入验证持有者；取消信号贯穿外部调用、结果落库和结算；对不可撤销外部调用提供副作用幂等。
验收：模拟A超时、B接管、A迟到；取消后模型迟到；心跳中断；同任务重试，确认状态与成果一致。

### P0-C：反馈评测仍信任客户端自报指标

证据：reportorchestration.js的feedbackEvaluate直接保存请求中的datasetRole、projectId、score、passed等。Learning.eligibility按这些值统计通过项目和holdout；没有要求绑定一个受信评测执行器产生的runId、样本版本和结果签名。纯函数核查中，自行构造两个项目的passed:true即可满足场景级准入。

影响：不能把这套计数机制称为“已经防止过拟合的独立评测”。管理员仍控制发布，这不是“普通用户可以直接发布”；但管理员可能面对缺乏可信来源的通过记录。

动作：由服务端实际跑评测并生成不可变结果，绑定样本哈希、候选版本、模型/提示词版本、执行人和数据集角色；客户端只请求执行或展示结果。
验收：篡改passed/projectId/holdout标签无效；同项目不能冒充跨项目；失败样本不能靠多次自报被覆盖。

### P1-A：发布、回滚还需证明影响实际生成

证据：新反馈发布写report_rule_publications；当前非测试运行代码检索未找到生成链读取该表的消费者。现有reportlogic自身规则版本机制与这套新反馈发布不是同一件事。

动作：定义组织/场景/项目规则的优先级、生效时间和撤回语义；生成时记录实际用到的版本。
验收：发布前后同一输入产生可解释差异；回滚后下一次生成确实恢复旧规则，而不只是后台状态改变。

### P1-B：权限体系与身份生命周期需统一

证据：projectworkspace使用project_memberships；Agent使用agent_project_access。verifyAuth验证签名和30天有效期，未查询用户停用或会话撤销状态；部分Agent执行前会查用户，不代表所有API均如此。

动作：统一权限解析；撤销成员、变更部门、停用用户必须及时作用于所有API和后台任务。审批权限与工作流拥有权分开。
验收：OWNER/EDITOR/VIEWER及外部用户覆盖读、写、导出、审批、后台任务；撤权后旧令牌与在途任务有明确可验证行为。

### P1-C：大文件与并发目前只有部分基础

证据：本地对象存储按SHA-256去重，但项目原件接口仍以base64整包读入内存并解码，限制约50MB。investment-os-load脚本使用同一账号/项目访问两个GET接口；recoveryRate在无失败时直接设1，未做故障恢复演练。

影响：50个虚拟读请求不能证明50个不同员工可同时上传、解析、生成和保存；更不能外推到2000人或百万文件。对象存储也不等于分布式容量已经验证。

动作：先以5、10、20、50用户分档测混合负载，记录P95、队列等待、失败率、内存和单报告成本；大文件采用流式上传及异步解析。当前DB队列可先加固，不预设必须Redis或微服务。

### P1-D：真实Golden仍在候选阶段

税务局JSON明确phase_draft_not_manager_approved；龙悦居为historical_document_holdout_candidate。两份都带源文档哈希，这是好的基础；本次未拿原件重新计算核对，不能把元数据当成独立鉴真。

动作：业务负责人确认签发版本，锁定一份训练样本和独立留出样本，再增加不同场景。
验收：核心数字错误、错误引用、关键表遗漏、人工修改时间与报告总耗时都有记录；训练与holdout严格分离。

### P2：维护复杂度与工程文档

普通script全局加载仍需严格顺序；aireport.js、calc.js、admin.html等体量较大。README大量内容仍停留早期免费托管和后续功能待开发的说明，与当前实现不匹配。

动作：先拆高风险业务服务边界、统一公共契约并更新一份当前部署手册。无需为了现代技术栈全面重写前端。

## 7. 60维证据表

所有证据适用于本报告顶部提交。分数遵循仓库证据上限；“无生产证据”表示未取得，而非断言用户从未运行过。

|编号|维度|分数|当前证据|主要缺口|下一步动作|
|---|---|---:|---|---|---|
|1|业务覆盖|84|report.js、calc.js、project-workflow.js|全周期真实验收不足|以一个真实项目贯穿输入到签发|
|2|白箱数值可信度|84|三类测算引擎、calc-engines/whitebox-scenario测试|基准回归不能代替独立财务复核|与批准版Excel逐项对账|
|3|端到端闭环|68|旧生成/复核链与新编排API并存|新任务图未找到页面调用|接通生成、暂停、恢复和签发|
|4|人工审签|75|review.js、report-trust.js、证据审计|新nodeApprove仅检查工作流归属|分离编制与审批角色|
|5|可解释性|80|report-trust.js、paramgovernance.js|输出与原始证据定位需实测|抽查关键结论可下钻|
|6|证据追溯|80|report-evidence-graph.js及测试|证据完整不等于结论真实|加入错误引用与过期来源测试|
|7|工具注册与发现|78|agent-core.js工具元数据|所有工具治理一致性未验|建立统一工具契约测试|
|8|参数校验|80|paramgovernance及测算测试|真实异常参数样本有限|补零值、负值、单位及极端边界|
|9|循环熔断|77|agent-core.js maxRounds、超时；webresearch决策|跨步骤硬预算仍不足|验证失败重试总成本上限|
|10|任务持久化|76|_agent-runtime.js、agent_checkpoints|不同任务路径恢复语义不一|进程重启后复核状态与结果|
|11|断点恢复|65|executeLlmTask检查点、worker心跳|旧Worker可无条件回写|租约代次与副作用幂等|
|12|人工中断审批|62|agentjobs cancel、图审批接口|取消后在途任务仍可能完成回写|取消令牌贯穿执行及结算|
|13|异步任务队列|68|agent_jobs、claim/settle、local worker|结算未校验lease_owner；单worker串行|先修租约再测多worker|
|14|会话隔离|76|user_id约束、项目会话测试|跨模块授权模型分散|多账号多项目交叉测试|
|15|多Agent协同|58|executeMultiAgentTask最多4子任务、2路并行|缺主流程真实收益证据|有业务瓶颈再启用并评测|
|16|短期记忆|73|agent-core上下文分层和近期消息|截断可能丢关键事实|保留约束并测长对话|
|17|长期记忆|66|personalnotes、wiki、agentskills|学习效果和污染防护未证实|候选审批与负例回归|
|18|上下文压缩|55|近期消息截取与上下文分层|未核实12万Token自动压缩应用闭环|做事实保留与Token压缩评测|
|19|RAG检索|75|rag.js、vector-pg.js、迁移测试|缺真实召回率/引用准确率基准|标注查询集测Recall与引用|
|20|Wiki治理|77|wiki-api测试：草稿不入向量库|效力期限及权限回归待扩展|验证撤销发布和旧引用失效|
|21|结构化数据溯源|79|projectbrain、paramgovernance、extraction|原文位置和数值需真实抽查|字段到表格单元格闭环|
|22|数据Provider|70|analysis-providers、webresearch、poi|线上数据质量/可达性未测|按必需指标验收Provider|
|23|OCR解析|65|tesseract依赖、材料解析模块|扫描表格真实准确率未知|建立复杂表格标注集|
|24|多模型路由|76|_llm-providers.js及测试|真实Provider质量成本未比较|同任务跑受控A/B|
|25|模型故障切换|72|llm-providers行为测试|无本次真实故障注入|测试超时、429、错误格式|
|26|提示词与版本治理|70|逻辑规则版本和运行上下文|所有提示词可回溯未证实|运行绑定提示词与模型版本|
|27|结构化输出|76|Context/Graph/Provider契约及测试|Schema边界执行强度不一|非法字段与缺失值拒绝测试|
|28|安全鉴权|65|PBKDF2、HMAC签名令牌|30天令牌缺逐用户撤销检查|撤销会话、停用账号、登录限流|
|29|细粒度权限|65|project_memberships与agent_project_access|两套授权表未形成统一语义|统一权限解析及撤权传播|
|30|租户隔离|58|项目user_id及组织字段|组织字段不是完整租户隔离|全API跨组织访问矩阵|
|31|密钥管理|74|SESSION_SECRET、环境变量配置|轮换与生产保管未验|验证轮换及日志脱敏|
|32|审计日志|74|agent_steps、项目events|不能证明不可篡改与完整留存|外部审计汇聚及关联ID|
|33|可观测性|62|usage耗时、日志、验收台账|缺统一Tracing与运行看板证据|统一请求/任务ID和延迟指标|
|34|离线评测|70|reportgolden与Golden回归|真实样本仍候选；评测结果可客户端提交|受信执行器生成评测记录|
|35|回归测试|79|本次493通过、2跳过|部分新增API测试只检查导出/DDL|增加真实API和关键浏览器测试|
|36|并发扩展|58|DB队列、investment-os-load脚本|缺混合负载与写冲突实测|先测5/10/20/50用户阶梯|
|37|部署可移植性|74|本地Hono/PG、Cloudflare适配|本次未做双环境部署验收|统一部署手册并空机安装|
|38|成本控制|70|查询早停、Token统计与budgetOk|预检非预留，并行任务可能超预算|原子预算预留和结算|
|39|SLO告警|50|evaluateSlo及压测结果结构|评分函数不等于持续告警系统|定义P95/错误率阈值并演练告警|
|40|交互恢复|74|project-session、route-state等测试|未执行本次浏览器真实恢复|断网/刷新/重复提交验收|
|41|降级容错|70|Provider错误边界、检查点|跨进程异常和部分失败待测|故障注入保住相邻功能|
|42|管理员可维护性|73|admin.html、规则表格后台|后台复杂且README落后|更新运维导航和排障手册|
|43|用户反馈学习|54|report-feedback-learning与API|无主流程消费发布规则证据；指标由客户端提交|服务端评测到生效闭环|
|44|真实项目验证|52|税务局训练候选、龙悦居holdout候选|尚非正式签发Golden；未独立核对原件|业务负责人确认并锁定基准|
|45|产品定位与边界|84|Project Brain与投资阶段模型|横向模块增加导致维护分散|保持OA之上的投资智能层定位|
|46|垂直业务与AI可研专业性|84|住房场景测算、章节规则、表格|缺真实跨项目交付效果量化|优先打磨可研交付闭环|
|47|可研规则与寻源治理|80|137/74规则；webresearch接Planner|queryPlan可客户端提供；须校验策略上限|后端重算风险与最大预算|
|48|Word成果质量|73|docxgen/export及报告表格机制|本次无真实Word渲染审查|目录、分页、跨页表格人工验收|
|49|专业表格治理|81|三套逻辑模板33/14/22及版本测试|排版与原始财务表对账不足|按场景抽查表格勾稽|
|50|Project Context与Project Brain|72|project-brain/context-contract及API|新Context构造与主生成绑定不足|每次生成绑定不可变快照|
|51|Task Graph/幂等/依赖失效|54|report-task-graph、编排API、单测|客户端已加载但未找到主业务调用|接线并测变参仅重跑下游|
|52|规则范围/发布/回滚|62|规则/表格版本与反馈发布记录|新反馈发布记录未找到运行时消费者|发布生效与回滚效果测试|
|53|Golden与Training/Holdout|55|两份角色分离并含文档哈希的候选JSON|角色标签不证明真实独立评测|锁样本版本、签发状态和runId|
|54|生命周期与Investment Ops|72|investment-ops、project-workflow及测试|投后/退出缺真实运行证据|从可研延伸一个相邻阶段|
|55|文件智能/搜索/大文件存储|65|本地哈希对象存储、提取审核|base64整包入内存；非百万文件证明|流式上传、异步解析、容量实测|
|56|OA/组织/多用户协作|58|角色工作台；manifest标记外部配置|SSO与组织同步未验|最小SSO与组织同步试点|
|57|CI/CD与Release Gate|78|ci.yml包含语法/一致性/迁移/Golden/全测|未核实远端运行和分支保护|确认合并必需检查与失败阻断|
|58|单一事实源与发布一致性|82|本次canonical=seed、manifest哈希通过|部署DB规则与仓库一致性未验|运行时报告版本与内容哈希|
|59|数据库Migration/灾备/HA|62|20迁移及静态门禁；PG验证脚本|本次真实数据库迁移/灾备未运行|带旧数据升级和备份恢复演练|
|60|性能容量与运营监控|54|50虚拟用户双GET压测脚本|单账号读请求不代表真实混合并发|上传/生成/写入混合压测与成本监控|

## 8. 下一步执行顺序

不以固定日期承诺工期，按可验收里程碑推进：

1. **先保住执行可信度。** 修复Worker迟到回写与取消；评测结果改为服务端可信产生；为两类风险补行为测试。验收通过再扩大多人试用。
2. **跑通一条真实闭环。** 选已有真实项目，把Task Graph接进生成入口，绑定数据/规则版本，完成暂停、恢复、变参重跑、审批和导出；证明发布规则被消费。
3. **建立正式Golden。** 拿到负责人确认的终稿，对财务数字、章节、表格、来源逐项核对；保留独立holdout。
4. **补企业试点条件。** 统一权限，完成撤权测试、真实数据库升级和备份恢复；确认远端CI及合并门禁实际启用。
5. **再决定扩容方案。** 做小规模混合负载，定位瓶颈之后决定加Worker、缓存、对象存储服务或拆模块。记录真实运行一段时间后再调整生产成熟度分数。

最优先3项：任务租约/取消一致性；新编排与真实生成闭环；可信评测与正式Golden。权限/备份是扩大多人试用前的配套门槛。

## 9. 如何判断下一轮真的进步

|验收对象|必须看到的证据|
|---|---|
|任务恢复|真实服务重启/租约接管/取消测试，且无重复最终成果|
|编排接线|页面真实操作关联workflowId和contextHash|
|评测可信|服务端runId绑定样本及规则版本，无法客户端自报通过|
|发布回滚|实际生成使用版本可追溯，回滚改变后续生成结果|
|业务价值|核心数字经业务复核，人工修改耗时相对基准减少|
|多人试点|不同账号混合工作负载及撤权测试|
|发布与灾备|远端必需检查、旧库升级、真实备份恢复记录|

不建议继续以“达到95分”为开发目标。更有用的目标是：一次真实项目交付省了多少人工时间、多少关键错误被提前拦截、一次失败后能否安全恢复。

## 10. 可定位源码

- [AGENTS.md](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/AGENTS.md)
- [.github/workflows/ci.yml](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/.github/workflows/ci.yml)
- [scripts/check-release-consistency.mjs](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/scripts/check-release-consistency.mjs)
- [functions/api/_agent-enterprise.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/_agent-enterprise.js)
- [local-server/agent-worker.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/local-server/agent-worker.js)
- [functions/api/reportorchestration.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/reportorchestration.js)
- [report-feedback-learning.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/report-feedback-learning.js)
- [report-orchestration-client.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/report-orchestration-client.js)
- [functions/api/_auth.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/_auth.js)
- [functions/api/projectworkspace.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/projectworkspace.js)
- [functions/api/_agent-policy.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/_agent-policy.js)
- [functions/api/webresearch.js](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/functions/api/webresearch.js)
- [scripts/investment-os-load.mjs](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/scripts/investment-os-load.mjs)
- [data/report-golden-tax-v2-training.json](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/data/report-golden-tax-v2-training.json)
- [data/report-golden-longyue-holdout.json](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/data/report-golden-longyue-holdout.json)
- [data/release-manifest-v1.json](https://github.com/lebron123123/ai-studyreport/blob/b672a4c6adfa906b0cb035759c669eaaa6b9a945/data/release-manifest-v1.json)

