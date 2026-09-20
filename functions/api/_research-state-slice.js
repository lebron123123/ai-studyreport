// Read-only building block. Caller must authorize the research/run in its
// transaction. A slice is never a complete state and must not enter full-save.
import {referencedObjects,selectManifestPath,unpackState} from '../../research-state-codec.mjs';
export async function readStoredSlice(db,row,path){
 if(!Array.isArray(path)||!path.length||path.length>20||path.some(key=>!(typeof key==='string'&&key.length<=200)&&!(Number.isSafeInteger(key)&&key>=0)))throw new Error('读取路径无效');
 const stored=JSON.parse(row.state_json);
 if(stored?.storageFormat!=='research-parts-v1'){
  let value=stored;
  for(const key of path){
   if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return {found:false};
   value=value[key];
  }
  return {found:true,value};
 }
 const selected=selectManifestPath(stored.manifest,path);
 if(!selected.found)return {found:false};
 const node=selected.manifest;
 const ids=[...referencedObjects(node)],objects=new Map();
 for(let start=0;start<ids.length;start+=200){
  const batch=ids.slice(start,start+200);
  const result=await db.prepare('SELECT digest,content FROM research_state_objects WHERE research_id=? AND run_id=? AND digest IN ('+batch.map(()=>'?').join(',')+')').bind(row.research_id,row.id,...batch).all();
  for(const item of result.results)objects.set(item.digest,item.content);
 }
 return {found:true,value:unpackState(node,objects)};
}
