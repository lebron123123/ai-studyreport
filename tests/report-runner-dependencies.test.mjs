import test from 'node:test';
import assert from 'node:assert/strict';
import {incompleteDetailSections} from '../scripts/report-full-generation-runner.mjs';

test('汇总屏障不把已保存的待修正文当作本轮核验通过',()=>{
  const rows=[
    {key:'tax',number:'2.1',summary:false,hasBody:true},
    {key:'tax',number:'2.2',summary:false,hasBody:true},
    {key:'tax',number:'2.3',summary:false,hasBody:false},
    {key:'tax',number:'1.2',summary:true,hasBody:false},
    {key:'longgang',number:'2.1',summary:false,hasBody:false},
  ];
  const checkpoint={sections:{
    'tax:2.1':{status:'failed',error:{code:'semantic-blocked'}},
    'tax:2.2':{status:'running'},
    'tax:2.3':{status:'passed'},
  }};
  const before=structuredClone({rows,checkpoint});
  assert.deepEqual(incompleteDetailSections(rows,checkpoint,'tax').map(r=>r.number),['2.1','2.2']);
  assert.deepEqual({rows,checkpoint},before);
});

test('没有本轮检查记录的旧正文继续阻断，仅明确passed解除屏障',()=>{
  const row={key:'tax',number:'8.2',summary:false,hasBody:true};
  for(const checkpoint of [{},{sections:{}},{sections:{'tax:8.2':{status:'unverified'}}},{sections:{'tax:8.2':{status:'dependency-blocked'}}}]){
    assert.deepEqual(incompleteDetailSections([row],checkpoint,'tax'),[row]);
  }
  assert.deepEqual(incompleteDetailSections([row],{sections:{'tax:8.2':{status:'passed'}}},'tax'),[]);
});

test('项目间屏障隔离，总结小节本身不计作明细依赖',()=>{
  const rows=[
    {key:'tax',number:'2.1',summary:false},
    {key:'tax',number:'1.2',summary:true},
    {key:'longgang',number:'2.1',summary:false},
  ];
  const checkpoint={sections:{'tax:2.1':{status:'passed'}}};
  assert.deepEqual(incompleteDetailSections(rows,checkpoint,'tax'),[]);
  assert.deepEqual(incompleteDetailSections(rows,checkpoint,'longgang'),[rows[2]]);
});
