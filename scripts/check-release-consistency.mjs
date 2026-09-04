import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath,pathToFileURL } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const failures=[];
const check=(condition,message)=>{if(!condition)failures.push(message);};
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const fileHash=relative=>hash(fs.readFileSync(path.join(root,relative)));
const logicSets=[
  ["rent","data/report-logic-rent-v1.json","functions/api/_reportlogic-seed.js",137,14],
  ["gaibao","data/report-logic-gaibao-v1.json","functions/api/_reportlogic-gaibao-seed.js",74,13]
];
for(const [name,canonicalFile,runtimeFile,rules,chapters] of logicSets){
  const canonical=readJson(canonicalFile);
  const runtime=(await import(pathToFileURL(path.join(root,runtimeFile)).href+"?gate="+Date.now())).default;
  check(canonical.rules?.length===rules,`Canonical ${name} 规则不是 ${rules} 条`);
  check(canonical.structure?.chapterCount===chapters,`Canonical ${name} 规则不是 ${chapters} 章`);
  check(canonical.source?.authoritativeRows===rules,`Canonical ${name} 权威行数元数据不是 ${rules}`);
  check(JSON.stringify(runtime)===JSON.stringify(canonical),`${name} Canonical JSON 与 Runtime Seed 不一致，请运行 npm run generate:reportlogic-seed`);
}

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

const manifest=readJson("data/release-manifest-v1.json");
const runtimeManifest=(await import(pathToFileURL(path.join(root,"functions","api","_release-manifest.js")).href+"?gate="+Date.now())).default;
check(JSON.stringify(manifest)===JSON.stringify(runtimeManifest),"Release Manifest JSON 与 Runtime 版本不一致");
for(const [name,canonicalFile,,rules,chapters] of logicSets){
  const item=manifest.reportLogic?.[name];
  check(item?.rules===rules&&item?.chapters===chapters,`Release Manifest 的 ${name} 规则计数不正确`);
  check(item?.canonicalSha256===fileHash(canonicalFile),`Release Manifest 的 ${name} 规则哈希已过期`);
}
for(const [name,file] of [["rent","data/report-table-templates-rent-v1.json"],["gaibaoHousing","data/report-table-templates-gaibao-housing-v1.json"],["gaibaoCommercial","data/report-table-templates-gaibao-commercial-v1.json"]]){
  const source=readJson(file),item=manifest.reportTables?.[name];
  check(item?.templates===source.templates.length&&item?.fileSha256===fileHash(file),`Release Manifest 的 ${name} 表格模板已过期`);
}
const migrationFiles=fs.readdirSync(path.join(root,"migrations")).filter(x=>x.endsWith(".sql")).sort();
check(manifest.migrations?.count===migrationFiles.length,"Release Manifest 的迁移数量已过期");
check(manifest.migrations?.latest===migrationFiles.at(-1),"Release Manifest 的最新迁移已过期");
check(manifest.migrations?.orderedListSha256===hash(migrationFiles.join("\n")),"Release Manifest 的迁移顺序哈希已过期");
for(const [role,file] of [["training","data/report-golden-tax-v2-training.json"],["holdout","data/report-golden-longyue-holdout.json"]]){
  const sample=readJson(file),registered=manifest.evaluation?.[role];
  check(sample.datasetRole===role,`${file} 未保持 ${role} 隔离`);
  check(registered?.datasetRole===role&&registered?.fileSha256===fileHash(file),`Release Manifest 的 ${role} 样本已过期`);
}
check(readJson("data/report-golden-tax-v2-training.json").approvalStatus==="phase_draft_not_manager_approved","税务局阶段稿不得误标为经理已确认 Golden");
check(manifest.capabilities?.oaIntegration?.state==="external_configuration_required","OA 未配置时不得标记为已完成集成");
check(manifest.capabilities?.highAvailability?.state==="deployment_infrastructure_required","高可用不得在仅有代码准备时标记为已完成");
check(manifest.capabilities?.originalObjectStorage?.capacityTarget?.validation==="external_load_test_required","百万文件目标必须保留外部压测门槛");
const contracts=[
  ["report-evidence-graph.js",/preSubmitAudit/],
  ["project-intelligence.js",/permissionsFor/],
  ["functions/api/_agent-enterprise.js",/enqueueAgentJob/],
  ["functions/api/rag.js",/RAG_OBJECTS/],
  ["investment-ops.js",/evaluateSlo/],
  ["functions/api/releasestatus.js",/buildReleaseStatus/]
];
for(const [file,pattern] of contracts)check(pattern.test(fs.readFileSync(path.join(root,file),"utf8")),`企业能力契约缺失：${file}`);

if(failures.length){console.error("Release Consistency Gate 未通过：\n- "+failures.join("\n- "));process.exit(1);}
console.log(JSON.stringify({ok:true,ruleBaselines:Object.fromEntries(logicSets.map(([name,, ,rules,chapters])=>[name,{rules,chapters}])),tableBaselines:Object.fromEntries(tables.map(([type,,logical,physical])=>[type,{logical,physical}])),reportlogicExports:6,releaseManifest:manifest.release.releaseId,migrations:manifest.migrations,evaluationRoles:["training","holdout"],enterpriseContracts:contracts.length},null,2));
