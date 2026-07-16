# v29 全量RAG 部署说明（比之前多两步，都是一次性的）

## 第一步：上传3个文件到GitHub仓库（老规矩）

| 文件 | 位置 | 操作 |
|---|---|---|
| `index.html` | public/ | 替换 |
| `admin.html` | public/ | 替换 |
| `rag.js` | functions/api/ | **新增** |

## 第二步：创建 Vectorize 向量索引（一次性，二选一）

**方式A · Cloudflare 控制台（推荐小白）**：
1. 登录 dash.cloudflare.com → 左侧菜单找 **Vectorize** → Create Index
2. 名称填 `rag-index`，Dimensions 填 **1024**，Metric 选 **cosine** → 创建

**方式B · 命令行**（如果你装过 wrangler）：
```
npx wrangler vectorize create rag-index --dimensions=1024 --metric=cosine
```

⚠️ 维度必须是 **1024**（对应 bge-m3 中文向量模型），选错了检索会报错，删掉重建即可。

## 第三步：给 Pages 项目加两个绑定（一次性）

进入你的 Pages 项目 → **Settings → Bindings**（或 Functions 标签下）→ Add：

1. **Vectorize**：Variable name 填 `VECTORIZE`，Index 选 `rag-index`
2. **Workers AI**：Variable name 填 `AI`

（名字必须一字不差：`VECTORIZE` 和 `AI`，全大写）

## 第四步：重新部署

绑定改动后必须重新部署才生效——随便改一下仓库任意文件 push 一次（或在 Pages 里 Retry deployment）。

## 使用

1. 打开 `admin.html` → **RAG知识库** → 选择报告文件（可多选 docx/pdf/txt）→ 自动解析、按章节切块、向量化入库，有进度条
2. 入库后用页面下方"检索测试"验证：输入"市场分析 供需"应返回相关段落和相似度
3. 之后正常生成报告：每个小节自动语义检索最相关的2段历史报告注入AI（相似度≥0.5才注入），指导语要求"借鉴结构与论证、不得照抄数据"
4. 未完成第二三步时，RAG自动静默跳过，不影响任何现有功能

## 成本

Workers AI 与 Vectorize 均有免费额度，你这个量级（上百份报告约几千块向量、日常生成检索）**大概率跑在免费档内**。

## 注入优先级（生成时同时生效，各自独立）

黄金范例库（人工精选，确定性）→ 项目参考资料（本项目上传）→ RAG历史报告（语义检索，兜长尾）
