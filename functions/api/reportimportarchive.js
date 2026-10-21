// Private, immutable import backups. Originals and current projects are never replaced.
import {verifyAuth, json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {createSchemaInitializer} from './_schema-once.js';
const CHUNK=512*1024, MAX=128*1024*1024, OWNER_MAX=512*1024*1024;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const reply=(body,status=200)=>{const r=json(body,status);r.headers.set('Cache-Control','no-store');return r;};
const initialize=createSchemaInitializer([
 'CREATE TABLE IF NOT EXISTS report_import_archive_chunks(owner_id INTEGER NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(owner_id,hash))',
 'CREATE TABLE IF NOT EXISTS report_import_archives(owner_id INTEGER NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,size_bytes INTEGER NOT NULL,chunks_json TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(owner_id,id))',
 'CREATE TABLE IF NOT EXISTS report_import_archive_budgets(owner_id INTEGER PRIMARY KEY,used_bytes BIGINT NOT NULL)'
]);
async function ensure(DB){
 if(!DB)fail(503,'服务器尚未配置工作稿备份存储；本机资料仍保留');
 await initialize({DB});
}
async function storeChunk(DB,owner,input,bytes){
 // The account lock covers both quota reservation and insertion. Concurrent
 // SELECT SUM checks alone can each pass and exceed the account limit.
 if(typeof DB._transaction!=='function')fail(503,'当前云存储尚不支持安全分块写入；请保留完整本地备份');
 await DB._transaction(async tx=>{
  await tx.prepare('INSERT INTO report_import_archive_budgets(owner_id,used_bytes) SELECT ?,COALESCE(SUM(size_bytes),0) FROM report_import_archive_chunks WHERE owner_id=? ON CONFLICT(owner_id) DO NOTHING').bind(owner,owner).run();
  const budget=await tx.prepare('SELECT used_bytes FROM report_import_archive_budgets WHERE owner_id=? FOR UPDATE').bind(owner).first();
  const existing=await tx.prepare('SELECT data,size_bytes FROM report_import_archive_chunks WHERE owner_id=? AND hash=?').bind(owner,input.hash).first();
  if(existing){if(existing.data!==input.data||Number(existing.size_bytes)!==bytes.length)fail(409,'已有资料块校验异常，已阻止覆盖');return;}
  if(!budget||!Number.isSafeInteger(Number(budget.used_bytes))||Number(budget.used_bytes)<0)fail(503,'云备份额度记录异常，未写入资料');
  if(Number(budget.used_bytes)+bytes.length>OWNER_MAX)fail(413,'当前账号云备份已达512MiB，未删除任何备份；请下载完整备份保留');
  await tx.prepare('INSERT INTO report_import_archive_chunks(owner_id,hash,data,size_bytes,created_at) VALUES(?,?,?,?,?)').bind(owner,input.hash,input.data,bytes.length,Date.now()).run();
  await tx.prepare('UPDATE report_import_archive_budgets SET used_bytes=used_bytes+? WHERE owner_id=?').bind(bytes.length,owner).run();
 });
}
function decode(data){
 if(typeof data!=='string'||data.length>Math.ceil(CHUNK/3)*4||!data.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))fail(400,'备份资料块格式或大小不正确');
 const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>CHUNK)fail(413,'单个备份资料块超过512KiB');return bytes;
}
async function context(c){const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)fail(401,'请先登录后保存或读取云端备份');await ensure(env.DB);return {DB:env.DB,user};}
export async function onRequestPost(c){try{
 const {DB,user}=await context(c),raw=await c.request.text();if(raw.length>800000)fail(413,'备份上传包过大，请分块保存');let input;try{input=JSON.parse(raw);}catch{fail(400,'备份请求格式无效');}if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'备份请求格式无效');
 if(input.action==='chunk'){
  if(!hash(input.hash))fail(400,'缺少资料块校验值');const bytes=decode(input.data);if(await digest(bytes)!==input.hash)fail(400,'备份资料块校验失败，未保存');
  await storeChunk(DB,user.userId,input,bytes);return reply({ok:true,hash:input.hash,size:bytes.length});
 }
 if(input.action!=='publish'||!hash(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>200||typeof input.draftId!=='string'||!/^import_[a-f0-9]{32}$/.test(input.draftId)||!Number.isSafeInteger(input.revision)||input.revision<1||!Array.isArray(input.chunks)||!input.chunks.length||input.chunks.length>256||!input.chunks.every(hash)||!Number.isSafeInteger(input.size)||input.size<1||input.size>MAX)fail(400,'完整备份清单无效，未发布');
 const bytes=new Uint8Array(input.size);let offset=0;
 for(let i=0;i<input.chunks.length;i++){
  const id=input.chunks[i],row=await DB.prepare('SELECT data,size_bytes FROM report_import_archive_chunks WHERE owner_id=? AND hash=?').bind(user.userId,id).first();if(!row)fail(409,'备份尚未传齐，未标记保存成功；已有资料仍保留');
  const block=decode(row.data);if(block.length!==Number(row.size_bytes)||await digest(block)!==id||offset+block.length>bytes.length||i<input.chunks.length-1&&block.length!==CHUNK)fail(409,'备份资料块或顺序校验失败，未发布');bytes.set(block,offset);offset+=block.length;
 }
 if(offset!==bytes.length||await digest(bytes)!==input.id)fail(409,'完整备份校验失败，未发布');
 const chunks=JSON.stringify(input.chunks),now=Date.now();
 await DB.prepare('INSERT INTO report_import_archives(owner_id,id,title,draft_id,revision,size_bytes,chunks_json,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING').bind(user.userId,input.id,input.title,input.draftId,input.revision,input.size,chunks,now).run();
 const saved=await DB.prepare('SELECT * FROM report_import_archives WHERE owner_id=? AND id=?').bind(user.userId,input.id).first();
 if(saved.draft_id!==input.draftId||Number(saved.revision)!==input.revision||Number(saved.size_bytes)!==input.size||saved.chunks_json!==chunks||saved.title!==input.title)fail(409,'该备份已存在，但版本说明不同；未覆盖旧备份');
 return reply({ok:true,id:input.id,revision:Number(saved.revision),size:input.size,createdAt:Number(saved.created_at)});
 }catch(e){return reply({ok:false,error:e.status?e.message:'云备份保存未完成，已有本机稿和云备份均保留'},e.status||503);}}
