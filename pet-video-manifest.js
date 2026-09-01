/* 蓝喵 / 安小居视频动作清单：替换单段视频时只修改对应 clip 的 src/version/trim。 */
(function(root){
  "use strict";
  const base="assets/pets/videos/";
  const clip=(file,startPose,endPose,trimStart,trimEnd,options)=>Object.freeze({
    src:base+file,startPose,endPose,trimStart:trimStart??0.12,trimEnd:trimEnd??0.12,version:1,...(options||{})
  });

  const catClips=Object.freeze({
    idle:clip("cat-idle-v1.mp4","H0","H0",0.14,0.14),
    jumpUp:clip("cat-jump-up-v1.mp4","H1","AIR",0.14,0.14,{blendDuration:0}),
    jumpDown:clip("cat-jump-down-v1.mp4","AIR","H1",0.14,0.14,{blendDuration:0}),
    runStart:clip("cat-run-start-v1.mp4","H1","RUN_A",0.14,0.14,{blendDuration:0}),
    runLoop:clip("cat-run-loop-v1.mp4","RUN_A","RUN_B",0.14,0.14,{blendDuration:0}),
    runStop:clip("cat-run-stop-v1.mp4","RUN_B","H1",0.14,0.14,{blendDuration:0}),
    runUpEntry:clip("cat-run-up-entry-v1.mp4","H1","UP_A",0.14,0.14,{blendDuration:0,mirror:false,startFacing:"left",travelDirection:"up",transition:true}),
    runUp:clip("cat-run-up-v1.mp4","UP_A","UP_B",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"up"}),
    runUpExit:clip("cat-run-up-exit-v1.mp4","UP_B","H1",0.14,0.14,{blendDuration:0,mirror:false,endFacing:"right",travelDirection:"up",transition:true}),
    runDownEntry:clip("cat-run-down-entry-v1.mp4","H1","DOWN_A",0.14,0.14,{blendDuration:0,mirror:false,startFacing:"left",travelDirection:"down",transition:true}),
    runDown:clip("cat-run-down-v1.mp4","DOWN_A","DOWN_B",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"down"}),
    runDownExit:clip("cat-run-down-exit-v1.mp4","DOWN_B","H1",0.14,0.14,{blendDuration:0,mirror:false,endFacing:"right",travelDirection:"down",transition:true}),
    rollOut:clip("cat-roll-out-v1.mp4","H1","ROLL",0.14,0.14),
    rollBack:clip("cat-roll-back-v1.mp4","ROLL","H1",0.14,0.14),
    stretchOut:clip("cat-stretch-out-v1.mp4","H1","STRETCH",0.14,0.14),
    stretchBack:clip("cat-stretch-back-v1.mp4","STRETCH","H1",0.14,0.14),
    alertOut:clip("cat-alert-out-v1.mp4","H1","ALERT",0.14,0.14),
    alertBack:clip("cat-alert-back-v1.mp4","ALERT","H1",0.14,0.14),
    sit:clip("cat-sit-v1.mp4","H1","H0",0.14,0.14),
    waveOut:clip("cat-wave-out-v1.mp4","H0","WAVE",0.14,0.14),
    waveBack:clip("cat-wave-back-v1.mp4","WAVE","H0",0.14,0.14),
    groomOut:clip("cat-groom-out-v1.mp4","H0","GROOM",0.14,0.14),
    groomBack:clip("cat-groom-back-v1.mp4","GROOM","H0",0.14,0.14),
    rise:clip("cat-rise-v1.mp4","H0","H1",0.14,0.14),
    turnRightToLeft:clip("cat-turn-v1.mp4","H1","H1",0.14,0.14,{mirror:false,startFacing:"right",endFacing:"left",transition:true}),
    turnLeftToRight:clip("cat-turn-v1.mp4","H1","H1",0.14,0.14,{mirror:true,startFacing:"left",endFacing:"right",transition:true}),
    gazeLeftOut:clip("cat-gaze-atlas-v1.mp4","H0","GAZE_LEFT",0.52,4.72,{mirror:false,gaze:true}),
    gazeLeftBack:clip("cat-gaze-atlas-v1.mp4","GAZE_LEFT","H0",1.36,4.00,{mirror:false,gaze:true}),
    gazeUpOut:clip("cat-gaze-atlas-v1.mp4","H0","GAZE_UP",2.08,3.22,{mirror:false,gaze:true}),
    gazeUpBack:clip("cat-gaze-atlas-v1.mp4","GAZE_UP","H0",2.86,2.52,{mirror:false,gaze:true}),
    gazeDownOut:clip("cat-gaze-atlas-v1.mp4","H0","GAZE_DOWN",3.56,1.72,{mirror:false,gaze:true}),
    gazeDownBack:clip("cat-gaze-atlas-v1.mp4","GAZE_DOWN","H0",4.36,0.78,{mirror:false,gaze:true})
  });
  const catActions=Object.freeze({
    idle:Object.freeze({label:"呼吸待机",startPose:"H0",endPose:"H0",clips:["idle"]}),
    jump:Object.freeze({label:"跳跃",startPose:"H1",endPose:"H1",clips:["jumpUp","jumpDown"],move:true,movementAxis:"screen-hop",moveDelay:2.15,moveDuration:3.65,motionClips:["jumpUp","jumpDown"],movementStyle:"airborne-only-hop"}),
    run:Object.freeze({label:"跑动",startPose:"H1",endPose:"H1",clips:["runStart","runLoop","runStop"],directionalClips:Object.freeze({up:["runUpEntry","runUp","runUpExit"],down:["runDownEntry","runDown","runDownExit"]}),directionalStartFacing:Object.freeze({up:"left",down:"left"}),directionalMoveStartClips:Object.freeze({up:"runUp",down:"runDown"}),directionalMoveDelays:Object.freeze({up:0,down:0}),directionalMotionClips:Object.freeze({up:["runUp"],down:["runDown"]}),move:true,movementAxis:"core-safe-rectangle",moveStartClip:"runStart",moveDelay:1.85,motionClips:["runStart","runLoop"]}),
    roll:Object.freeze({label:"原地翻滚",startPose:"H1",endPose:"H1",clips:["rollOut","rollBack"]}),
    stretch:Object.freeze({label:"伸懒腰",startPose:"H1",endPose:"H1",clips:["stretchOut","stretchBack"]}),
    listen:Object.freeze({label:"警觉",startPose:"H1",endPose:"H1",clips:["alertOut","alertBack"]}),
    sit:Object.freeze({label:"坐下",startPose:"H1",endPose:"H0",clips:["sit"],transition:true}),
    wave:Object.freeze({label:"挥爪",startPose:"H0",endPose:"H0",clips:["waveOut","waveBack"]}),
    groom:Object.freeze({label:"舔毛",startPose:"H0",endPose:"H0",clips:["groomOut","groomBack"]}),
    rise:Object.freeze({label:"起身",startPose:"H0",endPose:"H1",clips:["rise"],transition:true})
  });
  const cat=Object.freeze({
    clips:catClips,actions:catActions,
    randomCycle:Object.freeze(["jump","run","run","roll","run","stretch","listen","run","wave","groom","jump","run","jump","run","idle"]),
    transitions:Object.freeze({"H0>H1":"rise","H1>H0":"sit"}),
    facingTransitions:Object.freeze({"right>left":"turnRightToLeft","left>right":"turnLeftToRight"}),
    gaze:Object.freeze({anchorPose:"H0",nearRadius:330,touchRadius:150,switchDelay:250,returnDelay:1400,directions:Object.freeze({left:Object.freeze({out:"gazeLeftOut",back:"gazeLeftBack"}),up:Object.freeze({out:"gazeUpOut",back:"gazeUpBack"}),down:Object.freeze({out:"gazeDownOut",back:"gazeDownBack"})})}),
    directionalRun:Object.freeze({left:"run",right:"run",up:"runUp",down:"runDown",verticalAssetsReady:true,route:"core-safe-rectangle"}),
    fallback:"assets/blue-kitten-sprite-v1.png"
  });

  const anjuClips=Object.freeze({
    anjuIdle:clip("anju-idle-v1.mp4","H1","H1",0.14,0.14),
    // 正放尾部与倒放头部都含约1秒最高点静止帧；对称裁到同一动态最高点，避免接缝卡住。
    anjuJumpUp:clip("anju-jump-up-v1.mp4","H1","ANJU_AIR",0.14,0.92,{blendDuration:0}),
    anjuJumpDown:clip("anju-jump-down-v1.mp4","ANJU_AIR","H1",0.84,0.14,{blendDuration:0}),
    anjuRunEntry:clip("anju-run-right-entry-v1.mp4","H1","ANJU_RUN_A",0.14,0.14,{blendDuration:0}),
    anjuRun:clip("anju-run-right-v1.mp4","ANJU_RUN_A","ANJU_RUN_A",0.14,0.14,{blendDuration:0}),
    anjuRunExit:clip("anju-run-right-exit-v2.mp4","ANJU_RUN_A","H1",0.14,0.14,{blendDuration:0,forwardGenerated:true}),
    anjuRunDown:clip("anju-run-down-v1.mp4","H1","H1",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"down"}),
    anjuRunUpEntry:clip("anju-run-up-entry-v2.mp4","H1","ANJU_UP_A",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"up",transition:true,forwardGenerated:true}),
    anjuRunUp:clip("anju-run-up-v1.mp4","ANJU_UP_A","ANJU_UP_B",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"up"}),
    anjuRunUpExit:clip("anju-run-up-exit-v2.mp4","ANJU_UP_B","H1",0.14,0.14,{blendDuration:0,mirror:false,travelDirection:"up",transition:true}),
    anjuRollOut:clip("anju-roll-out-v1.mp4","H1","ANJU_ROLL",0.14,0.14),
    anjuRollBack:clip("anju-roll-back-v1.mp4","ANJU_ROLL","H1",0.14,0.14),
    anjuGazeLeftOut:clip("anju-gaze-atlas-v1.mp4","H1","ANJU_GAZE_LEFT",0.52,4.72,{mirror:false,gaze:true}),
    anjuGazeLeftBack:clip("anju-gaze-atlas-v1.mp4","ANJU_GAZE_LEFT","H1",1.36,4.00,{mirror:false,gaze:true}),
    anjuGazeRightOut:clip("anju-gaze-atlas-v1.mp4","H1","ANJU_GAZE_RIGHT",0.52,4.72,{mirror:false,eyeMirror:Object.freeze({boxes:Object.freeze([{x:.365,y:.38,w:.11,h:.14},{x:.525,y:.38,w:.11,h:.14}])}),gaze:true}),
    anjuGazeRightBack:clip("anju-gaze-atlas-v1.mp4","ANJU_GAZE_RIGHT","H1",1.36,4.00,{mirror:false,eyeMirror:Object.freeze({boxes:Object.freeze([{x:.365,y:.38,w:.11,h:.14},{x:.525,y:.38,w:.11,h:.14}])}),gaze:true}),
    anjuGazeUpOut:clip("anju-gaze-atlas-v1.mp4","H1","ANJU_GAZE_UP",2.08,3.22,{mirror:false,gaze:true}),
    anjuGazeUpBack:clip("anju-gaze-atlas-v1.mp4","ANJU_GAZE_UP","H1",2.86,2.52,{mirror:false,gaze:true}),
    anjuGazeDownOut:clip("anju-gaze-atlas-v1.mp4","H1","ANJU_GAZE_DOWN",3.56,1.72,{mirror:false,gaze:true}),
    anjuGazeDownBack:clip("anju-gaze-atlas-v1.mp4","ANJU_GAZE_DOWN","H1",4.36,0.78,{mirror:false,gaze:true})
  });
  const anjuActions=Object.freeze({
    idle:Object.freeze({label:"呼吸待机",startPose:"H1",endPose:"H1",clips:["anjuIdle"]}),
    jump:Object.freeze({label:"跳跃",startPose:"H1",endPose:"H1",clips:["anjuJumpUp","anjuJumpDown"]}),
    run:Object.freeze({label:"跑动",startPose:"H1",endPose:"H1",clips:["anjuRunEntry","anjuRun","anjuRunExit"],directionalClips:Object.freeze({up:["anjuRunUpEntry","anjuRunUp","anjuRunUpExit"],down:["anjuRunDown"]}),directionalMoveStartClips:Object.freeze({up:"anjuRunUpEntry",down:"anjuRunDown"}),directionalMoveDelays:Object.freeze({up:1.55,down:0.55}),directionalMoveDurations:Object.freeze({up:5.9,down:3.1}),directionalMotionClips:Object.freeze({up:["anjuRunUpEntry","anjuRunUp"],down:["anjuRunDown"]}),move:true,movementAxis:"core-safe-rectangle",moveStartClip:"anjuRunEntry",moveDelay:0.8,moveDuration:6.7,motionClips:["anjuRunEntry","anjuRun"]}),
    roll:Object.freeze({label:"原地翻滚",startPose:"H1",endPose:"H1",clips:["anjuRollOut","anjuRollBack"]})
  });
  const anju=Object.freeze({
    clips:anjuClips,actions:anjuActions,
    randomCycle:Object.freeze(["run","jump","run","roll","run","idle","jump","run"]),
    transitions:Object.freeze({}),facingTransitions:Object.freeze({}),symmetricFacing:true,
    gaze:Object.freeze({anchorPose:"H1",nearRadius:330,touchRadius:150,switchDelay:250,returnDelay:1400,directions:Object.freeze({left:Object.freeze({out:"anjuGazeLeftOut",back:"anjuGazeLeftBack"}),right:Object.freeze({out:"anjuGazeRightOut",back:"anjuGazeRightBack"}),up:Object.freeze({out:"anjuGazeUpOut",back:"anjuGazeUpBack"}),down:Object.freeze({out:"anjuGazeDownOut",back:"anjuGazeDownBack"})})}),
    directionalRun:Object.freeze({left:"run",right:"run",up:"runUp",down:"runDown",verticalAssetsReady:true,route:"core-safe-rectangle"}),
    fallback:"assets/anju-mascot-sprite-v2.png"
  });

  const morphClips=Object.freeze({
    catToAnju:clip("pet-morph-cat-anju-v1.mp4","H0","H1",0.14,0.14,{blendDuration:0,fromForm:"cat",toForm:"anju"}),
    anjuToCat:clip("pet-morph-anju-cat-v1.mp4","H1","H0",0.14,0.14,{blendDuration:0,fromForm:"anju",toForm:"cat"})
  });
  root.AgentPetVideoManifest=Object.freeze({
    version:3.1,forms:Object.freeze({cat,anju}),morphClips,
    morphs:Object.freeze({"cat>anju":"catToAnju","anju>cat":"anjuToCat"}),
    // 兼容既有检查和调用方；默认字段仍指向蓝猫清单。
    clips:cat.clips,actions:cat.actions,randomCycle:cat.randomCycle,transitions:cat.transitions,
    facingTransitions:cat.facingTransitions,directionalRun:cat.directionalRun,fallback:cat.fallback
  });
})(window);
