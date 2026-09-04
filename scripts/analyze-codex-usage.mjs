import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const root=path.resolve(process.argv[2]||path.join(os.homedir(),".codex","sessions"));
const topN=Math.max(5,Math.min(50,Number(process.argv[3])||20));
const summaryOnly=process.argv.includes("--summary");
const files=[];
function walk(dir){
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const target=path.join(dir,entry.name);
    if(entry.isDirectory())walk(target);
    else if(entry.isFile()&&entry.name.endsWith(".jsonl"))files.push(target);
  }
}
walk(root);

const turns=new Map(),sessions=[];
const ensureTurn=(session,id)=>{
  const key=session+":"+(id||"unknown");
  if(!turns.has(key))turns.set(key,{session:path.basename(session),turnId:id||"unknown",startedAt:"",request:"",input:0,cached:0,cacheWrite:0,output:0,reasoning:0,effective:0,modelCalls:0,tools:{},toolOutputBytes:0,largeToolOutputs:0,fullTests:0});
  return turns.get(key);
};
const cleanRequest=value=>String(value||"").replace(/\s+/g," ").trim().slice(0,140);
const addUsage=(turn,usage)=>{
  const input=Number(usage?.input_tokens||0),cached=Number(usage?.cached_input_tokens||0),cacheWrite=Number(usage?.cache_write_input_tokens||0),output=Number(usage?.output_tokens||0),reasoning=Number(usage?.reasoning_output_tokens||0);
  // Effective usage follows the local explain-usage convention. Reasoning is
  // normally included in output_tokens, so it is recorded but not double-counted.
  turn.input+=input;turn.cached+=cached;turn.cacheWrite+=cacheWrite;turn.output+=output;turn.reasoning+=reasoning;
  turn.effective+=Math.max(0,input-cached)+cached*.1+cacheWrite*2+output*5;
  if(input||cached||cacheWrite||output)turn.modelCalls++;
};

for(const file of files){
  let currentTurn="unknown",lineCount=0,parseErrors=0;
  const session={file:path.basename(file),bytes:fs.statSync(file).size,turns:new Set(),toolCalls:0,toolOutputBytes:0};
  const stream=fs.createReadStream(file,{encoding:"utf8"});
  const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  for await(const line of lines){
    lineCount++;
    let item;try{item=JSON.parse(line);}catch{parseErrors++;continue;}
    const payload=item?.payload||{};
    if(item.type==="event_msg"&&payload.type==="task_started"){
      currentTurn=String(payload.turn_id||"unknown");
      const turn=ensureTurn(file,currentTurn);turn.startedAt=item.timestamp||payload.started_at||"";session.turns.add(currentTurn);
    }else if(item.type==="event_msg"&&payload.type==="user_message"){
      const turn=ensureTurn(file,currentTurn);if(!turn.request)turn.request=cleanRequest(payload.message);
    }else if(item.type==="event_msg"&&payload.type==="token_count"){
      addUsage(ensureTurn(file,currentTurn),payload.info?.last_token_usage);
    }else if(item.type==="response_item"&&(payload.type==="function_call"||payload.type==="custom_tool_call")){
      const turnId=payload.internal_chat_message_metadata_passthrough?.turn_id||currentTurn,turn=ensureTurn(file,String(turnId||"unknown"));
      const args=String(payload.arguments||payload.input||"");
      const nested=[...args.matchAll(/tools\.([A-Za-z0-9_]+)/g)].map(match=>match[1]);
      const names=nested.length?[...new Set(nested)]:[String(payload.name||"unknown")];
      for(const name of names)turn.tools[name]=(turn.tools[name]||0)+1;
      session.toolCalls++;
      if(/(?:npm(?:\.cmd)?\s+(?:run\s+)?test|node\s+--test)/i.test(args))turn.fullTests++;
    }else if(item.type==="response_item"&&/function_call_output|custom_tool_call_output/.test(payload.type||"")){
      const size=Buffer.byteLength(typeof payload.output==="string"?payload.output:JSON.stringify(payload.output||payload.content||""));
      const turn=ensureTurn(file,currentTurn);turn.toolOutputBytes+=size;session.toolOutputBytes+=size;if(size>=100_000)turn.largeToolOutputs++;
    }
  }
  session.lineCount=lineCount;session.parseErrors=parseErrors;sessions.push(session);
}

const ranked=[...turns.values()].filter(turn=>turn.effective||turn.toolOutputBytes||Object.keys(turn.tools).length).sort((a,b)=>b.effective-a.effective);
const totals=ranked.reduce((sum,turn)=>({
  input:sum.input+turn.input,cached:sum.cached+turn.cached,cacheWrite:sum.cacheWrite+turn.cacheWrite,output:sum.output+turn.output,effective:sum.effective+turn.effective,
  modelCalls:sum.modelCalls+turn.modelCalls,toolOutputBytes:sum.toolOutputBytes+turn.toolOutputBytes,fullTests:sum.fullTests+turn.fullTests
}),{input:0,cached:0,cacheWrite:0,output:0,effective:0,modelCalls:0,toolOutputBytes:0,fullTests:0});
const toolTotals={};for(const turn of ranked)for(const [name,count]of Object.entries(turn.tools))toolTotals[name]=(toolTotals[name]||0)+count;
const result={
  root,fileCount:files.length,totalLogBytes:sessions.reduce((n,s)=>n+s.bytes,0),turnCount:ranked.length,totals,
  topTools:Object.entries(toolTotals).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name,count])=>({name,count})),
  largestSessions:sessions.sort((a,b)=>b.bytes-a.bytes).slice(0,10).map(s=>({...s,turns:s.turns.size})),
  topTurns:ranked.slice(0,topN).map(turn=>({...turn,tools:Object.entries(turn.tools).sort((a,b)=>b[1]-a[1]).slice(0,10)}))
};
if(summaryOnly){
  console.log(JSON.stringify({
    root:result.root,fileCount:result.fileCount,totalLogBytes:result.totalLogBytes,turnCount:result.turnCount,totals:result.totals,
    topTools:result.topTools.slice(0,10),largestSessions:result.largestSessions.slice(0,5),
    topTurns:result.topTurns.slice(0,10).map(turn=>({
      startedAt:turn.startedAt,request:turn.request,input:turn.input,cached:turn.cached,output:turn.output,effective:turn.effective,
      modelCalls:turn.modelCalls,toolOutputBytes:turn.toolOutputBytes,largeToolOutputs:turn.largeToolOutputs,fullTests:turn.fullTests,tools:turn.tools.slice(0,6)
    }))
  },null,2));
}else{
  console.log(JSON.stringify(result,null,2));
}
