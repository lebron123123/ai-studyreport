/* 可研正文展示规范；不改写原始资料和溯源档案。浏览器与 Word 共用。 */
(function(root,factory){
  const api=factory(root,typeof module==='object'&&module.exports?require('./md.js'):null);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReportOutputPolicy=api;
})(typeof window!=='undefined'?window:globalThis,function(root,nodeMD){
  function cleanText(value){
    return String(value==null?'':value)
      .replace(/[（(]\s*(?:数据来源|资料来源|来源)\s*[：:][^（）()]*[）)]/g,'')
      .replace(/^\s*(?:数据来源|资料来源|来源)\s*[：:].*$/gm,'').trim();
  }
  // 仅恢复明确标记的表。缺少结束标记时在注释、标题或下一正文段之前停止。
  function tableBlocks(value){
    const lines=cleanText(value).replace(/\r\n?/g,'\n').replace(/(\[\[\s*\/?TABLE\s*\]\])/gi,'\n$1\n').split('\n'),out=[];
    let rows=null;
    const parser=()=>root.MD?.parseTableRows||nodeMD?.parseTableRows;
    function flush(){if(rows){
      if(rows.length){
        const parse=parser();
        if(parse){
          const block=parse(rows);
          // Word's legacy block consumer reads rows; source values and raw pipe
          // positions remain separately available for audit and normalization.
          out.push({...block,sourceRows:block.rows,rows:block.displayRows||block.rows,rawRows:rows.slice()});
        }else{
          out.push({type:'p',text:'【待补：表格解析组件未就绪，已保护原表文本，请重新加载后核对】'});
          out.push({type:'p',text:'[[TABLE]]\n'+rows.join('\n')+'\n[[/TABLE]]'});
        }
      }else out.push({type:'p',text:'【待补：表格内容未返回，请补充】'});
      rows=null;
    }}
    for(const raw of lines){
      const line=raw.trim();
      if(/^\[\[\s*TABLE\s*\]\]$/i.test(line)){flush();rows=[];continue;}
      if(/^\[\[\s*\/TABLE\s*\]\]$/i.test(line)){flush();continue;}
      if(rows!==null){
        if(!line)continue;
        // Historical drafts sometimes put the caption inside TABLE, before its header.
        if(!rows.length&&!line.includes('|')&&/^(?:\*\*)?表\s*[\d一二三四五六七八九十]+/.test(line)){out.push({type:'p',text:line});continue;}
        const previous=rows[rows.length-1],parse=parser();
        const previousBlock=rows.length>1&&parse?parse([rows[0],previous]):null;
        const tail=previousBlock&&!previousBlock.structureIssues.length?previousBlock.rows[1].at(-1):'';
        if(previous&&tail&&!line.includes('|')&&(tail.match(/[（(]/g)||[]).length>(tail.match(/[）)]/g)||[]).length&&!/^(?:注|说明|#)\s*[：:]?/.test(line)){
          const framedRight=previousBlock.structureRepairs.some(x=>x.code==='table-edge-delimiters'&&x.right);
          rows[rows.length-1]=framedRight?previous.replace(/\|\s*$/,line+'|'):previous+line;
          continue;
        }
        if(line.includes('|')&&!/^(?:注|说明)\s*[：:]/.test(line)){
          if(/-{2,}/.test(line)&&/^\|?[\s:|-]+\|?$/.test(line))continue;
          rows.push(line);continue;
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
      ?'\n'+b.rawRows[0]+'\n'+b.rows[0].map(()=> '---').join('|')+'\n'+b.rawRows.slice(1).join('\n')+'\n'
      :b.text).join('\n');
  }
  function repairBlocks(blocks){
    const out=[];let pending=[];
    function flush(){
      if(!pending.length)return;
      const text=pending.map(b=>b.text||'').join('\n');
      const repaired=/\[\[\s*\/?TABLE\s*\]\]/i.test(text)?tableBlocks(text):pending;
      for(const block of repaired){
        if(block.structureIssues?.length)out.push({type:'p',text:'【待补：表格列位不明确，已保留原值和分隔位置，须人工核对后采用】'});
        out.push(block);
      }
      pending=[];
    }
    for(const block of blocks||[]){if(block.type==='p')pending.push(block);else{flush();out.push(block);}}
    flush();return out;
  }
  const prompt='\n【通用成稿要求】全文（不含附件）按用户确认的篇幅计划组织，默认目标120页、正文75000字。预计页数仅供规划，字数不能保证实际达到目标，不为凑页数扩写。正文应详实解释项目差异、比较依据、因果、测算驱动、方案条件与风险，不把有效分析压成一两句摘要。篇幅按本节预算和论证职责安排，不对所有小节统一字数；简单事项一句说清。先结论后必要事实，不铺陈常识、不重复其他章节和表中数字，不通过删减业务标题、关键风险、数值、假设来压缩。目标字数及页数不证明专业质量，缺数据仍须待补。正文不输出“来源：”“数据来源：”及来源括注，不生成来源附件；依据记录由系统后台保留。缺失事实统一写【待补：具体内容】，禁止编造。表格起止标记必须配对，每行完整输出，表名放在TABLE起止标记之外。';
  const basisPrompt='\n【依据类章节统一例外】所有项目的编制依据、政策依据、法规依据、项目专属依据及其下级小节，只输出简洁的编号文件清单：文件名称＋已核实的文号、发布机关、发布日期（有则列，无则不编造）；项目材料可列实际文件名称及形成单位。保留必要的政策文件出处，这不属于应删除的正文“来源：”赘述。不得展开政策内容解读、适用性分析、项目情况对照、合规结论、核对过程或重复待补说明；不得为凑篇幅增加导语和小结。确有必要但尚不能确认的依据仅列一条【待补：具体依据文件】，不猜测名称、文号或效力。此要求优先于依据类小节原有的论证、深度和字数要求；其他章节的必要分析不受影响。';
  // Content policy version, not a rendering version: changing colors must not
  // create paid AI work. Legacy bodies have no receipt and need one review.
  const contentVersion='20260930-configurable-writing-v1';
  // A planning budget, never a substring cut or a promise of physical page count.
  function sectionPlan(chapters,options){
    const api=root.ReportCompletionContract||(typeof module==='object'&&module.exports&&typeof require==='function'?require('./report-completion-contract.js'):null);
    if(!api?.proseBudgetPlan)throw new Error('统一篇幅计划模块未加载；未退回旧精简预算，请刷新后重试');
    return api.proseBudgetPlan(chapters,options);
  }
  function sectionPrompt(chapters,c,s,options){
    const row=sectionPlan(chapters,options).find(r=>r.chapter===c&&r.section===s);
    if(!row)return '';
    return '\n【本节标准化篇幅预算（优先于参考范例的扩写要求）】已绑定成稿合同时，以该合同的正文及表格预算为唯一数值标准；无合同时正文目标约'+row.target+'字（不含表格），使用统一详实成稿计划。目标不是最低字数，不预先按比例缩减。'+(row.basis?'只列已核实依据文件，不扩写分析。':'用必要事实、比较、因果、论证和结论回答本节问题；不把有效分析归并为一两句摘要。仅删除通用背景和重复铺陈，不逐点复述表内数据。')+'业务标题、必要表格、关键风险、假设、单位和事实不得为达字数而删除；正文与槽字数警戒仅供人工核对，不机械返修或截断，依据、事实、结构、表格约束仍须严格保留。全篇按同一章节体系、字体和版式输出，所选页数目标仍须实际排版核验，字数不等于页数，也不证明专业质量。'
      +'\n【材料与篇幅解耦】上传材料是证据库，不是待全文转写的正文。材料数量、长度或参考报告页数不增加本节预算。仅引用本节决策需要的事实；同一事实集中在负责章节或表格，其他章节仅概括结论及必要条件，不复制整段。表中已有数据不逐行复述。没有资料时明确缺口，不用大段常识填充。不得复制材料或范例的目录、历史项目事实和写作指令。'
      +'\n【事实一致性】区分上传材料记载、协议草稿约定和当前测算假设，不将草稿当作已签约事实。面积、套数、运营期限、合作模式或收益分配冲突时，并列列明差异及待确认事项，不擅自选择口径，不给出无条件可行结论。宣布“未提供”前须核对本次可用材料；仅当前检索未命中时写“本节证据尚未核实”，不能断言用户未上传。'
      +'\n【全篇职责目录】'+(chapters||[]).filter(ch=>ch.checked!==false).map(ch=>ch.name+'：'+(ch.sections||[]).map(sec=>sec.t||sec.title).join('、')).join('；')+'。只展开当前小节职责，不提前完整撰写其他小节。';
  }
  // Diagnostics, never edits. Exact paragraph repetition is an explainable lower bound,
  // not a semantic duplication score or a physical page estimate.
  function reviewSections(entries){
    const seen=new Map();
    return (entries||[]).map(entry=>{
      const text=String(entry.text||''),paragraphs=text.split(/\n+/).map(p=>p.trim()).filter(Boolean),duplicates=[];
      for(const p of paragraphs){const key=p.replace(/\s+/g,'');if(key.length<60)continue;
        if(seen.has(key))duplicates.push({with:seen.get(key),characters:key.length});else seen.set(key,entry.id);
      }
      const characters=text.replace(/\s/g,'').length,target=Number(entry.target)||0;
      return {id:entry.id,characters,target,overBudget:target>0&&characters>target*1.5,duplicates,empty:!characters&&!entry.tables};
    });
  }
  function needsContentReview(section){return !!(section&&(section.content||section.editedHtml)&&section.outputPolicyVersion!==contentVersion);}
  return {cleanText,tableBlocks,normalize,repairBlocks,prompt:prompt+basisPrompt,maxPages:120,contentVersion,needsContentReview,sectionPlan,sectionPrompt,reviewSections};
});
