import fs from "node:fs";
import path from "node:path";
import { buildNativeTemplatePptx } from "../local-server/ppt-native-template.js";
import { validatePptxBuffer } from "../local-server/ppt-export.js";

const source = process.argv[2] || "C:/Users/HP/Documents/xwechat_files/wxid_8342kac7tkzd22_f6c3/temp/RWTemp/2026-08/7f41ef07f43a0bc4c8b71451c73ed209/青年人才住房20260805(3)(2).pptx";
const output = process.argv[3] || path.resolve("outputs", "青年人才住房_真实占位符生成测试.pptx");
const actions = values => Object.entries(values).map(([sourceId, value]) => ({ sourceId, action: "replace-text", value }));
const slide = (templatePage, layoutId, values) => ({
  templatePage, layoutId, templateFillMode: "strict-shape-id", templateFillPlan: { actions: actions(values) }
});

const plan = {
  title: "青年人才住房项目建设方案汇报",
  purpose: "验证真实模板页复制、Shape ID占位符回填和原版式保真",
  audience: "项目决策与审查人员",
  templateId: "youth-housing",
  nativeTemplate: true,
  nativeTemplateMode: "explicit-pages",
  slides: [
    slide(1, "cover", { "9": "青年人才住房项目建设方案汇报" }),
    slide(3, "image-hero", {
      "1048713": "青年人才住房示范项目", "3": "一、项目基本情况",
      "11": "项目位于深圳市重点产业片区，面向新就业青年和产业人才，构建职住邻近、交通便利、配套完善的保障性租赁住房社区。"
    }),
    slide(6, "timeline", {
      "1048713": "青年人才住房示范项目", "3": "三、项目定位",
      "7": "总体定位：服务重点产业青年人才，打造职住邻近、功能复合、绿色低碳的安居社区。",
      "6": "产品定位：以紧凑实用的小户型为主，配置独立卫浴、收纳和基础生活空间，兼顾公共共享配套。"
    }),
    slide(8, "table", { "1048713": "人才住房项目", "7": "五、规划平面与技术指标" }),
    slide(21, "image-hero", {
      "6": "青年人才住房示范项目", "3": "四、实施模式",
      "5": "建议采用统一规划、分期建设、专业运营的实施模式；建设计划与片区交通、公共服务和产业导入同步衔接。"
    }),
    slide(22, "table", { "6": "青年人才住房示范项目", "7": "五、规划平面与技术指标" }),
    slide(15, "conclusion", {
      "1048713": "青年人才住房示范项目", "3": "十二、请示事项",
      "5": "一是同意项目定位与建设规模；二是同意按计划推进前期工作；三是协调相关部门加快规划、用地和建设条件落实。"
    })
  ]
};

if (!fs.existsSync(source)) throw new Error("青年人才住房模板不存在：" + source);
const buffer = await buildNativeTemplatePptx(plan, { templatePath: source });
const qa = await validatePptxBuffer(buffer, plan);
if (!qa.ok) throw new Error("PPT结构校验失败：" + qa.errors.join("；"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, buffer);
console.log(JSON.stringify({ ok: true, source, output, slides: qa.slideCount, nativeTemplate: qa.nativeTemplate, warnings: qa.warnings }, null, 2));
