const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTools(fetchImpl){
  const document={readyState:"loading",addEventListener(){},getElementById(){return null;}};
  const window={project:{},projectWorkflow:{},document};
  const context=vm.createContext({window,document,fetch:fetchImpl||(async()=>{throw new Error("测试不应发起网络请求");}),console,Map,Set,Array,String,Number,Object,JSON,Promise,Math,Date,URL,Uint8Array,atob:()=>""});
  const source=fs.readFileSync(path.join(__dirname,"..","web-research-tools.js"),"utf8");
  vm.runInContext(source,context,{filename:"web-research-tools.js"});
  return window.WebResearch;
}

test("批量联网检索按章节和小节合并规则，忽略非网搜缺口",()=>{
  const tools=loadTools();
  const targets=tools.buildBatchTargets([
    {ruleId:"r1",sourceNo:1,chapter:"第三章 项目市场分析",section:"人口分析",title:"人口规模",requiredSources:"街道常住人口",missing:["web_search"],dataRequirement:{requirementId:"req:r1",webAllowed:true,evidenceGoal:"取得常住人口",query:"龙华区 常住人口 统计公报 官方",budget:{maxQueries:1,maxResults:5}}},
    {ruleId:"r2",sourceNo:2,chapter:"第三章 项目市场分析",section:"人口分析",title:"人口结构",requiredSources:"年龄结构",missing:["web_search","manual_upload"],dataRequirement:{requirementId:"req:r2",webAllowed:true,evidenceGoal:"取得人口结构",query:"龙华区 人口结构 统计公报 官方",budget:{maxQueries:1,maxResults:5}}},
    {ruleId:"r3",sourceNo:3,chapter:"第三章 项目市场分析",section:"住房需求",title:"内部需求",requiredSources:"内部名单",missing:["manual_upload"]},
    {ruleId:"r4",sourceNo:4,chapter:"第六章 项目地址及建设条件",section:"交通条件",title:"交通",requiredSources:"轨道和公交",missing:["web_search"]}
  ]);
  assert.equal(targets.length,2);
  assert.deepEqual([...targets[0].logicIds],["r1","r2"]);
  assert.match(targets[0].requirement,/取得常住人口/);
  assert.match(targets[0].requirement,/取得人口结构/);
  assert.doesNotMatch(tools.batchSearchQuery(targets[0]),/街道常住人口|年龄结构/);
  assert.ok(tools.batchSearchQuery(targets[0]).length<=180);
  assert.equal(targets[1].section,"交通条件");
});

test("项目内部事实即使误标网搜也不会进入联网任务",()=>{
  const tools=loadTools(),targets=tools.buildBatchTargets([{ruleId:"internal",chapter:"第一章",section:"项目概况",missing:["web_search"],requiredSources:"项目批复和合同原件",dataRequirement:{requirementId:"req:internal",webAllowed:false}}]);
  assert.equal(targets.length,0);
});

test("已经取得联网依据的逻辑项不会再次进入批量任务",()=>{
  const tools=loadTools();
  assert.equal(tools.buildBatchTargets([{ruleId:"done",chapter:"第一章",section:"背景",missing:[]}]).length,0);
});

test("同地域同主题数据需求跨小节只检索一次并绑定全部逻辑项",()=>{
  const tools=loadTools(),decision={level:"important",priority:88,reason:"判断需求规模与区域趋势",reuseKey:"official_statistic:深圳市龙华区:population:latest_3_years"},base={webAllowed:true,dataNature:"official_statistic",fields:[{key:"residentPopulation",label:"常住人口"}],timeScope:{kind:"latest_3_years",maxAgeMonths:36},geoScope:{level:"district",value:"深圳市龙华区"},quality:{minScore:80,minAuthority:"A",requireCrossCheck:true},budget:{maxQueries:1,maxResults:5},decision};
  const targets=tools.buildBatchTargets([
    {ruleId:"r1",sourceNo:1,chapter:"第三章",section:"人口分析",title:"人口规模",requiredSources:"常住人口",missing:["web_search"],dataRequirement:{...base,requirementId:"req:r1",evidenceGoal:"取得常住人口",queryTerms:["龙华区","常住人口"],query:"龙华区 常住人口 统计公报 官方"}},
    {ruleId:"r2",sourceNo:9,chapter:"第八章",section:"需求论证",title:"需求规模",requiredSources:"人口趋势",missing:["web_search"],dataRequirement:{...base,requirementId:"req:r2",evidenceGoal:"取得人口趋势",queryTerms:["龙华区","常住人口"],query:"龙华区 常住人口 统计公报 官方"}}
  ]);
  assert.equal(targets.length,1);assert.deepEqual([...targets[0].logicIds],["r1","r2"]);assert.equal(targets[0].bindings.length,2);assert.equal(targets[0].budget.maxQueries,1);assert.equal(targets[0].requirementSchema.decision.priority,88);
});

