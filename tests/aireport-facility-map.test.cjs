const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('aireport.js','utf8');
const fn=source.slice(source.indexOf('async function airConfirmLocation(){'),source.indexOf('async function airSkipLocation(){'));
test('confirmed primary opens companion map without awaiting it or blocking survey',async()=>{
 const calls=[],context={aiReportSiteSearches:[{name:'测试项目',role:'primary',candidates:[{location:'114,22.6'}]}],document:{querySelector:()=>({value:'0'})},project:{},aiReportChat:[],airPush:()=>{},airSetBusy:()=>{},airSaveState:()=>{},openProjectCityMap:p=>{calls.push(['map',p.location]);return new Promise(()=>{});},airRunSurvey:async p=>calls.push(['survey',p.location]),airRunSecondarySurveys:async()=>{},airRunSuggest:async()=>calls.push(['suggest']),alert:()=>{},confirm:()=>true};
 vm.createContext(context);vm.runInContext(fn,context);await context.airConfirmLocation();
 assert.deepEqual(calls,[['map','114,22.6'],['survey','114,22.6'],['suggest']]);
 context.aiReportSiteSearches=[];calls.length=0;await context.airConfirmLocation();assert.deepEqual(calls,[['suggest']]);
});
