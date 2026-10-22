# 1021 发布测试可移植性

记录日期：2026-10-21。本次处理公开 CI 因缺少本机私有证据、原始模板或 Windows 专用条件而失败的问题。测试分组已调整；本文初稿不声明 main 发布或云端部署完成，最终结果另附实际运行记录。

## 三类测试各验证什么

| 分组 | 目录 | 环境与材料 | 必须保留的验证 |
| --- | --- | --- | --- |
| 公开通用行为 | `tests/` | 仓库内可生成或已脱敏的合成样本，Windows/Linux | 真实调用计算、解析、修订、导出及错误边界；合成样本不冒充历史原件 |
| Windows 平台行为 | `tests-platform/windows/` | Windows、PowerShell，隔离排版与文件锁场景 | 运行 Windows 特有行为；非 Windows 调用该套件直接失败，不记为跳过 |
| 私有真实验收 | `acceptance/private/` | 授权本机保留的真实原件、模板、历史回执和固定哈希 | 保留原断言与原哈希；材料缺失是失败，不以合成文件顶替 |

公开仓库包含私有验收的测试代码，不包含真实材料和历史运行数据。历史 `outputs/` 作为证据目录，不作为自动递归发现测试的根目录；历史冷备中的测试副本不替代当前套件。

## 常用命令

```powershell
# 当前平台的公开行为测试；Windows 会同时包含 Windows 专用测试
npm test

# Windows 专用行为（必须在 Windows 运行）
npm run test:windows

# 本机真实材料/历史证据验收，缺材料会失败
npm run test:private

# 发布前完整本机验收：公开 + Windows（当前平台为 Windows 时）+ 私有
# 从 local-server/.env 读取本机数据库连接，创建并清理独立测试库
npm run test:integration
```

CI 的 Linux 工作使用 `node scripts/run-postgres-tests.mjs`：创建独立 PostgreSQL 测试库，完成迁移和公开测试，再清理它创建的同名测试库。CI 的 Windows 工作使用 `node scripts/run-tests.mjs --windows-only`，Linux 质量门禁依赖该工作成功。真实私有验收另由本机 `test:integration` 必跑，不能因为公开 CI 通过而省略。

单文件定位可使用 `node scripts/run-tests.mjs tests/某文件.test.mjs`。需要直接启动 Node 浏览器测试时，必须使用 `node --require ./scripts/windows-browser-lockout-guard.cjs --test ...`；统一 runner 已预加载保护，不调整个人浏览器或 Windows 安全设置。

## 门禁与验收边界

`scripts/run-tests.mjs` 只从显式目录收集测试，拒绝空套件或无效选项。退出成功之外，还要求最终摘要非空、通过数等于总数，失败、跳过、取消、todo 全部为零。数据库依赖缺失不能以跳过冒充通过；私有验收缺原件不能用降低固定哈希要求来通过。

历史证据拆分相关检查已在2026-10-21本机完成136项，136通过、0失败/跳过/取消，耗时44.8秒；其中公开88项、私有48项，包括受保护的Chromium行为验证。原88个显式测试块逐字保留；完整历史deterministic测试文件仅调整相对路径；另补3项合成转换行为测试。此处是定向组结果，不能相加冒充全仓库总数，也不覆盖其他私有模板或正式服务器验收。

本次不修改生产计算公式或报告内容，不新增收费AI调用。完整数据库集成、Windows/Linux云端结果、最终提交和部署版本须由发布任务分别记录。静态网站部署成功也不等于本机后端已迁云、专业成稿已签审或生产容量已认证。
