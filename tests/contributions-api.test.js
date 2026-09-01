import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/contributions.js";
import { signToken } from "../functions/api/_auth.js";

function dbMock(seed={}){
  const state={items:[...(seed.items||[])],wiki:[],calls:[]};
  return {state,prepare(sql){const q={sql,args:[]};state.calls.push(q);return{bind(...args){q.args=args;return this;},async run(){
    if(sql.startsWith("INSERT INTO knowledge_contributions"))state.items.push({id:q.args[0],kind:q.args[1],title:q.args[2],content:q.args[3],source_ref:q.args[4],file_name:q.args[5],region:q.args[6],project_type:q.args[7],meta:q.args[8],status:"pending",parent_id:q.args[9],user_id:q.args[10],username:q.args[11],created_at:q.args[12]});
    if(sql.startsWith("UPDATE knowledge_contributions SET status")){const x=state.items.find(v=>v.id===q.args[6]);Object.assign(x,{status:q.args[0],review_note:q.args[1],target_module:q.args[2],target_ref:q.args[3]});}
    if(sql.startsWith("INSERT INTO wiki_pages"))state.wiki.push({id:q.args[0],title:q.args[1],status:"draft"});
    return {success:true};},async all(){
      if(sql.includes("WHERE user_id=?"))return{results:state.items.filter(x=>x.user_id===q.args[0])};
      if(sql.includes("WHERE status=?"))return{results:state.items.filter(x=>x.status===q.args[0])};return{results:[]};},async first(){
    if(sql.includes("FROM knowledge_contributions WHERE id=?"))return state.items.find(x=>x.id===q.args[0])||null;
      if(sql.includes("user_id=? AND kind=? AND source_ref=?"))return state.items.find(x=>x.user_id===q.args[0]&&x.kind===q.args[1]&&x.source_ref===q.args[2]&&["pending","approved"].includes(x.status))||null;
      if(sql.includes("SELECT data FROM configs"))return null;return null;}};}};
}
async function call(env,username,body,admin=false){
  const token=await signToken(env,username==="admin"?1:2,username),headers={authorization:"Bearer "+token,"content-type":"application/json"};if(admin)headers["x-admin-pass"]="pass";
  const request=new Request("http://test/api/contributions",{method:"POST",headers,body:JSON.stringify(body)});const res=await onRequestPost({request,env});return{status:res.status,data:await res.json()};
}

test("普通用户投稿只进入待审核台账，不直接写正式模块",async()=>{
  const DB=dbMock(),env={SESSION_SECRET:"s1",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const r=await call(env,"user",{action:"submit",item:{kind:"wiki",title:"租金口径",content:"建议正文",source_ref:"制度第12条"}});
  assert.equal(r.data.ok,true);assert.equal(DB.state.items[0].status,"pending");assert.equal(DB.state.wiki.length,0);
  assert.equal(DB.state.items[0].region,"深圳市");
  assert.equal(JSON.parse(DB.state.items[0].meta).regionLevel,"city");
});

test("普通用户的小节定稿逻辑进入专用审核类型，不会直接改正式规则",async()=>{
  const DB=dbMock(),env={SESSION_SECRET:"logic",ADMIN_USERS:"zgbyd",DEPLOY_MODE:"local",DB};
  const r=await call(env,"user",{action:"submit",item:{kind:"report_logic",title:"项目背景逻辑修订",content:JSON.stringify({writingLogic:"按定稿论证链生成"}),source_ref:"project:p1/section:1.1",project_type:"gaibao",meta:{baseRuleId:"gaibao-logic-001",revision:{writingLogic:"按定稿论证链生成"}}}});
  assert.equal(r.data.ok,true);assert.equal(DB.state.items[0].kind,"report_logic");assert.equal(DB.state.items[0].status,"pending");assert.equal(DB.state.calls.some(x=>x.sql.includes("INSERT INTO report_logic_sets")),false);
});

test("联网依据按全国、市、区、街道四级规范化后进入审核队列",async()=>{
  const DB=dbMock(),env={SESSION_SECRET:"scope",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const r=await call(env,"user",{action:"submit",item:{kind:"wiki",title:"街道政策",content:"经核验的政策摘要",source_ref:"https://example.com/policy",region:"深圳市龙华区民治街道",project_type:"housing_conversion",meta:{sourceChannel:"web_research"}}});
  assert.equal(r.data.ok,true);assert.equal(DB.state.items[0].region,"龙华区民治街道");
  const meta=JSON.parse(DB.state.items[0].meta);assert.equal(meta.regionLevel,"street");assert.deepEqual(meta.regionPath,["深圳市","龙华区","民治街道"]);
  const review=await call(env,"admin",{action:"listReview",status:"pending"},true);
  assert.equal(review.data.items[0].region,"龙华区民治街道");assert.equal(review.data.items[0].meta.regionLevel,"street");
});

test("同一联网证据重复提交时复用已有审核记录并返回所处阶段",async()=>{
  const meta=JSON.stringify({idempotencyKey:"web:evi_1"}),row={id:"con_old",kind:"wiki",title:"联网依据",content:"摘要",source_ref:"https://example.com",file_name:"",region:"深圳",project_type:"rent",meta,status:"approved",target_module:"知识 Wiki（待发布草稿）",target_ref:"wiki_1",user_id:2,username:"user",created_at:1};
  const DB=dbMock({items:[row]}),env={SESSION_SECRET:"s1b",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const r=await call(env,"user",{action:"submit",item:{kind:"wiki",title:"联网依据",content:"摘要",source_ref:"https://example.com",meta:{idempotencyKey:"web:evi_1"}}});
  assert.equal(r.data.ok,true);assert.equal(r.data.existing,true);assert.equal(r.data.id,"con_old");assert.equal(r.data.status,"approved");assert.equal(r.data.target_ref,"wiki_1");assert.equal(DB.state.items.length,1);
});

test("普通用户不能读取后台审核队列",async()=>{
  const DB=dbMock(),env={SESSION_SECRET:"s2",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const r=await call(env,"user",{action:"listReview",status:"pending"});assert.equal(r.status,403);
});

test("管理员通过 Wiki 投稿后只生成待发布草稿",async()=>{
  const row={id:"con_1",kind:"wiki",title:"租金口径",content:"经审核的业务口径正文",source_ref:"制度第12条",file_name:"",region:"深圳",project_type:"保租房",meta:"{}",status:"pending",user_id:2,username:"user",created_at:1};
  const DB=dbMock({items:[row]}),env={SESSION_SECRET:"s3",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const r=await call(env,"admin",{action:"review",id:"con_1",decision:"approve",note:"来源已核验"},true);
  assert.equal(r.data.ok,true);assert.equal(DB.state.items[0].status,"approved");assert.equal(DB.state.wiki[0].status,"draft");assert.match(r.data.target.module,/待发布草稿/);
});

test("退回必须写修改意见且原提交不被改写",async()=>{
  const row={id:"con_2",kind:"rule",title:"规则建议",content:"原始正文",source_ref:"内部指引",meta:"{}",status:"pending",user_id:2,username:"user",created_at:1};
  const DB=dbMock({items:[row]}),env={SESSION_SECRET:"s4",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local",DB};
  const bad=await call(env,"admin",{action:"review",id:"con_2",decision:"return",note:""},true);assert.equal(bad.status,400);assert.equal(DB.state.items[0].content,"原始正文");
  const ok=await call(env,"admin",{action:"review",id:"con_2",decision:"return",note:"补充适用范围"},true);assert.equal(ok.data.status,"needs_changes");assert.equal(DB.state.items[0].content,"原始正文");
});
