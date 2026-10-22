(function(root,factory){
  const api=factory(typeof module!=='undefined'&&module.exports?require('./report-completion-contract.js'):root.ReportCompletionContract);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.ReportBusinessStructure=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  const VERSION='business-structure-v2';
  const BASIS_VERSION='business-structure-basis-v4';
  const TABLE_VERSION='business-table-duties-v1';
  function title(value){return C.canonicalHeadingText(String(value||'').replace(/^第[一二三四五六七八九十百\d]+章\s*/,''));}
  function key(value){return title(value).replace(/[\s：:]/g,'');}
  function basisRole(context){return context.basis===true||context.basis!==false&&/依据/.test(String(context.chapterName||'')+' / '+String(context.sectionTitle||''));}
  function structuralHeading(value,context,parents){
    const text=key(value);
    if(parents.has(text))return false;
    // A missing-data notice or a writing-process wrapper is not a business
    // classification. This changes only the extracted structure contract;
    // historical prose and its notices remain untouched for human review.
    if(/^【待补[：:][\s\S]*】$/.test(String(value||'').trim()))return false;
    if(/^(?:本节)?业务问题(?:界定|与论证路径)?$/.test(text)||/^(?:分析路径|分析目的(?:与口径界定)?|交付检查(?:与待补事项)?|已完成章节核查结果归集|评价目的与业务问题界定)$/.test(text)||/^(?:(?:[\u3400-\u9fff]{1,20}的?)?分析框架)(?:与(?:数据口径|业务问题))?$/.test(text))return false;
    // Generic writing slots and the program's unclassified-file bucket are
    // not basis taxonomy. Reusing them would freeze a damaged draft's layout
    // and prevent recovery of this project's accepted policy classification.
    return !basisRole(context)||!/^(?:编制说明|结论|建议|结论与建议|结论及建议|主要结论|主要建议|小结|本节小结|总结|政策解读|适用性分析|核对过程|未登记分类的依据文件|finding|evidence|conditions|decision)$/i.test(text);
  }
  function legacyHeadingSource(source){
    function numbered(value){
      const text=String(value||'').replace(/&nbsp;|&#160;/gi,' ').trim();
      const multi=text.match(/^(\d+(?:[.．]\d+)+)(?:[.．、)]\s*|\s+|(?=[\u3400-\u9fffA-Za-z]))(.+)$/),simple=text.match(/^\d+[.．、)]\s*(.+)$/),chinese=text.match(/^(?:[一二三四五六七八九十百]+、|[（(][一二三四五六七八九十百\d]+[）)])\s*(.+)$/);
      if(!multi&&!simple&&!chinese)return null;
      const label=title(text);
      if(text.length>=100||!/[\u3400-\u9fffA-Za-z]/.test(label)||/[。；;！？!?|<>《》]|\.(?:docx?|pdf|xlsx?|pptx?)\b/i.test(text)||/^(?:万|亿|元|米|平方|公顷|亩|吨|年|个月|个百分点)/.test(label)||/^\d+(?:[.．]\d+)?\s*(?:[万亿]?元|万|亿|米|平方米|公顷|亩|吨|年|个月|个百分点|%|％)\s*$/.test(label))return false;
      return {level:multi?Math.min(6,multi[1].split(/[.．]/).length):/^[（(]/.test(text)?4:3,text:label};
    }
    // Normalize only a complete bold numbered block in this read-only parsing
    // copy. C still excludes table/list ranges and owns canonical hierarchy;
    // neither historical prose nor stored HTML is rewritten.
    let text=String(source||'');
    text=text.replace(/<(p|div)\b([^>]*)>([^<>]*(?:<(b|strong)\b[^>]*>[^<>]*<\/\4>[^<>]*)?)<\/\1>/gi,(all,tag,attrs,body)=>{
      const bold=body.match(/^\s*<(b|strong)\b[^>]*>([^<>]*)<\/\1>\s*$/i),styled=/font-weight\s*:\s*(?:600|700|bold)\b/i.test(attrs),value=body.replace(/<[^>]+>/g,''),heading=numbered(value);
      if(heading===null||!bold&&!styled&&!/<(?:b|strong)\b/i.test(body))return all;
      return heading&&(bold||styled)?'<h'+heading.level+'>'+heading.text+'</h'+heading.level+'>':'\n';
    });
    text=text.replace(/^[ \t]*(?:(\*\*|__)([^\r\n]+)\1|<(b|strong)\b[^>]*>([^<>\r\n]*)<\/\3>)[ \t]*$/gmi,(all,md,value,tag,html)=>{
      const heading=numbered(value||html);
      return heading===null?all:heading?'#'.repeat(heading.level)+' '+heading.text:'';
    });
    return text;
  }
  function migratedEmptyBasisRoots(sources,context){
    const obsolete=new Set(),protectedRoots=new Set();
    if(!basisRole(context))return obsolete;
    // An old root can be superseded only by explicit evidence in the same
    // saved HTML: its sole body is the program's exact empty notice, while a
    // unique nested category with the same label (+ optional basis suffix)
    // already lists files. This changes taxonomy only, never stored prose.
    const category=value=>key(value).replace(/(?:层面)?依据$/,'');
    for(const source of sources){
      const raw=String(source||''),heads=[...raw.matchAll(/<h([3-6])\b[^>]*>([^]*?)<\/h\1>/gi)];
      const rows=heads.map((h,i)=>({level:Number(h[1]),text:title(tableText(h[2])),leaf:!heads[i+1]||Number(heads[i+1][1])<=Number(h[1]),body:raw.slice(h.index+h[0].length,heads[i+1]?.index??raw.length)}));
      const nested=rows.filter(h=>h.level>3&&/依据$/.test(h.text)&&/《[^<>《》]+》/.test(h.body));
      for(const row of rows.filter(h=>h.level===3)){
        if(tableText(row.body)!=='【待补：本分类尚未登记可引用依据文件】'){
          if(tableText(row.body))protectedRoots.add(key(row.text));
          continue;
        }
        if(row.leaf&&nested.filter(h=>category(h.text)===category(row.text)).length===1)obsolete.add(key(row.text));
      }
    }
    for(const label of protectedRoots)obsolete.delete(label);
    return obsolete;
  }
  function outline(source,context,obsolete=new Set()){
    const parents=new Set([key(context.chapterName),key(context.sectionTitle)]);
    const rows=[],stack=[];
    for(const heading of C.headingOutline(legacyHeadingSource(source))){
      while(stack.length&&stack.at(-1).level>=heading.level)stack.pop();
      const keptParents=stack.filter(row=>row.kept),parent=keptParents.at(-1);
      // Collapse only a duplicate along this effective parent/child edge.
      // Identical child titles under different business parents stay distinct.
      const kept=structuralHeading(heading.text,context,parents)&&!(heading.level===3&&obsolete.has(key(heading.text)))&&(!parent||key(parent.text)!==key(heading.text));
      stack.push({...heading,kept});
      if(kept)rows.push({level:Math.min(6,keptParents.length+3),text:heading.text});
    }
    return rows;
  }
  function subset(need,have){
    function paths(rows){
      const stack=[];
      return rows.map(row=>{while(stack.length&&stack.at(-1).level>=row.level)stack.pop();stack.push(row);return JSON.stringify(stack.map(h=>[h.level,key(h.text)]));});
    }
    const required=paths(need);let at=0;
    for(const path of paths(have))if(at<required.length&&path===required[at])at++;
    return at===required.length;
  }
  function publishedOutline(context,obsolete){
    const scenario=context.businessScenario||(context.projectType==='gaibao-commercial'?'commercial_renovation':'housing_conversion'),rows=[],seen=new Set();
    for(const rule of context.rules||[]){
      if(!rule||rule.status&&rule.status!=='published'||rule.projectType&&rule.projectType!==context.projectType&&!(rule.projectType==='gaibao'&&context.projectType==='gaibao-commercial'))continue;
      if(Array.isArray(rule.scenarios)&&!rule.scenarios.includes(scenario))continue;
      if(rule.chapter&&key(rule.chapter)!==key(context.chapterName)||rule.section&&key(rule.section)!==key(context.sectionTitle))continue;
      const sectionNumber=String(rule.section||'').match(/^(\d+(?:[.．]\d+)+)/)?.[1]?.replace(/．/g,'.');
      // Only explicit child titles in published outline metadata are taxonomy.
      // Numbered writing instructions, sample facts and prior project data are not.
      for(const value of [rule.subsection,rule.displayTitle]){
        const match=String(value||'').trim().match(/^(\d+(?:[.．]\d+)+)\s*(.+)$/);
        if(!match||!sectionNumber)continue;
        const number=match[1].replace(/．/g,'.'),text=title(value);
        if(!number.startsWith(sectionNumber+'.')||!text||text.length>100||/[<>\r\n]/.test(text))continue;
        if(!seen.has(number)){seen.add(number);rows.push({number,text});}
        break;
      }
    }
    rows.sort((a,b)=>{
      const x=a.number.split('.').map(Number),y=b.number.split('.').map(Number);
      for(let i=0;i<Math.max(x.length,y.length);i++){if(i>=x.length)return -1;if(i>=y.length)return 1;if(x[i]!==y[i])return x[i]-y[i];}return 0;
    });
    return outline(rows.map(row=>'#'.repeat(Math.min(6,row.number.split('.').length))+' '+row.text).join('\n'),context,obsolete);
  }
  function tree(rows){
    const roots=[],stack=[];
    for(const row of rows){
      while(stack.length&&stack.at(-1).level>=row.level)stack.pop();
      const node={...row,children:[]};(stack.length?stack.at(-1).children:roots).push(node);stack.push(node);
    }
    return roots;
  }
  function merge(primary,supplement){
    function mergeNodes(a,b){
      // Shared sibling anchors constrain insertion; never reorder current
      // nodes (including custom classifications) to conceal a conflict.
      const anchors=new Map(a.map((node,i)=>[key(node.text),i]));let previous=-1;
      for(const incoming of b){
        const index=anchors.get(key(incoming.text));
        if(index===undefined)continue;
        if(index<=previous)throw new Error('业务标题顺序冲突：'+incoming.text+'；须人工核对同父分类顺序，未重排或删除标题');
        previous=index;
      }
      for(let i=0;i<b.length;i++){
        const incoming=b[i],existing=a.find(node=>key(node.text)===key(incoming.text));
        if(existing){mergeNodes(existing.children,incoming.children);continue;}
        const next=b.slice(i+1).find(node=>anchors.has(key(node.text))),position=next?a.findIndex(node=>key(node.text)===key(next.text)):a.length;
        a.splice(position,0,incoming);
      }
    }
    const roots=tree(primary);mergeNodes(roots,tree(supplement));const rows=[];
    function flatten(nodes,level){for(const node of nodes){rows.push({level,text:node.text});flatten(node.children,level+1);}}
    flatten(roots,3);return rows;
  }
  function tableText(value){
    return String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#(x[\da-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim();
  }
  function tableCaption(value,explicit){
    const text=tableText(value).replace(/^#{1,6}\s*/,'').replace(/^表\s*[\d一二三四五六七八九十]+(?:[.．—–\-]\d+)*\s*[：:]?\s*/,'').trim();
    if(text.length<2||text.length>100||!/[\u3400-\u9fffA-Za-z]/.test(text)||/[。；;！？!?|<>]|【待补[：:]/.test(text)||!structuralHeading(text,{basis:false},new Set()))return '';
    return explicit||/(?:表|矩阵|清单)$/.test(text)?text:'';
  }
  function precedingTableCaption(prefix){
    const text=String(prefix||'').replace(/\[\[\s*TABLE\s*\]\]\s*$/i,'').trim();
    // Only an adjacent caption/heading is eligible. Never infer a table title
    // from the section name or from a distant paragraph/previous table.
    const html=text.match(/<(h[1-6]|p|div|figcaption)\b[^>]*>((?:(?!<\/(?:p|div|h[1-6]|table)>)[\s\S])*?)<\/\1>\s*$/i);
    if(html&&!/<\/(?:p|div|h[1-6]|table)>/i.test(html[2]))return tableCaption(html[2],/^h|figcaption/i.test(html[1])||/^\s*<(?:b|strong)\b[^>]*>[^]*<\/(?:b|strong)>\s*$/i.test(html[2]));
    const line=text.split(/\r?\n/).at(-1)||'';
    return tableCaption(line,/^\s*(?:#{1,6}\s|(?:\*\*|__)[^]*?(?:\*\*|__)\s*$)/.test(line));
  }
  function extractTableDuties(source){
    const candidates=[],clean=String(source||'').replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/^\s*(```|~~~)[^\r\n]*\r?\n[^]*?^\s*\1\s*$/gm,'');
    const financial=/(?:财务(?:指标|测算|评价|分析|汇总|结果|报表)|利润(?:表|总额)|现金流|资产负债|还本付息|税金及附加|所得税|增值税|进项税|销项税|内部收益率|折现|投资估算|资金筹措|投资构成|投资计划|资金计划)/i;
    function add(raw,caption){
      if(!caption||/\bdata-report-(?:calc-|program|financial|frozen)/i.test(raw))return;
      const measured=C.measure(raw),rows=measured.tables[0];
      if(measured.malformedTables||measured.tables.length!==1||!rows||rows.length<2||rows[0].length<2)return;
      const headers=rows[0].map(tableText),missing=value=>!value||/^(?:【待补[：:][^]*】|(?:待补(?:充)?|待核验|待确认)(?:[：:（(][^]*)?|未提供|未取得|暂无|无数据|[-—–]+|n\/a|null)$/i.test(value);
      if(headers.some(h=>h.length>100||missing(h)||/^[\d.,%％]+$/.test(h))||new Set(headers).size!==headers.length)return;
      if(/(?:编制依据|依据文件|政策文件|法律法规|技术标准|规范清单)/.test(caption)||headers.some(h=>/^(?:文号|发布机关|发文机关)$/.test(h)))return;
      // Financial data stays with the deterministic financial-table module.
      // Numeric observations in an ordinary location/competitor table do not
      // disqualify its structure; none of those observations leave this parser.
      if(financial.test(caption+' / '+headers.join(' / ')+' / '+rows.slice(1).map(r=>tableText(r[0])).join(' / ')))return;
      const meaningful=rows.slice(1).some(row=>row.map(tableText).filter((v,i)=>!missing(v)&&!(i===0&&/^\d+$/.test(v))).length>=2);
      if(!meaningful)return;
      const role=key(caption);
      candidates.push({title:caption,headers,role,rowCount:rows.length});
    }
    const markdown=clean.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi,(raw,offset)=>{
      const own=raw.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
      add(raw,own?tableCaption(own[1],true):precedingTableCaption(clean.slice(0,offset)));
      return '\n[[BUSINESS_TABLE_BOUNDARY]]\n';
    });
    const lines=markdown.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      if(!lines[i].includes('|')||/<[^>]+>/.test(lines[i]))continue;
      const start=i,block=[];
      while(i<lines.length&&lines[i].includes('|')&&!/<[^>]+>/.test(lines[i]))block.push(lines[i++]);
      add(block.join('\n'),precedingTableCaption(lines.slice(0,start).join('\n')));i--;
    }
    return candidates;
  }
  function tableDuties(options){
    if(!C?.measure||!C?.fingerprint)throw new Error('业务表职责模块须在成稿合同之后加载');
    const context=options||{},duties=[],seen=new Map();
    // Callers supply this section's accepted history, not unrelated projects
    // or pending candidates. Only structure is inherited, never historic facts.
    const sources=[context.currentSource||context.section?.editedHtml||context.section?.content||'',...(context.history||[]).filter(row=>row&&row.accepted!==false&&!['candidate','pending','rejected'].includes(row.status)).map(row=>row.source||row.section?.editedHtml||row.section?.content||'')];
    if(!basisRole(context))for(const source of sources)for(const incoming of extractTableDuties(source)){
      const existing=seen.get(incoming.role);
      if(!existing){seen.set(incoming.role,incoming);duties.push(incoming);}
      else if(JSON.stringify(existing.headers)===JSON.stringify(incoming.headers))existing.rowCount=Math.max(existing.rowCount,incoming.rowCount);
      // A divergent historic schema cannot silently replace the preferred
      // current/first accepted structure or create a duplicate responsibility.
    }
    const tableShapes={tables:duties.length,rows:duties.reduce((n,d)=>n+d.rowCount,0)};
    if(tableShapes.tables>20||tableShapes.rows>300)throw new Error('本节业务表结构超过合同支持范围，须人工核对；未截断表格');
    const requiredTables=duties.map(d=>({title:d.title,headers:[...d.headers],terms:[]}));
    const sourceHash=C.fingerprint({version:TABLE_VERSION,projectType:String(context.projectType||''),businessScenario:String(context.businessScenario||''),chapterName:String(context.chapterName||''),sectionTitle:String(context.sectionTitle||''),duties});
    return {version:TABLE_VERSION,sourceHash,requiredTables,tableShapes,duties};
  }
  function resolve(options){
    if(!C?.headingOutline||!C?.fingerprint)throw new Error('业务结构模块须在成稿合同之后加载');
    const context=options||{},accepted=(context.history||[]).filter(row=>row&&row.accepted!==false&&!['candidate','pending','rejected'].includes(row.status)),obsolete=migratedEmptyBasisRoots([context.currentSource||'',...accepted.map(row=>row.source||'')],context),current=outline(context.currentSource||'',context,obsolete);
    const histories=accepted.map(row=>({id:String(row.id||''),headings:outline(row.source||'',context,obsolete)}));
    let recovered=current;
    // Recover only a compatible superset, never a divergent historical branch.
    // A partial current outline cannot erase an accepted, richer classification.
    for(const history of histories)if(history.headings.length>recovered.length&&subset(recovered,history.headings))recovered=merge(recovered,history.headings);
    const published=publishedOutline(context,obsolete);
    let requiredHeadings=!recovered.length?published:merge(recovered,published);
    if(requiredHeadings.length>60||requiredHeadings.some(h=>h.level>6))throw new Error('本节业务结构超过合同支持范围，须人工核对；未截断分类');
    requiredHeadings=requiredHeadings.map(h=>({level:h.level,text:h.text}));
    // Same resolved taxonomy keeps its identity across saves. Body facts and
    // unrelated historical version IDs cannot churn a structure-only contract.
    const sourceHash=C.fingerprint({version:VERSION,...(basisRole(context)?{basisPolicyVersion:BASIS_VERSION}:{}),projectType:String(context.projectType||''),businessScenario:String(context.businessScenario||''),chapterName:String(context.chapterName||''),sectionTitle:String(context.sectionTitle||''),published,requiredHeadings});
    return {version:VERSION,sourceHash,requiredHeadings};
  }
  return {VERSION,BASIS_VERSION,TABLE_VERSION,resolve,tableDuties};
});
