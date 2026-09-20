/* 可研正文展示规范；不改写原始资料和溯源档案。浏览器与 Word 共用。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReportOutputPolicy=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  function cleanText(value){
    return String(value==null?'':value)
      .replace(/[（(]\s*(?:数据来源|资料来源|来源)\s*[：:][^（）()]*[）)]/g,'')
      .replace(/^\s*(?:数据来源|资料来源|来源)\s*[：:].*$/gm,'').trim();
  }
  // 仅恢复明确标记的表。缺少结束标记时在注释、标题或下一正文段之前停止。
  function tableBlocks(value){
    const lines=cleanText(value).replace(/\r\n?/g,'\n').replace(/(\[\[\s*\/?TABLE\s*\]\])/gi,'\n$1\n').split('\n'),out=[];
    let rows=null;
    function flush(){if(rows){if(rows.length)out.push({type:'table',rows});else out.push({type:'p',text:'【待补：表格内容未返回，请补充】'});rows=null;}}
    for(const raw of lines){
      const line=raw.trim();
      if(/^\[\[\s*TABLE\s*\]\]$/i.test(line)){flush();rows=[];continue;}
      if(/^\[\[\s*\/TABLE\s*\]\]$/i.test(line)){flush();continue;}
      if(rows!==null){
        if(!line)continue;
        const previous=rows[rows.length-1],tail=previous?.[previous.length-1]||'';
        if(previous&&(tail.match(/[（(]/g)||[]).length>(tail.match(/[）)]/g)||[]).length&&!/^(?:注|说明|#)\s*[：:]?/.test(line)){
          previous[previous.length-1]+=line.replace(/\|$/,'');continue;
        }
        if(line.includes('|')&&!/^(?:注|说明)\s*[：:]/.test(line)){
          if(/^\|?[\s:|-]+\|?$/.test(line))continue;
          const cells=line.replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
          rows.push(cells);continue;
        }
        flush();
      }
      if(line)out.push({type:'p',text:line});
    }
    flush();return out;
  }
  function normalize(value){
    const text=cleanText(value);
    if(!/\[\[\s*\/?TABLE\s*\]\]/i.test(text))return text;
    return tableBlocks(text).map(b=>b.type==='table'
      ?'\n|'+b.rows[0].join('|')+'|\n|'+b.rows[0].map(()=> '---').join('|')+'|\n'+b.rows.slice(1).map(r=>'|'+r.join('|')+'|').join('\n')+'\n'
      :b.text).join('\n');
  }
  function repairBlocks(blocks){
    const out=[];let pending=[];
    function flush(){
      if(!pending.length)return;
      const text=pending.map(b=>b.text||'').join('\n');
      out.push(...(/\[\[\s*\/?TABLE\s*\]\]/i.test(text)?tableBlocks(text):pending));pending=[];
    }
    for(const block of blocks||[]){if(block.type==='p')pending.push(block);else{flush();out.push(block);}}
    flush();return out;
  }
  const prompt='\n【通用成稿要求】全文（不含附件）上限120页，目标远低于上限。每节通常200—400字，复杂测算或必要表格可增加；简单事项一句说清。先结论后必要事实，不铺陈常识、不重复其他章节和表中数字，不通过删减关键风险、数值、假设来压缩。正文不输出“来源：”“数据来源：”及来源括注，不生成来源附件；依据记录由系统后台保留。缺失事实统一写【待补：具体内容】，禁止编造。表格起止标记必须配对，每行完整输出，不把表名放进单元格。';
  const basisPrompt='\n【依据类章节统一例外】所有项目的编制依据、政策依据、法规依据、项目专属依据及其下级小节，只输出简洁的编号文件清单：文件名称＋已核实的文号、发布机关、发布日期（有则列，无则不编造）；项目材料可列实际文件名称及形成单位。保留必要的政策文件出处，这不属于应删除的正文“来源：”赘述。不得展开政策内容解读、适用性分析、项目情况对照、合规结论、核对过程或重复待补说明；不得为凑篇幅增加导语和小结。确有必要但尚不能确认的依据仅列一条【待补：具体依据文件】，不猜测名称、文号或效力。此要求优先于依据类小节原有的论证、深度和字数要求；其他章节的必要分析不受影响。';
  // Content policy version, not a rendering version: changing colors must not
  // create paid AI work. Legacy bodies have no receipt and need one review.
  const contentVersion='20260910-concise-basis-v1';
  function needsContentReview(section){return !!(section&&(section.content||section.editedHtml)&&section.outputPolicyVersion!==contentVersion);}
  return {cleanText,tableBlocks,normalize,repairBlocks,prompt:prompt+basisPrompt,maxPages:120,contentVersion,needsContentReview};
});
