import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost} from "../functions/api/projectbrain.js";
import {signToken} from "../functions/api/_auth.js";

function mockDb(){
  const state={project:{id:"project-123",name:"测试项目",data:JSON.stringify({project:{name:"测试项目",type:"rent",location:"深圳"},workflow:{management:{}}}),updated_at:1,user_id:1},facts:[],events:[],stages:[]};
  return {state,prepare(sql){const q={args:[]};return {bind(...a){q.args=a;return this;},async first(){
    if(sql.startsWith("SELECT id,name,data,updated_at FROM projects"))return q.args[0]===state.project.id?state.project:null;
    if(sql.includes("MAX(version)")&&sql.includes("project_facts")){const rows=state.facts.filter(x=>x.fact_key===q.args[2]);return {n:rows.reduce((n,x)=>Math.max(n,x.version),0)};}
    return null;
  },async all(){
    if(sql.includes("FROM project_facts"))return {results:[...state.facts].sort((a,b)=>b.version-a.version)};
    if(sql.includes("FROM project_events"))return {results:[...state.events].reverse()};
    return {results:[]};
  },async run(){
    if(sql.startsWith("INSERT INTO project_facts")){const a=q.args;state.facts.push({id:a[0],project_id:a[1],user_id:a[2],fact_type:a[3],fact_key:a[4],label:a[5],value_json:a[6],unit:a[7],source_type:a[8],source_ref:a[9],confidence:a[10],status:a[11],valid_from:a[12],valid_to:a[13],version:a[14],created_by:a[15],created_at:a[16],updated_at:a[17]});}
    else if(sql.startsWith("INSERT INTO project_events")){const a=q.args;state.events.push({id:a[0],project_id:a[1],user_id:a[2],event_type:a[3],actor:a[4],payload_json:a[5],created_at:a[6]});}
    else if(sql.startsWith("UPDATE projects SET data=")){state.project.data=q.args[0];state.project.updated_at=q.args[1];}
    else if(sql.startsWith("INSERT INTO project_stage_history")){const a=q.args;state.stages.push({id:a[0],from:a[3],to:a[4],reason:a[5]});}
    return {success:true,meta:{changes:1}};
  }};}};
}
async function call(DB,method,body,url="http://test/api/projectbrain?projectId=project-123"){
  const env={DB,SESSION_SECRET:"brain-test",DEPLOY_MODE:"local"},token=await signToken(env,1,"tester"),headers={authorization:"Bearer "+token};if(body)headers["content-type"]="application/json";
  const request=new Request(url,{method,headers,body:body?JSON.stringify(body):undefined}),res=await (method==="GET"?onRequestGet:onRequestPost)({request,env});return {status:res.status,data:await res.json()};
}

test("Project Brain兼容读取旧项目并写入结构化事实",async()=>{
  const DB=mockDb(),before=await call(DB,"GET");assert.equal(before.status,200);assert.equal(before.data.context.project.location,"深圳");
  const saved=await call(DB,"POST",{action:"upsertFact",projectId:"project-123",fact:{factType:"FACT",factKey:"project.approvalNo",label:"批复文号",value:"深投批〔2026〕1号",status:"confirmed"}},"http://test/api/projectbrain");
  assert.equal(saved.status,200);assert.equal(DB.state.facts.length,1);const after=await call(DB,"GET");assert.equal(after.data.context.facts.find(x=>x.factKey==="project.approvalNo").value,"深投批〔2026〕1号");
});

test("生命周期切换写回旧项目兼容字段并记录历史和事件",async()=>{
  const DB=mockDb(),changed=await call(DB,"POST",{action:"setStage",projectId:"project-123",stageKey:"decision",reason:"可研已通过"},"http://test/api/projectbrain");
  assert.equal(changed.status,200);assert.equal(JSON.parse(DB.state.project.data).workflow.management.investmentStage,"decision");assert.equal(DB.state.stages[0].to,"decision");assert.equal(DB.state.events.at(-1).event_type,"stage.changed");
});
