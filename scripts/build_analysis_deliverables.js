const fs=require('fs');
const path=require('path');
const XLSX=require('../xlsx.full.min.js');
const D=require('../docx.umd.js');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'outputs','019fe95d-4fb5-7062-acda-55e1dbe65d29');
fs.mkdirSync(OUT,{recursive:true});
const generated='2026-08-13';

const items=[
  {n:1,name:'项目1/3/5km圈层数据包',added:'新增项目坐标确认、1/3/5km圈层切换、Haversine直线距离计算和圈层筛选；正式快照记录采用圈层。',housing:'以项目坐标和分析半径组织人口、市场与POI模块；地图和指标使用同一空间范围。',ours:'用统一scopeKm和项目经纬度驱动全部本地白箱分析；没有在线地图也能计算。',tools:'原生JavaScript、Haversine、PostgreSQL、REST API',files:'analysis-core.js:47-57、98-103；analysis-workbench.js:2-19；functions/api/projectanalysis.js:40-53',data:'需要项目经纬度；圈层框架无数据也可使用',test:'tests/analysis-core.test.js：已知坐标距离与圈层归类',status:'已完成框架与算法'},
  {n:2,name:'人口和目标客群画像',added:'新增居住人口、工作人口、密度，以及年龄、性别、学历、产业人才、收入、租住人口等画像指标目录。',housing:'分开管理居住人口与工作人口，使用人口卡片和结构指标展示目标客群。',ours:'只对管理员审核通过的数据计算；缺少画像维度时明确显示待补数据，不让AI补数。',tools:'指标目录、白箱计算、Excel/CSV Provider',files:'analysis-core.js:6-29、59-65；analysis-providers.js；analysis-workbench.js:10-13',data:'需要人口指标Excel/CSV；目前尚无真实项目数据',test:'tests/analysis-core.test.js：未审核数据隔离、人口密度',status:'已完成能力，待真实数据'},
  {n:3,name:'可解释的职住平衡结论',added:'新增职住比、内部通勤率、就业自足率、居住自足率、净通勤流入和透明区间解释。',housing:'核心卡片包括居住人口密度、工作人口密度、职住比和内部通勤比。',ours:'公式、输入和解释同时输出；0.6/0.9/1.1/1.6边界可复核，不由AI自由判断。',tools:'白箱规则引擎、指标快照',files:'analysis-core.js:66-75；analysis-workbench.js:12-13',data:'至少需要居住人口、工作人口；自足率还需通勤指标',test:'tests/analysis-core.test.js：公式和区间边界',status:'已完成能力，待真实数据'},
  {n:4,name:'通勤来源和去向分析',added:'新增OD流量数据表、来源地/去向地TOP10、总流量和审核隔离。',housing:'支持工作地—居住地、居住地—工作地等OD方向和TOP列表。',ours:'OD作为独立结构化数据，不用POI代替真实通勤；没有OD时明确不可分析。',tools:'OD Provider、PostgreSQL、聚合排序',files:'analysis-core.js:76-80；functions/api/projectanalysis.js:29-39；analysis-workbench.js:15-18',data:'需要合法OD表；当前无OD数据',test:'tests/analysis-core.test.js：TOP10只采用已审核流量',status:'已完成能力，待OD数据'},
  {n:5,name:'住房需求区间与供需缺口',added:'新增谨慎、基准、乐观三场景；计算潜在需求、总供给、净需求和缺口。',housing:'人口、就业、客群和住房供给共同支撑项目需求判断。',ours:'目标客群×租住倾向×资格覆盖×支付能力，再扣减有效与规划供给；缺一项即禁止正式结论。',tools:'场景白箱模型、缺失项守卫',files:'analysis-core.js:90-97；analysis-workbench.js:12-13',data:'需要目标客群、租住倾向、资格、支付能力、有效供给',test:'tests/analysis-core.test.js：无数据不造数、三场景单调性',status:'已完成能力，待真实数据'},
  {n:6,name:'周边交通教育医疗商业产业及负面设施',added:'新增八类POI、直线距离、最近设施、覆盖分、短板和负面设施预警。',housing:'POI按交通、医疗、教育、商业、景观、住房与负面设施分类并支持距离排序。',ours:'每个综合分都保留命中设施和距离，不能只给黑箱评分。',tools:'POI Provider、Haversine、可解释评分',files:'analysis-core.js:30-46、81-89；analysis-workbench.js:12-18',data:'需要POI名称、类别和经纬度',test:'tests/analysis-core.test.js：距离、短板、负面预警',status:'已完成能力，待POI数据'},
  {n:7,name:'数字文件/Sheet/单元格/统计期/版本溯源',added:'Excel导入自动保存文件名、Sheet和原始行单元格范围，并保留资料、版本、工作簿和审核状态字段。',housing:'各指标展示统计期和数据说明，业务图表与数据来源保持关联。',ours:'数字主值放结构化表；Wiki/RAG只存定义与依据。来源随快照和章节溯源保存。',tools:'SheetJS、正式资料ID、分析快照、PostgreSQL',files:'analysis-providers.js:4-13；analysis-workbench.js:17-18；functions/api/projectanalysis.js:23-39',data:'导入文件后自动形成来源链；正式资料ID可选',test:'tests/analysis-providers.test.js：五级来源字段保留',status:'已完成'},
  {n:8,name:'自动写入现有可研相关章节',added:'不是新增第二套可研生成；把正式分析快照作为上下文注入现有generateSection，并写入章节溯源。',housing:'统一分析结果对象供页面卡片、图表和报告模块共同读取。',ours:'只有official快照允许进入可研；不完整快照只用于预览，防止缺数结论污染正文。',tools:'现有可研生成、Agent上下文、章节溯源',files:'report.js:707-735；analysis-workbench.js:21；project-workflow.js:107-116',data:'需要形成正式分析快照',test:'tests/analysis-workflow.test.js：报告绑定分析快照',status:'已接入现有功能'},
  {n:9,name:'数据变化影响预演与选择性更新',added:'新增快照差异域、受影响章节标记、人工锁定保护和报告版本恢复时分析快照恢复。',housing:'同一份数据驱动页面和报告，数据变化后相关模块同步刷新。',ours:'人口/职住/需求/POI映射到相关可研章节；消防等无关章节不会被误伤。',tools:'哈希差异、章节关键词映射、项目工作流',files:'analysis-core.js:100-103；project-workflow.js:15-22、80-89；review.js:400-420',data:'至少需要前后两个分析快照',test:'tests/analysis-workflow.test.js：锁定、误伤排除、双快照绑定',status:'已完成'},
  {n:10,name:'未来中指或其他数据Provider接口',added:'新增manual、excel、local_database和future_external_api四类Provider契约；外部接口默认禁用。',housing:'人口、住宅、企业等前端模块通过专业Provider/API取得统一结构数据。',ours:'未来只替换数据获取层，不改白箱分析、审核、快照、Agent和可研章节链路。',tools:'Provider模式、统一字段标准、AgentCore工具注册',files:'analysis-providers.js:1-13；analysis-core.js:103-105；analysis-workbench.js:23',data:'本地三类可用；外部API待授权',test:'tests/analysis-providers.test.js：外部Provider默认禁用',status:'已完成接口预留'}
];

