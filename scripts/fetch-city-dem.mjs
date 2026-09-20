// Pinned public DSM source used by the reference city. Never replaces valid inputs.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const destination=new URL('../outputs/city-dem-source/',import.meta.url);
const sources=[
 ['113',36641041,'074e13244e6da6745bcf76150fdc6e06f774140a7aac796785922fce962eacbb'],
 ['114',25030462,'b950ab75642d6684fe08c82b6aa3bb087c1d35acd229ef0e6e6586e1b0868fa3']
];
await mkdir(destination,{recursive:true});
for(const [longitude,bytes,sha256] of sources){
 const name=`Copernicus_DSM_COG_10_N22_00_E${longitude}_00_DEM`;
 const file=new URL(name+'.tif',destination);
 const valid=b=>b.length===bytes&&createHash('sha256').update(b).digest('hex')===sha256;
 try {const old=await readFile(file);if(!valid(old))throw Error('Existing file is not the pinned source; preserve and inspect: '+file);console.log(name+': verified existing');continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const url=`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
 console.log('Downloading '+url);
 const response=await fetch(url,{signal:AbortSignal.timeout(300000)});
 if(!response.ok)throw Error('DSM download HTTP '+response.status);
 const chunks=[];let received=0,last=-1;
 for await(const chunk of response.body){chunks.push(chunk);received+=chunk.length;if(received>bytes)throw Error('Unexpected DSM size');const percent=Math.floor(received/bytes*100);if(percent>=last+5){console.log(`${name}: ${percent}% (${received}/${bytes} bytes)`);last=percent;}}
 const result=Buffer.concat(chunks);if(!valid(result))throw Error('DSM source hash/length mismatch; not published');
 const temporary=new URL(name+'.verified-'+Date.now()+'.tmp',destination);
 await writeFile(temporary,result,{flag:'wx'});
 try {await stat(file);throw Error('Destination appeared during download; retained verified temporary file');}catch(e){if(e.code!=='ENOENT')throw e;}
 await rename(temporary,file);console.log('Verified: '+fileURLToPath(file));
}
console.log('Both pinned DSM tiles verified. Source data only; terrain is not yet built or deployed.');
