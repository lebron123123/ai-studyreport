/* ============================================================
   _adapters.js —— 平台适配层（云端 / 本地化 双部署支撑）

   【设计要点：本文件保持"零依赖"】
   本文件不引入任何 Node 专用包（如 pg），也不做动态 import。
   原因：Cloudflare 打包 Pages Functions 时会分析依赖，一旦出现
   Workers 环境不存在的包，构建就会失败——那等于把现网搞挂了。

   所以分工是这样的：
     · 云端：Cloudflare 平台注入 env.DB / env.VECTORIZE / env.AI
     · 本地：本地服务器(local-server/server.js)在调用处理函数之前，
             把自己造好的 PostgreSQL / pgvector / Ollama 适配对象
             按同样的名字注入 env
   两边对业务代码来说长得一模一样，所以 88 处调用一个字都不用改。

   本文件的职责因此简化为两件事：
     1. 云端模式：原样返回 env（零风险，不新建对象、不改属性）
     2. 本地模式：校验必需的绑定确实被注入了，没有就给出清晰报错，
        而不是让业务代码遇到一个莫名其妙的 undefined
   ============================================================ */

/** 当前部署形态：只有显式设置 DEPLOY_MODE=local 才走本地，其余一律云端 */
export function deployMode(env) {
  return (env && env.DEPLOY_MODE === "local") ? "local" : "cloud";
}

/**
 * 适配环境对象
 * @param {object} env 云端由 Cloudflare 提供；本地由 local-server 提供
 * @returns {object} 原样的 env（两种模式都不包装，保证行为可预测）
 */
export function adaptEnv(env) {
  if (deployMode(env) !== "local") return env;   // ← 云端从这里直接返回

  // 本地模式：绑定应由本地服务器注入。缺了就早点报清楚，别拖到业务代码里才炸。
  if (!env.DB) {
    throw new Error("[本地部署] 未注入数据库(DB)。请检查 local-server 是否正确启动、DATABASE_URL 是否配置。");
  }
  return env;
}

/* ============================================================
   接口契约（本地实现必须长成这样，实现在 local-server/ 目录下）

   env.DB —— 兼容 Cloudflare D1，用到的方法共5个：
     db.prepare(sql)        → stmt
     stmt.bind(...params)   → stmt（可链式）
     stmt.first()           → 单行对象 或 null
     stmt.all()             → { results: [行,...] }
     stmt.run()             → { success:true, meta:{ last_row_id, changes } }
     ⚠️ auth.js 注册新用户时会读 meta.last_row_id，本地实现必须支持

   env.VECTORIZE —— 兼容 Cloudflare Vectorize，用到4个方法：
     upsert(items)          items = [{ id, values:number[], metadata:{title,category,level,text} }]
     query(vec, {topK, returnMetadata}) → { matches:[{ id, score, metadata }] }
                            ⚠️ score 是"相似度"，越大越相关（不是距离）
     deleteByIds(ids)
     describe()             → { vectorsCount }

   env.AI —— 兼容 Cloudflare Workers AI，用到3种能力：
     run("@cf/baai/bge-m3", { text:string[] })          → { data: number[][] }  1024维
     run("@cf/baai/bge-reranker-base", { query, contexts, top_k })
                                                        → { response:[{id,score}] }
     toMarkdown([{ name, blob }])                       → [{ name, data }]

   ⚠️ 向量化必须沿用 bge-m3。向量是模型的产物，换模型 = 历史向量全部作废
      = 整个知识库要重新入库。Ollama 官方库里的 bge-m3 与 Cloudflare 同源、同为1024维。
   ============================================================ */
