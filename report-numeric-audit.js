/* Deterministic numeric reconciliation. It does not certify semantics or page layout. */
(function(root){
  'use strict';
  const arr=v=>Array.isArray(v)?v:[],text=v=>String(v==null?'':v),escape=v=>text(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const CHINESE='零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟';
  const NUMBER='[+\\-−]?\\d[\\d,，]*(?:\\.\\d+)?|[负正]?['+CHINESE+']+(?:点[零〇一二两三四五六七八九]+)?';
  const UNIT='元\\s*[/／]\\s*(?:平方米|㎡|m²|m2)\\s*[/／]\\s*(?:月|年)|万元|亿元|千万元|百万元|千元|元|万平方米|平方米|㎡|m²|m2|个百分点|百分点|[%％]|年|个月|月|万套|套|万人|人|万户|户|倍';
  const BARRIERS=/(?:总投资|营业收入|运营收入|收入|净利润|利润总额|净利润率|营业利润率|总成本|成本|税前(?:项目|资本金)?(?:IRR|内部收益率)|税后(?:项目|资本金)?(?:IRR|内部收益率)|资本金(?:IRR|内部收益率)|项目(?:IRR|内部收益率)|建筑面积|租金|投资回收期|净现值)/ig;
  function chineseNumber(value){
    let s=text(value).trim().replace(/[，,]/g,'').replace(/−/g,'-');if(!s)return null;
    if(/^[+\-]?\d+(?:\.\d+)?$/.test(s))return Number(s);
    const map={壹:'一',贰:'二',叁:'三',肆:'四',伍:'五',陆:'六',柒:'七',捌:'八',玖:'九',拾:'十',佰:'百',仟:'千',〇:'零',两:'二'};
    s=s.replace(/[壹贰叁肆伍陆柒捌玖拾佰仟〇两]/g,c=>map[c]);let sign=1;if(s.startsWith('负')){sign=-1;s=s.slice(1);}else if(s.startsWith('正'))s=s.slice(1);
    const digits={零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},small={十:10,百:100,千:1000};
    const pieces=s.split('点');if(pieces.length>2||!pieces[0])return null;
    const integer=pieces[0];if(/^[百千万亿]+$/.test(integer))return null;let total=0,section=0,current=0;
    if(/^[零一二三四五六七八九]+$/.test(integer))total=Number([...integer].map(c=>digits[c]).join(''));
    else for(const c of integer){if(c in digits)current=digits[c];else if(c in small){section+=(current||1)*small[c];current=0;}else if(c==='万'){section=(section+current)*10000;total+=section;section=0;current=0;}else if(c==='亿'){total=(total+section+current)*100000000;section=0;current=0;}else return null;}
    if(!/^[零一二三四五六七八九]+$/.test(integer))total+=section+current;
    let fraction=0;if(pieces[1]!==undefined){if(!/^[零一二三四五六七八九]+$/.test(pieces[1]))return null;fraction=Number('0.'+[...pieces[1]].map(c=>digits[c]).join(''));}
    return sign*(total+fraction);
  }
  function unitInfo(value){
    const unit=text(value).replace(/\s+/g,'').replace(/％/g,'%').replace(/／/g,'/').replace(/m2|m²|㎡/g,'平方米');
    const units={元:['money',1],千元:['money',1000],万元:['money',10000],百万元:['money',1000000],千万元:['money',10000000],亿元:['money',100000000],'%':['percent',1],百分比:['percent',1],百分点:['percentage_point',1],个百分点:['percentage_point',1],平方米:['area',1],万平方米:['area',10000],年:['time_months',12],月:['time_months',1],个月:['time_months',1],套:['units',1],万套:['units',10000],人:['people',1],万人:['people',10000],户:['households',1],万户:['households',10000],倍:['multiple',1],'元/平方米/月':['rent_per_area_month',1],'元/平方米/年':['rent_per_area_month',1/12]};
    const result=units[unit];return result?{unit,dimension:result[0],factor:result[1]}:null;
  }
  function normalize(value,unit){const n=typeof value==='number'?value:chineseNumber(value),info=unitInfo(unit);return Number.isFinite(n)&&info?{value:n,unit:info.unit,baseValue:n*info.factor,dimension:info.dimension,factor:info.factor}:null;}
  function plain(value){return text(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<\/(?:p|div|tr|table|h[1-6])\s*>|<br\s*\/?>/gi,'\n').replace(/<\/(?:td|th)\s*>/gi,' | ').replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>Number(n)<=1114111?String.fromCodePoint(Number(n)):'' );}
  function tokens(value,fallbackUnit){
    const out=[],re=new RegExp('百分之\\s*('+NUMBER+')|('+NUMBER+')\\s*(?:[|｜]\\s*)?[（(]?('+UNIT+')[）)]?','g');
    for(const m of value.matchAll(re)){const raw=m[0],number=m[1]??m[2],unit=m[1]!==undefined?'%':m[3],normalized=normalize(number,unit);if(normalized)out.push({raw,index:m.index,end:m.index+raw.length,...normalized});}
    if(!out.length&&fallbackUnit){const m=new RegExp('^\\s*('+NUMBER+')\\s*$').exec(value);if(m){const normalized=normalize(m[1],fallbackUnit);if(normalized)out.push({raw:m[0],index:0,end:value.length,unitInferredFromHeader:true,...normalized});}}
    return out;
  }
  function aliases(entry){return [...new Set([entry.label,...arr(entry.aliases)].map(x=>text(x).trim()).filter(Boolean))].sort((a,b)=>b.length-a.length);}
  function qualifierMismatch(entry,context){
    const identity=text(entry.key)+' '+text(entry.label),flags=[['税前','税后'],['资本金','项目']];
    for(const [a,b] of flags)if(identity.includes(a)&&context.includes(b)&&!context.includes(a)||identity.includes(b)&&context.includes(a)&&!context.includes(b))return true;
    return false;
  }
  function audit(input){
    input=input||{};const raw=plain(input.text??input.raw??''),expected=arr(input.expected),checked=expected.map((entry,i)=>({key:text(entry.key||entry.label||'metric-'+i),label:text(entry.label),aliases:aliases(entry),expected:normalize(entry.value,entry.unit),sourceRef:text(entry.sourceRef),version:entry.version??null,tolerance:typeof entry.tolerance==='number'&&entry.tolerance>=0?entry.tolerance:0,occurrences:[],status:'missing'})),unmatched=[],findings=[];
    const known=checked.flatMap((c,i)=>c.aliases.map(alias=>({alias,index:i}))).sort((a,b)=>b.alias.length-a.alias.length),lines=raw.split(/\r?\n/);let headers=null;
    function inspect(segment,line,header){
      const matches=[];for(const item of known){const regex=new RegExp(escape(item.alias),'gi');for(const m of segment.matchAll(regex)){if(matches.some(x=>m.index>=x.start&&m.index<x.end))continue;matches.push({start:m.index,end:m.index+m[0].length,entry:item.index,alias:m[0]});}}
      matches.sort((a,b)=>a.start-b.start);const headerUnit=header?.match(new RegExp('[（(]\\s*('+UNIT+')\\s*[）)]'))?.[1],observed=tokens(segment,headerUnit);
      for(const token of observed){
        let match=matches.filter(m=>m.end<=token.index).at(-1);
        if(!match&&header){const hit=known.find(x=>header.includes(x.alias));if(hit)match={start:0,end:0,entry:hit.index,alias:hit.alias,header:true};}
        if(!match){unmatched.push({kind:'unbound_number',line,raw:token.raw,context:segment,reason:'未绑定声明指标'});continue;}
        const entry=checked[match.entry],between=segment.slice(match.end,token.index),context=segment.slice(Math.max(0,match.start-12),token.end),barrier=between.match(BARRIERS);
        if(qualifierMismatch(expected[match.entry],header||context)||barrier){unmatched.push({kind:'ambiguous_metric',line,raw:token.raw,context:segment,reason:'存在其他指标或税前/税后、项目/资本金口径不一致'});continue;}
        entry.occurrences.push({...token,line,context:segment,alias:match.alias});
      }
      // A label's unit in parentheses is also an explicit unit declaration for a unitless value cell.
      if(!observed.length&&matches.length===1&&segment.includes('|')){const match=matches[0],tail=segment.slice(match.end),unit=tail.match(new RegExp('[（(]\\s*('+UNIT+')\\s*[）)]'))?.[1];if(unit){const cell=tail.split('|').map(x=>x.trim()).find(x=>new RegExp('^('+NUMBER+')$').test(x));if(cell)for(const token of tokens(cell,unit)){const index=segment.indexOf(cell,match.end),located={...token,index,end:index+cell.length};observed.push(located);checked[match.entry].occurrences.push({...located,line,context:segment,alias:match.alias});}}}
      // Naked values cannot inherit a metric's unit silently. Report them as uncovered,
      // except explicit header units, metric labels and structural section numbering.
      const declarations=[...segment.matchAll(new RegExp('[（(]\\s*(?:'+UNIT+')\\s*[）)]','g'))].map(m=>({start:m.index,end:m.index+m[0].length}));
      for(const m of segment.matchAll(new RegExp(NUMBER,'g'))){const start=m.index,end=start+m[0].length,n=chineseNumber(m[0]);if(n===null||observed.some(t=>start>=t.index&&end<=t.end)||matches.some(t=>start>=t.start&&end<=t.end)||declarations.some(t=>start>=t.start&&end<=t.end))continue;
        const structural=segment.match(/^\s*(?:#{1,6}\s*)?\d+(?:\.\d+)*[、.．\s]+/);
        if(structural&&end<=structural[0].length||segment[start-1]==='第'||/^[章节项条次]/.test(segment.slice(end)))continue;
        if(!/\d/.test(m[0])&&m[0].length===1&&!matches.length&&!/[|｜]/.test(segment))continue;
        unmatched.push({kind:'unit_unresolved',line,raw:m[0],context:segment,reason:'数值未声明可核验单位，或表格表头/指标关系尚未明确'});
      }
    }
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim();if(!line){headers=null;continue;}if(/^\|?\s*:?-{3,}[-:\s|]*$/.test(line))continue;
      if(line.includes('|')){
        const cells=line.replace(/^\||\|$/g,'').split('|').map(x=>x.trim()),hasLabel=cells.some(cell=>known.some(x=>cell.includes(x.alias)));
        if(hasLabel&&!tokens(line).length&&cells.length>1){headers=cells;inspect(line,i+1);continue;}
        if(headers&&!hasLabel&&cells.length===headers.length){for(let j=0;j<cells.length;j++)inspect(cells[j],i+1,headers[j]);continue;}
        inspect(line,i+1);continue;
      }
      headers=null;for(const sentence of line.split(/[。；;!?！？]+/).filter(Boolean))inspect(sentence,i+1);
    }
    for(const entry of checked){
      if(!entry.expected){entry.status='invalid_expected';findings.push({kind:'invalid_expected',severity:'error',key:entry.key,label:entry.label,message:'期望值或单位未声明/无效，不能按0处理'});continue;}
      if(!entry.occurrences.length){entry.status='missing';findings.push({kind:'missing',severity:'error',key:entry.key,label:entry.label,message:'全文未找到可明确对应的带单位数值'});continue;}
      const tolerance=entry.tolerance*entry.expected.factor,units=entry.occurrences.filter(x=>x.dimension!==entry.expected.dimension),different=entry.occurrences.filter(x=>x.dimension===entry.expected.dimension&&Math.abs(x.baseValue-entry.expected.baseValue)>Math.max(tolerance,Math.abs(entry.expected.baseValue)*1e-12));
      entry.status=units.length?'unit_mismatch':different.length?'mismatch':'matched';
      if(units.length)findings.push({kind:'unit_mismatch',severity:'error',key:entry.key,label:entry.label,observed:units,message:'单位量纲不一致，百分比不能当作百分点'});
      if(different.length)findings.push({kind:'value_mismatch',severity:'error',key:entry.key,label:entry.label,expected:entry.expected,observed:different,sourceRef:entry.sourceRef,version:entry.version,message:'正文数值与声明的依据不一致'});
      const comparable=entry.occurrences.filter(x=>x.dimension===entry.expected.dimension);if(comparable.some(x=>Math.abs(x.baseValue-comparable[0].baseValue)>Math.max(tolerance,Math.abs(comparable[0].baseValue)*1e-12)))findings.push({kind:'conflicting_occurrences',severity:'error',key:entry.key,label:entry.label,observed:comparable,message:'同一指标在全文不同位置的数值相互冲突'});
    }
    if(unmatched.length)findings.push({kind:'unmatched_numbers',severity:'warning',count:unmatched.length,message:'部分数值未绑定明确指标与依据，需人工核对'});
    const declaredNumbersPassed=checked.length>0&&checked.every(x=>x.status==='matched');
    return {schemaVersion:1,method:'full-report-numeric-reconciliation-v1',passed:declaredNumbersPassed&&!unmatched.length,declaredNumbersPassed,findings,checked,unmatched,coverage:{lines:lines.length,characters:raw.length,expected:checked.length,observed:checked.reduce((n,c)=>n+c.occurrences.length,0),unmatched:unmatched.length,complete:declaredNumbersPassed&&!unmatched.length},semanticAccuracyVerified:false,wordLayoutVerified:false};
  }
  const api={audit,normalizeNumber:chineseNumber,normalize,unitInfo};root.ReportNumericAudit=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
