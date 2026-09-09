// Deterministic report checks. Passing checks is not human sign-off or semantic proof.
import '../../report-numeric-audit.js';
const numericAudit=globalThis.ReportNumericAudit;
const list = value => Array.isArray(value) ? value : [];
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function validateQualityContract(contract = {}) {
  for (const key of ['required','forbidden','headings','tables','numbers','citations','expected']) {
    if (contract[key] !== undefined && (!Array.isArray(contract[key]) || contract[key].length > 200)) throw new Error('检查条件必须为不超过200项的数组：'+key);
  }
  for (const key of ['required','forbidden','headings']) if (list(contract[key]).some(x=>typeof x!=='string'||!x.trim()||x.length>500)) throw new Error('检查文本无效：'+key);
  for (const n of list(contract.numbers)) if (!n.label || !n.unit || typeof n.value!=='number' || !Number.isFinite(n.value) || (n.tolerance!==undefined && (typeof n.tolerance!=='number'||!Number.isFinite(n.tolerance)||n.tolerance<0))) throw new Error('数值检查必须包含名称、数值、单位和非负绝对容差');
  for (const n of list(contract.expected)) {
    if (!n || typeof n.label!=='string'||!n.label.trim()||n.label.length>500||!numericAudit.normalize(n.value,n.unit)||(n.aliases!==undefined&&(!Array.isArray(n.aliases)||n.aliases.length>30||n.aliases.some(x=>typeof x!=='string'||!x.trim()||x.length>500)))||(n.tolerance!==undefined&&(typeof n.tolerance!=='number'||!Number.isFinite(n.tolerance)||n.tolerance<0))) throw new Error('全文数值检查必须声明有效名称、数值、单位、别名与容差');
    if (typeof n.sourceRef!=='string'||!n.sourceRef.trim()||n.version===undefined||n.version===null||String(n.version).trim()==='') throw new Error('全文数值检查必须保留来源与版本');
  }
  for (const t of list(contract.tables)) if (!t.title || !Array.isArray(t.columns) || !t.columns.length || t.columns.some(x=>typeof x!=='string'||!x.trim()) || !Number.isSafeInteger(t.minRows) || t.minRows<1) throw new Error('表格检查必须包含标题、列名和最少数据行数');
  for (const c of list(contract.citations)) if (!c.marker || !c.location || !/^[a-f0-9]{64}$/.test(c.sourceHash||'')) throw new Error('引用检查必须包含引用标识、原文位置和SHA-256');
  return contract;
}
export function scoreReportQuality(contract, raw) {
  validateQualityContract(contract);
  const text=String(raw||''), lines=text.split(/\r?\n/), checks=[];
  const add=(kind,value,passed,details={})=>checks.push({kind,value,passed,...details});
  list(contract.required).forEach(x=>add('required',x,text.includes(x)));
  list(contract.forbidden).forEach(x=>add('forbidden',x,!text.includes(x)));
  const headings=lines.filter(x=>/^\s*(?:#{1,6}\s|第[一二三四五六七八九十百\d]+[章节]\s*|\d+(?:\.\d+)*[、.\s])/.test(x));
  list(contract.headings).forEach(x=>add('heading',x,headings.some(h=>h.includes(x))));
  for(const n of list(contract.numbers)) {
    const matching=lines.filter(l=>l.includes(n.label));
    const re=new RegExp(escape(n.label)+'[^\\d\\n+\\-]{0,30}([+\\-]?\\d[\\d,]*(?:\\.\\d+)?)\\s*'+escape(n.unit),'g');
    const values=matching.flatMap(line=>Array.from(line.matchAll(re),m=>Number(m[1].replaceAll(',',''))));
    add('number',n.label,values.length>0&&values.every(v=>Math.abs(v-n.value)<=(n.tolerance||0)),{expected:n.value,unit:n.unit,observed:values});
  }
  const numericReconciliation=numericAudit.audit({text,expected:contract.expected||[]});
  if(numericReconciliation) {
    for(const item of numericReconciliation.checked) add('numeric_reconciliation',item.label,item.status==='matched',{key:item.key,status:item.status,expected:item.expected,observed:item.occurrences,sourceRef:item.sourceRef,version:item.version});
    if(contract.expected!==undefined&&!numericReconciliation.checked.length)add('numeric_reconciliation','已声明核验指标',false,{status:'not_configured'});
  }
  for(const t of list(contract.tables)) {
    const titleIndex=lines.findIndex(l=>l.includes(t.title));let found=false,rows=0;
    if(titleIndex>=0) for(let i=titleIndex;i<Math.min(lines.length,titleIndex+8);i++) {
      if(!lines[i].includes('|')||!t.columns.every(c=>lines[i].split('|').map(x=>x.trim()).includes(c))) continue;
      if(!/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')) continue;
      for(let j=i+2;j<lines.length&&lines[j].includes('|')&&lines[j].trim();j++) rows++;
      found=rows>=t.minRows;break;
    }
    add('table',t.title,found,{rows,minRows:t.minRows,format:'markdown'});
  }
  for(const c of list(contract.citations)) add('citation',c.marker,lines.some(l=>l.includes(c.marker)&&l.includes(c.location)),{sourceHash:c.sourceHash,location:c.location});
  if(contract.noPending===true)add('pending','无待补占位',!/(?:【|\[)\s*(?:待补|待核|待确认)|\bTODO\b/.test(text));
  const declaredChecksPassed=!!text.trim()&&checks.length>0&&checks.every(c=>c.passed);
  const coverageComplete=numericReconciliation.unmatched.length===0&&numericReconciliation.checked.every(x=>x.status==='matched');
  const meaningfulChecks=checks.some(c=>!['pending','forbidden'].includes(c.kind));
  const passed=declaredChecksPassed&&coverageComplete&&meaningfulChecks;
  return {passed,declaredChecksPassed,coverageComplete,humanReviewed:false,score:passed?100:Math.min(99,checks.length?Math.round(checks.filter(c=>c.passed).length/checks.length*100):0),checks,method:'deterministic-structured-v4',numericReconciliation,scope:'仅检查已声明条件和可识别数字；不代表全文事实、引用效力或版式已核验',semanticAccuracyVerified:false,wordLayoutVerified:false};
}
