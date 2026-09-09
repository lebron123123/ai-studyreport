const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../docx.umd.js');
const build=require('../docxgen.js');
test('Word report runs are black while pending warnings and content remain',async()=>{
 const document=build(D,{project:{name:'黑色文字核验'},chapters:[{cn:'一',name:'市场分析',sections:[{title:'3.1 宏观环境',blocks:[{type:'h',text:'3.1.1 小结',level:3},{type:'p',text:'正文【待补：来源】'},{type:'table',rows:[['指标','数值'],['金额','待补']]},{type:'p',text:'来源：测试'}]}]}]});
 const files=await D.Packer.toBuffer(document);
 assert.ok(files.length>1000);
 // Read packed ZIP entries so the assertion covers serialized Word parts.
 const parts=[];
 for(let i=0;i<files.length-46;i++){
  if(files.readUInt32LE(i)!==0x02014b50)continue;
  const len=files.readUInt16LE(i+28),name=files.subarray(i+46,i+46+len).toString();
  if(!/^word\/(document|styles|header\d*|footer\d*)\.xml$/.test(name))continue;
  const offset=files.readUInt32LE(i+42),size=files.readUInt32LE(i+20);
  const start=offset+30+files.readUInt16LE(offset+26)+files.readUInt16LE(offset+28);
  const data=files.subarray(start,start+size);
  parts.push((files.readUInt16LE(i+10)===8?require('node:zlib').inflateRawSync(data):data).toString());
 }
 const encoded=parts.join('\n');
 const colors=[...encoded.matchAll(/<w:color\b[^>]*w:val="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(colors.length>10);
 assert.ok(colors.every(c=>c==='000000'),JSON.stringify([...new Set(colors)]));
 assert.match(encoded,/待补/);
});