export async function onRequestGet(c){try{
 const {DB,user}=await context(c),url=new URL(c.request.url),id=url.searchParams.get('id'),chunk=url.searchParams.get('chunk');
 if(!id){const result=await DB.prepare('SELECT id,title,draft_id,revision,size_bytes,created_at FROM report_import_archives WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').bind(user.userId).all();return reply({ok:true,items:result.results.map(r=>({id:r.id,title:r.title,draftId:r.draft_id,revision:Number(r.revision),size:Number(r.size_bytes),createdAt:Number(r.created_at)})),limit:100});}
 if(!hash(id))fail(400,'备份编号无效');const row=await DB.prepare('SELECT * FROM report_import_archives WHERE owner_id=? AND id=?').bind(user.userId,id).first();if(!row)fail(404,'备份不存在或不属于当前账号');const chunks=JSON.parse(row.chunks_json);
 if(!Array.isArray(chunks)||!chunks.length||chunks.length>256||!chunks.every(hash)||!Number.isSafeInteger(Number(row.size_bytes))||Number(row.size_bytes)<1||Number(row.size_bytes)>MAX)fail(409,'云备份清单损坏，未返回不完整副本');
 if(chunk!==null){const index=Number(chunk);if(!/^\d+$/.test(chunk)||!Number.isSafeInteger(index)||index<0||index>=chunks.length)fail(400,'资料块序号无效');const record=await DB.prepare('SELECT data,size_bytes FROM report_import_archive_chunks WHERE owner_id=? AND hash=?').bind(user.userId,chunks[index]).first();let bytes;try{bytes=record&&decode(record.data);}catch{fail(409,'云备份资料块缺失或损坏，未返回不完整副本');}if(!bytes||bytes.length!==Number(record.size_bytes)||await digest(bytes)!==chunks[index])fail(409,'云备份资料块缺失或损坏，未返回不完整副本');return reply({ok:true,hash:chunks[index],data:record.data,size:Number(record.size_bytes)});}
 return reply({ok:true,id:row.id,title:row.title,draftId:row.draft_id,revision:Number(row.revision),size:Number(row.size_bytes),createdAt:Number(row.created_at),chunks});
 }catch(e){return reply({ok:false,error:e.status?e.message:'云备份读取未完成，本机资料仍保留'},e.status||503);}}
