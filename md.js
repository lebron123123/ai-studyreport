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
   不支持图片、超链接跳转及任意 HTML；仅允许成稿合同严验的独立表格块。
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

  // The decoder appends this fixed, text-only notice group to Markdown.
  // Preserve its boundary identity without admitting arbitrary HTML, attributes,
  // nested markup or a lookalike wrapper. Recheck it when rendering parsed blocks.
  function programGapHtml(value){
    const text=String(value||'');
    return /^<div class="report-gap-boundaries"><p><strong>资料核验边界（未定位到具体主题）<\/strong><\/p>(?:<p>[^<>\r\n\u0000-\u001f]+<\/p>)+<\/div>$/.test(text)?text:null;
  }

  // 一行是不是表格行（含竖线，且不是仅有一个竖线的普通句子）
  function isTableRow(line){
    return splitRow(line).length >= 2 || /^\|(?:\s*\|)+$/.test(line.trim());
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

  // The header establishes the column count. Edge pipes in data rows may be
  // actual empty cells (not framing), so remove them only when there is exactly
  // one possible alignment to that count. Ambiguous/short rows stay untouched.
  function tableBlock(rawRows){
    const header=splitRow(rawRows[0]),width=header.length,sourceRows=[header],repairs=[],issues=[];
    rawRows.slice(1).forEach((line,index)=>{
      const raw=line.trim(),parts=raw.split('|').map(c=>stripInline(c.trim())),candidates=[];
      for(const left of [0,1])for(const right of [0,1]){
        if((left&&!raw.startsWith('|'))||(right&&!raw.endsWith('|')))continue;
        const cells=parts.slice(left,parts.length-right);
        if(cells.length===width&&!candidates.some(c=>JSON.stringify(c.cells)===JSON.stringify(cells)))candidates.push({cells,left,right});
      }
      if(candidates.length!==1){
        sourceRows.push(parts);
        issues.push({code:candidates.length?'ambiguous-cell-alignment':'table-column-count',row:index+2,expectedColumns:width,sourceColumns:parts.length,original:line,message:'原表列位不明确，保留原值和分隔位置，须人工核对'});
        return;
      }
      const chosen=candidates[0];sourceRows.push(chosen.cells);
      // Record normalization, including accepted mixed edge framing, separately
      // from original empty values. No non-empty value is inserted or removed.
      if(chosen.left||chosen.right)repairs.push({code:'table-edge-delimiters',row:index+2,left:chosen.left,right:chosen.right,original:line});
    });
    const rows=sourceRows.map((cells,ri)=>cells.map((value,ci)=>{
      if(ri===0||value!==''||cells.length!==width||issues.some(x=>x.row===ri+1))return value;
      const label=header[ci]||('第'+(ci+1)+'列');
      repairs.push({code:'explicit-empty-cell',row:ri+1,column:ci+1,header:label,original:''});
      return '【待补：'+label+'（原表空白，待核对）】';
    }));
    return {type:'table',rows:sourceRows,displayRows:rows,structureRepairs:repairs,structureIssues:issues};
  }

  /**
   * 把文本解析成结构块
   * @returns {Array} [{type:"heading",level,text} | {type:"para",text}
   *                  | {type:"list",ordered,items:[]} | {type:"table",rows:[[]]}
   *                  | {type:"quote",text} | {type:"hr"}]
   */
  function mdParseBlocks(text){
    let src = String(text == null ? "" : text);

    // Both syntaxes share tableBlock. Do not round-trip TABLE rows through
    // artificial edge pipes: doing so loses legitimate first/last empty cells.
    const tableTokens=new Map();let tablePrefix='\u0001MD_TABLE_';
    while(src.includes(tablePrefix))tablePrefix+='X';
    src = src.replace(/\r\n?/g,'\n').replace(/\[\[\s*TABLE\s*\]\]([\s\S]*?)(?:\[\[\s*\/TABLE\s*\]\]|(?=\[\[\s*TABLE\s*\]\])|$)/gi, function(m, inner){
      const lines=inner.trim().split('\n'),rows=[],captions=[];let end=0;
      for(;end<lines.length;end++){
        const line=lines[end].trim();
        if(!line)continue;
        if(!rows.length&&!line.includes('|')&&/^(?:\*\*)?表\s*[\d一二三四五六七八九十]+/.test(line)){captions.push(line);continue;}
        if(!isTableRow(line)||/^(?:注|说明)\s*[：:]/.test(line))break;
        if(!isTableSep(line))rows.push(line);
      }
      const rest=lines.slice(end).join('\n');
      if(!rows.length)return '\n'+captions.join('\n')+'\n【待补：表格内容未返回，请补充】\n'+rest;
      const key=tablePrefix+tableTokens.size+'\u0002';tableTokens.set(key,tableBlock(rows));
      return '\n\n'+captions.join('\n')+'\n\n'+key+'\n\n'+rest;
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
    const pushTable=block=>{
      if(block.structureIssues?.length)blocks.push({type:'para',text:'【待补：表格列位不明确（第'+block.structureIssues.map(x=>x.row).join('、')+'行），原值按原序保留，请核对后再采用】'});
      blocks.push(block);
    };

    for(let i = 0; i < lines.length; i++){
      const raw = lines[i];
      const line = raw.trim();

      if(!line){ flushPara(); continue; }
      if(tableTokens.has(line)){flushPara();pushTable(tableTokens.get(line));continue;}

      const gapHtml=programGapHtml(line);
      if(gapHtml){
        flushPara();blocks.push({type:'para',text:gapHtml.replace(/<\/p>/g,'\n').replace(/<[^>]*>/g,''),programGapHtml:gapHtml});continue;
      }

      // Only the program's exact, inert table-reference markup is supported.
      // Arbitrary HTML (including lookalike references) remains escaped text.
      if(/^<p\b/.test(line)&&global.ReportCompletionContract?.safeDocumentReferenceHtml){
        try{
          const referenceHtml=global.ReportCompletionContract.safeDocumentReferenceHtml(line);
          const text=referenceHtml.replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
          flushPara();blocks.push({type:'para',text,referenceHtml});continue;
        }catch(_){ /* Preserve invalid source as escaped text. */ }
      }

      // Frozen source tables are reinserted by the completion decoder, never rewritten
      // by the model. Keep their exact HTML (including merged cells) for report export.
      // Missing validator or unsafe markup fails closed to ordinary escaped text.
      if(/^<table\b/i.test(line) && global.ReportCompletionContract?.safeFrozenTableHtml){
        let end=i;
        while(end<lines.length&&!/<\/table>\s*$/i.test(lines[end]))end++;
        if(end<lines.length){
          try{
            const html=global.ReportCompletionContract.safeFrozenTableHtml(lines.slice(i,end+1).join('\n'));
            const cellText=s=>s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/&amp;/gi,'&');
            const rows=Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),r=>Array.from(r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),c=>cellText(c[1])));
            flushPara();blocks.push({type:'table',rows,frozenHtml:html});i=end;continue;
          }catch(_){ /* Unsafe blocks remain escaped; never silently sanitize data. */ }
        }
      }

      // 分隔线
      if(/^(-{3,}|\*{3,}|_{3,})$/.test(line)){ flushPara(); blocks.push({type:"hr"}); continue; }

      // 标题 # ~ ####
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if(h){ flushPara(); blocks.push({ type:"heading", level: Math.min(h[1].length,6), text: h[2].trim() }); continue; }

      // 表格：当前行像表格行，且下一行是分隔行 → 整块吃进来
      if(isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i+1].trim())){
        flushPara();
        const rows = [line];
        i += 2;   // 跳过表头与分隔行
        while(i < lines.length && isTableRow(lines[i].trim())){
          rows.push(lines[i].trim());
          i++;
        }
        i--;      // 回退一行，交还给外层循环
        pushTable(tableBlock(rows));
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
    const HSIZE = {1:"17px", 2:"15.5px", 3:"14.5px", 4:"13.8px",5:"13.5px",6:"13.2px"};
    return blocks.map(b=>{
      if(b.programGapHtml)return programGapHtml(b.programGapHtml)||'<p>'+esc(b.programGapHtml)+'</p>';
      if(b.referenceHtml){
        try{return global.ReportCompletionContract.safeDocumentReferenceHtml(b.referenceHtml);}catch(_){return '<p>'+esc(b.referenceHtml)+'</p>';}
      }
      if(b.type === "heading"){
        return '<div data-report-heading-level="'+b.level+'" style="font-size:'+HSIZE[b.level]+'; font-weight:600; margin:14px 0 6px; color:var(--ink,#1F262B);">'
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
        if(b.frozenHtml){
          try{return global.ReportCompletionContract.safeFrozenTableHtml(b.frozenHtml);}catch(_){return '<p>'+esc(b.frozenHtml)+'</p>';}
        }
        let t = '<table class="rpt">';
        (b.displayRows||b.rows).forEach((r,ri)=>{
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

  const api = { parseBlocks: mdParseBlocks, blocksToHtml: mdBlocksToHtml,
                renderHtml: mdRenderHtml, stripInline: stripInline, parseTableRows: tableBlock };
  if(typeof module==='object'&&module.exports)module.exports=api;
  else global.MD=api;
})(typeof window!=='undefined'?window:globalThis);
