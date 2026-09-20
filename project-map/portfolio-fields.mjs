// A second project-name column begins a side table, not this project's data.
export function splitPortfolioFields(fields) {
  let seen = false;
  const split = fields.findIndex(f => {
    if (f.label.trim() !== '项目名称') return false;
    if (seen) return true;
    seen = true; return false;
  });
  return split < 0 ? [fields, []] : [fields.slice(0, split), fields.slice(split)];
}
