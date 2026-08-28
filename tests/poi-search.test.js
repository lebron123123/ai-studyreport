import test from "node:test";
import assert from "node:assert/strict";
import {poiSearchContext,poiSearchQueries,mergePoiCandidates,onRequestPost} from "../functions/api/poi.js";
import {signToken} from "../functions/api/_auth.js";

test("地点检索同时使用完整地址、短地址和项目名称",()=>{
  const ctx=poiSearchContext("深圳市光明区凤凰街道光谷苑");
  assert.equal(ctx.city,"深圳市");
  assert.equal(ctx.keyword,"光明区凤凰街道光谷苑");
  const queries=poiSearchQueries("深圳市光明区凤凰街道光谷苑","光谷苑保障房项目");
  assert.ok(queries.includes("光明区凤凰街道光谷苑"));
  assert.ok(queries.includes("光谷苑"));
  assert.ok(queries.some(x=>x.includes("光谷苑保障房")));
});

test("多路地点结果按坐标去重并最多保留15个真实候选",()=>{
  const a=Array.from({length:12},(_,i)=>({name:"候选"+i,location:i+","+i}));
  const b=[{name:"重复坐标",location:"1,1"},...Array.from({length:8},(_,i)=>({name:"补充"+i,location:(i+20)+","+(i+20)}))];
  const merged=mergePoiCandidates([a,b],15);
  assert.equal(merged.length,15);
  assert.equal(merged.filter(x=>x.location==="1,1").length,1);
});

async function apiCall(fetchImpl){
  const env={SESSION_SECRET:"poi-search-test",AMAP_KEY:"test-key"};
  const token=await signToken(env,1,"tester"),oldFetch=globalThis.fetch;
  globalThis.fetch=fetchImpl;
  try{
    const request=new Request("http://test/api/poi",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"search",address:"深圳市光明区凤凰街道光谷苑",projectName:"光谷苑保障房项目"})});
    const response=await onRequestPost({request,env});
    return {status:response.status,data:await response.json()};
  }finally{globalThis.fetch=oldFetch;}
}

test("一个地图检索通道失败时仍合并其他通道并返回10条以上候选",async()=>{
  let call=0;
  const result=await apiCall(async url=>{
    call++;
    if(call===1)throw new TypeError("network branch failed");
    if(String(url).includes("geocode/geo"))return new Response(JSON.stringify({status:"1",geocodes:[{formatted_address:"广东省深圳市光明区光谷苑",province:"广东省",city:"深圳市",district:"光明区",township:"凤凰街道",level:"兴趣点",location:"113.90,22.70"}]}));
    const base=call*10;
    return new Response(JSON.stringify({status:"1",pois:Array.from({length:6},(_,i)=>({name:"相似候选"+(base+i),pname:"广东省",cityname:"深圳市",adname:"光明区",address:"凤凰街道"+(base+i)+"号",location:(113+base/1000+i/10000)+","+(22+base/1000+i/10000)}))}));
  });
  assert.equal(result.status,200);
  assert.equal(result.data.ok,true);
  assert.ok(result.data.candidates.length>=10);
  assert.equal(result.data.partial,true);
});

test("地图服务完全不可达时返回可操作错误而不是fetch failed",async()=>{
  const result=await apiCall(async()=>{throw new TypeError("fetch failed");});
  assert.equal(result.status,503);
  assert.equal(result.data.code,"MAP_PROVIDER_UNREACHABLE");
  assert.match(result.data.error,/地图服务当前不可达/);
  assert.doesNotMatch(result.data.error,/fetch failed/i);
});
