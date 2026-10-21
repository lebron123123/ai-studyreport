// 真 .docx 文档构建器 —— 浏览器与Node共用    
// payload = {
//   project:{name,owner,industry,location,scale}, signed, docNo,
//   chapters:[{cn,name,sections:[{title, blocks:[{type:"p",text}|{type:"table",rows:[[..],..]}]}]}],
//   appendix: {summaryLine, mainRows:[[..]..], sensRows:[[..]..]} | null
// }
(function(root, factory){
  // Versioned layout identity is embedded in the DOCX and bound to its exact
  // bytes by the server's pagination receipt; caller payloads cannot override it.
  factory.templateVersion = 'report-docx-20261013-cover-metadata-v7';
  if(typeof module!=="undefined" && module.exports){ module.exports = factory; }
  else { root.buildDocxDocument = factory; }
})(typeof self!=="undefined"? self : this, function(docx, payload){
  const D = docx;
  const outputPolicy=typeof module!=="undefined"&&module.exports?require('./report-output-policy.js'):window.ReportOutputPolicy;
  const coverMetadata=typeof module!=="undefined"&&module.exports?require('./report-cover-metadata.js'):window.ReportCoverMetadata;
  if(!coverMetadata)throw new Error('封面元数据模块未加载，请刷新后重试；原报告未更改。');
  const FONT = { ascii:"SimSun", eastAsia:"SimSun", hAnsi:"SimSun", cs:"SimSun" };
  const LINE13 = { line: 312, lineRule: D.LineRuleType.AUTO }; // 1.3倍行距
  const PAGE_WIDTH=11906, PAGE_HEIGHT=16838, TEXT_WIDTH=PAGE_WIDTH-3400;
  let reportBookmarkId=1;
  const reportListNumbering=[];
  function bookmarkedRuns(name,runs){
    const id=reportBookmarkId++;
    return [new D.BookmarkStart(name,id),...runs,new D.BookmarkEnd(id)];
  }
  function importedParagraph(xml){
    // The bundled parser returns a document wrapper (rootKey=undefined), not
    // the requested element. Inserting the wrapper creates invalid <undefined>.
    const imported=D.ImportedXmlComponent.fromXmlString(xml);
    return imported.rootKey?imported:imported.root[0];
  }
  function tableWidths(weights){
    const total=weights.reduce((sum,w)=>sum+w,0)||weights.length;
    const widths=weights.map(w=>Math.floor(w/total*TEXT_WIDTH));
    if(widths.length)widths[widths.length-1]+=TEXT_WIDTH-widths.reduce((sum,w)=>sum+w,0);
    return widths;
  }

  // 报告成稿统一黑字；保留待补标记和加粗，不沿用编辑态强调色。
  function run(text, opt){ return new D.TextRun(Object.assign({text:text, font:FONT}, opt||{}, {color:/^【待补\s*(?:：|:)?[^】]*】$/.test(String(text))?"C62828":"000000"})); }
  function cleanWordText(text){
    return outputPolicy.cleanText(text).replace(/\u00a0/g," ").replace(/[\t ]+/g," ").replace(/\s+([，。；：！？、）】])/g,"$1").replace(/([（【])\s+/g,"$1").trim();
  }
  function textRuns(text,opt){
    const value=cleanWordText(text),parts=value.split(/(【待补\s*(?:：|:)?[^】]*】)/g).filter(Boolean);
    return parts.flatMap(part=>part.split('\n').map((line,index)=>run(line,Object.assign({},opt||{},/^【待补\s*(?:：|:)?[^】]*】$/.test(part)?{color:"C62828",bold:true}:{},index?{break:1}:{}))));
  }
  function bodyPara(text,keepNext){
    return new D.Paragraph({
      children:textRuns(text,{size:24}),
      keepNext:keepNext||undefined,
      spacing: Object.assign({before:0,after:0}, LINE13),
      indent:{firstLine:480},
    });
  }
  function legacyTableCaption(block,next){
    // Old saved exports use plain paragraphs for short table names. Keep only
    // these labels with the next table; do not glue its preceding analysis to it.
    if(block.type!=='p'||next?.type!=='table'||!next.rows?.length)return false;
    const text=cleanWordText(block.text);
    if(text.length>80||/[\r\n]/.test(text)||/^(?:详见|参见|见|请参阅|如下|说明|注[：:])/.test(text))return false;
    return /^[^。！？!?；;：:\r\n]+表(?:[（(][^（）()\r\n]{1,24}[）)])?$/.test(text)
      ||/^表\s*(?:\d+(?:[.．-]\d+)*|[一二三四五六七八九十]+)[\s、．.：:]+[^。！？!?；;\r\n]+$/.test(text);
  }
  function listElems(block,depth=0){
    const level=Math.min(8,depth),reference='report-list-'+(reportListNumbering.length+1);
    const ordered=block.ordered===true,start=Number(block.start);
    reportListNumbering.push({reference,levels:Array.from({length:9},(_,index)=>({
      level:index,format:ordered?D.LevelFormat.DECIMAL:D.LevelFormat.BULLET,
      text:ordered?'%'+(index+1)+'.':'\u2022',alignment:D.AlignmentType.LEFT,
      start:index===level&&Number.isInteger(start)&&start>0?start:1,
      style:{paragraph:{indent:{left:480*(index+1),hanging:240}},run:{font:FONT,color:'000000',size:24}},
    }))});
    const result=[];
    for(const item of block.items||[]){
      const itemBlocks=typeof item==='string'?[{type:'p',text:item}]:Array.isArray(item?.blocks)?item.blocks:[{type:'p',text:item?.text||''}];
      const first=itemBlocks[0]?.type==='p'?itemBlocks[0]:null;
      result.push(new D.Paragraph({children:textRuns(first?.text||'',{size:24}),
        numbering:{reference,level},spacing:Object.assign({before:0,after:0},LINE13)}));
      for(const inner of itemBlocks.slice(first?1:0)){
        if(inner.type==='list')result.push(...listElems(inner,depth+1));
        else if(inner.type==='p')result.push(new D.Paragraph({children:textRuns(inner.text||'',{size:24}),
          indent:{left:480*(level+1)},spacing:Object.assign({before:0,after:0},LINE13)}));
        else result.push(...blockToElems(inner));
      }
    }
    return result;
  }
  function makeTable(rows,weights,fontSize){
    const border = {style:D.BorderStyle.SINGLE, size:4, color:"000000"};
    const count=Math.max(...rows.map(r=>r.length)),widths=tableWidths(weights||Array(count).fill(1));
    return new D.Table({
      alignment: D.AlignmentType.CENTER,
      width:{size:TEXT_WIDTH, type:D.WidthType.DXA},columnWidths:widths,layout:D.TableLayoutType.FIXED,
      borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},
      rows: rows.map((cells,ri)=> new D.TableRow({
        tableHeader:ri===0,
        cantSplit:true,
        children: Array.from({length:count},(_,ci)=> new D.TableCell({
          width:{size:widths[ci],type:D.WidthType.DXA},
          shading: ri===0? {fill:"EEEEEE",type:D.ShadingType.CLEAR} : undefined,
          margins:{top:60,bottom:60,left:110,right:110},
          children:[ new D.Paragraph({
            children:textRuns(String(cells[ci]??""),{size:fontSize||21, bold:ri===0}),
            spacing:{line:280, lineRule:D.LineRuleType.AUTO},
          })],
        })),
      })),
    });
  }
  function preparedTemplateRows(segment){
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
  function makeTemplateTable(template,segment){
    const border={style:D.BorderStyle.SINGLE,size:4,color:"666666"};
    const sourceWidths=(segment.gridWidths||[]).map(Number);
    const tableWidth=TEXT_WIDTH;
    const widths=sourceWidths.length?tableWidths(sourceWidths.map(w=>Number.isFinite(w)&&w>0?w:1)):[];
    const rows=preparedTemplateRows(segment);
    return new D.Table({
      alignment:D.AlignmentType.CENTER,
      width:{size:tableWidth,type:D.WidthType.DXA},
      columnWidths:widths,
      layout:D.TableLayoutType.FIXED,
      borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},
      rows:rows.map((row,ri)=>new D.TableRow({
        tableHeader:ri===0,
        cantSplit:true,
        children:row.cells.filter(c=>c.vMerge!=="continue").map(c=>{
          const start=Math.max(0,Number(c.col)||0),span=Math.max(1,Number(c.colSpan)||1);
          const cellWidth=widths.length?widths.slice(start,start+span).reduce((a,b)=>a+b,0):undefined;
          return new D.TableCell({
            columnSpan:span>1?span:undefined,
            rowSpan:Number(c.rowSpan)>1?Number(c.rowSpan):undefined,
            width:cellWidth?{size:cellWidth,type:D.WidthType.DXA}:undefined,
            shading:ri===0?{fill:"E8F0F7",type:D.ShadingType.CLEAR}:undefined,
            verticalAlign:D.VerticalAlign.CENTER,
            margins:{top:42,bottom:42,left:55,right:55},
            children:[new D.Paragraph({
              alignment:D.AlignmentType.CENTER,
              children:textRuns(String(c.text||""),{size:template.longPeriod?14:18,bold:ri===0}),
              spacing:{line:template.longPeriod?220:250,lineRule:D.LineRuleType.AUTO},
            })],
          });
        }),
      })),
    });
  }
  function templateTableElems(template){
    const out=[];
    (template.segments||[]).forEach((segment,index)=>{
      out.push(new D.Paragraph({
        children:textRuns(index?template.title+"（续表"+index+"）":template.title,{size:22,bold:true}),
        alignment:D.AlignmentType.CENTER,
        keepNext:true,
        pageBreakBefore:!!(template.longPeriod&&index>0),
        spacing:{before:index?0:180,after:100},
      }));
      out.push(makeTemplateTable(template,segment));
    });
    return out;
  }
  function blockToElems(b,next){
    if(b.type==='list'&&Array.isArray(b.items))return listElems(b);
    if(b.type==="tableCaption" && b.text) return [new D.Paragraph({
      children:textRuns(b.text,{size:24,bold:true}),alignment:D.AlignmentType.CENTER,
      keepNext:true,spacing:{before:120,after:80}
    })];
    if(b.type==="table" && b.rows && b.rows.length) return [makeTable(b.rows)];
    if(b.type==="templateTable" && b.template) return templateTableElems(b.template);
    if(b.type==="logic" && b.text) return [new D.Paragraph({
      children:textRuns(b.text,{size:19,color:"24814D"}),
      shading:{fill:"EAF7EE"},border:{left:{color:"55A46D",size:12,space:6,style:D.BorderStyle.SINGLE}},
      spacing:{before:40,after:120,line:310,lineRule:D.LineRuleType.AUTO}
    })];
    // 小标题：正文里的 ## 三级标题，加粗略大，与正文拉开层次
    if(b.type==="h" && b.text) return [new D.Paragraph({
      heading:D.HeadingLevel['HEADING_'+Math.min(6,Math.max(3,Number(b.level)||3))],keepNext:true,
      children:textRuns(b.text,{size:24, bold:true}),
      spacing:{before:160, after:80, line:360, lineRule:D.LineRuleType.AUTO},
    })];
    return cleanWordText(b.text)?[bodyPara(b.text,legacyTableCaption(b,next))]:[];
  }

  const children = [];

  /* ---------- 封面 ---------- */
  children.push(new D.Paragraph({
    children:[run(payload.project.name||"（未命名项目）",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, spacing:{before:4800, after:600, line:360, lineRule:D.LineRuleType.AUTO},
  }));
  children.push(new D.Paragraph({
    children:[run(payload.documentTitle||"可 行 性 研 究 报 告",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, spacing:{after:2400},
  }));
  const meta=coverMetadata.resolve(payload.project,payload.coverContext).lines;
  meta.forEach(m=> children.push(new D.Paragraph({children:textRuns(m,{size:24}), alignment:D.AlignmentType.CENTER, spacing:{after:120}})));
  children.push(new D.Paragraph({children:[run(payload.documentDate||new Date().toLocaleDateString("zh-CN"),{size:24})], alignment:D.AlignmentType.CENTER}));
  if(payload.docNo) children.push(new D.Paragraph({children:[run("文档编号："+payload.docNo,{size:21,color:"666666"})], alignment:D.AlignmentType.CENTER, spacing:{before:200}}));
  if(payload.versionNote)children.push(new D.Paragraph({children:[run(payload.versionNote,{size:20,color:"666666"})],alignment:D.AlignmentType.CENTER,spacing:{before:120}}));

  /* ---------- 原生目录：下载服务必须更新并保存域结果，不交付空缓存 ---------- */
  children.push(new D.Paragraph({
    children:[run("目　　录",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, pageBreakBefore:true, spacing:{after:400},
  }));
  // Use the standard TOC content control so Word/WPS expose their native
  // update-table command. The renderer supplies linked titles and page caches.
  children.push(new D.TableOfContents('目录',{hyperlink:true,headingStyleRange:'1-2'}));

  /* ---------- 正文 ---------- */
  payload.chapters.forEach((c,ci)=>{
    children.push(new D.Paragraph({
      heading: D.HeadingLevel.HEADING_1,keepNext:true,
      children:bookmarkedRuns("_tc"+ci,textRuns("第"+c.cn+"章　"+c.name,{size:44,bold:true})),
      alignment:D.AlignmentType.CENTER, pageBreakBefore:true,
      spacing: Object.assign({after:360}, LINE13),
    }));
    c.sections.forEach((s,si)=>{
      children.push(new D.Paragraph({
        heading: D.HeadingLevel.HEADING_2,keepNext:true,
        children:bookmarkedRuns("_tc"+ci+"_"+si,textRuns((c.num||ci+1)+"."+(s.num||si+1)+"　"+s.title,{size:28,bold:true})),
        spacing: Object.assign({before:280, after:160}, LINE13),
      }));
      const blocks=outputPolicy.repairBlocks(s.blocks);
      blocks.forEach((b,index)=>blockToElems(b,blocks[index+1]).forEach(e=>children.push(e)));
      // Zero-width body-level bookmarks add no paragraph/space/page. WPS uses
      // this boundary to measure the real last page of this section, including
      // tables. Existing _tc bookmarks remain intact for the TOC.
      const endId=reportBookmarkId++;
      children.push(new D.BookmarkStart('_rp_end_'+ci+'_'+si,endId));
      children.push(new D.BookmarkEnd(endId));
    });
  });

  /* ---------- 附表 ---------- */
  if(payload.includeAppendices===true && payload.appendix){
    children.push(new D.Paragraph({
      heading: D.HeadingLevel.HEADING_1,keepNext:true,
      children:[run("附表　财务测算明细（单位：万元）",{size:44,bold:true})],
      alignment:D.AlignmentType.CENTER, pageBreakBefore:true, spacing:{after:300},
    }));
    if(payload.appendix.summaryLine)
      children.push(new D.Paragraph({children:textRuns(payload.appendix.summaryLine,{size:24}), alignment:D.AlignmentType.CENTER, spacing:Object.assign({after:200},LINE13)}));
    if(payload.appendix.mainRows) children.push(makeTable(payload.appendix.mainRows));
    if(payload.appendix.sensRows){
      children.push(new D.Paragraph({children:[run("附表二　单因素敏感性分析",{size:24,bold:true})], keepNext:true,spacing:{before:300, after:120}}));
      children.push(makeTable(payload.appendix.sensRows));
    }
  }
  if(payload.includeAppendices===true && payload.tableAppendix&&payload.tableAppendix.length){
    children.push(new D.Paragraph({
      heading:D.HeadingLevel.HEADING_1,keepNext:true,
      children:[run("出租类标准财务附表",{size:44,bold:true})],
      alignment:D.AlignmentType.CENTER,pageBreakBefore:true,spacing:{after:260},
    }));
    children.push(new D.Paragraph({
      children:[run("以下附表按原可研报告结构输出；项目专属数值由测算引擎和正式资料填充。70年长表采用同一逻辑表按年度区间自动续表。",{size:20,color:"666666"})],
      spacing:{after:180},
    }));
    payload.tableAppendix.forEach(t=>templateTableElems(t).forEach(e=>children.push(e)));
  }

  /* ---------- 签发说明 ---------- */
  const signNote = payload.signed
    ? "本报告已经人工复核确认签发，签发日期："+(payload.approvalDate||payload.documentDate||"见冻结版本复核记录")
    : (payload.unsignedNote||"本报告为AI生成初稿，尚未经过人工复核签发，其中标注\u201c待填\u201d的数据须补充真实测算结果，正式使用前须完成审核。");
  // ===== 附图（图表PNG） =====
  // ===== 溯源附录：逐节生成依据与置信度（可追溯审计） =====
  if(payload.includeAppendices===true && payload.provenance && payload.provenance.rows && payload.provenance.rows.length > 1){
    children.push(new D.Paragraph({ children:[run("附：内容溯源与依据说明",{size:28,bold:true})],
      heading:D.HeadingLevel.HEADING_1,keepNext:true, alignment:D.AlignmentType.CENTER,
      spacing:{before:400, after:200}, pageBreakBefore:true }));
    children.push(new D.Paragraph({ children:[run(payload.provenance.note,{size:20,color:"666666"})],
      spacing:{after:200} }));
    children.push(makeTable(payload.provenance.rows,[15,18,17,50],18));
  }

  if(payload.includeAppendices===true && payload.images && payload.images.length){
    children.push(new D.Paragraph({ children:[run("附　图",{size:28,bold:true})],
      heading:D.HeadingLevel.HEADING_1,keepNext:true, alignment:D.AlignmentType.CENTER,
      spacing:{before:400, after:200}, pageBreakBefore:true }));
    payload.images.forEach(im=>{
      children.push(new D.Paragraph({children:[run(im.title,{size:24,bold:true})], spacing:{before:240, after:120}}));
      try{
        const bin = typeof atob!=="undefined" ? atob(im.b64) : Buffer.from(im.b64,"base64").toString("binary");
        const bytes = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        children.push(new D.Paragraph({ alignment:D.AlignmentType.CENTER,
          children:[ new D.ImageRun({ type:"png", data: bytes, transformation:{ width: im.w||600, height: im.h||200 } }) ],
          spacing:{after:200} }));
      }catch(e){
        children.push(new D.Paragraph({children:[run("（图表嵌入失败："+e.message+"）",{size:21,color:"888888"})]}));
      }
    });
  }

  children.push(new D.Paragraph({children:[run(signNote,{size:21,color:"888888"})], spacing:{before:600}}));

  // Word/WPS joins directly adjacent tables into one logical table. Preserve
  // each source table with a normal empty paragraph only at those boundaries;
  // existing prose/captions and all table formatting stay untouched.
  const separatedChildren=[];
  children.forEach(child=>{
    if(child instanceof D.Table && separatedChildren[separatedChildren.length-1] instanceof D.Table)
      separatedChildren.push(new D.Paragraph({}));
    separatedChildren.push(child);
  });

  /* ---------- 文档：页眉页脚+标题样式+自动更新域 ---------- */
  return new D.Document({
    customProperties:[
      {name:'ReportTemplateVersion',value:'report-docx-20261013-cover-metadata-v7'},
      {name:'ReportContentRulesVersion',value:String(outputPolicy.contentVersion||'unknown')},
    ],
    features:{ updateFields:true },
    numbering:{config:reportListNumbering},
    styles:{
      default:{ document:{ run:{ font:FONT, size:24, color:"000000" },paragraph:{spacing:Object.assign({before:0,after:0},LINE13)} },
        heading1:{run:{size:44,bold:true,font:FONT,color:"000000"},paragraph:{keepNext:true,outlineLevel:0,alignment:D.AlignmentType.CENTER,spacing:{before:0,after:360}}},
        heading2:{run:{size:28,bold:true,font:FONT,color:"000000"},paragraph:{keepNext:true,outlineLevel:1,spacing:{before:280,after:160}}},heading3:{run:{color:"000000"},paragraph:{keepNext:true,outlineLevel:2}},
        heading4:{run:{color:"000000"},paragraph:{keepNext:true,outlineLevel:3}},heading5:{run:{color:"000000"},paragraph:{keepNext:true,outlineLevel:4}},heading6:{run:{color:"000000"},paragraph:{keepNext:true,outlineLevel:5}},
        hyperlink:{run:{color:"000000"}} },
      paragraphStyles:[
        {id:'TOC1',name:'toc 1',basedOn:'Normal',next:'Normal',run:{size:24,bold:true,font:FONT,color:'000000'},paragraph:{tabStops:[{type:D.TabStopType.RIGHT,position:TEXT_WIDTH,leader:D.LeaderType.DOT}],spacing:{before:100,after:40,line:300,lineRule:D.LineRuleType.AUTO}}},
        {id:'TOC2',name:'toc 2',basedOn:'Normal',next:'Normal',run:{size:24,font:FONT,color:'000000'},paragraph:{tabStops:[{type:D.TabStopType.RIGHT,position:TEXT_WIDTH,leader:D.LeaderType.DOT}],indent:{left:420},spacing:{after:40,line:300,lineRule:D.LineRuleType.AUTO}}},
      ],
    },
    sections:[{
      properties:{ page:{size:{width:PAGE_WIDTH,height:PAGE_HEIGHT}, margin:{ top:1440, bottom:1440, left:1700, right:1700 } } },
      headers:{ default: new D.Header({ children:[ new D.Paragraph({
        children:[run(payload.project.name||"可行性研究报告",{size:18,color:"666666"})],
        alignment:D.AlignmentType.CENTER,
        border:{bottom:{style:D.BorderStyle.SINGLE,size:4,color:"999999",space:2}},
      })]})},
      footers:{ default: new D.Footer({ children:[ new D.Paragraph({
        alignment:D.AlignmentType.CENTER,
        children:[ run("— ",{size:18,color:"666666"}),
          new D.TextRun({children:[D.PageNumber.CURRENT], size:18, color:"000000", font:FONT}),
          run(" —",{size:18,color:"666666"}) ],
      })]})},
      children: separatedChildren,
    }],
  });
});
