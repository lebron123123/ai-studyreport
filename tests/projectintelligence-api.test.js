import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost} from "../functions/api/projectintelligence.js";
import {signToken} from "../functions/api/_auth.js";

function makeDb(){
  const state={project:{id:"project-intel",name:"真实项目",user_id:1,updated_at:10,data:JSON.stringify({project:{name:"真实项目",type:"rent",location:"深圳",owner:"投资部"},calcSummary:{totalInvestment:12000,irr:4.2},kb:[{title:"材料"}]})},profile:null,members:[],gates:[],milestones:[],deliverables:[],events:[]};
  return {state,prepare(sql){const q={args:[]};return {bind(...args){q.args=args;return this;},async first(){
    if(sql.startsWith("SELECT id,name,data,updated_at,user_id FROM projects"))return q.args[0]===state.project.id?state.project:null;
    if(sql.startsWith("SELECT project_id,user_id,role,status FROM project_memberships"))return state.members.find(x=>x.project_id===q.args[0]&&x.user_id===q.args[1]&&x.status==="active")||null;
    if(sql.startsWith("SELECT * FROM project_profiles"))return state.profile;
    return null;
  },async all(){
    if(sql.includes("FROM project_memberships"))return {results:state.members};if(sql.includes("FROM project_gates"))return {results:state.gates};if(sql.includes("FROM project_milestones"))return {results:state.milestones};if(sql.includes("FROM project_deliverables"))return {results:state.deliverables};return {results:[]};
  },async run(){const a=q.args;
    if(sql.startsWith("INSERT INTO project_profiles")&&!state.profile)state.profile={project_id:a[0],owner_user_id:a[1],organization_id:"",department_id:"",visibility:"private",confidentiality_level:"internal",lifecycle_stage:a[2],current_gate_id:""};
    else if(sql.startsWith("INSERT INTO project_memberships")&&!state.members.some(x=>x.project_id===a[0]&&x.user_id===a[1]))state.members.push({project_id:a[0],user_id:a[1],role:"OWNER",status:"active"});
    else if(sql.startsWith("INSERT INTO project_milestones"))state.milestones.push({id:a[0],project_id:a[1],name:a[2],stage_key:a[3],gate_id:a[4],status:a[5],planned_date:a[6],forecast_date:a[7],actual_date:a[8],owner:a[9],progress:a[10],weight:a[11],risk_level:a[12],sort_order:a[13]});
    else if(sql.startsWith("INSERT INTO project_events"))state.events.push({id:a[0],event_type:a[3]});
    return {success:true};
  }};}};
}
async function call(DB,method,body,url="http://test/api/projectintelligence?projectId=project-intel"){
  const env={DB,SESSION_SECRET:"pi-test",DEPLOY_MODE:"local"},token=await signToken(env,1,"tester"),headers={authorization:"Bearer "+token};if(body)headers["content-type"]="application/json";const request=new Request(url,{method,headers,body:body?JSON.stringify(body):undefined}),res=await(method==="GET"?onRequestGet:onRequestPost)({request,env});return {status:res.status,data:await res.json()};
}

test("首次读取自动建立OWNER边界并返回Read Model V1",async()=>{const DB=makeDb(),r=await call(DB,"GET");assert.equal(r.status,200);assert.equal(r.data.readModel.project.name,"真实项目");assert.equal(r.data.readModel.contextContract.permissions.role,"OWNER");assert.equal(DB.state.members.length,1);assert.equal(r.data.readModel.progress.configured,false);});

test("保存里程碑后真实进度来自里程碑而不是生命周期固定百分比",async()=>{const DB=makeDb();await call(DB,"GET");const saved=await call(DB,"POST",{action:"saveMilestone",projectId:"project-intel",milestone:{name:"可研初稿",stageKey:"feasibility",status:"in_progress",progress:65,weight:1}},"http://test/api/projectintelligence");assert.equal(saved.status,200);const r=await call(DB,"GET");assert.equal(r.data.readModel.progress.value,65);assert.equal(r.data.readModel.progress.source,"milestones");assert.equal(DB.state.events.at(-1).event_type,"project.milestone.updated");});
