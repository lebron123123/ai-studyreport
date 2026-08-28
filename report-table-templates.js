/* 出租类可研标准表格模板：网页预览与Word导出共用同一份结构数据。 */
(function(root){
  "use strict";
  const state={sets:{},baseSets:{},configs:{},loading:{}};
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const norm=s=>String(s||"").replace(/^第[一二三四五六七八九十百]+章\s*/,"").replace(/\s+/g,"");

  const clone=value=>JSON.parse(JSON.stringify(value));
  function applyOverrides(base,overrides){
    const set=clone(base),map=overrides&&overrides.templates||{};
    (set.templates||[]).forEach(template=>{
      const patch=map[template.id];if(!patch)return;
      if(patch.title)template.title=String(patch.title);
      const cells=patch.cells||{};
      Object.entries(cells).forEach(([key,text])=>{
        const [si,ri,col]=key.split(":").map(Number),segment=template.segments&&template.segments[si],row=segment&&segment.rows&&segment.rows[ri];
        const cell=row&&row.cells&&row.cells.find(item=>Number(item.col)===col);
        if(cell&&cell.role!=="value")cell.text=String(text==null?"":text);
      });
    });
    return set;
  }
  function buildOverrides(edited,base){
    const output={projectType:edited&&edited.projectType||"rent",templates:{}},baseMap=new Map(((base&&base.templates)||[]).map(t=>[t.id,t]));
    ((edited&&edited.templates)||[]).forEach(template=>{
      const original=baseMap.get(template.id);if(!original)return;
      const patch={cells:{}};
      if(String(template.title||"")!==String(original.title||""))patch.title=String(template.title||"");
      (template.segments||[]).forEach((segment,si)=>(segment.rows||[]).forEach((row,ri)=>(row.cells||[]).forEach(cell=>{
        if(cell.role==="value")return;
        const source=original.segments?.[si]?.rows?.[ri]?.cells?.find(item=>Number(item.col)===Number(cell.col));
        if(source&&String(cell.text||"")!==String(source.text||""))patch.cells[si+":"+ri+":"+Number(cell.col||0)]=String(cell.text||"");
      })));
      if(!Object.keys(patch.cells).length)delete patch.cells;
      if(patch.title||patch.cells)output.templates[template.id]=patch;
    });
    return output;
  }
  async function load(projectType,force){
    const type=projectType||"rent";
    if(force){delete state.sets[type];delete state.baseSets[type];delete state.configs[type];}
    if(state.sets[type])return state.sets[type];
    if(type!=="rent")return null;
    if(!state.loading[type])state.loading[type]=fetch("data/report-table-templates-rent-v1.json")
      .then(r=>{if(!r.ok)throw new Error("表格模板库加载失败：HTTP "+r.status);return r.json();})
      .then(async set=>{
        state.baseSets[type]=clone(set);
        let config={version:1,status:"baseline",overrides:{projectType:type,templates:{}}};
        try{
          const headers=typeof authHeaders==="function"?authHeaders():{},response=await fetch("/api/reporttables?projectType="+encodeURIComponent(type),{headers});
          const result=await response.json();if(response.ok&&result.ok&&result.config)config=result.config;
        }catch(error){if(typeof console!=="undefined")console.warn("表格模板覆盖配置读取失败，使用Word基线：",error.message);}
        state.configs[type]=config;state.sets[type]=applyOverrides(set,config.overrides);return state.sets[type];
      })
      .finally(()=>{delete state.loading[type];});
    return state.loading[type];
  }
  function current(type){return state.sets[type||"rent"]||null;}
  function baseline(type){return state.baseSets[type||"rent"]||null;}
  function config(type){return state.configs[type||"rent"]||{version:1,status:"baseline",overrides:{projectType:type||"rent",templates:{}}};}
  function matchesChapter(t,chapter){
    if(!t.chapter||t.chapter==="附表")return t.chapter!=="附表";
    const a=norm(t.chapter),b=norm(chapter);
    return !a||!b||a.includes(b)||b.includes(a);
  }
  function forSection(type,chapter,section){
    const set=current(type);if(!set)return [];
    const q=norm(chapter)+norm(section);
    return (set.templates||[]).filter(t=>!t.appendix&&matchesChapter(t,chapter)&&(t.match||[]).some(k=>q.includes(norm(k))));
  }
  function appendix(type){const set=current(type);return set?(set.templates||[]).filter(t=>t.appendix):[];}

  function preparedRows(segment){
    const rows=(segment.rows||[]).map(r=>({cells:(r.cells||[]).map(c=>Object.assign({},c))}));
    rows.forEach((row,ri)=>row.cells.forEach(cell=>{
      if(cell.vMerge!=="restart")return;
      let span=1;
      for(let r=ri+1;r<rows.length;r++){
        const next=rows[r].cells.find(c=>Number(c.col)===Number(cell.col));
        if(!next||next.vMerge!=="continue")break;
        span++;
      }
      cell.rowSpan=span;
    }));
    return rows;
  }
  function segmentHtml(template,segment,index,options){
    const editable=!!(options&&options.editable);
    const widths=(segment.gridWidths||[]).map(Number),sum=widths.reduce((a,b)=>a+b,0)||1;
    const cols=widths.length?'<colgroup>'+widths.map(w=>'<col style="width:'+((w/sum)*100).toFixed(3)+'%">').join("")+'</colgroup>':"";
    const rows=preparedRows(segment).map((row,ri)=>{
      const cells=row.cells.filter(c=>c.vMerge!=="continue").map(c=>{
        const tag=ri===0?"th":"td",attrs=[];
        if(Number(c.colSpan)>1)attrs.push('colspan="'+Number(c.colSpan)+'"');
        if(Number(c.rowSpan)>1)attrs.push('rowspan="'+Number(c.rowSpan)+'"');
        if(c.align)attrs.push('style="text-align:'+esc(c.align==='both'?'justify':c.align)+'"');
        const blank=c.role==="value"&&!String(c.text||"").trim();
        const body=blank?'<span class="rpt-template-empty" title="待项目资料或测算结果填充">&nbsp;</span>':esc(c.text);
        if(editable&&c.role!=="value")attrs.push('contenteditable="true"','spellcheck="false"');
        return '<'+tag+' '+attrs.join(" ")+' data-row="'+ri+'" data-col="'+Number(c.col||0)+'" data-role="'+esc(c.role||"")+'">'+body+'</'+tag+'>';
      }).join("");
      return '<tr>'+cells+'</tr>';
    }).join("");
    return '<div class="rpt-template-segment" data-segment="'+index+'"><div class="rpt-template-segment-title">'
      +esc(index?template.title+'（续表'+index+'）':template.title)+'</div><div class="rpt-template-scroll"><table class="rpt rpt-fixed-template">'
      +cols+'<tbody>'+rows+'</tbody></table></div></div>';
  }
  function renderTemplate(template,options){
    const segments=(template.segments||[]).map((s,i)=>segmentHtml(template,s,i,options));
    let body=segments.join("");
    if(template.longPeriod&&segments.length>1){
      body=segments.map((s,i)=>'<details class="rpt-template-period" '+(i===0?'open':'')+'><summary>'
        +esc(i===0?'第1段':('续表第'+(i+1)+'段'))+' · 按原报告年度容量分段</summary>'+s+'</details>').join("");
    }
    return '<figure class="rpt-template-card" data-template-id="'+esc(template.id)+'"><figcaption><b>表：'+esc(template.title)
      +'</b><span>出租类标准模板 v'+esc(template.version||1)+' · 项目数据待填</span></figcaption>'+body+'</figure>';
  }
  function renderSection(type,chapter,section){return forSection(type,chapter,section).map(renderTemplate).join("");}
  function renderAppendix(type){return appendix(type).map(renderTemplate).join("");}
  function exportTemplate(id,type){
    const set=current(type||"rent"),t=set&&(set.templates||[]).find(x=>x.id===id);
    return t?JSON.parse(JSON.stringify(t)):null;
  }
  function stats(type){
    const set=current(type);if(!set)return {templates:0,physicalTables:0,appendix:0,longPeriod:0};
    const list=set.templates||[];
    return {templates:list.length,physicalTables:Number(set.source&&set.source.physicalTableCount)||0,
      appendix:list.filter(x=>x.appendix).length,longPeriod:list.filter(x=>x.longPeriod).length};
  }
  root.ReportTableTemplates={load,current,baseline,config,applyOverrides,buildOverrides,forSection,appendix,renderTemplate,renderSection,renderAppendix,exportTemplate,preparedRows,stats};
  if(typeof module==="object"&&module.exports)module.exports=root.ReportTableTemplates;
})(typeof window!=="undefined"?window:globalThis);
