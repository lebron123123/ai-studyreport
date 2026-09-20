import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {ensureProjectMemberships,projectRolePermissions,resolveProjectAccess} from './_project-access.js';
import {validatePortfolio,portfolioMapItem} from '../../project-map/portfolio-core.mjs';
import {validatePortfolioLocation,mergePortfolioLocation} from '../../project-map/portfolio-location.mjs';

export async function onRequestGet(context){
 const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'请登录后读取项目台账'},401);
 await ensureProjectMemberships(env);
 const offset=Math.max(0,Number(new URL(context.request.url).searchParams.get('offset'))||0);if(!Number.isInteger(offset)||offset>100000)return json({ok:false,error:'分页参数无效'},400);
 const rows=await env.DB.prepare("SELECT p.id,p.data,p.user_id,p.updated_at,m.role FROM projects p LEFT JOIN project_memberships m ON m.project_id=p.id AND m.user_id=? AND m.status='active' WHERE p.user_id=? OR m.role IN ('OWNER','EDITOR','VIEWER') ORDER BY p.id LIMIT 101 OFFSET ?").bind(user.userId,user.userId,offset).all();
 const items=[];for(const row of (rows.results||[]).slice(0,100)){try{const data=typeof row.data==='string'?JSON.parse(row.data):row.data;if(data.project?.portfolio){const role=Number(row.user_id)===Number(user.userId)?'OWNER':row.role;items.push({...portfolioMapItem(row.id,validatePortfolio(data.project.portfolio)),updated_at:Number(row.updated_at),archived:!!data.workflow?.management?.archived,permissions:projectRolePermissions(role)});}}catch{ return json({ok:false,error:'项目台账格式异常，请联系管理员核查；未隐藏异常记录'},500);}}
 return json({ok:true,items,nextOffset:(rows.results||[]).length>100?offset+100:null});
}
export async function onRequestPost(context){
 const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'请登录后导入项目台账'},401);
 let p,body;try{body=await context.request.json();if(body.action==='location')return await updateLocation(env,user,body);if(body.action!=='import')throw Error('操作无效');p=validatePortfolio(body.project);if(JSON.stringify(p).length>150000)throw Error('单项目台账超过大小限制');}catch(e){return json({ok:false,error:e.message||'台账格式无效'},400);}
 // Per-owner deterministic IDs. Import is insert-only: never overwrites an existing project.
 const id='ledger-'+user.userId+'-'+p.sourceKey,now=Date.now();
 const data={project:{name:p.name,owner:p.owner,type:p.type,location:p.address,portfolio:p},workflow:{management:{createdAt:now,tags:['安居项目台账'],activity:[{at:now,type:'ledgerImport',text:'导入项目台账；原始表格与分类独立保存',by:String(user.userId)}]}}};
 const saved=await env.DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,user.userId,p.name,JSON.stringify(data),now).run();
 if(saved.meta?.changes===1)return json({ok:true,id,created:true});
 const existing=await env.DB.prepare('SELECT user_id,data FROM projects WHERE id=?').bind(id).first();
 if(Number(existing?.user_id)!==Number(user.userId))return json({ok:false,error:'项目标识冲突，未覆盖任何数据'},409);
 let prior;try{prior=JSON.parse(existing.data).project?.portfolio;}catch{}
 if(prior?.sourceHash!==p.sourceHash)return json({ok:false,error:'该项目已存在且来源版本不同；请人工合并，原数据未覆盖'},409);
 return json({ok:true,id,created:false});
}
async function updateLocation(env,user,body){
 const patch=validatePortfolioLocation(body.location);
 if(typeof body.id!=='string'||body.id.length>200||!Number.isSafeInteger(body.expectedUpdatedAt))return json({ok:false,error:'缺少项目版本'},400);
 await ensureProjectMemberships(env);
 const access=await resolveProjectAccess(env,user.userId,body.id);
 if(!access?.permissions.edit)return json({ok:false,error:'无权修改项目位置'},403);
 const data=typeof access.row.data==='string'?JSON.parse(access.row.data):access.row.data;
 if(JSON.stringify(data.project?.portfolio?.locationSource)===JSON.stringify(patch))return json({ok:true,updated:false});
 if(Number(access.row.updated_at)!==body.expectedUpdatedAt)return json({ok:false,error:'项目已有更新，请重新读取后再核对；未覆盖'},409);
 const now=Math.max(Date.now(),body.expectedUpdatedAt+1),next=mergePortfolioLocation(data,body.location,now,user.userId);
 const r=await env.DB.prepare("UPDATE projects SET data=?,updated_at=? WHERE id=? AND updated_at=? AND (user_id=? OR EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id=projects.id AND m.user_id=? AND m.status='active' AND m.role IN ('OWNER','EDITOR')))").bind(JSON.stringify(next),now,body.id,body.expectedUpdatedAt,user.userId,user.userId).run();
 if(r.meta?.changes!==1)return json({ok:false,error:'项目版本或权限已变化，未覆盖，请刷新重试'},409);
 return json({ok:true,updated:true,updated_at:now});
}
