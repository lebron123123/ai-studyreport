// 报告大纲库 —— 依据真实"非居改保"可研报告的章节结构提炼
// 每个领域是一组章节，每章含若干子标题（section），生成时逐个子标题产出，篇幅与深度大幅提升
// numeric:true 的子标题会在生成时附带"待填真实数据"标注，并倾向于产出表格框架

window.OUTLINES = {
  // ============ 保障房-非居改保（照上传报告结构） ============
  "baozhang_gaibao": {
    label: "保障房 · 非居改保",
    chapters: [
      { cn: "一", name: "项目总论", sections: [
        { t: "项目背景", numeric: false },
        { t: "委托单位及编制单位概况", numeric: false },
        { t: "编制依据与编制说明", numeric: false },
        { t: "项目概况（区位、现状、定位、改造规模与内容）", numeric: false },
        { t: "项目资金估算和资金筹措", numeric: true },
        { t: "结论和建议", numeric: false },
      ]},
      { cn: "二", name: "项目建设必要性", sections: [
        { t: "遏制经营下滑态势，筑牢国有资产保值增值基础", numeric: false },
        { t: "物业条件制约出租去化，需系统性改造实现破局", numeric: false },
        { t: "呼应民意诉求与民生需求，践行国企社会责任", numeric: false },
      ]},
      { cn: "三", name: "项目市场分析", sections: [
        { t: "宏观经济环境及区域规划分析", numeric: false },
        { t: "区域商业市场供需与格局分析", numeric: false },
        { t: "项目周边商业竞争格局与租金水平研究", numeric: true },
        { t: "市场分析小结", numeric: false },
      ]},
      { cn: "四", name: "项目条件和SWOT分析", sections: [
        { t: "项目选址与基本情况", numeric: false },
        { t: "项目现状条件（商业现状、配套设施、基础设施）", numeric: false },
        { t: "SWOT分析（优势/劣势/机会/威胁）", numeric: false },
      ]},
      { cn: "五", name: "项目策划定位", sections: [
        { t: "整体定位与研究框架", numeric: false },
        { t: "消费者研究", numeric: false },
        { t: "商业业态定位", numeric: false },
        { t: "商业价格定位（价值排序、分租定价、管理费建议）", numeric: true },
      ]},
      { cn: "六", name: "改造升级策略及效果", sections: [
        { t: "配套商业改造升级策略", numeric: false },
        { t: "总体改造升级方案（集中商业、街区商业）", numeric: false },
        { t: "改造升级效果说明", numeric: false },
      ]},
      { cn: "七", name: "环境影响分析", sections: [
        { t: "宗地环境现状", numeric: false },
        { t: "环境影响分析与保护措施", numeric: false },
        { t: "环境影响综合评价", numeric: false },
      ]},
      { cn: "八", name: "项目管理和实施进度计划", sections: [
        { t: "项目开发运营方案", numeric: false },
        { t: "项目招投标", numeric: false },
        { t: "项目实施进度计划", numeric: false },
      ]},
      { cn: "九", name: "投资估算与资金筹措", sections: [
        { t: "投资估算范围与方法", numeric: false },
        { t: "总投资估算结果", numeric: true },
        { t: "资金筹措与投资计划", numeric: true },
      ]},
      { cn: "十", name: "财务评价", sections: [
        { t: "财务评价基础数据和假设", numeric: true },
        { t: "盈利能力分析（经营收入、成本、利润）", numeric: true },
        { t: "敏感性分析", numeric: true },
      ]},
      { cn: "十一", name: "社会效益评价", sections: [
        { t: "社会效益评价", numeric: false },
      ]},
      { cn: "十二", name: "项目风险分析及对策", sections: [
        { t: "市场风险与对策", numeric: false },
        { t: "工程风险与对策", numeric: false },
        { t: "投资收益风险与对策", numeric: false },
        { t: "舆情风险与对策", numeric: false },
      ]},
      { cn: "十三", name: "项目研究结论及建议", sections: [
        { t: "项目可行性结论", numeric: false },
        { t: "项目下一步工作建议", numeric: false },
      ]},
    ],
  },

  // ============ 保障房-新建 ============
  "baozhang_xinjian": {
    label: "保障房 · 新建",
    chapters: [
      { cn: "一", name: "项目总论", sections: [
        { t: "项目背景", numeric: false },
        { t: "建设单位及编制单位概况", numeric: false },
        { t: "编制依据与编制说明", numeric: false },
        { t: "项目概况（区位、建设规模、建设内容）", numeric: false },
        { t: "项目总投资与资金筹措", numeric: true },
        { t: "结论和建议", numeric: false },
      ]},
      { cn: "二", name: "项目建设必要性", sections: [
        { t: "落实国家及地方住房保障政策的需要", numeric: false },
        { t: "缓解区域保障性住房供需矛盾的需要", numeric: false },
        { t: "完善城市功能、践行国企社会责任的需要", numeric: false },
      ]},
      { cn: "三", name: "项目需求分析与建设规模", sections: [
        { t: "区域住房保障需求分析", numeric: true },
        { t: "目标保障对象与户型需求", numeric: false },
        { t: "建设规模论证", numeric: true },
      ]},
      { cn: "四", name: "项目选址与建设条件", sections: [
        { t: "项目选址与区位条件", numeric: false },
        { t: "场地现状与自然条件（地质、气候、水文）", numeric: false },
        { t: "市政配套与交通条件", numeric: false },
        { t: "选址合理性评价", numeric: false },
      ]},
      { cn: "五", name: "建设方案", sections: [
        { t: "总平面布置与规划设计方案", numeric: false },
        { t: "建筑与户型设计方案", numeric: false },
        { t: "结构、机电与配套设施方案", numeric: false },
        { t: "绿色建筑与装配式建筑方案", numeric: false },
      ]},
      { cn: "六", name: "环境影响分析", sections: [
        { t: "环境现状", numeric: false },
        { t: "施工期与运营期环境影响分析", numeric: false },
        { t: "环境保护措施", numeric: false },
        { t: "环境影响综合评价", numeric: false },
      ]},
      { cn: "七", name: "节能与安全", sections: [
        { t: "节能分析与措施", numeric: false },
        { t: "消防与安全生产方案", numeric: false },
      ]},
      { cn: "八", name: "项目管理和实施进度计划", sections: [
        { t: "项目建设管理方案", numeric: false },
        { t: "项目招投标", numeric: false },
        { t: "项目实施进度计划", numeric: false },
      ]},
      { cn: "九", name: "投资估算与资金筹措", sections: [
        { t: "投资估算范围与方法", numeric: false },
        { t: "总投资估算结果", numeric: true },
        { t: "资金筹措与投资计划", numeric: true },
      ]},
      { cn: "十", name: "财务评价", sections: [
        { t: "财务评价基础数据和假设", numeric: true },
        { t: "运营收入与成本分析", numeric: true },
        { t: "财务生存能力与盈利能力分析", numeric: true },
        { t: "敏感性分析", numeric: true },
      ]},
      { cn: "十一", name: "社会效益评价", sections: [
        { t: "社会效益评价", numeric: false },
      ]},
      { cn: "十二", name: "项目风险分析及对策", sections: [
        { t: "政策风险与对策", numeric: false },
        { t: "工程风险与对策", numeric: false },
        { t: "资金风险与对策", numeric: false },
        { t: "运营风险与对策", numeric: false },
      ]},
      { cn: "十三", name: "项目研究结论及建议", sections: [
        { t: "项目可行性结论", numeric: false },
        { t: "项目下一步工作建议", numeric: false },
      ]},
    ],
  },
};
