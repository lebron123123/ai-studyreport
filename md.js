/* ============================================================
   md.js —— 轻量 Markdown 解析（全站共用）
   为什么要有这个文件：
     以前只有 report.js 里一个简易的 renderContent，只认 [[TABLE]] 和 **加粗**。
     但模型实际输出里经常出现标准 Markdown（## 标题、- 列表、| 表格 |），
     这些内容既在界面上显示成一堆原始符号，导出 Word 时又会被当成普通段落，
     结构全丢。更麻烦的是"界面渲染"和"导出解析"是两套独立代码，很容易改一处漏一处。

   本模块统一产出【结构块】，供三个地方共用同一份解析结果：
     ① 界面渲染   mdRenderHtml()
     ② 导出Word/Excel（office.js 直接用 mdParseBlocks()）
     ③ 导出前预览（复用 ① 的 HTML）

   支持：# 标题 / - * • 无序列表 / 1. 有序列表 / | 表格 | / [[TABLE]] 兼容 /
        > 引用 / --- 分隔线 / **粗** *斜* `代码`
   刻意不支持：图片、超链接跳转、HTML 内嵌——公文场景用不到，且会带来注入风险。
   ============================================================ */
(function(global){

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  /* 行内样式：必须在 HTML 转义之后再套用。
     转义只动 & < >，不影响 * ` 这些标记符，所以顺序安全，
     反过来先套样式再转义会把生成的标签一起转义掉。 */
  function inline(s){
    return esc(s)
      .replace(/`([^`\n]+)`/g, '<code style="background:#F1F3F5; padding:0 4px; border-radius:3px;">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
  }
  // 导出到 Word/Excel 时不要标记符号，只要纯文字
  function stripInline(s){
    return String(s == null ? "" : s)
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  }

  // 一行是不是表格行（含竖线，且不是仅有一个竖线的普通句子）
  function isTableRow(line){
    return line.indexOf("|") >= 0 && line.split("|").length >= 3;
  }
  // 分隔行：|---|---| 或 | :--- | ---: |
  function isTableSep(line){
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }
  function splitRow(line){
    let s = line.trim();
    if(s.startsWith("|")) s = s.slice(1);
    if(s.endsWith("|")) s = s.slice(0,-1);
    return s.split("|").map(c=>stripInline(c.trim()));
  }

  /**
   * 把文本解析成结构块
   * @returns {Array} [{type:"heading",level,text} | {type:"para",text}
   *                  | {type:"list",ordered,items:[]} | {type:"table",rows:[[]]}
   *                  | {type:"quote",text} | {type:"hr"}]
   */
  function mdParseBlocks(text){
    let src = String(text == null ? "" : text);

    // 先把 [[TABLE]] 块换成标准 Markdown 表格，后面按一套逻辑统一处理，
    // 避免两种表格语法各写一遍解析代码
    src = src.replace(/\[\[TABLE\]\]([\s\S]*?)\[\[\/TABLE\]\]/g, function(m, inner){
      const rows = inner.trim().split("\n").map(r=>r.trim()).filter(Boolean);
      if(!rows.length) return "";
      const head = rows[0].split("|").map(c=>c.trim());
      const sep = "|" + head.map(()=>"---").join("|") + "|";
      const body = rows.slice(1).map(r=>"|" + r.split("|").map(c=>c.trim()).join("|") + "|");
      return "\n\n|" + head.join("|") + "|\n" + sep + "\n" + body.join("\n") + "\n\n";
    });

    const lines = src.split("\n");
    const blocks = [];
    let para = [];               // 暂存普通段落行
    const flushPara = ()=>{
      if(para.length){
        const t = para.join("\n").trim();
        if(t) blocks.push({ type:"para", text:t });
        para = [];
      }
    };

    for(let i = 0; i < lines.length; i++){
      const raw = lines[i];
      const line = raw.trim();

      if(!line){ flushPara(); continue; }

      // 分隔线
      if(/^(-{3,}|\*{3,}|_{3,})$/.test(line)){ flushPara(); blocks.push({type:"hr"}); continue; }

      // 标题 # ~ ####
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if(h){ flushPara(); blocks.push({ type:"heading", level: Math.min(h[1].length,4), text: h[2].trim() }); continue; }

      // 表格：当前行像表格行，且下一行是分隔行 → 整块吃进来
      if(isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i+1].trim())){
        flushPara();
        const rows = [splitRow(line)];
        i += 2;   // 跳过表头与分隔行
        while(i < lines.length && isTableRow(lines[i].trim())){
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        i--;      // 回退一行，交还给外层循环
        blocks.push({ type:"table", rows });
        continue;
      }

      // 无序列表（连续多行合成一个列表块）
      if(/^[-*•]\s+/.test(line)){
        flushPara();
        const items = [];
        while(i < lines.length && /^[-*•]\s+/.test(lines[i].trim())){
          items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
          i++;
        }
        i--;
        blocks.push({ type:"list", ordered:false, items });
        continue;
      }

      // 有序列表
      if(/^\d+[.、)]\s+/.test(line)){
        flushPara();
        const items = [];
        while(i < lines.length && /^\d+[.、)]\s+/.test(lines[i].trim())){
          items.push(lines[i].trim().replace(/^\d+[.、)]\s+/, ""));
          i++;
        }
        i--;
        blocks.push({ type:"list", ordered:true, items });
        continue;
      }

      // 引用
      if(/^>\s?/.test(line)){
        flushPara();
        const qs = [];
        while(i < lines.length && /^>\s?/.test(lines[i].trim())){
          qs.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        i--;
        blocks.push({ type:"quote", text: qs.join("\n") });
        continue;
      }

      para.push(raw);
    }
    flushPara();
    return blocks;
  }

  /** 结构块 → 界面 HTML */
  function mdBlocksToHtml(blocks){
    const HSIZE = {1:"17px", 2:"15.5px", 3:"14.5px", 4:"13.8px"};
    return blocks.map(b=>{
      if(b.type === "heading"){
        return '<div style="font-size:'+HSIZE[b.level]+'; font-weight:600; margin:14px 0 6px; color:var(--ink,#1F262B);">'
          + inline(b.text) + '</div>';
      }
      if(b.type === "hr"){
        return '<hr style="border:none; border-top:1px solid var(--line,#DCE6F0); margin:14px 0;">';
      }
      if(b.type === "quote"){
        return '<blockquote style="margin:8px 0; padding:6px 12px; border-left:3px solid var(--line-strong,#B9B29E); background:#FAFBFC; color:var(--ink-soft,#66707A);">'
          + inline(b.text).replace(/\n/g,"<br>") + '</blockquote>';
      }
      if(b.type === "list"){
        const tag = b.ordered ? "ol" : "ul";
        return '<'+tag+' style="margin:6px 0 10px; padding-left:22px;">'
          + b.items.map(it=>'<li style="margin:3px 0;">'+inline(it)+'</li>').join("")
          + '</'+tag+'>';
      }
      if(b.type === "table"){
        let t = '<table class="rpt">';
        b.rows.forEach((r,ri)=>{
          const tg = ri===0 ? "th" : "td";
          t += "<tr>" + r.map(c=>'<'+tg+'>'+esc(c)+'</'+tg+'>').join("") + "</tr>";
        });
        return t + "</table>";
      }
      return '<p style="margin:0 0 10px;">' + inline(b.text).replace(/\n/g,"<br>") + '</p>';
    }).join("");
  }

  /** 文本 → 界面 HTML（一步到位） */
  function mdRenderHtml(text){
    return mdBlocksToHtml(mdParseBlocks(text));
  }

  global.MD = { parseBlocks: mdParseBlocks, blocksToHtml: mdBlocksToHtml,
                renderHtml: mdRenderHtml, stripInline: stripInline };
})(window);
