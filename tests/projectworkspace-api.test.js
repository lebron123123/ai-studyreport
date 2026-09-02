import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,onRequestPost} from "../functions/api/projectworkspace.js";
import {signToken} from "../functions/api/_auth.js";

function makeDb(){
  const state={project:{id:"project-workspace",name:"企业项目",user_id:1,updated_at:10,data:"{}"},profile:null,members:[],files:[],objects:[],extractions:[],facts:[],metrics:[],artifacts:[],issues:[],events:[]};
  return {state,prepare(sql){const q={args:[]};return {bind(...args){q.args=args;return this;},async first(){const a=q.args;
    if(sql.startsWith("SELECT id,name,data,updated_at,user_id FROM projects"))return a[0]===state.project.id?state.project:null;
    if(sql.startsWith("SELECT * FROM project_profiles"))return state.profile;
    if(sql.startsWith("SELECT * FROM project_memberships"))return state.members.find(x=>x.project_id===a[0]&&x.user_id===a[1]&&x.status==="active")||null;
    if(sql.startsWith("SELECT id,version FROM project_files"))return [...state.files].reverse().find(x=>x.project_id===a[0]&&x.file_name.toLowerCase()===String(a[1]).toLowerCase()&&x.is_current===1)||null;
    if(sql.startsWith("SELECT content_hash FROM rag_source_objects"))return state.objects.find(x=>x.content_hash===a[0])||null;
    if(sql.startsWith("SELECT id FROM project_files"))return state.files.find(x=>x.id===a[0]&&x.project_id===a[1])||null;
    if(sql.startsWith("SELECT * FROM project_file_extractions"))return state.extractions.find(x=>x.id===a[0]&&x.project_id===a[1])||null;
    if(sql.startsWith("SELECT MAX(version) AS n FROM project_facts")){const rows=state.facts.filter(x=>x.project_id===a[0]&&x.user_id===a[1]&&x.fact_key===a[2]);return {n:rows.reduce((n,x)=>Math.max(n,x.version),0)};}
    if(sql.startsWith("SELECT MAX(version) AS n FROM project_metrics")){const rows=state.metrics.filter(x=>x.project_id===a[0]&&x.user_id===a[1]&&x.metric_key===a[2]);return {n:rows.reduce((n,x)=>Math.max(n,x.version),0)};}
    return null;
  },async all(){const a=q.args;
    if(sql.includes("FROM project_memberships"))return {results:state.members.filter(x=>x.project_id===a[0])};
    if(sql.includes("FROM project_files"))return {results:state.files.filter(x=>x.project_id===a[0])};
    if(sql.includes("FROM project_file_extractions"))return {results:state.extractions.filter(x=>x.project_id===a[0])};
    if(sql.includes("FROM project_facts"))return {results:state.facts.filter(x=>x.project_id===a[0])};
    if(sql.includes("FROM project_metrics"))return {results:state.metrics.filter(x=>x.project_id===a[0])};
    if(sql.includes("FROM project_artifacts"))return {results:state.artifacts};
    if(sql.includes("FROM project_data_issues"))return {results:state.issues};
    return {results:[]};
  },async run(){const a=q.args;
    if(sql.startsWith("INSERT INTO project_profiles")&&!state.profile)state.profile={project_id:a[0],owner_user_id:a[1],organization_id:"",department_id:"",visibility:"private",confidentiality_level:"internal",lifecycle_stage:a[2]};
    else if(sql.startsWith("INSERT INTO project_memberships")){const old=state.members.find(x=>x.project_id===a[0]&&x.user_id===a[1]);if(old){old.role=a[2];old.status="active";}else state.members.push({project_id:a[0],user_id:a[1],role:a[2],status:a[3]});}
    else if(sql.startsWith("UPDATE project_files SET is_current=0"))state.files.filter(x=>x.project_id===a[1]&&x.file_name.toLowerCase()===String(a[2]).toLowerCase()&&x.is_current===1).forEach(x=>{x.is_current=0;x.status="superseded";});
    else if(sql.startsWith("INSERT INTO project_files"))state.files.push({id:a[0],project_id:a[1],owner_user_id:a[2],file_name:a[3],file_type:a[4],category:a[5],storage_ref:a[6],fingerprint:a[7],version:a[8],status:a[9],parse_status:a[10],is_current:a[11],parent_file_id:a[12],size_bytes:a[13],meta_json:a[14]});
    else if(sql.startsWith("INSERT INTO rag_source_objects"))state.objects.push({content_hash:a[0],storage_key:a[1],file_name:a[2],mime_type:a[3],size_bytes:a[4]});
    else if(sql.startsWith("UPDATE rag_source_objects")){const x=state.objects.find(x=>x.content_hash===a[4]);if(x)Object.assign(x,{file_name:a[0],mime_type:a[1],size_bytes:a[2]});}
    else if(sql.startsWith("INSERT INTO project_file_extractions"))state.extractions.push({id:a[0],project_id:a[1],file_id:a[2],extraction_type:a[3],item_key:a[4],label:a[5],value_json:a[6],source_location:a[7],confidence:a[8],review_status:a[9],target_ref:a[10]});
    else if(sql.startsWith("UPDATE project_file_extractions SET review_status")){const x=state.extractions.find(x=>x.id===a[2]);if(x)x.review_status=a[0];}
    else if(sql.startsWith("INSERT INTO project_facts"))state.facts.push({id:a[0],project_id:a[1],user_id:a[2],fact_type:a[3],fact_key:a[4],label:a[5],value_json:a[6],unit:a[7],source_type:a[8],source_ref:a[9],confidence:a[10],status:a[11],version:a[14]});
    else if(sql.startsWith("INSERT INTO project_events"))state.events.push({id:a[0],event_type:a[3]});
    return {success:true};
  }};}};
}
async function call(DB,method,body,url="http://test/api/projectworkspace?projectId=project-workspace&view=files",userId=1,envExtra={}){const env={DB,SESSION_SECRET:"workspace-test",DEPLOY_MODE:"local",...envExtra},token=await signToken(env,userId,"tester"),headers={authorization:"Bearer "+token};if(body)headers["content-type"]="application/json";const request=new Request(url,{method,headers,body:body?JSON.stringify(body):undefined}),res=await(method==="GET"?onRequestGet:onRequestPost)({request,env});return {status:res.status,data:await res.json()};}

