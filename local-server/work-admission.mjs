// In-process admission, not a durable job queue. Running work retains its slot
// until settled even when the client disconnects; never create false capacity.
export class WorkAdmissionError extends Error {
 constructor(message,status=503){super(message);this.status=status;}
}
// Return headers promptly while a streaming response still owns its slot.
export function admitResponse(gate,work,{signal}={}){
 return new Promise((resolve,reject)=>{
  gate.run(async()=>{
   const response=await work();
   if(!response.body || !response.headers.get('content-type')?.includes('text/event-stream')){resolve(response);return;}
   const reader=response.body.getReader();let finish;
   const completed=new Promise(r=>{finish=r;});
   const body=new ReadableStream({
    async pull(controller){try{const chunk=await reader.read();if(chunk.done){controller.close();finish();}else controller.enqueue(chunk.value);}catch(error){controller.error(error);finish();}},
    async cancel(reason){try{await reader.cancel(reason);}finally{finish();}}
   });
   resolve(new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers}));
   await completed;
  },{signal}).catch(reject);
 });
}
export function createWorkAdmission({concurrency=1,maxQueued=4,waitMs=10000}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||!Number.isInteger(maxQueued)||maxQueued<0||!Number.isFinite(waitMs)||waitMs<1)throw Error('Invalid work admission limits');
 let active=0;const queue=[];
 function start(item){
  clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);active++;
  Promise.resolve().then(item.work).then(item.resolve,item.reject).finally(()=>{active--;const next=queue.shift();if(next)start(next);});
 }
 return {
  stats:()=>({active,queued:queue.length,concurrency,maxQueued}),
  run(work,{signal}={}){
   if(signal?.aborted)return Promise.reject(new WorkAdmissionError('请求已取消',499));
   if(active>=concurrency&&queue.length>=maxQueued)return Promise.reject(new WorkAdmissionError('当前任务较多，请稍后重试；原内容未修改',429));
   return new Promise((resolve,reject)=>{
    const item={work,resolve,reject,signal};
    if(active<concurrency){start(item);return;}
    const remove=error=>{const index=queue.indexOf(item);if(index<0)return;queue.splice(index,1);clearTimeout(item.timer);signal?.removeEventListener('abort',item.abort);reject(error);};
    item.abort=()=>remove(new WorkAdmissionError('请求已取消',499));
    item.timer=setTimeout(()=>remove(new WorkAdmissionError('等待任务超时，请稍后重试；原内容未修改')) ,waitMs);
    queue.push(item);signal?.addEventListener('abort',item.abort,{once:true});
   });
  }
 };
}
