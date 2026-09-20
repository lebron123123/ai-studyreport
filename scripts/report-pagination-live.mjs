import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const require=createRequire(import.meta.url),D=require('../docx.umd.js'),build=require('../docxgen.js');
const db=createD1Shim(process.env.DATABASE_URL);
try{
 const user=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const headers={authorization:'Bearer '+await signToken(process.env,user.id,user.username),'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 const endpoint='http://localhost:8080/api/report-pagination';
 const unauthorized=await fetch(endpoint,{method:'POST',body:'test'});assert.equal(unauthorized.status,401);console.log('未登录拒绝：通过');
 for(const file of ['通用报告规则核验.docx','已有报告排版核验.docx']){
  const bytes=await fs.readFile('outputs/report-output-qa/'+file),response=await fetch(endpoint,{method:'POST',headers,body:bytes,signal:AbortSignal.timeout(75000)}),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.ok(data.pages<=120);console.log(file+': '+JSON.stringify(data));
 }
 const long=await D.Packer.toBuffer(build(D,{project:{name:'[系统测试]超限拦截'},chapters:Array.from({length:121},(_,i)=>({cn:String(i+1),name:'测试章',sections:[]}))}));
 const response=await fetch(endpoint,{method:'POST',headers,body:long,signal:AbortSignal.timeout(75000)}),data=await response.json();
 assert.equal(response.status,422,JSON.stringify(data));assert.ok(data.pages>120);console.log('实际长稿拦截：'+JSON.stringify(data));
 const invalid=await fetch(endpoint,{method:'POST',headers,body:'invalid-docx'});assert.equal(invalid.status,503);console.log('无效文件不误放行：通过');
}finally{await db._close();}
