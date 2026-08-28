/* 本地联网研究冒烟：只测配置状态、查询规划、证据台账与SSRF保护，不向外部搜索服务发送项目数据。 */
import { signToken } from "../functions/api/_auth.js";

const base=process.env.LOCAL_BASE_URL||"http://localhost:8080";
if(!process.env.SESSION_SECRET)throw new Error("缺少 SESSION_SECRET");
const token=await signToken({SESSION_SECRET:process.env.SESSION_SECRET},999999,"[系统测试]联网研究");
async function call(body){
  const response=await fetch(base+"/api/webresearch",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},body:JSON.stringify(body)});
  const data=await response.json();return {status:response.status,data};
}
const status=await call({action:"status"});
if(status.status!==200||!status.data.ok||!Array.isArray(status.data.providers))throw new Error("status失败："+JSON.stringify(status.data));
if(JSON.stringify(status.data).includes(process.env.WEB_SEARCH_API_KEY||"__never__")&&process.env.WEB_SEARCH_API_KEY)throw new Error("状态接口泄露密钥");
const plan=await call({action:"plan",projectName:"[系统测试]保障房",location:"深圳市测试区测试街道",projectType:"rent",chapter:"项目市场分析",section:"人口与需求"});
if(plan.status!==200||!plan.data.plan||plan.data.plan.queries.length<5)throw new Error("plan失败："+JSON.stringify(plan.data));
const list=await call({action:"listEvidence",projectId:"[系统测试]web-research"});
if(list.status!==200||!Array.isArray(list.data.evidence))throw new Error("listEvidence失败："+JSON.stringify(list.data));
const blocked=await call({action:"fetch",url:"http://127.0.0.1:8080/admin.html"});
if(blocked.status<400||!String(blocked.data.error||"").includes("禁止访问"))throw new Error("SSRF保护未生效："+JSON.stringify(blocked.data));
console.log(JSON.stringify({ok:true,providers:status.data.providers.map(x=>({id:x.id,configured:x.configured})),queries:plan.data.plan.queries.length,evidence:list.data.evidence.length,ssrfBlocked:true}));