test("首次进入建立OWNER边界并返回文件工作区",async()=>{const DB=makeDb(),r=await call(DB,"GET");assert.equal(r.status,200);assert.equal(r.data.context.role,"OWNER");assert.equal(r.data.data.summary.total,0);assert.equal(DB.state.members.length,1);});

test("同名文件登记形成版本链且不覆盖旧版",async()=>{const DB=makeDb();await call(DB,"GET");const a=await call(DB,"POST",{action:"registerFile",projectId:"project-workspace",file:{name:"方案.docx",category:"design"}},"http://test/api/projectworkspace"),b=await call(DB,"POST",{action:"registerFile",projectId:"project-workspace",file:{name:"方案.docx",category:"design"}},"http://test/api/projectworkspace");assert.equal(a.data.version,1);assert.equal(b.data.version,2);assert.equal(DB.state.files[0].status,"superseded");assert.equal(DB.state.files[1].is_current,1);});

test("项目材料原件按哈希进入对象存储并登记项目文件",async()=>{const DB=makeDb();await call(DB,"GET");const hash="a".repeat(64),RAG_OBJECTS={async put({bytes,fileName,mimeType}){assert.equal(new TextDecoder().decode(bytes),"abc");return {contentHash:hash,storageKey:"sha256/aa/"+hash,sizeBytes:3,fileName,mimeType,deduplicated:false};}};const r=await call(DB,"POST",{action:"storeProjectOriginal",projectId:"project-workspace",name:"项目资料.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",dataBase64:"YWJj"},"http://test/api/projectworkspace",1,{RAG_OBJECTS});assert.equal(r.status,200);assert.equal(r.data.stored,true);assert.equal(DB.state.objects[0].content_hash,hash);assert.equal(DB.state.files[0].fingerprint,hash);assert.equal(DB.state.files[0].storage_ref,"sha256/aa/"+hash);});

test("文件提取先为候选，OWNER审核后沉淀为正式事实",async()=>{const DB=makeDb();await call(DB,"GET");const f=await call(DB,"POST",{action:"registerFile",projectId:"project-workspace",file:{name:"测算说明.xlsx"}},"http://test/api/projectworkspace"),x=await call(DB,"POST",{action:"saveExtraction",projectId:"project-workspace",extraction:{fileId:f.data.fileId,type:"fact",key:"project.area",label:"项目面积",value:61900,confidence:.9,sourceLocation:"Sheet1!B2"}},"http://test/api/projectworkspace"),review=await call(DB,"POST",{action:"reviewExtraction",projectId:"project-workspace",id:x.data.extractionId,decision:"approve"},"http://test/api/projectworkspace");assert.equal(review.status,200);assert.equal(DB.state.extractions[0].review_status,"approved");assert.equal(DB.state.facts[0].fact_key,"project.area");assert.equal(DB.state.facts[0].status,"confirmed");});

test("非成员不能读取项目工作区",async()=>{const DB=makeDb();const r=await call(DB,"GET",null,"http://test/api/projectworkspace?projectId=project-workspace&view=data",2);assert.equal(r.status,404);});
