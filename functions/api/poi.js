// /api/poi  周边配套抓取（高德Web服务：地理编码+周边搜索）
import { verifyAuth, json } from "./_auth.js";

const CATS = [
  ["地铁站", "轨道交通"],
  ["公交站", "公交"],
  ["产业园区", "产业园区"],
  ["购物中心", "商业配套"],
  ["医院", "医疗"],
  ["学校", "教育"],
];

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!env.AMAP_KEY) return json({ok:false, error:"未配置 AMAP_KEY 环境变量"}, 500);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"格式有误"}, 400); }
  const address = String(body.address||"").trim().slice(0, 100);
  if(!address) return json({ok:false, error:"请先填写建设地点"}, 400);

  // 1. 地理编码
  const geoR = await fetch("https://restapi.amap.com/v3/geocode/geo?key="+env.AMAP_KEY
    +"&address="+encodeURIComponent(address));
  const geo = await geoR.json();
  if(geo.status!=="1" || !geo.geocodes || !geo.geocodes.length)
    return json({ok:false, error:"地址解析失败，请填写更具体的建设地点（含城市名）"}, 400);
  const loc = geo.geocodes[0].location;   // "lng,lat"

  // 2. 六类周边搜索（半径3km，各取前4）
  const result = {};
  for(const [kw, label] of CATS){
    try{
      const r = await fetch("https://restapi.amap.com/v3/place/around?key="+env.AMAP_KEY
        +"&location="+loc+"&keywords="+encodeURIComponent(kw)
        +"&radius=3000&offset=4&page=1&sortrule=distance");
      const d = await r.json();
      if(d.status==="1" && d.pois){
        result[label] = d.pois.slice(0,4).map(p=>({
          name: p.name, dist: p.distance? Math.round(p.distance/100)/10 : null,  // km
        }));
      }
    }catch(e){}
  }
  return json({ok:true, location: loc, formatted: geo.geocodes[0].formatted_address, pois: result});
}
