import test from "node:test";
import assert from "node:assert/strict";
import {onRequestPost} from "../functions/api/aireport.js";
import {signToken} from "../functions/api/_auth.js";

test("批量材料抽取最多返回6个点位、唯一主项目并以主项目地址兼容旧字段",async()=>{
  const env={SESSION_SECRET:"test-secret"},token=await signToken(env,1,"u"),originalFetch=globalThis.fetch;let upstreamBody;
  globalThis.fetch=async(_url,options)=>{upstreamBody=JSON.parse(options.body);return new Response(JSON.stringify({content:[{text:JSON.stringify({projectName:"六处物业改造",location:null,calcType:"gaibao",businessScenario:"housing_conversion",analysisSites:Array.from({length:8},(_,i)=>({name:"项目"+(i+1),address:"深圳市第"+(i+1)+"区",role:i<2?"primary":"secondary"})),landArea:null,landPrice:null,startYear:null,owner:null,landNature:null,desc:"六处物业改造"})}]}),{status:200,headers:{"content-type":"application/json"}});};
  try{
    const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"extract",materialMode:true,text:"【材料1】明确列出六处待改造物业"})});
    const response=await onRequestPost({request,env}),data=await response.json();
    assert.equal(data.ok,true);assert.equal(data.data.analysisSites.length,6);assert.equal(data.data.analysisSites.filter(x=>x.role==="primary").length,1);
    assert.equal(data.data.location,"深圳市第1区");assert.equal(data.data.analysisSites[5].name,"项目6");
    assert.equal(upstreamBody.tools[0].function.name,"submit_project_info");assert.equal(upstreamBody.tool_choice.function.name,"submit_project_info");
  }finally{globalThis.fetch=originalFetch;}
});

test("AI可研接口只为旧版doc提供受限服务端解析",async()=>{
  const env={SESSION_SECRET:"test-secret",AI:{toMarkdown:async files=>{
    assert.equal(files.length,1);assert.equal(files[0].name,"项目资料.doc");
    assert.equal(files[0].blob.type,"application/msword");
    return [{name:files[0].name,data:"项目名称：旧版Word测试项目\n建设地点：深圳市龙华区"}];
  }}};
  const token=await signToken(env,1,"u"),dataBase64=Buffer.from("legacy-word-binary").toString("base64");
  const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"parseLegacyDoc",name:"项目资料.doc",dataBase64})});
  const response=await onRequestPost({request,env}),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.ok,true);assert.match(data.text,/旧版Word测试项目/);
});

test("旧版doc解析拒绝伪装格式并在转换器缺失时给出可操作提示",async()=>{
  const env={SESSION_SECRET:"test-secret"},token=await signToken(env,1,"u");
  const call=body=>onRequestPost({env,request:new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)})});
  let response=await call({action:"parseLegacyDoc",name:"伪装.pdf",dataBase64:"YWJj"}),data=await response.json();
  assert.equal(response.status,400);assert.match(data.error,/只接收旧版 \.doc/);
  response=await call({action:"parseLegacyDoc",name:"旧资料.doc",dataBase64:"YWJj"});data=await response.json();
  assert.equal(response.status,501);assert.match(data.error,/另存为 \.docx/);
});

test("批量材料在外部AI不可用时降级为本地标签预填且不要求重新上传",async()=>{
  const env={SESSION_SECRET:"test-secret"},token=await signToken(env,1,"u"),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:"upstream unavailable"}),{status:502,headers:{"content-type":"application/json"}});
  try{
    const text="【材料1：项目资料.doc】\n项目名称：龙华测试项目\n建设地点：深圳市龙华区民治街道\n建设单位：测试建设单位\n项目类型：非居改保\n用地面积：12345平方米\n开工年份：2027年";
    const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"extract",materialMode:true,text})});
    const response=await onRequestPost({request,env}),data=await response.json();
    assert.equal(response.status,200);assert.equal(data.ok,true);assert.equal(data.degraded,true);
    assert.equal(data.data.projectName,"龙华测试项目");assert.equal(data.data.location,"深圳市龙华区民治街道");
    assert.equal(data.data.calcType,"gaibao");assert.equal(data.data.businessScenario,"housing_conversion");assert.equal(data.data.landArea,12345);assert.equal(data.data.startYear,2027);
    assert.deepEqual(data.data.analysisSites,[{id:"site-1",name:"龙华测试项目",address:"深圳市龙华区民治街道",role:"primary"}]);
  }finally{globalThis.fetch=originalFetch;}
});

test("普通文本抽取在AI不可用时仍如实返回失败而不伪造结果",async()=>{
  const env={SESSION_SECRET:"test-secret"},token=await signToken(env,1,"u"),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:"upstream unavailable"}),{status:502,headers:{"content-type":"application/json"}});
  try{
    const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"extract",text:"这是普通对话，不是已解析材料"})});
    const response=await onRequestPost({request,env}),data=await response.json();assert.equal(response.status,502);assert.equal(data.ok,false);
  }finally{globalThis.fetch=originalFetch;}
});

test("材料抽取优先读取DeepSeek函数调用参数而不依赖自由文本JSON",async()=>{
  const env={SESSION_SECRET:"tool-secret"},token=await signToken(env,1,"u"),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({content:[{text:"我已经完成分析，但不在正文输出JSON。"}],tool_calls:[{id:"call-1",type:"function",function:{name:"submit_project_info",arguments:JSON.stringify({projectName:"函数参数项目",location:"深圳市福田区",calcType:"gaibao",businessScenario:"commercial_renovation",analysisSites:[{name:"主项目",address:"深圳市福田区",role:"primary"}]})}}]}),{status:200,headers:{"content-type":"application/json"}});
  try{
    const request=new Request("http://test/api/aireport",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"extract",materialMode:true,text:"四份材料"})});
    const response=await onRequestPost({request,env}),data=await response.json();
    assert.equal(response.status,200);assert.equal(data.degraded,undefined);assert.equal(data.data.projectName,"函数参数项目");assert.equal(data.data.businessScenario,"commercial_renovation");assert.equal(data.data.analysisSites.length,1);
  }finally{globalThis.fetch=originalFetch;}
});