function font(run,size=22,bold=false,color='23364D'){run.font={name:'Microsoft YaHei',size,bold,color};return run;}
function tr(text,opt={}){return new D.TextRun({text,font:{name:'Microsoft YaHei'},size:opt.size||22,bold:!!opt.bold,color:opt.color||'23364D'});}
function para(text,opt={}){return new D.Paragraph({children:[tr(text,opt)],spacing:{before:opt.before||0,after:opt.after===undefined?120:opt.after,line:opt.line||300,lineRule:D.LineRuleType.AUTO},alignment:opt.align||D.AlignmentType.LEFT,heading:opt.heading});}
function bullet(text){return new D.Paragraph({children:[tr(text)],bullet:{level:0},spacing:{after:90,line:300,lineRule:D.LineRuleType.AUTO}});}
function table(rows,widths){const border={style:D.BorderStyle.SINGLE,size:3,color:'C9D8E6'};return new D.Table({width:{size:9360,type:D.WidthType.DXA},alignment:D.AlignmentType.CENTER,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:rows.map((row,ri)=>new D.TableRow({children:row.map((v,ci)=>new D.TableCell({width:{size:widths[ci],type:D.WidthType.DXA},shading:ri===0?{fill:'2F75B5'}:undefined,margins:{top:100,bottom:100,left:120,right:120},verticalAlign:D.VerticalAlign.CENTER,children:[new D.Paragraph({children:[tr(String(v),{size:ri===0?19:18,bold:ri===0,color:ri===0?'FFFFFF':'23364D'})],spacing:{line:260,lineRule:D.LineRuleType.AUTO},alignment:ci===0?D.AlignmentType.CENTER:D.AlignmentType.LEFT})]}))}))});}
function footer(){return new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[tr('AI可研报告生成系统｜新增能力说明　', {size:18,color:'708399'}),new D.TextRun({children:[D.PageNumber.CURRENT],font:{name:'Microsoft YaHei'},size:18,color:'708399'})]})]});}

