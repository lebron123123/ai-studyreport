const fs=require('node:fs'),D=require('../docx.umd.js'),build=require('../docxgen.js');
(async()=>{const payload=JSON.parse(fs.readFileSync('outputs/table-export-verification.json','utf8')).payload;
fs.writeFileSync('outputs/0908税务局可研_黑色文字核验.docx',await D.Packer.toBuffer(build(D,payload)));console.log('Word rebuilt from saved verified payload; no project data changed');})();
