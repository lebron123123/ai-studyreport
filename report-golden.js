/* AI可研黄金项目样本与离线评测。 */
(function(root){
  "use strict";
  function rgText(v){return String(v==null?"":v).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
  function rgSections(chapters){const out=[];(chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>out.push({key:String(c.cn)+":"+si,chapter:c.name||"",title:s.t||"",text:rgText(s.editedHtml||s.content||""),numeric:!!s.numeric,trust:s.trust||null,prov:s.prov||null})));return out;}
  function createSample(input){
    input=input||{};
    const sections=Array.isArray(input.chapters)?rgSections(input.chapters):Array.isArray(input.sections)?input.sections.map((s,i)=>({key:String(s.key||i+1),chapter:String(s.chapter||""),title:String(s.title||s.t||""),text:rgText(s.text||s.editedHtml||s.content||""),numeric:!!s.numeric,trust:s.trust||null,prov:s.prov||null})):[];
    const facts=input.expectedFacts||{};
    return {schemaVersion:2,name:String(input.name||"未命名黄金项目"),calcType:String(input.calcType||""),projectType:String(input.projectType||input.calcType||""),region:String(input.region||""),tags:Array.isArray(input.tags)?input.tags:[],datasetRole:input.datasetRole==="holdout"?"holdout":"training",sourceProjectId:String(input.sourceProjectId||""),sourceDocument:input.sourceDocument||{},approvalStatus:String(input.approvalStatus||"candidate"),sections,expectedFacts:facts,reviewBaseline:input.reviewBaseline||{},createdAt:input.createdAt||new Date().toISOString()};
  }
  function rgNumber(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function editDistanceRatio(left,right){left=rgText(left).slice(0,4000);right=rgText(right).slice(0,4000);if(left===right)return 0;if(!left||!right)return 1;let prev=Array.from({length:right.length+1},(_,i)=>i);for(let i=1;i<=left.length;i+=1){const next=[i];for(let j=1;j<=right.length;j+=1)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(left[i-1]===right[j-1]?0:1));prev=next;}return prev[right.length]/Math.max(left.length,right.length);}
  function evaluate(sample,candidate){
    sample=sample||{};candidate=candidate||{};const expected=sample.sections||[],actual=rgSections(candidate.chapters),byTitle=new Map(actual.map(x=>[x.chapter+"|"+x.title,x]));
    const matched=expected.map(x=>({expected:x,actual:byTitle.get(x.chapter+"|"+x.title)||null})),coverage=expected.length?matched.filter(x=>x.actual&&x.actual.text).length/expected.length:0;
    const missing=actual.filter(x=>/【待补[:：]|待填|待核|暂无数据|尚未提供/.test(x.text)).length,missingRate=actual.length?missing/actual.length:1;
    const factRows=Object.entries(sample.expectedFacts||{}),factResults=factRows.map(([key,value])=>{const actualValue=candidate.facts&&candidate.facts[key]!==undefined?candidate.facts[key]:candidate.summary&&candidate.summary[key],a=rgNumber(actualValue),b=rgNumber(value),ok=a!==null&&b!==null?Math.abs(a-b)<=Math.max(Math.abs(b)*0.005,0.01):String(actualValue)==String(value);return {key,expected:value,actual:actualValue,ok};}),factAccuracy=factRows.length?factResults.filter(x=>x.ok).length/factRows.length:1;
    const trustScores=actual.map(x=>Number(x.trust&&x.trust.score)).filter(Number.isFinite),trust=trustScores.length?trustScores.reduce((a,b)=>a+b,0)/trustScores.length/100:0.5;
    const audit=candidate.preSubmitAudit||{},auditScore=audit.ready===false?Math.max(0,1-(Number(audit.blockerCount)||1)*0.12):Math.max(0,1-(Number(audit.warningCount)||0)*0.02);
    const modificationDistance=expected.length?matched.reduce((n,x)=>n+(x.actual?editDistanceRatio(x.expected.text,x.actual.text):1),0)/expected.length:0,research=candidate.researchAudit||{},executed=Math.max(0,Number(research.executedQueries)||0),accepted=Math.max(0,Number(research.acceptedQueries)||0),unnecessary=Math.max(0,executed-accepted);
    const score=Math.round((coverage*0.3+factAccuracy*0.3+(1-missingRate)*0.15+trust*0.15+auditScore*0.1)*100);
    return {schemaVersion:2,datasetRole:sample.datasetRole==="holdout"?"holdout":"training",sourceProjectId:String(sample.sourceProjectId||""),score,grade:score>=90?"优秀":score>=80?"合格":score>=70?"待改进":"不合格",metrics:{sectionCoverage:Math.round(coverage*100),factAccuracy:Math.round(factAccuracy*100),factualErrorRate:Math.round((1-factAccuracy)*100),humanModificationDistance:Math.round(modificationDistance*100),missingRate:Math.round(missingRate*100),trustScore:Math.round(trust*100),auditScore:Math.round(auditScore*100),unnecessaryWebQueries:unnecessary},factResults,missingSections:matched.filter(x=>!x.actual||!x.actual.text).map(x=>x.expected.title),passed:score>=80&&factAccuracy>=0.95&&audit.ready!==false};
  }
  function aggregate(runs){runs=Array.from(runs||[]);const basic=xs=>({count:xs.length,average:xs.length?Math.round(xs.reduce((n,x)=>n+(Number(x.score)||0),0)/xs.length):0,passRate:xs.length?Math.round(xs.filter(x=>x.passed).length/xs.length*100):0,lowest:xs.length?Math.min(...xs.map(x=>Number(x.score)||0)):0}),all=basic(runs),training=basic(runs.filter(x=>x.datasetRole!=="holdout")),holdout=basic(runs.filter(x=>x.datasetRole==="holdout"));return {...all,training,holdout,crossProjectGeneralization:holdout.count?holdout.passRate:null,overfitGap:holdout.count?Math.max(0,training.average-holdout.average):null};}
  const api={sections:rgSections,createSample,evaluate,aggregate,editDistanceRatio};root.ReportGolden=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
