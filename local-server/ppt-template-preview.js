import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const running = new Map();

export function resolveStoredTemplate(root, storageKey = "") {
  const base = path.resolve(root, "local-data", "ppt-templates");
  const target = path.resolve(base, String(storageKey || "").replace(/^[\\/]+/, ""));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("模板存储路径越界");
  return target;
}

export function resolvePreviewFile(root, templateId, page) {
  const safeId = String(templateId || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const safePage = Math.max(1, Number(page) || 1);
  return path.join(path.resolve(root, "local-data", "ppt-template-previews", safeId), `slide-${safePage}.png`);
}

export async function ensureTemplatePreviews({ root, templateId, sourcePath, pages = [] }) {
  if (!existsSync(sourcePath)) throw new Error("模板原文件不存在");
  const uniquePages = [...new Set(pages.map(Number).filter(page => Number.isInteger(page) && page > 0))].slice(0, 80);
  if (!uniquePages.length) throw new Error("没有可预览页面");
  const outputDir = path.dirname(resolvePreviewFile(root, templateId, uniquePages[0]));
  mkdirSync(outputDir, { recursive: true });
  const missing = uniquePages.filter(page => !existsSync(resolvePreviewFile(root, templateId, page)));
  if (!missing.length) return outputDir;
  const key = String(templateId);
  if (!running.has(key)) {
    const script = path.resolve(root, "scripts", "ppt-render-slides.ps1");
    const job = execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SourcePath", sourcePath, "-OutputDir", outputDir, "-Pages", missing.join(",")], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 })
      .finally(() => running.delete(key));
    running.set(key, job);
  }
  await running.get(key);
  return outputDir;
}

export const PptTemplatePreview = { resolveStoredTemplate, resolvePreviewFile, ensureTemplatePreviews };
