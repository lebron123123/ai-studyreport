// 报告大纲库 —— 依据真实"非居改保"可研报告的章节结构提炼
// 每个领域是一组章节，每章含若干子标题（section），生成时逐个子标题产出，篇幅与深度大幅提升
// numeric:true 的子标题会在生成时附带"待填真实数据"标注，并倾向于产出表格框架

window.OUTLINES = {
  // ============ 保障房-非居改保（经理审定住房改造结构 v2） ============
  "baozhang_gaibao": {
    label: "保障房 · 非居改保",
    chapters: [
      { cn: "一", name: "项目总论", sections: [
        { t: "编制依据与编制说明", numeric: false },
        { t: "项目背景", numeric: false },
        { t: "项目本体情况、改造情况与政策符合性", numeric: true },
        { t: "合作模式及合作期限", numeric: false },
        { t: "改造目标、投资估算与经济效益", numeric: true },
        { t: "可行性与必要性概述", numeric: false },
        { t: "问题、建议与结论", numeric: false },
      ]},
      { cn: "二", name: "项目建设必要性", sections: [
        { t: "政策与国有资产管理要求", numeric: false },
        { t: "项目改造与经济效益必要性", numeric: false },
        { t: "社会效益与国企责任", numeric: false },
      ]},
      { cn: "三", name: "项目市场分析", sections: [
        { t: "人口、就业与租赁市场基础", numeric: true },
        { t: "职住关系与租赁需求分析", numeric: true },
        { t: "目标客群画像", numeric: true },
        { t: "住房租赁供给分析", numeric: true },
        { t: "竞品与租金水平分析", numeric: true },
        { t: "供需态势与市场结论", numeric: true },
      ]},
      { cn: "四", name: "项目条件和SWOT分析", sections: [
        { t: "项目条件", numeric: false },
        { t: "SWOT综合分析", numeric: true },
      ]},
      { cn: "五", name: "项目策划定位", sections: [
        { t: "客群定位", numeric: true },
        { t: "产品及竞争定位", numeric: true },
        { t: "价格定位", numeric: true },
      ]},
      { cn: "六", name: "改造运营方案", sections: [
        { t: "改造实施计划及效果", numeric: true },
        { t: "项目管理与实施进度计划", numeric: true },
        { t: "运营方案", numeric: false },
      ]},
      { cn: "七", name: "项目合作模式", sections: [
        { t: "合作模式", numeric: false },
        { t: "合作核心条款", numeric: true },
      ]},
      { cn: "八", name: "投资估算与资金筹措", sections: [
        { t: "投资估算", numeric: true },
        { t: "资金筹措", numeric: true },
      ]},
      { cn: "九", name: "财务评价", sections: [
        { t: "财务评价基础数据和假设", numeric: true },
        { t: "盈利能力分析", numeric: true },
        { t: "财务评价", numeric: true },
        { t: "不确定性分析", numeric: true },
      ]},
      { cn: "十", name: "社会效益评价", sections: [
        { t: "社会效益评价", numeric: false },
      ]},
      { cn: "十一", name: "项目风险分析及对策", sections: [
        { t: "市场风险与对策", numeric: false },
        { t: "工程风险与对策", numeric: false },
        { t: "投资收益风险与对策", numeric: false },
        { t: "舆情风险与对策", numeric: false },
        { t: "政策风险与对策", numeric: false },
        { t: "合作风险与对策", numeric: false },
      ]},
      { cn: "十二", name: "项目研究结论及建议", sections: [
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
