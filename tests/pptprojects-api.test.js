import test from "node:test";
import assert from "node:assert/strict";
import {onRequestPost} from "../functions/api/pptprojects.js";
import {signToken} from "../functions/api/_auth.js";

function dbMock(){
  const state={projects:[],versions:[]};
  return{state,prepare(sql){const q={args:[]};return{bind(...args){q.args=args;return this;},async run(){
    if(sql.startsWith("INSERT INTO ppt_projects")){const a=q.args;state.projects.push({id:a[0],user_id:a[1],title:a[2],status:"draft",template_id:a[3],data:a[4],revision:1,created_at:a[5],updated_at:a[6]});}
    else if(sql.startsWith("INSERT INTO ppt_project_versions")){const a=q.args;state.versions.push({id:a[0],project_id:a[1],user_id:a[2],revision:a[3],label:a[4],data:a[5],created_at:a[6]});}
    else if(sql.startsWith("UPDATE ppt_projects SET title")){const a=q.args,p=state.projects.find(x=>x.id===a[5]&&x.user_id===a[6]);Object.assign(p,{title:a[0],status:a[1],template_id:a[2],data:a[3],revision:p.revision+1,updated_at:a[4]});}
    return{success:true};},async first(){
      if(sql.includes("FROM ppt_projects WHERE id=?"))return state.projects.find(x=>x.id===q.args[0]&&x.user_id===q.args[1])||null;return null;
    },async all(){
      if(sql.includes("SELECT * FROM ppt_projects WHERE user_id=?"))return{results:state.projects.filter(x=>x.user_id===q.args[0])};
      if(sql.includes("SELECT id FROM ppt_project_versions"))return{results:state.versions.filter(x=>x.project_id===q.args[0]&&x.user_id===q.args[1]).map(x=>({id:x.id}))};
      return{results:[]};
    }};}};
}
async function call(env,userId,body){const token=await signToken(env,userId,"u"+userId),request=new Request("http://test/api/pptprojects",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)}),res=await onRequestPost({request,env});return{status:res.status,data:await res.json()};}

test("PPT项目按用户隔离并使用乐观修订保护",async()=>{
  const DB=dbMock(),env={DB,SESSION_SECRET:"ppt-api-test",DEPLOY_MODE:"local"},plan={title:"项目汇报",templateId:"anju-blue",slides:[{id:"s1",title:"封面"},{id:"s2",title:"正文"},{id:"s3",title:"结论"}]};
  const created=await call(env,1,{action:"create",title:"项目汇报",data:plan}),item=created.data.item;assert.equal(created.status,200);assert.equal(item.revision,1);
  const other=await call(env,2,{action:"get",id:item.id});assert.equal(other.status,404);
  const saved=await call(env,1,{action:"save",id:item.id,revision:1,title:"更新汇报",data:{...plan,title:"更新汇报"}});assert.equal(saved.data.item.revision,2);assert.equal(DB.state.versions.length,1);
  const conflict=await call(env,1,{action:"save",id:item.id,revision:1,title:"旧页面覆盖",data:plan});assert.equal(conflict.status,409);assert.equal(conflict.data.conflict,true);assert.equal(DB.state.projects[0].title,"更新汇报");
});
