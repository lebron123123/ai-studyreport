// Bounded observer tour; user input, closing or hiding cancels queued movement.
export function createTour({fly,rotate,stopCamera,changed,schedule=setTimeout,cancel=clearTimeout}){
 let timer=null,generation=0,active=false;
 function stop(){generation++;active=false;cancel(timer);timer=null;stopCamera();changed(false);}
 function start(items){stop();if(!items.length)return;active=true;changed(true);const token=generation;let index=0;
  function next(){if(token!==generation)return;if(index===items.length){stop();return;}fly(items[index++]);timer=schedule(()=>{if(token!==generation)return;rotate();timer=schedule(next,8500);},2200);}next();
 }
 return {start,stop,get active(){return active;}};
}
