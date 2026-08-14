const test=require('node:test');
const assert=require('node:assert/strict');
const Providers=require('../analysis-providers.js');

test('Excel Provider保留文件、版本、工作簿、Sheet与单元格溯源',()=>{
  const r=Providers.normalize('observation',[{指标键:'resident_population',圈层km:3,数值:12000,__cellAddress:'A2:H2'}],{sourceAssetId:'asset-1',sourceVersionId:'v-2',workbookId:'wb-3',sheetName:'人口表',sourceLabel:'正式人口资料.xlsx'});
  assert.equal(r.ok,true);assert.equal(r.rows[0].cellAddress,'A2:H2');assert.equal(r.rows[0].sourceVersionId,'v-2');assert.equal(r.rows[0].sheetName,'人口表');
});

test('Provider拒绝缺少核心字段的POI和OD行',()=>{
  const p=Providers.normalize('poi',[{名称:'地铁站',分类键:'transport'}],{});
  const o=Providers.normalize('od',[{来源地:'A',人数:30}],{});
  assert.equal(p.ok,false);assert.match(p.errors[0].message,/longitude/);assert.equal(o.ok,false);assert.match(o.errors[0].message,/destinationName/);
});

test('未来外部数据Provider只预留契约且默认禁用',()=>{
  assert.equal(Providers.providers.future_external_api.online,true);
  assert.equal(Providers.providers.future_external_api.enabled,false);
});
