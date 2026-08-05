/* ============================================================
   ai-ollama.js —— 让本地 Ollama "长得像" Cloudflare Workers AI

   业务代码用到 Workers AI 的三种能力，本地对应情况：

   | 能力       | Cloudflare              | 本地(Ollama)        | 状态 |
   |-----------|-------------------------|--------------------|------|
   | 向量化     | @cf/baai/bge-m3         | ollama 的 bge-m3   | ✅ 同源同维(1024) |
   | 重排       | @cf/baai/bge-reranker   | Ollama 不支持重排器 | ⚠️ 优雅降级 |
   | 文件转md   | toMarkdown              | 无对应              | ⚠️ 优雅降级 |

   两处降级都是"如实降级"，不伪造结果：
   · 重排：返回空列表。业务代码 (rag.js) 判断 ranked.length 为空就跳过重排，
     保留纯向量排序。检索仍然可用，只是精排少了一层。这比返回假分数好得多——
     假分数会让排序看起来正常，实际是错的，属于静默失效。
   · 文件转md：抛出清晰错误。前端本来就能解析 docx/pdf/txt，
     只有复杂格式才会走到这里，届时提示用户换格式即可。
   ============================================================ */

export function createAIAdapter(opts = {}) {
  const base = (opts.ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const embedModel = opts.embedModel || "bge-m3";

  async function embed(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const r = await fetch(base + "/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, input: list }),
    });
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

    async toMarkdown() {
      throw new Error(
        "[本地部署] 服务端文件解析(toMarkdown)在本地环境不可用。" +
        "请在网页上传时使用 docx / pdf / txt 格式——这几种由浏览器端解析，不受影响。"
      );
    },

    /** 供启动自检用 */
    async _ping() {
      const r = await fetch(base + "/api/tags");
      if (!r.ok) throw new Error("Ollama 未响应 (" + r.status + ")");
      const d = await r.json();
      const names = (d.models || []).map((m) => m.name);
      return { ok: true, models: names };
    },
    _embedModel: embedModel,
  };
}
