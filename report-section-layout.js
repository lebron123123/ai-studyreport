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
  const missing=s=>!String(s||'').trim()||/^(?:待填|待补|暂无|—|-|【待补[^】]*】)$/.test(String(s).trim());
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
      if(explicit||numericHeading)candidates.push({el,text:number?number[2]:text.replace(/^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[）)])\s*/,''),depth:number?number[1].split(/[.．]/).length:Number(el.tagName.slice(1))||3});
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
      const template=JSON.parse(JSON.stringify(source));
      const old=Array.from(box.querySelectorAll('figure[data-template-id]')).filter(el=>el.dataset.templateId===template.id);
      // Existing standard tables keep their cell edits, including explicitly blank values.
      const notes=[];
      old.forEach((figure,figureIndex)=>figure.querySelectorAll('.rpt-template-segment').forEach(seg=>{
        const target=template.segments[Number(seg.dataset.segment)];if(!target)return;
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
        const matches=Array.from(box.querySelectorAll('table')).filter(t=>!t.closest('figure')).map(table=>{
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
      const holder=doc.createElement('div');holder.innerHTML=library.renderTemplate(template);
      const figure=holder.firstElementChild;
      if(anchor)anchor.replaceWith(figure);else box.appendChild(figure);
      old.forEach(el=>{if(el.isConnected)el.remove();});
      // Reconciliation details are not report prose. Original project materials remain unchanged.
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
  function composeDocument(entries,library){
    const signature=JSON.stringify(entries.map(e=>[e.html,e.context,library.forSection(e.context.type,e.context.chapter,e.context.section)]));
    if(documentCache?.signature===signature)return documentCache.result.slice();
    const result=composeDocumentUncached(entries,library);documentCache={signature,result};return result.slice();
  }
  function composeDocumentUncached(entries,library){
    if(!entries.length)return [];
    if(entries[0].context.type!=='gaibao-housing')return entries.map(e=>compose(e.html,e.context,library));
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
    const reference=(node,owner,name)=>{
      const p=node.ownerDocument.createElement('p');p.className='rpt-table-reference';
      p.textContent='详见第'+entries[owner].context.number+'节“'+name+'”。';
      const prev=node.previousElementSibling;if(prev&&(prev.classList.contains('rpt-table-caption')||(/表$/.test(prev.textContent.trim())&&prev.textContent.length<100)))prev.remove();
      node.replaceWith(p);
    };
    docs.forEach((box,i)=>{
      box.querySelectorAll('figure[data-template-id],table').forEach(node=>{
        if(node.tagName==='TABLE'&&node.closest('figure'))return;
        let id=node.dataset.templateId||canonicalId(node);
        if(id==='gaibao-housing-table-06'&&owners.has(financial))id=financial;
        if(!id||!owners.has(id))return;
        if(!groups.has(id))groups.set(id,[]);
        groups.get(id).push({node,index:i});
      });
    });
    // Sensitivity tables are one register keyed by factor AND change, not factor alone.
    const sensitivities=[];
    docs.forEach((box,index)=>box.querySelectorAll('table').forEach(node=>{
      const h=node.rows[0]?.textContent||'';
      if(/敏感因素|变动因素/.test(h)&&/波动幅度|变动幅度/.test(h))sensitivities.push({node,index});
    }));
    if(sensitivities.length>1){
      const owner=entries.findIndex(e=>/不确定/.test(e.context.section));
      const chosen=sensitivities.find(x=>x.index===owner)||sensitivities[0], merged=chosen.node.cloneNode(false);
      const headers=['变动因素','变动幅度','全投资内部收益率（IRR）','财务净现值（NPV，万元）','敏感系数','IRR变动（个百分点）','NPV变动（万元）'];
      const row=values=>{const r=merged.insertRow();values.forEach(v=>r.insertCell().textContent=v);return r;};row(headers);
      const seen=new Map();
      sensitivities.forEach(({node})=>Array.from(node.rows).slice(1).forEach(r=>{
        const hs=Array.from(node.rows[0].cells).map(c=>c.textContent),v=Array.from(r.cells).map(c=>c.textContent.trim());
        const values=[v[0].replace(/基准方案|基准情形/,'基准情形').replace('建设投资（工程费用）','工程费用'),v[1],...[/IRR|内部收益率/,/净现值/,/敏感系数/,/IRR变动/,/NPV变动/].map((re,j)=>{const k=hs.findIndex(h=>re.test(h)&&(j!==0||!/变动/.test(h)));return k<0?'':v[k];})];
        if(!missing(values[2])&&!/%$/.test(values[2]))values[2]+='%';
        const k=key(values[0])+'|'+key(values[1]);
        if(!seen.has(k))seen.set(k,row(values.map(x=>missing(x)?'':x)));
        else values.forEach((v,j)=>{if(missing(seen.get(k).cells[j].textContent)&&!missing(v))seen.get(k).cells[j].textContent=v;});
      }));
      sensitivities.forEach(({node,index})=>{if(node===chosen.node)node.replaceWith(merged);else reference(node,chosen.index,'项目敏感性分析表');});
    }
    groups.forEach((items,id)=>{
      const owner=owners.get(id), target=docs[owner], raw=items.filter(x=>x.node.tagName==='TABLE').sort((a,b)=>(b.index===owner)-(a.index===owner));
      // The template schema is authoritative. Combine compatible registers before
      // rendering so a later populated copy is not replaced by an earlier empty one.
      let merged=null;
      const knownRows=new Map();
      const valueKey=v=>{const s=String(v).replace(/[,，\s]/g,'').replace(/(?:万元|元|年|%)$/,'');return /^-?\d+(?:\.\d+)?$/.test(s)?String(Number(s)):key(s);};
      raw.forEach(({node})=>{
        const hs=Array.from(node.rows[0]?.cells||[]).map(c=>c.textContent.trim()), rows=Array.from(node.rows).slice(1).map(r=>Array.from(r.cells).map(c=>c.textContent.trim()));
        const rewrite=(heads,values)=>{node.innerHTML='';[heads,...values].forEach(vals=>{const r=node.insertRow();vals.forEach(v=>r.insertCell().textContent=missing(v)?'':v);});};
        if(/-(02|04)$/.test(id)&&hs.some(h=>/项目名称|小区名称/.test(h))){
          // Site rows with mixed bedroom types cannot prove complete totals by unit type.
          const total=rows.find(v=>v.includes('合计'));
          const count=hs.findIndex(h=>/套数/.test(h)),area=hs.findIndex(h=>/建筑面积/.test(h));
          rewrite(['房型','层高（m）','套数（套）','建筑面积（㎡）','得房率（%）'],total?[['合计','',count<0?'':total[count],area<0?'':total[area],'']]:[]);
        }
        if(id.endsWith('-07')&&hs.includes('需求层次'))rewrite(['分析主题','核心指标','行政区','街道','项目3公里','数据时点与来源'],rows.map(v=>[v[0],v.slice(1).map((x,j)=>hs[j+1]+'：'+x).join('；'),'','','','']));
        if(id.endsWith('-09')){
          const aliases={'客群圈层':'客群类型','客群类别':'客群类型','来源范围':'来源区域/单位','需求动因':'需求特征','与本项目关系':'定位结论','与项目匹配度':'定位结论'};
          Array.from(node.rows[0].cells).forEach(c=>{if(aliases[c.textContent.trim()])c.textContent=aliases[c.textContent.trim()];});
        }
        if(id.endsWith('-15')&&hs.includes('单位名称'))rewrite(['相关信息','详情'],[
          ['公司名称',rows.map(v=>v[hs.indexOf('单位名称')]).join('；')],
          ['经营范围',rows.map(v=>v[hs.indexOf('单位名称')]+'：'+v[hs.indexOf('主营业务')]).join('；')],
          ['企业性质及股东',rows.map(v=>v[hs.indexOf('单位名称')]+'：'+v[hs.indexOf('企业性质')]+'；控股股东：'+v[hs.indexOf('控股股东')]).join('；')]
        ]);
        if(id.endsWith('-18')&&hs.some(h=>h.includes('竞品数量')))rewrite(['板块','项目数量','房间数量（间）','出租率','平均租金（元/㎡/月）'],rows.map(v=>[v[0]+'（'+v[1]+'）',v[2],'',v[5],v[4]]));
        if(id.endsWith('-25')&&hs.includes('定位维度'))rewrite(['对标内容','本项目','重点竞品 1（XX）','重点竞品 2（XX）','重点竞品 3（XX）','对标结论'],rows.map(v=>[v[0]==='改造标准'?'装修标准':v[0],v[1],'','','',[v[2],v[3]].filter(x=>!missing(x)).join('；')]));
        if(id.endsWith('-26')&&hs.includes('分类')){
          let dimension='';rewrite(['地域范围','维度','分组','人数或比例','统计期及来源'],rows.map(v=>{dimension=v[0]||dimension;return ['',dimension,v[1],v[2],v[3]];}));
        }
        if(id.endsWith('-05')&&hs.includes('成本科目'))rewrite(['科目','计算单方成本（元/㎡）','科目释义'],rows.map(v=>[v[0],v[1],v[2]]));
        if(id.endsWith('-05')){
          const col=Array.from(node.rows[0].cells).findIndex(c=>c.textContent.trim()==='科目');
          const aliases={'委托咨询费':'委托费用','机电工程费':'机电改造','机电改造费':'机电改造','代建管理费':'委托代建费'};
          if(col>=0)Array.from(node.rows).slice(1).forEach(r=>{const c=r.cells[col];if(c&&aliases[c.textContent.trim()])c.textContent=aliases[c.textContent.trim()];});
        }
        if(id.endsWith('-03')){
          const col=hs.indexOf('法定改建条件');
          const labels=(templates.get(id).segments?.[0]?.rows||[]).slice(1).map(r=>r.cells[1]?.text||'');
          const rules=[/权属|不动产/,/查封|抵押/,/城市更新|土地整备/,/独立可运营|规模满足/,/共有权|共有人/];
          if(col>=0)Array.from(node.rows).slice(1).forEach(r=>{const c=r.cells[col];const n=rules.findIndex(re=>re.test(c?.textContent||''));if(n>=0&&labels[n])c.textContent=labels[n];});
        }
        if(id===financial){
          node.rows[0].cells[0].textContent='指标名称';
          let unitColumn=Array.from(node.rows[0].cells).findIndex(c=>c.textContent.trim()==='单位');
          if(unitColumn<0){unitColumn=node.rows[0].cells.length;Array.from(node.rows).forEach((r,i)=>{r.insertCell().textContent=i?'':'单位';});}
          Array.from(node.rows).slice(1).forEach(r=>{
            const label=r.cells[0].textContent;const unit=label.match(/[（(](万元|元|年|%)[）)]/);
            let clean=label.replace(/[（(](?:万元|元|年|%|NPV|IRR)[）)]/gi,'').replace(/IRR|NPV/gi,'').replace('净利润合计','净利润');
            r.cells[0].textContent=clean;
            if(!r.cells[unitColumn].textContent.trim())r.cells[unitColumn].textContent=unit?unit[1]:/内部收益率/.test(clean)?'%':'';
          });
        }
      });
      raw.forEach(({node})=>{
        if(!merged){merged=node.cloneNode(true);Array.from(merged.rows).slice(1).forEach(r=>r.remove());}
        const sourceHeaders=Array.from(node.rows[0]?.cells||[]).map(c=>header(c.textContent));
        sourceHeaders.forEach((h,j)=>{if(!Array.from(merged.rows[0].cells).some(c=>header(c.textContent)===h))Array.from(merged.rows).forEach((r,i)=>{r.insertCell().textContent=i?'':node.rows[0].cells[j].textContent;});});
        const targetHeaders=Array.from(merged.rows[0]?.cells||[]).map(c=>header(c.textContent));
        Array.from(node.rows).slice(1).forEach(row=>{
          const values=targetHeaders.map(h=>{const pos=sourceHeaders.indexOf(h);return pos<0?'':row.cells[pos]?.textContent.trim()||'';});
          const identityHeader=id.endsWith('-01')?'项目名称':id.endsWith('-05')?'科目':id.endsWith('-03')?'法定改建条件':null;
          const identityIndex=identityHeader?Math.max(0,targetHeaders.indexOf(header(identityHeader))):0;
          if(id.endsWith('-01')&&identityIndex>=0&&missing(values[identityIndex])&&/合计/.test(row.textContent))values[identityIndex]='合计';
          const signature=key(values[identityIndex])||values.map(valueKey).join('|');
          const oldRow=knownRows.get(signature);
          if(oldRow){values.forEach((v,col)=>{
            const cell=oldRow.cells[col];if(missing(cell.textContent)&&!missing(v))cell.textContent=v;
            else if(!missing(v)&&valueKey(v)!==valueKey(cell.textContent)&&!cell.textContent.includes(v)&&!v.includes(cell.textContent))cell.textContent+='；'+v;
            else if(v.length>cell.textContent.length&&v.includes(cell.textContent))cell.textContent=v;
          });return;}
          const tr=merged.insertRow();values.forEach(v=>{tr.insertCell().textContent=v;});knownRows.set(signature,tr);
        });
      });
      // Keep source figures (including edits) in their sole owning section.
      items.forEach(({node,index})=>{
        const copy=node.cloneNode(true);
        if(index!==owner)reference(node,owner,templates.get(id).title);else{const prev=node.previousElementSibling;if(prev&&(prev.classList.contains('rpt-table-caption')||(/表$/.test(prev.textContent.trim())&&prev.textContent.length<100)))prev.remove();node.remove();}
        if(copy.tagName==='FIGURE'&&copy.dataset.templateId===id)target.appendChild(copy);
      });
      if(merged){merged.dataset.canonicalTemplate=id;target.appendChild(merged);}
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
    return result.map((html,i)=>{
      const doc=new root.DOMParser().parseFromString('<div>'+html+'</div>','text/html'),box=doc.body.firstElementChild;
      box.querySelectorAll('table').forEach(t=>{
        if(t.closest('figure'))return;
        const rows=Array.from(t.rows).map(r=>Array.from(r.cells).map(c=>key(c.textContent)));
        const signature=JSON.stringify(rows);
        if(seen.has(signature)){const earlier=seen.get(signature);reference(t,earlier,'相关明细表');}else seen.set(signature,i);
      });
      const refs=new Set();box.querySelectorAll('.rpt-table-reference').forEach(p=>{if(refs.has(p.textContent))p.remove();else refs.add(p.textContent);});
      return box.innerHTML;
    });
  }
  root.ReportSectionLayout={compose,composeDocument,normalizeHeadings};
})(typeof window!=='undefined'?window:globalThis);
