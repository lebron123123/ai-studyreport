// Ten actual portfolio project centers, selected before viewing price results.
import {readFile,writeFile} from 'node:fs/promises';
import {rentalInventory} from '../functions/api/_rental-inventory.js';
import {rentalCoverage} from '../project-map/rental-coverage.mjs';
const names=['安居百泉阁','安居云畔','安居南馨苑','安居鸿栖台','安居福厦里','安居颢龙苑','安居华越龙苑','安居瑞龙苑','安居凤凰苑','安居鸣鹿苑'];
const target=new URL('../outputs/rental-surrounding-ten-20260918.json',import.meta.url);
const portfolio=JSON.parse(await readFile(new URL('../outputs/portfolio-locations-reviewed.json',import.meta.url),'utf8'));
let report;try{report=JSON.parse(await readFile(target,'utf8'));}catch{report={definition:'10个安居项目各自2km周边住宅竞品固定分母；直接租或售报价覆盖率每项目>=90%；参考价另计',createdAt:new Date().toISOString(),projects:names.map(name=>{const p=portfolio.projects.find(p=>p.status==='confirmed'&&p.name.startsWith(name));if(!p)throw Error('缺少已核实中心：'+name);return {name,sourceKey:p.sourceKey,point:p.point,address:p.address,radius:2000};})};}
for(const project of report.projects){
 if(!project.inventory?.complete){try{project.inventory=await rentalInventory(process.env,{...project,projectName:project.name});delete project.error;}catch(e){project.error=e.message;}}
 project.coverage=rentalCoverage(project.inventory?.communities||[],project.observations||[]);
 await writeFile(target,JSON.stringify(report,null,2));
 console.log(JSON.stringify({name:project.name,competitors:project.inventory?.communities.length,complete:project.inventory?.complete,error:project.error}));
}
