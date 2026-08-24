import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolvePreviewFile, resolveStoredTemplate } from "../local-server/ppt-template-preview.js";

test("模板存储路径必须停留在本地模板目录内", () => {
  const root = path.resolve("C:/workspace/demo");
  assert.equal(resolveStoredTemplate(root, "user-7/demo.pptx"), path.resolve(root, "local-data/ppt-templates/user-7/demo.pptx"));
  assert.throws(() => resolveStoredTemplate(root, "../../secret.txt"), /路径越界/);
});

test("缩略图文件名只允许安全模板ID和正整数页码", () => {
  const target = resolvePreviewFile(path.resolve("C:/workspace/demo"), "pt:../../bad", -2);
  assert.match(target.replace(/\\/g, "/"), /ppt-template-previews\/pt_+bad\/slide-1\.png$/);
});
