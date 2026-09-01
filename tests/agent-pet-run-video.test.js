const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("蓝猫水平跑步等待起跑准备完成后再移动",()=>{
  const root=path.resolve(__dirname,"..");
  const dir=path.join(root,"assets","pets","videos");
  const source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  const manifest=fs.readFileSync(path.join(root,"pet-video-manifest.js"),"utf8");
  for(const file of ["cat-run-start-v1.mp4","cat-run-loop-v1.mp4","cat-run-stop-v1.mp4"])assert.ok(fs.statSync(path.join(dir,file)).size>1024*1024);
  assert.match(manifest,/directionalClips:Object\.freeze\(\{up:\["runUpEntry","runUp","runUpExit"\],down:\["runDownEntry","runDown","runDownExit"\]\}\)/);
  assert.match(manifest,/directionalMoveStartClips:Object\.freeze\(\{up:"runUp",down:"runDown"\}\)/);
  assert.match(manifest,/directionalMotionClips:Object\.freeze\(\{up:\["runUp"\],down:\["runDown"\]\}\)/);
  assert.match(manifest,/moveDelay:1\.85,motionClips:\["runStart","runLoop"\]/);
  assert.match(source,/motionDuration=action\.directionalMoveDurations\?\.\[travelDirection\]\?\?action\.moveDuration\?\?inferredMotionDuration/);
  assert.match(source,/btn\.dataset\.petRoute="core-safe-rectangle"/);
  assert.match(source,/btn\.dataset\.petLocomotion="foot-synced"/);
  assert.match(source,/pet-action-video-active/);
  assert.match(source,/movementSeconds=renderMode==="video"\?videoPlayback\.motionDuration:seconds/);
  assert.match(source,/fallback:manifest\?\.fallback/);
  assert.match(manifest,/runLoop:clip\([^\n]*\{blendDuration:0\}\)/);
});

test("全部41个视频资产可单独替换且动作图自动补姿态与方向转换",()=>{
  const root=path.resolve(__dirname,".."),dir=path.join(root,"assets","pets","videos");
  assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith(".mp4")).length,41);
  const manifest=fs.readFileSync(path.join(root,"pet-video-manifest.js"),"utf8");
  assert.match(manifest,/"H0>H1":"rise","H1>H0":"sit"/);
  assert.match(manifest,/"right>left":"turnRightToLeft","left>right":"turnLeftToRight"/);
  assert.match(manifest,/randomCycle:Object\.freeze\(\["jump","run","run","roll","run","stretch","listen","run","wave","groom","jump","run","jump","run","idle"\]\)/);
  assert.match(manifest,/directionalRun:Object\.freeze\(\{left:"run",right:"run",up:"runUp",down:"runDown",verticalAssetsReady:true,route:"core-safe-rectangle"\}\)/);
  for(const file of ["cat-run-up-entry-v1.mp4","cat-run-up-v1.mp4","cat-run-up-exit-v1.mp4","cat-run-down-entry-v1.mp4","cat-run-down-v1.mp4","cat-run-down-exit-v1.mp4","anju-idle-v1.mp4","pet-morph-cat-anju-v1.mp4","pet-morph-anju-cat-v1.mp4"])assert.ok(fs.statSync(path.join(dir,file)).size>1024*1024);
  assert.match(manifest,/replace.*clip|替换单段视频/);
});

test("鼠标靠近时播放真实眼球片段并复用既有互动动作",()=>{
  const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  assert.match(source,/function transitionGaze\(nextDirection,resume\)/);
  assert.match(source,/function handlePointerGaze\(e\)/);
  assert.match(source,/gazeDirectionAt\(e\.clientX,e\.clientY\)/);
  assert.match(source,/supportedDirection=gaze\.directions\?\.\[requestedDirection\]\?requestedDirection:""/);
  assert.match(source,/queueGaze\("",gaze\.returnDelay\?\?1400\)/);
  assert.match(source,/setTimeout\(triggerNearInteraction,1100\)/);
  assert.match(source,/if\(gazeTimer\)\{clearTimeout\(gazeTimer\);gazeTimer=null;\}\s*clearTimer\(\);clearMorphSchedule\(\);stopActionVideo\(true\)/);
  assert.match(source,/form==="anju"\?\["jump","roll"\]:\["wave","jump"\]/);
  assert.match(source,/if\(clip\.eyeMirror\)/);
  assert.match(source,/不能翻转尾巴、身体或留下矩形补丁/);
  assert.match(source,/original=pixels\.slice\(\)/);
  assert.match(source,/document\.addEventListener\("pointermove",handlePointerGaze,\{passive:true\}\)/);
});

test("拖动宠物时悬浮控制框按动画帧跟随",()=>{
  const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8"),widget=fs.readFileSync(path.join(root,"agent-widget.js"),"utf8");
  assert.match(source,/btn\.classList\.contains\("dragging"\)&&hoverTools\.classList\.contains\("is-visible"\)/);
  assert.match(source,/dragToolsRaf=requestAnimationFrame\(\(\)=>\{dragToolsRaf=null;syncHoverTools\(\);\}\)/);
  assert.match(widget,/dispatchEvent\(new CustomEvent\("awpositionchange"\)\)/);
  assert.match(source,/btn\.addEventListener\("awpositionchange",\(\)=>\{if\(hoverTools\.classList\.contains\("is-visible"\)\)syncHoverTools\(\);\}\)/);
});

test("页面路线按四个角逐边移动并为上下方向选择独立视频",()=>{
  const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  assert.match(source,/function coreSafeRectangleDestination\(\)/);
  assert.match(source,/segment=left<innerWidth\/2\?"left-vertical":"right-vertical"/);
  assert.match(source,/action\?\.directionalClips\?\.\[travelDirection\]/);
  assert.match(source,/btn\.dataset\.petTravelDirection=travelDirection\|\|"stationary"/);
  assert.match(source,/target=\{\.\.\.target,top\}/);
  assert.match(source,/target=\{\.\.\.target,left\}/);
  assert.match(source,/"four-edge core-safe rectangle with left\/right\/up\/down run videos"/);
});

test("悬浮冻结不会让变身或后续跑动被抢占",()=>{
  const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  assert.match(source,/btn\.classList\.remove\("pet-paused"\);movementToken\+=1;stopActionVideo\(true\)/);
  assert.match(source,/if\(btn\.classList\.contains\("pet-morphing"\)\)return false/);
  assert.match(source,/if\(btn\.classList\.contains\("pet-morphing"\)\)return;/);
  assert.match(source,/hovered=false;busy=false;btn\.classList\.remove\("pet-paused"\);hideHoverTools\(\)/);
});
