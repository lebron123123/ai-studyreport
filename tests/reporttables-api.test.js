import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost, validateOverrides } from "../functions/api/reporttables.js";
import { signToken } from "../functions/api/_auth.js";

test("三类表格模板覆盖配置接受合法增删改并拒绝非法类型与坐标",()=>{
  const result=validateOverrides({projectType:"rent",templates:{"rent-main-indicators":{title:"主要技术经济指标表（新版）",cells:{"0:0:0":"序号","0:0:1":"指标名称"}}}},"rent");
  assert.equal(result.templates["rent-main-indicators"].title,"主要技术经济指标表（新版）");
  assert.deepEqual(result.templates["rent-main-indicators"].cells,{"0:0:0":"序号","0:0:1":"指标名称"});
  assert.throws(()=>validateOverrides({templates:{x:{cells:{bad:"值"}}}},"rent"),/坐标格式有误/);
  const gaibao=validateOverrides({deletedTemplateIds:["gaibao-housing-table-01"],addedTemplates:[{id:"custom-1",title:"新增表",chapter:"第一章",match:["项目概况"],segments:[{gridWidths:[1,1],rows:[{cells:[{text:"字段",col:0,role:"static"},{text:"",col:1,role:"value"}]}]}]}]},"gaibao-housing");
  assert.deepEqual(gaibao.deletedTemplateIds,["gaibao-housing-table-01"]);assert.equal(gaibao.addedTemplates.length,1);
  assert.throws(()=>validateOverrides({templates:{}},"sale"),/不支持/);
});

function mockDb(){
  const rows=[];
  return {rows,prepare(sql){let args=[];return{bind(...values){args=values;return this;},async run(){
    if(sql.startsWith("UPDATE report_table_template_versions SET status='archived'"))rows.filter(row=>row.project_type===args[0]&&row.status==="published").forEach(row=>row.status="archived");
    if(sql.startsWith("INSERT INTO report_table_template_versions")){
      const [id,project_type,version,status,overrides,created_at,created_by,reason,restored_from_version]=args;
      rows.push({id,project_type,version,status,overrides,created_at,created_by,reason,restored_from_version});
    }
    return {success:true};
  },async first(){
    if(sql.includes("WHERE id=?"))return rows.find(row=>row.id===args[0])||null;
    if(sql.includes("project_type=? AND version=?"))return rows.find(row=>row.project_type===args[0]&&row.version===args[1])||null;
    const matches=rows.filter(row=>row.project_type===args[0]&&(!sql.includes("status='published'")||row.status==="published")).sort((a,b)=>b.version-a.version);
    return matches[0]||null;
  },async all(){return {results:rows.filter(row=>row.project_type===args[0]).sort((a,b)=>b.version-a.version)};}};}};
}

async function call(env,method,body,url="http://test/api/reporttables"){
  const token=await signToken(env,1,"admin"),headers={authorization:"Bearer "+token,"x-admin-pass":"pass","content-type":"application/json"};
  const request=new Request(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),response=await (method==="GET"?onRequestGet:onRequestPost)({request,env});
  return {status:response.status,data:await response.json()};
}

test("表格模板可把历史V3复制为新V6并保留完整审计链",async()=>{
  const DB=mockDb(),env={DB,SESSION_SECRET:"tables-test",DEPLOY_MODE:"local",ADMIN_USERS:"admin",ADMIN_PASS:"pass"};
  for(let version=1;version<=5;version++)DB.rows.push({id:"v"+version,project_type:"rent",version,status:version===5?"published":"archived",overrides:JSON.stringify({projectType:"rent",templates:{sample:{title:"版本"+version}}}),created_at:version,created_by:"admin",reason:"发布 V"+version,restored_from_version:null});
  const rolled=await call(env,"POST",{action:"rollback",projectType:"rent",targetVersion:3,reason:"V5表头有误，恢复已核准V3"});
  assert.equal(rolled.status,200);assert.equal(rolled.data.config.version,6);assert.equal(rolled.data.config.restoredFromVersion,3);
  assert.equal(rolled.data.config.reason,"V5表头有误，恢复已核准V3");assert.equal(rolled.data.config.overrides.templates.sample.title,"版本3");
  assert.equal(DB.rows.find(row=>row.version===5).status,"archived");assert.equal(DB.rows.find(row=>row.version===6).status,"published");
  const history=await call(env,"GET",undefined,"http://test/api/reporttables?action=history&projectType=rent");
  assert.equal(history.status,200);assert.deepEqual(history.data.history.map(row=>row.version),[6,5,4,3,2,1]);
});

test("表格模板恢复拒绝不存在的历史版本",async()=>{
  const DB=mockDb(),env={DB,SESSION_SECRET:"tables-test",DEPLOY_MODE:"local",ADMIN_USERS:"admin",ADMIN_PASS:"pass"};
  const result=await call(env,"POST",{action:"rollback",projectType:"gaibao-housing",targetVersion:99});
  assert.equal(result.status,404);assert.match(result.data.error,/找不到/);
});
