import fs from "node:fs";
import path from "node:path";
import JSZip from "../local-server/node_modules/jszip/lib/index.js";

const xmlDecode = value => String(value || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function colIndex(ref) {
  const letters = String(ref || "A").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function cellRefParts(ref) {
  return { col: colIndex(ref), row: Number(String(ref || "").match(/\d+/)?.[0] || 0) };
}

function textNodes(xml) {
  return [...String(xml || "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => xmlDecode(match[1])).join("");
}

async function readWorkbook(filePath, projectType) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") || "";
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match => textNodes(match[1]));
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string") || "";
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string") || "";
  const relationships = new Map([...relsXml.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], xmlDecode(item[2])]));
    return [attrs.Id, attrs.Target];
  }));
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]+)\/?\s*>/g)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], xmlDecode(item[2])]));
    const target = relationships.get(attrs["r:id"]);
    return { name: attrs.name, target: target?.startsWith("/") ? target.slice(1) : `xl/${String(target || "").replace(/^\.\.\//, "")}` };
  });
  // This workbook's first worksheet is the only authoritative source. Do not
  // infer another worksheet by name: auxiliary sheets may contain drafts or
  // explanations that must never enter the production rule set.
  const selected = sheets[0];
  if (!selected?.target || !zip.file(selected.target)) throw new Error("未找到可研逻辑工作表");
  const sheetXml = await zip.file(selected.target).async("string");
  const rows = [...sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const values = [];
    // Excel emits styled blank cells as self-closing tags (`<c .../>`). The old
    // expression treated one of those tags as the opening tag of the next cell,
    // shifting every following value one column to the left. Match both forms
    // explicitly so blank cells remain blank and column references stay exact.
    for (const cellMatch of match[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = Object.fromEntries([...cellMatch[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], xmlDecode(item[2])]));
      const body = cellMatch[2] || "";
      let value = "";
      if (attrs.t === "inlineStr") value = textNodes(body);
      else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
        value = attrs.t === "s" ? shared[Number(raw)] || "" : xmlDecode(raw);
      }
      values[colIndex(attrs.r)] = String(value).trim();
    }
    return { rowNo: Number(match[1]), values };
  });
  const rowMap = new Map(rows.map(row => [row.rowNo, row]));
  for (const merge of sheetXml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"[^>]*\/?\s*>/gi)) {
    const start = cellRefParts(merge[1]), end = cellRefParts(merge[2]);
    const anchor = rowMap.get(start.row)?.values[start.col] || "";
    if (!anchor) continue;
    for (let rowNo = start.row; rowNo <= end.row; rowNo++) {
      const row = rowMap.get(rowNo);
      if (!row) continue;
      for (let col = start.col; col <= end.col; col++) if (!row.values[col]) row.values[col] = anchor;
    }
  }
  return { sheetName: selected.name, sheets: sheets.map(sheet => sheet.name), rows };
}

const input = process.argv[2];
if (!input) throw new Error("用法：node scripts/import-report-logic-xlsx.mjs <xlsx路径> [输出json/js路径] [rent|gaibao|sale] [期望有效行数] [镜像json路径]");
const inferredType = /非居改保|改保/i.test(path.basename(input)) ? "gaibao" : /出售|配售/i.test(path.basename(input)) ? "sale" : "rent";
const projectType = ["rent", "gaibao", "sale"].includes(process.argv[4]) ? process.argv[4] : inferredType;
const expectedRows = Number(process.argv[5] || (projectType === "rent" ? 137 : projectType === "gaibao" ? 74 : 0));
const workbook = await readWorkbook(path.resolve(input), projectType);
const populated = workbook.rows.filter(row => row.values.some(Boolean));
const headerIndex = populated.findIndex(row => String(row.values[0] || "").trim() === "序号" && String(row.values[1] || "").includes("一级章节"));
const sourceRows = populated.slice(headerIndex >= 0 ? headerIndex + 1 : 1);
if (expectedRows && sourceRows.length !== expectedRows) throw new Error(`主表应为${expectedRows}条，实际读取${sourceRows.length}条；为避免错导入已停止`);

