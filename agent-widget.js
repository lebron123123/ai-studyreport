/* ============================================================ 
   agent-widget.js —— 全站悬浮 AI 助手（阶段二）  
   依赖：agent-core.js（引擎）、auth.js（authHeaders）
   职责：
     1. 注入悬浮按钮 + 侧边对话面板（不侵入任何页面已有逻辑）
     2. 注册一个"感知当前页面"的通用工具，让 AI 知道你在哪、在看什么
     3. 复用 agent-core.js 的循环执行器；工具集合按当前是否已有
        calc.js 注册的工具自动叠加（同一个引擎、同一份工具表）
   红线：这里只注册"只读/查询/导航"类工具，不提供任何"代填参数/
   代点执行/代改数据"的工具——数字与操作仍必须由人在原页面确认。
   ============================================================ */
(function(){
  if(!window.AgentCore){ console.warn("[AgentWidget] AgentCore 未加载，跳过挂载"); return; }
  const AC = window.AgentCore;

  /* ---------- 注册"当前页面上下文"工具 ---------- */
  AC.registerTool("get_current_context", {
    schema: {
      type: "function",
      function: {
        name: "get_current_context",
        description: "获取用户当前所在页面/步骤、当前项目的基本信息。当用户的问题涉及'我现在在哪''这是什么''当前项目情况'等与当前操作场景相关的内容时，应先调用此工具了解上下文，再回答或提供引导建议。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"🧭 读取当前页面上下文",
    run: async ()=>{
      try{
        const lines = [];
        if(typeof appMode!=="undefined"&&appMode===null) lines.push("当前处于首页（功能选择）");
        if(typeof appMode!=="undefined"&&appMode==="aireport") lines.push("当前处于【AI可研生成】对话流程");
        if(typeof appMode!=="undefined"&&appMode==="calc"&&typeof calcType !== "undefined" && typeof scStep !== "undefined") lines.push("当前处于【独立财务测算】，测算类型："+({gaibao:"非居改保",rent:"出租类",sale:"出售类"}[calcType]||calcType)+"，步骤："+(scStep===0?"参数填写":"结果查看"));
        if(typeof appMode!=="undefined"&&(appMode==="report"||appMode==="aireport")&&typeof project !== "undefined" && project && project.name) lines.push("当前项目名称："+project.name+(project.location?"，建设地点："+project.location:""));
        if(typeof rptCtype !== "undefined" && rptCtype) lines.push("报告内测算类型："+rptCtype);
        if(typeof appMode!=="undefined"&&appMode==="review") lines.push("当前处于【可研智能审查】页面");
        if(typeof appMode!=="undefined"&&appMode==="office") lines.push("当前处于【AI办公助手】"+(typeof officeView!=="undefined"&&officeView!=="chat"?"，子模块："+officeView:""));
        if(typeof appMode!=="undefined"&&appMode==="personalKnowledge") lines.push("当前处于【个人知识库】");
        if(typeof appMode!=="undefined"&&appMode==="collaboration") lines.push("当前处于【知识与规则】");
        if(typeof appMode!=="undefined"&&appMode==="analysis") lines.push("当前处于【项目数据分析】");
        return lines.length ? lines.join("；") : "（无法识别具体页面状态，可能在首页或某个通用页面）";
      }catch(e){ return "（读取页面上下文时出错："+e.message+"）"; }
    },
  });

  /* ---------- 阶段三：扩充工具箱（跨模块只读工具） ---------- */

  /* 工具：系统自身能力自述（元问题专用）
     背景：用户经常问"你能参考多少模板""这网站有哪些功能""知识库里有什么资料"这类
     关于系统自身的问题。这类问题的答案是系统内置配置 + 知识库台账，不是需要去文档里
     语义检索的事实。以前没有这个工具时，AI 只能拿 search_knowledge_base 硬查，
     查询词再怎么换也文不对题，最后绕到"多次查询后仍未能得出确定结论"，体验很差。 */
  AC.registerTool("get_system_capabilities", {
    schema: {
      type: "function",
      function: {
        name: "get_system_capabilities",
        description: "获取本系统自身的功能、配置与知识库存量情况。当用户问的是关于'这个系统/你自己'的问题时调用，例如：你能写哪些类型的公文、能参考多少模板范文、这个网站有哪些功能、知识库里有多少资料/哪类资料最多、你能做什么/不能做什么。注意：这类问题不要用 search_knowledge_base 去检索，用本工具直接获取准确答案。",
        parameters: {
          type:"object",
          properties:{
            aspect:{type:"string", description:"想了解的方面(可选)：functions=网站功能模块；doctypes=公文文种规范；knowledge=知识库存量分布；tools=AI助手可用的查询能力。不传则返回全部。"},
          },
          required:[],
        },
      },
    },
    validate: (args)=> AC.V.optionalEnum(args, "aspect", ["functions","doctypes","knowledge","tools"], "aspect"),
    label: (args)=>"📖 查询系统自身能力" + (args && args.aspect ? "（"+args.aspect+"）" : ""),
    run: async (args)=>{
      const aspect = (args && args.aspect) || "";
      const want = (k)=> !aspect || aspect === k;
      const out = [];

      if(want("functions")){
        out.push("【本系统的功能模块】\n"
          + "1. 可研报告生成：选择领域→录入项目信息→自动财务测算→逐章AI撰写→人工复核签发→导出Word\n"
          + "2. 独立财务测算：非居改保/出租类/出售类三套测算引擎，数字由确定性代码算出，非AI估算\n"
          + "3. 可研智能审查：硬规则秒查 + AI深度评审，可定位问题并定向修改后重审\n"
          + "4. AI办公助手：日常公文起草、数据整理成表、业务分析，可导出Word/Excel\n"
          + "另有：选址调研(周边配套/竞品POI)、云端项目库、知识库检索。");
      }

      if(want("doctypes")){
        let dts = [];
        try{ if(typeof DOC_TYPES !== "undefined" && Array.isArray(DOC_TYPES)) dts = DOC_TYPES; }catch(e){}
        if(dts.length){
          const byCat = {};
          dts.forEach(d=>{ (byCat[d.cat] = byCat[d.cat] || []).push(d.key); });
          out.push("【AI办公助手内置的公文文种规范，共 " + dts.length + " 种】\n"
            + Object.keys(byCat).map(c=>"· "+c+"："+byCat[c].join("、")).join("\n")
            + "\n说明：这是系统内置的写作规范（结构、用语、格式要求），起草时会自动识别文种并套用；"
            + "它与知识库里的『模板范文』是两回事——前者是规范，后者是本单位历史真实范文。");
        }else{
          out.push("【公文文种规范】当前页面未加载办公助手模块，无法读取文种清单；请到「AI办公助手」页面再问。");
        }
      }

      if(want("knowledge")){
        try{
          const r = await fetch("/api/rag", {method:"POST",
            headers: Object.assign({"Content-Type":"application/json"}, (window.authHeaders ? window.authHeaders() : {})),
            body: JSON.stringify({action:"catalog"})});
          const d = await r.json();
          if(d && d.ok && (d.categories||[]).length){
            out.push("【知识库存量（仅统计你有权限查看、且已启用的资料）】\n"
              + "合计 " + d.total + " 份文件"
              + (d.expired ? "（其中 " + d.expired + " 份已失效或尚未生效，检索时会降权并标注）" : "")
              + "\n" + d.categories.map(c=>"· "+c.category+"："+c.count+"份"
                  + (c.expired ? "(含"+c.expired+"份失效)" : "")
                  + (c.titles && c.titles.length ? "，例如：" + c.titles.slice(0,3).join("、") : "")).join("\n"));
          }else if(d && d.ok){
            out.push("【知识库存量】你当前有权限查看的知识库文件为 0 份。可能是尚未上传资料，或现有资料的密级/部门范围超出你的权限。");
          }else{
            out.push("【知识库存量】读取失败：" + ((d && d.error) || "未知原因"));
          }
        }catch(e){
          out.push("【知识库存量】读取失败：" + e.message);
        }
      }

      if(want("tools")){
        const names = Object.keys(AC._tools || {});
        const CN = {
          get_calc_summary:"读取本次财务测算的真实结果",
          search_knowledge_base:"语义检索单位知识库文档内容",
          get_current_context:"感知你当前在哪个页面/步骤",
          get_project_info:"读取当前正在编辑的项目信息",
          get_site_survey:"读取周边配套、竞品调研与客群定位",
          list_my_projects:"列出你云端保存的历史项目",
          get_past_project:"读取某个历史项目的详情",
          get_review_issues:"读取智能审查发现的问题清单",
          suggest_navigation:"建议你去哪个功能页面操作",
          remember_preference:"记住你的偏好，供以后对话参考",
          forget_preference:"删除已记住的某条偏好",
          get_system_capabilities:"查询系统自身的功能与配置（本工具）",
        };
        out.push("【我能查的东西】\n" + names.map(n=>"· "+(CN[n]||n)).join("\n")
          + "\n【我不能做的】不联网查实时信息；不代你填写参数、不代你点击执行、不代改数据；"
          + "财务数字一律来自内置测算引擎，我不会自己算或改写。");
      }

      return out.join("\n\n") || "（未获取到相应信息）";
    },
  });


  // 工具：读取当前项目信息(仅在"可研生成"流程中有效)
  AC.registerTool("get_project_info", {
    schema: {
      type: "function",
      function: {
        name: "get_project_info",
        description: "获取用户当前正在编辑的项目基本信息(名称/建设单位/地点/规模/概况/客群定位/竞品调研/周边配套)。当用户询问'我这个项目现在填了什么''帮我看看项目信息'等问题时调用。仅在'可研生成'流程中有数据，其他场景请如实告知用户当前不在该流程。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📁 读取当前项目信息",
    run: async ()=>{
      try{
        if(typeof project === "undefined" || !project || !project.name){
          return "（当前不在'可研生成'流程中，或尚未填写项目信息）";
        }
        const lines = [];
        lines.push("项目名称："+project.name);
        if(project.owner) lines.push("建设/委托单位："+project.owner);
        if(project.location) lines.push("建设地点："+project.location);
        if(project.scale) lines.push("投资规模："+project.scale+"万元");
        if(project.desc) lines.push("项目概况："+String(project.desc).slice(0,200));
        if(project.targetGroup) lines.push("主力客群："+project.targetGroup);
        if(project.unitPlan) lines.push("户型策略："+project.unitPlan);
        if(project.rentPlan) lines.push("租金策略："+project.rentPlan);
        if(project.competitors && project.competitors.length){
          const cps = project.competitors.filter(c=>c.name);
          if(cps.length) lines.push("竞品调研："+cps.map(c=>c.name+(c.rent?"(租金"+c.rent+")":"")).join("、"));
        }
        return lines.join("\n");
      }catch(e){ return "（读取项目信息出错："+e.message+"）"; }
    },
  });

  // 工具：读取周边配套与竞品调研（选址调研模块的真实数据）
  AC.registerTool("get_site_survey", {
    schema: {
      type: "function",
      function: {
        name: "get_site_survey",
        description: "获取当前项目的选址调研数据：周边配套(地图实测的地铁/学校/医院/商业等)、周边竞品(名称/距离/租金/出租率)、客群与产品定位。当用户询问'周边有什么配套''竞品租金多少''这个位置怎么样''客群定位是什么'等问题时调用。数据来自地图实测与人工录入，不得自行编造其他竞品或配套。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📍 读取周边配套与竞品调研",
    run: async ()=>{
      try{
        if(typeof surveyBrief !== "function") return "（选址调研模块未加载，请到「可研生成」流程中再问）";
        const s = surveyBrief();
        return (s && s.trim()) ? s.trim()
          : "（当前项目尚未录入周边配套与竞品调研数据，可到「可研生成」的选址调研步骤补充）";
      }catch(e){ return "（读取选址调研数据出错："+e.message+"）"; }
    },
  });

  // 工具：列出我的历史项目（云端项目库）
  AC.registerTool("list_my_projects", {
    schema: {
      type: "function",
      function: {
        name: "list_my_projects",
        description: "列出当前用户保存在云端的历史项目（项目名称与最近更新时间）。当用户提到'我之前做过的项目''我有哪些项目''上次那个项目'等，需要跨项目查找时，先调用此工具拿到项目清单，再用 get_past_project 查具体某个项目的详情。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"🗂 读取我的历史项目列表",
    run: async ()=>{
      try{
        const r = await fetch("/api/projects", {headers: (window.authHeaders ? window.authHeaders() : {})});
        if(r.status === 401) return "（登录已过期，无法读取云端项目，请重新登录）";
        const d = await r.json();
        const list = (d && d.list) || [];
        if(!list.length) return "（云端还没有保存过的项目）";
        return "共 " + list.length + " 个历史项目（按最近更新排序）：\n"
          + list.slice(0, 30).map((p,i)=>{
              const t = new Date(p.updated_at);
              return (i+1) + ". " + (p.name || "未命名项目")
                + "（更新于 " + t.getFullYear() + "-" + String(t.getMonth()+1).padStart(2,"0") + "-" + String(t.getDate()).padStart(2,"0") + "）";
            }).join("\n")
          + (list.length > 30 ? "\n（仅列出最近30个）" : "");
      }catch(e){ return "（读取历史项目出错："+e.message+"）"; }
    },
  });

  // 工具：读取某个历史项目的详情摘要
  // 用项目名称模糊匹配而非ID——AI记不住UUID，让它猜ID只会编出不存在的ID
  AC.registerTool("get_past_project", {
    schema: {
      type: "function",
      function: {
        name: "get_past_project",
        description: "读取某个历史项目的详细信息（基本信息、测算参数、报告进度）。用项目名称查找，名称可以只写一部分。当用户要对比历史项目、参考以前的做法、查以前项目的数据时调用。如果不确定项目叫什么，先用 list_my_projects 看清单。",
        parameters: {
          type:"object",
          properties:{ name:{type:"string", description:"项目名称（可以是名称的一部分，会模糊匹配）"} },
          required:["name"],
        },
      },
    },
    validate: (args)=> AC.V.requiredString(args, "name", 100, "name"),
    label: (args)=>"📂 读取历史项目：" + ((args && args.name) || ""),
    run: async (args)=>{
      try{
        const kw = String((args && args.name) || "").trim();
        const H = (window.authHeaders ? window.authHeaders() : {});
        const lr = await fetch("/api/projects", {headers: H});
        if(lr.status === 401) return "（登录已过期，无法读取云端项目，请重新登录）";
        const ld = await lr.json();
        const list = (ld && ld.list) || [];
        if(!list.length) return "（云端还没有保存过的项目）";

        let hits = list.filter(p => String(p.name||"").includes(kw));
        if(!hits.length){
          return "（没有找到名称包含「" + kw + "」的项目。现有项目："
            + list.slice(0,10).map(p=>p.name||"未命名").join("、") + "）";
        }
        if(hits.length > 1){
          // 多个同名候选：不擅自挑一个，交回给用户确认，避免答错项目还看不出来
          return "找到 " + hits.length + " 个名称相近的项目：" + hits.map(p=>p.name||"未命名").join("、")
            + "。请让用户确认具体是哪一个，再用完整名称重新查询。";
        }

        const pr = await fetch("/api/projects?id=" + encodeURIComponent(hits[0].id), {headers: H});
        const pd = await pr.json();
        if(!pd || !pd.ok) return "（读取项目详情失败：" + ((pd && pd.error) || "未知原因") + "）";
        const data = pd.project.data || {};
        const pj = data.project || {};
        const lines = ["项目名称：" + (pd.project.name || "未命名")];
        if(pj.owner) lines.push("建设/委托单位：" + pj.owner);
        if(pj.location) lines.push("建设地点：" + pj.location);
        if(pj.type) lines.push("项目类型：" + pj.type);
        if(pj.scale) lines.push("投资规模：" + pj.scale + "万元");
        if(pj.desc) lines.push("项目概况：" + String(pj.desc).slice(0, 200));
        if(pj.targetGroup) lines.push("主力客群：" + pj.targetGroup);
        if(pj.unitPlan) lines.push("户型策略：" + pj.unitPlan);
        if(pj.rentPlan) lines.push("租金策略：" + pj.rentPlan);
        const cps = (pj.competitors || []).filter(c=>c && c.name);
        if(cps.length) lines.push("竞品调研：" + cps.map(c=>c.name + (c.rent ? "(租金"+c.rent+")" : "")).join("、"));
        if(data.calcParams) lines.push("已录入财务测算参数（如需具体测算结果，请打开该项目查看，本工具不重算数字）");
        const chs = data.chapters || [];
        if(chs.length){
          const total = chs.reduce((n,c)=>n + (c.sections||[]).length, 0);
          const done = chs.reduce((n,c)=>n + (c.sections||[]).filter(s=>s.content).length, 0);
          lines.push("报告进度：共" + chs.length + "章" + total + "节，已生成" + done + "节"
            + (data.signed ? "，已签发" : "，未签发"));
        }
        const t = new Date(pd.project.updated_at);
        lines.push("最近更新：" + t.toLocaleDateString("zh-CN"));
        return lines.join("\n");
      }catch(e){ return "（读取历史项目出错："+e.message+"）"; }
    },
  });

  // 工具：读取当前"可研智能审查"的AI评审结果(仅在该流程中有效)
  AC.registerTool("get_review_issues", {
    schema: {
      type: "function",
      function: {
        name: "get_review_issues",
        description: "获取用户当前'可研智能审查'流程中，AI对上传报告的评审结果(各章节评分与具体问题清单)。当用户询问'审查结果怎么样''有哪些问题'等问题时调用。仅在完成过AI评审后有数据。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📋 读取审查结果",
    run: async ()=>{
      try{
        const results = window.__lastAuditResults;
        if(!results || !results.length) return "（尚未运行过AI深度评审，暂无数据）";
        const scored = results.filter(r=>r.score!==null);
        const failed = results.filter(r=>r.err);
        const avg = scored.length? Math.round(scored.reduce((s,r)=>s+r.score,0)/scored.length) : 0;
        const lines = ["全篇平均分："+avg+"（共"+results.length+"节，成功评审"+scored.length+"节"
          +(failed.length? "，"+failed.length+"节评审失败" : "")+"）"];
        results.slice(0,10).forEach(r=>{
          const head = "第"+r.cn+"章 "+(r.secTitle||"");
          if(r.err){ lines.push(head+"：评审失败（"+r.err+"），该节未获得评分"); return; }
          const issueTxt = (r.issues||[]).map(it=>(it.point||"")+"："+(it.suggestion||"")).join("；");
          lines.push(head+"：得分"+(r.score===null?"—":r.score)+(issueTxt?"，问题："+issueTxt:"，无明显问题"));
        });
        if(results.length > 10) lines.push("（仅列出前10节，共"+results.length+"节）");
        return lines.join("\n");
      }catch(e){ return "（读取审查结果出错："+e.message+"）"; }
    },
  });

  // 工具：建议导航（只返回建议，不代替用户点击——由面板渲染可点击按钮，用户自己确认跳转）
  const NAV_TARGETS = [
    { key:"aireport", label:"AI可研生成", desc:"对话式完成信息提取、测算和逐章生成" },
    { key:"calc", label:"财务测算", desc:"独立测算非居改保、出租和出售类项目" },
    { key:"review", label:"可研智能审查", desc:"上传外部报告进行智能审查" },
    { key:"report", label:"传统可研生成", desc:"按步骤编制和复核可研报告" },
    { key:"office", label:"AI办公助手", desc:"公文、分析和日常办公问答" },
    { key:"ppt", label:"AI PPT", desc:"材料读取、大纲确认、逐页设计和导出" },
    { key:"assets", label:"PPT素材中心", desc:"查看个人、项目和部门共享素材" },
    { key:"personalKnowledge", label:"个人知识库", desc:"管理个人资料、笔记和知识问答" },
    { key:"collaboration", label:"知识与规则", desc:"查看规则并提交资料或建议" },
    { key:"analysis", label:"项目数据分析", desc:"人口、职住、需求和周边设施分析" },
    { key:"home", label:"返回首页", desc:"查看全部功能入口" },
  ];
  AC.registerTool("suggest_navigation", {
    schema: {
      type: "function",
      function: {
        name: "suggest_navigation",
        description: "当用户想去某个功能模块，或你判断应该引导用户前往某个页面完成操作时调用。此工具只准备导航按钮，不会自动跳转，必须由用户点击确认。",
        parameters: {
          type:"object",
          properties:{ target:{ type:"string", description:"目标模块：aireport/calc/review/report/office/ppt/assets/personalKnowledge/collaboration/analysis/home" } },
          required:["target"],
        },
      },
    },
    validate: (args)=> AC.V.all([
      AC.V.requiredString(args, "target", 20, "target"),
      AC.V.optionalEnum(args, "target", NAV_TARGETS.map(t=>t.key), "target"),
    ]),
    label: (args)=>"🧭 建议跳转："+(NAV_TARGETS.find(t=>t.key===args.target)||{}).label,
    run: async (args)=>{
      try{
        const t = NAV_TARGETS.find(x=>x.key===(args&&args.target));
        if(!t) return "（未知目标模块）";
        return "已为用户准备好前往「"+t.label+"」的入口按钮(界面会显示，等待用户点击确认，不会自动跳转)";
      }catch(e){ return "（生成导航建议出错："+e.message+"）"; }
    },
  });

  // 工具：记住用户偏好(AI主动调用,内容对用户完全透明可查可删)
  AC.registerTool("remember_preference", {
    schema: {
      type: "function",
      function: {
        name: "remember_preference",
        description: "当用户明确表达了长期偏好、常用信息或希望你记住的事情时调用(例如'我一般做非居改保项目'、'记住我们单位叫XX'、'我常用的竞品是XX')。不要记录一次性的临时信息或敏感数据(密码、身份证等)。记录的内容用户可以随时查看和删除。",
        parameters: {
          type:"object",
          properties:{
            key:{ type:"string", description:"偏好名称，简短，如'常做项目类型'、'所属单位'" },
            value:{ type:"string", description:"偏好内容，如'非居改保'、'XX安居集团'" },
          },
          required:["key","value"],
        },
      },
    },
    validate: (args)=> AC.V.all([
      AC.V.requiredString(args, "key", 40, "key"),
      AC.V.requiredString(args, "value", 200, "value"),
    ]),
    label: (args)=>"🧠 记住："+(args.key||"")+"="+(args.value||""),
    run: async (args)=>{
      try{
        const ok = await AC.saveMemory(args.key, args.value, "auto");
        return ok ? "已记住：" + args.key + "＝" + args.value + "（用户可在助手面板的记忆管理里查看或删除）"
                  : "（记忆保存失败，请稍后再试）";
      }catch(e){ return "（记忆保存出错："+e.message+"）"; }
    },
  });

  // 工具：忘记某条记忆
  AC.registerTool("forget_preference", {
    schema: {
      type: "function",
      function: {
        name: "forget_preference",
        description: "当用户要求忘记/删除某条已记住的信息时调用(例如'别记我的单位了')。",
        parameters: {
          type:"object",
          properties:{ key:{ type:"string", description:"要删除的偏好名称，需与已记住的名称一致" } },
          required:["key"],
        },
      },
    },
    validate: (args)=> AC.V.requiredString(args, "key", 40, "key"),
    label: (args)=>"🗑 忘记："+(args.key||""),
    run: async (args)=>{
      try{
        const ok = await AC.deleteMemory(args.key);
        return ok ? "已忘记「"+args.key+"」" : "（删除失败或该条记忆不存在）";
      }catch(e){ return "（删除记忆出错："+e.message+"）"; }
    },
  });

  /* ---------- 注入 UI ---------- */
  const style = document.createElement("style");
  style.textContent = `
    #awBtn{
      position:fixed; left:calc(100vw - 94px); top:calc(100vh - 116px); z-index:901;
      width:72px; height:82px; padding:0; border:0; cursor:grab; touch-action:none;
      color:#fff; background:transparent; filter:drop-shadow(0 9px 10px rgba(30,75,114,.25));
      display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
      transition:filter .18s ease; user-select:none;
    }
    #awBtn:hover{ filter:drop-shadow(0 12px 13px rgba(30,75,114,.34)); }
    #awBtn.dragging{cursor:grabbing;transition:none}
    .aw-avatar{width:62px;height:62px;display:block;transform:translate(var(--aw-look-x,0),var(--aw-look-y,0)) rotate(var(--aw-tilt,0deg));transition:transform .16s ease}
    .aw-avatar .aw-eye{transform:translate(var(--aw-eye-x,0),var(--aw-eye-y,0));transition:transform .09s linear}
    .aw-avatar .aw-ring{animation:awPulse 2.8s ease-in-out infinite;transform-origin:center}
    .aw-name{margin-top:-2px;padding:3px 9px;border-radius:99px;background:#fff;border:1px solid #C8DCEB;color:var(--bp-deep,#1E4B72);font-size:10.5px;font-weight:700;white-space:nowrap;box-shadow:0 3px 8px rgba(30,75,114,.12)}
    .aw-nudge{position:absolute;right:61px;bottom:22px;width:max-content;max-width:180px;padding:7px 10px;border-radius:10px 10px 2px 10px;background:#fff;border:1px solid #C8DCEB;color:#345D7D;font-size:11px;line-height:1.5;box-shadow:0 7px 20px rgba(30,75,114,.13);pointer-events:none;animation:awNudge 8s ease both}
    @keyframes awPulse{50%{transform:scale(1.035)}}
    @keyframes awNudge{0%,100%{opacity:0;transform:translateX(8px)}8%,78%{opacity:1;transform:none}}
    #awPanel{
      position:fixed; left:calc(100vw - 438px); top:calc(100vh - 650px); z-index:900;
      width:410px; height:min(590px,calc(100vh - 36px)); max-width:calc(100vw - 24px); display:none;
      flex-direction:column; background:#fff; border:1px solid var(--line,#DCE6F0);
      border-radius:16px; box-shadow:0 20px 60px -16px rgba(30,75,114,.38);
      overflow:hidden;
    }
    #awPanel.open{ display:flex; }
    #awHead{
      min-height:54px;padding:0 15px;background:linear-gradient(135deg,#EDF6FC,#F6FAFD);border-bottom:1px solid var(--line,#DCE6F0);
      display:flex;justify-content:space-between;align-items:center;color:var(--bp-deep,#1E4B72);cursor:move;touch-action:none;user-select:none;
    }
    .aw-head-title{display:flex;align-items:center;gap:9px}.aw-head-title>span{width:30px;height:30px;border-radius:10px;background:#2D78B5;color:#fff;display:grid;place-items:center;font-size:16px}.aw-head-title b{display:block;font-size:13.5px}.aw-head-title small{display:block;margin-top:1px;color:#6E879A;font-size:9.5px;font-weight:400}
    .aw-head-actions{display:flex;align-items:center;gap:9px}.aw-head-actions a{font-size:11px;font-weight:400;color:var(--bp-navy,#2C6CA6);text-decoration:none}
    #awHead .awClose{ cursor:pointer; color:var(--ink-soft,#66788C); font-size:18px; line-height:1; background:none; border:none; }
    #awPageBar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;border-bottom:1px solid #E7EEF4;background:#FBFDFE;font-size:10.5px;color:#668096}#awPageBar b{color:#2A5F87;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #awMsgs{ flex:1; overflow-y:auto; padding:14px; font-size:13px; line-height:1.7;background:#F7FAFC; }
    #awMsgs .aw-m{ margin-bottom:11px; padding:10px 12px; border-radius:10px; }
    #awMsgs .aw-u{ background:#DDECF8;margin-left:36px;border-bottom-right-radius:3px; }
    #awMsgs .aw-a{ background:#FFF; border:1px solid var(--line,#DCE6F0);margin-right:18px;border-bottom-left-radius:3px; }
    #awMsgs .aw-trace{ font-size:11px; color:var(--ink-soft,#66788C); margin-bottom:5px; }
    #awMsgs .aw-pending{border-color:#BFD8EA;background:linear-gradient(110deg,#fff 20%,#F0F7FC 40%,#fff 60%);background-size:220% 100%;animation:awThinking 1.5s linear infinite}
    #awMsgs .aw-thinking-dots{display:inline-flex;gap:3px;margin-left:5px;vertical-align:middle}#awMsgs .aw-thinking-dots i{width:4px;height:4px;border-radius:50%;background:#2C78B5;animation:awDot 1s ease-in-out infinite}#awMsgs .aw-thinking-dots i:nth-child(2){animation-delay:.16s}#awMsgs .aw-thinking-dots i:nth-child(3){animation-delay:.32s}
    @keyframes awThinking{to{background-position:-220% 0}}@keyframes awDot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
    .aw-quick{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.aw-quick button{border:1px solid #BED3E4;border-radius:99px;background:#fff;color:#2C638E;padding:6px 10px;font-size:10.5px;cursor:pointer}.aw-quick button:hover{background:#EAF4FB}
    #awInputBar{ display:grid;grid-template-columns:1fr auto;gap:7px;padding:11px 12px 12px;border-top:1px solid var(--line,#DCE6F0);background:#fff }
    #awInputBar input{ min-width:0;font-size:13px;padding:10px 11px;border:1px solid var(--line,#DCE6F0);border-radius:8px;outline:none; }
    #awInputBar button{ flex-shrink:0;padding:9px 15px;border:none;border-radius:8px;background:var(--bp-navy,#2C6CA6);color:#fff;font-size:12.5px;cursor:pointer; }
    #awInputBar button:disabled{ opacity:.5; cursor:wait; }
    #awEmpty{ color:var(--ink-soft,#66788C);font-size:12.5px;padding:12px 5px;line-height:1.75 }
    #awEmpty b{display:block;color:#234F70;font-size:15px;margin-bottom:5px}
    .aw-nav-btn{margin-top:8px;padding:7px 13px;font-size:11.5px;border:1px solid var(--bp-navy,#2C6CA6);border-radius:7px;background:#fff;color:var(--bp-navy,#2C6CA6);cursor:pointer;font-weight:650}
    @media(max-width:620px){#awPanel{left:12px!important;top:12px!important;width:calc(100vw - 24px);height:calc(100vh - 96px)}#awBtn{left:calc(100vw - 82px);top:calc(100vh - 104px)}.aw-nudge{display:none}}
    @media(prefers-reduced-motion:reduce){.aw-avatar,.aw-avatar .aw-eye,.aw-ring{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "awBtn"; btn.title = "拖动我；点击打开AI助手"; btn.setAttribute("aria-label","打开可拖动AI助手");
  btn.innerHTML = '<span class="aw-nudge">需要帮助？我可以回答问题，也能带你去对应功能</span><svg class="aw-avatar aw-cat" viewBox="0 0 72 68" aria-hidden="true"><g class="aw-cat-body"><path class="aw-cat-tail" d="M53 48c14 3 15-13 7-15" fill="none" stroke="#2B79B5" stroke-width="6" stroke-linecap="round"/><ellipse cx="36" cy="47" rx="21" ry="16" fill="#2B79B5"/></g><g class="aw-cat-head"><path d="M18 24 16 8l13 9M54 24 56 8 43 17" fill="#2B79B5"/><circle cx="36" cy="29" r="21" fill="#63B5E8" stroke="#2B79B5" stroke-width="2"/><path d="M21 20 18 10l9 7m24 3 3-10-9 7" fill="#9BD7F5"/><ellipse cx="36" cy="36" rx="12" ry="9" fill="#E8F7FF"/><g class="aw-eye"><ellipse cx="28" cy="28" rx="3.2" ry="4" fill="#173E5D"/><ellipse cx="44" cy="28" rx="3.2" ry="4" fill="#173E5D"/><circle cx="27" cy="27" r="1" fill="#fff"/><circle cx="43" cy="27" r="1" fill="#fff"/></g><path class="aw-cat-nose" d="m34 34 2 2 2-2" fill="#E88491"/><path class="aw-cat-mouth" d="M36 36q-3 4-6 1m6-1q3 4 6 1" fill="none" stroke="#496F89" stroke-width="1.3" stroke-linecap="round"/><path d="M23 36 9 33m14 7L9 42m40-6 14-3m-14 7 14 2" stroke="#78AFCF" stroke-width="1.2"/></g><path class="aw-cat-paw aw-cat-paw-left" d="M24 51v10" stroke="#63B5E8" stroke-width="8" stroke-linecap="round"/><path class="aw-cat-paw aw-cat-paw-right" d="M48 51v10" stroke="#63B5E8" stroke-width="8" stroke-linecap="round"/><g class="aw-cat-snack"><circle cx="59" cy="55" r="5" fill="#E9A84A"/><circle cx="57" cy="53" r="1" fill="#8C5A28"/><circle cx="61" cy="56" r="1" fill="#8C5A28"/></g><g class="aw-cat-toy"><circle cx="61" cy="59" r="5" fill="#E88491"/><path d="M58 56l6 6m0-6-6 6" stroke="#fff" stroke-width="1"/></g><text class="aw-cat-zzz" x="55" y="16" fill="#3B80B5" font-size="9" font-weight="700">Z</text></svg><span class="aw-name">蓝喵助手</span>';
  const panel = document.createElement("div");
  panel.id = "awPanel";
  panel.innerHTML = `
    <div id="awHead"><div class="aw-head-title"><span>喵</span><div><b>蓝喵全站助手</b><small>网站客服 · 操作引导 · 功能导航</small></div></div><div class="aw-head-actions"><a href="javascript:void(0)" id="awPetToggle" title="暂停或开启宠物活动">🐾 活动</a><a href="javascript:void(0)" id="awMemBtn">记忆</a><button class="awClose" id="awClose" title="关闭">×</button></div></div>
    <div id="awPageBar"><span>正在帮助你使用</span><b id="awPageName">首页</b></div>
    <div id="awMemPanel" style="display:none; padding:10px 14px; border-bottom:1px solid var(--line,#DCE6F0); background:#F7FAFD; font-size:12px; max-height:180px; overflow-y:auto;"></div>
    <div id="awMsgs"></div>
    <div id="awInputBar">
      <input id="awInput" type="text" placeholder="随时问我…">
      <button id="awSend">发送</button>
    </div>
  `;
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  let awChat = [];
  function esc(s){ const d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; }
  const NAV_LABELS = Object.fromEntries(NAV_TARGETS.map(t=>[t.key,t.label]));
  const AW_PAGE_LABELS = {aireport:"AI可研生成",calc:"财务测算",review:"可研智能审查",report:"传统可研生成",office:"AI办公助手",personalKnowledge:"个人知识库",collaboration:"知识与规则",analysis:"项目数据分析"};
  function awCurrentPageLabel(){
    try{
      if(appMode==="office"&&typeof officeView!=="undefined"&&officeView==="ppt")return "AI PPT";
      if(appMode==="office"&&typeof officeView!=="undefined"&&officeView==="assets")return "PPT素材中心";
      return AW_PAGE_LABELS[appMode]||"首页";
    }catch(_){return "当前页面";}
  }
  function awEmptyHtml(){
    return '<div id="awEmpty"><b>你好，我是全站AI助手</b>可以问我当前页面怎么用、某项结果怎么看，或者让我带你进入需要的功能。'
      +'<div class="aw-quick"><button data-aw-q="这个页面怎么用？">这个页面怎么用</button><button data-aw-nav="aireport">生成可研</button><button data-aw-nav="calc">财务测算</button><button data-aw-nav="review">审查报告</button><button data-aw-nav="office">AI办公</button></div></div>';
  }
  function awBindQuickActions(box){
    box.querySelectorAll("[data-aw-nav]").forEach(b=>{b.onclick=()=>{
      const key=b.dataset.awNav;awChat.push({role:"assistant",content:"可以，我已经准备好入口。请点击下方按钮确认前往。",navTarget:key});renderAw();
    };});
    box.querySelectorAll("[data-aw-q]").forEach(b=>{b.onclick=()=>{const input=document.getElementById("awInput");input.value=b.dataset.awQ||"";sendAw();};});
  }
  // 根据消息上挂的navTarget(结构化数据,来自工具调用记录)渲染"点击确认跳转"按钮——不自动执行，人工点击才生效
  function renderNavButtons(navTarget){
    if(!navTarget || !NAV_LABELS[navTarget]) return "";
    return '<div><button class="aw-nav-btn" data-nav="'+navTarget+'">确认前往「'+NAV_LABELS[navTarget]+'」 →</button></div>';
  }
  function doNav(key){
    if(typeof goHome !== "function") return;
    if(key === "home"){ goHome(); panel.classList.remove("open"); return; }
    // 注意:let/const声明的顶层变量不会挂到window上,必须直接赋值(同一全局作用域下的裸标识符)才能改到真正生效的那个变量
    try{
      const mode=key==="ppt"||key==="assets"?"office":key;
      appMode = mode;
      if(key==="calc") scStep = 0;
      if(key==="review") rvStep = 0;
      if(key==="report") currentStep = 0;
      if(key==="ppt") officeView="ppt";
      if(key==="assets") officeView="assets";
      if(key==="office") officeView="chat";
      if(typeof renderTOC==="function") renderTOC();
      if(typeof renderSheet==="function") renderSheet();
    }catch(e){ console.warn("[AgentWidget] 导航失败:", e.message); }
    panel.classList.remove("open");
  }
  function renderAw(){
    const box = document.getElementById("awMsgs");
    const pageName=document.getElementById("awPageName");if(pageName)pageName.textContent=awCurrentPageLabel();
    if(!awChat.length){ box.innerHTML = awEmptyHtml();awBindQuickActions(box);return; }
    box.innerHTML = awChat.map(m=>{
      const traceHtml = (m.trace && m.trace.length) ? '<div class="aw-trace">'+m.trace.map(t=>esc(t)).join("<br>")+'</div>' : "";
      const navBtn = m.role==="assistant" ? renderNavButtons(m.navTarget) : "";
      const scBadge = (m.role==="assistant" && m.selfChecked)
        ? '<div style="font-size:10.5px; color:var(--ok-green,#3E7A53); margin-top:5px;">✓ 已自我核查'
          + ((m.selfCheckNotes && m.selfCheckNotes.length) ? '（首版存在「'+esc(m.selfCheckNotes[0])+'」，已补充后重答）' : '')
          + '</div>'
        : "";
      const pending = m.pending ? '<span class="aw-thinking-dots" aria-label="AI正在处理"><i></i><i></i><i></i></span><div style="margin-top:5px;color:#668096;font-size:10.5px;">已等待 '+Math.max(0,m.elapsed||0)+' 秒，页面没有卡住</div>' : "";
      return '<div class="aw-m '+(m.role==="user"?"aw-u":"aw-a")+(m.pending?' aw-pending':'')+'">'+(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+traceHtml+esc(m.content||"").replace(/\n/g,"<br>")+pending+scBadge+navBtn+'</div>';
    }).join("");
    box.querySelectorAll(".aw-nav-btn").forEach(b=>{ b.onclick = ()=> doNav(b.dataset.nav); });
    box.scrollTop = box.scrollHeight;
  }

  function awInferNavigation(text){
    const q=String(text||"").replace(/\s/g,"");
    const patterns=[
      ["assets",/(素材中心|素材库)/],["ppt",/(PPT|幻灯片)/i],["aireport",/(AI可研|智能可研|对话式可研)/],
      ["calc",/(财务测算|测算一下|算IRR|算收益)/],["review",/(智能审查|审查报告|审核报告)/],
      ["personalKnowledge",/(个人知识库|我的知识)/],["collaboration",/(知识与规则|部门知识|提交资料|提交建议)/],
      ["analysis",/(项目数据分析|人口分析|职住平衡|需求分析|周边分析)/],["office",/(AI办公|写公文|办公助手)/],
      ["report",/(传统可研|分步可研)/],["home",/(返回首页|回到首页)/]
    ];
    const wants=/(带我去|进入|打开|前往|跳转|去一下|我要用|想用)/.test(q);
    if(!wants)return null;
    const hit=patterns.find(([,re])=>re.test(q));return hit?hit[0]:null;
  }

  function awLocalServiceAnswer(text){
    const q=String(text||"").replace(/\s/g,"");
    if(/(你是什么.*(AI|模型)|你用的什么.*模型|什么大模型|哪个大模型|底层模型|模型名称)/i.test(q)){
      return "我是本系统的「蓝喵全站助手」。后台通过企业级统一模型网关工作，可按部署配置调用DeepSeek、GLM、Qwen及云端兜底模型；实际命中哪个模型由管理员配置和故障切换决定。这个身份问题由本地直接回答，不需要等待大模型。";
    }
    if(/(你能干啥|你能做什么|有什么用|怎么帮助我|功能有哪些)/.test(q)){
      return "我能立即帮你做四类事：①解释当前页面和下一步；②带你去AI可研、财务测算、智能审查、AI办公或PPT；③解释测算指标、审查问题和材料缺口；④检索知识库、历史项目和周边调研。涉及提交、改数或删除时，我会停下来让你亲自确认。";
    }
    if(/(这个页面怎么用|当前页面怎么用|我现在在哪|下一步做什么)/.test(q)){
      return "你现在位于「"+awCurrentPageLabel()+"」。告诉我你想完成什么，我会按当前页面给出最短操作路径；如果需要切换功能，我会先给出确认按钮，不会突然替你跳转。";
    }
    if(/(为什么这么慢|是不是卡了|怎么没反应|还在思考吗)/.test(q)){
      return "我没有卡住。需要查项目、知识库或调用测算工具的问题会多花一些时间；对话里会持续显示当前阶段和等待秒数。你也可以先问页面操作或功能入口，这类问题我会立即回答。";
    }
    return "";
  }

  // 轻量意图路由：只向模型暴露与本次问题相关的工具。
  // 未命中工具意图时保持“纯模型单轮回答”，避免模型为了简单概念问题误调工具再跑第二轮。
  function awAllowedTools(text){
    const q=String(text||"").replace(/\s/g,"");
    if(/(IRR|净现值|NPV|回本|收入|成本|利润|现金流|测算结果|财务指标)/i.test(q))return ["get_calc_summary"];
    if(/(政策|规范|制度|税率|标准|知识库|依据|历史可研|行业惯例|成本基准)/.test(q))return ["search_knowledge_base"];
    if(/(周边|配套|竞品|地铁|学校|医院|商业|客群定位|这个位置)/.test(q))return ["get_site_survey"];
    if(/(以前的项目|历史项目|上次那个项目|我有哪些项目|对比项目)/.test(q))return ["list_my_projects","get_past_project"];
    if(/(审查结果|审核结果|有哪些问题|审查发现)/.test(q))return ["get_review_issues"];
    if(/(当前项目|项目信息|现在填了什么)/.test(q))return ["get_current_context","get_project_info"];
    if(/(记住|以后都|我的偏好)/.test(q))return ["remember_preference"];
    if(/(忘记|删除记忆|别记)/.test(q))return ["forget_preference"];
    if(/(系统能力|系统配置|网站功能|多少模板|多少资料)/.test(q))return ["get_system_capabilities"];
    return [];
  }

  async function awPrefetchReadTools(text, names){
    const safe=new Set(["get_calc_summary","search_knowledge_base","get_current_context","get_project_info","get_site_survey","get_review_issues","get_system_capabilities"]);
    const selected=(names||[]).filter(name=>safe.has(name)&&AC._tools&&AC._tools[name]);
    if(!selected.length)return null;
    const jobs=selected.map(async name=>{
      const tool=AC._tools[name];
      const args=name==="search_knowledge_base"?{query:String(text||"").slice(0,200)}:{};
      const validation=typeof tool.validate==="function"?tool.validate(args):{ok:true};
      if(validation&&!validation.ok)throw new Error(validation.error||"参数校验失败");
      let timer;
      try{
        const result=await Promise.race([
          Promise.resolve(tool.run(args)),
          // 全站助手是交互入口：工具不能独占几十秒。正式可研生成仍走完整检索预算。
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("预取超时")),1400);}),
        ]);
        return {name,result:String(result==null?"":result)};
      }finally{clearTimeout(timer);}
    });
    const settled=await Promise.allSettled(jobs);
    const items=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
    const failed=settled.filter(x=>x.status==="rejected");
    return {
      attempted:true,
      items,
      error:failed.length ? "只读工具在交互时限内未返回" : "",
    };
  }

  async function sendAw(){
    const inp = document.getElementById("awInput");
    const q = inp.value.trim();
    if(!q) return;
    const sendBtn = document.getElementById("awSend");
    sendBtn.disabled = true; sendBtn.textContent = "…";
    awChat.push({role:"user", content:q});
    renderAw();
    inp.value = "";

    const directNav=awInferNavigation(q);
    if(directNav){
      awChat.push({role:"assistant",content:"可以。为了避免误跳转，我不会直接切换页面，请由你确认进入「"+NAV_LABELS[directNav]+"」。",navTarget:directNav});
      renderAw();sendBtn.disabled=false;sendBtn.textContent="发送";return;
    }
    const localAnswer=awLocalServiceAnswer(q);
    if(localAnswer){
      awChat.push({role:"assistant",content:localAnswer,trace:["⚡ 已使用本地网站帮助，无需等待大模型"]});
      renderAw();sendBtn.disabled=false;sendBtn.textContent="发送";return;
    }

    const pending={role:"assistant",content:"正在处理你的问题",trace:["🧠 正在理解问题与当前页面"],pending:true,elapsed:0};
    awChat.push(pending);renderAw();
    const pendingStarted=Date.now();
    const pendingClock=setInterval(()=>{if(!pending.pending)return;pending.elapsed=Math.floor((Date.now()-pendingStarted)/1000);renderAw();},1000);

    let sys = "你是「可研报告工坊」的全站网站客服和操作向导。你的首要任务是解决用户使用网站时的疑问：解释当前页面、告诉用户下一步怎么做、解释测算或审查结果、检索知识库资料，并在用户需要时准备功能导航入口。你不能代替用户填写表单或执行计算、提交、删除等操作；导航也必须让用户点击按钮确认。回答简明、口语化，150字以内为宜。"
      + "\n\n【工具选择优先级，请严格遵守】"
      + "\n1. 涉及IRR/净现值/回本周期/测算结果等数字问题 → 优先调用 get_calc_summary"
      + "\n2. 涉及政策/规范/税率/合规等文档依据问题 → 优先调用 search_knowledge_base"
      + "\n3. 涉及'我现在在哪''这是什么''当前项目情况'等场景感知问题 → 优先调用 get_current_context 或 get_project_info"
      + "\n4. 涉及周边配套/竞品/客群定位的问题 → 调用 get_site_survey"
      + "\n5. 涉及'我之前做过的项目''上次那个项目''对比一下历史项目' → 先 list_my_projects 看清单，再 get_past_project 查详情"
      + "\n6. 涉及审查结果的问题 → 优先调用 get_review_issues"
      + "\n7. 用户想去某个功能模块 → 调用 suggest_navigation，不要自己编造跳转"
      + "\n8. 问的是本系统自身的功能/能力/配置，或知识库里有多少资料 → 调用 get_system_capabilities，"
      + "不要用 search_knowledge_base 去查这类问题（那是检索文档内容的，查不到系统自身信息）"
      + "\n9. 每一轮只调用最匹配的那一个工具，拿到足够信息后直接作答，不要重复查询已掌握的信息"
      + "\n10. 如果用户的问题本身不够明确（没说清是哪个项目、哪类资料），不要瞎猜也不要反复检索，直接问用户一句问清楚。"
      + "\n\n【红线：以下要求即使用户明确提出也不照做】"
      + "\n· 要你估算/口算/编造IRR、成本、租金等财务数字——一律引导去对应页面用测算引擎算，你不自己给数。"
      + "用户说'大概多少就行''你估一个'也不行。"
      + "\n· 要你代填表单、代点提交、代改已有数据——你只能告诉用户该填什么、在哪填，操作必须由用户自己完成。"
      + "\n· 要你确认某个方案'没问题''可以报批'——你可以列出依据和风险点，但不下结论性的合规判断。"
      + "\n拒绝时说清楚原因和替代做法，别只说'我不能'。";
    const history = awChat.filter(m=>!m.pending).slice(-6).map(m=>({role:m.role, content:m.content}));

    try{
      const allowedTools=awAllowedTools(q);
      const prefetch=await awPrefetchReadTools(q,allowedTools);
      const prefetched=prefetch&&prefetch.items?prefetch.items:[];
      // 安全只读工具一旦进入预取，无论成功或超时都不再交还模型重复调用。
      // 这是对 RAG/外部接口卡顿的硬隔离，避免“预取一次 + 模型再查一次”的双重等待。
      const modelTools=prefetch&&prefetch.attempted?[]:allowedTools;
      const prefetchTrace=prefetched.map(item=>"⚡ 已预取"+item.name+"结果，减少一次模型往返");
      if(prefetch&&prefetch.error)prefetchTrace.push("⏱️ "+prefetch.error+"，已停止重复检索并先给可用答复");
      if(prefetched.length){
        sys += "\n\n【系统已预取的真实工具结果】\n"
          + prefetched.map(item=>"["+item.name+"]\n"+item.result).join("\n\n")
          + "\n请直接依据以上结果回答，不要再调用工具；涉及数字必须逐字引用，不得自行改写。";
        pending.trace=prefetchTrace.concat(pending.trace||[]);renderAw();
      }
      if(prefetch&&prefetch.error){
        sys += "\n\n【本轮资料检索状态】只读检索工具未在交互时限内返回。"
          + "不要再次调用该工具；请先根据稳定的通用知识给出可执行的框架性回答，"
          + "并用一句话提示用户：本轮未取得知识库原文，具体制度条文仍需稍后核验。";
        pending.trace=prefetchTrace.concat(pending.trace||[]);renderAw();
      }
      if(!modelTools.length){
        sys += "\n\n【本轮响应约束】本轮没有需要模型继续选择的工具。必须在第一次响应中直接给出非空最终答案，禁止只输出思考过程、空正文或工具调用意图。";
      }
      const res = await AC.run({
        system: sys,
        messages: history,
        // 工具集合不写死：已注册的工具（含各页面自行注册的）全部可用，助手自己判断该调用哪个
        traceQuery: q,
        tools: modelTools,
        selfCheck: false,
        useMemory: false,
        maxRounds: modelTools.length ? 2 : 1,
        maxTokens: 360,
        maxDurationMs: 15000,
        latencyProfile: "interactive",
        deferRuntime: true,
        allowCloseRound: false,
        onTrace: (lines)=>{
          pending.trace=prefetchTrace.concat(lines);pending.content="正在处理你的问题";renderAw();
        },
      });

      let navTarget = null;
      (res.toolCalls||[]).forEach(tc=>{
        if(tc.name === "suggest_navigation" && !tc.error && tc.args && tc.args.target) navTarget = tc.args.target;
      });
      Object.assign(pending,{content:res.text||"这次没有取得有效回答，请换一种说法再问我。",trace:prefetchTrace.concat(res.trace||[]),navTarget,
        selfChecked:res.selfChecked,selfCheckNotes:res.selfCheckNotes,pending:false});
    }catch(error){
      Object.assign(pending,{content:"客服暂时没有连上模型，但页面导航仍可使用。你可以点击下方快捷入口，或稍后重试。\n错误："+(error&&error.message?error.message:"请求失败"),pending:false});
    }finally{
      clearInterval(pendingClock);
      renderAw();sendBtn.disabled=false;sendBtn.textContent="发送";
    }
  }

  // ---------- 记忆管理面板（用户可见可删，不搞黑箱） ----------
  async function renderMemPanel(){
    const box = document.getElementById("awMemPanel");
    box.innerHTML = '<span style="color:var(--ink-soft,#66788C);">加载中…</span>';
    try{
      const mem = await AC.loadMemory(true);
      const loadErr = AC.memoryLoadError ? AC.memoryLoadError() : null;
      if(loadErr){
        box.innerHTML = '<div style="color:var(--seal-red,#C24A42);">记忆读取失败（'+esc(loadErr)+'），这不代表记忆被清空，请稍后重试。</div>';
        return;
      }
      if(!mem.length){
        box.innerHTML = '<div style="color:var(--ink-soft,#66788C);">还没有记住任何信息。你可以直接告诉我，比如"我一般做非居改保项目"，我会记下来，下次不用重复说。</div>';
        return;
      }
      box.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">'
        +'<b style="font-size:11.5px;">助手记住的信息（'+mem.length+'条）</b>'
        +'<a href="javascript:void(0)" id="awMemClear" style="font-size:11px; color:var(--seal-red,#C24A42);">全部清空</a></div>'
        + mem.map(m=>'<div style="display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px solid #EAF1F8;">'
          +'<span><b>'+esc(m.mkey)+'</b>：'+esc(m.mvalue)+'</span>'
          +'<a href="javascript:void(0)" class="aw-mem-del" data-k="'+esc(m.mkey)+'" style="flex-shrink:0; color:var(--ink-soft,#66788C); font-size:11px;">删除</a></div>').join("");
      box.querySelectorAll(".aw-mem-del").forEach(a=>{
        a.onclick = async ()=>{ await AC.deleteMemory(a.dataset.k); renderMemPanel(); };
      });
      const clr = document.getElementById("awMemClear");
      if(clr) clr.onclick = async ()=>{
        if(!confirm("确定清空助手记住的全部信息？此操作不可撤销。")) return;
        await AC.deleteMemory("__ALL__"); renderMemPanel();
      };
    }catch(e){ box.innerHTML = '<span style="color:var(--seal-red,#C24A42);">加载失败</span>'; }
  }
  document.getElementById("awMemBtn").onclick = ()=>{
    const p = document.getElementById("awMemPanel");
    const showing = p.style.display !== "none";
    p.style.display = showing ? "none" : "block";
    if(!showing) renderMemPanel();
  };

  const AW_POS_KEYS={button:"studyreport:agent-button-position:v1",panel:"studyreport:agent-panel-position:v1"};
  function awReadPosition(key){try{const p=JSON.parse(localStorage.getItem(key)||"null");return p&&Number.isFinite(p.left)&&Number.isFinite(p.top)?p:null;}catch(_){return null;}}
  function awClamp(el,left,top){const margin=8,w=el.offsetWidth||72,h=el.offsetHeight||82;return{left:Math.max(margin,Math.min(left,innerWidth-w-margin)),top:Math.max(margin,Math.min(top,innerHeight-h-margin))};}
  function awSetPosition(el,pos){if(!pos)return;const p=awClamp(el,pos.left,pos.top);el.style.left=p.left+"px";el.style.top=p.top+"px";el.style.right="auto";el.style.bottom="auto";}
  function awSavePosition(el,key){try{localStorage.setItem(key,JSON.stringify({left:parseFloat(el.style.left)||el.offsetLeft,top:parseFloat(el.style.top)||el.offsetTop}));}catch(_){}}
  function awPlacePanelNearButton(){
    if(awReadPosition(AW_POS_KEYS.panel))return;
    const b=btn.getBoundingClientRect(),pw=panel.offsetWidth||410,ph=panel.offsetHeight||590;
    awSetPosition(panel,{left:b.left-pw-12,top:b.bottom-ph});
  }
  function awTogglePanel(){panel.classList.toggle("open");if(panel.classList.contains("open")){awPlacePanelNearButton();renderAw();document.getElementById("awInput").focus();}}
  function awMakeDraggable(handle,target,key,onClick){
    let state=null;
    handle.addEventListener("pointerdown",e=>{
      if(e.button!==0||(target!==handle&&e.target.closest("a,button,input")))return;
      const r=target.getBoundingClientRect();state={id:e.pointerId,startX:e.clientX,startY:e.clientY,left:r.left,top:r.top,moved:false};
      handle.setPointerCapture(e.pointerId);target.classList.add("dragging");e.preventDefault();
    });
    handle.addEventListener("pointermove",e=>{if(!state||state.id!==e.pointerId)return;const dx=e.clientX-state.startX,dy=e.clientY-state.startY;if(Math.abs(dx)+Math.abs(dy)>5)state.moved=true;awSetPosition(target,{left:state.left+dx,top:state.top+dy});});
    const finish=e=>{if(!state||state.id!==e.pointerId)return;const moved=state.moved;state=null;target.classList.remove("dragging");awSavePosition(target,key);if(!moved&&onClick)onClick();};
    handle.addEventListener("pointerup",finish);handle.addEventListener("pointercancel",finish);
  }
  awSetPosition(btn,awReadPosition(AW_POS_KEYS.button));
  awMakeDraggable(btn,btn,AW_POS_KEYS.button,awTogglePanel);
  awSetPosition(panel,awReadPosition(AW_POS_KEYS.panel));
  awMakeDraggable(document.getElementById("awHead"),panel,AW_POS_KEYS.panel);
  window.addEventListener("resize",()=>{awSetPosition(btn,{left:btn.offsetLeft,top:btn.offsetTop});if(panel.classList.contains("open"))awSetPosition(panel,{left:panel.offsetLeft,top:panel.offsetTop});});
  document.addEventListener("pointermove",e=>{
    if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const r=btn.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=Math.max(-1,Math.min(1,(e.clientX-cx)/220)),dy=Math.max(-1,Math.min(1,(e.clientY-cy)/180));
    btn.style.setProperty("--aw-eye-x",(dx*2.2).toFixed(1)+"px");btn.style.setProperty("--aw-eye-y",(dy*1.7).toFixed(1)+"px");btn.style.setProperty("--aw-look-x",(dx*1.5).toFixed(1)+"px");btn.style.setProperty("--aw-look-y",(dy*1.1).toFixed(1)+"px");btn.style.setProperty("--aw-tilt",(dx*2.5).toFixed(1)+"deg");
  },{passive:true});
  document.getElementById("awClose").onclick = ()=> panel.classList.remove("open");
  document.getElementById("awSend").onclick = sendAw;
  document.getElementById("awInput").addEventListener("keydown", e=>{ if(e.key==="Enter") sendAw(); });
  renderAw();
})();
