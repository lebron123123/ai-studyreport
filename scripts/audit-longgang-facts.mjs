// Read-only local snapshot comparison. No project edits or financial recalculation.
import fs from 'node:fs/promises';
const dir='outputs/report-standardization',source=JSON.parse(await fs.readFile(dir+'/longgang-source.json','utf8'));
const draft=source.state.draft,kb=draft.kb||[];
const findings=[
 {name:'规模口径冲突',terms:['租赁运营范围','5973','195'],finding:'上传协议约5973㎡、195套；当前测算参数area=20000、units=500。不能把测算数值作为本项目已核实规模。',blocking:true},
 {name:'期限口径冲突',terms:['首期租赁运营期期限设定为6年'],finding:'协议草稿首期6年，自正式运营起计；当前测算operateYears=12、buildStart=2022。不得替用户选择批准口径。',blocking:true},
 {name:'合作模式冲突',terms:['优先抵扣乙方改造投入','不设置保底租金'],finding:'协议为优先抵扣改造投入后分配收益、不设保底租金；当前测算mode=lease、collect=25，现稿多处称满租金整租。须先确认模式再重新测算。',blocking:true},
 {name:'误报缺失：分房型套数',terms:['一居室约153套','二居室约42套'],finding:'协议2.1及研究报告第24页已有分房型数量。现稿“现有材料未提供分房型明细”不准确；草稿数值仍须最终批复确认。',blocking:true},
 {name:'误报缺失：竞品租金',terms:['[第12页]','1528','1472'],finding:'研究报告第12—16页有竞品租金与管理费。不能因地图渠道缺数据而认定全部上传材料无数据；历史调研时点和现行有效性仍待复核。',blocking:true},
 {name:'原材料内部面积差异',terms:['计容建筑面积','7977','7973'],finding:'研究报告记载计容7977㎡，协议稿为7973㎡。不能擅自统一；核对测绘及权证，不影响两份材料共同记载租赁范围约5973㎡这一事实。',blocking:true}
];
const escape=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const f of findings){f.evidence=[];for(const k of kb){const content=k.content||'';for(const term of f.terms){const at=content.indexOf(term);if(at>=0)f.evidence.push({material:k.title||k.name,term,excerpt:content.slice(Math.max(0,at-45),Math.min(content.length,at+180))});}}if(!f.evidence.length)throw Error('Missing evidence: '+f.name);}
await fs.writeFile(dir+'/longgang-fact-findings.json',JSON.stringify({status:'blocked-pending-model-confirmation',calcParams:draft.calcParams,findings},null,2));
await fs.writeFile(dir+'/longgang-fact-findings.html','<!doctype html><meta charset="utf-8"><title>龙岗事实核对</title><style>body{font:16px sans-serif;max-width:1000px;margin:40px auto;line-height:1.7;color:#183e5d}section{border:1px solid #ccd8e3;padding:20px;margin:20px 0}blockquote{background:#f4f6f8;padding:12px;font-size:14px}strong{color:#a33}</style><h1>龙岗候选稿：事实核对阻断清单</h1><p>2026-09-21 · 只读核对上传材料提取文本与当前工作稿/测算参数，不代表原件签章、效力或外部事实已认证。独立候选不可作为定稿，原有项目和43节待确认稿未覆盖。</p>'+findings.map(f=>'<section><h2>'+escape(f.name)+'</h2><strong>'+escape(f.finding)+'</strong>'+f.evidence.map(e=>'<blockquote>'+escape(e.material)+'<br>'+escape(e.excerpt)+'</blockquote>').join('')+'</section>').join(''));
console.log('Evidence-backed blocking findings:',findings.length);
