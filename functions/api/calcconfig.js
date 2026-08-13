// /api/calcconfig  测算参数配置（登录用户可读，管理员可写）
// GET              返回全部配置 {gaibao:{}, rent:{}, sale:{}, metrics:[]}
// POST             {key:"gaibao"|"rent"|"sale"|"metrics", data:{...}|[...]}
import { verifyAuth, json } from "./_auth.js";

import { adaptEnv } from "./_adapters.js";
import { configTrigger,recordReviewEvent } from "./_paramreview.js";
const KEYS = ["gaibao","rent","sale","invest","schedule","metrics","score","examples","airules","calclogic","sensitivity","calcstd","paramrules","paramdefaults"];
function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

function passOk(env, request){
  if(!env.ADMIN_PASS) return true;   // 未配置则不启用
  return request.headers.get("x-admin-pass") === env.ADMIN_PASS;
}
function parseJson(v,fallback){try{return JSON.parse(v||"");}catch(e){return fallback;}}
export function activeOn(data,today){return (!data.effectiveDate||data.effectiveDate<=today)&&(!data.expiryDate||data.expiryDate>=today);}


export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  const out = {};
  for(const k of KEYS){
    const row = await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind("calc_"+k).first();
    out[k] = row? JSON.parse(row.data) : ((k==="metrics"||k==="score"||k==="examples"||k==="airules"||k==="calcstd")? [] : {});
  }
  // 已发布参数治理版本按生效/失效日期覆盖旧配置；未来版本和过期版本不会进入测算。
  try{
    const q=await env.DB.prepare("SELECT calc_type,param_key,published_data,published_version FROM param_governance WHERE status='published'").all(),today=new Date().toISOString().slice(0,10);
    out.paramdefaults=out.paramdefaults||{};out.paramrules=out.paramrules||{};
    for(const x of q.results||[]){const d=parseJson(x.published_data,{}),active=activeOn(d,today);if(x.calc_type.startsWith("coeff_")){const type=x.calc_type.slice(6);out[type]=out[type]||{};delete out[type][x.param_key];if(active&&d.hasExpertOverride&&!d.derived&&d.input!==false)out[type][x.param_key]=d.expertValue;continue;}
      const type=x.calc_type;out.paramdefaults[type]=out.paramdefaults[type]||{};delete out.paramdefaults[type][x.param_key];if(active&&d.hasExpertOverride&&!d.derived&&d.input!==false)out.paramdefaults[type][x.param_key]=d.expertValue;
      const list=Array.isArray(out.paramrules[type])?out.paramrules[type].filter(r=>r&&r.key!==x.param_key):[];if(active&&(d.ruleValue!==null||d.min!==null||d.max!==null||d.basis||d.evidenceRefs&&d.evidenceRefs.length||d.enabled))list.push({key:d.key,label:d.label,value:d.ruleValue,min:d.min,max:d.max,region:d.region,projectType:d.projectType,basis:d.basis,evidenceRefs:d.evidenceRefs,effectiveDate:d.effectiveDate,expiryDate:d.expiryDate,enabled:d.enabled,manualRequired:d.manualRequired,role:d.role,sourcePolicy:d.sourcePolicy,volatility:d.volatility,confirmation:d.confirmation,impactLevel:d.impactLevel,version:Number(x.published_version)||1});out.paramrules[type]=list;
    }
  }catch(e){/* 尚未初始化参数治理表时保持旧配置兼容 */}
  return json({ok:true, config: out});
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"仅管理员可修改测算参数"}, 403);
  if(!passOk(env, request)) return json({ok:false, error:"管理员密码校验失败，请重新进入后台"}, 403);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const key = String(body.key||"");
  if(!KEYS.includes(key)) return json({ok:false, error:"未知配置项"}, 400);
  const dataStr = JSON.stringify(body.data ?? (key==="metrics"? []:{}));
  const maxLen = key==="examples"? 400000 : key==="calclogic"? 150000 : 50000;
  if(dataStr.length > maxLen) return json({ok:false, error:"配置过大"}, 413);
  const oldRow = await env.DB.prepare("SELECT key,data FROM configs WHERE key=?").bind("calc_"+key).first();
  const exist = oldRow;
  if(exist){
    await env.DB.prepare("UPDATE configs SET data=?, updated_at=? WHERE key=?").bind(dataStr, Date.now(), "calc_"+key).run();
  }else{
    await env.DB.prepare("INSERT INTO configs(key, data, updated_at) VALUES(?,?,?)").bind("calc_"+key, dataStr, Date.now()).run();
  }
  const reviewEventId=await recordReviewEvent(env,configTrigger(key,oldRow?parseJson(oldRow.data,null):null,body.data),user.username);
  return json({ok:true,reviewEventId});
}
