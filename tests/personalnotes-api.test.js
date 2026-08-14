import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/personalnotes.js";
import { signToken } from "../functions/api/_auth.js";

function dbMock(){
  const state={notes:[],versions:[],links:[]};
  return {state,prepare(sql){const q={args:[]};return{bind(...args){q.args=args;return this;},async run(){
    if(sql.startsWith("INSERT INTO personal_notes")){const a=q.args;state.notes.push({id:a[0],user_id:a[1],parent_id:a[2],kind:a[3],title:a[4],content:a[5],tags:a[6],favorite:0,status:"active",source_name:a[7],source_type:a[8],revision:1,sort_order:0,created_at:a[9],updated_at:a[10],deleted_at:0});}
    else if(sql.startsWith("UPDATE personal_notes SET parent_id")){const a=q.args,n=state.notes.find(x=>x.id===a[6]&&x.user_id===a[7]);Object.assign(n,{parent_id:a[0],title:a[1],content:a[2],tags:a[3],favorite:a[4],updated_at:a[5],revision:n.revision+1});}
    else if(sql.startsWith("UPDATE personal_notes SET status")){const a=q.args;state.notes.filter(x=>(x.id===a[3]||x.parent_id===a[3])&&x.user_id===a[4]).forEach(n=>Object.assign(n,{status:a[0],deleted_at:a[1],updated_at:a[2],revision:n.revision+1}));}
    else if(sql.startsWith("INSERT INTO personal_note_versions")){const a=q.args;state.versions.push({id:a[0],note_id:a[1],user_id:a[2],revision:a[3],title:a[4],content:a[5],tags:a[6],created_at:a[7]});}
    else if(sql.startsWith("DELETE FROM personal_note_links")){state.links=state.links.filter(x=>!(x.from_note_id===q.args[0]&&x.user_id===q.args[1]));}
    else if(sql.startsWith("INSERT INTO personal_note_links")){const a=q.args;state.links.push({id:a[0],user_id:a[1],from_note_id:a[2],to_note_id:a[3],target_title:a[4],link_text:a[5],created_at:a[6]});}
    return{success:true};},async first(){
      if(sql.includes("FROM personal_notes WHERE id=? AND user_id=?"))return state.notes.find(x=>x.id===q.args[0]&&x.user_id===q.args[1]&&(!sql.includes("status='active'")||x.status==="active"))||null;
      if(sql.includes("LOWER(title)=LOWER(?)")){const title=String(q.args[1]).toLowerCase();return state.notes.find(x=>x.user_id===q.args[0]&&x.status==="active"&&x.kind==="note"&&x.title.toLowerCase()===title)||null;}
      if(sql.includes("FROM personal_note_versions"))return null;return null;},async all(){
      if(sql.includes("FROM personal_notes WHERE user_id=? AND status=?"))return{results:state.notes.filter(x=>x.user_id===q.args[0]&&x.status===q.args[1])};
      if(sql.includes("FROM personal_note_links l"))return{results:[]};
      if(sql.includes("FROM personal_note_links WHERE"))return{results:state.links.filter(x=>x.user_id===q.args[0]&&x.from_note_id===q.args[1])};
      if(sql.includes("SELECT id FROM personal_notes WHERE parent_id=?"))return{results:state.notes.filter(x=>x.parent_id===q.args[0]&&x.user_id===q.args[1]).map(x=>({id:x.id}))};
      if(sql.includes("SELECT id FROM personal_note_versions"))return{results:[]};return{results:[]};
    }};}};
}
async function call(env,userId,body){const token=await signToken(env,userId,"u"+userId),request=new Request("http://test/api/personalnotes",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)}),res=await onRequestPost({request,env});return{status:res.status,data:await res.json()};}

test("个人笔记创建、保存和乐观修订冲突保护",async()=>{
  const DB=dbMock(),env={DB,SESSION_SECRET:"personal-test",DEPLOY_MODE:"local"};
  const created=await call(env,1,{action:"create",kind:"note",title:"租金口径",content:"初稿"});
  assert.equal(created.status,200);assert.equal(created.data.item.revision,1);
  const saved=await call(env,1,{action:"save",id:created.data.item.id,revision:1,title:"租金口径",content:"更新稿",tags:["测算"]});
  assert.equal(saved.data.item.revision,2);assert.equal(saved.data.item.content,"更新稿");
  const conflict=await call(env,1,{action:"save",id:created.data.item.id,revision:1,title:"旧页面",content:"不应覆盖"});
  assert.equal(conflict.status,409);assert.equal(conflict.data.conflict,true);assert.equal(DB.state.notes[0].content,"更新稿");
});

test("服务端按登录用户隔离列表和详情",async()=>{
  const DB=dbMock(),env={DB,SESSION_SECRET:"personal-isolation",DEPLOY_MODE:"local"};
  const mine=await call(env,11,{action:"create",kind:"note",title:"用户11私有笔记",content:"秘密内容"}),id=mine.data.item.id;
  const otherList=await call(env,12,{action:"list"});assert.equal(otherList.data.items.length,0);
  const otherGet=await call(env,12,{action:"get",id});assert.equal(otherGet.status,404);
  const myList=await call(env,11,{action:"list"});assert.equal(myList.data.items.length,1);
});

test("文件夹进入回收站时递归处理全部后代",async()=>{
  const DB=dbMock(),env={DB,SESSION_SECRET:"personal-tree",DEPLOY_MODE:"local"};
  const root=(await call(env,21,{action:"create",kind:"folder",title:"项目资料"})).data.item;
  const child=(await call(env,21,{action:"create",kind:"folder",parentId:root.id,title:"政策"})).data.item;
  await call(env,21,{action:"create",kind:"note",parentId:child.id,title:"租金政策",content:"正文"});
  const trashed=await call(env,21,{action:"trash",id:root.id});
  assert.equal(trashed.data.affected,3);assert.deepEqual(DB.state.notes.map(x=>x.status),["trash","trash","trash"]);
});
