import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost} from "../functions/api/investmentops.js";
import {signToken} from "../functions/api/_auth.js";

function db(){
  const state={project:{id:"project-ops",name:"运营测试项目",user_id:1,data:JSON.stringify({project:{name:"运营测试项目",type:"rent"},workflow:{calcSnapshots:[{id:"calc-v1",calcType:"rent",params:{rent:40},summary:{irr:5.6,npv:120,payback:18,totalInvestment:10000}}]}})},meetings:[],tasks:[],risks:[],decisions:[],scenarios:[],events:[]};
  const table={project_meetings:"meetings",project_tasks:"tasks",project_risks:"risks",project_scenarios:"scenarios",project_events:"events",project_decisions:"decisions"};
  return {state,prepare(sql){const q={a:[]};return {bind(...a){q.a=a;return this;},async first(){
    if(sql.startsWith("SELECT id,name,data FROM projects"))return q.a[0]===state.project.id?state.project:null;
    if(sql.startsWith("SELECT * FROM project_meetings WHERE id="))return state.meetings.find(x=>x.id===q.a[0])||null;
    if(sql.startsWith("SELECT * FROM project_scenarios WHERE id="))return state.scenarios.find(x=>x.id===q.a[0])||null;
    return null;
  },async all(){for(const [name,key] of Object.entries(table))if(sql.includes("FROM "+name))return {results:[...state[key]]};if(sql.includes("FROM project_artifacts"))return {results:[{id:"artifact-calc",artifactType:"calculation"},{id:"artifact-report",artifactType:"report"}]};return {results:[]};},async run(){const a=q.a;
    if(sql.startsWith("INSERT INTO project_meetings"))state.meetings.push({id:a[0],project_id:a[1],user_id:a[2],title:a[3],content:a[4],extraction_json:a[5],status:"candidate",created_at:a[6],updated_at:a[7]});
    else if(sql.startsWith("UPDATE project_meetings")){const x=state.meetings.find(v=>v.id===a[1]);if(x)x.status="confirmed";}
    else if(sql.startsWith("INSERT INTO project_tasks"))state.tasks.push({id:a[0],project_id:a[1],user_id:a[2],title:a[3],owner:a[4],due_date:a[5],source_ref:a[6],status:"open",created_at:a[7],updated_at:a[8]});
    else if(sql.startsWith("INSERT INTO project_risks"))state.risks.push({id:a[0],project_id:a[1],user_id:a[2],title:a[3],risk_level:a[4],owner:"",source_ref:a[5],status:"open",created_at:a[6],updated_at:a[7]});
    else if(sql.startsWith("INSERT INTO project_decisions"))state.decisions.push({id:a[0],project_id:a[1],user_id:a[2],topic:a[3]});
    else if(sql.startsWith("INSERT INTO project_scenarios"))state.scenarios.push({id:a[0],project_id:a[1],user_id:a[2],name:a[3],kind:a[4],calc_type:a[5],calc_snapshot_id:a[6],engine:a[7],params_json:a[8],metrics_json:a[9],risks_json:a[10],status:a[11],created_at:a[12],updated_at:a[13]});
    else if(sql.startsWith("INSERT INTO project_events"))state.events.push({id:a[0],project_id:a[1],user_id:a[2],event_type:a[3],actor:a[4],payload_json:a[5],created_at:a[6]});
    return {success:true};
  }};}};
}
async function call(DB,method,body,url="http://test/api/investmentops?projectId=project-ops") {const env={DB,SESSION_SECRET:"ops-test",DEPLOY_MODE:"local"},token=await signToken(env,1,"tester"),headers={authorization:"Bearer "+token};if(body)headers["content-type"]="application/json";const request=new Request(url,{method,headers,body:body?JSON.stringify(body):undefined}),res=await(method==="GET"?onRequestGet:onRequestPost)({request,env});return {status:res.status,data:await res.json()};}

test("会议候选经人工确认后才进入任务风险和决策台账",async()=>{const DB=db(),x=await call(DB,"POST",{action:"extractMeeting",projectId:"project-ops",content:"决定采用方案A\n由投资部牵头完成复核\n存在融资风险"},"http://test/api/investmentops");assert.equal(x.status,200);assert.equal(DB.state.tasks.length,0);const y=await call(DB,"POST",{action:"confirmMeeting",projectId:"project-ops",meetingId:x.data.id},"http://test/api/investmentops");assert.deepEqual([y.data.decisionCount,y.data.taskCount,y.data.riskCount],[1,1,1]);assert.equal(DB.state.meetings[0].status,"confirmed");});

test("情景只能从现有白箱测算快照保存",async()=>{const DB=db(),x=await call(DB,"POST",{action:"saveScenario",projectId:"project-ops",scenario:{kind:"baseline"}},"http://test/api/investmentops");assert.equal(x.status,200);assert.equal(DB.state.scenarios[0].calc_snapshot_id,"calc-v1");assert.equal(DB.state.scenarios[0].engine,"whitebox");});

test("决策包直接消费已保存白箱情景并执行阻断式审计",async()=>{const DB=db(),saved=await call(DB,"POST",{action:"saveScenario",projectId:"project-ops",scenario:{kind:"baseline"}},"http://test/api/investmentops"),pack=await call(DB,"POST",{action:"createDecisionPackage",projectId:"project-ops",scenarioId:saved.data.id,evidenceIds:["evidence-1"]},"http://test/api/investmentops");assert.equal(pack.status,200);assert.equal(pack.data.package.audit.passed,true);assert.equal(pack.data.package.status,"ready");});
