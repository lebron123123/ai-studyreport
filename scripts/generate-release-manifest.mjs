import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bytes=relative=>fs.readFileSync(path.join(root,relative));
const json=relative=>JSON.parse(bytes(relative).toString("utf8"));
const sha256=value=>crypto.createHash("sha256").update(value).digest("hex");
const fileHash=relative=>sha256(bytes(relative));
const migrations=fs.readdirSync(path.join(root,"migrations")).filter(x=>x.endsWith(".sql")).sort();
const packageData=json("package.json");
const rule=(canonicalPath,runtimePath)=>{
  const data=json(canonicalPath);
  return {setId:data.setId,version:data.version,status:data.status,rules:data.rules.length,chapters:data.structure.chapterCount,canonicalPath,runtimePath,canonicalSha256:fileHash(canonicalPath)};
};
const golden=(file,expectedRole)=>{
  const data=json(file);
  if(data.datasetRole!==expectedRole)throw new Error(`${file} 的 datasetRole 必须为 ${expectedRole}`);
  return {file,datasetRole:data.datasetRole,approvalStatus:data.approvalStatus,sourceProjectId:data.sourceProjectId,fileSha256:fileHash(file),sourceDocumentSha256:data.sourceDocument?.sha256||""};
};
const tableSet=(file)=>{const data=json(file);return {setId:data.setId,version:data.version,projectType:data.projectType,templates:data.templates.length,file,fileSha256:fileHash(file)};};
const manifest={
  schemaVersion:1,
  release:{name:packageData.name,version:packageData.version,releaseId:`${packageData.name}@${packageData.version}`},
  reportLogic:{rent:rule("data/report-logic-rent-v1.json","functions/api/_reportlogic-seed.js"),gaibao:rule("data/report-logic-gaibao-v1.json","functions/api/_reportlogic-gaibao-seed.js")},
  reportTables:{rent:tableSet("data/report-table-templates-rent-v1.json"),gaibaoHousing:tableSet("data/report-table-templates-gaibao-housing-v1.json"),gaibaoCommercial:tableSet("data/report-table-templates-gaibao-commercial-v1.json")},
  evaluation:{training:golden("data/report-golden-tax-v2-training.json","training"),holdout:golden("data/report-golden-longyue-holdout.json","holdout")},
  migrations:{count:migrations.length,latest:migrations.at(-1),orderedListSha256:sha256(migrations.join("\n"))},
  capabilities:{
    evidenceSigningGate:{state:"implemented",contract:"report-evidence-graph.js#preSubmitAudit"},
    projectRbac:{state:"implemented",roles:["OWNER","EDITOR","VIEWER"],contract:"project-intelligence.js#permissionsFor"},
    asyncJobsAndCheckpoints:{state:"implemented",contract:"functions/api/_agent-enterprise.js"},
    usageAndCostLedger:{state:"implemented",contract:"migrations/0009_agent_enterprise.sql"},
    promptLineage:{state:"implemented_per_report_version",contract:"report-trust.js",releaseManifestStatus:"runtime_lineage_required"},
    sloProductionGate:{state:"implemented",contract:"investment-ops.js#evaluateSlo",target:{concurrency:50,p95Ms:5000,successRate:0.99,recoveryRate:0.95}},
    originalObjectStorage:{state:"adapter_ready",binding:"RAG_OBJECTS",capacityTarget:{objects:1000000,validation:"external_load_test_required"}},
    oaIntegration:{state:"external_configuration_required",binding:"OA_BASE_URL",validation:"vendor_contract_and_credentials_required"},
    highAvailability:{state:"deployment_infrastructure_required",binding:"HA_DEPLOYMENT_ID",validation:"failover_drill_required"}
  }
};
const serialized=JSON.stringify(manifest,null,2);
fs.writeFileSync(path.join(root,"data","release-manifest-v1.json"),serialized+"\n","utf8");
fs.writeFileSync(path.join(root,"functions","api","_release-manifest.js"),"// 由 scripts/generate-release-manifest.mjs 自动生成，请勿手工改写。\nexport default "+serialized+";\n","utf8");
console.log(`已生成 Release Manifest：${manifest.release.releaseId}，${migrations.length} 个迁移`);
