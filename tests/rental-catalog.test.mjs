import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogEntry,rentalCards,crawlCatalog} from '../functions/api/_rental-catalog.js';
import {collectRentalCommunity} from '../functions/api/_rental-collect.js';
import {rentalPageText} from '../functions/api/_rental-crawler.js';
const community={name:'纯海岸雅居',district:'南山区',kind:'住宅',point:[113.947,22.525]};
const card=(name='纯海岸',id='abc')=>`<li class="item clearfix"><a href="/zf/detail/${id}">房源</a><p class="tit">85.43㎡</p><p class="attr">${name} | 普通住宅 | 建筑面积85.43㎡</p><p class="sup"><span class="salePrice">13000</span>元/月</p><p>整租</p></li>`;
test('公开目录仅使用明确别名、区和类型匹配',()=>{
 assert.ok(catalogEntry(community));
 for(const change of [{district:'福田区'},{name:'纯海岸附近'},{kind:'办公'}])assert.equal(catalogEntry({...community,...change}),null);
});
test('按房源卡提取，不混入推荐价格、重复标题面积、二手房或同名链接',()=>{
 const rows=rentalCards(card()+card()+card('其他花园','other')+'<aside>附近租金2000元/月20㎡</aside>'+card().replaceAll('/zf/','/esf/'),community,catalogEntry(community));
 assert.equal(rows.length,1);assert.equal(rows[0].area,85.43);assert.equal(rows[0].monthlyRent,13000);assert.equal(rows[0].status,'candidate');
});
test('交叉搜索失败不丢弃独立爬虫证据；入口变化不推测网址',async()=>{
 const crawler=async url=>({html:url.endsWith('.html')?'<span data-href="/xq/detail/zf/1199">小区租房</span>':card(),text:'真实卡片'});
 const result=await collectRentalCommunity({},community,'crawler',{crawler,search:()=>{throw Error('不得调用搜索');}});
 assert.equal(result.rows.length,1);
 assert.ok(result.errors.length);
 await assert.rejects(crawlCatalog(community,async()=>({html:'<a href="https://evil.test/">小区租房</a>'})),/入口发生变化/);
 await assert.rejects(crawlCatalog(community,async()=>({html:'没有入口'})),/未提供/);
});
test('普通页面引用验证脚本不误判，但可见验证页仍阻止',()=>{
 assert.equal(rentalPageText('<script src="captcha.js"></script><p>公开房源</p>'),'公开房源');
 assert.throws(()=>rentalPageText('<h1>请完成人机验证</h1>'),/未绕过/);
});
