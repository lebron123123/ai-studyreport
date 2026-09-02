import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const canonicalPath=path.join(root,"data","report-logic-gaibao-v1.json");
const runtimePath=path.join(root,"functions","api","_reportlogic-gaibao-seed.js");
const canonical=JSON.parse(fs.readFileSync(canonicalPath,"utf8"));
if(canonical.rules?.length!==74||canonical.structure?.chapterCount!==13)throw new Error("Canonical 改造规则必须保持 74 条/13 章，拒绝生成 Runtime Seed");
const serialized=JSON.stringify(canonical,null,2);
fs.writeFileSync(runtimePath,"// 由 scripts/generate-reportlogic-runtime-seed.mjs 从 Canonical JSON 自动生成，请勿手工改写。\nexport default "+serialized+";\n","utf8");
console.log(`已从 Canonical JSON 生成 Runtime Seed：${canonical.rules.length} 条/${canonical.structure.chapterCount} 章`);
