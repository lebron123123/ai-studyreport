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
    if(!address) return json({ok:false, error:"请输入项目/小区名称"}, 400);
    // 支持"城市 名称"格式:空格前视为城市,限定搜索范围
    let city = "", kw = address;
    const sp = address.split(/\s+/);
    if(sp.length > 1){ city = sp[0]; kw = sp.slice(1).join(""); }
    // 优先POI搜索(小区/楼盘名精确命中真实项目)
    const pR = await fetch("https://restapi.amap.com/v3/place/text?key="+env.AMAP_KEY
      +"&keywords="+encodeURIComponent(kw)
      +(city? "&city="+encodeURIComponent(city)+"&citylimit=true" : "")
      +"&offset=8&page=1&extensions=base");
    const pd = await pR.json();
    let cands = (pd.status==="1" && pd.pois)? pd.pois.slice(0,8).map(p=>({
      name: p.name, district: (p.pname||"")+(p.cityname&&p.cityname!==p.pname?p.cityname:"")+(p.adname||""),
      address: typeof p.address==="string"? p.address : "", location: p.location,
    })).filter(c=>c.location) : [];
    // 兜底:结构化地址走地理编码
    if(!cands.length){
      const geoR = await fetch("https://restapi.amap.com/v3/geocode/geo?key="+env.AMAP_KEY
        +"&address="+encodeURIComponent(kw)+(city? "&city="+encodeURIComponent(city):""));
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

  // ===== 竞品公寓搜索(名称+距离真实,租金/出租率无公开数据须人工调研) =====
  if(body.action === "competitors"){
    const out = [];
    for(const kw of ["公寓", "长租公寓"]){
      try{
        const r = await fetch("https://restapi.amap.com/v3/place/around?key="+env.AMAP_KEY
          +"&location="+loc+"&keywords="+encodeURIComponent(kw)
          +"&radius=3000&offset=10&page=1&sortrule=distance");
        const d = await r.json();
        if(d.status==="1" && d.pois) d.pois.forEach(p=>{
          if(!out.some(x=>x.name===p.name)) out.push({
            name: p.name, dist: p.distance? Math.round(p.distance/100)/10 : null,
            address: typeof p.address==="string"? p.address : "",
          });
        });
      }catch(e){}
    }
    out.sort((a,b)=>(a.dist??99)-(b.dist??99));
    return json({ok:true, competitors: out.slice(0, 8)});
  }

  // ===== 职住平衡代理指标：住宅小区 vs 企业/写字楼/产业园 的POI数量比 =====
  // 真正的职住平衡要用手机信令等大数据测算，成本高、要单独走企业合作；这里退而求其次，
  // 用高德"周边搜索"接口返回的 count 字段（总匹配数，不受 offset 分页限制）做一个密度参考，
  // 不是官方职住比，前端展示时必须带上这个提醒。
  if(body.action === "balance"){
    const sleep = ms => new Promise(res=>setTimeout(res, ms));
    // 这个动作前面通常已经紧跟着搜索/六类周边/竞品好几次高德调用了，同一个key短时间内
    // 请求太密集容易撞到免费key的QPS限制（status不是"1"，不一定是查询本身有问题）。
    // 顺序请求（不用Promise.all）+ 失败重试一次，比直接判定"0"更稳妥。
    const fetchCount = async (kw)=>{
      for(let attempt=0; attempt<2; attempt++){
        try{
          const r = await fetch("https://restapi.amap.com/v3/place/around?key="+env.AMAP_KEY
            +"&location="+loc+"&keywords="+encodeURIComponent(kw)
            +"&radius=3000&offset=1&page=1");
          const d = await r.json();
          if(d.status==="1") return parseInt(d.count,10)||0;
        }catch(e){}
        if(attempt===0) await sleep(400);
      }
      return 0;
    };
    const resiCount = await fetchCount("小区|住宅区");
    const jobCount = await fetchCount("公司企业|写字楼|产业园区");
    return json({ok:true, resiCount, jobCount});
  }

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
