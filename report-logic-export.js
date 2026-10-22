/* 管理员逻辑快照 → 五张只读汇报表；不保存、不发布、不调用AI。 */
(function(root){
  'use strict';
  const LABELS={rent:'出租类',housing_conversion:'非居改保、居改居等（住房改造）',commercial_renovation:'商业改造（自持改造）'};
  const SOURCE_LABELS={knowledge_base:'知识库',web_search:'网上检索',provider:'数据接口',manual_upload:'人工材料',calculation_engine:'测算引擎',derived_section:'其他章节',system_rule:'系统规则'};
  const LIMIT=32000;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
  const text=value=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
  function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value);}
  function scopes(snapshot){
    if(!snapshot||!Array.isArray(snapshot.sets))throw new Error('服务器未返回有效的逻辑快照');
    return snapshot.sets.flatMap(set=>set.projectType==='gaibao'?['housing_conversion','commercial_renovation'].map(key=>({key,label:LABELS[key],projectType:'gaibao',businessScenario:key})):[{key:set.projectType,label:LABELS[set.projectType]||set.name||set.projectType,projectType:set.projectType,businessScenario:''}]);
  }
  function projection(set,scope,effective){
    if(!set?.data||!Array.isArray(set.data.rules))throw new Error('逻辑版本内容不完整，无法导出：'+scope.key);
    const raw=clone(set.data);raw.projectType=set.projectType;
    const data=effective?root.ReportWritingPolicy.normalize(raw):raw;
    const rules=data.rules.filter(rule=>set.projectType!=='gaibao'||!Array.isArray(rule.scenarios)||rule.scenarios.includes(scope.key)).map(rule=>{
      const out={...rule,...(set.projectType==='gaibao'?rule.scenarioVariants?.[scope.key]:{})};
      delete out.scenarioVariants;delete out.scenarios;return out;
    });
    // Use the same chapter ordering as the admin editor when it is available.
    const compare=root.ReportLogicAdminTools?.compareRules;
    if(compare&&set.projectType==='gaibao')rules.sort((a,b)=>compare(a,b,data.structure?.scenarioStructures?.[scope.key]?.chapterNames||[]));
    const ids=new Set();for(const rule of rules){if(!rule.id||ids.has(rule.id))throw new Error('逻辑点缺少唯一编号，无法可靠导出或比较：'+scope.label);ids.add(rule.id);}
    return {data,rules};
  }
  function date(value){if(!value)return '未记录';const d=new Date(Number.isFinite(Number(value))?Number(value):value);return Number.isNaN(d.getTime())?'未记录':d.toISOString();}
  function chunks(value){const s=text(value),out=[];for(let at=0;at<s.length;){let end=Math.min(at+LIMIT,s.length);if(end<s.length&&/[\uD800-\uDBFF]/.test(s[end-1]))end--;out.push(s.slice(at,end));at=end;}return out.length?out:[''];}
  function sheet(name,headers,widths){return {name,rows:[[...headers,'文本分段']],widths:[...widths,12]};}
  function add(target,values){const parts=values.map(chunks),count=Math.max(...parts.map(p=>p.length));for(let i=0;i<count;i++)target.rows.push(parts.map((p,index)=>p[i]??(index<3?p[0]:'')).concat((i+1)+'/'+count));}
  function changes(before,after,prefix=''){
    if(stable(before)===stable(after))return [];
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(key=>changes(before[key],after[key],prefix?prefix+'.'+key:key));
    return [{field:prefix,old:text(before),value:text(after)}];
  }
  function build(snapshot,keys,options={}){
    if(!root.ReportWritingPolicy||!root.ReportWritingStandard)throw new Error('逻辑导出依赖未加载，请刷新后台后重试');
    if(snapshot?.runtime&&(snapshot.runtime.writingStandardVersion!==root.ReportWritingStandard.VERSION||snapshot.runtime.writingRuleVersion!==root.ReportWritingStandard.RULE_VERSION))throw new Error('后台页面与服务器的成稿标准版本不同，请刷新后台后重新下载');
    const available=scopes(snapshot),selected=[...new Set(keys||[])];
    if(!selected.length)throw new Error('请至少选择一种报告类型');
    const exportedAt=date(options.exportedAt||new Date().toISOString());
    const overview=sheet('版本总览',['报告类型/场景','状态','业务逻辑版本','数据库版本','发布时间（UTC）','发布人ID','快照读取时间（UTC）','导出时间（UTC）','逻辑点数','对比基线','版本ID','原始来源','说明','章节数','小节数'],[34,26,18,15,27,14,27,27,12,22,40,40,90,12,12]);
    const globalSheet=sheet('全篇逻辑',['报告类型/场景','状态','数据库版本','业务逻辑版本','当前生效全文要求','原存储全篇配置JSON','说明'],[34,26,15,18,110,65,75]);
    const detail=sheet('章节与小节逻辑',['报告类型/场景','状态','逻辑点ID','章节','小节','细分小节','逻辑点/显示标题','所需资料','资料获取渠道','当前执行写作逻辑','输出形式','缺失处理','重要性','生成方式','备注','适用限制','顺序号','父逻辑点','原存储逻辑点JSON'],[34,26,30,30,42,42,40,70,35,110,50,60,16,20,60,35,12,30,75]);
    const standard=sheet('专业成稿标准',['报告类型/场景','状态','标准项','配置来源','完整要求/示例','结构版本','执行规则版本','原存储配置JSON'],[34,26,36,34,110,34,25,75]);
    const diff=sheet('版本变化',['报告类型/场景','当前状态','对比基线','变化类型','逻辑点ID/范围','字段','上一版原文','当前原文','比较说明'],[34,26,25,18,36,36,95,95,80]);
    for(const key of selected){
      const scope=available.find(item=>item.key===key);if(!scope)throw new Error('所选类型已不可用，请重新选择：'+key);
      const published=snapshot.sets.find(set=>set.projectType===scope.projectType);
      const isDraft=options.draft?.scope===key;
      if(options.draft&&!isDraft)throw new Error('编辑稿只能下载当前编辑的一个场景');
      const set=isDraft?options.draft.set:published;
      if(set.projectType!==scope.projectType)throw new Error('编辑稿类型与当前选择不一致');
      const status=isDraft?'编辑稿（未发布、未保存）':'最新已发布';
      const previous=isDraft?published:set.previous;
      const current=projection(set,scope,true),raw=projection(set,scope,false),version=current.data.logicVersions?.[key]||'未单独登记';
      const baseline=previous?'数据库v'+previous.version+(isDraft?'（当前已发布）':'（上一已发布）'):'无上一已发布版本';
      add(overview,[scope.label,status,version,set.version,date(isDraft?null:set.publishedAt),isDraft?'未发布':set.createdBy,snapshot.capturedAt,exportedAt,current.rules.length,baseline,set.id,set.sourceName,'导出后台通用规则。正文按当前程序规范投影；原存储JSON保留原文。项目临时覆盖、表格模板、财务公式、审核规则不在本次范围。时间均为UTC。章/节按逻辑点归属去重，细分逻辑点另计。',new Set(current.rules.map(r=>r.chapter)).size,new Set(current.rules.map(r=>JSON.stringify([r.chapter,r.section]))).size]);
      add(globalSheet,[scope.label,status,set.version,version,current.data.globalRequirements?.[key]||'',JSON.stringify(set.data.globalRequirements??null),'全篇要求按现有共享规则解析；原配置未被修改。章节表按逻辑点逐行，数量不等于报告目录小节数。原存储JSON列默认隐藏，可在Excel取消隐藏；超长单元格可在编辑栏查看全文，超过单元格上限按文本分段连续保留。']);
      for(const rule of current.rules){
        const original=set.data.rules.find(item=>item.id===rule.id);
        add(detail,[scope.label,status,rule.id,rule.chapter,rule.section,rule.subsection,[rule.pointTitle,rule.displayTitle].filter(Boolean).join('\n'),rule.requiredSources,Array.isArray(rule.sourceKinds)?rule.sourceKinds.map(kind=>SOURCE_LABELS[kind]||kind).join('；'):rule.sourceKinds,rule.writingLogic,rule.outputForm,rule.missingPolicy,rule.importance,rule.generationMode,rule.note,rule.projectSpecific?'项目特例（仅在匹配项目时适用）':'通用',rule.sourceNo,rule.parentRuleId,JSON.stringify(original)]);
      }
      const cfg=current.data.writingStandard,norm=root.ReportWritingStandard.normalize(cfg),sv=root.ReportWritingStandard.VERSION,rv=root.ReportWritingStandard.RULE_VERSION;
      const source=(obj,field)=>own(obj,field)?'后台保存配置':'当前程序默认（未单独保存）';
      add(standard,[scope.label,status,'全篇行文标准',source(cfg,'globalInstructions'),norm.globalInstructions,sv,rv,JSON.stringify(cfg??null)]);
      for(const id of root.ReportWritingStandard.PROFILE_IDS){const profile=root.ReportWritingStandard.sectionProfile({profileId:id},norm);for(const field of ['instructions','example'])add(standard,[scope.label,status,profile.label+(field==='instructions'?'—要求':'—示例'),source(cfg?.profiles?.[id],field),profile[field],sv,rv,'']);add(standard,[scope.label,status,profile.label+'—完整执行说明','共享标准模块原文，含段落职责和执行边界',root.ReportWritingStandard.prompt(cfg,{profileId:id}),sv,rv,'']);}
      add(standard,[scope.label,status,'直接成稿硬要求','当前程序强制规则',root.ReportWritingStandard.DIRECT_BUSINESS,sv,rv,'']);
      if(!previous){add(diff,[scope.label,status,baseline,'无历史基线','整套规则','','','','历史中未找到上一真实发布版，不推测变更。']);continue;}
      const old=projection(previous,scope,false),before=new Map(old.rules.map(rule=>[rule.id,rule])),after=new Map(raw.rules.map(rule=>[rule.id,rule]));let count=0;
      const note='逐字比较存储配置；不套用当前默认值重构历史运行效果。原配置缺失不等于当时无系统默认规则。';
      const emit=(kind,id,field,a,b)=>{count++;add(diff,[scope.label,status,baseline,kind,id,field,a,b,note]);};
      for(const id of new Set([...before.keys(),...after.keys()])){const a=before.get(id),b=after.get(id);if(!a)emit('新增',id,'完整逻辑点','',JSON.stringify(b));else if(!b)emit('删除',id,'完整逻辑点',JSON.stringify(a),'');else for(const delta of changes(a,b))emit('修改',id,delta.field,delta.old,delta.value);}
      for(const field of ['globalRequirements','logicVersions'])for(const delta of changes(old.data[field]?.[key],raw.data[field]?.[key],field))emit('修改','全篇配置',delta.field,delta.old,delta.value);
      for(const delta of changes(old.data.writingStandard,raw.data.writingStandard,'writingStandard'))emit('修改','专业成稿标准',delta.field,delta.old,delta.value);
      const selectedStructure=data=>set.projectType==='gaibao'?data.structure?.scenarioStructures?.[key]:data.structure;
      for(const delta of changes(selectedStructure(old.data),selectedStructure(raw.data),'structure'))emit('修改','所选场景目录结构',delta.field,delta.old,delta.value);
      if(!count)add(diff,[scope.label,status,baseline,'无文本变化','所选场景','','','','所选场景的逻辑点、全篇配置、成稿配置和目录结构未发生存储文本变化；不代表历史程序版本相同。']);
    }
    const suffix=options.draft?'编辑稿_未发布未保存':'最新已发布';
    return {filename:'可研编制逻辑_'+(selected.length===1?(LABELS[selected[0]]||selected[0]).replace(/[\\/:*?"<>|]/g,'_'):'批量'+selected.length+'类')+'_'+suffix+'_'+exportedAt.replace(/[-:]/g,'').slice(0,15)+'.xlsx',sheets:[overview,globalSheet,detail,standard,diff]};
  }
  async function load(path,check){if(check())return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=path;const timer=setTimeout(()=>{script.remove();reject(new Error('导出组件加载超时，请手动重试'));},15000);script.onload=()=>{clearTimeout(timer);check()?resolve():reject(new Error('导出组件未正确加载'));};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('导出组件加载失败，请检查本地站点文件'));};document.head.append(script);});}
  async function serialize(model,XLSX,JSZip){
    const book=XLSX.utils.book_new();
    for(const part of model.sheets){const ws=XLSX.utils.aoa_to_sheet(part.rows);ws['!cols']=part.widths.map((wch,i)=>({wch,hidden:/JSON$/.test(part.rows[0][i])}));ws['!autofilter']={ref:ws['!ref']};ws['!rows']=part.rows.map((row,i)=>({hpt:i?Math.min(409,Math.max(34,...row.map((cell,col)=>ws['!cols'][col].hidden?0:text(cell).split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(Array.from(line).reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0)/Math.max(8,part.widths[col]-3))),0)*16+8))):44}));XLSX.utils.book_append_sheet(book,ws,part.name);}
    const zip=await JSZip.loadAsync(XLSX.write(book,{bookType:'xlsx',type:'array',compression:true}));
    // SheetJS CE preserves data and widths; add standard OOXML styles/freeze for readable long text.
    zip.file('xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FF25384A"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245477"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    for(let i=1;i<=model.sheets.length;i++){const path='xl/worksheets/sheet'+i+'.xml';let xml=await zip.file(path).async('string');xml=xml.replace(/<c\b([^>]*)>/g,(_,attrs)=>'<c'+attrs.replace(/\s+s="[^"]*"/g,'')+' s="'+(/\br="[A-Z]+1"/.test(attrs)?1:0)+'">');xml=xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,'<sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>');zip.file(path,xml);}
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  async function download(snapshot,keys,options){const model=build(snapshot,keys,options);await load('xlsx.full.min.js',()=>!!root.XLSX);await load('assets/vendor/jszip-3.10.1.min.js',()=>!!root.JSZip);const bytes=await serialize(model,root.XLSX,root.JSZip),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=model.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return {filename:model.filename};}
  const api={scopes,build,serialize,download};root.ReportLogicExport=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
