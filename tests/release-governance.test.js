const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{pathToFileURL}=require("node:url");
const root=path.resolve(__dirname,"..");
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),"utf8"));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex");

test("Release Manifest 锁定双规则单一真源与训练/留出隔离",async()=>{
  const manifest=read("data/release-manifest-v1.json");
  for(const [name,file,rules,chapters] of [["rent","data/report-logic-rent-v1.json",137,14],["gaibao","data/report-logic-gaibao-v1.json",74,13]]){
    assert.equal(manifest.reportLogic[name].rules,rules);assert.equal(manifest.reportLogic[name].chapters,chapters);assert.equal(manifest.reportLogic[name].canonicalSha256,sha(file));
  }
  assert.equal(manifest.evaluation.training.datasetRole,"training");assert.equal(manifest.evaluation.holdout.datasetRole,"holdout");
  assert.notEqual(manifest.evaluation.training.sourceProjectId,manifest.evaluation.holdout.sourceProjectId);
  assert.equal(manifest.capabilities.sloProductionGate.target.concurrency,50);
  assert.equal(manifest.capabilities.originalObjectStorage.capacityTarget.validation,"external_load_test_required");
  assert.equal(manifest.capabilities.highAvailability.state,"deployment_infrastructure_required");
  assert.equal(manifest.reportTables.rent.templates,33);
});

test("运行状态只报告真实配置且不暴露密钥",async()=>{
  const api=await import(pathToFileURL(path.join(root,"functions/api/releasestatus.js")).href+"?test="+Date.now());
  const status=api.buildReleaseStatus({DB:{},RAG_OBJECTS:{put(){}},OA_BASE_URL:"https://oa.invalid",AI_API_KEY:"secret-value",CF_PAGES_COMMIT_SHA:"abc123"});
  assert.equal(status.runtime.database.configured,true);assert.equal(status.runtime.objectStorage.configured,true);assert.equal(status.runtime.oa.configured,true);assert.equal(status.runtime.highAvailability.configured,false);
  assert.equal(JSON.stringify(status).includes("secret-value"),false);
  assert.equal(status.runtime.deploymentRevision,"abc123");
});
