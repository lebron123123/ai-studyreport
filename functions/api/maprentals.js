import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {rentalService} from './_rental-service.js';
export async function onRequestPost(context){
 const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
 if(!user)return json({ok:false,error:'请登录后使用共享租金样本库'},401);
 let input;try{const text=await context.request.text();if(text.length>2000)throw Error();input=JSON.parse(text);}catch{return json({ok:false,error:'租金查询参数无效'},400);}
 if(!['list','collect','retry'].includes(input?.action))return json({ok:false,error:'不支持该租金操作'},400);
 try{return json(await rentalService(env,{action:input.action,point:input.point,radius:input.radius,kind:input.kind,market:input.market},context.waitUntil?.bind(context)));}
 catch(error){const message=String(error?.message||'');const invalid=/请选择深圳|租金范围或物业类型|租售类别无效/.test(message);return json({ok:false,error:invalid?message:'租金服务暂不可用，请稍后重试；已存样本不会删除'},invalid?400:503);}
}
