// 真 .docx 文档构建器 —— 浏览器与Node共用  
// payload = {
//   project:{name,owner,industry,location,scale}, signed, docNo,
//   chapters:[{cn,name,sections:[{title, blocks:[{type:"p",text}|{type:"table",rows:[[..],..]}]}]}],
//   appendix: {summaryLine, mainRows:[[..]..], sensRows:[[..]..]} | null
// }
(function(root, factory){
  if(typeof module!=="undefined" && module.exports){ module.exports = factory; }
  else { root.buildDocxDocument = factory; }
})(typeof self!=="undefined"? self : this, function(docx, payload){
  const D = docx;
  const FONT = { ascii:"SimSun", eastAsia:"SimSun", hAnsi:"SimSun", cs:"SimSun" };
  const LINE13 = { line: 312, lineRule: D.LineRuleType.AUTO }; // 1.3倍行距

  function run(text, opt){ return new D.TextRun(Object.assign({text:text, font:FONT}, opt||{})); }
  function bodyPara(text){
    return new D.Paragraph({
      children:[run(text,{size:24})],
      spacing: Object.assign({after:120}, LINE13),
      indent:{firstLine:480},
    });
  }
  function makeTable(rows){
    const border = {style:D.BorderStyle.SINGLE, size:4, color:"000000"};
    return new D.Table({
      alignment: D.AlignmentType.CENTER,
      width:{size:96, type:D.WidthType.PERCENTAGE},
      borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},
      rows: rows.map((cells,ri)=> new D.TableRow({
        children: cells.map(c=> new D.TableCell({
          shading: ri===0? {fill:"EEEEEE"} : undefined,
          margins:{top:60,bottom:60,left:110,right:110},
          children:[ new D.Paragraph({
            children:[run(String(c),{size:21, bold:ri===0})],
            spacing:{line:280, lineRule:D.LineRuleType.AUTO},
          })],
        })),
      })),
    });
  }
  function blockToElems(b){
    if(b.type==="table" && b.rows && b.rows.length) return [makeTable(b.rows), new D.Paragraph({children:[], spacing:{after:60}})];
    return [bodyPara(b.text||"")];
  }

  const children = [];

  /* ---------- 封面 ---------- */
  children.push(new D.Paragraph({
    children:[run(payload.project.name||"（未命名项目）",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, spacing:{before:4800, after:600, line:360, lineRule:D.LineRuleType.AUTO},
  }));
  children.push(new D.Paragraph({
    children:[run("可 行 性 研 究 报 告",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, spacing:{after:2400},
  }));
  const meta = [
    payload.project.owner? "建设/委托单位："+payload.project.owner : "",
    payload.project.industry? "报告领域："+payload.project.industry : "",
    payload.project.location? "建设地点："+payload.project.location : "",
    payload.project.scale? "投资规模："+payload.project.scale+"万元" : "",
  ].filter(Boolean);
  meta.forEach(m=> children.push(new D.Paragraph({children:[run(m,{size:24})], alignment:D.AlignmentType.CENTER, spacing:{after:120}})));
  children.push(new D.Paragraph({children:[run(new Date().toLocaleDateString("zh-CN"),{size:24})], alignment:D.AlignmentType.CENTER}));
  if(payload.docNo) children.push(new D.Paragraph({children:[run("文档编号："+payload.docNo,{size:21,color:"666666"})], alignment:D.AlignmentType.CENTER, spacing:{before:200}}));

  /* ---------- 目录页（可更新域，打开时Word提示更新即出页码） ---------- */
  children.push(new D.Paragraph({
    children:[run("目　　录",{size:44,bold:true})],
    alignment:D.AlignmentType.CENTER, pageBreakBefore:true, spacing:{after:400},
  }));
  const tocTab = [{type:D.TabStopType.RIGHT, position:D.TabStopPosition.MAX, leader:D.LeaderType.DOT}];
  const WNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  children.push(D.ImportedXmlComponent.fromXmlString(
    '<w:p '+WNS+'><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    +'<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    +'<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>'
    +'<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>'));
  payload.chapters.forEach((c,ci)=>{
    children.push(new D.Paragraph({
      tabStops:tocTab, spacing:{before:100, after:40, line:300, lineRule:D.LineRuleType.AUTO},
      children:[ run("第"+c.cn+"章　"+c.name,{size:24,bold:true}), run("\t"),
        new D.SimpleField("PAGEREF _tc"+ci+" \\h") ],
    }));
    c.sections.forEach((s,si)=>{
      children.push(new D.Paragraph({
        tabStops:tocTab, indent:{left:420}, spacing:{after:40, line:300, lineRule:D.LineRuleType.AUTO},
        children:[ run((c.num||ci+1)+"."+(si+1)+"　"+(s.title||""),{size:24}), run("\t"),
          new D.SimpleField("PAGEREF _tc"+ci+"_"+si+" \\h") ],
      }));
    });
  });
  children.push(D.ImportedXmlComponent.fromXmlString(
    '<w:p '+WNS+'><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    +'<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'));

  /* ---------- 正文 ---------- */
  payload.chapters.forEach((c,ci)=>{
    children.push(new D.Paragraph({
      heading: D.HeadingLevel.HEADING_1,
      children:[ new D.Bookmark({id:"_tc"+ci, children:[run("第"+c.cn+"章　"+c.name,{size:44,bold:true})]}) ],
      alignment:D.AlignmentType.CENTER, pageBreakBefore:true,
      spacing: Object.assign({after:360}, LINE13),
    }));
    c.sections.forEach((s,si)=>{
      children.push(new D.Paragraph({
        heading: D.HeadingLevel.HEADING_2,
        children:[ new D.Bookmark({id:"_tc"+ci+"_"+si, children:[run((c.num||ci+1)+"."+(si+1)+"　"+s.title,{size:28,bold:true})]}) ],
        spacing: Object.assign({before:280, after:160}, LINE13),
      }));
      (s.blocks||[]).forEach(b=> blockToElems(b).forEach(e=>children.push(e)));
    });
  });

  /* ---------- 附表 ---------- */
  if(payload.appendix){
    children.push(new D.Paragraph({
      heading: D.HeadingLevel.HEADING_1,
      children:[run("附表　财务测算明细（单位：万元）",{size:44,bold:true})],
      alignment:D.AlignmentType.CENTER, pageBreakBefore:true, spacing:{after:300},
    }));
    if(payload.appendix.summaryLine)
      children.push(new D.Paragraph({children:[run(payload.appendix.summaryLine,{size:24})], alignment:D.AlignmentType.CENTER, spacing:Object.assign({after:200},LINE13)}));
    if(payload.appendix.mainRows) children.push(makeTable(payload.appendix.mainRows));
    if(payload.appendix.sensRows){
      children.push(new D.Paragraph({children:[run("附表二　单因素敏感性分析",{size:24,bold:true})], spacing:{before:300, after:120}}));
      children.push(makeTable(payload.appendix.sensRows));
    }
  }

  /* ---------- 签发说明 ---------- */
  const signNote = payload.signed
    ? "本报告已经人工复核确认签发，签发日期："+new Date().toLocaleDateString("zh-CN")
    : "本报告为AI生成初稿，尚未经过人工复核签发，其中标注\u201c待填\u201d的数据须补充真实测算结果，正式使用前须完成审核。";
  // ===== 附图（图表PNG） =====
  // ===== 溯源附录：逐节生成依据与置信度（可追溯审计） =====
  if(payload.provenance && payload.provenance.rows && payload.provenance.rows.length > 1){
    children.push(new D.Paragraph({ children:[run("附：内容溯源与依据说明",{size:28,bold:true})],
      heading:D.HeadingLevel.HEADING_1, alignment:D.AlignmentType.CENTER,
      spacing:{before:400, after:200}, pageBreakBefore:true }));
    children.push(new D.Paragraph({ children:[run(payload.provenance.note,{size:20,color:"666666"})],
      spacing:{after:200} }));
    const rows = payload.provenance.rows;
    const table = new D.Table({
      width:{ size:100, type:D.WidthType.PERCENTAGE },
      rows: rows.map((r, ri)=> new D.TableRow({
        children: r.map(cell=> new D.TableCell({
          children:[ new D.Paragraph({ children:[run(String(cell==null?"":cell), { size: ri===0?19:18, bold: ri===0 })] }) ],
          shading: ri===0 ? { fill:"E8EEF5" } : undefined,
        })),
      })),
    });
    children.push(table);
  }

  if(payload.images && payload.images.length){
    children.push(new D.Paragraph({ children:[run("附　图",{size:28,bold:true})],
      heading:D.HeadingLevel.HEADING_1, alignment:D.AlignmentType.CENTER,
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

  /* ---------- 文档：页眉页脚+标题样式+自动更新域 ---------- */
  return new D.Document({
    features:{ updateFields:true },
    styles:{
      default:{ document:{ run:{ font:FONT, size:24 } } },
      paragraphStyles:[
        { id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:44, bold:true, font:FONT },
          paragraph:{ alignment:D.AlignmentType.CENTER, spacing:{before:0, after:360} } },
        { id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal", quickFormat:true,
          run:{ size:28, bold:true, font:FONT },
          paragraph:{ spacing:{before:280, after:160} } },
      ],
    },
    sections:[{
      properties:{ page:{ margin:{ top:1440, bottom:1440, left:1700, right:1700 } } },
      headers:{ default: new D.Header({ children:[ new D.Paragraph({
        children:[run(payload.project.name||"可行性研究报告",{size:18,color:"666666"})],
        alignment:D.AlignmentType.CENTER,
        border:{bottom:{style:D.BorderStyle.SINGLE,size:4,color:"999999",space:2}},
      })]})},
      footers:{ default: new D.Footer({ children:[ new D.Paragraph({
        alignment:D.AlignmentType.CENTER,
        children:[ run("— ",{size:18,color:"666666"}),
          new D.TextRun({children:[D.PageNumber.CURRENT], size:18, color:"666666", font:FONT}),
          run(" —",{size:18,color:"666666"}) ],
      })]})},
      children: children,
    }],
  });
});
