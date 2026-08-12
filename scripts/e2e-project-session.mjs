import {signToken} from "../functions/api/_auth.js";

const base=process.env.E2E_BASE_URL||"http://127.0.0.1:8080";
if(!process.env.SESSION_SECRET)throw new Error("缺少SESSION_SECRET");
const projectId="e2e-project-"+Date.now().toString(36),token=await signToken({SESSION_SECRET:process.env.SESSION_SECRET},999999,"e2e-project-session");
const headers={authorization:"Bearer "+token,"content-type":"application/json"};
const call=async(path,opt={})=>{const r=await fetch(base+path,opt),d=await r.json();if(!r.ok||!d.ok)throw new Error(r.status+" "+JSON.stringify(d));return d;};
try{
  await call("/api/aireport",{method:"POST",headers,body:JSON.stringify({action:"saveState",projectId,state:{step:"calc-confirm",pendingTaskKeys:[{cn:"十",si:1}],calcType:"rent"}})});
  const loaded=await call("/api/aireport?projectId="+encodeURIComponent(projectId),{headers});
  if(loaded.state.step!=="calc-confirm"||loaded.state.pendingTaskKeys.length!==1)throw new Error("项目会话恢复内容不一致");
  await call("/api/aireport?projectId="+encodeURIComponent(projectId),{method:"DELETE",headers});
  const after=await call("/api/aireport?projectId="+encodeURIComponent(projectId),{headers});
  if(after.state!==null)throw new Error("测试会话清理失败");
  console.log(JSON.stringify({ok:true,projectId,restoredStep:loaded.state.step,cleanup:true}));
}catch(e){
  try{await fetch(base+"/api/aireport?projectId="+encodeURIComponent(projectId),{method:"DELETE",headers});}catch(_){}
  throw e;
}
