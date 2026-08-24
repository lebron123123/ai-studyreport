/* 可研逐小节生成逻辑运行时：匹配、提示词投影、材料缺口检查。经典script共享作用域，封装在IIFE内。 */
(function reportLogicCoreModule(global){
  "use strict";
  const cache = new Map(), pending = new Map();
  const typeOf = value => value === "sale" ? "sale" : value === "gaibao" ? "gaibao" : "rent";
  const normalize = value => String(value || "")
    .replace(/^第[一二三四五六七八九十百]+章\s*/, "")
    .replace(/^\d+(?:\.\d+)*[、.．]?\s*/, "")
    .replace(/[\s：:，,、（）()\-—_]/g, "").toLowerCase();
  const overlap = (a, b) => {
    a = normalize(a); b = normalize(b);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 3 ? 80 : 45;
    let count = 0;
    const grams = new Set();
    for (let i = 0; i < a.length - 1; i++) grams.add(a.slice(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) if (grams.has(b.slice(i, i + 2))) count++;
    return count * 8;
  };
  async function load(projectType, force){
    const type = typeOf(projectType);
    if (!force && cache.has(type)) return cache.get(type);
    if (!force && pending.has(type)) return pending.get(type);
    const task = fetch("/api/reportlogic?projectType=" + encodeURIComponent(type), { headers: typeof authHeaders === "function" ? authHeaders() : {} })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "生成逻辑读取失败");
        const set = result.set || null;
        cache.set(type, set); pending.delete(type); return set;
      }).catch(error => { pending.delete(type); throw error; });
    pending.set(type, task); return task;
  }
  function current(projectType){ return cache.get(typeOf(projectType)) || null; }
  function match(projectType, chapterName, sectionTitle, options){
    const set = current(projectType), opts = options || {};
    if (!set?.data?.rules) return [];
    const projectText = normalize(opts.projectText || "");
    return set.data.rules.map(rule => {
      const chapterScore = overlap(rule.chapter, chapterName);
      const sectionScore = Math.max(overlap(rule.section, sectionTitle), overlap(rule.subsection, sectionTitle), overlap(rule.pointTitle, sectionTitle), overlap(rule.displayTitle, sectionTitle));
      let specificScore = 0;
      if (rule.projectSpecific) {
        const keywords = normalize(rule.note).replace(/本项目|核心|特色/g, "");
        specificScore = keywords && projectText.includes(keywords) ? 20 : -100;
      }
      return { rule, score: chapterScore + sectionScore + specificScore };
    }).filter(item => item.score >= 115).sort((a,b) => b.score - a.score || a.rule.sourceNo - b.rule.sourceNo).map(item => item.rule);
  }
  function requirementStatus(rule, context){
    const ctx = context || {}, kinds = rule.sourceKinds || [], missing = [];
    const evidence = (ctx.evidenceByRule && ctx.evidenceByRule[rule.id]) || [];
    const hasRuleEvidence = kind => evidence.some(item => {
      if (typeof item === "string") return item === kind || item === "all";
      const evidenceKinds = item && (item.kinds || (item.kind ? [item.kind] : []));
      return Array.isArray(evidenceKinds) && (evidenceKinds.includes(kind) || evidenceKinds.includes("all"));
    });
    if (!kinds.length) missing.push("unclassified");
    for (const kind of kinds) {
      if (hasRuleEvidence(kind)) continue;
      if (kind === "knowledge_base" && !ctx.hasKnowledge) missing.push(kind);
      if (kind === "web_search" && !ctx.hasWebEvidence) missing.push(kind);
      if (kind === "provider" && !ctx.hasProviderData) missing.push(kind);
      if (kind === "manual_upload" && !ctx.hasManualMaterial) missing.push(kind);
      if (kind === "calculation_engine" && !ctx.hasCalculation) missing.push(kind);
      if (kind === "derived_section" && !ctx.hasDerivedSection) missing.push(kind);
    }
    return { ruleId: rule.id, sourceNo: rule.sourceNo, requiredSources: rule.requiredSources, missing, evidence, ready: !missing.length, blocking: /^★★★/.test(rule.importance || "") && (missing.includes("manual_upload") || missing.includes("unclassified")) };
  }
  const criticalPattern = /批复|许可证|证书|权属|合同|纪要|勘察|环评|面积|户数|金额|租金|出租率|人口|比例|单价|总投资|财务|测算|数据|表格/;
  const compact = (value, limit) => {
    const text = String(value || "待确认来源").replace(/【[^】]+】/g, "").replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit) + "…" : text;
  };
  function generationReadiness(rule, context){
    const status = requirementStatus(rule, context);
    if(status.ready) return Object.assign({}, status, {level:"grounded", canDraft:true, marker:""});
    const sourceKinds=rule.sourceKinds||[], form=String(rule.outputForm||"");
    const critical = /^★★★/.test(rule.importance || "")
      || (sourceKinds.includes("manual_upload") && criticalPattern.test(rule.requiredSources||""))
      || (/数据|表格|测算/.test(form) && criticalPattern.test([rule.requiredSources,rule.displayTitle,rule.pointTitle,rule.section].join(" ")));
    return Object.assign({}, status, {
      level: critical ? "critical" : "framework",
      canDraft: true,
      marker: critical ? compact(rule.requiredSources, 90) : ""
    });
  }
  function materialInventory(projectType, context){
    const set=current(projectType),rules=set?.data?.rules||[],ctx=context||{};
    const channelKeys=["knowledge_base","web_search","provider","calculation_engine","manual_upload","derived_section"];
    const emptyCounts=()=>({ready:0,knowledge_base:0,web_search:0,provider:0,calculation_engine:0,manual_upload:0,derived_section:0,unclassified:0,pendingKnowledge:0,pendingWeb:0,pendingProvider:0,pendingCalculation:0,pendingManual:0,pendingDerived:0,blocking:0});
    const pendingKey={knowledge_base:"pendingKnowledge",web_search:"pendingWeb",provider:"pendingProvider",calculation_engine:"pendingCalculation",manual_upload:"pendingManual",derived_section:"pendingDerived",unclassified:"unclassified"};
    const summary=emptyCounts(),groups=new Map();
    const items=rules.map(rule=>{
      const status=requirementStatus(rule,ctx),row={ruleId:rule.id,sourceNo:rule.sourceNo,chapter:rule.chapter,section:rule.section,title:rule.displayTitle||rule.pointTitle||rule.subsection||rule.section,requiredSources:rule.requiredSources||"未指定",importance:rule.importance||"",sourceKinds:rule.sourceKinds||[],missing:status.missing,evidence:status.evidence,ready:status.ready,blocking:status.blocking};
      if(!groups.has(row.chapter))groups.set(row.chapter,{chapter:row.chapter,total:0,counts:emptyCounts(),items:[]});
      const group=groups.get(row.chapter);group.total++;group.items.push(row);
      if(row.ready){summary.ready++;group.counts.ready++;}if(row.blocking){summary.blocking++;group.counts.blocking++;}
      channelKeys.forEach(key=>{if(row.sourceKinds.includes(key)){summary[key]++;group.counts[key]++;}});
      row.missing.forEach(key=>{const pk=pendingKey[key];if(pk){summary[pk]++;group.counts[pk]++;}});
      return row;
    });
    return {version:set?.version||0,total:items.length,summary,chapters:[...groups.values()],items};
  }
  function prompt(projectType, chapterName, sectionTitle, options){
    const rules = match(projectType, chapterName, sectionTitle, options), opts=options||{};
    if (!rules.length) return "";
    return "\n\n【内部生成约束｜严禁写入报告正文】（以下仅供模型规划写作，不是报告内容；不得复述其中的字段名、规则原文、编号或‘写作逻辑’字样。）\n"
      + "材料不足不等于停止写作：禁止整节只输出待补提示或返回空内容；应把规则转化为可直接下载使用的正式报告正文，先写能够成立的背景、分析和论证内容。只有项目专属数字、批复、证照、合同等关键依据，在对应句子或表格单元格处用简短【待补：具体依据】标记。不得输出‘本节重点按照以下逻辑展开’‘材料状态’‘所需材料摘要’‘写作逻辑’‘输出形式’等内部提示语。\n\n" + rules.map(rule => {
      const scope = rule.projectSpecific ? "【仅项目特征命中时适用】" : "";
      const readiness=generationReadiness(rule,opts.context||{});
      const statusText=readiness.level==="grounded"?"已有依据，可据实撰写":readiness.level==="critical"?"可先写框架；关键事实处标注【待补："+readiness.marker+"】":"可先写通用框架；涉及本项目的事实后续核实";
      return `[${rule.id}｜第${rule.sourceNo}项]${scope}\n材料状态：${statusText}\n所需材料摘要：${compact(rule.requiredSources,180)}\n写作逻辑：${rule.writingLogic || "按小节标题规范撰写"}\n输出形式：${rule.outputForm || "文字"}`;
    }).join("\n\n");
  }
  function fallbackDraft(projectType, chapterName, sectionTitle, options){
    const opts=options||{}, rules=match(projectType,chapterName,sectionTitle,opts);
    const critical=rules.map(rule=>({rule,readiness:generationReadiness(rule,opts.context||{})})).filter(x=>x.readiness.level==="critical").slice(0,4);
    const lines=[
      `本项目${sectionTitle}相关工作应以项目实际条件、适用政策及已确认的建设目标为基础，统筹考虑实施必要性、条件适配性和后续运营要求。根据现阶段掌握的信息，可先形成完整的论证框架；涉及本项目的专属事实和关键指标，待正式依据取得后据实补充并复核。`,
      "从现状条件看，应结合项目区位、建设内容、服务对象及实施边界，分析与本节相关的现实基础和主要约束；从实施要求看，应核对适用政策、技术标准和管理要求，明确有关事项对建设方案、投资安排及运营管理的影响；从决策角度看，应在资料核实的基础上形成可追溯、可复核的结论，并将需持续跟踪的事项纳入后续工作计划。"
    ];
    if(opts.numeric){
      lines.push("[[TABLE]]\n核查项目|分析口径|当前状态|待补依据\n核心指标|按正式批复或测算口径核定|待核实|项目正式数据\n比较基准|按适用政策、行业标准或案例口径确定|待核实|有效依据及统计期\n分析结论|待数据齐备后复核形成|框架已建立|相关证明材料\n[[/TABLE]]");
    }
    if(critical.length){
      lines.push("经初步核查，本节尚有以下关键依据需要补充；取得材料后应替换占位内容并同步复核相关判断：\n"+critical.map(x=>`【待补：${x.readiness.marker}】`).join("\n"));
    }else{
      lines.push("后续应结合已核实的项目资料完善具体表述；在依据未确认前，不写入未经证实的项目名称、政策文号和精确数值。");
    }
    return lines.join("\n\n");
  }
  function ensureMissingMarkers(text,rules,context){
    const body=String(text||"");
    const markers=(rules||[]).map(rule=>generationReadiness(rule,context||{})).filter(item=>item.level==="critical"&&item.marker).map(item=>compact(item.marker,100)).filter((item,index,all)=>all.indexOf(item)===index).slice(0,3);
    const missing=markers.filter(marker=>!body.includes(marker));
    if(!missing.length)return body;
    return body+"\n\n**资料待补提示**\n"+missing.map(marker=>`【待补：${marker}】`).join("\n");
  }
  function suggestMaterialRuleLinks(projectType, fileName, content, limit){
    const set=current(projectType),rules=set?.data?.rules||[],query=normalize(String(fileName||"").replace(/\.[^.]+$/," ")+" "+String(content||"").slice(0,5000));
    if(!query||!rules.length)return [];
    const grams=new Set();for(let i=0;i<query.length-1;i++)grams.add(query.slice(i,i+2));
    return rules.map(rule=>{
      const target=normalize([rule.chapter,rule.section,rule.subsection,rule.pointTitle,rule.displayTitle,rule.requiredSources].join(" "));
      let score=0;for(let i=0;i<target.length-1;i++)if(grams.has(target.slice(i,i+2)))score++;
      if(normalize(fileName).includes(normalize(rule.displayTitle||rule.pointTitle||rule.section)))score+=30;
      if((rule.sourceKinds||[]).includes("manual_upload"))score+=3;
      return {ruleId:rule.id,sourceNo:rule.sourceNo,title:rule.displayTitle||rule.pointTitle||rule.section,chapter:rule.chapter,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.sourceNo-b.sourceNo).slice(0,Math.max(1,Number(limit)||8));
  }
  function overview(projectType){
    const set = current(projectType);
    if (!set) return null;
    const rules = set.data?.rules || [];
    return { id:set.id, name:set.name, version:set.version, projectType:set.projectType, ruleCount:rules.length, chapterCount:new Set(rules.map(rule=>rule.chapter)).size, chapters:[...new Set(rules.map(rule=>rule.chapter))] };
  }
  function outline(projectType){
    const set=current(projectType),rules=set?.data?.rules||[];
    if(!rules.length)return null;
    const groups=new Map(),cnMap={一:"一",二:"二",三:"三",四:"四",五:"五",六:"六",七:"七",八:"八",九:"九",十:"十",十一:"十一",十二:"十二",十三:"十三",十四:"十四"};
    rules.forEach(rule=>{if(!groups.has(rule.chapter))groups.set(rule.chapter,[]);const rows=groups.get(rule.chapter);if(!rows.some(x=>normalize(x.t)===normalize(rule.section))){const related=rules.filter(x=>x.chapter===rule.chapter&&x.section===rule.section),numeric=related.some(x=>/数据|表格|计算|测算|投资|财务|价格|租金|供需/.test([x.outputForm,x.requiredSources,x.section].join(" ")));rows.push({t:String(rule.section).replace(/^\d+(?:\.\d+)*\s*/,""),numeric});}});
    return {label:set.name,chapters:[...groups.entries()].map(([chapter,sections])=>{const hit=chapter.match(/^第([一二三四五六七八九十]+)章\s*(.*)$/);return{cn:cnMap[hit&&hit[1]]||(hit&&hit[1])||String(groups.size),name:(hit&&hit[2])||chapter,sections};})};
  }
  global.ReportLogicCore = { load, current, match, prompt, requirementStatus, generationReadiness, fallbackDraft, ensureMissingMarkers, suggestMaterialRuleLinks, materialInventory, overview, outline, normalize };
})(window);
