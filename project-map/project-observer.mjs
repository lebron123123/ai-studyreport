import {CityObserver} from './reference/city-observer.mjs';

// Project navigation adaptations live outside the imported upstream sources.
export class ProjectObserver extends CityObserver {
 ceiling=2200;
 maxDistance=3200;
 snapshot(){return {focus:{...this.focus},yaw:this.yaw,pitch:this.pitch,distance:this.distance,ceiling:this.ceiling,maxDistance:this.maxDistance,speedMultiplier:this.speedMultiplier};}
 restore(state){
  if(!state||!state.focus||![state.focus.x,state.focus.y,state.focus.z,state.yaw,state.pitch,state.distance,state.ceiling,state.maxDistance].every(Number.isFinite)||state.distance<=0||state.ceiling<1.5||state.ceiling>24000||state.maxDistance<3||state.maxDistance>32000)return false;
  this.focus={...state.focus};this.yaw=state.yaw;this.pitch=state.pitch;this.distance=state.distance;this.ceiling=state.ceiling;this.maxDistance=state.maxDistance;this.setSpeed(state.speedMultiplier);return true;
 }
 begin(...args){this.ceiling=2200;this.maxDistance=3200;super.begin(...args);}
 overview(bounds){const [x0,z0,x1,z1]=bounds;this.begin({x:(x0+x1)/2,y:0,z:(z0+z1)/2},Math.hypot(x1-x0,z1-z0)*.95,0,1.1);this.ceiling=24000;this.maxDistance=32000;}
 setSpeed(value){const n=Number(value);this.speedMultiplier=[1,5,10,20,40].includes(n)?n:1;}
 zoom(delta) {
  if(!Number.isFinite(delta))return;
  const vertical=Math.sin(this.pitch);
  let low=3,high=this.maxDistance;
  // Keep the target fixed. Never let wheel zoom cross the floor/ceiling and
  // force step() to move the target, which made reverse scrolling irreversible.
  if(Math.abs(vertical)>1e-6){
   const a=(1.5-this.focus.y)/vertical,b=(this.ceiling-this.focus.y)/vertical;
   low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
  }
  if(high<low)return;
  const bounded=Math.max(-160,Math.min(160,delta));
  this.distance=Math.max(low,Math.min(high,this.distance*Math.exp(bounded*.0012)));
 }
 elevate(metres) {
  if(!Number.isFinite(metres))return;
  const y=this.pose().y;
  this.focus.y+=Math.max(1.5,Math.min(this.ceiling,y+metres))-y;
  // Descending from an aerial view must not leave the camera staring underground.
  // Preserve camera position while easing toward the horizon near street level.
  if(metres<0&&this.pitch>0){const limit=Math.atan2(Math.max(0,this.pose().y-1.5),150);if(this.pitch>limit)this.look(0,limit-this.pitch);}
 }
 step(keys,dt,heightAt,extent){
  // Vertical speed must remain useful after zooming close to a high viewpoint.
  const vertical=Number(keys.has('KeyE'))-Number(keys.has('KeyQ'));
  const planar=new Set(keys);planar.delete('KeyE');planar.delete('KeyQ');
  const beforeY=this.pose().y;super.step(planar,dt,heightAt,extent);
  if(beforeY>2200&&this.ceiling>2200)this.focus.y+=Math.min(beforeY,this.ceiling)-2200;
  if(vertical)this.elevate(vertical*Math.max(20,Math.min(250,this.pose().y*.25))*this.speedMultiplier*(keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1)*Math.min(dt,.05));
  // Elevation is applied after the upstream collision check. Recheck the final
  // pose so descending cannot move below a newly loaded mountain in this frame.
  const pose=this.pose(),floor=heightAt(pose.x,pose.z)+1.5;
  if(Number.isFinite(floor)&&pose.y<floor)this.focus.y+=floor-pose.y;
 }
}
