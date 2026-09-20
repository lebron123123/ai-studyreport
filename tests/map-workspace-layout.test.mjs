import test from 'node:test';
import assert from 'node:assert/strict';
import {addressDistrict} from '../project-map/workspace-layout.mjs';
test('district uses explicit address, prioritizes special districts and never invents a location',()=>{
 assert.equal(addressDistrict('广东省深圳市南山区科苑路'),'南山区');
 assert.equal(addressDistrict('深圳市龙岗区大鹏新区葵涌'),'大鹏新区');
 assert.equal(addressDistrict('东莞市凤岗镇'),'东莞市');
 assert.equal(addressDistrict('深圳市安居某苑'),'分区待核实');
 assert.equal(addressDistrict(),'分区待核实');
});
