// Convert the reviewed DOCX extraction to a safe, source-faithful schema snapshot.
import fs from 'node:fs';
const source=JSON.parse(fs.readFileSync('outputs/0908-logic-review-extracted.json','utf8'));
const mapping={1:1,2:2,3:3,4:5,5:6,6:7,7:9,8:15,9:18,10:21,11:31,12:23,13:38,14:25,15:4,16:8,17:11,18:12,19:13,24:16,25:17};
const fixedColumns={2:[0],3:[0,1],5:[0,1,5],15:[0],16:[0],25:[0],4:[0]};
const templates=Object.entries(mapping).map(([id,number])=>{
 const segment=structuredClone(source.structures[number-1]);
 for(const [ri,row] of segment.rows.entries())for(const cell of row.cells){
   const keep=ri===0||(fixedColumns[id]||[]).includes(cell.col)||(Number(id)===24&&ri>=4);
   if(!keep){cell.text='';cell.role='value';}else cell.role='static';
 }
 // Rates and geography in the example are project-specific, not company defaults.
 if(Number(id)===5){
   segment.rows[7].cells.find(c=>c.col===5).text='不可预见费按当前项目已确认取费比例及基数计算';
   segment.rows[8].cells.find(c=>c.col===5).text='委托代建费按当前项目合同及已确认取费口径计算';
 }
 if(Number(id)===16){segment.rows[0].cells[1].text='项目所在市（统计年）';segment.rows[0].cells[2].text='项目所在区（统计年）';}
 if(Number(id)===24){
   segment.rows.at(-1).cells[0].text='因此，本项目住宅房地产的租金单价为【待填：经核验的加权修正租金】元/平方米·月。';
 }
 // Preserve existing longer models; expand truly short blank details to four rows.
 while(segment.rows.length<5){const row=structuredClone(segment.rows[1]);for(const c of row.cells){c.text='';c.role='value';c.vMerge='';}segment.rows.push(row);}
 return {id:`gaibao-housing-table-${String(id).padStart(2,'0')}`,sourceTableNumbers:[number],segments:[segment]};
});
fs.writeFileSync('data/report-table-housing-v6-source-schemas.json',JSON.stringify({fileName:source.source.split(/[\\/]/).at(-1),sha256:source.sha256,templates},null,2)+'\n');
console.log({sourceSchemas:templates.length});
