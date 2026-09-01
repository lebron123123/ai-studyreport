import test from "node:test";
import assert from "node:assert/strict";
import { wrEvidenceQuality, wrNormalizeRequirement } from "../functions/api/webresearch.js";

test("联网证据质量评分同时检查权威性、需求匹配、时效和交叉核验",()=>{
  const requirement={title:"常住人口",queryTerms:["龙华区","常住人口","统计期"],fields:[{key:"residentPopulation",label:"常住人口"},{key:"period",label:"统计期"}],timeScope:{maxAgeMonths:36},quality:{minScore:80,minAuthority:"A",requireCrossCheck:true}};
  const high=wrEvidenceQuality({title:"龙华区常住人口统计公报",url:"https://www.sz.gov.cn/data",publisher:"深圳市统计局",publishedAt:"2026-06-01",snippet:"龙华区常住人口及统计期",authorityLevel:"A",verificationStatus:"cross_checked"},requirement,Date.parse("2026-09-01"));
  assert.ok(high.qualityScore>=80);assert.equal(high.meetsRequirement,true);
  const low=wrEvidenceQuality({title:"某论坛随笔",url:"https://example.com/post",snippet:"一些背景介绍",authorityLevel:"D",verificationStatus:"single"},requirement,Date.parse("2026-09-01"));
  assert.equal(low.meetsRequirement,false);assert.ok(low.qualityScore<high.qualityScore);
});

test("交互精化需求限制来源通道、检索预算和质量阈值",()=>{
  const refined=wrNormalizeRequirement({fields:[{key:"rent",label:"近12个月租金",dataType:"number"}],allowedChannels:["provider","knowledge_base","invalid"],timeScope:{kind:"latest",maxAgeMonths:12},geoScope:{level:"district",value:"龙华区"},quality:{minScore:95,minAuthority:"A"},budget:{maxQueries:99,maxResults:99,maxOutputTokens:99999}});
  assert.deepEqual(refined.allowedChannels,["provider","knowledge_base"]);assert.equal(refined.budget.maxQueries,2);assert.equal(refined.budget.maxResults,8);assert.equal(refined.budget.maxOutputTokens,1000);assert.equal(refined.quality.minScore,95);
});
