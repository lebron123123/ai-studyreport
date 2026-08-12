import test from "node:test";
import assert from "node:assert/strict";
import {cleanRow,changedFields,projectPublishedConfigs,onRequestGet,onRequestPost} from "../functions/api/paramgovernance.js";
import {signToken} from "../functions/api/_auth.js";

test("参数治理草稿清洗：限制知识依据数量并保留多维分类",()=>{
  const row=cleanRow({key:"rent",label:"起始租金",unit:"元/㎡/月",role:"market_stat",sourcePolicy:"case_statistics",volatility:"market_dynamic",confirmation:"required",hasExpertOverride:true,expertValue:45,ruleValue:42,min:20,max:80,enabled:true,manualRequired:true,evidenceRefs:Array.from({length:12},(_,i)=>({id:"asset:"+i,type:"asset",label:"依据"+i,sourceRef:"第"+i+"页"}))});
  assert.equal(row.key,"rent");assert.equal(row.role,"market_stat");assert.equal(row.sourcePolicy,"case_statistics");assert.equal(row.volatility,"market_dynamic");assert.equal(row.confirmation,"required");assert.equal(row.evidenceRefs.length,8);assert.equal(row.expertValue,45);
});

test("参数版本差异能识别数值、适用范围和知识依据变化",()=>{
  const a={ruleValue:3.5,region:"",evidenceRefs:[]},b={ruleValue:4,region:"南山区",evidenceRefs:[{id:"wiki:1"}]};
  const fields=changedFields(a,b);assert.ok(fields.includes("ruleValue"));assert.ok(fields.includes("region"));assert.ok(fields.includes("evidenceRefs"));
});

test("计算派生结果不在参数输入目录中",async()=>{
  const {PARAM_META}=await import("../functions/api/_paramcatalog.js");
  for(const type of Object.keys(PARAM_META)) for(const [key,m] of Object.entries(PARAM_META[type])){assert.equal(m.input,true,type+"."+key);assert.equal(m.derived,false,type+"."+key);}
  for(const forbidden of ["irr","npv","totalNpv","totalTax","totalNetProfit"]) for(const type of Object.keys(PARAM_META)) assert.equal(PARAM_META[type][forbidden],undefined,type+"不应包含派生结果"+forbidden);
});

test("审核发布投影：输入参数分别生成专家默认值与带知识依据的行业规则",()=>{
  const row={status:"draft",published_version:2,draft_data:JSON.stringify({key:"rent",label:"起始租金",input:true,derived:false,hasExpertOverride:true,expertValue:45,ruleValue:42,min:30,max:60,basis:"市场报告第8页",evidenceRefs:[{id:"asset:1",label:"市场报告"}],enabled:true,manualRequired:true,role:"market_stat",sourcePolicy:"case_statistics",volatility:"market_dynamic",confirmation:"required",impactLevel:"核心"}),published_data:"{}"};
  const out=projectPublishedConfigs("rent",[row],1000,"admin");assert.equal(out.kind,"input");assert.equal(out.defaults.rent,45);assert.equal(out.rules[0].value,42);assert.equal(out.rules[0].version,3);assert.equal(out.rules[0].evidenceRefs[0].id,"asset:1");
});

test("审核发布投影：公式常量只输出已设置的覆盖值，派生项被隔离",()=>{
  const records=[
    {status:"draft",published_version:0,draft_data:JSON.stringify({key:"landUseTax",input:true,derived:false,hasExpertOverride:true,expertValue:3}),published_data:"{}"},
    {status:"draft",published_version:0,draft_data:JSON.stringify({key:"irr",input:false,derived:true,hasExpertOverride:true,expertValue:9}),published_data:"{}"},
  ];
  const out=projectPublishedConfigs("coeff_rent",records);assert.equal(out.kind,"coeff");assert.equal(out.target,"rent");assert.deepEqual(out.config,{landUseTax:3});
});

