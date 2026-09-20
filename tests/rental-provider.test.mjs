import test from 'node:test';
import assert from 'node:assert/strict';
import {wrSearchProvider} from '../functions/api/_web-research-core.js';
test('租金检索独立来源约束和预算，不改变可研默认；仍拒绝未执行工具的回答',async t=>{
 const original=globalThis.fetch; t.after(()=>globalThis.fetch=original);let body;
 globalThis.fetch=async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({status:'completed',output:[]})};};
 await assert.rejects(wrSearchProvider({DEEPSEEK_API_KEY:'test'},'deepseek-web','测试',{domain:'rental',maxOutputTokens:3000}),/真实联网结果/);
 assert.equal(body.max_tokens,4096);assert.match(body.messages[0].content,/链家/);
 await assert.rejects(wrSearchProvider({DEEPSEEK_API_KEY:'test'},'deepseek-web','测试',{maxOutputTokens:3000}),/真实联网结果/);
 assert.match(body.messages[0].content,/政府/);
});
