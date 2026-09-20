import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeGraphicsReport} from '../project-map/graphics-report.mjs';
const sample=(at,renderedFrames=at/100,extra={})=>({at,renderedFrames,hidden:false,heap:100,meshes:20,...extra});
test('wall clock delay cannot masquerade as one hour active rendering',()=>{const r=analyzeGraphicsReport({samples:[sample(0),sample(10000),sample(3600000)]});assert.equal(r.observedDurationPassed,false);assert.equal(r.activeMs,10000);assert.equal(r.gaps.length,1);});
test('hidden and lost contexts disqualify uninterrupted acceptance',()=>{for(const extra of [{samples:[sample(0),sample(10000,100,{hidden:true})]},{samples:[sample(0),sample(10000)],events:[{type:'lost'}]}])assert.equal(analyzeGraphicsReport(extra,{requiredMs:10000}).observedDurationPassed,false);});
test('continuous samples expose measured frames and heap without VRAM claims',()=>{const r=analyzeGraphicsReport({samples:[sample(0),sample(10000),sample(20000)]},{requiredMs:20000});assert.equal(r.observedDurationPassed,true);assert.equal(r.fps.median,10);assert.equal(r.heapBytes.max,100);});
