const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function loadManifest(){
  const root=path.resolve(__dirname,".."),sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,"pet-video-manifest.js"),"utf8"),sandbox);
  return{root,manifest:sandbox.window.AgentPetVideoManifest};
}

function assertClipFiles(root,clips){
  for(const clip of Object.values(clips)){
    assert.ok(clip.trimStart>=0.1&&clip.trimEnd>=0.1,clip.src);
    assert.ok(fs.statSync(path.join(root,clip.src)).size>1024*1024,clip.src);
  }
}

test("蓝猫、安小居和双向变身均使用独立视频清单",()=>{
  const {root,manifest}=loadManifest();
  assert.equal(manifest.version,3.1);
  assert.deepEqual(Object.keys(manifest.forms),["cat","anju"]);
  assert.equal(Object.keys(manifest.forms.cat.clips).length,32);
  assert.equal(Object.keys(manifest.forms.anju.clips).length,20);
  assert.equal(Object.keys(manifest.morphClips).length,2);
  assertClipFiles(root,manifest.forms.cat.clips);
  assertClipFiles(root,manifest.forms.anju.clips);
  assertClipFiles(root,manifest.morphClips);
});

test("蓝猫向下跑使用新增入场、主段和收尾解决姿态抽跳",()=>{
  const {manifest}=loadManifest(),cat=manifest.forms.cat;
  assert.deepEqual(Array.from(cat.actions.run.directionalClips.down),["runDownEntry","runDown","runDownExit"]);
  let pose="H1";
  for(const key of cat.actions.run.directionalClips.down){const clip=cat.clips[key];assert.equal(clip.startPose,pose);pose=clip.endPose;assert.equal(clip.travelDirection,"down");assert.equal(clip.blendDuration,0);}
  assert.equal(pose,"H1");
  assert.equal(cat.clips.runDownEntry.startFacing,"left");
  assert.equal(cat.clips.runDownExit.endFacing,"right");
  assert.equal(cat.actions.run.directionalMoveStartClips.down,"runDown");
  assert.deepEqual(Array.from(cat.actions.run.directionalMotionClips.down),["runDown"]);
});

test("两种宠物的随机动作均形成连续姿态链",()=>{
  const {manifest}=loadManifest();
  for(const [form,startPoses] of [["cat",["H0","H1"]],["anju",["H1"]]]){
    const item=manifest.forms[form];
    for(const currentPose of startPoses){
      for(const key of item.randomCycle){
        const action=item.actions[key],plan=[];
        if(currentPose!==action.startPose){const transition=item.actions[item.transitions[currentPose+">"+action.startPose]];assert.ok(transition,form+":"+currentPose+">"+action.startPose);plan.push(...transition.clips);}
        plan.push(...action.clips);let pose=currentPose;
        for(const clipKey of plan){const clip=item.clips[clipKey];assert.equal(clip.startPose,pose,form+":"+key+":"+clipKey);pose=clip.endPose;}
        assert.equal(pose,action.endPose,form+":"+key);
      }
    }
  }
});

test("安小居四类动作、四向跑动和独立替换契约完整",()=>{
  const {manifest}=loadManifest(),anju=manifest.forms.anju;
  assert.deepEqual(Object.keys(anju.actions),["idle","jump","run","roll"]);
  assert.deepEqual(Array.from(anju.actions.run.directionalClips.up),["anjuRunUpEntry","anjuRunUp","anjuRunUpExit"]);
  assert.deepEqual(Array.from(anju.actions.run.directionalClips.down),["anjuRunDown"]);
  assert.equal(anju.actions.run.moveStartClip,"anjuRunEntry");
  assert.equal(anju.actions.run.moveDelay,0.8);
  assert.equal(anju.actions.run.moveDuration,6.7);
  assert.deepEqual(Array.from(anju.actions.run.motionClips),["anjuRunEntry","anjuRun"]);
  assert.equal(anju.actions.run.directionalMoveStartClips.up,"anjuRunUpEntry");
  assert.equal(anju.actions.run.directionalMoveDelays.up,1.55);
  assert.equal(anju.actions.run.directionalMoveDurations.up,5.9);
  assert.equal(anju.actions.run.directionalMoveDelays.down,0.55);
  assert.equal(anju.actions.run.directionalMoveDurations.down,3.1);
  assert.equal(anju.clips.anjuRunExit.src,"assets/pets/videos/anju-run-right-exit-v2.mp4");
  assert.equal(anju.clips.anjuRunExit.forwardGenerated,true);
  assert.equal(anju.clips.anjuRunUpEntry.src,"assets/pets/videos/anju-run-up-entry-v2.mp4");
  assert.equal(anju.clips.anjuRunUpEntry.forwardGenerated,true);
  assert.equal(anju.symmetricFacing,true);
  assert.equal(anju.actions.run.movementAxis,"core-safe-rectangle");
  assert.equal(anju.directionalRun.verticalAssetsReady,true);
  assert.equal(anju.actions.jump.startPose,"H1");
  assert.equal(anju.actions.jump.endPose,"H1");
});

