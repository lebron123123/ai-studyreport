import Contract from '../report-completion-contract.js';
import Argument from '../report-argument.js';

// Same browser/backend builder; only located references in actual materials,
// never old generated prose or inferred legal metadata.
export async function buildBasisCatalog(kb, sectionKey, options = {}) {
  return Argument.basisCatalog(kb, { ...options, sectionKey, completionContract: Contract });
}

export async function basisCatalogFromSnapshot(snapshot, sectionKey, options = {}) {
  const kb = snapshot?.state?.draft?.kb || snapshot?.draft?.kb || snapshot?.state?.kb;
  if (!Array.isArray(kb)) throw new Error('快照没有实际kb文件登记，不从旧正文推断依据');
  return buildBasisCatalog(kb, sectionKey, options);
}
