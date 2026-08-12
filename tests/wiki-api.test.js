import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/wiki.js";
import { signToken } from "../functions/api/_auth.js";

function mockDb(){
  const calls=[];
  const db={
    calls,
    prepare(sql){
      const state={sql,args:[]}; calls.push(state);
      return {
        bind(...args){ state.args=args; return this; },
        async run(){ return {success:true,meta:{changes:1}}; },
        async all(){ return {results:[]}; },
        async first(){
          if(/SELECT \* FROM wiki_pages WHERE id/.test(sql)) return {id:"wtest",title:"租金审核口径",kind:"rule",status:"draft",content:"这是经过人工确认的保障性租赁住房租金审核口径，适用于深圳市项目，必须结合原始政策条款执行。",tags:"[\"保障房\"]",region:"深圳市",project_type:"保租房",doc_no:"深建规〔2025〕1号",issuer:"投资管理部",source_ref:"《租金管理办法》第12条",security:1,dept_scope:"全部门",effective_date:"",expiry_date:"",version:0,vector_ids:"[]",created_at:1,updated_at:1};
          return null;
        },
      };
    },
  };
  return db;
}
async function req(env, body){
  const token=await signToken(env,1,"admin");
  const request=new Request("http://test/api/wiki",{method:"POST",headers:{authorization:"Bearer "+token,"x-admin-pass":"pass","content-type":"application/json"},body:JSON.stringify(body)});
  const res=await onRequestPost({request,env}); return await res.json();
}

test("Wiki 保存必须提供可追溯的原始依据",async()=>{
  const env={SESSION_SECRET:"test-secret",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DB:mockDb()};
  const out=await req(env,{action:"save",page:{title:"租金审核口径",content:"这是经过人工确认的保障性租赁住房租金审核口径，适用于深圳市项目，必须结合原始政策条款执行。"}});
  assert.equal(out.ok,false);
  assert.match(out.error,/原始依据/);
});

test("Wiki 保存只落草稿，不会在未发布时调用向量库",async()=>{
  const db=mockDb();
  const env={SESSION_SECRET:"test-secret-2",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DB:db,VECTORIZE:{upsert(){throw new Error("草稿不应向量化");}},AI:{run(){throw new Error("草稿不应调用AI");}}};
  const out=await req(env,{action:"save",page:{id:"wtest",title:"租金审核口径",kind:"rule",source_ref:"《租金管理办法》第12条",content:"这是经过人工确认的保障性租赁住房租金审核口径，适用于深圳市项目，必须结合原始政策条款执行。"}});
  assert.equal(out.ok,true);
  assert.equal(out.page.status,"draft");
  assert.ok(db.calls.some(c=>/status='draft'/.test(c.sql)));
});
