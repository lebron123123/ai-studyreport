// 测算输入参数的统一业务目录。
// 这里故意不包含 IRR、NPV、税费等计算结果：派生结果必须由白箱公式生成，不能被当作输入治理。

export const ROLE_OPTIONS = [
  {value:"project_fact",label:"项目事实参数"},
  {value:"market_stat",label:"市场/案例统计参数"},
  {value:"policy_constant",label:"政策或低频常量"},
  {value:"industry_benchmark",label:"行业经验值"},
  {value:"decision",label:"项目决策参数"},
];
export const VOLATILITY_OPTIONS = [
  {value:"fixed",label:"基本固定"},
  {value:"low_frequency",label:"低频变化"},
  {value:"market_dynamic",label:"随市场/时间变化"},
  {value:"region_specific",label:"随地区变化"},
  {value:"project_specific",label:"随项目变化"},
];
export const CONFIRM_OPTIONS = [
  {value:"required",label:"必须人工确认"},
  {value:"recommended",label:"建议人工确认"},
  {value:"automatic",label:"可自动采用"},
];
export const SOURCE_POLICY_OPTIONS = [
  {value:"project_document",label:"项目资料/Excel优先"},
  {value:"case_statistics",label:"同区域案例统计优先"},
  {value:"binding_rule",label:"政策/公司规则优先"},
  {value:"industry_fallback",label:"行业经验值兜底"},
  {value:"manual_decision",label:"项目决策人工确认"},
];

const sourceOf=role=>role==="market_stat"?"case_statistics":role==="policy_constant"?"binding_rule":role==="industry_benchmark"?"industry_fallback":role==="decision"?"manual_decision":"project_document";
const p=(label,unit,role="project_fact",volatility="project_specific",confirmation="required")=>({label,unit,role,volatility,confirmation,sourcePolicy:sourceOf(role),input:true,derived:false});

export const PARAM_META = {
  rent:{
    buildStart:p("开工年份","年"), buildYears:p("建设期","年"), operateYears:p("运营期","年"), firstMonths:p("运营首年计租月数","月"),
    area:p("住宅可出租面积","㎡"), rent:p("起始住宅租金","元/㎡/月","market_stat","market_dynamic"), rentSpan:p("租金递增间隔","年","industry_benchmark","market_dynamic","recommended"), rentRate:p("租金递增率","%","market_stat","market_dynamic"),
    occRamp:p("住宅出租率爬坡序列","比例","decision","project_specific"), parkOccRamp:p("车位出租率爬坡序列","比例","decision","project_specific"), parkStableOcc:p("车位稳定期出租率","比例","market_stat","market_dynamic"), stableOcc:p("住宅稳定期出租率","比例","market_stat","market_dynamic"),
    rentDiscount:p("住宅租金折扣系数","比例","decision"), subsidyArea:p("政府补贴对应面积","㎡"), subsidyPrice:p("补贴计算单价","元/㎡/月","policy_constant","low_frequency"), subsidyDiscount:p("补贴折扣系数","比例","policy_constant","low_frequency"), subsidyStableOcc:p("补贴部分稳定出租率","比例","decision"),
    parkCount:p("车位数量","个"), parkPrice:p("车位月租金","元/个/月","market_stat","region_specific"), parkRatio:p("车位收入计取系数","比例","industry_benchmark","project_specific"), otherTotal:p("其他收入总额","万元","project_fact"),
    areaPostOffice:p("邮政支局面积","㎡"), postOfficePrice:p("邮政支局回购单价","元/㎡","market_stat","project_specific"), areaKindergarten:p("幼儿园面积","㎡"), areaPropertyRoom:p("物业服务用房面积","㎡"), areaPoliceRoom:p("社区警务室面积","㎡"),
    totalBuildArea:p("总建筑面积","㎡"), manageCoeff:p("区域管理系数","系数","industry_benchmark","region_specific"), decorationCost:p("住宅装修造价","万元","market_stat","market_dynamic"), houseType:p("保障房类型","文本"),
    totalInvestment:p("项目总投资/折旧基数","万元","project_fact"), landArea:p("项目用地面积","㎡"), constructionCost:p("建安工程费","万元","project_fact"),
    loanAmount:p("总借款金额","万元","decision"), loanPlanText:p("分年度借款计划","年份:万元","decision"), loanRate:p("贷款年利率","%","market_stat","market_dynamic"), firstRepayRatio:p("首次还本比例","%","decision"), repayIncreaseRate:p("还本递增率","%","decision"), loanTotalYears:p("借款总年限","年","decision"),
    invest:p("财务评价初始投资额","万元","project_fact"), discountPct:p("财务基准折现率","%","policy_constant","low_frequency"),
  },
  sale:{
    buildStart:p("开工年份","年"), buildYears:p("建设期","年"), operateYears:p("运营评价期","年"), otherTotal:p("其他收入总额","万元","project_fact"),
    saleArea:p("配保房可销售面积","㎡"), saleAvgPrice:p("配保房可售均价","元/㎡","market_stat","market_dynamic"), rate1:p("运营第1年销售率","比例","decision"), rate2:p("运营第2年销售率","比例","decision"), rate3:p("运营第3年销售率","比例","decision"),
    commArea:p("商业可出租面积","㎡"), commRent:p("商业起始租金","元/㎡/月","market_stat","market_dynamic"), commRentSpan:p("商业租金递增间隔","年","industry_benchmark","market_dynamic","recommended"), commRentRate:p("商业租金递增率","%","market_stat","market_dynamic"), commRampOcc:p("商业首年出租率","比例","market_stat","market_dynamic"), commStableOcc:p("商业稳定期出租率","比例","market_stat","market_dynamic"),
    commRentStableStart:p("商业稳定运营起始年份","年","decision"), leaseMonths:p("每年计租月数","月","industry_benchmark","low_frequency","recommended"), parkCount:p("车位数量","个"),
    landCost:p("土地成本","万元","project_fact"), constructionCost:p("建安工程费","万元","project_fact"), infraCost:p("基础设施费","万元","project_fact"), otherEngCost:p("工程建设其他费","万元","project_fact"), devCost:p("开发建设费用","万元","project_fact"),
    saleConstructionCost:p("销售部分建安成本","万元","project_fact"), saleInfraCost:p("销售部分基础设施成本","万元","project_fact"), projectInputTax:p("项目可抵扣进项税","万元","project_fact"), landUseArea:p("土地使用税计税面积","㎡","project_fact"), landFloorPrice:p("土地楼面单价","元/㎡","market_stat","project_specific"),
    totalInvestment:p("项目总投资","万元","project_fact"), loanAmount:p("总借款金额","万元","decision"), loanRate:p("贷款年利率","%","market_stat","market_dynamic"), loanTotalYears:p("借款总年限","年","decision"), repayStart:p("开始还本年份","年","decision"), repayAmount:p("每年还本金额","万元","decision"), repayYears:p("还本年数","年","decision"), discountPct:p("财务基准折现率","%","policy_constant","low_frequency"),
  },
  gaibao:{
    buildStart:p("改造开工年份","年"), buildYears:p("改造建设期","年"), operateYears:p("运营期","年"), firstMonths:p("运营首年计租月数","月"),
    area:p("可出租住房面积","㎡"), rent:p("起始租金","元/㎡/月","market_stat","market_dynamic"), rentSpan:p("租金递增间隔","年","industry_benchmark","market_dynamic","recommended"), rentRate:p("租金递增率","%","market_stat","market_dynamic"), rampOcc:p("首年出租率","比例","market_stat","market_dynamic"), stableOcc:p("稳定期出租率","比例","market_stat","market_dynamic"),
    collect:p("收楼单价","元/㎡/月","market_stat","market_dynamic"), mode:p("收楼合作模式","文本","decision"), collectPct:p("固定收楼比例","%","decision"), sharePct:p("收入分成比例","%","decision"),
    deco:p("首次装修单价","元/㎡","market_stat","market_dynamic"), decoInt:p("装修重置间隔","年","industry_benchmark","project_specific"), decoRatio:p("再次装修成本系数","比例","industry_benchmark","project_specific"),
    units:p("住房总套数","套"), unitCost:p("单套月运营成本","元/套/月","industry_benchmark","region_specific"), startup:p("项目开办费","万元","industry_benchmark","project_specific"), loan:p("总借款金额","万元","decision"),
    interestBase:p("计息本金","万元","decision"), rateDiscount:p("贷款利率折扣系数","比例","decision"), loanRate:p("贷款年利率","%","market_stat","market_dynamic"), discount:p("财务基准折现率","%","policy_constant","low_frequency"), repay:p("年度还本金额","万元","decision"),
  },
};

