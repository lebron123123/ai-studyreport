/* Persistent preference learning from accept/reject/undo/lock decisions. */
(function(root){
  "use strict";
  const STORAGE_KEY="ai_ppt_design_preferences_v2",memory={};
  function load(){try{if(root.localStorage){const raw=JSON.parse(root.localStorage.getItem(STORAGE_KEY)||"{}");Object.assign(memory,raw&&typeof raw==="object"?raw:{});}}catch(e){}}
  function persist(){try{if(root.localStorage)root.localStorage.setItem(STORAGE_KEY,JSON.stringify(memory));}catch(e){}}
  load();
  const key=(userId="default",department="default")=>userId+"::"+department;
  function state(userId,department){const k=key(userId,department);return memory[k]||(memory[k]={version:2,events:[],weights:{strategy:{},composition:{},component:{},template:{}},updatedAt:0});}
  function record(event={},context={}){const s=state(context.userId,context.department),action=["accept","reject","undo","lock"].includes(event.action)?event.action:"accept",delta=action==="accept"?2:action==="lock"?1:action==="reject"?-2:-1;[["strategy",event.strategyId],["composition",event.compositionId],["component",event.componentId],["template",event.templateId]].forEach(([type,id])=>{if(id)s.weights[type][id]=(s.weights[type][id]||0)+delta;});s.events.push({...event,action,at:Number(event.at)||Date.now()});s.events=s.events.slice(-500);s.updatedAt=Date.now();persist();return snapshot(context.userId,context.department);}
  function adjustment(type,id,context={}){return Math.max(-15,Math.min(15,(state(context.userId,context.department).weights[type]||{})[id]||0));}
  function preferred(type,ids=[],context={}){return ids.slice().sort((a,b)=>adjustment(type,b,context)-adjustment(type,a,context));}
  function snapshot(userId,department){const s=state(userId,department);return JSON.parse(JSON.stringify({...s,eventCount:s.events.length,persistent:!!root.localStorage}));}
  function exportProfile(userId,department){return{schema:"ppt-design-preferences",...snapshot(userId,department),exportedAt:Date.now()};}
  function importProfile(profile={},userId,department){if(!profile||typeof profile!=="object")return snapshot(userId,department);memory[key(userId,department)]={version:2,events:Array.isArray(profile.events)?profile.events.slice(-500):[],weights:profile.weights||{strategy:{},composition:{},component:{},template:{}},updatedAt:Date.now()};persist();return snapshot(userId,department);}
  function clear(userId,department){delete memory[key(userId,department)];persist();}
  const api={record,adjustment,preferred,snapshot,exportProfile,importProfile,clear,storageKey:STORAGE_KEY};root.PptDesignLearning=api;if(root.document)root.document.documentElement.dataset.pptDesignLearning="persistent-v2";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
