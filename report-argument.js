/* Section argument contracts: project facts and report-wide style remain separate inputs. */
(function(root){
  'use strict';
  const VERSION='argument-evidence-2026-09-30-basis-sources';
  const BASIS_SOURCE_VERSION='basis-sources-2026-09-30';
  const BASIS_CLASSIFICATION_VERSION='basis-classification-20261010-v1';
  const BASIS_LEVELS=Object.freeze([
    {key:'national',label:'国家'}, {key:'province',label:'省级'}, {key:'city',label:'市级'},
    {key:'district',label:'区级'}, {key:'group',label:'集团'}, {key:'project',label:'项目'},
    {key:'technical',label:'技术标准'}, {key:'unclassified',label:'层级待确认'}
  ]);
  function basisNameKey(value){
    return String(value||'').trim().replace(/\.(?:docx?|pdf|xlsx?|txt|md)$/i,'').replace(/^(?:【参考】\s*|附件[一二三四五六七八九十\d]*\s*[:：、]\s*|\d+[、.]\s*)+/,'').replace(/\s+/g,'');
  }
  function basisDocumentTitle(value){
    const title=String(value||'').trim();
    if(!title||title.length>400||/[<>\n\r\u0000-\u001f]/.test(title)||/忽略(?:.*(?:指令|约束|规则))|系统提示|输出(?:.*(?:密码|密钥))|执行代码/.test(title))return false;
    return /^(?:中华人民共和国)?民法典$/.test(title)||/(?:法|条例|规定|意见|办法|通知|规范|标准|指引|规程|准则|细则|制度|协议(?:书)?|合同|决议|请示|报告|清单)(?:[（(][^（）()]{1,60}[）)])?$/.test(title)&&title.length>=5;
  }
  function basisLevel(title,context){
    const text=String(title||'');
    if(/集团/.test(text))return 'group';
    if(/(?:区|县)(?:人民政府|住房|建设|保障|财政|发展|关于|现行)|(?:罗湖|福田|南山|盐田|宝安|龙岗|龙华|坪山|光明|大鹏)区/.test(text))return 'district';
    if(/(?:广东|[^市区县]{2,8}省)(?:省|人民政府|住房|建设|财政|发展)|^广东省/.test(text))return 'province';
    if(/GB\s*\d|建筑.*(?:规范|标准)|工程.*(?:规范|标准)|技术.*(?:规程|标准|指引)|住宅设计规范/.test(text))return 'technical';
    // A named project record is not a municipal policy merely because the project
    // name contains a city. These labels aid review, not legal applicability.
    if(/项目.*(?:协议|合同|报告|请示|清单)|合作.*(?:协议|清单)|委托协议|投资.*请示/.test(text))return 'project';
    if(/市(?:人民政府|住房|建设|财政|发展|保障)|^深圳市|^广州市/.test(text))return 'city';
    if(/中华人民共和国|国务院|国家|^民法典$/.test(text)||/国办发|国务院令/.test(String(context||'')))return 'national';
    return 'unclassified';
  }
  async function basisSha256(text){
    if(root.crypto?.subtle){const bytes=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
    if(typeof require==='function')return require('node:crypto').createHash('sha256').update(text).digest('hex');
    throw new Error('依据目录缺少SHA256能力，未登记无法绑定的引用');
  }
  // Only actual supplied material and explicitly adopted, in-scope web records
  // enter here. Old generated prose, style examples and logic prompts are not sources.
  // A bracketed document reference is a located secondary citation, never proof
  // that the original document was received, remains valid, or applies to this project.
  async function basisCatalog(materials,options={}){
    const completion=options.completionContract||root.ReportCompletionContract||(typeof require==='function'?require('./report-completion-contract.js'):null);
    if(!completion?.catalogFromMaterials)throw new Error('依据目录合同模块未加载');
    const catalog=await completion.catalogFromMaterials(materials,options),items=catalog.items.slice(),diagnostics=catalog.diagnostics.slice(),names=new Map();
    for(const item of items)names.set(basisNameKey(item.title),item);
    const register=(title,evidence,context,kind)=>{
      const key=basisNameKey(title),prior=names.get(key),level=basisLevel(title,context);
      diagnostics.push({code:'basis-citation-located',title,level,kind,evidence:{...evidence},message:'实际资料明确提及，未据此核验文号、日期、效力或项目适用性。'});
      if(prior)return;
      if(items.length>=200)throw new Error('依据目录超过200条；请人工核对归属，不截断必要依据');
      const item={title,documentNo:'',issuer:'',date:'',status:'cited',ownerKey:options.sectionKey,required:options.required!==false,evidence:{...evidence},verification:{by:'',at:'',note:''}};
      names.set(key,item);items.push(item);
    };
    for(const record of Array.isArray(materials)?materials:[]){
      const title=String(record?.fileName||record?.title||record?.name||'').trim(),content=record?.content;
      if(typeof content!=='string'||!content.trim())continue;
      const sourceHash=record?.contentHash||await basisSha256(content),sourceId=record?.fileId||record?.id||'material-text-'+sourceHash;
      if(options.ownerBySourceId?.[sourceId]&&options.ownerBySourceId[sourceId]!==options.sectionKey)continue;
      if(!items.some(item=>item.evidence.sourceId===sourceId&&item.evidence.sourceHash===sourceHash))continue;
      let countedTo=0,line=1;
      for(const match of content.matchAll(/《([^《》\r\n]{1,400})》/g)){
        const reference=match[1].trim(),before=content.slice(Math.max(0,match.index-30),match.index);
        // Shortened names and future certificates are not independent received
        // basis documents. Do not turn a contractual condition into an approval.
        if(/(?:以下简称|下称|简称)\s*$/.test(before)||!basisDocumentTitle(reference))continue;
        line+=(content.slice(countedTo,match.index).match(/\r\n|\r|\n/g)||[]).length;countedTo=match.index;
        const end=match.index+match[0].length;
        const evidence={sourceId,sourceHash,locator:title+'；现有资料文本第'+line+'行，字符['+match.index+','+end+')'};
        const suffix=content.slice(end,end+100).split(/[。；\r\n《]/,1)[0];
        register(reference,evidence,reference+' '+suffix,'material-citation');
      }
    }
    for(const row of options.webEvidence||[]){
      const sectionMatch=row?.sectionKey===options.sectionKey||typeof row?.section==='string'&&options.sectionKey.endsWith(' / '+row.section);
      if(row?.status!=='approved'||!sectionMatch||!basisDocumentTitle(row.title)||!/^https?:\/\//i.test(String(row.url||'')))continue;
      const content=String(row.content_text||row.excerpt||'');
      if(!content.trim()||!row.id){diagnostics.push({code:'basis-web-unlocated',title:row.title,message:'已采用网页缺少实际文本或记录身份，未加入依据目录。'});continue;}
      const sourceHash=await basisSha256(content),sourceId='web-evidence-'+row.id;
      if(options.ownerBySourceId?.[sourceId]&&options.ownerBySourceId[sourceId]!==options.sectionKey){diagnostics.push({code:'basis-owned-elsewhere',title:row.title,message:'该网页依据已归属其他依据小节，未重复登记。'});continue;}
      register(row.title,{sourceId,sourceHash,locator:String(row.url)+'；人工采用网页文本快照'},row.title+' '+String(row.publisher||''),'approved-web-citation');
    }
    // Preserve original material ordering for compatibility; reviewed layer
    // grouping is a presentation concern, not a reason to reorder frozen refs.
    return {...catalog,items,diagnostics};
  }
  function basisCoverage(catalog){
    const items=Array.isArray(catalog?.items)?catalog.items:[],citations=catalog?.diagnostics||[];
    const levels=BASIS_LEVELS.map(level=>({...level,count:0,verified:0,items:[]}));
    for(const item of items){
      const record=citations.find(row=>row.code==='basis-citation-located'&&basisNameKey(row.title)===basisNameKey(item.title));
      const key=record?.level||basisLevel(item.title,[item.documentNo,item.issuer].filter(Boolean).join(' ')),level=levels.find(row=>row.key===key);
      level.count++;if(item.status==='verified')level.verified++;level.items.push({title:item.title,status:item.status});
    }
    const expected=['national','province','city','district','group','project'];
    return {version:BASIS_SOURCE_VERSION,coverage:'unconfirmed',levels,missing:levels.filter(row=>expected.includes(row.key)&&!row.count).map(row=>({key:row.key,label:row.label,message:'当前资料尚未定位该层级依据；如项目需要，须补充原件或明确出处，不自动编造。'})),message:'层级按材料名称及明确引用定位；数量不证明依据完整、现行有效或适用，原件核验与审签仍需人工完成。'};
  }
  function basisFileType(value){
    const text=String(value||'').trim().replace(/\.(?:docx?|pdf|xlsx?|txt|md)\s*$/i,'').replace(/(?:[（(][^（）()]*[）)]|\s*[-—]\s*修订)+\s*$/g,'').trim();
    // Document genre precedes jurisdiction: a project agreement remains a
    // project record even when its name mentions a city, district or group.
    if(/(?:协议|合同|报告|请示|清单)(?:书|表)?$/.test(text))return 'project';
    if(/(?:法|条例|民法典)$/.test(text)&&!/(?:办法|方法)$/.test(text))return 'legal';
    if(/(?:\bGB(?:\/T)?\s*\d|(?:技术|设计|建筑|工程|验收|安全|消防).*(?:标准|规范|规程)$)/i.test(text))return 'technical';
    if(/(?:意见|办法|通知|规划|制度|细则|规定|决定|指引)$/.test(text))return 'policy';
    return 'unclassified';
  }
  function basisHeadingType(value){
    const text=String(value||'');
    if(/^(?:编制说明|说明|结论|建议|小结)$/.test(text))return null;
    if(/政策/.test(text))return 'policy';
    if(/法律|法规/.test(text))return 'legal';
    if(/技术|标准|规范/.test(text))return 'technical';
    if(/项目.*(?:依据|专项|专属)|(?:专项|专属).*依据/.test(text))return 'project';
    return null;
  }
  const BASIS_CLASSIFICATION_PATTERNS={national:/国家|全国|中央/,province:/省级|省域|省份/,city:/市级|市区|地方/,district:/区级|市区|地方/,group:/集团/,project:/项目|专属/,technical:/技术|标准|规范/};
  const BASIS_CLASSIFICATION_LABELS={national:'国家层面依据',province:'省级层面依据',city:'市级层面依据',district:'区级层面依据',group:'集团层面依据',project:'项目专属依据',technical:'技术标准与规范'};
  function basisClassificationPaths(contract){
    const paths=[],stack=[];
    for(const h of contract.requiredHeadings||[]){
      if(!h||!Number.isInteger(h.level)||h.level<3||h.level>6||typeof h.text!=='string'||!h.text.trim()||h.text.length>100||/[<>\r\n|*`#\[\]\\\u0000-\u001f]/.test(h.text))throw new Error('依据建议分类需要有效的职责标题路径');
      while(stack.length&&stack.at(-1).level>=h.level)stack.pop();
      stack.push({level:h.level,text:h.text});
      if(stack.every((row,index)=>row.level===index+3))paths.push(stack.map(row=>({...row})));
    }
    return paths;
  }
  // Presentation suggestions are not a manual taxonomy registration. Keep them
  // separate from groups and from legal verification, with the actual item's
  // evidence unchanged. Consumers must bind this manifest before rendering it.
  function basisPresentation(catalog,contract){
    if(!contract?.requirements?.basis||catalog?.sectionKey&&catalog.sectionKey!==contract.sectionKey||!Array.isArray(catalog?.items))throw new Error('依据建议分类需要同一依据小节与真实目录');
    const output=JSON.parse(JSON.stringify(catalog)),paths=basisClassificationPaths(contract),diagnostics=[];
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),validPaths=paths.filter(path=>!path.some(h=>/^(?:编制说明|说明|结论|建议|小结)$/.test(h.text))),typed=validPaths.some(path=>['legal','policy','technical'].includes(basisHeadingType(path.at(-1).text)));
    const unique=rows=>rows.length===1?rows[0]:null;
    const typePath=type=>unique(validPaths.filter(path=>basisHeadingType(path.at(-1).text)===type&&!path.slice(0,-1).some(h=>basisHeadingType(h.text)===type)));
    const jurisdictionPath=(level,under=[])=>{
      const pattern=BASIS_CLASSIFICATION_PATTERNS[level];if(!pattern)return null;
      const matches=validPaths.filter(path=>path.length>under.length&&same(path.slice(0,under.length),under)&&pattern.test(path.at(-1).text));
      return unique(matches.filter(path=>!matches.some(other=>other.length<path.length&&same(path.slice(0,other.length),other))));
    };
    const genericRoots=validPaths.filter(path=>path.length===1&&/^(?:编制依据|依据文件|依据清单)$/.test(path[0].text));
    const genericParent=unique(genericRoots)||[];
    for(const item of output.items){
      if(item.groups?.length||item.group!==undefined){delete item.classification;continue;}
      const record=(catalog.diagnostics||[]).find(row=>row.code==='basis-citation-located'&&basisNameKey(row.title)===basisNameKey(item.title)&&row.evidence?.sourceId===item.evidence?.sourceId&&row.evidence?.sourceHash===item.evidence?.sourceHash);
      const type=basisFileType(item.title),level=type==='project'?'project':type==='technical'?'technical':BASIS_LEVELS.some(row=>row.key===record?.level)?record.level:basisLevel(item.title,[item.documentNo,item.issuer].filter(Boolean).join(' '));
      let groups=null;
      const located=['received','cited','verified'].includes(item.status)&&item.evidence?.sourceId&&/^[a-f0-9]{64}$/.test(item.evidence?.sourceHash||'')&&item.evidence?.locator;
      if(located&&type!=='unclassified'){
        if(typed){
          groups=typePath(type);
          // A mixed legacy directory may name the national layer without a
          // separate legal genre. Reuse only that unique, neutral existing
          // path; a missing/ambiguous legal bucket must not become policy.
          if(!groups&&type==='legal'&&level==='national'&&!validPaths.some(path=>basisHeadingType(path.at(-1).text)==='legal')){
            const nationalPath=jurisdictionPath('national');
            if(nationalPath&&!nationalPath.some(h=>basisHeadingType(h.text)))groups=nationalPath;
          }
          if(groups&&type==='policy'&&['national','province','city','district','group'].includes(level)){
            groups=jurisdictionPath(level,groups)||(groups.at(-1).level<6?[...groups,{level:groups.at(-1).level+1,text:BASIS_CLASSIFICATION_LABELS[level]}]:groups);
          }
        }else{
          groups=jurisdictionPath(level);
          // A generic legacy heading does not distinguish document genres.
          // Add only the genre/layer supported by a real title, never an empty
          // national/group bucket or a conjectured document to fill it.
          if(!groups&&(!paths.length||validPaths.length>0&&validPaths.length===genericRoots.length)){
            const label=BASIS_CLASSIFICATION_LABELS[level]||(type==='legal'?'法律法规依据（层级待核验）':type==='policy'?'政策文件依据（层级待核验）':'');
            if(label)groups=[...genericParent,{level:genericParent.length+3,text:label}];
          }
        }
      }
      const reason=groups?'按现有'+(record?'材料中的明确引用':'文件名称')+'建议归类；分类、文件效力及适用性尚未经人工确认。':located?'现有文件名称或对应职责分类不足以确认归属；保留真实清单，分类待人工核验。':'原件或材料提及缺少完整可定位身份；保留已登记条目，不推断分类或核验结果。';
      item.classification={version:BASIS_CLASSIFICATION_VERSION,status:groups?'suggested':'unknown',level,method:record?'explicit-citation':'material-title',reason,groups:groups||[]};
      diagnostics.push({code:groups?'basis-classification-suggested':'basis-classification-unknown',title:item.title,evidence:JSON.parse(JSON.stringify(item.evidence||{})),message:reason});
    }
    return {...output,classificationVersion:BASIS_CLASSIFICATION_VERSION,classificationDiagnostics:diagnostics};
  }
  function contract(chapter,title,options={}){
    const position=String(chapter||'')+' / '+String(title||''),basis=/编制依据|政策依据|法规依据|项目专属依据/.test(position),summary=!basis&&/总论|结论|建议/.test(position),requirements=options.sectionRequirements||{};
    return {version:VERSION,question:basis?'本节应列出哪些已提供且可定位的依据文件？':summary?'现有证据支持什么判断、前置条件和决策建议？':'本节业务问题是什么，事实如何支持判断和下一步行动？',
      facts:basis?['文件全称、文号、发布主体及日期（仅列已核实信息）','原文可定位来源；未核实效力不得声称有效']:summary?['已完成章节的核查结果','最新测算版本','未解决事项']:['与本节直接相关的项目事实','来源、期间、单位及适用范围'],
      calculation:!!options.hasCalculation,assumptions:'假设必须显式标注及说明对结论的限制，不转写成已确认事实。',missing:'缺少关键依据时说明缺口、影响和核实动作；只在缺失位置标待补，不据此给出肯定结论。',
      responsibility:String(requirements.responsibility||requirements.scope||(basis?'只列依据文件清单，不展开解读、适用性分析、项目对照、核对过程或小结':summary?'仅概括明细章节已形成的结论及其限制，不重铺论证过程':'只回答本小节标题所指业务问题，完整事实和明细只在所属章节展开')),
      doNotRepeat:Array.isArray(requirements.doNotRepeat)?requirements.doNotRepeat:['其他章节已有的背景、完整条款或计算过程','输入材料原有的重复叙述','全篇写作规则和资料核对过程'],
      checks:['事实、推理和建议分开','每项关键判断有可追溯输入','不得照搬历史项目数字','旧正文不是事实核验依据',summary?'不得在总论引入正文中没有的新事实':'结论与本节事实、可用测算相符'],summary,basis};
  }
  function prompt(chapter,title,options){const c=contract(chapter,title,options);return '\n\n【本节论证任务】\n要回答：'+c.question+'\n本节职责：'+c.responsibility+'\n不得复述：'+c.doNotRepeat.join('；')+'\n必需事实：'+c.facts.join('；')+'\n证据：仅以已提供的资料及原文位置支撑判断，后台保留定位；正文不附加来源说明（依据文件清单除外）。未提供原文不得声称已核实。\n可用测算：'+(c.calculation?'仅使用本次输入的测算数据，保留口径和单位。':'未提供可信测算，不得填入金额、比例或收益指标。')+'\n允许假设：'+c.assumptions+'\n缺失处理：'+c.missing+' 资料不足时用简短缺口和结论限制交代，不补写通用背景或制造占位表格。\n交付检查：'+c.checks.join('；')+'\n执行本次成稿计划的篇幅预算；材料更长不增加篇幅，不为凑字数重复背景。确需超预算须保留原因供人工复核，不能自行视为达标。';}
  function generationOrder(chapters){const rows=[];for(const c of chapters||[])if(c.checked!==false)for(const s of c.sections||[])rows.push({chapter:c,section:s});return rows.sort((a,b)=>Number(contract(a.chapter.name,a.section.t).summary)-Number(contract(b.chapter.name,b.section.t).summary));}
  async function runInDependencyOrder(tasks,worker,pool,concurrency,shouldContinue){
    const detail=[],summary=[],failed=[];let firstError=null;
    for(const t of tasks)(contract(t.c?.name,t.s?.t).summary?summary:detail).push(t);
    const keepRunning=()=>!firstError&&(!shouldContinue||shouldContinue());
    const safeWorker=async task=>{try{return await worker(task);}catch(error){failed.push(task);if(!firstError)firstError=error;}};
    try{await pool(detail,safeWorker,concurrency,keepRunning);if(!detail.length&&keepRunning())await pool(summary,safeWorker,concurrency,keepRunning);if(firstError)throw firstError;}
    finally{tasks.splice(0,tasks.length,...failed,...detail,...summary);}
  }
  const SUMMARY_CONTEXT_BUDGET=20000;
  const SUMMARY_FULL_LIMITS=Object.freeze({context:160000,proseCharacters:109200,tableCharacters:30000,tableRows:600});
  // This is conservative, deterministic excerpt selection, not semantic or factual verification.
  // Accepted sections currently do not store version-bound structured slots; task output/quality
  // is therefore deliberately not treated as a reusable summary of the current body.
  const SUMMARY_CRITICAL=/结论|判断|建议|可行|批准|同意|风险|限制|边界|前提|前置|条件|假设|假定|冲突|否决|约束|取决于|依赖|核实|审批|缺少|没有|尚|未|不|待|须|应|需|仅|除非|否则|如果|若/;
  function summaryText(value){
    return String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?[a-z][^>]*>/gi,'').replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,(_,entity)=>{
      const named={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"},key=entity.toLowerCase();
      if(key[0]!=='#')return named[key];
      const n=key[1]==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
    }).replace(/[\u200b-\u200f\u2060\ufeff]/g,'').trim();
  }
  function summaryTable(html){
    const rows=Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi));
    if(!rows.length||(html.match(/<tr\b/gi)||[]).length!==rows.length)throw new Error('HTML表格行结构不完整');
    const textRows=rows.map((row,index)=>{
      const cells=Array.from(row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi));
      if(!cells.length||(row[1].match(/<t[dh]\b/gi)||[]).length!==cells.length)throw new Error('HTML表格单元格结构不完整');
      if(summaryText(row[1].replace(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]\s*>/gi,'')))throw new Error('HTML表格存在无法定位到单元格的正文');
      return '原表第'+(index+1)+'行：'+cells.map(cell=>{
        const span=['rowspan','colspan'].map(name=>{const m=cell[1].match(new RegExp('\\b'+name+'\\s*=\\s*["\']?(\\d+)','i'));return m&&Number(m[1])>1?name+'='+m[1]:'';}).filter(Boolean);
        return '['+(span.length?span.join(',')+'；':'')+summaryText(cell[2])+']';
      }).join(' | ');
    });
    const extra=summaryText(html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi,''));
    return (extra?'表题/补充：'+extra+'\n':'')+textRows.join('\n');
  }
  function summaryBlocks(body,scope,full=false){
    const md=root.MD||(typeof require==='function'?require('./md.js'):null);
    if(!md?.parseBlocks)throw new Error('正文结构解析工具未加载');
    let source=String(body||'').replace(/<!--([\s\S]*?)(?:-->|$)/g,'').replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'');
    const tables=new Map();let prefix='SUMMARY_TABLE_';while(source.includes(prefix))prefix+='X';
    source=source.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi,html=>{const key=prefix+tables.size;tables.set(key,summaryTable(html));return '\n\n'+key+'\n\n';});
    if(/<\/?table\b/i.test(source))throw new Error('HTML表格边界不完整');
    source=source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,(_,level,text)=>'\n\n'+'#'.repeat(Number(level))+' '+summaryText(text)+'\n\n')
      .replace(/<\/(?:p|div|li|ul|ol|blockquote|section|article)\s*>/gi,'\n\n');
    const blocks=[],headings=[],criticalScope=/风险|限制|边界|前提|前置|条件|假设|假定|待补|冲突/.test(scope||'');
    const add=(text,type)=>{text=summaryText(text);if(!text)return;const path=headings.filter(Boolean).join(' / ');blocks.push({text,type,path,critical:criticalScope||SUMMARY_CRITICAL.test(path+'\n'+text)});};
    for(const block of md.parseBlocks(summaryText(source))){
      if(block.type==='heading'){
        headings.length=block.level-1;
        const text=summaryText(md.stripInline(block.text));
        if(full||SUMMARY_CRITICAL.test(text))add(text,'heading');
        headings[block.level-1]=text;continue;
      }
      if(block.type==='table'){add(block.rows.map((row,i)=>'原表第'+(i+1)+'行：'+row.map(cell=>'['+cell+']').join(' | ')).join('\n'),'table');continue;}
      if(block.type==='list'){for(const item of block.items||[])add(md.stripInline(item),'paragraph');continue;}
      if(block.text){
        const text=md.stripInline(block.text);
        // Legacy reports often use a standalone bold label instead of a Markdown heading.
        // Keep the following paragraphs with that critical label until the next heading.
        if(text.length<=60&&!/[。！？!?；;\n]/.test(text)&&SUMMARY_CRITICAL.test(text)&&/^\s*\*\*[^*]+\*\*\s*$/.test(block.text)){add(text,'heading');headings.push(text);continue;}
        add(tables.has(text)?tables.get(text):text,tables.has(text)?'table':'paragraph');
      }
    }
    return blocks;
  }
  function summaryOpening(text){
    if(text.length<=400)return text;
    // Only complete leading sentences. A single long fact is kept whole and may trigger
    // the global guard; never cut a number, unit, negation or qualifier mid-sentence.
    const sentences=text.match(/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/g)||[text];
    let result='';for(const sentence of sentences){if(result&&result.length+sentence.length>400)break;result+=sentence;if(result.length>=400)break;}return result;
  }
  const summaryStable=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(summaryStable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+summaryStable(value[key])).join(',')+'}':JSON.stringify(value);
  function summaryContractCore(c){
    // Frozen tables, catalog receipts and generated missing-evidence markers may
    // be bound after createPlan. They are rechecked on the actual body below.
    // A valid cross-reference can discharge a required table, but cannot erase
    // the original responsibility that the current plan assigned to this section.
    return {version:c.version,planId:c.planId,sectionKey:c.sectionKey,projectType:c.projectType,responsibility:c.responsibility,lengthPolicy:c.lengthPolicy||null,requiredHeadings:c.requiredHeadings||[],structureBinding:c.structureBinding||null,requirements:c.requirements,requiredFacts:c.requiredFacts,requiredTables:c.documentReferences?.originalRequiredTables||c.requiredTables,decisionConstraints:c.decisionConstraints||[]};
  }
  function summaryConfirmedLength(chapters,plan,completion){
    const length=plan.lengthPlan,api=root.ReportLengthPlan||(typeof require==='function'?require('./report-length-plan.js'):null);
    if(!api?.validatePlan||!api?.legacyBudgetSummary||!length||typeof length.confirmedAt!=='string'||!Number.isFinite(Date.parse(length.confirmedAt))||length.budgetResolution?.policy!=='confirmed-length-plan')return false;
    if(!api.validatePlan(length,chapters).valid||length.lengthScope!=='full-report'||plan.lengthProfileVersion!==completion.LENGTH_PROFILE?.version||plan.lengthPlanId!==length.planId||plan.proseTotal!==length.proseTotal||plan.totalTarget!==length.totalTarget||plan.targetPages!==length.targetPages||plan.maxPages!==length.maxPages||plan.lengthScope!==length.lengthScope)return false;
    if(length.budgetResolution.legacyBudgetFingerprint!==api.legacyBudgetSummary(plan.budgetOverrides).fingerprint||plan.sections.length!==length.sections.length)return false;
    const allocated=new Map(length.sections.map(section=>[section.key,section]));
    return plan.sections.every(raw=>{const contract=completion.normalize(raw),section=allocated.get(contract.sectionKey);return section&&contract.lengthPolicy==='advisory-v1'&&contract.planId===plan.planId&&contract.requirements.basis===section.basis&&contract.requirements.proseTarget===section.target&&contract.requirements.proseMax===Math.ceil(section.target*1.3);});
  }
  function summaryReadyContracts(chapters,rows,plan){
    if(!plan||!rows.length)return null;
    const completion=root.ReportCompletionContract||(typeof require==='function'?require('./report-completion-contract.js'):null);
    if(!completion?.normalize||!completion?.inspect||!completion?.measure)return null;
    // The caller supplies the *current* plan, not a persisted quality receipt.
    // Invalid, old, mixed or unbound drafts retain the conservative legacy path.
    if(plan.version!==completion.VERSION||!plan.planId||plan.materialIndependent!==true||!Array.isArray(plan.sections))return null;
    // A confirmed current allocation is advisory, not a license to exceed the
    // absolute input envelope. Old or unconfirmed plans keep their original caps.
    let advisoryLength=false;try{advisoryLength=summaryConfirmedLength(chapters,plan,completion);}catch(_){return null;}
    if((plan.lengthPlan?.confirmedAt||plan.lengthPlan?.budgetResolution)&&!advisoryLength)return null;
    const proseLimit=advisoryLength?Infinity:plan.lengthProfileVersion===completion.LENGTH_PROFILE?.version?completion.LENGTH_PROFILE.proseTotal:36000;
    for(const [key,limit] of [['proseTotal',proseLimit],['tableCharactersTotal',SUMMARY_FULL_LIMITS.tableCharacters],['tableRowsTotal',SUMMARY_FULL_LIMITS.tableRows]])if(!Number.isSafeInteger(plan[key])||plan[key]<0||plan[key]>limit)return null;
    const keys=generationOrder(chapters).map(x=>x.chapter.name+' / '+x.section.t),selected=new Set(keys),planned=new Map();
    if(keys.length!==selected.size||keys.length!==plan.sections.length)return null;
    try{
      for(const raw of plan.sections){const c=completion.normalize(raw);if(!c||c.planId!==plan.planId||c.projectType!==String(plan.projectType||'')||!selected.has(c.sectionKey)||planned.has(c.sectionKey))return null;planned.set(c.sectionKey,c);}
      const contracts=[];
      for(const row of rows){
        const key=row.chapter.name+' / '+row.section.t,expected=planned.get(key),bound=completion.normalize(row.section.completionContract);
        if(!bound||bound.sectionKey!==key||summaryStable(summaryContractCore(bound))!==summaryStable(summaryContractCore(expected)))return null;
        if((expected.requiredMarkers||[]).some(marker=>!bound.requiredMarkers?.includes(marker)))return null;
        contracts.push(bound);
      }
      return {completion,contracts,advisoryLength};
    }catch(_){return null;}
  }
  function summaryParse(row,full){
    const label=row.chapter.name+' / '+row.section.t;
    try{return summaryBlocks(row.section.editedHtml||row.section.content||'',label,full);}catch(cause){const error=new Error('总论/结论上下文无法完整解析：'+label+'（'+cause.message+'）。请先整理本节正文/表格，未生成摘要。');error.code='REPORT_SUMMARY_CONTEXT_PARSE';throw error;}
  }
  function summaryFullContext(rows,plan,ready){
    const issues=[],totals={proseCharacters:0,tableCharacters:0,tableRows:0},extracts=[];
    for(const allocation of [plan.tableAllocation,plan.factAllocation])if(allocation&&(allocation.status!=='ready'||allocation.issues?.some(issue=>issue.severity==='error')))issues.push({section:'全篇计划',message:'表格或事实职责分配尚未完成'});
    rows.forEach((row,index)=>{
      const body=row.section.editedHtml||row.section.content||'',label=row.chapter.name+' / '+row.section.t;
      const bound=ready.contracts[index],inspectionContract=ready.advisoryLength?bound:{...bound};
      if(!ready.advisoryLength)delete inspectionContract.lengthPolicy;
      const quality=ready.completion.inspect(body,inspectionContract);
      for(const issue of quality.issues||[])if(issue.severity==='error')issues.push({section:label,...issue});
      const metrics=ready.completion.measure(body);for(const key of Object.keys(totals))totals[key]+=metrics[key];
      const blocks=summaryParse(row,true);
      if(!blocks.some(b=>b.type!=='heading'))issues.push({section:label,message:'缺少完整正文'});
      const text=label+'：\n[来源：当前已接受正文；计划 '+plan.planId+'；全量规范化，不作节选；机械检查不等于事实核验'+(row.section.pendingRevision?'；未接受候选未采用':'')+']\n'+blocks.map((b,i)=>'【原正文第'+(i+1)+'块'+(b.path?'；'+b.path:'')+'；'+(b.type==='table'?'完整表格':b.type==='heading'?'完整标题':'完整正文')+'】\n'+b.text).join('\n\n');
      extracts.push({section:label,chars:text.length,text});
    });
    if(issues.length){const error=new Error('总论/结论等待当前正文重新验收：'+issues.map(x=>x.section+'（'+x.message+'）').join('、')+'。未采用旧验收回执，原正文未改动。');error.code='REPORT_SUMMARY_CONTRACT_BLOCKED';error.issues=issues;throw error;}
    for(const [key,limit] of Object.entries({proseCharacters:ready.advisoryLength?SUMMARY_FULL_LIMITS.proseCharacters:Math.min(SUMMARY_FULL_LIMITS.proseCharacters,Math.ceil(plan.proseTotal*1.3)),tableCharacters:Math.min(SUMMARY_FULL_LIMITS.tableCharacters,plan.tableCharactersTotal),tableRows:Math.min(SUMMARY_FULL_LIMITS.tableRows,plan.tableRowsTotal)}))if(totals[key]>limit){const error=new Error('总论/结论输入超过'+(ready.advisoryLength?'绝对安全容量':'固定全篇预算')+'：'+key+' '+totals[key]+' > '+limit+'；未截断任何正文、风险或表格。'+(ready.advisoryLength?'请核对任务拆分或输入容量，不能按参考字数机械压缩；原正文完整保留。':'请先逐节精简并复核。'));error.code='REPORT_SUMMARY_DOCUMENT_BUDGET';error.metric=key;error.budget=limit;error.actual=totals[key];throw error;}
    const result='\n\n【合同就绪正文的全量论证上下文（不是独立核验凭证）】\n'+extracts.map(x=>x.text).join('\n\n')+'\n以上来自当前明细正文，不含未接受候选或任务输出。只概括已有判断及其限制；机械验收不证明事实、法规或财务结论正确。待补、未核实、口径冲突及前置条件均须在总结中保留，不改写成已批准或已证实可行。';
    if(result.length>SUMMARY_FULL_LIMITS.context){const error=new Error('总论/结论全量上下文超安全预算：含章节及块标签共 '+result.length+' 字符，超过 '+SUMMARY_FULL_LIMITS.context+'；未截断结论、风险或表格，请先整理小节。原正文未改动。');error.code='REPORT_SUMMARY_CONTEXT_BUDGET';error.budget=SUMMARY_FULL_LIMITS.context;error.requiredChars=result.length;error.sections=extracts.map(({section,chars})=>({section,chars})).sort((a,b)=>b.chars-a.chars);throw error;}
    return result;
  }
  function summaryContext(chapters,chapter,title,options={}){
    if(!contract(chapter,title).summary)return '';
    const rows=generationOrder(chapters).filter(x=>!contract(x.chapter.name,x.section.t).summary);
    const missing=rows.filter(x=>!(root.ProjectWorkflow?.hasReportBody?root.ProjectWorkflow.hasReportBody(x.section):String(x.section.editedHtml||x.section.content||'').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/[\u200b-\u200f\u2060\ufeff]/g,'').trim())||['stale','locked-stale'].includes(x.section.syncStatus));
    if(missing.length)throw new Error('总论/结论等待正文完成：'+missing.map(x=>x.section.t).join('、')+'。请先续写或重试这些小节。');
    const ready=summaryReadyContracts(chapters,rows,options?.completionPlan);
    if(ready)return summaryFullContext(rows,options.completionPlan,ready);
    if(options?.requireCurrentContracts){const error=new Error('总论/结论尚未就绪：当前全部明细必须绑定同一有效成稿计划，且预算、事实与章节职责一致；未退回旧稿节选。');error.code='REPORT_SUMMARY_CONTRACT_MISMATCH';throw error;}
    const extracts=rows.map(x=>{
      const blocks=summaryParse(x,false);
      if(!blocks.some(b=>b.type!=='heading'))throw new Error('总论/结论等待正文完成：'+x.chapter.name+' / '+x.section.t+'。请先续写或重试这些小节。');
      const selected=[],opening=blocks.findIndex(b=>b.type==='paragraph'),first=opening<0?blocks.findIndex(b=>b.type!=='heading'):opening,last=blocks.findLastIndex(b=>b.type!=='heading');
      blocks.forEach((b,index)=>{
        if(!b.critical&&index!==first&&index!==last)return;
        const excerpt=!b.critical&&index===first&&index!==last&&b.type!=='table'?summaryOpening(b.text):b.text;
        const reason=b.critical?'结论/风险/条件完整块':index===last?'末块完整保留':'开头完整句节选';
        selected.push('【原正文第'+(index+1)+'块'+(b.path?'；'+b.path:'')+'；'+reason+'】\n'+excerpt+(excerpt!==b.text?'\n[仅节选开头完整句；其余普通叙述未展示]':''));
      });
      const label=String(x.chapter.name||'')+' / '+String(x.section.t||''),criticalBlocks=blocks.filter(b=>b.critical).length;
      const text=label+'：\n[来源：当前已接受正文；确定性节选、未核验；完整关键块 '+criticalBlocks+' 个；普通块省略 '+(blocks.length-selected.length)+' 个'+(x.section.pendingRevision?'；未接受候选未采用':'')+']\n'+selected.join('\n\n');
      return {label,criticalBlocks,text};
    });
    const result='\n\n【已完成正文的论证上下文（不是独立核验凭证）】\n'+extracts.map(x=>x.text).join('\n\n')+'\n仅概括已经给出的判断及其限制。节选不是完整论证或事实核验，未展示部分不得据此推断。存在待补、未验证来源或不同口径时保留限制，不改写成正式批准或已证实可行。';
    if(result.length>SUMMARY_CONTEXT_BUDGET){
      const sections=extracts.map(x=>({section:x.label,chars:x.text.length,criticalBlocks:x.criticalBlocks})).sort((a,b)=>b.chars-a.chars);
      const error=new Error('总论/结论上下文超预算：完整关键内容及开头事实共 '+result.length+' 字符，超过 '+SUMMARY_CONTEXT_BUDGET+'；未截断结论、风险或条件。请先整理以下小节，再生成总结：'+sections.map(x=>x.section+'（'+x.chars+'字符）').join('、')+'。原正文未改动。');
      error.code='REPORT_SUMMARY_CONTEXT_BUDGET';error.budget=SUMMARY_CONTEXT_BUDGET;error.requiredChars=result.length;error.sections=sections;throw error;
    }
    return result;
  }
  const api={VERSION,BASIS_SOURCE_VERSION,BASIS_CLASSIFICATION_VERSION,BASIS_LEVELS,basisCatalog,basisCoverage,basisPresentation,SUMMARY_FULL_LIMITS,contract,prompt,generationOrder,runInDependencyOrder,summaryContext};root.ReportArgument=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