const IMPACT_KEYS={
  rent:{core:["rent","area","stableOcc","rentRate","rentDiscount","manageCoeff","totalInvestment","invest"],important:["buildYears","occRamp","decorationCost","loanAmount","loanRate","parkPrice","subsidyStableOcc"],low:["buildStart","firstMonths","parkRatio","postOfficePrice","firstRepayRatio"]},
  sale:{core:["saleArea","saleAvgPrice","rate1","rate2","rate3","landCost","constructionCost","totalInvestment"],important:["buildYears","commArea","commRent","commStableOcc","loanAmount","loanRate","devCost"],low:["buildStart","leaseMonths","landUseArea","projectInputTax"]},
  gaibao:{core:["rent","area","stableOcc","collect","deco","unitCost","loanRate","discount"],important:["buildYears","rampOcc","decoInt","units","loan","interestBase"],low:["buildStart","firstMonths","startup","rateDiscount"]},
};
function impactOf(type,key){const g=IMPACT_KEYS[type]||{};if((g.core||[]).includes(key))return"核心";if((g.important||[]).includes(key))return"重要";if((g.low||[]).includes(key))return"低影响";return"一般";}

export function catalogFor(defaults){
  const out={};
  for(const [type,values] of Object.entries(defaults||{})){
    out[type]={};
    for(const key of Object.keys(values||{})){const meta=PARAM_META[type]&&PARAM_META[type][key] ? PARAM_META[type][key] : p("未命名参数（"+key+"）","—");out[type][key]={...meta,impactLevel:impactOf(type,key)};}
  }
  return out;
}

export function missingChineseLabels(defaults){
  const miss=[];
  for(const [type,values] of Object.entries(defaults||{})) for(const key of Object.keys(values||{})){
    const m=PARAM_META[type]&&PARAM_META[type][key];
    if(!m||!m.label||m.label.includes("未命名参数")) miss.push(type+"."+key);
  }
  return miss;
}