const sourceKinds = value => {
  const text = String(value || ""), kinds = [];
  if (/知识库/.test(text)) kinds.push("knowledge_base");
  if (/网上搜索|互联网|网站/.test(text)) kinds.push("web_search");
  if (/平台数据|数据调用|API|接口/.test(text)) kinds.push("provider");
  if (/手动填入|人工填入|找集团|有关部门/.test(text)) kinds.push("manual_upload");
  if (/测算引擎|测算规则引擎|测算逻辑|测算结果|测算规则/.test(text)) kinds.push("calculation_engine");
  if (/见具体章节|见后文|同\d|表述同/.test(text)) kinds.push("derived_section");
  return [...new Set(kinds)];
};

function generationMode(row) {
  const joined = [row.requiredSources, row.writingLogic, row.outputForm].join(" ");
  if (/测算引擎|见具体章节|表述同|接入测算/.test(joined)) return "derived";
  if (/表格|图|时间线|计算|数据/.test(row.outputForm) && /分析法|测算法|对比法|定位法/.test(row.writingLogic)) return "hybrid";
  if (/表格|图|时间线/.test(row.outputForm)) return "fixed_template";
  if (/分析法|对比法|测算法|定位法/.test(row.writingLogic)) return "ai_analysis";
  return "ai_writing";
}

const SCENARIOS = ["housing_conversion", "commercial_renovation"];
const scenarioPattern = {
  housing_conversion: /非居改保|住房改造|改建纳保|保障性租赁住房|保租房/,
  commercial_renovation: /商业改造|自持改造|如为自持|存量改造|商业市场|商业项目/
};
function scenarioMeta(values){
  // Applicability comes from the worksheet's structural title cells. Long
  // source/logic cells often contain one scenario as an example inside an
  // otherwise common rule; using those mentions to classify the whole row made
  // common chapters (notably Chapter 7 cooperation) disappear from one tab.
  const scopeText=[values[2],values[3],values[4]].map(value=>String(value||"")).join("\n");
  const housing=scenarioPattern.housing_conversion.test(scopeText),commercial=scenarioPattern.commercial_renovation.test(scopeText);
  const scenarios=housing&&!commercial?["housing_conversion"]:commercial&&!housing?["commercial_renovation"]:SCENARIOS.slice();
  const variants={};
  for(const scenario of scenarios){
    // Keep each Excel cell verbatim. Scenario-labelled blocks are selected at
    // prompt time; destructive text slicing is forbidden because it previously
    // dropped policy lists and actual data-source requirements.
    const section=String(values[2]||"").trim(),subsection=String(values[3]||"").trim(),pointTitle=String(values[4]||"").trim(),requiredSources=String(values[5]||"").trim(),writingLogic=String(values[6]||"").trim(),note=String(values[9]||"").trim();
    variants[scenario]={section,subsection,pointTitle,displayTitle:[subsection,pointTitle].filter(Boolean).join("｜"),requiredSources,writingLogic,note};
  }
  return {scenarios,variants};
}

