import test from 'node:test';
import assert from 'node:assert/strict';
import {deepseekSearchRows,deepseekMessagesSearch} from '../functions/api/_deepseek-search.js';
test('租售提示隔离，售价请求不得被要求排除买卖',async()=>{
 const original=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({content:[{type:'web_search_tool_result',content:[]}]})};};
 try{await deepseekMessagesSearch({},'测试小区售价',{domain:'rental',market:'sale'});await deepseekMessagesSearch({},'测试小区租金',{domain:'rental'});}finally{globalThis.fetch=original;}
 assert.match(requests[0].messages[0].content,/出售房源/);assert.doesNotMatch(requests[0].messages[0].content,/排除买卖/);assert.match(requests[1].messages[0].content,/排除买卖/);
});
test('native search rejects prose, truncation and tool errors; never extracts prices from prose',()=>{
 assert.throws(()=>deepseekSearchRows({content:[{type:'text',text:'https://example.com 3000元/月'}]}),/真实联网/);
 assert.throws(()=>deepseekSearchRows({stop_reason:'max_tokens'}),/未完整/);
 assert.throws(()=>deepseekSearchRows({content:[{type:'web_search_tool_result',content:{type:'web_search_tool_result_error'}}]}),/工具执行失败/);
 const rows=deepseekSearchRows({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://sz.lianjia.com/zufang/a',title:'测试花园租房'}]},{type:'text',text:'3000元/月'}]});
 assert.equal(rows.length,1);assert.equal(rows[0].snippet,'');
});
