import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost, onRequestPatch, onRequestDelete } from "../functions/api/reportgolden.js";
import { signToken } from "../functions/api/_auth.js";

function mockDb(){
  const state={samples:[],runs:[]};
  return {state,prepare(sql){const q={args:[]};return {bind(...args){q.args=args;return this;},async run(){
    if(sql.startsWith("INSERT INTO report_golden_samples")){const a=q.args;state.samples.push({id:a[0],name:a[1],calc_type:a[2],region:a[3],tags_json:a[4],source_project_id:a[5],sample_json:a[6],status:a[7],user_id:a[8],created_by:a[9],created_at:a[10],updated_at:a[11]});}
    else if(sql.startsWith("INSERT INTO report_golden_runs")){const a=q.args;state.runs.push({id:a[0],sample_id:a[1],user_id:a[2],score:a[3],passed:a[4],metrics_json:a[5],result_json:a[6],candidate_hash:a[7],created_at:a[8]});}
    else if(sql.startsWith("UPDATE report_golden_samples SET status")){const row=state.samples.find(x=>x.id===q.args[2]);if(row){row.status=q.args[0];row.updated_at=q.args[1];}}
    else if(sql.startsWith("DELETE FROM report_golden_runs"))state.runs=state.runs.filter(x=>x.sample_id!==q.args[0]);
    else if(sql.startsWith("DELETE FROM report_golden_samples"))state.samples=state.samples.filter(x=>x.id!==q.args[0]);
    return {success:true,meta:{changes:1}};
  },async first(){if(sql.includes("FROM report_golden_samples WHERE id=?"))return state.samples.find(x=>x.id===q.args[0])||null;return null;},async all(){
    if(sql.includes("JOIN report_golden_samples"))return {results:state.runs.map(run=>{const sample=state.samples.find(x=>x.id===run.sample_id);return {...run,sample_json:sample&&sample.sample_json};}).filter(x=>x.sample_json)};
    if(sql.includes("FROM report_golden_runs"))return {results:state.runs.filter(x=>x.sample_id===q.args[0])};
    if(sql.includes("FROM report_golden_samples")){if(sql.includes("user_id=?"))return {results:state.samples.filter(x=>x.status==="published"||x.user_id===q.args[0])};return {results:[...state.samples]};}
    return {results:[]};
  }};}};
}

async function request(env,method,body,url="http://test/api/reportgolden",admin=false){
  const token=await signToken(env,1,"admin"),headers={authorization:"Bearer "+token};
  if(body!==undefined){headers["content-type"]="application/json";}
  if(admin)headers["x-admin-pass"]="pass";
  const req=new Request(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const fn={GET:onRequestGet,POST:onRequestPost,PATCH:onRequestPatch,DELETE:onRequestDelete}[method],res=await fn({request:req,env});
  return {status:res.status,data:await res.json()};
}

test("黄金样本从候选、发布、基准评测到删除形成闭环",async()=>{
  const DB=mockDb(),env={DB,SESSION_SECRET:"golden-test",DEPLOY_MODE:"local",ADMIN_USERS:"admin",ADMIN_PASS:"pass"};
  const sample={name:"[系统测试]出租项目",calcType:"rent",region:"深圳",sections:[{chapter:"市场分析",title:"租金结论",text:"本项目租金为42元/平方米/月。",numeric:true,prov:[{type:"calculation",source:"出租类白箱测算",ref:"rent=42"}]}],expectedFacts:{rent:42}};
  const created=await request(env,"POST",{action:"create",sample});
  assert.equal(created.status,200);assert.equal(created.data.status,"candidate");assert.equal(DB.state.samples.length,1);
  const id=created.data.id;
  const published=await request(env,"PATCH",{status:"published"},"http://test/api/reportgolden?id="+id,true);
  assert.equal(published.status,200);assert.equal(DB.state.samples[0].status,"published");
  const evaluated=await request(env,"POST",{action:"evaluate",sampleId:id});
  assert.equal(evaluated.status,200);assert.equal(evaluated.data.result.metrics.factAccuracy,100);assert.equal(DB.state.runs.length,1);
  const detail=await request(env,"GET",undefined,"http://test/api/reportgolden?id="+id);
  assert.equal(detail.data.runs.length,1);assert.equal(detail.data.item.name,"[系统测试]出租项目");assert.equal(detail.data.item.datasetRole,"training");
  const summary=await request(env,"GET",undefined,"http://test/api/reportgolden?summary=1");
  assert.equal(summary.status,200);assert.equal(summary.data.runCount,1);assert.equal(summary.data.summary.training.count,1);
  const deleted=await request(env,"DELETE",undefined,"http://test/api/reportgolden?id="+id,true);
  assert.equal(deleted.status,200);assert.equal(DB.state.samples.length,0);assert.equal(DB.state.runs.length,0);
});
