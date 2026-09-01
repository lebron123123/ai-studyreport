const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("蓝猫待机视频进入独立清单并使用运行时抠绿",()=>{
  const root=path.resolve(__dirname,"..");
  const video=path.join(root,"assets","pets","videos","cat-idle-v1.mp4");
  const source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  const manifest=fs.readFileSync(path.join(root,"pet-video-manifest.js"),"utf8");
  assert.ok(fs.statSync(video).size>1024*1024);
  assert.match(manifest,/cat-idle-v1\.mp4/);
  assert.match(manifest,/idle:Object\.freeze\(\{label:"呼吸待机"/);
  assert.match(source,/runtime chroma-key canvas/);
  assert.match(source,/fallback:manifest\?\.fallback/);
  assert.match(source,/dominance=g-Math\.max\(r,b\)/);
  assert.match(source,/clip\.trimStart/);
  assert.match(source,/actionVideo\.duration-clip\.trimEnd/);
});
