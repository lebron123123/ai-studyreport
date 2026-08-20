const test=require("node:test");
const assert=require("node:assert/strict");
const tracks=require("../ppt-render-tracks.js");

test("商务蓝仅对已验证安全的目录页自动复用真实模板，其余页面保持可编辑",()=>{
  const plan={templateId:"business-blue-160",slides:[
    {layoutId:"cover"},
    {layoutId:"agenda"},
    {layoutId:"chart-bar"},
    {layoutId:"table"},
    {layoutId:"conclusion"}
  ]};
  const sum=tracks.summarize(plan);
  assert.equal(sum.native,1);
  assert.equal(sum.editable,4);
  assert.equal(sum.hybrid,true);
  const out=tracks.prepare(plan);
  assert.equal(out.hybridTemplate,true);
  assert.equal(out.nativeTemplate,false);
});

test("动态数据页即使误选真实模板也会安全回退可编辑轨",()=>{
  const row=tracks.resolve({layoutId:"chart-line",renderTrack:"native"},{templateId:"business-blue-160"});
  assert.equal(row.track,"editable");
  assert.match(row.reason,/图表|可编辑/);
});

test("封面和章节页仍允许人工强制使用真实模板轨",()=>{
  assert.equal(tracks.resolve({layoutId:"cover",renderTrack:"native"},{templateId:"business-blue-160"}).track,"native");
  assert.equal(tracks.resolve({layoutId:"section",renderTrack:"native"},{templateId:"business-blue-160"}).track,"native");
});
