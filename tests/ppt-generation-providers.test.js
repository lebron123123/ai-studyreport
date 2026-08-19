const test=require("node:test");
const assert=require("node:assert/strict");

global.window={};
const Providers=require("../ppt-generation-providers.js");

test("PPT生成Provider默认使用本地稳定引擎",()=>{
  assert.equal(Providers.resolve().id,"local-design-ir");
  assert.equal(Providers.resolve("pptagent-isolated").id,"local-design-ir");
});

test("PPT任务元数据包含引擎、管线和提示词版本",()=>{
  assert.deepEqual(Providers.jobMeta("local-design-ir",{templateId:"anju-blue"}),{
    providerId:"local-design-ir",
    providerVersion:"agent-v1",
    pipelineVersion:"agent-v1",
    promptVersion:"ppt-agent-2026-08-18",
    templateId:"anju-blue"
  });
});
