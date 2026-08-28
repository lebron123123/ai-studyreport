import test from "node:test";
import assert from "node:assert/strict";
import { buildHousingSearchPlan, wrAssertPublicUrl, wrProviderCatalog, wrNormalizeSearchPayload, wrNormalizeDeepSeekSearchResponse, wrDeepSeekResponsesUrl, wrDeduplicate, wrCrossVerify, wrAuthority } from "../functions/api/_web-research-core.js";

test("保障房垂直查询规划覆盖政策、统计、市场、规划和小节",()=>{
  const plan=buildHousingSearchPlan({projectName:"龙岗保障房项目",location:"深圳市龙岗区坂田街道",projectType:"rent",chapter:"项目市场分析",section:"人口与住房需求",requiredSources:"街道常住人口和保障房供应"});
  assert.ok(plan.queries.length>=7);
  const kinds=new Set(plan.queries.map(x=>x.dimension));
  for(const key of ["project","policy","statistics","market","planning","section","evidence"])assert.ok(kinds.has(key),key);
  assert.ok(plan.queries.every(x=>x.query.includes("深圳市龙岗区坂田街道")||x.dimension==="project"));
});

test("安全抓取拒绝本机、私网和非HTTP协议",()=>{
  for(const value of ["http://127.0.0.1/a","http://10.0.0.2","http://172.17.0.1","http://192.168.1.1","file:///etc/passwd","http://localhost/a"]){
    assert.throws(()=>wrAssertPublicUrl(value));
  }
  assert.equal(wrAssertPublicUrl("https://www.sz.gov.cn/cn/xxgk/").hostname,"www.sz.gov.cn");
});

test("Provider状态不泄露Key且识别可用通道",()=>{
  const rows=wrProviderCatalog({DEEPSEEK_API_KEY:"deepseek-secret",BRAVE_SEARCH_API_KEY:"secret",WEB_SEARCH_DDG_DISABLED:"1"});
  assert.equal(rows[0].id,"deepseek-web");
  assert.equal(rows.find(x=>x.id==="deepseek-web").configured,true);
  assert.equal(rows.find(x=>x.id==="brave").configured,true);
  assert.equal(rows.find(x=>x.id==="duckduckgo").configured,false);
  assert.equal(JSON.stringify(rows).includes("secret"),false);
});

test("DeepSeek Responses地址兼容官方默认、base URL和聊天完整端点",()=>{
  assert.equal(wrDeepSeekResponsesUrl({DEEPSEEK_API_KEY:"x"}),"https://api.deepseek.com/responses");
  assert.equal(wrDeepSeekResponsesUrl({DEEPSEEK_API_URL:"https://example.com/v1"}),"https://example.com/v1/responses");
  assert.equal(wrDeepSeekResponsesUrl({DEEPSEEK_API_URL:"https://example.com/v1/chat/completions"}),"https://example.com/v1/responses");
});

test("DeepSeek联网响应只沉淀带真实URL的引用并自动去重",()=>{
  const rows=wrNormalizeDeepSeekSearchResponse({output:[{type:"message",content:[{type:"output_text",text:"深圳政策见 https://zjj.sz.gov.cn/a 。重复 https://zjj.sz.gov.cn/a",annotations:[{type:"url_citation",url:"https://zjj.sz.gov.cn/a",title:"深圳住房政策",start_index:0,end_index:4},{type:"url_citation",url:"https://www.sz.gov.cn/b",title:"深圳政府公示",start_index:0,end_index:4}]}]}]});
  assert.equal(rows.length,2);
  assert.equal(rows[0].title,"深圳住房政策");
  assert.equal(rows[0].provider,"deepseek-web");
  assert.ok(rows.every(row=>row.url.startsWith("https://")));
});

test("DeepSeek引用未附标题时从回答中的标题行补齐",()=>{
  const rows=wrNormalizeDeepSeekSearchResponse({output:[{type:"message",content:[{type:"output_text",text:"**1. 深圳市住房保障署关于保障性租赁住房的通告**\n- 发布日期：2026-08-19\n- 原始网址：https://zjj.sz.gov.cn/notice",annotations:[{type:"url_citation",url:"https://zjj.sz.gov.cn/notice",start_index:0,end_index:4}]}]}]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,"深圳市住房保障署关于保障性租赁住房的通告");
});

test("多种搜索返回结构统一、URL去重并按权威度排序",()=>{
  const a=wrNormalizeSearchPayload({web:{results:[{title:"深圳政策",url:"https://www.sz.gov.cn/a?utm_source=x",description:"政策内容"}]}},"brave");
  const b=wrNormalizeSearchPayload({results:[{title:"深圳政策重复",url:"https://www.sz.gov.cn/a",content:"同一政策"},{title:"市场文章",url:"https://example.com/a",content:"市场数据"}]},"tavily");
  const rows=wrDeduplicate([...a,...b]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].authorityLevel,"A");
  assert.equal(wrAuthority("https://tjj.sz.gov.cn/a").level,"A");
});

test("相同主题的不同域名形成交叉核验，不伪造多源结论",()=>{
  const rows=wrCrossVerify([
    {title:"坂田街道常住人口统计公报",snippet:"坂田街道 常住人口 统计公报",url:"https://tjj.sz.gov.cn/a",authorityScore:95},
    {title:"坂田街道人口与住房需求",snippet:"坂田街道 常住人口 住房需求",url:"https://www.lg.gov.cn/b",authorityScore:95},
    {title:"完全无关页面",snippet:"企业招聘",url:"https://example.com/c",authorityScore:45}
  ]);
  assert.notEqual(rows[0].verificationStatus,"single");
  assert.equal(rows[2].verificationStatus,"single");
});
