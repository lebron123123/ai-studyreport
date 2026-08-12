import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost,activeOn} from "../functions/api/calcconfig.js";
import {signToken} from "../functions/api/_auth.js";

function mockDb(seed){
  const rows=new Map(Object.entries(seed||{}));
  return {rows,prepare(sql){const st={args:[]};return {bind(...a){st.args=a;return this;},async first(){
    if(/SELECT data/.test(sql)){const v=rows.get(st.args[0]);return v===undefined?null:{data:JSON.stringify(v)};}
    if(/SELECT key/.test(sql)) return rows.has(st.args[0])?{key:st.args[0]}:null; return null;
  },async run(){
    if(/INSERT INTO configs/.test(sql)) rows.set(st.args[0],JSON.parse(st.args[1]));
    if(/UPDATE configs/.test(sql)) rows.set(st.args[2],JSON.parse(st.args[0]));
    return {success:true};
  }};}};
}
async function authRequest(env,method,body){
  const token=await signToken(env,1,"admin");
  return new Request("http://test/api/calcconfig",{method,headers:{authorization:"Bearer "+token,"x-admin-pass":"pass","content-type":"application/json"},body:body?JSON.stringify(body):undefined});
}

test("calcconfig可持久化并读取paramdefaults",async()=>{
  const env={DB:mockDb(),SESSION_SECRET:"secret",ADMIN_USERS:"admin",ADMIN_PASS:"pass"};
  let request=await authRequest(env,"POST",{key:"paramdefaults",data:{rent:{rent:36,stableOcc:0.88}}});
  let d=await (await onRequestPost({request,env})).json(); assert.equal(d.ok,true);
  request=await authRequest(env,"GET"); d=await (await onRequestGet({request,env})).json();
  assert.deepEqual(d.config.paramdefaults,{rent:{rent:36,stableOcc:0.88}});
});

test("calcconfig未配置时paramdefaults和paramrules均返回空对象",async()=>{
  const env={DB:mockDb(),SESSION_SECRET:"secret",ADMIN_USERS:"admin",ADMIN_PASS:"pass"};
  const request=await authRequest(env,"GET"); const d=await (await onRequestGet({request,env})).json();
  assert.deepEqual(d.config.paramdefaults,{}); assert.deepEqual(d.config.paramrules,{});
});

test("治理版本只在生效日期区间内进入测算",()=>{
  assert.equal(activeOn({effectiveDate:"2026-01-01",expiryDate:"2026-12-31"},"2026-08-11"),true);
  assert.equal(activeOn({effectiveDate:"2027-01-01"},"2026-08-11"),false);
  assert.equal(activeOn({expiryDate:"2025-12-31"},"2026-08-11"),false);
});