test("采用的联网依据生成带溯源和幂等键的知识库审核材料",()=>{
  const tools=loadTools(),item=tools.knowledgeContributionItem({evidenceId:"evi_1",title:"深圳市住房保障政策",url:"https://zjj.sz.gov.cn/policy/1",authorityLevel:"A",publisher:"深圳市住房建设局",publishedAt:"2026-08-01",snippet:"政策摘要"},{chapter:"第一章",section:"项目背景"});
  assert.equal(item.kind,"wiki");
  assert.equal(item.meta.wikiKind,"policy");
  assert.equal(item.meta.idempotencyKey,"web:evi_1");
  assert.match(item.content,/原始网址：https:\/\/zjj\.sz\.gov\.cn/);
  assert.match(item.content,/第一章｜项目背景/);
  assert.equal(item.meta.sourceChannel,"web_research");
  assert.equal(item.meta.webCategory,"政策制度");
  assert.equal(item.region,"深圳市");
  assert.equal(item.meta.regionLevel,"city");
  assert.deepEqual([...item.meta.regionPath],["深圳市"]);
  const national=tools.knowledgeContributionItem({evidenceId:"evi_n",title:"国务院政策",url:"https://www.gov.cn/policy",publisher:"国务院",snippet:"国家政策摘要"},{chapter:"第二章",section:"政策依据"});
  assert.equal(national.region,"全国");assert.equal(national.meta.regionLevel,"national");
});

test("联网依据按业务类型分类而不是堆进孤立的网上搜索库",()=>{
  const tools=loadTools();
  assert.deepEqual({...tools.classifyWebEvidence({title:"深圳市住房发展规划"},{chapter:"市场分析"})},{wikiKind:"policy",webCategory:"规划文件"});
  assert.deepEqual({...tools.classifyWebEvidence({title:"街道第七次人口普查数据"},{chapter:"人口分析"})},{wikiKind:"report",webCategory:"统计数据"});
  assert.deepEqual({...tools.classifyWebEvidence({title:"宗地项目环评批复"},{chapter:"项目概况"})},{wikiKind:"case",webCategory:"项目资料"});
});

test("批量沉淀只选择指定权威等级并按网址去重",()=>{
  const tools=loadTools(),job={targets:[{chapter:"第一章",section:"背景",logicIds:["r1"]},{chapter:"第二章",section:"政策",logicIds:["r2"]}],outputs:[
    {target:{chapter:"第一章",section:"背景",logicIds:["r1"]},results:[{url:"https://sz.gov.cn/a",authorityLevel:"A",title:"A"},{url:"https://example.com/c",authorityLevel:"C",title:"C"}]},
    {target:{chapter:"第二章",section:"政策",logicIds:["r2"]},results:[{url:"https://sz.gov.cn/a",authorityLevel:"A",title:"A重复"},{url:"https://news.cn/b",authorityLevel:"B",title:"B"}]}
  ]};
  const rows=tools.highValueEntries(job,["A","B"]);
  assert.equal(rows.length,2);
  assert.equal(rows.find(x=>x.row.url.includes("sz.gov.cn")).target.bindings.length,2);
});

test("A级自动沉淀只提交现有摘要，不额外抓全文消耗检索资源",async()=>{
  const calls=[],tools=loadTools(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,id:"con_1"})};});
  const a={url:"https://sz.gov.cn/policy/a",authorityLevel:"A",title:"官方政策",snippet:"已取得的检索摘要"},b={url:"https://news.cn/b",authorityLevel:"B",title:"新闻解读",snippet:"摘要"};
  const job={targets:[{chapter:"第一章",section:"背景",logicIds:["r1"]}],outputs:[{target:{chapter:"第一章",section:"背景",logicIds:["r1"]},results:[a,b]}]};
  const result=await tools.depositHighValue(job,["A"],{auto:true,fetchFullText:false,persist:false});
  assert.equal(result.submitted,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"/api/contributions");
  assert.equal(calls[0].body.item.meta.authorityLevel,"A");
  assert.equal(a.knowledgeDeposit.status,"submitted");
  assert.equal(b.knowledgeDeposit,undefined);
});
