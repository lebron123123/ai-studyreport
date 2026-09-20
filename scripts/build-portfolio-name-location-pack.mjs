import fs from 'node:fs';
import {validatePortfolioLocation} from '../project-map/portfolio-location.mjs';

// Explicitly reviewed project/alias matches, not automatic adoption of search rank.
const selected = new Map([
 [4,'安居清竹苑(建设中)'],[6,'安托山16-02地块项目工地'],[7,'香蜜二村'],
 [11,'承福苑'],[14,'安居景馨苑'],[15,'安居望湖轩'],[20,'湾尚骏玺家园'],
 [21,'安居锦园'],[25,'海关草埔生活区'],[27,'深业泰富广场E座'],
 [34,'深业云海湾花园'],[42,'海智云轩'],[47,'安居同乐馨苑'],[54,'前海铂寓'],
 [63,'安居福汇阁'],[76,'安居空港花园'],[81,'安居玥龙苑'],[87,'安居冉龙苑'],
 [91,'朗泓·龙园大观'],[101,'雅龙阁(建设中)'],[129,'安居秀景苑'],
 [140,'安居臻悦花园'],[141,'安居澜庭1期'],[142,'安居·瑾华庭'],
 [146,'明皓府'],[147,'明汇府'],[150,'白花片区保障性住房项目'],
 [151,'安居君兰湾府'],[152,'安居白鹭湾府'],[153,'安居风铃府'],
 [154,'安居东湾半岛花园'],[155,'安居红豆湾府'],[156,'安居银叶湾府'],[160,'安居怡海花园'],
]);
const audit=JSON.parse(fs.readFileSync('outputs/portfolio-location-audit.json','utf8'));
const search=JSON.parse(fs.readFileSync('outputs/portfolio-name-search.json','utf8'));
const original=JSON.parse(fs.readFileSync('outputs/portfolio-locations-reviewed.json','utf8'));
if(search.sourceHash!==audit.sourceHash)throw Error('Workbook identity changed');
const pending=new Set(original.projects.filter(p=>p.status==='pending').map(p=>p.sourceKey));
const notes={
 6:'采用同宗地实际工地POI，不采用施工单位办公地点。',
 7:'棚改项目采用原小区参考点，不代表重建边界。',
 20:'原表名称含“已退出”，状态和原名保持不变；仅补位置。',
 25:'棚改项目采用海关草埔生活区参考点。',
 42:'原表道路描述存在差异；海智云谷官方项目页对应海山街道深盐路，采用同名住宅POI。官方依据：https://pnr.sz.gov.cn/d-cyyf/homeDetailSeoServlet?id=c2398045817e433497cf66935608b491 。',
 91:'仅确认龙园大观项目级位置，未确认回购房源所属楼栋。',
 101:'原表地址明确别名雅龙阁及宝龙二路21号，与命中一致。',
 129:'原表地址明确别名安居秀景苑及秀山路1号，与命中一致。',
 150:'采用花神路保障房项目本体POI，排除白花大道项目部。',
 151:'原表“君澜”保留；官方名称为“君兰”。官方规划依据：https://www.sz.gov.cn/cn/xxgk/zfxxgj/tzgg/content/post_8111674.html 。',
 160:'深汕合作区在地图服务中归属汕尾海丰；保留原表行政归属。',
};
const projects=[];
for(const [row,name] of selected){
 const p=search.projects.find(p=>p.row===row);
 if(!p||!pending.has(p.sourceKey)||p.error)throw Error('Not an eligible pending project: '+row);
 const matches=p.candidates.filter(c=>c.name===name);
 if(matches.length!==1)throw Error('Ambiguous/missing reviewed POI '+row+': '+name);
 const c=matches[0];
 projects.push(validatePortfolioLocation({name:p.name,sourceKey:p.sourceKey,sourceHash:audit.sourceHash,sourceFile:audit.sourceFile,
  address:c.address,status:'confirmed',crs:'GCJ02',coordinate:c.providerCoordinate.split(',').map(Number),
  evidence:`按项目名称/原表别名重新查询高德，核对区域与地址；POI：${c.name}（${c.id}），地址：${c.address}。原表地址：${p.address}。${notes[row]||''}本次采用服务返回GCJ02坐标并转换WGS84，不认定豆包原坐标的坐标系。仅项目级参考点，非地块边界或测绘定位。核查日期：${p.checkedAt.slice(0,10)}。`,
 }));
}
const pack={format:'anju-portfolio-locations-v1',projects};
fs.writeFileSync('outputs/portfolio-locations-name-reviewed.json',JSON.stringify(pack,null,2));
const adopted=new Set(projects.map(p=>p.sourceKey));
fs.writeFileSync('outputs/portfolio-locations-name-remaining.json',JSON.stringify({
 sourceHash:audit.sourceHash,projects:search.projects.filter(p=>!adopted.has(p.sourceKey)).map(p=>({row:p.row,name:p.name,address:p.address,queries:p.queries,status:'pending',reason:'暂未核实唯一实际项目位置；相似名称、项目部、周边设施或不同楼栋不能替代项目本体。'}))
},null,2));
console.log(JSON.stringify({newlyLocated:projects.length,totalLocated:original.projects.filter(p=>p.status==='confirmed').length+projects.length,remaining:pending.size-projects.length}));
