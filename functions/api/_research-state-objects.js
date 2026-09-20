import {unpackState,referencedObjects} from '../../research-state-codec.mjs';
const format='research-parts-v1';
export async function readStoredState(db,row) {
 const stored=JSON.parse(row.state_json);
 if(stored?.storageFormat!==format)return stored;
 const ids=[...referencedObjects(stored.manifest)],objects=new Map();
 for(let start=0;start<ids.length;start+=200){
  const batch=ids.slice(start,start+200);
  const result=await db.prepare('SELECT digest,content FROM research_state_objects WHERE research_id=? AND run_id=? AND digest IN ('+batch.map(()=>'?').join(',')+')').bind(row.research_id,row.id,...batch).all();
  for(const r of result.results)objects.set(r.digest,r.content);
 }
 return unpackState(stored.manifest,objects);
}
export function storedObjectIds(row){
 const stored=JSON.parse(row.state_json);
 return stored?.storageFormat===format?[...referencedObjects(stored.manifest)]:[];
}
export async function storePackedState(db,row,packed){
 await storeObjects(db,row,packed.objects);
 const stored=JSON.stringify({storageFormat:format,manifest:packed.manifest});
 await readStoredState(db,{...row,state_json:stored});
 return stored;
}
export async function storeObjects(db,row,objects){
 const packed={objects};
 if(!packed||!Array.isArray(packed.objects)||packed.objects.length>10000)throw new Error('草稿资料块格式无效');
 for(const entry of packed.objects){
  if(!Array.isArray(entry)||entry.length!==2||typeof entry[1]!=='string')throw new Error('草稿资料块格式无效');
  const [digest,content]=entry;
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==digest)throw new Error('草稿资料块校验失败');
  await db.prepare('INSERT INTO research_state_objects(research_id,run_id,digest,content,created_at) VALUES(?,?,?,?,?) ON CONFLICT(research_id,run_id,digest) DO NOTHING').bind(row.research_id,row.id,digest,content,Date.now()).run();
 }
}
