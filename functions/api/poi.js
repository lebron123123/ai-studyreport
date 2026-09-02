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

export function poiSearchContext(address){
  const raw=String(address||"").trim().replace(/\s+/g," ").slice(0,100);
  let city="",keyword=raw;
  const spaced=raw.split(/\s+/);
  if(spaced.length>1 && /[市州盟]$/.test(spaced[0])){city=spaced[0];keyword=spaced.slice(1).join("");}
  else{
    const cityMatch=raw.match(/^([\u4e00-\u9fa5]{2,8}市)/);
    if(cityMatch){city=cityMatch[1];keyword=raw.slice(city.length)||raw;}
  }
  // 用户经常只写“福田区上梅林”而省略深圳市。此时若不限定城市，高德会在全国
  // 搜索同名POI，甚至直接返回空。只对深圳法定行政区做确定性补全，不猜其他城市。
  if(!city&&/(?:福田|罗湖|南山|盐田|宝安|龙岗|龙华|坪山|光明)区|大鹏新区/.test(raw))city="深圳市";
  const fullAddress=city&&!raw.startsWith(city)?city+raw:raw;
  return {raw,city,keyword,fullAddress};
}

export function poiSearchQueries(address,projectName){
  const ctx=poiSearchContext(address),project=String(projectName||"").trim().slice(0,80);
  const shortAddress=ctx.keyword
    .replace(/^.*?(?:区|县|旗)/,"")
    .replace(/^.*?(?:街道|镇|乡)/,"")
    .trim();
  return [...new Set([
    ctx.keyword,
    shortAddress && shortAddress!==ctx.keyword ? shortAddress : "",
    project,
    project ? project.replace(/(?:建设)?项目$/,'').trim() : "",
    project&&!/(?:小区|花园|家园|苑|村|公寓|大厦|广场)$/.test(project) ? project+"小区" : "",
    project ? ctx.keyword+project : "",
  ].filter(x=>x&&x.length>=2))].slice(0,6);
}

export function mergePoiCandidates(groups,limit=15){
  const out=[],seen=new Set();
  for(const c of (groups||[]).flat()){
    if(!c||!c.location)continue;
    const key=String(c.location).trim();
    if(seen.has(key))continue;
    seen.add(key);out.push(c);
    if(out.length>=limit)break;
  }
  return out;
}

async function amapJson(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error("HTTP "+response.status);
  return response.json();
}

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
    const context=poiSearchContext(address),{city}=context,projectName=String(body.projectName||"").trim().slice(0,80),queries=poiSearchQueries(address,projectName);
    const groups=[],failures=[];let providerResponded=false;
    // 精确地址、短地址和项目名称分别检索；某一路失败不会再拖垮整个确认流程。
    for(const kw of queries){
      try{
        const pd=await amapJson("https://restapi.amap.com/v3/place/text?key="+env.AMAP_KEY
          +"&keywords="+encodeURIComponent(kw)
          +(city? "&city="+encodeURIComponent(city)+"&citylimit=true" : "")
          +"&offset=20&page=1&extensions=base");
        providerResponded=true;
        if(pd.status==="1" && pd.pois)groups.push(pd.pois.slice(0,20).map(p=>({
          name:p.name,district:(p.pname||"")+(p.cityname&&p.cityname!==p.pname?p.cityname:"")+(p.adname||""),
          address:typeof p.address==="string"?p.address:"",location:p.location,matchedBy:kw,
        })).filter(c=>c.location));
        else failures.push(pd.info||("检索“"+kw+"”未返回结果"));
      }catch(e){failures.push("检索“"+kw+"”连接失败");}
    }
    // 先解析规范地址，再尝试“地址+项目名”。后者可命中只在互联网页面中带小区名、
    // 但高德POI别名不完整的住宅项目；所有结果仍须在前端人工确认，不自动采用。
    const geocodeInputs=[context.fullAddress,projectName?context.fullAddress+projectName:""].filter((value,index,list)=>value&&list.indexOf(value)===index);
    for(const geoAddress of geocodeInputs){
      try{
        const geo=await amapJson("https://restapi.amap.com/v3/geocode/geo?key="+env.AMAP_KEY
          +"&address="+encodeURIComponent(geoAddress)+(city? "&city="+encodeURIComponent(city):""));
        providerResponded=true;
        if(geo.status==="1" && geo.geocodes && geo.geocodes.length){
          const geoCands=geo.geocodes.slice(0,3).map(gc=>({
            name: gc.formatted_address, district: (gc.province||"")+(gc.city||"")+(gc.district||"")+(gc.township||""),
            address: "（按"+(geoAddress===context.fullAddress?"规范地址":"地址＋项目名")+"解析，精度"+(gc.level||"未知")+"）", location: gc.location,matchedBy:geoAddress,
          })).filter(c=>c.location);
          groups.unshift(geoCands);
        }
      }catch(e){failures.push("地址解析“"+geoAddress+"”连接失败");}
    }
    const cands=mergePoiCandidates(groups,15);
    if(!cands.length){
      const networkBlocked=!providerResponded;
      return json({ok:false,code:networkBlocked?"MAP_PROVIDER_UNREACHABLE":"NO_LOCATION_MATCH",
        error:networkBlocked?"地图服务当前不可达，请检查本地服务网络后原位重试":"没有找到真实候选，请在本页补充到街道、社区/道路或附近地标后重试",
        searched:queries,details:failures.slice(0,4)},networkBlocked?503:400);
    }
    return json({ok:true,candidates:cands,searched:queries,partial:failures.length>0});
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
