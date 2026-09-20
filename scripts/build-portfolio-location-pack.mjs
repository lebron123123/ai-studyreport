import fs from 'node:fs';
import {validatePortfolioLocation} from '../project-map/portfolio-location.mjs';
const audit=JSON.parse(fs.readFileSync('outputs/portfolio-location-audit.json','utf8'));
// Reviewed against BOTH workbook addresses and named provider results. Never adopt a replacement candidate.
const reviewed=new Set([3,5,9,10,12,17,18,19,22,23,24,26,30,33,35,36,38,40,41,43,44,48,49,51,57,58,64,65,66,67,69,70,71,73,75,82,83,84,85,89,90,92,93,94,96,97,98,106,107,108,109,110,111,113,114,115,116,117,123,125,126,127,130,131,133,138,139,143,144,145,158,159,162]);
const reasons={8:'搜索结果是项目宿舍区，不是已核实的项目位置。',105:'坐标对应05-25-01，但本行项目为05-25-02，相邻地块不可混用。',55:'仅匹配到整个科技生态园，未确认1栋A、B座。',56:'仅匹配到整个科技生态园，未确认1栋D座。',61:'仅匹配到大学，未确认校内保障房位置。',122:'搜索结果是现场指挥部，不能代替项目范围。',161:'匹配到公司办公地址，项目具体位置仍待核实。'};
const projects=audit.projects.map(p=>{
 const c=p.candidates.find(c=>c.kind==='name'&&c.distanceIfGcj<=2);
 const ok=reviewed.has(p.row)&&!!c&&!p.error;
 if(reviewed.has(p.row)&&!ok)throw Error('复核记录不满足坐标条件：'+p.name);
 return validatePortfolioLocation({name:p.name,sourceKey:p.sourceKey,sourceHash:audit.sourceHash,sourceFile:audit.sourceFile,address:p.address,
  status:ok?'confirmed':'pending',crs:ok?'GCJ02':'unknown',coordinate:ok?p.suppliedPoint:null,
  evidence:ok?`原表第${p.row}行坐标由豆包搜索提供；按GCJ02转换。已交叉核对高德项目名称“${c.name}”、地址“${c.address}”，坐标差${c.distanceIfGcj}米。仅项目级参考定位，非测绘成果。核查日期：${p.checkedAt.slice(0,10)}。`:
  (!p.suppliedPoint?'原表缺少有效坐标，保留资料并标红待定位。':reasons[p.row]||'原表地址、项目名称和坐标尚未同时取得一致证据；保留原始资料，暂不落点。')});
});
fs.writeFileSync('outputs/portfolio-locations-reviewed.json',JSON.stringify({format:'anju-portfolio-locations-v1',projects},null,2));
console.log(JSON.stringify({total:projects.length,confirmed:projects.filter(p=>p.status==='confirmed').length,pending:projects.filter(p=>p.status==='pending').length}));
