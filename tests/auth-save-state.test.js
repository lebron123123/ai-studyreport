const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,"..","auth.js"),"utf8");

function loadSaveState(options={}){
  const saveState={textContent:"",title:"",dataset:{},style:{}};
  const context=vm.createContext({
    document:{getElementById:id=>id==="saveState"?saveState:null},
    window:{},localStorage:{getItem:key=>key==="fs_token"?(options.token||null):null,setItem(){},removeItem(){}},
    fetch:options.fetch||(()=>Promise.reject(new Error("offline"))),
    setTimeout,clearTimeout,Promise,crypto:{randomUUID:()=>"test-id"}
  });
  vm.runInContext(source,context,{filename:"auth.js"});
  return {saveState,setSaveState:context.setSaveState,cloudSaveSnapshot:context.cloudSaveSnapshot};
}

test("本地草稿成功后以本机保存为主状态",()=>{
  const {saveState,setSaveState}=loadSaveState();
  setSaveState("local");
  assert.equal(saveState.textContent,"已保存到本机");
  assert.equal(saveState.dataset.state,"local");
  assert.match(saveState.title,/安全保存在此浏览器/);
});

test("云端不可用时不再误报为红色保存失败",()=>{
  const {saveState,setSaveState}=loadSaveState();
  setSaveState("offline");
  assert.equal(saveState.textContent,"已保存到本机 · 云端暂未同步");
  assert.equal(saveState.dataset.state,"offline");
  assert.doesNotMatch(saveState.textContent,/失败/);
  assert.notEqual(saveState.style.color,"var(--seal-red)");
});

test("版本冲突仍保留明确警示",()=>{
  const {saveState,setSaveState}=loadSaveState();
  setSaveState("conflict");
  assert.equal(saveState.textContent,"云端有更新 · 请重新载入");
  assert.equal(saveState.style.color,"var(--seal-red)");
});

test("云端请求异常时保留本机成功语义",async()=>{
  const {saveState,cloudSaveSnapshot}=loadSaveState({token:"test-token"});
  const saved=await cloudSaveSnapshot({id:"p1",name:"测试项目",snapshot:{},expectedUpdatedAt:null});
  assert.equal(saved,false);
  assert.equal(saveState.dataset.state,"offline");
  assert.equal(saveState.textContent,"已保存到本机 · 云端暂未同步");
});
