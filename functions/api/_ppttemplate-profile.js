const BUSINESS_BLUE_CANDIDATE_PAGES = [
  50,11,47,78,26,37,60,75,77,86,105,119,150,51,64,65,71,96,98,111,
  114,126,137,143,153,7,8,18,21,24,34,38,39,40,42,46,55,56,58,59
];

const SLOT_ROLES = new Set(["title","subtitle","claim","metric","label","body","source","picture","table","chart","keep"]);
const asArray = value => Array.isArray(value) ? value : [];
const clean = (value, max = 500) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

function compactSlot(slot = {}) {
  const role = SLOT_ROLES.has(slot.role) ? slot.role : "label";
  return {
    shapeId: clean(slot.shapeId, 80),
    sourceId: clean(slot.sourceId, 40),
    sourceName: clean(slot.sourceName, 160),
    nativeKey: clean(slot.nativeKey, 80),
    role,
    type: clean(slot.type, 30) || "shape",
    capacity: Math.max(1, Math.min(2000, Number(slot.capacity) || 30)),
    required: !!slot.required,
    placeholder: slot.placeholder && typeof slot.placeholder === "object" ? {
      type: clean(slot.placeholder.type, 40),
      index: clean(slot.placeholder.index, 40),
      isNative: !!slot.placeholder.isNative
    } : { type: "", index: "", isNative: false }
  };
}

function pageSummary(page = {}) {
  const slots = asArray(page.slotContract && page.slotContract.slots).map(compactSlot);
  return {
    id: clean(page.id, 120) || "page:" + Number(page.page || 0),
    page: Math.max(1, Number(page.page) || 1),
    name: clean(page.name, 160) || "模板页" + Number(page.page || 0),
    role: clean(page.role, 40) || "analysis",
    roles: asArray(page.roles).map(value => clean(value, 40)).filter(Boolean).slice(0, 12),
    layoutId: clean(page.layoutId, 60) || "bullets",
    capacity: Math.max(1, Math.min(20, Number(page.capacity) || 5)),
    hasImage: !!page.hasImage,
    hasChart: !!page.hasChart,
    hasTable: !!page.hasTable,
    sourcePages: asArray(page.sourcePages).map(Number).filter(Number.isFinite).slice(0, 40),
    fingerprint: clean(page.fingerprint, 100),
    status: clean(page.status, 20) || "candidate",
    version: Math.max(1, Number(page.version) || 1),
    slotContract: {
      slots,
      roleCounts: slots.reduce((out, slot) => { out[slot.role] = (out[slot.role] || 0) + 1; return out; }, {}),
      minItems: Math.max(1, Math.min(3, slots.length)),
      maxItems: Math.max(1, Math.min(12, slots.length)),
      preserveGeometry: true,
      preserveZOrder: true,
      fillMode: "shape-id-first",
      fallbackMode: "semantic-role"
    },
    review: {
      status: clean(page.review && page.review.status, 20) || "candidate",
      note: clean(page.review && page.review.note, 500),
      updatedAt: Number(page.review && page.review.updatedAt) || 0,
      updatedBy: clean(page.review && page.review.updatedBy, 100)
    }
  };
}

function candidatePages(profile = {}, limit = 40) {
  const pages = asArray(profile.pages);
  if (pages.length === 160) {
    const byPage = new Map(pages.map(page => [Number(page.page), page]));
    return BUSINESS_BLUE_CANDIDATE_PAGES.map(page => byPage.get(page)).filter(Boolean).slice(0, limit);
  }
  if (pages.length <= limit) return pages;
  const seen = new Set(), selected = [];
  const ranked = [...pages].sort((a, b) => {
    const score = page => (page.hasChart ? 9 : 0) + (page.hasTable ? 8 : 0) + (page.hasImage ? 4 : 0) + Math.min(8, Number(page.capacity) || 0);
    return score(b) - score(a) || Number(a.page) - Number(b.page);
  });
  for (const page of ranked) {
    const key = clean(page.fingerprint, 100) || [page.role, page.layoutId, page.capacity, page.hasImage, page.hasChart, page.hasTable].join("|");
    if (seen.has(key)) continue;
    seen.add(key); selected.push(page);
    if (selected.length >= limit) break;
  }
  for (const page of ranked) {
    if (selected.includes(page)) continue;
    selected.push(page);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function compactTemplateProfile(profile = {}, options = {}) {
  const limit = Math.max(1, Math.min(80, Number(options.limit) || 40));
  const pages = candidatePages(profile, limit).map(pageSummary);
  const sourceIndex = asArray(profile.pageIndex).length ? profile.pageIndex : asArray(profile.pages);
  const pageIndex = sourceIndex.map(page => ({
    page: Math.max(1, Number(page.page) || 1),
    name: clean(page.name, 120), role: clean(page.role, 40), layoutId: clean(page.layoutId, 60),
    capacity: Math.max(1, Math.min(20, Number(page.capacity) || 5)),
    hasImage: !!page.hasImage, hasChart: !!page.hasChart, hasTable: !!page.hasTable,
    fingerprint: clean(page.fingerprint, 100)
  }));
  return {
    ok: profile.ok !== false,
    name: clean(profile.name, 160),
    templateCategory: clean(profile.templateCategory, 40) || "general-fixed",
    size: Number(profile.size) || 0,
    fingerprint: clean(profile.fingerprint, 100),
    slideCount: Number(profile.slideCount) || pageIndex.length,
    analyzedAt: Number(profile.analyzedAt) || Date.now(),
    designTokens: profile.designTokens && typeof profile.designTokens === "object" ? profile.designTokens : {},
    pages,
    pageIndex,
    acceptance: {
      version: 1,
      candidateLimit: limit,
      candidateCount: pages.length,
      acceptedCount: pages.filter(page => page.review.status === "accepted").length,
      rejectedCount: pages.filter(page => page.review.status === "rejected").length
    }
  };
}

export function applyTemplateReview(profile = {}, patch = {}, reviewer = "") {
  const compact = compactTemplateProfile(profile, { limit: Math.max(40, asArray(profile.pages).length) });
  const pageNo = Math.max(1, Number(patch.page) || 1);
  const page = compact.pages.find(item => item.page === pageNo);
  if (!page) throw new Error("待审核页面不存在");
  const status = clean(patch.status, 20);
  if (!["candidate", "accepted", "rejected"].includes(status)) throw new Error("页面准入状态无效");
  const roleUpdates = patch.slotRoles && typeof patch.slotRoles === "object" ? patch.slotRoles : {};
  page.slotContract.slots.forEach(slot => {
    const next = clean(roleUpdates[String(slot.sourceId)], 30);
    if (next && SLOT_ROLES.has(next)) slot.role = next;
  });
  page.slotContract.roleCounts = page.slotContract.slots.reduce((out, slot) => { out[slot.role] = (out[slot.role] || 0) + 1; return out; }, {});
  page.review = { status, note: clean(patch.note, 500), updatedAt: Date.now(), updatedBy: clean(reviewer, 100) };
  page.status = status === "accepted" ? "approved" : status;
  compact.acceptance.acceptedCount = compact.pages.filter(item => item.review.status === "accepted").length;
  compact.acceptance.rejectedCount = compact.pages.filter(item => item.review.status === "rejected").length;
  return compact;
}

export const PptTemplateProfile = { BUSINESS_BLUE_CANDIDATE_PAGES, SLOT_ROLES, compactTemplateProfile, applyTemplateReview };
