const categories={轨道交通:'150500',公交:'150700',教育:'141200',医疗:'090100',商业配套:'060100',产业园区:'120100'};
export async function mapAround(body,key){
 const p=String(body.location||'').split(',').map(Number),radius=Number(body.radius),category=String(body.category||'');
 if(p.length!==2||!p.every(Number.isFinite)||p[0]<113.5||p[0]>114.8||p[1]<22.3||p[1]>23||![500,1000,2000,3000].includes(radius)||!categories[category])return {status:400,data:{ok:false,error:'请选择深圳范围内的确认坐标、类别和500/1000/2000/3000米半径'}};
 try{
  const url=new URL('https://restapi.amap.com/v3/place/around');for(const [k,v] of Object.entries({key,location:p.join(','),radius,types:categories[category],offset:25,page:1,sortrule:'distance',extensions:'base'}))url.searchParams.set(k,v);
  const signal=AbortSignal.timeout(12000);let d;
  for(let attempt=0;attempt<2;attempt++){
   const response=await fetch(url,{signal});if(!response.ok)throw Error('HTTP');d=await response.json();
   if(d.status==='1'||!['10014','10021','10029'].includes(String(d.infocode))||attempt===1)break;
   await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(d.status!=='1'){
   const code=/^\d{5}$/.test(String(d.infocode))?String(d.infocode):'未知';
   const reason=['10014','10021','10029'].includes(code)?'查询过于频繁，请稍后只重试此类别':code==='10044'?'今日查询额度已用完，请联系管理员':code==='10041'?'接口权限已过期，请联系管理员':'请检查密钥权限、额度后重试';
   return {status:502,data:{ok:false,error:`地图供应商拒绝查询（${code}）：${reason}`}};
  }
  return {status:200,data:{ok:true,category,source:'高德周边搜索',queriedAt:new Date().toISOString(),radius,total:Number(d.count)||0,truncated:Number(d.count)>25,items:(d.pois||[]).slice(0,25).map(p=>({name:String(p.name||''),address:typeof p.address==='string'?p.address:'',location:p.location,category}))}};
 }catch{return {status:503,data:{ok:false,error:'周边地图服务连接失败或超时，可只重试此类别'}};}
}
