import test from 'node:test';
import assert from 'node:assert/strict';
import {fangRentalCards,fangCommunityPrice,fangCommunityCandidate,fangCommunityLinks} from '../functions/api/_rental-fang.js';
import {rentalSiteMatch,rentalCommunityEligible} from '../functions/api/_rental-search-plan.js';
const community={name:'锦绣江南',kind:'住宅',point:[114.02,22.64]};
test('附近小区导航只生成固定名单的具名待核验链接，不采纳推荐价格',()=>{
 const links=fangCommunityLinks({url:'https://www.fang.com/xiaoqu/sz-123/',html:'<a href="https://www.fang.com/xiaoqu/sz-456/">锦绣江南</a><span>99999元/㎡</span><a href="https://www.fang.com/xiaoqu/sz-789/">名单外小区</a>'},[community]);
 assert.equal(links.length,1);assert.equal(links[0].url,'https://www.fang.com/xiaoqu/sz-456/');assert.equal(links[0].saleUnitPrice,undefined);
});
test('从已搜索到的深圳小区ID建立待核验入口，不把候选URL当报价',()=>{
 assert.equal(fangCommunityCandidate('https://sz.esf.fang.com/loupan/2810931790/chushou/list/g22-i31/'),'https://www.fang.com/xiaoqu/sz-2810931790/');
 assert.equal(fangCommunityCandidate('https://m.fang.com/xiaoqu/sz/2810931790.html'),'https://www.fang.com/xiaoqu/sz-2810931790/');
 assert.equal(fangCommunityCandidate('https://m.fang.com/xiaoqu/bj/2810931790.html'),null);
 assert.equal(fangCommunityCandidate('https://fangjia.fang.com/sz/process/2810894728.htm'),'https://www.fang.com/xiaoqu/sz-2810894728/');
 assert.equal(fangCommunityCandidate('https://sz.esf.fang.com/loupan/2810894728/strategy.htm'),'https://www.fang.com/xiaoqu/sz-2810894728/');
 assert.equal(fangCommunityCandidate('https://fangjia.fang.com/bj/process/2810894728.htm'),null);
 assert.equal(fangCommunityCandidate('https://example.com/loupan/2810894728/strategy.htm'),null);
});
test('小区参考价只读具名标题块，重复页头及推荐价格不干扰',()=>{
 const html='<div class="infor_xq clearfix"><h2>锦绣江南</h2><p><b>35000</b><span>元/㎡</span>（08月参考价）</p></div><div>周边推荐 88888元/㎡</div>';
 const page={url:'https://www.fang.com/xiaoqu/sz-123/',html:html+html};
 assert.equal(fangCommunityPrice(page,{...community,market:'sale'}).saleUnitPrice,35000);
 assert.equal(fangCommunityPrice(page,{...community,name:'锦绣江南四期',market:'sale'}),null);
 assert.equal(fangCommunityPrice(page,{...community,district:'福田区',market:'sale'}),null);
 for(const districtLabel of ['龙华','龙华区'])assert.equal(fangCommunityPrice({...page,html:districtLabel+'小区二手房 '+page.html},{...community,district:'龙华区',market:'sale'}).saleUnitPrice,35000);
 assert.equal(fangCommunityPrice({...page,html:'龙岗区小区二手房 '+page.html},{...community,district:'龙华区',market:'sale'}),null);
 assert.equal(fangCommunityPrice({...page,url:'https://www.fang.com/xiaoqu/bj-123/'},{...community,market:'sale'}),null);
});
const card=(name,price='6500元/月')=>`<dl id="houseRow_1"><a href="https://sz.zu.fang.com/chuzu/3_123_1.htm">房源</a><p class="add_shop"><a>${name}</a></p><p class="tel_shop">整租 建筑面积141.07㎡</p><dd class="price_right">${price}</dd></dl>`;
test('房天下逐卡提取租金面积，不混入其他小区或售价',()=>{
 const page={url:'https://sz.esf.fang.com/loupan/2810026133/chuzu/list/',html:card('锦绣江南')+card('其他花园','9999元/月')};
 const rows=fangRentalCards(page,community);assert.equal(rows.length,1);assert.equal(rows[0].monthlyRent,6500);assert.equal(rows[0].area,141.07);
 assert.equal(fangRentalCards(page,{...community,name:'锦绣江南四期'}).length,0);
 assert.equal(fangRentalCards({...page,html:card('锦绣江南','6500万元')},community).length,0);
});
test('异地乐有家结果和住宅中的混合办公POI排除',()=>{
 assert.equal(rentalSiteMatch({url:'https://wuhan.leyoujia.com/xq/detail/104/'},{id:'leyoujia',domain:'leyoujia.com'}),false);
 assert.equal(rentalSiteMatch({url:'https://wap.leyoujia.com/shenzhen/xq/detail/104.html'},{id:'leyoujia',domain:'leyoujia.com'}),true);
 assert.equal(rentalCommunityEligible({...community,poiType:'商务住宅;商务住宅相关;商务写字楼'}),false);
});
