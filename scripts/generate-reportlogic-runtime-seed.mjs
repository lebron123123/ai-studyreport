import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sets=[
  {name:"出租",canonical:"data/report-logic-rent-v1.json",runtime:"functions/api/_reportlogic-seed.js",rules:137,chapters:14},
  {name:"改造",canonical:"data/report-logic-gaibao-v1.json",runtime:"functions/api/_reportlogic-gaibao-seed.js",rules:74,chapters:13}
];

for(const set of sets){
  const canonical=JSON.parse(fs.readFileSync(path.join(root,set.canonical),"utf8"));
  if(canonical.rules?.length!==set.rules||canonical.structure?.chapterCount!==set.chapters){
    throw new Error(`Canonical ${set.name}规则必须保持 ${set.rules} 条/${set.chapters} 章，拒绝生成 Runtime Seed`);
  }
  const serialized=JSON.stringify(canonical,null,2);
  fs.writeFileSync(path.join(root,set.runtime),"// 由 scripts/generate-reportlogic-runtime-seed.mjs 从 Canonical JSON 自动生成，请勿手工改写。\nexport default "+serialized+";\n","utf8");
  console.log(`已生成 ${set.name} Runtime Seed：${canonical.rules.length} 条/${canonical.structure.chapterCount} 章`);
}
