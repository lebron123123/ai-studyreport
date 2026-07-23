/* ============================================================
   agent-core.js —— 全站通用 Agent 引擎
   职责：工具注册表 + ReAct 循环执行器 + 参数校验 + 链路日志
   设计原则：
     1. 引擎不关心具体业务，任何模块可注册自己的工具（AgentCore.registerTool）
     2. 只读/检索类工具自由注册；写入类工具必须由业务侧自行加人工确认闸门
     3. 财务数字永远来自确定性引擎，AI 无权计算或改写
   依赖：全局 authHeaders()（auth.js 提供）
   ============================================================ */
window.AgentCore = (function(){

  /* ---------- 工具注册表 ---------- */
  // 每项：{ schema:{...OpenAI function schema}, validate(args)->{ok,error}, run(args)->string, label(args)->string }
  const TOOLS = {};

  /**
   * 注册一个工具
   * @param {string} name 工具名（与 schema.function.name 一致）
   * @param {object} def  { schema, run, validate?, label? }
   */
  function registerTool(name, def){
    if(!name || !def || typeof def.run !== "function"){
      console.warn("[AgentCore] 注册工具失败：", name); return;
    }
    TOOLS[name] = {
      schema: def.schema,
      run: def.run,
      validate: def.validate || (()=>({ok:true})),
      label: def.label || (()=>"🔧 " + name),
    };
  }

  function unregisterTool(name){ delete TOOLS[name]; }

  /** 取出可用工具的 schema 列表（可按名单过滤，供不同页面暴露不同工具集） */
  function toolSchemas(allowNames){
    return Object.keys(TOOLS)
      .filter(n => !allowNames || allowNames.indexOf(n) >= 0)
      .map(n => TOOLS[n].schema)
      .filter(Boolean);
  }

  /* ---------- 参数校验（借鉴 Pydantic 思路的轻量实现） ---------- */
  // 通用校验：先查工具是否存在，再调用工具自带的 validate
  function validateArgs(name, args){
    const t = TOOLS[name];
    if(!t) return { ok:false, error:"未知工具：" + name };
    try{
      const r = t.validate(args || {});
      return (r && typeof r.ok === "boolean") ? r : { ok:true };
    }catch(e){
      return { ok:false, error:"参数校验异常：" + e.message };
    }
  }

  /* ---------- 通用校验助手（供各业务注册工具时复用） ---------- */
  const V = {
    /** 必填字符串，可选长度上限 */
    requiredString(args, key, maxLen, cnLabel){
      const v = args[key];
      if(!v || typeof v !== "string" || !v.trim()){
        return { ok:false, error:"参数错误：" + (cnLabel||key) + " 不能为空" };
      }
      if(maxLen && v.length > maxLen){
        return { ok:false, error:"参数错误：" + (cnLabel||key) + " 过长(超过"+maxLen+"字)，请精简后重试" };
      }
      return { ok:true };
    },
    /** 可选枚举值 */
    optionalEnum(args, key, allowed, cnLabel){
      const v = args[key];
      if(v === undefined || v === null || v === "") return { ok:true };
      if(allowed.indexOf(v) < 0){
        return { ok:false, error:"参数错误：" + (cnLabel||key) + " 必须是[" + allowed.join("/") + "]之一，或不传该参数" };
      }
      return { ok:true };
    },
    /** 串联多个校验，返回第一个失败 */
    all(checks){
      for(const c of checks){ if(c && !c.ok) return c; }
      return { ok:true };
    },
  };

  /* ---------- ReAct 循环执行器 ---------- */
  /**
   * 运行一次 Agent 问答
   * @param {object} opt
   *   - system   {string}   系统提示词
   *   - messages {array}    历史对话 [{role,content}]
   *   - tools    {string[]} 本次允许使用的工具名单（不传=全部已注册工具）
   *   - maxRounds{number}   最大循环轮数，默认 3
   *   - onTrace  {function} 每一步过程回调 (traceLines:string[]) => void
   *   - traceQuery {string} 用于日志记录的用户原始问题
   * @returns {Promise<{text, rounds, toolCalls, trace}>}
   */
  async function run(opt){
    opt = opt || {};
    const maxRounds = opt.maxRounds || 3;
    const allow = opt.tools;
    const schemas = toolSchemas(allow);
    const startedAt = Date.now();

    let convo = (opt.messages || []).slice();
    const trace = [];
    const allToolCalls = [];
    let rounds = 0;
    let finalText = "";
    let errorMsg = "";

    const pushTrace = (line)=>{
      trace.push(line);
      if(typeof opt.onTrace === "function"){
        try{ opt.onTrace(trace.slice()); }catch(e){}
      }
    };

    try{
      while(rounds < maxRounds){
        rounds++;
        const payload = { system: opt.system || "", messages: convo };
        if(schemas.length) payload.tools = schemas;

        const resp = await fetch("/api/generate", {
          method: "POST",
          headers: Object.assign({ "Content-Type":"application/json" }, (window.authHeaders ? window.authHeaders() : {})),
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if(data.error) throw new Error(data.error);

        const calls = data.tool_calls;
        const text = (data.content || []).map(b => b.text || "").join("").trim();

        if(calls && calls.length){
          convo.push({ role:"assistant", content: text || null, tool_calls: calls });
          for(const c of calls){
            let args = {};
            try{ args = JSON.parse(c.function.arguments || "{}"); }catch(e){}
            const name = c.function.name;

            // 参数校验：不合规不执行，把错误回给模型自行纠正（自我纠错）
            const v = validateArgs(name, args);
            if(!v.ok){
              pushTrace("⚠️ 参数校验未通过：" + v.error);
              convo.push({ role:"tool", tool_call_id:c.id, content:"工具调用失败：" + v.error });
              allToolCalls.push({ name, args, error: v.error });
              continue;
            }

            const t = TOOLS[name];
            let label = "🔧 " + name;
            try{ label = t.label(args) || label; }catch(e){}
            pushTrace(label);

            let result;
            try{
              result = await t.run(args);
            }catch(e){
              result = "（工具执行失败：" + e.message + "）";
            }
            convo.push({ role:"tool", tool_call_id:c.id, content: String(result == null ? "" : result) });
            allToolCalls.push({ name, args });
          }
          continue;   // 带着工具结果再问一轮
        }

        finalText = text || "";
        break;
      }
      if(!finalText && rounds >= maxRounds){
        finalText = "多次查询后仍未能得出确定结论，请补充信息或换个问法。";
      }
    }catch(e){
      errorMsg = e.message;
      finalText = "回答失败：" + e.message;
    }

    // 链路日志（自建，数据留在本账号内；失败不影响使用）
    try{
      await fetch("/api/agent", {
        method:"POST",
        headers: Object.assign({ "Content-Type":"application/json" }, (window.authHeaders ? window.authHeaders() : {})),
        body: JSON.stringify({
          action:"trace",
          query: opt.traceQuery || "",
          rounds,
          toolCalls: allToolCalls,
          finalAnswer: finalText,
          durationMs: Date.now() - startedAt,
        }),
      });
    }catch(e){}

    return { text: finalText, rounds, toolCalls: allToolCalls, trace, error: errorMsg };
  }

  return { registerTool, unregisterTool, toolSchemas, validateArgs, run, V, _tools: TOOLS };
})();
