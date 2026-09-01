const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("桌宠固定调度视频且经典帧控制被封存",()=>{
  const root=path.resolve(__dirname,"..");
  const source=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  assert.match(source,/PET_RENDER_MODE_KEY="studyreport:agent-pet-render-mode:v1"/);
  assert.match(source,/CLASSIC_CONTROLS_EXPOSED=false/);
  assert.match(source,/let renderMode="video"/);
  assert.match(source,/if\(CLASSIC_CONTROLS_EXPOSED\)hoverTools\.appendChild\(renderModeToggle\);hoverTools\.appendChild\(morphToggle\)/);
  assert.match(source,/if\(renderMode==="video"\)return;\s*stopActionVideo\(\);/);
  assert.match(source,/formManifest\?\.actions\?\.\[action\.key\]/);
  assert.match(source,/renderModeToggle\.textContent=videoOnly\?"🎬 视频动作":"▦ 经典帧"/);
  assert.match(source,/morphToggle\.hidden=!VIDEO_MANIFEST\?\.morphs/);
  assert.match(source,/if\(avatar\)btn\.insertBefore\(stage,avatar\);else btn\.insertBefore\(stage,name\|\|btn\.firstChild\)/);
  assert.match(source,/setRenderMode,getRenderMode:\(\)=>renderMode/);
  assert.match(source,/legacyFramesPaused:renderMode==="video"/);
  assert.match(source,/videoActions:manifest\?Object\.keys\(manifest\.actions\):\[\]/);
  assert.match(source,/per-form weighted shuffle \+ no immediate repeat \+ pose transitions/);
});

test("视频模式压缩动作空档并让跑跳只做水平步态位移",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  assert.match(source,/scheduleVideoAction\(180\+Math\.random\(\)\*320\)/);
  assert.match(source,/videoPlayback\.finished\.then\(ok=>\{if\(ok&&current===action\.key\)finishAction\(\);\}\)/);
  assert.match(source,/movementEndsAt=Date\.now\(\)\+Math\.ceil\(movementSeconds\*1000\)\+120/);
  assert.match(source,/movementRemaining=movementEndsAt-Date\.now\(\)/);
  assert.match(source,/movementRemaining>0&&current===action\.key&&movementToken===actionMovementToken/);
  assert.match(source,/btn\.dataset\.petRoute="core-safe-rectangle"/);
  assert.match(source,/if\(best>90\)perimeterCursor=nearest/);
  assert.match(source,/else perimeterCursor=\(nearest\+perimeterDirection\+points\.length\)%points\.length/);
  assert.match(source,/"four-edge core-safe rectangle with left\/right\/up\/down run videos"/);
});

test("动作结束遇到鼠标或页面静默时会持续重试而非永久卡住",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  assert.match(source,/function scheduleVideoAction\(delay\)/);
  assert.match(source,/if\(canAct\(\)\)\{timer=null;perform\(randomAction\(\)\);return;\}/);
  assert.match(source,/timer=setTimeout\(retry,450\)/);
  assert.match(source,/const watchdog=setTimeout\(\(\)=>finish\(false,"watchdog"\),6000\)/);
  assert.match(source,/actionVideo\.onended=\(\)=>finish\(true,"ended"\)/);
});

