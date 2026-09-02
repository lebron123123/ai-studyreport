/* ============================================================
   ai-ollama.js —— 让本地 Ollama "长得像" Cloudflare Workers AI

   业务代码用到 Workers AI 的三种能力，本地对应情况：

   | 能力       | Cloudflare              | 本地(Ollama)        | 状态 |
   |-----------|-------------------------|--------------------|------|
   | 向量化     | @cf/baai/bge-m3         | ollama 的 bge-m3   | ✅ 同源同维(1024) |
   | 重排       | @cf/baai/bge-reranker   | Ollama 不支持重排器 | ⚠️ 优雅降级 |
   | 文件转md   | toMarkdown              | 旧版Word本地解析     | ⚠️ 部分支持 |

   两处降级都是"如实降级"，不伪造结果：
   · 重排：返回空列表。业务代码 (rag.js) 判断 ranked.length 为空就跳过重排，
     保留纯向量排序。检索仍然可用，只是精排少了一层。这比返回假分数好得多——
     假分数会让排序看起来正常，实际是错的，属于静默失效。
   · 文件转md：旧版二进制 .doc 用纯 Node 解析；docx/pdf/txt 仍由浏览器端解析。
     其他复杂格式继续抛出清晰错误，不伪造解析结果。
   ============================================================ */

import WordExtractor from "word-extractor";

const localWordExtractor = new WordExtractor();

function decodeLegacyHtml(buffer) {
  const source = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (!/^\s*(?:<!doctype\s+html|<html\b)/i.test(source)) return "";
  const entities = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" " };
  return source
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<(?:style|script|head)\b[^>]*>[\s\S]*?<\/(?:style|script|head)>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|tr|li|table)>/gi, "\n").replace(/<\/?(?:td|th)\b[^>]*>/gi, "\t")
    .replace(/<[^>]+>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, key) => {
      if (key[0] === "#") { const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10); return Number.isFinite(code) ? String.fromCodePoint(code) : match; }
      return entities[key.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function createAIAdapter(opts = {}) {
  const base = (opts.ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const embedModel = opts.embedModel || "bge-m3";

  /* 向量缓存：同一段文字用同一个模型算出来的向量是确定性的、不会变，所以按"文本原文"缓存不存在过期问题，
     只需要控制内存上限。加这个是因为多用户并发生成报告时，report.js 的 ragRetrieve() 每写一个小节都会
     查询一次 /api/rag，查询文本＝"领域名+章节名+小节标题"——这几项都来自固定大纲模板，
     不同用户同时生成同一领域的报告，查询文本经常逐字相同，本来要重复打给本地 Ollama 的向量化请求，
     命中缓存后直接省掉。Ollama 默认并发数按内存自动选 1 或 4（见其官方 FAQ），本地部署给 50 人同时用时，
     这一步不加缓存很容易在向量化这一环排队，且这个瓶颈和 Postgres/限流那两层都没关系，是本地推理算力的问题。 */
  const embedCache = new Map();   // text -> vector；Map 保留插入顺序，用来做简单的"先进先出"淘汰
  const EMBED_CACHE_MAX = 3000;

  // 运维可观测性用的进程内计数器：只是"这个Node进程启动以来"的累计值，重启会清零——
  // 这对"现在缓存有没有在起作用、Ollama响应快不快"这种当场排查已经够用，
  // 真要看历史趋势得落库，那是更大的活，这里先给最低成本能用上的这一版。
  const stats = { hits: 0, misses: 0, totalLatencyMs: 0, callCount: 0 };

  async function embedUncached(list) {
    const t0 = Date.now();
    const r = await fetch(base + "/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, input: list }),
    });
    stats.totalLatencyMs += (Date.now() - t0);
    stats.callCount++;
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(
        "[本地向量化] Ollama 调用失败 (" + r.status + ")。" +
        "请确认 Ollama 正在运行、且已执行 `ollama pull " + embedModel + "`。" +
        (t ? " 详情：" + t.slice(0, 200) : "")
      );
    }
    const d = await r.json();
    const vecs = d.embeddings || (d.embedding ? [d.embedding] : []);
    if (!vecs.length) throw new Error("[本地向量化] Ollama 未返回向量，请检查模型名是否正确：" + embedModel);
    return vecs;
  }

  async function embed(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    // 先查缓存，剩下没命中的（去重后）打包成一次请求，比逐条单独请求更省往返次数
    const missSet = new Set();
    list.forEach((t) => {
      if (embedCache.has(t)) stats.hits++; else { stats.misses++; missSet.add(t); }
    });
    if (missSet.size) {
      const missList = [...missSet];
      const vecs = await embedUncached(missList);
      missList.forEach((t, i) => {
        if (embedCache.size >= EMBED_CACHE_MAX) {
          const oldest = embedCache.keys().next().value;
          embedCache.delete(oldest);
        }
        embedCache.set(t, vecs[i]);
      });
    }
    return list.map((t) => embedCache.get(t));
  }

  return {
    async run(model, input) {
      // 向量化
      if (/bge-m3|embed/i.test(model)) {
        const texts = (input && (input.text || input.input)) || [];
        const data = await embed(texts);
        return { data };   // 与 Workers AI 一致：{ data: number[][] }
      }

      // 重排：Ollama 不提供重排器，如实返回空结果，让调用方跳过精排
      if (/rerank/i.test(model)) {
        return { response: [] };
      }

      throw new Error("[本地部署] 暂不支持的模型：" + model);
    },

    async toMarkdown(files) {
      const list = Array.isArray(files) ? files : [];
      return Promise.all(list.map(async (file) => {
        const name = String(file && file.name || "file");
        if (!/\.doc$/i.test(name)) {
          throw new Error("[本地部署] 服务端目前只补充解析旧版 .doc；docx / pdf / txt 请继续使用浏览器端解析");
        }
        const blob = file && file.blob;
        if (!blob || typeof blob.arrayBuffer !== "function") throw new Error("旧版 Word 文件内容为空");
        const buffer = Buffer.from(await blob.arrayBuffer());
        let data = decodeLegacyHtml(buffer);
        if (!data) {
          const document = await localWordExtractor.extract(buffer);
          data = [document.getBody(), document.getFootnotes(), document.getEndnotes()]
            .map(value => String(value || "").trim()).filter(Boolean).join("\n\n");
        }
        return { name, data, mimeType:"application/msword" };
      }));
    },

    /** 供启动自检用 */
    async _ping() {
      const r = await fetch(base + "/api/tags");
      if (!r.ok) throw new Error("Ollama 未响应 (" + r.status + ")");
      const d = await r.json();
      const names = (d.models || []).map((m) => m.name);
      return { ok: true, models: names };
    },
    /** 供后台运维看板用：向量缓存命中率与Ollama真实调用的平均耗时（本进程启动以来累计） */
    _cacheStats() {
      const total = stats.hits + stats.misses;
      return {
        hits: stats.hits, misses: stats.misses,
        hitRate: total ? Math.round(stats.hits / total * 1000) / 10 : null,   // 百分比，保留1位小数
        cacheSize: embedCache.size, cacheMax: EMBED_CACHE_MAX,
        avgLatencyMs: stats.callCount ? Math.round(stats.totalLatencyMs / stats.callCount) : null,
        ollamaCallCount: stats.callCount,
      };
    },
    _embedModel: embedModel,
  };
}
