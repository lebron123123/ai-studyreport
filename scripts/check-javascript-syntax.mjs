import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const excluded=new Set([".git","node_modules","outputs","local-data",".tmp",".dsh-filess"]),files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(excluded.has(entry.name))continue;const full=path.join(dir,entry.name);if(entry.isDirectory()){if(full===path.join(root,"tools","vendor"))continue;walk(full);}else if(/\.(?:js|mjs|cjs)$/i.test(entry.name))files.push(full);}}
walk(root);
for(const file of files){const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(result.status!==0){process.stderr.write(result.stderr||result.stdout);process.exit(result.status||1);}}
console.log(`JavaScript 语法检查通过：${files.length} 个文件`);