const docChildren=[];
docChildren.push(para('AI可研报告生成系统',{size:38,bold:true,color:'164A73',align:D.AlignmentType.CENTER,after:120}));
docChildren.push(para('人口、职住、需求与周边分析新增功能说明',{size:30,bold:true,color:'2F75B5',align:D.AlignmentType.CENTER,after:260}));
docChildren.push(para('本地部署版｜对照 Housing 成熟项目逻辑形成的首期能力底座',{size:20,color:'657A8F',align:D.AlignmentType.CENTER,after:520}));
docChildren.push(table([['文档用途','说明本轮新增了什么、现在能做什么、真实数据接入后怎样使用'],['编制日期',generated],['验证状态','141项自动化测试全部通过；前台入口已完成本地页面实测'],['重要边界','当前尚无真实项目人口/OD/POI数据，因此已完成能力和流程，不冒充已经形成真实项目结论']], [1800,7560]));
docChildren.push(para('一、这次总体上新增了什么',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:320,after:160}));
docChildren.push(para('以前系统的强项是测算、RAG/Wiki、审查和可研生成；这次增加的是一套“项目结构化数据分析底座”。它负责把人口、就业、通勤、需求和周边设施数据经过审核、白箱计算和版本固化，再交给已有可研生成与审查流程使用。', {after:160,line:320}));
['前台新增“项目数据分析”工作台，可在一个项目内管理坐标、圈层、数据导入、分析和来源。','后台新增“项目数据审核”，普通用户上传的数据必须审核通过后才参与正式分析。','新增人口、职住、OD通勤、住房需求和POI配套五类白箱分析。','新增分析快照，并与测算快照、报告版本共同绑定。','新增AgentCore诊断工具，让项目对话可以调用正式分析结果回答问题。','新增Provider适配层，将来接中指或其他数据服务时无需重写分析和报告流程。'].forEach(x=>docChildren.push(bullet(x)));
docChildren.push(para('二、10项新增能力一览',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:260,after:160}));
docChildren.push(table([['序号','新增能力','当前完成状态'],...items.map(x=>[x.n,x.name,x.status])],[850,5900,2610]));
docChildren.push(para('三、每项功能具体说明',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:280,after:120}));
for(const x of items){docChildren.push(para(x.n+'. '+x.name,{heading:D.HeadingLevel.HEADING_2,size:25,bold:true,color:'2F75B5',before:210,after:70}));docChildren.push(para('新增内容：'+x.added,{after:80}));docChildren.push(para('核心逻辑：'+x.ours,{after:80}));docChildren.push(para('使用条件：'+x.data,{after:80,color:'4F6478'}));}
docChildren.push(para('四、实际使用流程',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:280,after:140}));
['打开或创建项目，进入“项目数据分析”。','确认项目经纬度，并选择1km、3km或5km分析圈层。','下载人口指标、POI或OD模板，填入真实数据后上传。','上传记录进入待审核区，不参与正式分析。','管理员在后台“项目数据审核”中通过或驳回。','审核通过后查看人口、职住、需求、通勤和配套分析。','点击“形成正式分析快照”，系统固化来源、规则、圈层和结果。','生成或更新可研时，正式快照只注入相关章节；数据变化后仅标记受影响章节。'].forEach((x,i)=>docChildren.push(para((i+1)+'．'+x,{after:95})));
docChildren.push(para('五、当前还需要真实数据验证什么',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:280,after:140}));
docChildren.push(para('代码和流程已经具备，但没有真实项目数据时，系统不会生成看似精确的人口、职住和住房需求结论。下一步最有价值的工作不是继续扩功能，而是选择一个成熟项目，把人口、OD、POI和住房供给数据按模板接入，做一次完整端到端核验。',{after:160,line:320}));
['核对中指数据字段能否直接映射到现有指标键。','核对1/3/5km圈层和统计期是否与业务报告一致。','核对职住区间、需求乘数和POI评价半径是否需要深圳/公司版本。','核对分析正文与原可研报告结论是否一致，并记录差异原因。'].forEach(x=>docChildren.push(bullet(x)));
docChildren.push(para('六、测试与交付状态',{heading:D.HeadingLevel.HEADING_1,size:30,bold:true,color:'164A73',before:280,after:140}));
docChildren.push(table([['检查项','结果'],['本次新增专项测试','14项通过'],['项目完整自动化回归','141项通过，0失败'],['前台页面','项目数据分析入口已实测'],['后台页面','项目数据审核入口已加载；管理员二次验证继续生效'],['Git状态','本轮修改仍只在本地，未提交、未推送']], [3000,6360]));

