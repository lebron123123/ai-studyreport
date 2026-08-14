/* AI PPT 证据包：把多份本地材料统一成可追溯、可供AI规划的结构。浏览器与 Node 测试共用。 */
(function(root){
  "use strict";
  const clean=(v,n=200000)=>String(v==null?"":v).replace(/\r/g,"").trim().slice(0,n);
  const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,"0");};
  const kindOf=name=>{const x=String(name||"").toLowerCase().split(".").pop();return ({docx:"word",pdf:"pdf",xlsx:"excel",xls:"excel",csv:"excel",txt:"text",md:"markdown"})[x]||"text";};
  function numericFacts(text,sourceId,label){
    const out=[],seen=new Set(),lines=clean(text).split(/\n+/);
    lines.forEach((line,li)=>{
      const compact=line.replace(/\s+/g," ").trim();if(compact.length<4||compact.length>360)return;
      const matches=compact.match(/(?:\d{4}年|[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|亿元|万元|元\/㎡|元|㎡|m²|人|户|套|个|公里|km|年|月|季度))/gi)||[];
      if(!matches.length)return;
      const key=compact.slice(0,180);if(seen.has(key))return;seen.add(key);
      out.push({id:"fact_"+sourceId+"_"+(li+1),statement:key,values:matches.slice(0,8),sourceId,sourceLabel:label,locator:"文本第"+(li+1)+"行",confidence:"source"});
    });
    return out.slice(0,240);
  }
  function normalizeAsset(item,index){
    const name=clean(item&&item.name,160)||("材料"+(index+1)),text=clean(item&&item.text),id=clean(item&&item.id,80)||("src_"+hash(name+"|"+text.slice(0,2000)));
    const sheets=Array.isArray(item&&item.sheets)?item.sheets.slice(0,80).map(s=>({name:clean(s.name,80),range:clean(s.range,80),rows:Array.isArray(s.rows)?s.rows.slice(0,120):[]})):[];
    return{id,name,kind:clean(item&&item.kind,30)||kindOf(name),size:Number(item&&item.size)||text.length,text,sheets,version:clean(item&&item.version,40)||"本次导入",period:clean(item&&item.period,60),importedAt:Number(item&&item.importedAt)||Date.now()};
  }
  function buildEvidencePack(items,opts={}){
    const assets=(Array.isArray(items)?items:[]).map(normalizeAsset).filter(x=>x.text||x.sheets.length);
    const facts=assets.flatMap(x=>numericFacts(x.text,x.id,x.name));
    const tables=[];assets.forEach(x=>x.sheets.forEach((s,i)=>tables.push({id:"table_"+x.id+"_"+i,title:s.name||x.name,sourceId:x.id,sourceLabel:x.name,locator:(s.name||"Sheet")+(s.range?"!"+s.range:""),rows:s.rows})));
    const sourceRefs=assets.map(x=>({id:x.id,label:x.name,kind:x.kind,version:x.version,period:x.period||"未标注",locator:x.sheets.length?x.sheets.map(s=>s.name).join("、"):"全文"}));
    return{schemaVersion:1,title:clean(opts.title,120)||"PPT材料证据包",assets,facts,tables,sourceRefs,summary:{assetCount:assets.length,factCount:facts.length,tableCount:tables.length,totalChars:assets.reduce((n,x)=>n+x.text.length,0)},createdAt:Date.now()};
  }
  function evidenceText(pack,maxChars=60000){
    let used=0,out=[];for(const a of (pack&&pack.assets)||[]){const head="\n\n[来源 "+a.name+"｜"+a.kind+"｜"+(a.version||"本次导入")+"]\n",left=Math.max(0,maxChars-used-head.length);if(left<=0)break;const body=a.text.slice(0,left);out.push(head+body);used+=head.length+body.length;}return out.join("").trim();
  }
  const api={kindOf,buildEvidencePack,evidenceText,numericFacts};root.PptEvidence=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
