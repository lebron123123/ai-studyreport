/* Working-draft presentation only. Never rewrite a frozen delivery snapshot. */
(function(root){
  'use strict';
  const key=s=>String(s||'').replace(/[\s\u3000（）()㎡²·、，。:：]/g,'').toLowerCase();
  const title=s=>key(String(s||'').replace(/．/g,'.').replace(/^\s*(?:第[一二三四五六七八九十\d]+章|[（(][一二三四五六七八九十\d]+[）)]|[一二三四五六七八九十]+[、.]|\d+(?:\s*\.\s*\d+)*[.、]?)\s*/,''));
  function header(s){
    const k=key(s);
    const aliases=[['交通配套','周边交通条件'],['项目面积','建筑面积m2','建筑面积m','建筑面积'],['套数','套数套'],['房型','户型构成'],['比较权重','权重'],['交通配套修正','交通修正'],['外部环境修正','环境修正'],['新旧程度修正','新旧修正'],['装修家私修正'],['指标名称','指标','财务指标'],['测算值','数值'],['约定内容','核心内容'],['工作内容','主要工作内容'],['里程碑','里程碑节点'],['项目名称','竞品项目','小区名称'],['距离','与本项目距离km'],['租金','租金元㎡月'],['客群类型','客群层级'],['来源区域/单位','主要来源'],['偏好户型','户型需求'],['支付能力','月租金承受力'],['计算单方成本元/㎡','单方成本元/㎡']];
    for(const a of aliases)if(a.map(key).includes(k))return key(a[0]);
    return k;
  }
  // A concrete missing-evidence request is report content, not an empty value.
  // Keep it in the main table/difference register until a reviewer resolves it.
  const missing=s=>!String(s||'').trim()||/^(?:待填|待补|暂无|—|-|【待补\s*[:：]?\s*】)$/.test(String(s).trim());
  const supplementSelector='[data-report-supplement]';
  const valueKey=value=>{
    const text=String(value||'').trim().replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/g,'');
    return /^-?\d+(?:\.\d+)?$/.test(text)?String(Number(text)):key(text);
  };
  // Financial summaries repeat the same metric with units in either its label,
  // unit column or value. Only explicit, unambiguous units are propagated; no
  // currency conversion or assumption about an unstated accounting basis occurs.
  function normalizeFinancialRows(raw,entries,conflicts){
    const records=[],unitOptions=new Map(),scopeOptions=new Map(),notes=new Map();
    const unitKey=s=>missing(s)?'':String(s||'').trim().replace(/％/g,'%');
    const aliases={'全投资内部收益率IRR':'全投资内部收益率','累计净现值NPV':'累计净现值','净利润合计':'净利润','全周期总成本费用':'总成本费用','税金及附加合计':'税金及附加'};
    const noteHeader=h=>/^(备注|说明|口径说明)$/.test(h);
    const addOption=(map,k,v)=>{if(v){if(!map.has(k))map.set(k,new Set());map.get(k).add(v);}};
    const scopeOf=note=>[
      (note.match(/\d{4}\s*[—–~至-]\s*\d{4}年?/g)||[]).map(s=>s.replace(/\s|年/g,'').replace(/[—–~至]/g,'-')).sort().join('|'),
      (note.match(/不含税|含税|税前|税后/g)||[]).sort().join('|'),
      (note.match(/不含建设期|含建设期|不含改造期|含改造期/g)||[]).sort().join('|')
    ];
    raw.forEach(({node,index})=>{
      node.rows[0].cells[0].textContent='指标名称';
      let heads=Array.from(node.rows[0].cells).map(c=>c.textContent.trim()),unit=heads.indexOf('单位');
      if(unit<0){unit=heads.length;Array.from(node.rows).forEach((r,i)=>r.insertCell().textContent=i?'':'单位');heads.push('单位');}
      const value=heads.findIndex(h=>header(h)===header('测算值'));
      Array.from(node.rows).slice(1).forEach(row=>{
        const label=row.cells[0].textContent.trim(),labelUnit=label.match(/[（(](万元|亿元|元|年|%|％)[）)]/);
        let clean=label.replace(/[（(](?:万元|亿元|元|年|%|％|NPV|IRR)[）)]/gi,'');
        clean=aliases[clean]||clean;if(/^IRR$/i.test(clean))clean='内部收益率';if(/^NPV$/i.test(clean))clean='净现值';
        row.cells[0].textContent=clean;
        const annotations=heads.map((h,j)=>noteHeader(h)&&!missing(row.cells[j].textContent)?[h,row.cells[j].textContent.trim()]:null).filter(Boolean);
        const original=value<0?'':row.cells[value].textContent.trim();
        const numeric=original.match(/^([+-]?\d[\d,，]*(?:\.\d+)?)(万元|亿元|元|年|%|％)?\s*([（(].*[）)])?$/);
        const explicit=[unitKey(row.cells[unit].textContent),unitKey(labelUnit?.[1]),unitKey(numeric?.[2])].filter(Boolean);
        const unique=Array.from(new Set(explicit));
        if(unique.length>1){
          conflicts.push([entries[index].context.number,clean,'单位',unique[0],unique.slice(1).join(' / ')+'（原值：'+original+'）']);
          row.cells[unit].textContent=unique.join(' / ')+'（待核对）';
        }else{
          row.cells[unit].textContent=unique[0]||(/内部收益率/.test(clean)?'%':'');
          if(numeric){row.cells[value].textContent=numeric[1];if(numeric[3])annotations.push(['数值附注',numeric[3]]);}
        }
        const scope=scopeOf(annotations.map(a=>a[1]).join('；'));
        const metric=key(clean),record={row,index,heads,unit,metric,annotations,scope};records.push(record);
        addOption(unitOptions,metric,row.cells[unit].textContent);
        scope.forEach((v,j)=>addOption(scopeOptions,metric+'|'+j,v));
      });
    });
    records.forEach(record=>{
      const {row,index,unit,metric,annotations}=record,options=unitOptions.get(metric);
      if(!row.cells[unit].textContent&&options?.size===1)row.cells[unit].textContent=Array.from(options)[0];
      const scope=record.scope.map((v,j)=>v||(scopeOptions.get(metric+'|'+j)?.size===1?Array.from(scopeOptions.get(metric+'|'+j))[0]:''));
      row.dataset.reportFinancialScope=JSON.stringify(scope);
      const object=row.cells[0].textContent+(row.cells[unit].textContent?'（'+row.cells[unit].textContent+'）':''),identity=JSON.stringify([metric,row.cells[unit].textContent,scope]);
      if(!notes.has(identity))notes.set(identity,{object,items:new Map(),facts:new Map()});
      const group=notes.get(identity);
      annotations.forEach(([field,text])=>{
        // Equivalent punctuation/full-cycle labels need one explanation, while
        // every different source statement remains explicitly attributed.
        const k=key(text).replace(/^全周期(?:口径|合计)?$/,'全周期');
        if(!group.items.has(k))group.items.set(k,{field,text,sources:new Set()});
        group.items.get(k).sources.add(entries[index].context.number);
        for(const match of text.matchAll(/(折现率|基准收益率|回正金额)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*(%|％|万元|元)/g)){
          const fact=match[1]+'|'+unitKey(match[3]),amount=valueKey(match[2]);
          if(group.facts.has(fact)&&group.facts.get(fact)!==amount)conflicts.push([entries[index].context.number,object,match[1],group.facts.get(fact)+unitKey(match[3]),match[2]+unitKey(match[3])]);
          else group.facts.set(fact,amount);
        }
      });
    });
    // Remarks are evidence, not part of a metric's identity or a second value.
    // Move them together to the attributed difference register before union.
    raw.forEach(({node})=>{for(let j=node.rows[0].cells.length-1;j>=0;j--)if(noteHeader(node.rows[0].cells[j].textContent.trim()))Array.from(node.rows).forEach(r=>r.deleteCell(j));});
    return Array.from(notes.values()).filter(g=>g.items.size).map(g=>[g.object,Array.from(g.items.values()).map(n=>'第'+Array.from(n.sources).join('、')+'节 · '+n.field+'：'+n.text).join('；')]);
  }
  function financialValueKey(value,unit){
    const text=String(value||'').trim().replace(/％/g,'%');
    // A target of ≥5% and ≥5 in a percent row is identical, not a conflict.
    return valueKey(unit&&text.endsWith(unit)?text.slice(0,-unit.length):text);
  }
  const rectangular=table=>Array.from(table.rows).every(row=>row.cells.length===table.rows[0]?.cells.length&&Array.from(row.cells).every(cell=>cell.colSpan===1&&cell.rowSpan===1));
  const unambiguousHeaders=table=>{const headers=Array.from(table.rows[0]?.cells||[]).map(c=>header(c.textContent));return headers.length===new Set(headers).size;};
  function sourceCaption(node){
    if(node.dataset.reportSourceCaption)return node.dataset.reportSourceCaption;
    const previous=node.previousElementSibling,text=previous?.textContent.trim()||'';
    return previous&&text.length<140&&(previous.classList.contains('rpt-table-caption')||/^表\s*\d/.test(text)||/表$/.test(text))?text:'';
  }
  function tableScope(node){
    if(node.dataset.reportTableScope)return node.dataset.reportTableScope;
    const tables=node.tagName==='TABLE'?[node]:Array.from(node.querySelectorAll('table'));
    const caption=sourceCaption(node);
    // Units, periods and accounting bases are part of identity, not decoration.
    const qualifiers=caption.match(/不含税|含税|税前|税后|改造前|改造后|月度|年度|\d{4}(?:[年./-]\d{1,2})?(?:[月./-]\d{1,2})?/g)||[];
    const units=tables.flatMap(table=>Array.from(table.rows[0]?.cells||[]).flatMap(cell=>cell.textContent.match(/万元|亿元|元(?:\s*[\/／]\s*[^）)\s]+)?|㎡|m[²2]|平方米|%|％|百分比|套|间|个月|年/g)||[]));
    return JSON.stringify([node.dataset.reportScope||'',node.dataset.period||'',qualifiers.sort(),units.sort()]);
  }
  function addSupplement(box,caption,headers,rows,kind){
    if(!rows.length)return;
    const signature=JSON.stringify([caption,headers,rows]);
    if(Array.from(box.querySelectorAll(supplementSelector)).some(el=>el.dataset.reportDifferenceKey===signature))return;
    const wrap=box.ownerDocument.createElement('div');wrap.dataset.reportSupplement='true';
    wrap.dataset.reportDifferenceKey=signature;
    if(kind)wrap.dataset[kind]='true';
    const p=box.ownerDocument.createElement('p');p.className='rpt-table-caption';p.textContent=caption;wrap.appendChild(p);
    const table=box.ownerDocument.createElement('table');
    [headers,...rows].forEach(values=>{const row=table.insertRow();values.forEach(value=>{row.insertCell().textContent=value;});});
    wrap.appendChild(table);box.appendChild(wrap);
  }
  function normalizeHeadings(container,context){
    const candidates=[];
    container.querySelectorAll('p').forEach(el=>{
      if(el.closest('table,figure')||!el.querySelector('br'))return;
      const parts=el.innerHTML.split(/<br\s*\/?\s*>/i);
      if(!parts.some(s=>/^\s*(?:<[^>]*>)*\d+(?:\s*[.．]\s*\d+)+(?:\s+|(?=[\u4e00-\u9fff]))/.test(s)))return;
      parts.forEach(s=>{const p=container.ownerDocument.createElement('p');p.innerHTML=s;el.before(p);});el.remove();
    });
    // mdRenderHtml emits both heading divs and plain paragraphs for numbered titles.
    container.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div').forEach(el=>{
      if(el.closest('table,figure')||el.querySelector('p,div,table,h1,h2,h3,h4,h5,h6'))return;
      // Split only explicit line breaks; do not treat amounts in running prose as headings.
      if(el.querySelector('br'))return;
      const text=el.textContent.trim();
      if(/^表\s*\d/.test(text))return;
      const bold=el.querySelector('b,strong');
      const boldHeading=bold&&bold.textContent.trim()===text&&text.length<100&&!/[。；;]/.test(text)&&/^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[）)]|\d+(?:[.．]\d+)+\s*)/.test(text);
      const explicit=/^H[1-6]$/.test(el.tagName)||/font-weight:\s*(?:600|bold)/.test(el.getAttribute('style')||'')||boldHeading;
      const number=text.match(/^(\d+(?:\s*[.．]\s*\d+)+)(?:\s+|(?=[\u4e00-\u9fff]))(.+)$/);
      const parent=title(text)===title(context.section)||title(text)===title(context.chapter);
      if(parent){el.remove();return;}
      const numericHeading=number&&text.length<100&&!/[。；;]/.test(text)&&! /^(?:万|亿|元|米|平方|公顷|亩|吨|年|个月|个百分点)/.test(number[2]);
      const chineseHeading=/^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[）)])\s*\S/.test(text)&&text.length<100&&!/[。；;《》]/.test(text);
      if(explicit||numericHeading||chineseHeading)candidates.push({el,text:number?number[2]:text.replace(/^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[）)])\s*/,''),depth:number?number[1].split(/[.．]/).length:Number(el.dataset.reportHeadingLevel)||(/^H[1-6]$/.test(el.tagName)?Number(el.tagName.slice(1)):/^[（(]/.test(text)?4:3)});
    });
    if(!candidates.length)return;
    const levels=[];
    const counts=[];
    candidates.forEach(x=>{
      while(levels.length&&x.depth<levels[levels.length-1]){levels.pop();counts.pop();}
      if(!levels.length||x.depth>levels[levels.length-1]){levels.push(x.depth);counts.push(0);}
      counts[counts.length-1]++;
      const h=container.ownerDocument.createElement('h'+Math.min(6,counts.length+2));
      h.textContent=context.number+'.'+counts.join('.')+' '+x.text;
      x.el.replaceWith(h);
    });
  }
  function compose(html,context,library){
    const doc=new root.DOMParser().parseFromString('<div></div>','text/html');
    const box=doc.body.firstElementChild;box.innerHTML=html||'';
    // Remove only our legacy reconciliation paragraphs, not normal source citations.
    box.querySelectorAll('p,div').forEach(el=>{
      if(el.closest('table,figure')||el.querySelector('p,div,table'))return;
      if(/^原表补充资料[（(]未自动对应标准字段[）)]\s*[：:]/.test(el.textContent.trim()))el.remove();
    });
    normalizeHeadings(box,context);
    box.querySelectorAll('table').forEach(table=>{
      if(table.closest('figure'))return;
      const rows=Array.from(table.rows),first=rows[0];
      if(rows.length<2)return;
      const nonempty=Array.from(first.cells).filter(c=>c.textContent.trim());
      if(nonempty.length!==1||!/^表\s*\d[\d.．—–-]*\s*\S/.test(nonempty[0].textContent.trim()))return;
      const caption=doc.createElement('p');
      caption.className='rpt-table-caption';caption.style.cssText='text-align:center;font-weight:bold';
      caption.textContent=nonempty[0].textContent.trim();
      table.before(caption);first.remove();
      // Remove only entirely empty edge columns in this malformed rectangular table.
      const remaining=Array.from(table.rows);
      if(remaining.every(r=>Array.from(r.cells).every(c=>c.colSpan===1&&c.rowSpan===1))){
        for(const edge of ['first','last']){
          if(remaining.every(r=>r.cells.length>1&&!r.cells[edge==='first'?0:r.cells.length-1].textContent.trim()))remaining.forEach(r=>r.deleteCell(edge==='first'?0:r.cells.length-1));
        }
      }
    });
    if(!library||!context.type)return box.innerHTML;
    const templates=context.templates||library.forSection(context.type,context.chapter,context.section);
    templates.forEach(source=>{
      let template=JSON.parse(JSON.stringify(source));
      const old=Array.from(box.querySelectorAll('figure[data-template-id]')).filter(el=>el.dataset.templateId===template.id&&!el.closest('[data-report-independent]'));
      // Keep frozen figures verbatim unless a raw table still needs reconciliation.
      // Missing editor-only coordinates must never reload an empty catalogue.
      const hasRaw=Array.from(box.querySelectorAll('table')).some(t=>!t.closest('figure')&&!t.closest(supplementSelector)&&!t.closest('[data-report-independent]')&&rectangular(t)&&unambiguousHeaders(t)&&
        (context.strictTables?t.dataset.canonicalTemplate===template.id:template.segments.some(s=>{
          const targets=s.rows[0].cells.map(c=>header(c.text)),keys=Array.from(t.rows[0].cells,c=>header(c.textContent));
          const score=keys.filter(k=>k&&targets.includes(k)).length;
          return score>=2&&score/Math.min(targets.length,keys.length)>=(score>=3?0.33:0.5);
        })));
      if(old.length&&!hasRaw)return;
      const reader=library.fromFigure||root.ReportTableTemplates?.fromFigure;
      if(old.length&&reader)template=reader(old[0],source);
      // Existing standard tables keep their cell edits, including explicitly blank values.
      const notes=[];
      (reader?[]:old).forEach((figure,figureIndex)=>figure.querySelectorAll('.rpt-template-segment').forEach(seg=>{
        const target=template.segments[Number(seg.dataset.segment)];
        if(!target){Array.from(seg.querySelectorAll('tr')).forEach((row,ri)=>{if(row.textContent.trim())notes.push('旧模板未匹配分段第'+(ri+1)+'行：'+Array.from(row.cells).map(c=>c.textContent.trim()).join('；'));});return;}
        const oldHeaders=Array.from(seg.querySelectorAll('tr:first-child [data-col]')).map(c=>header(c.textContent));
        const sameSchema=JSON.stringify(oldHeaders)===JSON.stringify(target.rows[0].cells.filter(c=>c.vMerge!=='continue').map(c=>header(c.text)));
        if(context.strictTables&&sameSchema&&template.id.endsWith('-05')){
          const priorRows=Array.from(seg.querySelectorAll('tr'));
          const total=target.rows.findIndex(r=>r.cells.some(c=>c.text==='合计'));
          if(total>0&&Array.from(priorRows.at(-1)?.cells||[]).some(c=>c.textContent.trim()==='合计')){
            const extra=priorRows.length-target.rows.length;
            for(let n=0;n<extra;n++)target.rows.splice(total,0,{cells:target.rows[0].cells.map(c=>Object.assign({},c,{text:'',role:'value'}))});
          }
        }
        seg.querySelectorAll('[data-row][data-col]').forEach(cell=>{
          if(context.strictTables&&target.rows.length>1){
            while(target.rows.length<=Number(cell.dataset.row))target.rows.push({cells:target.rows[0].cells.map(c=>Object.assign({},c,{text:'',role:'value'}))});
          }
          const row=target.rows[Number(cell.dataset.row)];
          const c=row&&row.cells.find(x=>Number(x.col||0)===Number(cell.dataset.col));
          if(cell.dataset.role!=='value')return;
          if(sameSchema&&c&&c.role==='value'&&figureIndex===0)c.text=missing(cell.textContent)?'':cell.textContent.trim();
          else if(sameSchema&&c&&key(c.text)===key(cell.textContent))return;
          else if(!missing(cell.textContent))notes.push('旧模板第'+cell.dataset.row+'行、第'+cell.dataset.col+'列：'+cell.textContent.trim());
        });
      }));
      let anchor=old[0]||null;
      template.segments.forEach(segment=>{
        const head=segment.rows[0].cells;
        const targets=head.map(c=>header(c.text));
        const matches=Array.from(box.querySelectorAll('table')).filter(t=>!t.closest('figure')&&!t.closest(supplementSelector)&&!t.closest('[data-report-independent]')&&rectangular(t)&&unambiguousHeaders(t)).map(table=>{
          const rows=Array.from(table.rows).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()));
          const keys=(rows[0]||[]).map(header);
          const score=keys.filter(k=>k&&targets.includes(k)).length;
          return {table,rows,keys,score};
        }).filter(x=>context.strictTables ? x.table.dataset.canonicalTemplate===template.id : x.score>=2&&x.score/Math.min(targets.length,x.keys.length)>=(x.score>=3?0.33:0.5)).sort((a,b)=>b.score-a.score);
        if(!matches.length)return;
        // Only the best schema match is consumed. Different analytical tables remain intact.
        const match=matches[0];if(!anchor)anchor=match.table;
        if(match.table.previousElementSibling?.classList.contains('rpt-table-caption'))match.table.previousElementSibling.remove();
        let writable=segment.rows.slice(1).filter(r=>r.cells.some(c=>c.role==='value'));
        // Free-form registers grow with real source rows; fixed model rows are never replaced.
        if(context.strictTables&&writable.length&&writable.every(r=>r.cells.every(c=>c.role==='value'))){
          while(writable.length<match.rows.length-1){segment.rows.push(JSON.parse(JSON.stringify(writable[0])));writable=segment.rows.slice(1);}
        }
        match.rows.slice(1).forEach((values,ri)=>{
          let row=writable[ri];
          const labelRow=writable.find(r=>r.cells.some(c=>c.role!=='value'&&key(c.text)&&!/^\d+$/.test(key(c.text))&&values.some(v=>key(c.text)===key(v))));
          if(labelRow)row=labelRow;
          if(row&&row.cells.some(c=>c.role!=='value'&&key(c.text))){
            const labels=row.cells.filter(c=>c.role!=='value'&&key(c.text)&&!/^\d+$/.test(key(c.text)));
            // A project-by-project legacy table is not a unit-type aggregate table.
            // Do not assign mixed unit counts to 单间/一房 merely by row position.
            if(labels.length&&!labels.some(c=>values.some(v=>key(v)===key(c.text))))row=null;
          }
          if(!row&&context.strictTables&&match.keys.length===targets.length&&match.keys.every((k,i)=>k===targets[i])){
            row={cells:head.map(c=>Object.assign({},c,{text:'',role:'value'}))};
            const total=segment.rows.findIndex(r=>r.cells.some(c=>c.text==='合计'));
            if(template.id.endsWith('-05')&&total>0)segment.rows.splice(total,0,row);else segment.rows.push(row);
          }
          const extras=[];
          values.forEach((value,ci)=>{
            if(missing(value))return;
            const targetIndex=targets.indexOf(match.keys[ci]);
            const cell=row&&targetIndex>=0&&row.cells.find(c=>Number(c.col||0)===Number(head[targetIndex].col||0));
            if(cell&&cell.role==='value'&&missing(cell.text))cell.text=value;
            else if(!cell||key(cell.text)!==key(value))extras.push((match.rows[0][ci]||'字段')+'：'+value);
          });
          if(extras.length)notes.push('原表第'+(ri+1)+'行'+(values[0]?'（'+values[0]+'）':'')+'：'+extras.join('；'));
        });
        if(match.table!==anchor)match.table.remove();
      });
      // A section match does not imply an empty optional table belongs in the report.
      // Explicitly required templates remain visible so their missing inputs can be reviewed.
      const populated=template.segments.some(s=>s.rows.some(r=>r.cells.some(c=>c.role==='value'&&!missing(c.text))));
      if(!anchor&&!notes.length&&template.required!==true&&template.presence!=='required'&&!populated)return;
      // If a fixed-row schema cannot identify any source object, keep the source
      // table itself instead of a blank template plus a restatement of every row.
      if(anchor?.tagName==='TABLE'&&!populated)return;
      const holder=doc.createElement('div');holder.innerHTML=library.renderTemplate(template);
      let figure=holder.firstElementChild;
      if(old[0]&&reader){
        // Reconciliation changes cells, not the surrounding project evidence.
        // Keep original captions/notes/wrappers in place instead of replacing
        // the whole figure with the catalogue's note-free presentation.
        const preserved=old[0].cloneNode(true);
        const ownedTables=el=>Array.from(el.querySelectorAll('table')).filter(t=>t.closest('figure')===el);
        const previous=ownedTables(preserved),next=ownedTables(figure);
        if(previous.length!==next.length)throw new Error('表格分段数量不一致，未替换原表；请核对后重试。');
        previous.forEach((table,i)=>table.replaceWith(next[i]));
        figure=preserved;
      }
      if(anchor?.dataset.reportTableScope)figure.dataset.reportTableScope=anchor.dataset.reportTableScope;
      if(anchor?.dataset.reportSourceCaption)figure.dataset.reportSourceCaption=anchor.dataset.reportSourceCaption;
      if(anchor)anchor.replaceWith(figure);else box.appendChild(figure);
      // Other historical figures are evidence, not duplicates merely by id.
      if(old[0]?.isConnected)old[0].remove();
      // Never silently discard fields that do not fit a published template.
      if(notes.length){
        const wrap=doc.createElement('div');wrap.dataset.reportSupplement='true';
        const caption=doc.createElement('p');caption.className='rpt-table-caption';caption.textContent='标准表补充明细（未自动匹配字段）';wrap.appendChild(caption);
        const table=doc.createElement('table');const h=table.insertRow();h.insertCell().textContent='原表位置及内容';
        Array.from(new Set(notes)).forEach(note=>table.insertRow().insertCell().textContent=note);
        wrap.appendChild(table);figure.after(wrap);
      }
    });
    return box.innerHTML;
  }
  function canonicalId(table){
    const p='gaibao-housing-table-', previous=table.previousElementSibling?.textContent||'', caption=previous.length<140?previous:'';
    const rows=Array.from(table.rows).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()));
    const h=(rows[0]||[]).join('|'), body=rows.slice(1).flat().join('|');
    if(/改造前.*(?:户型|现状)/.test(caption))return p+'02';
    if(/改造后.*(?:户型|房源)/.test(caption))return p+'04';
    if(/项目名称/.test(h)&&/现状情况/.test(h)&&/房型/.test(h))return p+'02';
    if(/项目名称|小区名称/.test(h)&&/辖区/.test(h)&&/周边交通条件|房源现状/.test(h))return p+'01';
    if(/法定改建条件/.test(h))return p+'03';
    if(/科目/.test(h)&&/单房成本|单方造价/.test(h))return p+'05';
    if(/(?:指标|项目)/.test(h)&&/(?:数值|测算值)/.test(h)&&/(?:IRR|内部收益率|净现值)/i.test(body))return p+'11';
    if(/条款类别/.test(h)&&/核心内容|约定内容/.test(h))return p+'14';
    if(/阶段/.test(h)&&/工作内容/.test(h)&&/里程碑/.test(h))return p+'12';
    if(/竞品项目/.test(h)&&/租金/.test(h))return p+'08';
    if(/客群层级/.test(h))return p+'09';
    if(/单位名称/.test(h)&&/企业性质/.test(h))return p+'15';
    if(/指标/.test(h)&&/统计期/.test(h)&&/来源/.test(h))return p+'16';
    if(/需求层次/.test(h))return p+'07';
    if(/客群圈层|客群类别/.test(h)&&/主要来源|来源范围/.test(h))return p+'09';
    if(/占比/.test(h)&&/分类/.test(h)&&/数据来源/.test(h))return p+'26';
    if(/竞品数量/.test(h))return p+'18';
    if(/定位维度/.test(h))return p+'25';
    if(/散租市区历史成交租金表/.test(caption))return p+'20';
    if(/散租板块历史成交租金表/.test(caption))return p+'21';
    if(/集中式长租市区历史成交租金表/.test(caption))return p+'22';
    if(/集中式长租板块历史成交租金表/.test(caption))return p+'23';
    if(/项目基本情况/.test(caption))return p+'01';
    return '';
  }
  // One document plan is shared by preview and export. Stable template IDs are scoped
  // by their business meaning: four different historical-rent series stay separate.
  let documentCache=null;
  // cells-v1 matches the completion contract's physical cell identity. This is
  // navigation integrity only, not a source hash or a claim that values are true.
  function referenceTableHash(table){
    const text=value=>String(value||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi,(_,v)=>{if(v[0]!=='#')return {nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[v.toLowerCase()];const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/\s+/g,' ').trim();
    const rows=Array.from(table.rows).map(r=>Array.from(r.cells).map(c=>[text(c.innerHTML),c.rowSpan||1,c.colSpan||1]));
    const value=JSON.stringify(rows);let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);return (hash>>>0).toString(16).padStart(8,'0');
  }
  function composeDocument(entries,library){
    const signature=JSON.stringify(entries.map(e=>[e.key,e.html,e.context,library.forSection(e.context.type,e.context.chapter,e.context.section)]));
    if(documentCache?.signature===signature)return documentCache.result.slice();
    const result=composeDocumentUncached(entries,library);documentCache={signature,result};return result.slice();
  }
  function composeDocumentUncached(entries,library){
    if(!entries.length)return [];
    const docs=entries.map(e=>{
      const doc=new root.DOMParser().parseFromString('<div>'+compose(e.html,e.context)+'</div>','text/html');
      const box=doc.body.firstElementChild;
      box.querySelectorAll('table').forEach(t=>{
        if(t.closest('figure'))return;
        const rows=Array.from(t.rows);
        if(rows.length&&rows.every(r=>Array.from(r.cells).every(c=>c.colSpan===1&&c.rowSpan===1))){
          for(const edge of ['first','last'])while(rows.every(r=>r.cells.length>1&&!r.cells[edge==='first'?0:r.cells.length-1].textContent.trim()))rows.forEach(r=>r.deleteCell(edge==='first'?0:r.cells.length-1));
        }
      });return box;
    });
    const owners=new Map(), templates=new Map(), groups=new Map();
    entries.forEach((e,i)=>library.forSection(e.context.type,e.context.chapter,e.context.section).forEach(t=>{
      templates.set(t.id,t);
      if(!owners.has(t.id))owners.set(t.id,i);
      if(/table-11$/.test(t.id)&&/^财务评价$/.test(e.context.section))owners.set(t.id,i);
      if(/table-14$/.test(t.id)&&/核心条款/.test(e.context.section))owners.set(t.id,i);
    }));
    const financial='gaibao-housing-table-11';
    if(templates.has(financial))owners.delete('gaibao-housing-table-06');
    const sectionKey=owner=>entries[owner].key||entries[owner].context.chapter+' / '+entries[owner].context.section;
    const reference=(node,owner,name,identity)=>{
      // Legacy Markdown candidates can place a frozen table inside a paragraph.
      // A replacement <p> there becomes invalid nested paragraphs, changing the
      // DOM again on the next preview/export parse. An inline reference retains
      // the existing paragraph and all its neighbouring prose without reparsing.
      const p=node.ownerDocument.createElement(node.closest('p')?'span':'p');p.className='rpt-table-reference';
      p.dataset.reportRefSection=sectionKey(owner);p.dataset.reportRefScope='document';p.dataset.reportRefTableKind='cells-v1';
      if(identity?.template)p.dataset.reportRefTemplate=identity.template;
      if(identity?.hash)p.dataset.reportRefTableHash=identity.hash;
      p.textContent='详见第'+entries[owner].context.number+'节“'+name+'”。';
      const prev=node.previousElementSibling;if(prev&&(prev.classList.contains('rpt-table-caption')||(/表$/.test(prev.textContent.trim())&&prev.textContent.length<100)))prev.remove();
      node.replaceWith(p);
    };
    docs.forEach((box,i)=>{
      box.querySelectorAll('figure[data-template-id],table').forEach(node=>{
        if(node.closest(supplementSelector)||node.closest('[data-report-independent]'))return;
        if(node.tagName==='TABLE'&&node.closest('figure'))return;
        if(node.tagName==='TABLE'&&(!rectangular(node)||!unambiguousHeaders(node)))return;
        let id=node.dataset.templateId||node.dataset.canonicalTemplate||(entries[i].context.type==='gaibao-housing'?canonicalId(node):'');
        if(!id&&node.tagName==='TABLE'){
          const source=Array.from(node.rows[0]?.cells||[]).map(c=>header(c.textContent));
          const candidates=library.forSection(entries[i].context.type,entries[i].context.chapter,entries[i].context.section).filter(t=>(t.segments||[]).some(segment=>{
            const target=(segment.rows[0]?.cells||[]).map(c=>header(c.text));
            return source.length>=2&&source.length===target.length&&source.every((h,j)=>h===target[j]);
          }));
          if(candidates.length===1)id=candidates[0].id;
        }
        if(id==='gaibao-housing-table-06'&&owners.has(financial))id=financial;
        if(!id||!owners.has(id))return;
        if(!groups.has(id))groups.set(id,[]);
        groups.get(id).push({node,index:i});
      });
    });
    // Sensitivity tables are one register keyed by factor AND change, not factor alone.
    const sensitivities=[];
    docs.forEach((box,index)=>box.querySelectorAll('table').forEach(node=>{
      if(node.closest(supplementSelector)||node.closest('figure')||!rectangular(node)||!unambiguousHeaders(node))return;
      const h=node.rows[0]?.textContent||'';
      if(/敏感因素|变动因素/.test(h)&&/波动幅度|变动幅度/.test(h))sensitivities.push({node,index});
    }));
    if(sensitivities.length>1&&new Set(sensitivities.map(x=>tableScope(x.node))).size===1){
      const owner=entries.findIndex(e=>/不确定/.test(e.context.section));
      const chosen=sensitivities.find(x=>x.index===owner)||sensitivities[0], merged=chosen.node.cloneNode(false);
      const sensitivityHeader=s=>header(s).replace('敏感因素','变动因素').replace('波动幅度','变动幅度');
      const headers=[];
      sensitivities.forEach(({node})=>Array.from(node.rows[0].cells).forEach(cell=>{if(!headers.some(h=>sensitivityHeader(h)===sensitivityHeader(cell.textContent)))headers.push(cell.textContent.trim());}));
      const row=values=>{const r=merged.insertRow();values.forEach(v=>r.insertCell().textContent=v);return r;};row(headers);
      const seen=new Map(),conflicts=[];
      sensitivities.forEach(({node,index})=>Array.from(node.rows).slice(1).forEach(r=>{
        const hs=Array.from(node.rows[0].cells).map(c=>sensitivityHeader(c.textContent));
        const values=headers.map(h=>{const i=hs.indexOf(sensitivityHeader(h));return i<0?'':r.cells[i]?.textContent.trim()||'';});
        const factor=headers.findIndex(h=>sensitivityHeader(h).includes('变动因素')),change=headers.findIndex(h=>sensitivityHeader(h).includes('变动幅度'));
        const dimensions=headers.map((h,j)=>/统计期|时点|口径|范围|方案|情景|年度|月份/.test(h)?j:-1).filter(j=>j>=0);
        const k=JSON.stringify([key(values[factor]),key(values[change]),...dimensions.map(j=>key(values[j]))]);
        if(!seen.has(k))seen.set(k,row(values.map(x=>missing(x)?'':x)));
        else values.forEach((v,j)=>{const old=seen.get(k).cells[j];if(missing(old.textContent)&&!missing(v))old.textContent=v;else if(!missing(v)&&valueKey(v)!==valueKey(old.textContent))conflicts.push([entries[index].context.number,values[factor]+' / '+values[change],headers[j],old.textContent,v]);});
      }));
      sensitivities.forEach(({node,index})=>{if(node===chosen.node)node.replaceWith(merged);else if(index===chosen.index)node.remove();else reference(node,chosen.index,'项目敏感性分析表',{hash:referenceTableHash(merged)});});
      addSupplement(docs[chosen.index],'敏感性分析同对象字段冲突（待核对，未自动覆盖）',['来源小节','对象','字段','主表值','冲突值'],conflicts,'reportConflicts');
    }
    groups.forEach((items,id)=>{
      const owner=owners.get(id), target=docs[owner];
      const primary=items.find(x=>x.index===owner)||items[0],scope=tableScope(primary.node),primaryCaption=sourceCaption(primary.node);
      items=items.filter(item=>{
        if(tableScope(item.node)===scope)return true;
        // A different unit, period or accounting basis is an independent table.
        // Keep it in place; do not flatten it into the owning template.
        item.node.dataset.reportTableScope=tableScope(item.node);
        const wrap=item.node.ownerDocument.createElement('div');wrap.dataset.reportIndependent='true';
        item.node.before(wrap);const p=item.node.ownerDocument.createElement('p');p.className='rpt-table-caption';p.textContent='独立口径明细（单位、时点或范围不同，未合并）';wrap.appendChild(p);wrap.appendChild(item.node);
        return false;
      });
      // Reconciliation replaces the owner's table, not its business position.
      // Keep a DOM-only anchor so following analysis/headings and nested wrappers
      // remain in place; a table absent from its owner still uses the end fallback.
      const ownerNode=items.find(item=>item.index===owner)?.node;
      const ownerPosition=ownerNode?target.ownerDocument.createComment('report-owner-table-position'):null;
      if(ownerPosition)ownerNode.before(ownerPosition);
      const placeOwnerNode=node=>ownerPosition?ownerPosition.before(node):target.appendChild(node);
      const captions=Array.from(new Set(items.map(({node})=>sourceCaption(node)).filter(c=>c&&title(c)!==title(templates.get(id).title))));
      const raw=items.filter(x=>x.node.tagName==='TABLE').sort((a,b)=>(b.index===owner)-(a.index===owner));
      // The template schema is authoritative. Combine compatible registers before
      // rendering so a later populated copy is not replaced by an earlier empty one.
      let merged=null;
      const knownRows=new Map(),conflicts=[];
      raw.forEach(({node,index})=>{
        const hs=Array.from(node.rows[0]?.cells||[]).map(c=>c.textContent.trim()), rows=Array.from(node.rows).slice(1).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()));
        const rewrite=(heads,values)=>{node.innerHTML='';[heads,...values].forEach(vals=>{const r=node.insertRow();vals.forEach(v=>r.insertCell().textContent=missing(v)?'':v);});};
        if(/-(02|04)$/.test(id)&&hs.some(h=>/项目名称|小区名称/.test(h))){
          // Site rows with mixed bedroom types cannot prove complete totals by unit type.
          const total=rows.find(v=>v.includes('合计'));
          const count=hs.findIndex(h=>/套数/.test(h)),area=hs.findIndex(h=>/建筑面积/.test(h));
          addSupplement(target,'按项目原始明细（对象粒度不同，不作为户型合计）',hs,rows.filter(v=>v!==total),'reportFieldDifferences');
          rewrite(['房型','层高（m）','套数（套）','建筑面积（㎡）','得房率（%）'],total?[['合计','',count<0?'':total[count],area<0?'':total[area],'']]:[]);
          if(total){const remaining=total.map((v,j)=>j!==count&&j!==area&&!missing(v)&&v!=='合计'?hs[j]+'：'+v:'').filter(Boolean);if(remaining.length)addSupplement(target,'合计行未匹配字段',['来源小节','对象','字段差异'],[[entries[index].context.number,'合计',remaining.join('；')]],'reportFieldDifferences');}
        }
        if(id.endsWith('-09')){
          const aliases={'客群圈层':'客群类型','客群类别':'客群类型','来源范围':'来源区域/单位','需求动因':'需求特征','与本项目关系':'定位结论','与项目匹配度':'定位结论'};
          Array.from(node.rows[0].cells).forEach(c=>{if(aliases[c.textContent.trim()])c.textContent=aliases[c.textContent.trim()];});
        }
        // Do not transpose, combine positional columns, or infer static row labels.
        // Unmapped source fields are retained by compose as object-labelled differences.
        if(id.endsWith('-05')&&hs.includes('成本科目'))node.rows[0].cells[hs.indexOf('成本科目')].textContent='科目';
      });
      const financialNotes=id===financial?normalizeFinancialRows(raw,entries,conflicts):[];
      raw.forEach(({node,index})=>{
        if(!merged){merged=node.cloneNode(true);Array.from(merged.rows).slice(1).forEach(r=>r.remove());}
        const sourceHeaders=Array.from(node.rows[0]?.cells||[]).map(c=>header(c.textContent));
        sourceHeaders.forEach((h,j)=>{if(!Array.from(merged.rows[0].cells).some(c=>header(c.textContent)===h))Array.from(merged.rows).forEach((r,i)=>{r.insertCell().textContent=i?'':node.rows[0].cells[j].textContent;});});
        const targetHeaders=Array.from(merged.rows[0]?.cells||[]).map(c=>header(c.textContent));
        Array.from(node.rows).slice(1).forEach(row=>{
          const values=targetHeaders.map(h=>{const pos=sourceHeaders.indexOf(h);return pos<0?'':row.cells[pos]?.textContent.trim()||'';});
          const identityHeader=id.endsWith('-01')?'项目名称':id.endsWith('-05')?'科目':id.endsWith('-03')?'法定改建条件':null;
          const identityIndex=identityHeader?Math.max(0,targetHeaders.indexOf(header(identityHeader))):/^(序号|编号)$/.test(targetHeaders[0])&&targetHeaders.length>1?1:0;
          if(id.endsWith('-01')&&identityIndex>=0&&missing(values[identityIndex])&&/合计/.test(row.textContent))values[identityIndex]='合计';
          const dimensions=targetHeaders.map((h,j)=>/单位|统计期|时点|口径|范围|地域|方案|情景|年度|月份|项目名称|单位名称|客群|分类|维度|分组/.test(h)&&j!==identityIndex?j:-1).filter(j=>j>=0);
          // A risk category is a group, not an individual risk. Distinct risk
          // descriptions must remain separate records, even within one category.
          // An absent description cannot prove identity, so only identical rows
          // may coalesce in that case; genuine same-risk field conflicts remain.
          const riskDescription=id.endsWith('-13')?targetHeaders.indexOf(header('风险描述')):-1;
          const riskIdentity=riskDescription<0?[]:missing(values[riskDescription])?[values.map(valueKey)]:[values[riskDescription].replace(/\s/g,'')];
          const signature=JSON.stringify([key(values[identityIndex])||values.map(valueKey).join('|'),...riskIdentity,...dimensions.map(j=>valueKey(values[j])),...(id===financial?[row.dataset.reportFinancialScope||'']:[])]);
          const oldRow=knownRows.get(signature);
          if(oldRow){values.forEach((v,col)=>{
            const cell=oldRow.cells[col];if(missing(cell.textContent)&&!missing(v))cell.textContent=v;
            else if(!missing(v)){
              const compare=id===financial?x=>financialValueKey(x,values[targetHeaders.indexOf('单位')]):valueKey;
              if(compare(v)!==compare(cell.textContent))conflicts.push([entries[index].context.number,riskDescription>=0?values[identityIndex]+'：'+values[riskDescription]:values[identityIndex],merged.rows[0].cells[col].textContent,cell.textContent,v]);
            }
          });return;}
          const tr=merged.insertRow();values.forEach(v=>{tr.insertCell().textContent=v;});knownRows.set(signature,tr);
        });
      });
      // Keep source figures (including edits) in their sole owning section.
      items.forEach(({node,index})=>{
        const copy=node.cloneNode(true);
        if(index!==owner)reference(node,owner,templates.get(id).title,{template:id});else{const prev=node.previousElementSibling;if(prev&&(prev.classList.contains('rpt-table-caption')||(/表$/.test(prev.textContent.trim())&&prev.textContent.length<100)))prev.remove();node.remove();}
        if(copy.tagName==='FIGURE'&&copy.dataset.templateId===id)placeOwnerNode(copy);
      });
      captions.forEach(caption=>{
        const captionKey=id+'|'+caption;
        if(!Array.from(target.querySelectorAll('[data-report-caption-key]')).some(p=>p.dataset.reportCaptionKey===captionKey)){
          const p=target.ownerDocument.createElement('p');p.className='rpt-table-context';p.dataset.reportCaptionKey=captionKey;p.textContent='表格口径：'+caption+'。';placeOwnerNode(p);
        }
      });
      if(merged){merged.dataset.canonicalTemplate=id;merged.dataset.reportTableScope=scope;merged.dataset.reportSourceCaption=primaryCaption;placeOwnerNode(merged);}
      if(ownerPosition)ownerPosition.remove();
      addSupplement(target,'财务指标原表说明（按指标归集，不同表述保留待核对）',['指标及单位','来源小节及原说明'],financialNotes,'reportFieldDifferences');
      addSupplement(target,'同对象字段冲突（待核对，未自动覆盖）',['来源小节','对象','字段','主表值','冲突值'],Array.from(new Map(conflicts.map(row=>[JSON.stringify(row),row])).values()),'reportConflicts');
    });
    // POI counts are not room counts. Preserve this genuinely different source
    // table with its correct scope rather than mislabelling it as rental inventory.
    docs.forEach(box=>box.querySelectorAll('table').forEach(t=>{
      if(!/POI/.test(t.rows[0]?.textContent||''))return;
      const prev=t.previousElementSibling;
      if(prev&&prev.textContent.trim()==='项目3公里内房源情况表'){prev.textContent='项目3公里内住宅与办公POI分布表';prev.className='rpt-table-caption';}
    }));
    const result=docs.map((box,i)=>{
      const context=Object.assign({},entries[i].context,{strictTables:true,templates:Array.from(owners).filter(([,owner])=>owner===i).map(([id])=>templates.get(id))});
      const html=compose(box.innerHTML,context,library);
      return html;
    });
    // Exact duplicate legacy tables are references, never repeated full tables.
    const seen=new Map();
    const finalBoxes=result.map((html,i)=>{
      const doc=new root.DOMParser().parseFromString('<div>'+html+'</div>','text/html'),box=doc.body.firstElementChild;
      box.querySelectorAll('table').forEach(t=>{
        if(t.closest('figure'))return;
        const rows=Array.from(t.rows).map(r=>Array.from(r.cells).map(c=>[key(c.textContent),c.colSpan,c.rowSpan]));
        // A preceding business paragraph is not a table title. Its wording can
        // differ while the entire table (including units/spans/scope) is equal;
        // keep that prose and use only explicit/source captions for identity.
        const meaning=t.dataset.canonicalTemplate||title(sourceCaption(t));
        const signature=JSON.stringify([meaning,tableScope(t),rows]);
        // Same-section duplication is still content requiring review; do not
        // manufacture a self-reference to make it disappear.
        if(seen.has(signature)){const earlier=seen.get(signature);if(earlier.index!==i)reference(t.closest(supplementSelector)||t,earlier.index,'相关明细表',{hash:earlier.hash});}else seen.set(signature,{index:i,hash:referenceTableHash(t)});
      });
      box.querySelectorAll(supplementSelector).forEach(el=>box.appendChild(el));
      return box;
    });
    // Bind newly created canonical references only after the shared template
    // renderer has produced all segments. Existing identities are not silently
    // re-signed when target values change: document review reports that mismatch.
    finalBoxes.forEach(box=>box.querySelectorAll('.rpt-table-reference[data-report-ref-template]').forEach(p=>{
      if(p.dataset.reportRefTableHash)return;
      const owner=entries.findIndex((e,i)=>sectionKey(i)===p.dataset.reportRefSection);
      if(owner<0)return;
      const tables=Array.from(finalBoxes[owner].querySelectorAll('table')).filter(t=>t.closest('figure')?.dataset.templateId===p.dataset.reportRefTemplate||t.dataset.canonicalTemplate===p.dataset.reportRefTemplate);
      if(tables.length)p.dataset.reportRefTableHash=tables.map(referenceTableHash).join(' ');
    }));
    // Re-prepared raw tables can create another reference to an existing one.
    // Compare only after new hashes are bound, and only exact nodes: different
    // attributes, inline markup and comments are content, not duplicate links.
    finalBoxes.forEach(box=>{
      const refs=new Set();
      box.querySelectorAll('.rpt-table-reference').forEach(p=>{
        const identity=p.outerHTML;
        if(refs.has(identity))p.remove();else refs.add(identity);
      });
    });
    return finalBoxes.map(box=>box.innerHTML);
  }
  root.ReportSectionLayout={compose,composeDocument,normalizeHeadings};
})(typeof window!=='undefined'?window:globalThis);