const doc=new D.Document({features:{updateFields:true},styles:{default:{document:{run:{font:'Microsoft YaHei',size:22}}},paragraphStyles:[{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:30,bold:true,color:'164A73',font:'Microsoft YaHei'},paragraph:{spacing:{before:320,after:160}}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:25,bold:true,color:'2F75B5',font:'Microsoft YaHei'},paragraph:{spacing:{before:210,after:70}}}]},sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1080,bottom:1080,left:1260,right:1260},pageNumbers:{start:1}}},headers:{default:new D.Header({children:[new D.Paragraph({children:[tr('AI可研报告生成系统｜数据分析能力升级',{size:18,color:'708399'})],border:{bottom:{style:D.BorderStyle.SINGLE,size:4,color:'D5E3EF',space:4}}})]})},footers:{default:footer()},children:docChildren}]});

function styleSheet(ws,widths,freeze=1){ws['!cols']=widths.map(w=>({wch:w}));ws['!freeze']={xSplit:0,ySplit:freeze,topLeftCell:'A'+(freeze+1),activePane:'bottomLeft',state:'frozen'};ws['!autofilter']={ref:ws['!ref']};const range=XLSX.utils.decode_range(ws['!ref']);for(let r=range.s.r;r<=range.e.r;r++){for(let c=range.s.c;c<=range.e.c;c++){const cell=ws[XLSX.utils.encode_cell({r,c})];if(!cell)continue;cell.s={font:{name:'Microsoft YaHei',sz:r===0?11:10,bold:r===0,color:r===0?{rgb:'FFFFFF'}:{rgb:'23364D'}},fill:r===0?{patternType:'solid',fgColor:{rgb:'2F75B5'}}:(r%2===0?{patternType:'solid',fgColor:{rgb:'F4F8FB'}}:undefined),alignment:{vertical:'top',horizontal:c===0?'center':'left',wrapText:true},border:{bottom:{style:'thin',color:{rgb:'D7E2EA'}}}};}}
}
const wb=XLSX.utils.book_new();
const overview=[['序号','能力名称','这次新增了什么','Housing核心逻辑','本项目具体实现','代码/工具','具体代码位置','真实数据条件','测试/验收','当前状态'],...items.map(x=>[x.n,x.name,x.added,x.housing,x.ours,x.tools,x.files,x.data,x.test,x.status])];
const ws1=XLSX.utils.aoa_to_sheet(overview);styleSheet(ws1,[6,24,42,42,46,28,48,32,36,22]);XLSX.utils.book_append_sheet(wb,ws1,'10项新增能力');
const modules=[
['层级','模块/表','职责','关键内容','具体位置'],
['前台','项目数据分析工作台','项目内操作入口','总览、圈层、三类导入、来源、快照','analysis-workbench.js；app.js；calc.js；index.html'],
['后台','项目数据审核','控制数据效力','pending→approved/rejected；管理员二次验证','admin.html；functions/api/projectanalysis.js'],
['核心','白箱分析引擎','统一计算结果','人口、职住、OD、需求、POI、差异域','analysis-core.js'],
['Provider','数据标准化','屏蔽不同数据来源差异','人工、Excel、本地库、未来外部API','analysis-providers.js'],
['API','项目分析服务','项目隔离和持久化','目录、workspace、submit、review、snapshot、diff','functions/api/projectanalysis.js'],
['数据库','分析数据表','保存结构化数据及版本','指标、scope、observations、POI、OD、snapshots','migrations/0005_project_analysis.sql；local-server/schema-postgres.sql'],
['报告','现有可研生成接入','把正式快照写入相关章节','不新增第二套可研；保存analysisSnapshotId','report.js；project-workflow.js'],
['复核','版本与选择性更新','恢复旧报告时恢复分析快照','stale、locked-stale、版本绑定','review.js；project-workflow.js'],
['Agent','项目对话工具','回答人口/职住/需求/配套问题','5个正式分析工具；无数据明确缺项','analysis-workbench.js:23']
];const ws2=XLSX.utils.aoa_to_sheet(modules);styleSheet(ws2,[14,25,34,48,54]);XLSX.utils.book_append_sheet(wb,ws2,'架构与代码位置');
const tests=[['序号','验收项目','预期结果','自动化/实测','结果'],[1,'未审核数据隔离','pending数据不进入正式分析','analysis-core.test.js','通过'],[2,'圈层距离','已知经纬度正确归入1/3/5km','analysis-core.test.js','通过'],[3,'职住白箱','公式和阈值边界正确','analysis-core.test.js','通过'],[4,'OD TOP10','只统计approved流量','analysis-core.test.js','通过'],[5,'需求守卫','缺数不造数，三场景单调','analysis-core.test.js','通过'],[6,'POI评价','距离、短板、负面预警可解释','analysis-core.test.js','通过'],[7,'Excel溯源','文件/版本/Sheet/单元格保留','analysis-providers.test.js','通过'],[8,'Provider边界','未来外部接口默认禁用','analysis-providers.test.js','通过'],[9,'章节影响','不误伤消防等无关小节','analysis-workflow.test.js','通过'],[10,'人工锁定','锁定章节保持locked-stale','analysis-workflow.test.js','通过'],[11,'报告绑定','同时绑定测算与分析快照','analysis-workflow.test.js','通过'],[12,'版本恢复底座','保留分析快照数组','analysis-workflow.test.js','通过'],[13,'前台入口','项目数据分析页面正常加载','本地浏览器实测','通过'],[14,'项目完整回归','所有历史功能不退化','npm.cmd test：141项','通过']];const ws3=XLSX.utils.aoa_to_sheet(tests);styleSheet(ws3,[7,28,50,34,12]);XLSX.utils.book_append_sheet(wb,ws3,'测试与验收');
const fields=[['数据类型','必填字段','可选字段','审核后用于','无数据时表现'],['人口/需求指标','指标键、圈层km、数值','单位、统计期、来源、质量等级','人口、职住、需求','显示缺少指标，不生成正式结论'],['POI','名称、分类键、经度、纬度','子类、等级权重、地址、来源','交通/教育/医疗/商业/产业/负面设施','显示缺少POI'],['OD通勤','来源地、去向地、人数','流向类型、距离、统计期、来源','来源/去向TOP10、自足率','明确缺少OD，不用POI替代'],['项目范围','经度、纬度','自定义范围（后续）','1/3/5km圈层','不能计算空间距离'],['正式快照','已审核数据','规则版本、创建人','可研生成、版本恢复、选择性更新','不完整快照不得注入可研']];const ws4=XLSX.utils.aoa_to_sheet(fields);styleSheet(ws4,[20,42,42,38,42]);XLSX.utils.book_append_sheet(wb,ws4,'数据模板与使用条件');

Promise.all([D.Packer.toBuffer(doc)]).then(([buf])=>{const word=path.join(OUT,'AI可研系统_人口职住需求分析新增功能说明.docx');fs.writeFileSync(word,buf);const excel=path.join(OUT,'AI可研系统_10项数据分析能力实施明细.xlsx'),excelBuf=XLSX.write(wb,{type:'buffer',bookType:'xlsx',cellStyles:true,compression:true});fs.writeFileSync(excel,excelBuf);console.log(JSON.stringify({word,excel,wordBytes:buf.length,excelBytes:fs.statSync(excel).size}));}).catch(e=>{console.error(e);process.exit(1);});
