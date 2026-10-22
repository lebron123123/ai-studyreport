// Shared contract for the applied real-project ranking. Never stores project input snapshots.
const numeric='area units rent rentSpan rentRate collect collectRentPct collectReductionPct projectSharePct deco decoInt decoRatio unitCost operateRentPct startup costSpan costRate firstDecoLoanPct loanRate discount stableOcc collectPct sharePct rampIntervalMonths principalRepayIntervalMonths principalRepayPct principalRepayFinalMonth'.split(' ');
const dates='buildStartMonth buildEndMonth operateStartMonth operateEndMonth rampEndMonth'.split(' ');
export function fieldFor(row){
 const key=row.key;
 if(numeric.includes(key))return {key,label:row.label||key};
 if(dates.includes(key))return {key,label:row.label||key,inputKind:'month'};
 if(key==='mode')return {key,label:'合作模式',inputKind:'mode'};
 if(/^rampRates\.\d+$/.test(key))return {key:'rampRates',label:'各阶段爬坡出租率（0—1，分号分隔）',inputKind:'rates'};
 return null;
}
export function validateSelection(data){
 if(!data||data.version!=='anju-global-v2'||data.selectionApplied!==true||!Number.isFinite(data.threshold)||data.threshold<0||!Number.isInteger(data.N)||data.N<300||data.N>5000||!Array.isArray(data.table)||!data.table.length||data.table.length>1500)throw Error('敏感性应用数据无效');
 const classified=data.selectionMode==='impact-v4';
 const weighted=data.selectionMode==='impact-v3'||classified;
 const actualOnly=data.selectionMode==='impact-v2'||weighted;
 const impact=data.selectionMode==='impact-v1'||actualOnly;
 if(data.selectionMode!==undefined&&!impact)throw Error('未知筛选模式');
 if(impact&&(!data.criteria||data.criteria.sti!==data.threshold||!['irr','npv'].every(k=>data.criteria[k]===null||(Number.isFinite(data.criteria[k])&&data.criteria[k]>=0))))throw Error('实际影响门槛无效');
 const seen=new Set();
 if(weighted&&!(data.criteria.weighted===null||(Number.isFinite(data.criteria.weighted)&&data.criteria.weighted>=0)))throw Error('综合门槛无效');
 const maxIrr=Math.max(0,...data.table.map(r=>r.irrDeviation)),maxNpv=Math.max(0,...data.table.map(r=>r.npvDeviation));
 for(const r of data.table){
  if(!fieldFor(r)||seen.has(r.key)||!['STi','Si','STiLow','STiHigh','spearmanRho','src','combinedRank'].every(k=>Number.isFinite(r[k]))||r.STi<0||typeof r.selected!=='boolean'||(!impact&&r.selected!==(r.STi>=data.threshold)))throw Error('排名字段、数值或阈值选择不一致');
  if(impact){
   if(classified&&(!['fixed','assumed','actual'].includes(r.policy)||dates.includes(r.key)||(r.policy==='fixed'&&r.selected)))throw Error('固定规则或时间边界不得作为关键采集项');
   if(!['manual','threshold'].includes(r.selectionSource)||!['irrDeviation','npvDeviation'].every(k=>Number.isFinite(r[k])&&r[k]>=0))throw Error('实际影响摘要无效');
   if(actualOnly&&r.key==='mode')throw Error('合作模式不参与排名');
   if(weighted&&(!(r.npvRelative===null||(Number.isFinite(r.npvRelative)&&r.npvRelative>=0))||!Number.isFinite(r.weightedScore)||Math.abs(r.weightedScore-(.5*(maxIrr?r.irrDeviation/maxIrr:0)+.5*(maxNpv?r.npvDeviation/maxNpv:0)))>1e-10))throw Error('综合影响摘要无效');
   const expected=weighted?((data.criteria.irr!==null&&r.irrDeviation>data.criteria.irr)||(data.criteria.npv!==null&&r.npvRelative!==null&&r.npvRelative>data.criteria.npv)||(data.criteria.weighted!==null&&r.weightedScore>data.criteria.weighted)):(!actualOnly&&r.STi>=data.threshold)||(data.criteria.irr!==null&&r.irrDeviation>=data.criteria.irr)||(data.criteria.npv!==null&&r.npvDeviation>=data.criteria.npv);
   if(r.selectionSource==='threshold'&&r.selected!==(classified&&r.policy==='fixed'?false:expected))throw Error('实际影响推荐与门槛不一致');
  }
  seen.add(r.key);
 }
 if(Object.keys(data).some(k=>!['version','createdAt','N','seed','threshold','selectionApplied','table','selectionMode','criteria'].includes(k)))throw Error('应用配置不得包含项目原始数据');
 return data;
}
export function selectedFields(data){
 const impact=['impact-v1','impact-v2','impact-v3','impact-v4'].includes(data.selectionMode);
 const seen=new Set();return data.table.filter(r=>r.selected===true&&(impact||r.STi>=data.threshold)).slice().sort((a,b)=>impact?b.irrDeviation-a.irrDeviation:a.combinedRank-b.combinedRank).flatMap(r=>{const f=fieldFor(r);if(!f||seen.has(f.key))return [];seen.add(f.key);return [f];});
}
