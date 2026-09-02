import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath,pathToFileURL } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const failures=[];
const check=(condition,message)=>{if(!condition)failures.push(message);};
const canonical=readJson("data/report-logic-gaibao-v1.json");
const runtimeModule=await import(pathToFileURL(path.join(root,"functions","api","_reportlogic-gaibao-seed.js")).href+"?gate="+Date.now());
const runtime=runtimeModule.default;
const canonicalText=JSON.stringify(canonical),runtimeText=JSON.stringify(runtime);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");

check(canonical.rules?.length===74,"Canonical 改造规则不是 74 条");
check(canonical.structure?.chapterCount===13,"Canonical 改造规则不是 13 章");
check(canonical.source?.authoritativeRows===74,"Canonical 权威行数元数据不是 74");
check(runtime.rules?.length===74,"Runtime Seed 改造规则不是 74 条");
check(runtime.structure?.chapterCount===13,"Runtime Seed 改造规则不是 13 章");
check(runtimeText===canonicalText,"Canonical JSON 与 Runtime Seed 内容不一致，请运行 npm run generate:reportlogic-seed");

const tables=[
  ["rent","data/report-table-templates-rent-v1.json",33,70],
  ["gaibao-housing","data/report-table-templates-gaibao-housing-v1.json",14,14],
  ["gaibao-commercial","data/report-table-templates-gaibao-commercial-v1.json",22,22]
];
for(const [type,file,logical,physical] of tables){
  const set=readJson(file),physicalCount=Number(set.source?.physicalTableCount||set.source?.totalPhysicalTables||set.templates?.flatMap(item=>item.sourceTableNumbers||[]).length||0);
  check(set.projectType===type,`${file} 项目类型串场景`);
  check(set.templates?.length===logical,`${file} 逻辑表数量应为 ${logical}`);
  check(physicalCount===physical,`${file} 源 Word 物理表数量应为 ${physical}`);
  check(new Set((set.templates||[]).map(item=>item.id)).size===logical,`${file} 存在重复表格 ID`);
}

const reportlogic=await import(pathToFileURL(path.join(root,"functions","api","reportlogic.js")).href+"?gate="+Date.now());
for(const name of ["validateSet","appendEnhancementData","mergeRuleRevisionData","evaluateRuleRevisionData","needsAuthoritativeBaseline","ensureSeeds"]){
  check(typeof reportlogic[name]==="function",`reportlogic.js 未导出 ${name}`);
}

const migration=fs.readFileSync(path.join(root,"migrations","0018_report_table_versions.sql"),"utf8");
check(/CREATE TABLE IF NOT EXISTS report_table_template_versions/i.test(migration),"表格版本迁移不能从空数据库初始化");
check(/reason TEXT/i.test(migration)&&/restored_from_version/i.test(migration),"表格回滚迁移缺少原因或来源版本字段");

if(failures.length){console.error("Release Consistency Gate 未通过：\n- "+failures.join("\n- "));process.exit(1);}
console.log(JSON.stringify({ok:true,ruleBaseline:{rules:74,chapters:13,baselineId:canonical.source.baselineId,sha256:hash(canonicalText)},tableBaselines:Object.fromEntries(tables.map(([type,,logical,physical])=>[type,{logical,physical}])),reportlogicExports:6,migration:"0018_report_table_versions.sql"},null,2));
