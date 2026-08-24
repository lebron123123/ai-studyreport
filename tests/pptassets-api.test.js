import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/pptassets.js";
import { signToken } from "../functions/api/_auth.js";

function dbMock(){
  const state={assets:[],usage:[]};
  return {state,prepare(sql){const q={args:[]};return {bind(...args){q.args=args;return this;},async run(){
    if(sql.startsWith("CREATE "))return{success:true};
    if(sql.startsWith("INSERT INTO ppt_assets")){const a=q.args;state.assets.push({id:a[0],user_id:a[1],username:a[2],scope:a[3],project_id:a[4],title:a[5],description:a[6],category:a[7],tags:a[8],mime_type:a[9],width:a[10],height:a[11],bytes:a[12],content_hash:a[13],data_url:a[14],thumbnail_url:a[15],provider:a[16],source_ref:a[17],prompt:a[18],model:a[19],status:"draft",favorite:0,usage_count:0,review_note:"",created_at:a[20],updated_at:a[21],reviewed_at:0,reviewed_by:""});}
    else if(sql.startsWith("UPDATE ppt_assets SET favorite")){const x=state.assets.find(v=>v.id===q.args[2]&&v.user_id===q.args[3]);if(x){x.favorite=q.args[0];x.updated_at=q.args[1];}}
    else if(sql.startsWith("UPDATE ppt_assets SET scope='department'")){const x=state.assets.find(v=>v.id===q.args[1]&&v.user_id===q.args[2]);if(x){x.scope="department";x.status="pending";x.review_note="";x.updated_at=q.args[0];}}
    else if(sql.startsWith("UPDATE ppt_assets SET usage_count")){const x=state.assets.find(v=>v.id===q.args[1]);if(x){x.usage_count++;x.updated_at=q.args[0];}}
    else if(sql.startsWith("UPDATE ppt_assets SET status")){const x=state.assets.find(v=>v.id===q.args[6]);if(x){x.status=q.args[0];x.scope=q.args[1];x.review_note=q.args[2];x.reviewed_at=q.args[3];x.reviewed_by=q.args[4];x.updated_at=q.args[5];}}
    else if(sql.startsWith("INSERT INTO ppt_asset_usage")){const a=q.args;state.usage.push({id:a[0],asset_id:a[1],user_id:a[2],project_id:a[3],slide_id:a[4],usage_type:a[5],created_at:a[6]});}
    else if(sql.startsWith("DELETE FROM ppt_asset_usage"))state.usage=state.usage.filter(v=>v.asset_id!==q.args[0]);
    else if(sql.startsWith("DELETE FROM ppt_assets WHERE id=? AND user_id=?"))state.assets=state.assets.filter(v=>!(v.id===q.args[0]&&v.user_id===q.args[1]));
    else if(sql.startsWith("DELETE FROM ppt_assets WHERE id=?"))state.assets=state.assets.filter(v=>v.id!==q.args[0]);
    return{success:true};},async first(){
      if(sql.includes("user_id=? AND content_hash=?"))return state.assets.find(v=>v.user_id===q.args[0]&&v.content_hash===q.args[1]&&v.status!=="archived")||null;
      if(sql.includes("(user_id=? OR (status='published'"))return state.assets.find(v=>v.id===q.args[0]&&(v.user_id===q.args[1]||(v.status==="published"&&["department","system"].includes(v.scope))))||null;
      if(sql.includes("WHERE id=? AND user_id=?"))return state.assets.find(v=>v.id===q.args[0]&&v.user_id===q.args[1])||null;
      if(sql.includes("WHERE id=?"))return state.assets.find(v=>v.id===q.args[0])||null;
      return null;
    },async all(){
      if(sql.includes("WHERE user_id=? OR (status='published'"))return{results:state.assets.filter(v=>v.user_id===q.args[0]||(v.status==="published"&&["department","system"].includes(v.scope)))};
      if(sql.includes("WHERE status=?"))return{results:state.assets.filter(v=>v.status===q.args[0])};
      if(sql.includes("SELECT * FROM ppt_assets ORDER BY"))return{results:[...state.assets]};
      return{results:[]};
    }};}};
}

async function call(env,userId,body,extra={}){const token=await signToken(env,userId,"u"+userId),request=new Request("http://test/api/pptassets",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json",...extra},body:JSON.stringify(body)}),res=await onRequestPost({request,env});return{status:res.status,data:await res.json()};}

test("PPT素材从个人沉淀、审核发布到跨用户复用形成闭环",async()=>{
  const DB=dbMock(),env={DB,SESSION_SECRET:"asset-test",DEPLOY_MODE:"local",ADMIN_USERS:"u1",ADMIN_PASS:"admin-test"};
  const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const created=await call(env,1,{action:"create",item:{title:"项目鸟瞰图",dataUrl:png,thumbnailUrl:png,width:1,height:1,provider:"nano-banana",projectId:"ppt-1",tags:["项目","主视觉"]}});
  assert.equal(created.status,200);assert.equal(created.data.item.scope,"project");assert.equal(created.data.item.status,"draft");
  const duplicate=await call(env,1,{action:"create",item:{title:"重复图",dataUrl:png}});assert.equal(duplicate.data.duplicate,true);assert.equal(DB.state.assets.length,1);
  const hidden=await call(env,2,{action:"get",id:created.data.item.id});assert.equal(hidden.status,404);
  await call(env,1,{action:"favorite",id:created.data.item.id,value:true});assert.equal(DB.state.assets[0].favorite,1);
  const submitted=await call(env,1,{action:"submit",id:created.data.item.id});assert.equal(submitted.status,200);assert.equal(DB.state.assets[0].status,"pending");
  const reviewed=await call(env,1,{action:"review",id:created.data.item.id,decision:"publish",note:"适合部门项目汇报"},{"x-admin-pass":"admin-test"});assert.equal(reviewed.status,200);assert.equal(DB.state.assets[0].status,"published");
  const visible=await call(env,2,{action:"list",scope:"department"});assert.equal(visible.data.items.length,1);assert.equal(visible.data.items[0].title,"项目鸟瞰图");
  const used=await call(env,2,{action:"use",id:created.data.item.id,projectId:"ppt-2",slideId:"s3"});assert.equal(used.data.item.dataUrl,png);assert.equal(DB.state.usage.length,1);assert.equal(DB.state.assets[0].usage_count,1);
  const blockedDelete=await call(env,1,{action:"delete",id:created.data.item.id});assert.equal(blockedDelete.status,409);
});
