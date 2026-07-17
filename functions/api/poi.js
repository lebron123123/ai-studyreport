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
  // ===== 第一步:候选搜索(POI名称精确匹配,人工确认后再抓周边) =====
  if(body.action === "search"){
    const address = String(body.address||"").trim().slice(0, 100);
    if(!address) return json({ok:false, error:"请先填写建设地点"}, 400);
    // 优先POI搜索(小区/楼盘名精确命中真实项目)
    const pR = await fetch("https://restapi.amap.com/v3/place/text?key="+env.AMAP_KEY
      +"&keywords="+encodeURIComponent(address)+"&offset=5&page=1&extensions=base");
    const pd = await pR.json();
    let cands = (pd.status==="1" && pd.pois)? pd.pois.slice(0,5).map(p=>({
      name: p.name, district: (p.pname||"")+(p.cityname&&p.cityname!==p.pname?p.cityname:"")+(p.adname||""),
      address: typeof p.address==="string"? p.address : "", location: p.location,
    })).filter(c=>c.location) : [];
    // 兜底:结构化地址走地理编码
    if(!cands.length){
      const geoR = await fetch("https://restapi.amap.com/v3/geocode/geo?key="+env.AMAP_KEY
        +"&address="+encodeURIComponent(address));
      const geo = await geoR.json();
      if(geo.status==="1" && geo.geocodes && geo.geocodes.length){
        cands = geo.geocodes.slice(0,3).map(gc=>({
          name: gc.formatted_address, district: (gc.province||"")+(gc.district||""),
          address: "（按地址解析，精度"+(gc.level||"未知")+"）", location: gc.location,
        }));
      }
    }
    if(!cands.length) return json({ok:false, error:"未找到匹配位置，请换更具体的名称或地址（含城市名）"}, 400);
    return json({ok:true, candidates: cands});
  }

  // ===== 第二步:按确认的精确坐标抓周边 =====
  const loc = String(body.location||"").trim();
  if(!/^-?[\d.]+,-?[\d.]+$/.test(loc)) return json({ok:false, error:"缺少确认的位置坐标"}, 400);

  // 六类周边搜索（半径3km，各取前4）
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
  return json({ok:true, location: loc, pois: result});
}
