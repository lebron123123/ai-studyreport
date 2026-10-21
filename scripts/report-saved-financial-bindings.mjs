// Install one read-only browser bridge shared by saved-review and Word acceptance.
// This checks adopted references, never invents a candidate-generation receipt.
export function installSavedFinancialBindingsReader(){
  window.__qaReadSavedFinancialBindings=async function({projectId}){
    const C=window.ReportCompletionContract,F=window.ReportFinancialTables;
    if(!C?.verifyDocumentReferences||!C?.verifyDocumentReferenceDependencies||!C?.verifyFrozenTables||!F?.bindSource)throw Error('Saved financial validation modules unavailable');
    const memory=()=>JSON.stringify({currentProjectId,project,chapters,calcParams,projectWorkflow,financial:reportFinancialContext()});
    if(currentProjectId!==projectId)throw Error('Saved financial project identity mismatch');
    const before=memory(),assertCurrent=()=>{
      if(currentProjectId!==projectId||memory()!==before)throw Error('Read-only saved financial validation changed report memory');
    };
    const context=reportFinancialContext(),binding=F.bindSource(context);
    if(binding.projectId!==projectId)throw Error('Saved financial source project mismatch');
    const rows=chapters.flatMap((chapter,ci)=>chapter.sections.map((section,si)=>({
      key:chapter.name+' / '+section.t,number:(ci+1)+'.'+(si+1),section:JSON.parse(JSON.stringify(section)),
      text:section.editedHtml||renderContent(section.content||'')
    })));
    assertCurrent();
    const entries=rows.map(({key,number,text})=>({key,number,text}));
    const active=text=>String(text).replace(/<!--[\s\S]*?-->|<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
    const tables=text=>[...active(text).matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match=>match[0]);
    const hasReference=text=>{const box=document.createElement('div');box.innerHTML=active(text);return !!box.querySelector('.rpt-table-reference');};
    const requireValid=(ok,message)=>{if(!ok)throw Error(message);};
    const seenKeys=new Set();
    for(const row of rows){requireValid(!seenKeys.has(row.key),'Ambiguous saved section identity');seenKeys.add(row.key);}
    const candidate=row=>({after:row.section.editedHtml||row.section.content||'',completionContract:row.section.completionContract,
      completionInputPlanId:row.section.qaBoundedAiRevision?.currentInputIdentity});
    const candidateIssues=row=>reportFinancialCandidateIssues(candidate(row));
    const financialTables=row=>tables(row.text).filter(html=>F.hasFinancialTables(html));
    const checkStamps=html=>{
      C.safeFrozenTableHtml(html);
      const box=document.createElement('div');box.innerHTML=html;
      const table=box.querySelector('table');
      requireValid(table&&box.querySelectorAll('table').length===1,'Invalid saved financial table');
      const expected={'data-report-calc-snapshot':String(binding.snapshotId),'data-report-calc-version':String(binding.snapshotVersion),
        'data-report-calc-source':binding.version,'data-report-calc-project':projectId};
      requireValid(!!table.getAttribute('data-report-calc-kind'),'Missing financial table kind');
      for(const [name,value] of Object.entries(expected))requireValid(table.getAttribute(name)===value,'Saved financial table stamp changed: '+name);
      // Compare complete raw HTML below, not an eight-character cells fingerprint.
      return [...table.rows].map(row=>[...row.cells].map(cell=>[cell.tagName,cell.innerHTML,cell.rowSpan,cell.colSpan]));
    };
    const verified=new Set(),verifiedOwners=new Set();
    const checkOwner=async row=>{
      if(verifiedOwners.has(row.key))return;
      const contract=C.normalize(row.section.completionContract);
      requireValid(contract?.sectionKey===row.key&&!row.section.pendingRevision&&row.text.trim(),'Financial owner identity/body is not adopted');
      requireValid(/:financial=[^:]+$/.test(contract.frozenTables?.sourceSnapshotId||''),'Financial reference owner lacks frozen source identity');
      requireValid(candidateIssues(row).length===0,'Financial reference owner source is stale');
      await C.verifyFrozenTables(contract);assertCurrent();
      const actual=tables(row.text),frozen=contract.frozenTables.tables;
      // All frozen tables must still exist, including nonfinancial notes/merges.
      for(const table of frozen)requireValid(actual.filter(html=>html===table.html).length===1,'Financial owner frozen table changed or ambiguous');
      for(const html of financialTables(row)){
        checkStamps(html);
        requireValid(frozen.filter(table=>table.html===html).length===1,'Financial owner has an unbound local table');
      }
      verifiedOwners.add(row.key);
    };
    const checkReferences=async(row,path)=>{
      requireValid(!path.includes(row.key),'Cyclic saved financial references');
      if(verified.has(row.key))return;
      const contract=C.normalize(row.section.completionContract),manifest=contract?.documentReferences;
      requireValid(contract?.sectionKey===row.key&&!row.section.pendingRevision,'Saved reference section identity is not adopted');
      requireValid(manifest?.references?.length&&manifest.sourceNumber===row.number,'Saved table reference binding missing or wrong section number');
      await C.verifyDocumentReferences(contract);assertCurrent();
      C.verifyDocumentReferenceDependencies(contract,entries);
      for(const reference of manifest.references){
        const targets=rows.filter(target=>target.key===reference.targetKey&&target.number===reference.targetNumber);
        requireValid(targets.length===1,'Saved table reference owner missing or ambiguous');
        const owner=targets[0];
        requireValid(![...path,row.key].includes(owner.key),'Cyclic saved financial references');
        const financial=reference.tables.filter(html=>F.hasFinancialTables(html));
        if(financial.length){
          await checkOwner(owner);assertCurrent();
          const actual=tables(owner.text),frozen=owner.section.completionContract.frozenTables.tables;
          for(const html of financial){
            const cells=checkStamps(html);
            requireValid(actual.filter(value=>value===html).length===1&&frozen.filter(table=>table.html===html).length===1,'Referenced financial table content/merges/stamps changed or ambiguous');
            requireValid(JSON.stringify(cells)===JSON.stringify(checkStamps(actual.find(value=>value===html))),'Referenced financial cells changed');
          }
        }
        if(hasReference(owner.text)||owner.section.completionContract?.documentReferences?.references?.length){
          await checkReferences(owner,[...path,row.key]);assertCurrent();
        }
      }
      verified.add(row.key);
    };
    const issues=[];
    for(const row of rows){
      let found=[];
      try{
        const references=row.section.completionContract?.documentReferences?.references||[];
        requireValid(Array.isArray(references),'Invalid saved table reference list');
        for(const reference of references)requireValid(Array.isArray(reference?.tables),'Saved table reference lacks bound tables');
        const financialReference=references.some(reference=>reference.tables.some(html=>F.hasFinancialTables(html)));
        // Local financial tables and ordinary sections retain the production guard.
        found=financialReference&&!financialTables(row).length?[]:candidateIssues(row);
        if(hasReference(row.text)||references.length){await checkReferences(row,[]);assertCurrent();}
      }catch(error){assertCurrent();found.push({code:'saved-financial-reference-invalid',severity:'error',message:String(error.message),repairable:false});}
      if(found.length)issues.push({key:row.number,issues:found});
    }
    assertCurrent();
    return {binding,issues};
  };
}
