import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {mergeHousingRevision} from '../functions/api/_reportlogic-scoped-migration.js';
import {validateSet,bumpLogicVersion,needsAuthoritativeBaseline} from '../functions/api/reportlogic.js';
const target=JSON.parse(fs.readFileSync('data/report-logic-gaibao-v1.json','utf8'));
const previous=JSON.parse(execFileSync('git',['show','HEAD:data/report-logic-gaibao-v1.json'],{encoding:'utf8'}));
const commercial=d=>d.rules.filter(r=>r.scenarios.includes('commercial_renovation')).map(r=>({...r,...r.scenarioVariants.commercial_renovation,scenarioVariants:undefined}));
test('V6只升级住房场景，商业场景与未涉及的自定义规则不变',()=>{
 assert.deepEqual(commercial(target),commercial(previous));
 const old=structuredClone(previous);old.rules.push({...structuredClone(old.rules[0]),id:'custom-rule'});
 const merged=mergeHousingRevision(old,target);
 assert.deepEqual(commercial(merged),commercial(old));
 assert.deepEqual(merged.rules.find(r=>r.id==='custom-rule'),old.rules.at(-1));
 assert.deepEqual(mergeHousingRevision(merged,target),merged);
 const normalized=validateSet(merged,'gaibao');
 bumpLogicVersion(normalized,previous,'gaibao','housing_conversion');
 assert.equal(normalized.logicVersions.housing_conversion,'3.0');
 assert.equal(needsAuthoritativeBaseline(JSON.stringify(normalized),target),false);
});
test('V6新增市场表格无示例数值且完整保留列结构',()=>{
 const data=JSON.parse(fs.readFileSync('data/report-table-templates-gaibao-housing-v1.json','utf8'));
 assert.equal(data.templates.length,26);
 for(const t of data.templates)for(const s of t.segments){
  assert.ok(s.rows.length>1);
  for(const row of s.rows)assert.equal(row.cells.reduce((sum,c)=>sum+c.colSpan,0),s.gridWidths.length);
  for(const row of s.rows.slice(1))for(const c of row.cells.filter(c=>c.role==='value'))assert.equal(c.text,'');
 }
});

test('V6修正表保留原八列、三行案例及合并汇总结论；所有明细不再只有一行',()=>{
 const data=JSON.parse(fs.readFileSync('data/report-table-templates-gaibao-housing-v1.json','utf8'));
 const table=data.templates.find(t=>t.id.endsWith('-24')),s=table.segments[0];
 assert.deepEqual(s.rows[0].cells.map(c=>c.text),['比较案例','租金单价（元/㎡·月）','交通配套修正','外部环境修正','新旧程度修正','装修家私修正','修正价格（元/㎡·月）','比较权重']);
 assert.equal(s.rows.length,6);
 assert.ok(s.rows[4].cells.some(c=>c.colSpan>1&&c.text.includes('比较权重')));
 assert.equal(s.rows[5].cells[0].colSpan,8);
 assert.ok(!JSON.stringify(table).includes('32元'));
 for(const t of data.templates)for(const segment of t.segments){
   assert.ok(segment.rows.length>=5,t.id);
   for(const row of segment.rows)assert.equal(row.cells.reduce((sum,c)=>sum+c.colSpan,0),segment.gridWidths.length,t.id);
 }
});

test('源Word结构快照与实际表库保持一致，新增文字表不伪称源表',()=>{
 const data=JSON.parse(fs.readFileSync('data/report-table-templates-gaibao-housing-v1.json','utf8'));
 const schemas=JSON.parse(fs.readFileSync('data/report-table-housing-v6-source-schemas.json','utf8'));
 for(const source of schemas.templates)assert.deepEqual(data.templates.find(t=>t.id===source.id).segments,source.segments);
 assert.equal(data.source.physicalTableCount,21);
 assert.equal(data.templates.filter(t=>!t.sourceTableNumbers.length).length,5);
});

test('市场子节编号不吞入标题数字，逻辑分工不再整节重复',()=>{
 const rules=target.rules.filter(r=>r.scenarios.includes('housing_conversion')).map(r=>({...r,...r.scenarioVariants.housing_conversion}));
 const competitor=rules.find(r=>r.id==='gaibao-v1-076'),pricing=rules.find(r=>r.id==='gaibao-v1-077');
 assert.equal(competitor.subsection,'3.6.2 3公里范围内竞品分析');
 assert.ok(!competitor.writingLogic.includes('需要表格：散租'));
 assert.ok(!pricing.writingLogic.includes('需要表格：散租'));
});
