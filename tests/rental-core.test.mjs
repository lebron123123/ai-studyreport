import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalQuery,rentalUrl,rentalObservation,rentalInRange,rentalFresh,rentalStatistics,rentalCollectChannels} from '../project-map/rental-core.mjs';
const community={name:'测试苑',kind:'住宅',point:[114,22.6],district:'南山区'};
test('租金范围严格校验，不接受空值坐标或任意半径',()=>{
 assert.equal(rentalQuery({point:community.point}).radius,2000);
 for(const point of [[null,22.6],[114,NaN],[0,0],['114',22.6]])assert.throws(()=>rentalQuery({point}));
 assert.throws(()=>rentalQuery({point:community.point,radius:9999}));
 assert.throws(()=>rentalUrl('http://example.com'));
});
test('明确挂牌单位才能提取，不把租金区间、合租、索引页误作均价',()=>{
 const hit={url:'https://example.com/a',title:'测试苑 整租',snippet:'80㎡ 6000元/月'};
 const r=rentalObservation(hit,community,'search',1000);
 assert.equal(r.monthlyRent,6000);assert.equal(r.area,80);assert.equal(r.status,'candidate');
 assert.equal(rentalStatistics([r],1000).count,0);
 for(const snippet of ['80㎡ 5000-6000元/月','80㎡ 6000元/月起','80㎡ 6000元/月 7000元/月'])assert.equal(rentalObservation({...hit,snippet},community,'crawl').monthlyRent,null);
 assert.equal(rentalObservation({...hit,title:'别的小区'},community,'search'),null);
 assert.equal(rentalInRange(r,rentalQuery({point:community.point})),true);
 assert.equal(rentalInRange({...r,point:[115,22.6]},rentalQuery({point:community.point})),false);
 assert.equal(rentalFresh(r,31*86400000),false);
});
test('两个通道并行且失败隔离，保存成功项',async()=>{
 const results=[],errors=[];let starts=0,release;const gate=new Promise(r=>release=r);
 const out=await rentalCollectChannels({search:async()=>{starts++;await gate;return [1];},crawl:async()=>{starts++;release();throw Error('验证码，停止此通道');}},{onResult:async(...v)=>results.push(v),onError:async(...v)=>errors.push(v)});
 assert.equal(starts,2);assert.equal(results.length,1);assert.equal(errors.length,1);assert.equal(out[1].status,'failed');
});
