// Native Messages search protocol, verified against deepseek-ai/deepseek-harness.
// Only server search result blocks are evidence; model-written URLs are not.
export function deepseekSearchRows(payload) {
  if (payload.error || ['max_tokens','pause_turn'].includes(payload.stop_reason)) throw new Error('DeepSeek 搜索未完整完成，请重试');
  const blocks = Array.isArray(payload.content)?payload.content:[], results = blocks.filter(x => x.type === 'web_search_tool_result');
  if (!results.length) throw new Error('DeepSeek 未返回真实联网结果块');
  const excerpts = new Map();
  for (const block of blocks) for (const cite of block.citations || []) {
    if (cite.url && cite.cited_text) excerpts.set(cite.url, cite.cited_text);
  }
  const seen = new Set(), rows = [];
  for (const block of results) {
    if (!Array.isArray(block.content)) throw new Error('DeepSeek 联网工具执行失败');
    for (const item of block.content) {
      if (item.type === 'web_search_tool_result_error') throw new Error('DeepSeek 联网工具执行失败');
      if (item.type !== 'web_search_result' || seen.has(item.url)) continue;
      let url; try { url = new URL(item.url); } catch { continue; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      seen.add(item.url);
      rows.push({url:item.url,title:item.title || url.hostname,snippet:excerpts.get(item.url)||'',publisher:url.hostname,publishedAt:item.page_age||''});
    }
  }
  return rows;
}

export async function deepseekMessagesSearch(env, query, options={}) {
  const key = env.DEEPSEEK_API_KEY || env.LLM_API_KEY;
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(), Number(env.DEEPSEEK_WEB_SEARCH_TIMEOUT_MS)||45000);
  try {
    const rental = options.domain === 'rental';
    const scope = rental ? (options.market === 'sale'
      ? '只检索链家、贝壳、房天下、安居客、乐有家的目标城市、具体小区出售房源和小区参考售价。排除出租、旅游、政策、城区均价。'
      : '只检索链家、贝壳、房天下、安居客、乐有家的目标城市、具体小区出租房源。排除买卖、旅游、政策、城区均价。') : '优先检索政府、统计部门和原始发布网页。';
    const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method:'POST', redirect:'error', signal:controller.signal,
      headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:env.DEEPSEEK_WEB_SEARCH_MODEL||env.DEEPSEEK_MODEL||env.LLM_MODEL||'deepseek-v4-flash',max_tokens:4096,
        messages:[{role:'user',content:'Perform a web search for: '+query+'\n只执行一次搜索，不追加检索。'+scope+'返回匹配网页，禁止推测网址或价格。'+(rental?'对命中网页使用真实搜索引用，摘录小区名称、报价和面积；原文没有的字段留空。小区主页也可作为继续取证入口。不得把周边推荐楼盘的价格当作目标小区价格。':'')}],
        tools:[{type:'web_search_20250305',name:'web_search',max_uses:2}]})
    });
    if (!response.ok) throw new Error('DeepSeek 联网请求失败（HTTP '+response.status+'）');
    return deepseekSearchRows(await response.json());
  } finally { clearTimeout(timer); }
}
