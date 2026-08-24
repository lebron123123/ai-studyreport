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
  const hints = projectType === "gaibao" ? ["非居改保", "改保"] : projectType === "sale" ? ["出售", "配售"] : ["出租类可研", "出租"];
  const selected = sheets.find(sheet => hints.some(hint => sheet.name.includes(hint))) || sheets[0];
  if (!selected?.target || !zip.file(selected.target)) throw new Error("未找到可研逻辑工作表");
  const sheetXml = await zip.file(selected.target).async("string");
  const rows = [...sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const values = [];
    for (const cellMatch of match[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = Object.fromEntries([...cellMatch[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(item => [item[1], xmlDecode(item[2])]));
      const body = cellMatch[2];
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
if (!input) throw new Error("用法：node scripts/import-report-logic-xlsx.mjs <xlsx路径> [输出json/js路径] [rent|gaibao|sale] [期望有效行数]");
const inferredType = /非居改保|改保/i.test(path.basename(input)) ? "gaibao" : /出售|配售/i.test(path.basename(input)) ? "sale" : "rent";
const projectType = ["rent", "gaibao", "sale"].includes(process.argv[4]) ? process.argv[4] : inferredType;
const expectedRows = Number(process.argv[5] || (projectType === "rent" ? 137 : 0));
const workbook = await readWorkbook(path.resolve(input), projectType);
const populated = workbook.rows.filter(row => row.values.some(Boolean));
const sourceRows = populated.slice(1);
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
const typeNames = { rent: "出租类", gaibao: "非居改保", sale: "出售类" };
const seed = {
  schemaVersion: 1,
  setId: `report-logic-${projectType}-v1`,
  name: `${typeNames[projectType] || projectType}可研逐小节生成逻辑`,
  projectType,
  version: 1,
  status: "published",
  source: { fileName: path.basename(input), sheetName: workbook.sheetName, importedAt: new Date().toISOString(), authoritativeRows: rules.length },
  structure: { chapterCount: chapterNames.length, chapterNames, ruleCount: rules.length },
  rules
};

const output = process.argv[3];
if (output) {
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const serialized = JSON.stringify(seed, null, 2);
  fs.writeFileSync(outputPath, outputPath.endsWith(".js") ? `// 由 scripts/import-report-logic-xlsx.mjs 从正式Excel生成，请勿手工改写。\nexport default ${serialized};\n` : serialized + "\n", "utf8");
}
console.log(JSON.stringify({
  sheetName: workbook.sheetName,
  authoritativeRows: rules.length,
  chapters: chapterNames,
  malformed: malformed.map(rule => ({ sourceNo: rule.sourceNo, legacySourceNo: rule.legacySourceNo, sourceRow: rule.sourceRow, chapter: rule.chapter, section: rule.section, subsection: rule.subsection, pointTitle: rule.pointTitle, writingLogic: rule.writingLogic })).slice(0, 30),
  output: output ? path.resolve(output) : ""
}, null, 2));
