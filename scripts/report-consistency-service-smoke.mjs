// Local-only final-runtime smoke. No formal project writes or full report generation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';

if(!process.argv.includes('--run'))throw Error('Pass --run for one tiny real model request on localhost:8080');
const db=createD1Shim(process.env.DATABASE_URL);
const username='[系统测试]报告一致性服务冒烟-'+randomUUID();
const base='http://localhost:8080';
const require=createRequire(import.meta.url),D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
let userId;
const evidence={formalProjectWrites:0,fullReportCalls:0,checks:[]};
try{
  await db.prepare('INSERT INTO users(username,pass_hash,salt,created_at,department,clearance) VALUES(?,?,?,?,?,?)')
    .bind(username,'disabled-password-no-valid-hash',randomUUID(),Date.now(),'[系统测试]',1).run();
  userId=Number((await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);
  const token=await signToken(process.env,userId,username);
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  async function request(path,body){
    const start=Date.now();
    const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(60000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    const value=await response.json();
    assert.equal(response.status,200,path+' HTTP '+response.status);
    return {value,ms:Date.now()-start};
  }
  const site=await fetch(base,{signal:AbortSignal.timeout(15000)});
  assert.equal(site.status,200);assert.match(await site.text(),/report-length-ui\.js/);
  evidence.checks.push({name:'site',status:200});
  if(!process.argv.includes('--word-only')){
  const projects=await request('/api/projects');
  assert.equal(projects.value.ok,true);assert.deepEqual(projects.value.list,[]);
  evidence.checks.push({name:'isolated-projects',status:200,ms:projects.ms,count:0});
  const rag=await request('/api/rag',{action:'query',query:'保障性租赁住房',topK:2});
  assert.equal(rag.value.ok,true);assert.ok(rag.value.matches?.length>0);
  assert.ok(rag.value.matches.every(item=>String(item.text||item.metadata?.text||'').trim()));
  evidence.checks.push({name:'rag-real-text',status:200,ms:rag.ms,count:rag.value.matches.length});
  const generated=await request('/api/generate',{kind:'chat',system:'只输出用户要求的短句，不作解释。',messages:[{role:'user',content:'请只回复：测试通过'}],stream:false,max_tokens:200});
  const text=(generated.value.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('');
  assert.match(text,/测试通过/);
  evidence.checks.push({name:'real-generate',status:200,ms:generated.ms,text,usage:generated.value.usage,provider:generated.value.provider});
  }
  const sample=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]当前模板真实下载验收'},chapters:[{cn:'一',name:'运营方案',sections:[{title:'运营安排',blocks:[
    ...[3,4,5,6].map(level=>({type:'h',level,text:'层级'+level+'：运营责任'})),
    {type:'list',ordered:true,start:3,items:['收楼20%，运营15.7%。','项目保留60%收益；总面积5000㎡。']},
    {type:'p',text:'【待补：合同】'}
  ]}]}]}));
  const start=Date.now();
  const pagination=await fetch(base+'/api/report-pagination',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',accept:'multipart/form-data'},body:sample,signal:AbortSignal.timeout(60000)});
  assert.equal(pagination.status,200);
  const parts=await pagination.formData(),paginated=JSON.parse(parts.get('receipt')),prepared=Buffer.from(await parts.get('document').arrayBuffer());
  assert.equal(pagination.status,200);assert.equal(paginated.ok,true);assert.ok(Number.isInteger(paginated.pages)&&paginated.pages>0);
  assert.equal(paginated.receipt.versionsMatch,true);assert.equal(paginated.receipt.tocUpdated,true);
  assert.equal(paginated.receipt.preparedDocumentSha256,createHash('sha256').update(prepared).digest('hex'));
  assert.ok(paginated.toc.entries>0);
  const zip=await JSZip.loadAsync(prepared),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string'),numbering=await zip.file('word/numbering.xml').async('string');
  const headingLevels=[];
  for(const style of styles.match(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)||[]){
    const id=style.match(/w:styleId="([^"]+)"/)?.[1],outline=style.match(/w:outlineLvl\b[^>]*w:val="(\d+)"/)?.[1];
    if(id&&outline!==undefined&&xml.includes('w:pStyle w:val="'+id+'"'))headingLevels.push(Number(outline)+1);
  }
  for(const level of [3,4,5,6])assert.ok(headingLevels.includes(level),'Missing semantic heading level '+level);
  assert.ok(xml.includes('w:numPr'));assert.ok(numbering.includes('w:abstractNum'));
  for(const fact of ['20%','15.7%','60%','5000㎡','【待补：合同】'])assert.ok(xml.includes(fact),'Missing unchanged fact '+fact);
  evidence.checks.push({name:'actual-word-download-small-sample',status:200,ms:Date.now()-start,pages:paginated.pages,renderer:paginated.renderer,template:paginated.receipt.templateVersion,tocEntries:paginated.toc.entries,headingLevels,trueNumbering:true,hashMatches:true});
}finally{
  if(userId){
    // Only this unique test identity and its private counters are removed. Global billed usage stays.
    await db.prepare('DELETE FROM usage_counters WHERE ckey LIKE ?').bind('u:%:'+userId+':%').run();
    await db.prepare('DELETE FROM account_security WHERE user_id=?').bind(userId).run();
    await db.prepare('DELETE FROM users WHERE id=? AND username=?').bind(userId,username).run();
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').bind(userId).first()).n),0);
    evidence.testIdentityCleaned=true;
  }
  await db._close();
  console.log(JSON.stringify(evidence));
}
