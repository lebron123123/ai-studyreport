import test from "node:test";
import assert from "node:assert/strict";
import { applyTemplateReview, compactTemplateProfile, PptTemplateProfile } from "../functions/api/_ppttemplate-profile.js";

const makePage = page => ({
  id: "demo:" + page, page, name: "页面" + page, role: page % 3 === 0 ? "metric" : "analysis",
  layoutId: page % 3 === 0 ? "chart-bar" : "bullets", capacity: 5, hasChart: page % 3 === 0,
  fingerprint: "fp-" + page,
  slotContract: { slots: [
    { shapeId: "shape_" + page, sourceId: String(page), sourceName: "标题", role: "title", type: "shape", capacity: 30, required: true },
    { shapeId: "shape_body_" + page, sourceId: String(page + 1000), sourceName: "正文", role: "body", type: "shape", capacity: 120 }
  ] }
});

test("160页模板只保留40个高频候选及Shape ID槽位", () => {
  const profile = compactTemplateProfile({ name: "160页模板", slideCount: 160, pages: Array.from({ length: 160 }, (_, i) => makePage(i + 1)) });
  assert.equal(profile.pages.length, 40);
  assert.deepEqual(profile.pages.map(page => page.page), PptTemplateProfile.BUSINESS_BLUE_CANDIDATE_PAGES);
  assert.equal(profile.pageIndex.length, 160);
  assert.equal(profile.pages[0].slotContract.slots[0].sourceId, "50");
  assert.ok(JSON.stringify(profile).length < 600000);
});

test("管理员可按页面准入并修订具体Shape槽位角色", () => {
  const compact = compactTemplateProfile({ name: "测试模板", slideCount: 1, pages: [makePage(1)] });
  const reviewed = applyTemplateReview(compact, { page: 1, status: "accepted", note: "已核对", slotRoles: { "1001": "claim" } }, "admin");
  assert.equal(reviewed.pages[0].review.status, "accepted");
  assert.equal(reviewed.pages[0].slotContract.slots[1].role, "claim");
  assert.equal(reviewed.pages[0].slotContract.roleCounts.claim, 1);
  assert.equal(reviewed.acceptance.acceptedCount, 1);
});

test("逐页审核不会丢失原模板完整页索引", () => {
  const compact = compactTemplateProfile({ slideCount: 160, pages: Array.from({ length: 160 }, (_, i) => makePage(i + 1)) });
  const reviewed = applyTemplateReview(compact, { page: 50, status: "accepted" }, "admin");
  assert.equal(reviewed.pages.length, 40);
  assert.equal(reviewed.pageIndex.length, 160);
});

test("非法槽位角色不会污染模板合同", () => {
  const compact = compactTemplateProfile({ pages: [makePage(1)] });
  const reviewed = applyTemplateReview(compact, { page: 1, status: "candidate", slotRoles: { "1001": "execute-code" } }, "admin");
  assert.equal(reviewed.pages[0].slotContract.slots[1].role, "body");
});
