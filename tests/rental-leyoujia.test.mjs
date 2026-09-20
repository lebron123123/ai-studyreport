import test from 'node:test';
import assert from 'node:assert/strict';
import {leyoujiaCommunityPage,leyoujiaCommunityCandidate} from '../functions/api/_rental-leyoujia.js';
test('小区租售目录归一为待验证首页，不接受外市或任意链接',()=>{
 for(const path of ['849921.html','esf/849921/','zf/849921/'])assert.equal(leyoujiaCommunityCandidate('https://shenzhen.leyoujia.com/xq/detail/'+path),'https://shenzhen.leyoujia.com/xq/detail/849921.html');
 for(const url of ['https://wuxi.leyoujia.com/xq/detail/849921.html','https://shenzhen.leyoujia.com/esf/detail/849921.html','http://shenzhen.leyoujia.com/xq/detail/849921.html'])assert.equal(leyoujiaCommunityCandidate(url),null);
});
const c={name:'万科未来之光家园',district:'宝安区',kind:'住宅',market:'sale',point:[113.906,22.592]};
const p={url:'https://shenzhen.leyoujia.com/xq/detail/885641.html',html:'<title>深圳未来之光家园小区详情-二手房-租房</title>',text:'未来之光家园 在售均价 74884 元/㎡ 深圳房产资讯 推荐小区 在售均价 10000 元/㎡'};
test('小区主价格不受导航租金字样及推荐价格干扰，明确别名有效',()=>{
 const rows=leyoujiaCommunityPage(p,c).rows;assert.equal(rows.length,1);assert.equal(rows[0].saleUnitPrice,74884);assert.equal(rows[0].community,c.name);
 assert.equal(leyoujiaCommunityPage({...p,html:'<title>其他小区详情</title>'},c),null);
 assert.deepEqual(leyoujiaCommunityPage({...p,text:'深圳房产资讯 在售均价 10000 元/㎡'},c).rows,[]);
 assert.equal(leyoujiaCommunityPage(p,{...c,name:'寓见安居·未来之光'}),null);
});
