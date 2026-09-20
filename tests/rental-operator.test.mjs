import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorOffers,operatorUrl} from '../functions/api/_rental-operator.js';
import {rentalPriced} from '../project-map/rental-identity.mjs';
import {competitorRows,rentalUnitPrice} from '../project-map/competitor-core.mjs';
import {rentalStatistics} from '../project-map/rental-core.mjs';
const c={name:'寓见安居·未来之光',district:'宝安区',kind:'住宅',point:[113.906,22.59]};
test('operator ranges remain unpaired; no false unit price or market statistic',()=>{
 const html='<li><a href="/room-type/detail?id=abc-123">寓见安居|宝安-未来之光 一房一厅 面积: 约52-57m<sup>2</sup> 3855-4474元/月起</a></li>';
 const rows=operatorOffers({url:operatorUrl,html},c);assert.equal(rows.length,1);
 assert.equal(rentalPriced(rows[0]),true);assert.equal(rentalUnitPrice(rows[0]),null);
 assert.equal(rentalStatistics(rows).count,0);
 const group=competitorRows([['租金',{items:rows}]])[0];assert.match(group.rent,/3855–4474/);assert.match(group.examples.at(-1),/不折算/);
 assert.deepEqual(operatorOffers({url:operatorUrl,html},{...c,market:'sale'}),[]);
 assert.deepEqual(operatorOffers({url:operatorUrl,html},{...c,district:'福田区'}),[]);
 assert.deepEqual(operatorOffers({url:operatorUrl,html:html.replace('3855-4474','4474-3855')},c),[]);
});
