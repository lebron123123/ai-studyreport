// Read-only diagnosis: isolated test browser; no AI calls or project writes.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSnapshots,loadIsolation,openProductionHarness} from './report-generation-acceptance.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=await loadSnapshots(path.join(root,'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5'));
const isolation=await loadIsolation(snapshot,{baseUrl:'http://localhost:8080'});
const h=await openProductionHarness(isolation,'tax',{readOnly:true,allowAi:false});
try{
  const opened=await isolation.sessions.tax.request('/api/projects?id='+isolation.sessions.tax.target.id);
  if(!opened.ok||opened.project?.id!==isolation.sessions.tax.target.id)throw Error('Exact isolated project required');
  const data=opened.project.data,draft=data.draft||data;
  console.log(JSON.stringify(await h.page.evaluate(async saved=>{
    restoreDraft(saved,{deferRender:true});
    const context=reportFinancialContext(),old=chapters[8].sections[3].pendingRevision.completionFinancialSource;
    const result=runCalcEngine('gaibao',JSON.parse(JSON.stringify(calcParams)));
    result.__ctype='gaibao';
    result.sens=computeSensitivity(calcParams);result.modeCompare=computeModeCompare(calcParams);
    const fresh=ReportFinancialTables.bindSource({...context,result});
    const loaded=ReportFinancialTables.bindSource(context);
    const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
    const diffs=[];
    function walk(a,b,p=''){
      if(JSON.stringify(a)===JSON.stringify(b))return;
      if(a&&b&&typeof a==='object'&&typeof b==='object')for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],p+'/'+k);
      else diffs.push({path:p,old:a===undefined?'[missing]':a,new:b===undefined?'[missing]':b});
    }
    walk(JSON.parse(old.sourceSignature),JSON.parse(fresh.sourceSignature));
    return {projectId:currentProjectId,newPaidAiCalls:0,projectWrites:0,
      snapshots:[old,fresh,loaded].map(({snapshotId,snapshotVersion})=>({snapshotId,snapshotVersion})),
      hashes:await Promise.all([old,fresh,loaded].map(x=>digest(x.sourceSignature))),
      totalDifferences:diffs.length,differences:diffs.slice(0,35)};
  },draft)));
  if(h.ledger.some(x=>x.isAi&&x.allowed))throw Error('Unexpected AI dispatch');
}finally{await h.close();}