test("安小居跳跃裁掉正反片在最高点重复的静止帧",()=>{
  const {manifest}=loadManifest(),anju=manifest.forms.anju;
  assert.equal(anju.clips.anjuJumpUp.trimEnd,0.92);
  assert.equal(anju.clips.anjuJumpDown.trimStart,0.84);
  assert.equal(anju.clips.anjuJumpUp.endPose,anju.clips.anjuJumpDown.startPose);
});

test("旋转变身正反成片共享H0/H1锚点且可独立替换",()=>{
  const {manifest}=loadManifest(),forward=manifest.morphClips[manifest.morphs["cat>anju"]],reverse=manifest.morphClips[manifest.morphs["anju>cat"]];
  assert.equal(forward.startPose,"H0");assert.equal(forward.endPose,"H1");
  assert.equal(reverse.startPose,"H1");assert.equal(reverse.endPose,"H0");
  assert.equal(forward.fromForm,"cat");assert.equal(forward.toForm,"anju");
  assert.equal(reverse.fromForm,"anju");assert.equal(reverse.toForm,"cat");
  assert.notEqual(forward.src,reverse.src);
});

test("蓝猫停用异常右看且其余眼球注视延长驻留",()=>{
  const {manifest}=loadManifest();
  for(const [form,anchor,file,directions] of [["cat","H0","cat-gaze-atlas-v1.mp4",["left","up","down"]],["anju","H1","anju-gaze-atlas-v1.mp4",["left","right","up","down"]]]){
    const item=manifest.forms[form];assert.equal(item.gaze.anchorPose,anchor);
    assert.deepEqual(Object.keys(item.gaze.directions),directions);
    assert.equal(item.gaze.switchDelay,250);assert.equal(item.gaze.returnDelay,1400);
    for(const direction of Object.values(item.gaze.directions)){
      const out=item.clips[direction.out],back=item.clips[direction.back];
      assert.equal(path.basename(out.src),file);assert.equal(path.basename(back.src),file);
      assert.equal(out.startPose,anchor);assert.equal(back.endPose,anchor);
      assert.equal(out.gaze,true);assert.equal(back.gaze,true);
    }
  }
  assert.equal(manifest.forms.cat.clips.gazeRightOut,undefined);
  assert.equal(manifest.forms.cat.clips.gazeRightBack,undefined);
  assert.equal(manifest.forms.cat.gaze.directions.right,undefined);
  assert.equal(manifest.forms.cat.clips.gazeLeftOut.mirror,false);
  assert.equal(manifest.forms.anju.clips.anjuGazeRightOut.eyeMirror.boxes.length,2);
});

test("蓝猫真实转向视频保持双向复用",()=>{
  const {manifest}=loadManifest(),cat=manifest.forms.cat;
  assert.equal(cat.facingTransitions["right>left"],"turnRightToLeft");
  assert.equal(cat.facingTransitions["left>right"],"turnLeftToRight");
  assert.equal(cat.clips.turnRightToLeft.src,cat.clips.turnLeftToRight.src);
  assert.equal(cat.clips.turnRightToLeft.mirror,false);
  assert.equal(cat.clips.turnLeftToRight.mirror,true);
});
