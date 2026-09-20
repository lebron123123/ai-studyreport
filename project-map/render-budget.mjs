// Keep navigation responsive, but avoid redrawing an unchanged city 30 times/sec.
export function createRenderBudget({activeInterval=33,idleInterval=1000}={}) {
 let last=-Infinity,signature=null,frames=0;
 return {
  shouldRender(now,{hidden=false,active=false,state=''}={}) {
   if(hidden)return false;
   const changed=state!==signature;
   if(now-last<(active||changed?activeInterval:idleInterval))return false;
   last=now;signature=state;frames++;return true;
  },
  get frames(){return frames;}
 };
}
