/* ============================================================
   vector-pg.js —— 让 pgvector "长得像" Cloudflare Vectorize

   业务代码里 6 处向量调用（都在 rag.js），本文件做出同样的接口。

   ⚠️ 一个容易搞错的地方：相似度 vs 距离
      Cloudflare Vectorize 的 score 是"相似度"，越大越相关（0~1）。
      pgvector 的 <=> 运算符返回的是"余弦距离"，越小越相关（0~2）。
      业务代码里有 `m.score * 权重` 和 `sort((a,b)=>b.score-a.score)`，
      如果直接把距离当 score 返回，排序会完全反过来、加权也失去意义。
      所以这里统一换算成 相似度 = 1 - 距离。
   ============================================================ */

export function createVectorStore(db, dim = 1024) {
  // db 是 d1-shim 造出来的对象，复用同一个连接池，不额外开连接

  return {
    /** items = [{ id, values:number[], metadata:{title,category,level,text} }] */
    async upsert(items) {
      if (!Array.isArray(items) || !items.length) return { count: 0 };
      for (const it of items) {
        const vecLiteral = "[" + it.values.join(",") + "]";   // pgvector 的文本表示
        await db.prepare(
          "INSERT INTO rag_vectors(id, embedding, metadata) VALUES(?, ?::vector, ?::jsonb) " +
          "ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata"
        ).bind(it.id, vecLiteral, JSON.stringify(it.metadata || {})).run();
      }
      return { count: items.length };
    },

    /** 返回 { matches:[{ id, score, metadata }] }，score 为相似度（越大越相关） */
    async query(vec, opts = {}) {
      const topK = Math.min(parseInt(opts.topK) || 10, 200);
      const vecLiteral = "[" + vec.join(",") + "]";
      const r = await db.prepare(
        "SELECT id, metadata, 1 - (embedding <=> ?::vector) AS score " +
        "FROM rag_vectors ORDER BY embedding <=> ?::vector LIMIT ?"
      ).bind(vecLiteral, vecLiteral, topK).all();
      return {
        matches: (r.results || []).map((row) => ({
          id: row.id,
          score: typeof row.score === "number" ? row.score : parseFloat(row.score) || 0,
          metadata: row.metadata || {},
        })),
      };
    },

    async deleteByIds(ids) {
      if (!Array.isArray(ids) || !ids.length) return { count: 0 };
      // 逐条删除，避免拼接超长 IN 子句；调用方本来就是按100个一批切好的
      for (const id of ids) {
        await db.prepare("DELETE FROM rag_vectors WHERE id = ?").bind(id).run();
      }
      return { count: ids.length };
    },

    async describe() {
      const row = await db.prepare("SELECT COUNT(*)::int AS n FROM rag_vectors").first();
      return { vectorsCount: row ? row.n : 0, dimensions: dim };
    },
  };
}