function governanceDb(){
  const pg=new Map(),history=[],configs=new Map();
  const rowsOf=type=>[...pg.values()].filter(x=>x.calc_type===type).sort((a,b)=>a.param_key.localeCompare(b.param_key));
  return{pg,history,configs,prepare(sql){const st={args:[]};return{bind(...a){st.args=a;return this;},async first(){
    if(/SELECT \* FROM param_governance WHERE calc_type=\? AND param_key=\?/.test(sql))return pg.get(st.args[0]+"|"+st.args[1])||null;
    if(/SELECT published_version FROM param_governance/.test(sql))return pg.get(st.args[0]+"|"+st.args[1])||null;
    if(/SELECT data FROM param_governance_history/.test(sql))return history.find(x=>x.calc_type===st.args[0]&&x.param_key===st.args[1]&&x.version===st.args[2])||null;
    if(/SELECT data FROM configs/.test(sql)){const v=configs.get(st.args[0]);return v===undefined?null:{data:JSON.stringify(v)};}
    if(/SELECT key FROM configs/.test(sql))return configs.has(st.args[0])?{key:st.args[0]}:null;return null;
  },async all(){
    if(/FROM param_governance_history WHERE calc_type/.test(sql))return{results:history.filter(x=>x.calc_type===st.args[0])};
    if(/FROM param_governance WHERE calc_type=\? AND status='draft'/.test(sql))return{results:rowsOf(st.args[0]).filter(x=>x.status==="draft")};
    if(/FROM param_governance WHERE calc_type=\?/.test(sql))return{results:rowsOf(st.args[0])};
    return{results:[]};
  },async run(){
    if(/^CREATE /.test(sql))return{success:true};
    if(/INSERT INTO param_governance\(/.test(sql)){const [type,key,draft,user,now]=st.args;pg.set(type+"|"+key,{calc_type:type,param_key:key,draft_data:draft,published_data:"{}",draft_version:1,published_version:0,status:"draft",updated_by:user,updated_at:now,published_by:"",published_at:0});}
    else if(/UPDATE param_governance SET draft_data=\?,draft_version=\?,status='draft'/.test(sql)){const [draft,ver,user,now,type,key]=st.args,o=pg.get(type+"|"+key);Object.assign(o,{draft_data:draft,draft_version:ver,status:"draft",updated_by:user,updated_at:now});}
    else if(/UPDATE param_governance SET draft_data/.test(sql)){const [draft,ver,status,user,now,type,key]=st.args,o=pg.get(type+"|"+key);Object.assign(o,{draft_data:draft,draft_version:ver,status,updated_by:user,updated_at:now});}
    else if(/UPDATE param_governance SET published_data/.test(sql)){const [data,pver,dver,user,pat,uat,type,key]=st.args,o=pg.get(type+"|"+key);Object.assign(o,{published_data:data,published_version:pver,draft_version:dver,status:"published",published_by:user,published_at:pat,updated_at:uat});}
    else if(/INSERT INTO param_governance_history/.test(sql)){const [id,type,key,version,data,change_summary,published_by,published_at]=st.args;history.push({id,calc_type:type,param_key:key,version,data,change_summary,published_by,published_at});}
    else if(/INSERT INTO configs/.test(sql))configs.set(st.args[0],JSON.parse(st.args[1]));
    else if(/UPDATE configs/.test(sql))configs.set(st.args[2],JSON.parse(st.args[0]));
    return{success:true};
  }};}};
}
async function govRequest(env,method,body,url="http://test/api/paramgovernance"){
  const token=await signToken(env,1,"admin");return new Request(url,{method,headers:{authorization:"Bearer "+token,"x-admin-pass":"pass","content-type":"application/json"},body:body?JSON.stringify(body):undefined});
}

test("参数治理接口闭环：保存草稿不改正式配置，发布后才写入正式默认值和规则",async()=>{
  const DB=governanceDb(),env={DB,SESSION_SECRET:"secret",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local"};
  const row={key:"rent",label:"起始租金",unit:"元/㎡/月",role:"market_stat",sourcePolicy:"case_statistics",volatility:"market_dynamic",confirmation:"required",impactLevel:"核心",input:true,derived:false,hasExpertOverride:true,expertValue:45,ruleValue:42,min:30,max:60,basis:"正式市场报告",evidenceRefs:[{id:"asset:1",type:"asset",label:"市场报告"}],enabled:true,manualRequired:true};
  let req=await govRequest(env,"POST",{action:"saveDraft",calcType:"rent",rows:[row]});let d=await (await onRequestPost({request:req,env})).json();assert.equal(d.ok,true);assert.equal(DB.configs.has("calc_paramdefaults"),false);assert.equal([...DB.pg.values()][0].status,"draft");
  req=await govRequest(env,"GET",null,"http://test/api/paramgovernance?type=rent&history=1&evidence=0");d=await (await onRequestGet({request:req,env})).json();assert.equal(d.rows.length,1);assert.equal(d.rows[0].draft.label,"起始租金");
  req=await govRequest(env,"POST",{action:"publish",calcType:"rent"});d=await (await onRequestPost({request:req,env})).json();assert.equal(d.ok,true);assert.equal(DB.configs.get("calc_paramdefaults").rent.rent,45);assert.equal(DB.configs.get("calc_paramrules").rent[0].value,42);assert.equal([...DB.pg.values()][0].status,"published");assert.equal(DB.history.length,1);
  req=await govRequest(env,"POST",{action:"restoreDraft",calcType:"rent",key:"rent",version:1});d=await (await onRequestPost({request:req,env})).json();assert.equal(d.ok,true);assert.equal([...DB.pg.values()][0].status,"draft");assert.equal(DB.configs.get("calc_paramdefaults").rent.rent,45,"恢复历史只能形成草稿，不能偷偷改正式值");
});

test("公式常量接口闭环：土地使用税等常量也必须草稿发布后才生效",async()=>{
  const DB=governanceDb(),env={DB,SESSION_SECRET:"secret",ADMIN_USERS:"admin",ADMIN_PASS:"pass",DEPLOY_MODE:"local"};
  const row={key:"landUseTax",label:"土地使用税",unit:"元/㎡",role:"policy_constant",sourcePolicy:"binding_rule",volatility:"low_frequency",confirmation:"recommended",impactLevel:"一般",input:true,derived:false,hasExpertOverride:true,expertValue:3,basis:"公司测算口径",enabled:false,manualRequired:true};
  let req=await govRequest(env,"POST",{action:"saveDraft",calcType:"coeff_rent",rows:[row]});let d=await (await onRequestPost({request:req,env})).json();assert.equal(d.ok,true);assert.equal(DB.configs.has("calc_rent"),false);
  req=await govRequest(env,"POST",{action:"publish",calcType:"coeff_rent"});d=await (await onRequestPost({request:req,env})).json();assert.equal(d.ok,true);assert.deepEqual(DB.configs.get("calc_rent"),{landUseTax:3});
});
