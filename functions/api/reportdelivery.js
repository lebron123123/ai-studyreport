import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {deliveryAction,listDeliveries} from './_delivery.js';
async function handle(context,post){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  const url=new URL(context.request.url);
  try{return json({ok:true,result:post?await deliveryAction(env,user.userId,await context.request.json()):await listDeliveries(env,user.userId,url.searchParams.get('projectId'),url.searchParams.get('id'))});}catch(e){return json({ok:false,error:e.message},409);}
}
export const onRequestPost=c=>handle(c,true);
export const onRequestGet=c=>handle(c,false);