test("视频首帧就绪并经过动作准备时间后才移动且使用真实换向视频",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  assert.match(source,/videoPlayback\.ready\.then\(ok=>\{if\(ok&&movementToken===actionMovementToken\)\{const delay=Math\.max\(0,Number\(videoPlayback\.moveDelay\)\|\|0\)/);
  assert.doesNotMatch(source,/pet-facing-left \.aw-cat-action-video\{scale:-1 1\}/);
  assert.doesNotMatch(source,/petTurnSwap|function prepareVideoFacing/);
  assert.match(source,/manifest\.facingTransitions/);
  assert.match(source,/completedClip\.endFacing/);
  assert.match(source,/pose transitions/);
});

test("跑步和跳跃等待真实迈步或离地时点后再执行网页位移",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  const manifest=fs.readFileSync(path.resolve(__dirname,"..","pet-video-manifest.js"),"utf8");
  assert.match(manifest,/jump:Object\.freeze\(\{label:"跳跃"[^\n]*?move:true[^\n]*?movementAxis:"screen-hop"[^\n]*?moveDelay:2\.15[^\n]*?moveDuration:3\.65[^\n]*?movementStyle:"airborne-only-hop"[^\n]*?\}\)/);
  assert.match(manifest,/run:Object\.freeze\(\{label:"跑动"[^\n]*?move:true[^\n]*?\}\)/);
  assert.match(source,/videoReadyClipKey=action\.directionalMoveStartClips\?\.\[travelDirection\]\|\|action\.moveStartClip\|\|selectedClips\[0\]\|\|plan\[0\]/);
  assert.match(source,/motionClips=action\.directionalMotionClips\?\.\[travelDirection\]\|\|action\.motionClips\|\|selectedClips/);
  assert.match(source,/moveDelay=action\.directionalMoveDelays\?\.\[travelDirection\]\?\?action\.moveDelay\?\?0/);
  assert.match(source,/setTimeout\(startMovement,Math\.round\(delay\*1000\)\)/);
  assert.match(source,/actionMovementToken=\+\+movementToken/);
  assert.match(source,/movementToken!==actionMovementToken/);
  assert.match(manifest,/jump:Object\.freeze\(\{label:"跳跃"[^\n]*moveDelay:2\.15/);
  assert.match(manifest,/run:Object\.freeze\(\{label:"跑动"[^\n]*directionalMoveDelays:Object\.freeze\(\{up:0,down:0\}\)[^\n]*moveDelay:1\.85/);
  assert.match(source,/if\(!canAct\(\)\)\{setTimeout\(startMovement,180\);return;\}/);
  assert.match(source,/btn\.dataset\.petMovementStarted="1"/);
});

test("H1到H0保留坐下视频且片段边界不再叠帧制造虚影",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  const manifest=fs.readFileSync(path.resolve(__dirname,"..","pet-video-manifest.js"),"utf8");
  assert.match(manifest,/sit:clip\("cat-sit-v1\.mp4","H1","H0"/);
  assert.match(manifest,/"H1>H0":"sit"/);
  assert.match(source,/requestedBlend=Number\.isFinite\(clip\.blendDuration\)\?clip\.blendDuration:0/);
  assert.match(source,/btn\.dataset\.petVideoBlendPolicy="motion-match-cut"/);
});

test("休息和问答状态保留当前视频画面或静态降级",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  assert.match(source,/function stopActionVideo\(keepFrame\)/);
  assert.match(source,/stopActionVideo\(true\);current="rest";btn\.dataset\.petAction="rest";setLabel\("休息中"\)/);
  assert.match(source,/pet-video-only\.pet-video-fallback\.pet-form-cat \.aw-kitten-sprite\{display:block!important\}/);
  assert.match(source,/pet-video-only\.pet-video-fallback\.pet-form-anju \.aw-anju-sprite\{display:block!important\}/);
});

test("视频动作层不替换AI问答按钮和面板入口",()=>{
  const root=path.resolve(__dirname,"..");
  const widget=fs.readFileSync(path.join(root,"agent-widget.js"),"utf8");
  const pet=fs.readFileSync(path.join(root,"agent-pet.js"),"utf8");
  assert.match(widget,/awMakeDraggable\(btn,btn,AW_POS_KEYS\.button,awTogglePanel\)/);
  assert.match(pet,/const btn=document\.getElementById\("awBtn"\),panel=document\.getElementById\("awPanel"\)/);
  assert.doesNotMatch(pet,/btn\.replaceWith|panel\.replaceWith/);
});

test("活动开关显示下一步命令且每个角色有独立动作菜单",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"..","agent-pet.js"),"utf8");
  assert.match(source,/toggle\.textContent=enabled\?"💤 休息":"🐾 活动"/);
  assert.match(source,/function rebuildActionMenu\(\)/);
  assert.match(source,/filter\(\(\[,action\]\)=>!action\.transition\)/);
  assert.match(source,/button\[data-pet-action-key\]/);
  assert.match(source,/if\(!enabled\)setEnabled\(true\)/);
});
