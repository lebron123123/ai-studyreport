import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost,onRequestDelete} from "../functions/api/aireport.js";
import {signToken} from "../functions/api/_auth.js";

function memoryDb(){
  const rows=new Map();
  return {rows,prepare(sql){const st={args:[]};return {bind(...a){st.args=a;return this;},async first(){
    if(sql.includes("WHERE user_id=? AND project_id=?")){const k=st.args[0]+":"+st.args[1],r=rows.get(k);return r?{id:r.id,data:r.data,updated_at:r.updated_at}:null;}
    return null;
  },async run(){
    if(sql.startsWith("INSERT INTO aireport_project_sessions")){const [id,userId,projectId,data,updatedAt]=st.args;rows.set(userId+":"+projectId,{id,data,updated_at:updatedAt});}
    if(sql.startsWith("UPDATE aireport_project_sessions")){const [data,updatedAt,userId,projectId]=st.args,k=userId+":"+projectId,r=rows.get(k);rows.set(k,{id:r.id,data,updated_at:updatedAt});}
    if(sql.startsWith("DELETE FROM aireport_project_sessions"))rows.delete(st.args[0]+":"+st.args[1]);
    return {success:true};
  },async all(){return {results:[]};}};}};
}
async function auth(env){return "Bearer "+await signToken(env,7,"tester");}

test("项目级AI可研会话按projectId隔离、可覆盖更新并删除",async()=>{
  const env={DB:memoryDb(),SESSION_SECRET:"secret"},authorization=await auth(env);
  async function save(projectId,state){const request=new Request("http://x/api/aireport",{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({action:"saveState",projectId,state})});return (await onRequestPost({request,env})).json();}
  async function load(projectId){const request=new Request("http://x/api/aireport?projectId="+projectId,{headers:{authorization}});return (await onRequestGet({request,env})).json();}
  assert.equal((await save("project-a1",{step:"calc",value:1})).ok,true);
  assert.equal((await save("project-b2",{step:"report",value:2})).ok,true);
  assert.equal((await load("project-a1")).state.value,1);assert.equal((await load("project-b2")).state.value,2);
  await save("project-a1",{step:"done",value:3});assert.equal((await load("project-a1")).state.value,3);
  const del=new Request("http://x/api/aireport?projectId=project-a1",{method:"DELETE",headers:{authorization}});await onRequestDelete({request:del,env});
  assert.equal((await load("project-a1")).state,null);assert.equal((await load("project-b2")).state.value,2);
});

test("项目级会话拒绝非法projectId，避免越界键",async()=>{
  const env={DB:memoryDb(),SESSION_SECRET:"secret"},authorization=await auth(env);
  const request=new Request("http://x/api/aireport",{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({action:"saveState",projectId:"../bad",state:{}})});
  const res=await onRequestPost({request,env});assert.equal(res.status,400);assert.match((await res.json()).error,/项目ID非法/);
});