let currentChapter = "", currentSection = "";
const rules = sourceRows.map((source, index) => {
  const [legacySourceNo, rawChapter, rawSection, rawSubsection, pointTitle, requiredSources, writingLogic, importance, outputForm, note] = source.values;
  if (/^第.+章\s*/.test(rawChapter || "")) currentChapter = rawChapter;
  if (/^\d+(?:\.\d+)+/.test(rawSection || "")) currentSection = rawSection;
  const subsection = String(rawSubsection || "").trim();
  const rawTitle = String(pointTitle || "").trim();
  const title = /^\d+$/.test(rawTitle) ? "" : rawTitle;
  const kinds = sourceKinds(requiredSources);
  if (!kinds.length && String(requiredSources || "").trim() === "/" && /规则默认填入/.test(String(writingLogic || ""))) kinds.push("system_rule");
  const scenario=scenarioMeta(source.values);
  const rule = {
    id: `${projectType}-v1-${String(index + 1).padStart(3, "0")}`,
    sourceNo: index + 1,
    legacySourceNo: String(legacySourceNo || ""),
    sourceRow: source.rowNo,
    projectType,
    chapter: currentChapter,
    section: currentSection,
    subsection,
    pointTitle: title,
    displayTitle: [subsection, title].filter(Boolean).join("｜"),
    requiredSources: String(requiredSources || "").trim(),
    sourceKinds: kinds,
    writingLogic: String(writingLogic || "").trim(),
    importance: String(importance || "").trim() || "未标注",
    outputForm: String(outputForm || "").trim() || "未标注",
    note: String(note || "").trim(),
    scenarios: scenario.scenarios,
    scenarioVariants: scenario.variants,
    projectSpecific: /本项目特色|本项目核心特色/.test(String(note || "")),
    generationMode: "",
    missingPolicy: kinds.includes("manual_upload") ? "ask_user_and_mark" : kinds.length ? "search_then_mark" : "allow_placeholder",
    auditProjection: {
      checkWhat: [subsection, title].filter(Boolean).join("｜"),
      basis: String(requiredSources || "").trim(),
      rationale: String(writingLogic || "").trim(),
      expectedOutput: String(outputForm || "").trim(),
      severity: /^★★★/.test(importance || "") ? "high" : /^★★/.test(importance || "") ? "medium" : "info"
    }
  };
  rule.generationMode = generationMode(rule);
  return rule;
});

const chapterNames = [...new Set(rules.map(rule => rule.chapter).filter(Boolean))];
const malformed = rules.filter(rule => !rule.chapter || !rule.section || !rule.writingLogic);
const typeNames = { rent: "出租类", gaibao: "改造项目双场景", sale: "出售类" };
const seed = {
  schemaVersion: 1,
  setId: `report-logic-${projectType}-v1`,
  name: `${typeNames[projectType] || projectType}可研逐小节生成逻辑`,
  projectType,
  version: 1,
  status: "published",
  source: {
    fileName: path.basename(input),
    sheetName: workbook.sheetName,
    sheetIndex: 1,
    selectionPolicy: "first_sheet_only",
    baselineId: projectType === "gaibao" ? "gaibao-first-sheet-74-20260901-v2" : "",
    importedAt: new Date().toISOString(),
    authoritativeRows: rules.length
  },
  structure: { chapterCount: chapterNames.length, chapterNames, ruleCount: rules.length, scenarioCounts:Object.fromEntries(SCENARIOS.map(scenario=>[scenario,rules.filter(rule=>rule.scenarios.includes(scenario)).length])) },
  rules
};

const output = process.argv[3];
const mirrorOutput = process.argv[6];
if (output) {
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const serialized = JSON.stringify(seed, null, 2);
  fs.writeFileSync(outputPath, outputPath.endsWith(".js") ? `// 由 scripts/import-report-logic-xlsx.mjs 从正式Excel生成，请勿手工改写。\nexport default ${serialized};\n` : serialized + "\n", "utf8");
  if (mirrorOutput) {
    const mirrorPath = path.resolve(mirrorOutput);
    fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
    fs.writeFileSync(mirrorPath, serialized + "\n", "utf8");
  }
}
console.log(JSON.stringify({
  sheetName: workbook.sheetName,
  authoritativeRows: rules.length,
  chapters: chapterNames,
  malformed: malformed.map(rule => ({ sourceNo: rule.sourceNo, legacySourceNo: rule.legacySourceNo, sourceRow: rule.sourceRow, chapter: rule.chapter, section: rule.section, subsection: rule.subsection, pointTitle: rule.pointTitle, writingLogic: rule.writingLogic })).slice(0, 30),
  output: output ? path.resolve(output) : "",
  mirrorOutput: mirrorOutput ? path.resolve(mirrorOutput) : ""
}, null, 2));
