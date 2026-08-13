// 投资估算引擎 —— 出租类项目「一、技术指标」「二、投资估算」「三、工期进度」
// 依据《出租类项目测算逻辑说明_第二版》1~18条逐项翻译。所有单方造价系数集中在 INVEST_DEFAULTS，
// 可通过 CALC_CFG.invest 覆盖（与 rentcalc.js 的 RENT_DEFAULTS/CALC_CFG.rent 同一套约定）。
window.InvestEstimate = (function(){
const INVEST_DEFAULTS = {
  aboveIncreaseRate: 0.07,     // 1.2 地面核增面积=计容建筑面积×7%
  landTaxRate: 0.0305,         // 5.2 土地税费=地价×3.05%

  // 6.1 勘察检测费（元/㎡，按总建筑面积，下同注明）
  surveyPerSqm: 25, pileTestRate: 0.01 /* ×建安工程费 */, thirdPartyPerSqm: 25,
  // 6.2 规划设计费
  designPerSqm: 95, designReviewPerSqm: 5,
  // 6.3 三通一平（前四项按总建筑面积；路口开设费按个数，万元/个）
  tempWaterPerSqm: 5, tempPowerPerSqm: 10, pipeRelocPerSqm: 30, gradingPerSqm: 5, curbCutPricePerUnit: 50,
  // 6.4 临时设施费（doc原文未写/10000，按原文字面实现）
  fencePerSqm: 0.15, occupyPerSqm: 0.02,
  // 6.5 前期论证咨询费（可研费/环境报告编制费/地质灾害危险评估费原为纯人工填入、无默认值；
  // 出租类按本项目实测微调，补上默认值，人工仍可通过p.feasibilityFee等逐项覆盖，不影响其余测算类型）
  soilConservCoeff: 0.6 /* ×用地面积/10000 */, trafficAssessCoeff: 1.15 /* ×总建筑面积/10000 */,
  feasibilityFeeDefault: 12.6 /* 万元，可研费 */, envReportFeeDefault: 15 /* 万元，环境报告编制费 */,
  geoHazardFeeDefault: 10 /* 万元，地质灾害危险评估费 */,

  // 7.1 地下建筑部分（基坑土方石工程=用地面积×pitEarthFactor1×pitEarthFactor2×pitEarthFactor3/10000，拆成3个标量系数以便后台逐个调整）
  pitEarthFactor1: 0.9, pitEarthFactor2: 13.5, pitEarthFactor3: 160,
  pitSupportPerSqm: 300, pilePerSqm: 300,
  basementPerSqm: 2950,   // 地下室建筑工程：doc原文遗漏/10000（与其余系数量级不符，按同一口径补上，见下方计算处注释）

  // 7.2 地上建筑结构
  commBuildPerSqm: 3500, resiBuildPerSqm: 2750, increasePerSqm: 2400, supportBuildPerSqm: 2750,
  greenBuildPerSqm: 55,   // 绿色建筑：doc原文同样遗漏/10000，处理方式同地下室建筑工程

  // 7.3 安装工程
  waterPerSqm: 150, elecPerSqm: 300, smartPerSqm: 100, firePerSqm: 140, gasPerSqm: 40,
  elevatorPerSqm: 110, hvacPerSqm: 37, lightingPerSqm: 37, seismicPerSqm: 20, chargerPerUnit: 2500,

  // 7.4 装修工程
  interiorDecoPerSqm: 900, publicAreaDecoRatio: 0.25, publicAreaDecoPerSqm: 1800,
  kindergartenDecoPerSqm: 1800, propertyRoomDecoPerSqm: 900, otherSupportDecoPerSqm: 700,

  // 7.5 室外工程
  outdoorPipePerSqm: 200, landscapeCoeff: 1.2, landscapePerSqm: 600,

  // 7.6 新规增量成本（"整体也许没有"——用 newRegEnabled 一键开关）
  newRegEnabled: true,
  floorHeightPerSqm: 45, acPlatformPerSqm: 80, soundproofWindowPerSqm: 300,
  soundproofFloorPerSqm: 10, railingPerSqm: 65,

  // 8 开发间接费
  constructMgmtPerSqm: 165, supervisionPerSqm: 62,
  biddingAgentPerSqm: 6, biddingServicePerSqm: 9,
  costConsultBasePerSqm: 25, onSitePerYear: 20.4 /* =12月×1.7万元/月，按"建设年份"计 */, costConsultReviewPerSqm: 5,
  engInsuranceRate: 0.001,           // 工程保险费=建安工程费×0.1%
  propMaintFundRate: 0.02,           // 物业维修基金=建安工程费×2%
  propPrepPerSqm: 3.5, propStartupPerSqm: 4, siteCheckPerSqm: 1.5, cleaningPerSqm: 10,
  generalContractMgmtPerSqm: 30, areaMeasurePerSqm: 4, showAreaRenovPerSqm: 300,

  contingencyRate: 0.05,             // 9 不可遇见费=(前期工程费+建安工程费+开发间接费)×5%

  // 三、工期进度：8阶段归并为4个费用归属区段，季度权重2:6:6:2（doc原文顺序，拆成4个标量以便后台逐个调整）
  scheduleQ1: 2, scheduleQ2: 6, scheduleQ3: 6, scheduleQ4: 2,
};

function r4(x){ return Math.round(x*10000)/10000; }
const pv = (v, d) => (v===null || v===undefined || v==="") ? d : Number(v);

/** p: 一、技术指标
 *  landArea 用地面积, resiArea 住宅面积,
 *  areaKindergarten/areaPostOffice/areaPropertyRoom/areaPoliceRoom 公配四项面积,
 *  basementArea 地下室面积, commArea 商业面积(默认0，出租类多数项目无商业配比),
 *  ── 地价（二选一：直接给单价，或给标定地价/剩余法/权重/五因子由引擎折算）──
 *  landPriceResi 住宅地价单价(元/㎡，直接给定则优先生效)
 *    landBenchmarkResi/landResidualResi/landWeightBenchmark/landWeightResidual/landAdjustFactors(数组,5个修正系数相乘)
 *  postOfficeLandPrice 公配(邮政支局)地价单价(元/㎡，同上二选一)
 *    postOfficeBenchmark/postOfficeResidual/postOfficeWeightBenchmark/postOfficeWeightResidual/postOfficeAdjustFactors
 *  ── 前期工程费用中人工填入/未给系数的子项 ──
 *  curbCutCount 路口开设个数, highVoltageBuryFee 高压线下地费(万元), treeRelocFee 苗木迁移费(万元),
 *  fenceArea 围挡面积, facilityArea 设施面积, facilityUnitPrice 设施单价(万元/㎡), occupyArea 临时场地占用面积,
 *  ── 以下3项已有默认值(K.feasibilityFeeDefault等)，留空按默认值算，逐项目单独填则覆盖默认值 ──
 *  feasibilityFee 可研费(万元，默认12.6), envReportFee 环境报告编制费(万元，默认15), geoHazardFee 地质灾害危险评估费(万元，默认10),
 *  ── 建安工程中人工填入/计数类 ──
 *  chargerCount 充电桩个数, displayArea 展示面积,
 *  buildYears 建设期年数(用于驻场服务费=年数×20.4万元),
 *  户型配比（可选，纯展示不参与投资估算）：unitTypes=[{name,area}] */
function estimate(p, cfgIn){
  const K = Object.assign({}, INVEST_DEFAULTS, cfgIn||{});
  const supportArea = (p.areaKindergarten||0)+(p.areaPostOffice||0)+(p.areaPropertyRoom||0)+(p.areaPoliceRoom||0);
  const capacityArea = (p.resiArea||0) + supportArea;                       // 1.1 计容建筑面积
  const aboveIncrease = r4(capacityArea * K.aboveIncreaseRate);             // 1.2 地面核增面积
  const farRatio = (p.landArea>0) ? r4(capacityArea / p.landArea) : null;   // 1.3 容积率
  const totalBuildArea = r4(capacityArea + aboveIncrease + (p.basementArea||0)); // 1 总建筑面积
  const commArea = p.commArea||0;
  // 建安7.2/7.3.9/7.5.3多处复用的"商业+住宅+地上核增+公配"合计面积
  const buildStructSumArea = commArea + (p.resiArea||0) + aboveIncrease + supportArea;

  const unitTypes = (Array.isArray(p.unitTypes)? p.unitTypes: []).map(t=>({
    name:t.name, area:Number(t.area)||0 }));
  const unitTypesTotal = unitTypes.reduce((s,t)=>s+t.area,0);
  const unitTypesOut = unitTypes.map(t=>({ name:t.name, area:t.area,
    ratio: unitTypesTotal? r4(t.area/unitTypesTotal): null }));

  // ===== 5. 土地成本费用 =====
  const landPriceOf = (direct, benchmark, residual, wB, wR, factors) => {
    if(direct!=null && direct!=="") return Number(direct);
    const adj = (Array.isArray(factors)&&factors.length)? factors.reduce((s,f)=>s*(Number(f)||1),1) : 1;
    return ((pv(benchmark,0)*pv(wB,0)) + (pv(residual,0)*pv(wR,0))) * adj;
  };
  const resiLandPrice = landPriceOf(p.landPriceResi, p.landBenchmarkResi, p.landResidualResi,
    p.landWeightBenchmark, p.landWeightResidual, p.landAdjustFactors);
  const postLandPrice = landPriceOf(p.postOfficeLandPrice, p.postOfficeBenchmark, p.postOfficeResidual,
    p.postOfficeWeightBenchmark, p.postOfficeWeightResidual, p.postOfficeAdjustFactors);
  const resiLandCost = r4(resiLandPrice * (p.resiArea||0) / 10000);          // 5.1.1
  const postLandCost = r4(postLandPrice * (p.areaPostOffice||0) / 10000);    // 5.1.2
  const landPriceTotal = r4(resiLandCost + postLandCost);                    // 5.1
  const landTax = r4(landPriceTotal * K.landTaxRate);                        // 5.2
  const landCostTotal = r4(landPriceTotal + landTax);                        // 5

  // ===== 6. 前期工程费用 =====
  const survey = r4(totalBuildArea*K.surveyPerSqm/10000);
  const thirdParty = r4(totalBuildArea*K.thirdPartyPerSqm/10000);
  // 6.1.2 桩基质量检测=建安工程费×1%——需先算出建安工程费（见下），此处占位，最后统一汇总时回填
  const design = r4(totalBuildArea*K.designPerSqm/10000);
  const designReview = r4(totalBuildArea*K.designReviewPerSqm/10000);
  const planningDesignTotal = r4(design+designReview);                      // 6.2
  const tempWater = r4(totalBuildArea*K.tempWaterPerSqm/10000);
  const tempPower = r4(totalBuildArea*K.tempPowerPerSqm/10000);
  const pipeReloc = r4(totalBuildArea*K.pipeRelocPerSqm/10000);
  const grading = r4(totalBuildArea*K.gradingPerSqm/10000);
  const curbCut = r4((p.curbCutCount||0)*K.curbCutPricePerUnit);
  const highVoltage = r4(p.highVoltageBuryFee||0);
  const treeReloc = r4(p.treeRelocFee||0);
  const threeConnectTotal = r4(tempWater+tempPower+pipeReloc+grading+curbCut+highVoltage+treeReloc); // 6.3
  const fence = r4((p.fenceArea||0)*K.fencePerSqm);
  const facility = r4((p.facilityArea||0)*(p.facilityUnitPrice||0));
  const occupy = r4((p.occupyArea||0)*K.occupyPerSqm);
  const tempFacilityTotal = r4(fence+facility+occupy);                      // 6.4
  const soilConserv = r4(K.soilConservCoeff*(p.landArea||0)/10000);
  const trafficAssess = r4(K.trafficAssessCoeff*totalBuildArea/10000);
  const feasibilityFee = r4(pv(p.feasibilityFee, K.feasibilityFeeDefault)),
    envReportFee = r4(pv(p.envReportFee, K.envReportFeeDefault)),
    geoHazardFee = r4(pv(p.geoHazardFee, K.geoHazardFeeDefault));
  const preConsultTotal = r4(feasibilityFee+envReportFee+soilConserv+trafficAssess+geoHazardFee); // 6.5

  // ===== 7. 建安工程费 =====
  // 7.1 地下建筑部分
  const pitEarth = r4((p.landArea||0)*K.pitEarthFactor1*K.pitEarthFactor2*K.pitEarthFactor3/10000);
  const pitSupport = r4(totalBuildArea*K.pitSupportPerSqm/10000);
  const pileFoundation = r4(totalBuildArea*K.pilePerSqm/10000);
  const basement = r4((p.basementArea||0)*K.basementPerSqm/10000); // 已按/10000口径修正，见 K.basementPerSqm 注释
  const undergroundTotal = r4(0+pitEarth+pitSupport+pileFoundation+basement); // 7.1（山体削坡固定为0）

  // 7.2 地上建筑结构
  const commBuild = r4(commArea*K.commBuildPerSqm/10000);
  const resiBuild = r4((p.resiArea||0)*K.resiBuildPerSqm/10000);
  const aboveIncreaseBuild = r4(aboveIncrease*K.increasePerSqm/10000);
  const supportBuild = r4(supportArea*K.supportBuildPerSqm/10000);
  const greenBuild1 = r4(buildStructSumArea*K.greenBuildPerSqm/10000); // 已按/10000口径修正
  const aboveGroundTotal = r4(commBuild+resiBuild+aboveIncreaseBuild+supportBuild+greenBuild1); // 7.2

  // 7.3 安装工程
  const water=r4(totalBuildArea*K.waterPerSqm/10000), elec=r4(totalBuildArea*K.elecPerSqm/10000),
    smart=r4(totalBuildArea*K.smartPerSqm/10000), fire=r4(totalBuildArea*K.firePerSqm/10000),
    gas=r4(totalBuildArea*K.gasPerSqm/10000), elevator=r4(totalBuildArea*K.elevatorPerSqm/10000),
    hvac=r4(totalBuildArea*K.hvacPerSqm/10000), lighting=r4(buildStructSumArea*K.lightingPerSqm/10000),
    seismic=r4(totalBuildArea*K.seismicPerSqm/10000), charger=r4((p.chargerCount||0)*K.chargerPerUnit/10000);
  const installTotal = r4(water+elec+smart+fire+gas+elevator+hvac+lighting+seismic+charger+0); // 7.3（自行车充电桩固定0）

  // 7.4 装修工程
  const interiorDeco = r4((p.resiArea||0)*K.interiorDecoPerSqm/10000);
  const publicAreaDeco = r4((p.resiArea||0)*K.publicAreaDecoRatio*K.publicAreaDecoPerSqm/10000);
  const supportDeco = r4((p.areaKindergarten||0)*K.kindergartenDecoPerSqm/10000 + (p.areaPropertyRoom||0)*K.propertyRoomDecoPerSqm/10000);
  const otherSupportDeco = r4(((p.areaPostOffice||0)+(p.areaPoliceRoom||0))*K.otherSupportDecoPerSqm/10000);
  const decorationTotal = r4(interiorDeco+publicAreaDeco+supportDeco+otherSupportDeco); // 7.4

  // 7.5 室外工程
  const outdoorPipe = r4((p.landArea||0)*K.outdoorPipePerSqm/10000);
  const landscape = r4((p.landArea||0)*K.landscapeCoeff*K.landscapePerSqm/10000);
  const greenBuild2 = r4(buildStructSumArea*K.greenBuildPerSqm/10000); // doc明确室外工程中重复列示绿色建筑一项，按原文两处都计
  const outdoorTotal = r4(outdoorPipe+landscape+greenBuild2); // 7.5

  // 7.6 新规增量成本（可整体关闭）
  let newRegTotal = 0, newReg = {floorHeight:0, acPlatform:0, soundproofWindow:0, soundproofFloor:0, railing:0};
  if(K.newRegEnabled){
    newReg = {
      floorHeight: r4(totalBuildArea*K.floorHeightPerSqm/10000),
      acPlatform: r4(totalBuildArea*K.acPlatformPerSqm/10000),
      soundproofWindow: r4(totalBuildArea*K.soundproofWindowPerSqm/10000),
      soundproofFloor: r4(totalBuildArea*K.soundproofFloorPerSqm/10000),
      railing: r4(totalBuildArea*K.railingPerSqm/10000),
    };
    newRegTotal = r4(newReg.floorHeight+newReg.acPlatform+newReg.soundproofWindow+newReg.soundproofFloor+newReg.railing);
  }

  const constructionCostPrelim = r4(undergroundTotal+aboveGroundTotal+installTotal+decorationTotal+outdoorTotal+newRegTotal);
  const pileTest = r4(constructionCostPrelim*K.pileTestRate);               // 6.1.2 依赖建安工程费，最后回填
  const surveyTotal = r4(survey+pileTest+thirdParty);                       // 6.1
  const preConstructionCostTotal = r4(surveyTotal+planningDesignTotal+threeConnectTotal+tempFacilityTotal+preConsultTotal); // 6
  const constructionCostTotal = constructionCostPrelim;                     // 7

  // ===== 8. 开发间接费 =====
  const constructMgmt = r4(totalBuildArea*K.constructMgmtPerSqm/10000);
  const supervision = r4(totalBuildArea*K.supervisionPerSqm/10000);
  const biddingAgent = r4(totalBuildArea*K.biddingAgentPerSqm/10000);
  const biddingService = r4(totalBuildArea*K.biddingServicePerSqm/10000);
  const biddingTotal = r4(biddingAgent+biddingService);                    // 8.3
  const costConsultBase = r4(totalBuildArea*K.costConsultBasePerSqm/10000);
  const onSite = r4((p.buildYears||0)*K.onSitePerYear);
  const costConsultReview = r4(totalBuildArea*K.costConsultReviewPerSqm/10000);
  const costConsultTotal = r4(costConsultBase+onSite+costConsultReview);   // 8.4
  const engInsurance = r4(constructionCostTotal*K.engInsuranceRate);       // 8.5
  const propMaintFund = r4(constructionCostTotal*K.propMaintFundRate);
  const propPrep = r4(totalBuildArea*K.propPrepPerSqm/10000);
  const propStartup = r4(totalBuildArea*K.propStartupPerSqm/10000);
  const siteCheck = r4(totalBuildArea*K.siteCheckPerSqm/10000);
  const cleaning = r4(totalBuildArea*K.cleaningPerSqm/10000);
  const propMaintTotal = r4(propMaintFund+propPrep+propStartup+siteCheck+cleaning); // 8.6
  const generalContractMgmt = r4(totalBuildArea*K.generalContractMgmtPerSqm/10000);
  const areaMeasure = r4(totalBuildArea*K.areaMeasurePerSqm/10000);
  const showAreaRenov = r4((p.displayArea||0)*K.showAreaRenovPerSqm/10000);
  const indirectCostTotal = r4(constructMgmt+supervision+biddingTotal+costConsultTotal+engInsurance
    +propMaintTotal+generalContractMgmt+areaMeasure+showAreaRenov); // 8

  // ===== 9. 不可遇见费 =====
  const contingency = r4((preConstructionCostTotal+constructionCostTotal+indirectCostTotal)*K.contingencyRate);

  // ===== 11/14. 开发成本 / 建设投资（不含建设期财务费用；财务费用由 RentCalc 按还本付息表另算）=====
  const developmentCost = r4(landCostTotal+preConstructionCostTotal+constructionCostTotal+indirectCostTotal+contingency);
  const buildInvestment = developmentCost; // 14、建设投资＝土地成本+前期工程+建安+开发间接+不可遇见，与11.1开发成本口径一致

  // ===== 12/13. 建安工程单方造价 =====
  const unitCostWithDeco = totalBuildArea? r4(constructionCostTotal/totalBuildArea*10000): null; // 元/㎡
  const unitCostWithoutDeco = totalBuildArea? r4((constructionCostTotal-smart-interiorDeco)/totalBuildArea*10000): null;

  return {
    technical: { capacityArea, aboveIncrease, farRatio, totalBuildArea, supportArea, unitTypes: unitTypesOut },
    land: { resiLandPrice:r4(resiLandPrice), postLandPrice:r4(postLandPrice), resiLandCost, postLandCost, landPriceTotal, landTax, landCostTotal },
    preConstruction: { survey, pileTest, thirdParty, surveyTotal, design, designReview, planningDesignTotal,
      tempWater, tempPower, pipeReloc, grading, curbCut, highVoltage, treeReloc, threeConnectTotal,
      fence, facility, occupy, tempFacilityTotal,
      feasibilityFee, envReportFee, soilConserv, trafficAssess, geoHazardFee, preConsultTotal,
      total: preConstructionCostTotal },
    construction: { pitEarth, pitSupport, pileFoundation, basement, undergroundTotal,
      commBuild, resiBuild, aboveIncreaseBuild, supportBuild, greenBuild1, aboveGroundTotal,
      water, elec, smart, fire, gas, elevator, hvac, lighting, seismic, charger, installTotal,
      interiorDeco, publicAreaDeco, supportDeco, otherSupportDeco, decorationTotal,
      outdoorPipe, landscape, greenBuild2, outdoorTotal,
      newReg, newRegTotal, total: constructionCostTotal },
    indirect: { constructMgmt, supervision, biddingAgent, biddingService, biddingTotal,
      costConsultBase, onSite, costConsultReview, costConsultTotal, engInsurance, propMaintFund, propPrep,
      propStartup, siteCheck, cleaning, propMaintTotal, generalContractMgmt, areaMeasure, showAreaRenov,
      total: indirectCostTotal },
    contingency,
    summary: { landCostTotal, preConstructionCostTotal, constructionCostTotal, indirectCostTotal, contingency,
      developmentCost, buildInvestment, totalBuildArea, capacityArea, aboveIncrease, farRatio,
      unitCostWithDeco, unitCostWithoutDeco },
  };
}

/** 三、工期进度：8阶段归并为4个费用归属区段，季度权重2:6:6:2（土地成本→前期工程 / 地下建筑 / 地上建筑→安装→精装修 / 室外工程→竣工验收）。
 *  按 buildYears 等比缩放季度权重后，把 estimate() 算出的各区段费用逐季度均摊、再归入自然年，
 *  产出 RentCalc 已支持的 investPlan{年:万元} 格式（loanPlan 假定与投资节奏一致，可单独传 loanRatio 整体缩放）。 */
function schedule(est, buildStart, buildYears, cfgIn, scheduleOpt){
  const K = Object.assign({}, INVEST_DEFAULTS, cfgIn||{});
  const scheduleEngine=typeof window!=="undefined"&&window.InvestmentSchedule;
  if(scheduleEngine){
    const opt=Object.assign({},scheduleOpt||{}, {
      startYear:buildStart,
      startQuarter:Number(scheduleOpt&&scheduleOpt.startQuarter)||Number(K.scheduleStartQuarter)||1,
      buildYears,
      totalQuarters:Math.max(1,Math.round(buildYears*4)),
    });
    if(!opt.template&&K.scheduleTemplate)opt.template=K.scheduleTemplate;
    if(!opt.mappings&&K.scheduleMappings)opt.mappings=K.scheduleMappings;
    return scheduleEngine.allocate(est,opt);
  }
  const weights = [K.scheduleQ1, K.scheduleQ2, K.scheduleQ3, K.scheduleQ4];
  const totalW = weights.reduce((s,w)=>s+w,0);
  const totalQuarters = Math.max(1, Math.round(buildYears*4));
  // 各阶段费用：土地成本 / 前期工程 / 地下建筑 / (地上建筑+安装+装修+室外+新规+开发间接+不可遇见)
  const c = est.construction, ind = est.indirect;
  const phaseCost = [
    r4(est.land.landCostTotal + est.preConstruction.total),
    r4(c.undergroundTotal),
    r4(c.aboveGroundTotal + c.installTotal + c.decorationTotal),
    r4(c.outdoorTotal + c.newRegTotal + ind.total + est.contingency),
  ];
  const phaseQuarters = weights.map(w=> Math.max(1, Math.round(w/totalW*totalQuarters)));
  // 逐季度金额展开，再按4季度=1年归入 investPlan
  const quarterAmounts = [];
  phaseCost.forEach((cost,pi)=>{
    const qn = phaseQuarters[pi];
    const per = cost/qn;
    for(let i=0;i<qn;i++) quarterAmounts.push(per);
  });
  const investPlan = {};
  quarterAmounts.forEach((amt,qi)=>{
    const year = buildStart + Math.floor(qi/4);
    investPlan[year] = r4((investPlan[year]||0) + amt);
  });
  return { investPlan, phaseCost, phaseQuarters };
}

/** 按正式公式序号(1、1.1、1.1.1...18)展开成一维数组，供前端渲染成可逐级折叠的完整表，
 *  方便逐条核对。level=层级(按"."个数)，no末尾不带"."。金额单位默认"万元"，个别行覆盖unit。 */
function outline(est, sch){
  const t=est.technical, l=est.land, pc=est.preConstruction, c=est.construction, ind=est.indirect, s=est.summary;
  const L=(no,label,value,unit,note)=>({no, level:(no.match(/\./g)||[]).length, label, value, unit:(unit===undefined?"万元":unit), note:note||null});
  const rows = [
    L("1","总建筑面积", t.totalBuildArea, "㎡"),
    L("1.1","计容建筑面积", t.capacityArea, "㎡"),
    L("1.2","地面核增面积", t.aboveIncrease, "㎡"),
    L("1.3","容积率", t.farRatio, ""),
    L("2","户型比例规则", null, "", "按项目所在区域住房需求分解综合确定"),
    L("3","建筑面积三档确定规则", null, "", "一房/两房/三房建筑面积根据户型配比结合实际确定"),
    L("4","各户型占比", null, "", t.unitTypes && t.unitTypes.length ? t.unitTypes.map(u=>u.name+" "+u.area+"㎡("+(u.ratio!=null?(u.ratio*100).toFixed(1)+"%":"—")+")").join("；") : "未录入户型明细"),

    L("5","土地成本费用", l.landCostTotal),
    L("5.1","地价", l.landPriceTotal),
    L("5.1.1","住宅地价", l.resiLandCost),
    L("5.1.2","公配地价（邮政支局）", l.postLandCost),
    L("5.1.3","基础修正系数", null, "", "已折入地价单价计算，未单列数值"),
    L("5.2","土地税费", l.landTax),

    L("6","前期工程费用", pc.total),
    L("6.1","勘察检测费", pc.surveyTotal),
    L("6.1.1","工程勘察", pc.survey),
    L("6.1.2","桩基质量检测", pc.pileTest),
    L("6.1.3","第三方监测", pc.thirdParty),
    L("6.2","规划设计费", pc.planningDesignTotal),
    L("6.2.1","工程设计费", pc.design),
    L("6.2.2","施工图审查费", pc.designReview),
    L("6.3","三通一平费用", pc.threeConnectTotal),
    L("6.3.1","临时用水工程", pc.tempWater),
    L("6.3.2","临时用电工程", pc.tempPower),
    L("6.3.3","管线迁改", pc.pipeReloc),
    L("6.3.4","场地平整", pc.grading),
    L("6.3.5","路口开设费", pc.curbCut),
    L("6.3.6","高压线下地费", pc.highVoltage),
    L("6.3.7","苗木迁移费", pc.treeReloc),
    L("6.4","临时设施费", pc.tempFacilityTotal),
    L("6.4.1","临时围挡", pc.fence),
    L("6.4.2","临时设施", pc.facility),
    L("6.4.3","临时场地占用", pc.occupy),
    L("6.5","前期论证咨询费", pc.preConsultTotal),
    L("6.5.1","可研费", pc.feasibilityFee),
    L("6.5.2","环境报告编制费", pc.envReportFee),
    L("6.5.3","水土保持服务费", pc.soilConserv),
    L("6.5.4","交通影响评估费", pc.trafficAssess),
    L("6.5.5","地质灾害危险评估费", pc.geoHazardFee),

    L("7","建安工程费", c.total),
    L("7.1","地下建筑部分", c.undergroundTotal),
    L("7.1.1","山体削坡土方石工程", 0),
    L("7.1.2","基坑土方石工程", c.pitEarth),
    L("7.1.3","基坑支护", c.pitSupport),
    L("7.1.4","桩基", c.pileFoundation),
    L("7.1.5","地下室建筑工程", c.basement),
    L("7.2","地上建筑结构", c.aboveGroundTotal),
    L("7.2.1","商业建筑", c.commBuild),
    L("7.2.2","住宅建筑", c.resiBuild),
    L("7.2.3","地上核增", c.aboveIncreaseBuild),
    L("7.2.4","公共配套", c.supportBuild),
    L("7.2.5","绿色建筑", c.greenBuild1),
    L("7.3","安装工程", c.installTotal),
    L("7.3.1","给排水", c.water),
    L("7.3.2","电气", c.elec),
    L("7.3.3","智能化", c.smart),
    L("7.3.4","消防", c.fire),
    L("7.3.5","燃气", c.gas),
    L("7.3.6","电梯", c.elevator),
    L("7.3.7","通风空调", c.hvac),
    L("7.3.8","泛光照明", c.lighting),
    L("7.3.9","抗震支架", c.seismic),
    L("7.3.10","充电桩", c.charger),
    L("7.3.11","自行车充电桩", 0),
    L("7.4","装修工程", c.decorationTotal),
    L("7.4.1","室内装修", c.interiorDeco),
    L("7.4.2","公区装修", c.publicAreaDeco),
    L("7.4.3","公共配套装修", c.supportDeco),
    L("7.4.4","其他公配装修", c.otherSupportDeco),
    L("7.5","室外工程", c.outdoorTotal),
    L("7.5.1","室外管网", c.outdoorPipe),
    L("7.5.2","园林景观", c.landscape),
    L("7.5.3","绿色建筑", c.greenBuild2),
    L("7.6","新规增量成本", c.newRegTotal),
    L("7.6.1","层高调整", c.newReg.floorHeight),
    L("7.6.2","增加空调机平台", c.newReg.acPlatform),
    L("7.6.3","隔声对门窗", c.newReg.soundproofWindow),
    L("7.6.4","隔声对地面隔音", c.newReg.soundproofFloor),
    L("7.6.5","临空栏杆高度调整等", c.newReg.railing),

    L("8","开发间接费", ind.total),
    L("8.1","建设管理费", ind.constructMgmt),
    L("8.2","工程监理费", ind.supervision),
    L("8.3","招投标费", ind.biddingTotal),
    L("8.3.1","招标代理费", ind.biddingAgent),
    L("8.3.2","招标服务费", ind.biddingService),
    L("8.4","造价咨询费", ind.costConsultTotal),
    L("8.4.1","基本收费", ind.costConsultBase),
    L("8.4.2","驻场服务费", ind.onSite),
    L("8.4.3","复审咨询费", ind.costConsultReview),
    L("8.5","工程保险费", ind.engInsurance),
    L("8.6","物业专项维修基金", ind.propMaintTotal),
    L("8.6.1","物业维修基金", ind.propMaintFund),
    L("8.6.2","物业前置费", ind.propPrep),
    L("8.6.3","物业开办费", ind.propStartup),
    L("8.6.4","现场查验服务费", ind.siteCheck),
    L("8.6.5","开荒保洁费", ind.cleaning),
    L("8.7","总承包管理费", ind.generalContractMgmt),
    L("8.8","建面测量查仗费", ind.areaMeasure),
    L("8.9","样板展示环境改造费", ind.showAreaRenov),

    L("9","不可遇见费", est.contingency),
    L("10","建设期财务费用", null, "", "由测算引擎按还本付息表逐年计算，计入总投资、不在本页体现，见测算结果页「资金来源与运用/还本付息表」"),
    L("11","总投资成本", s.developmentCost, "万元", "=开发成本+建设期财务费用（后者见测算结果页）"),
    L("11.1","开发成本", s.developmentCost),
    L("12","建安工程单方造价（含户内装修）", s.unitCostWithDeco, "元/㎡"),
    L("13","建安工程单方造价（不含户内装修）", s.unitCostWithoutDeco, "元/㎡"),
    L("14","建设投资", s.buildInvestment),
  ];
  if(sch){
    if(Array.isArray(sch.tasks)&&Array.isArray(sch.periods)){
      const taskMap=Object.fromEntries(sch.tasks.map(x=>[x.id,x])),groups=[
        ["15","土地成本及前期工程",["land","preliminary"]],
        ["16","地下建筑部分",["underground","earthwork","pile","basement"]],
        ["17","地上建筑、安装及装修",["above","installation","decoration"]],
        ["18","室外工程及竣工验收",["outdoor","completion"]]
      ];
      groups.forEach(g=>{const active=[...new Set(g[2].flatMap(id=>taskMap[id]&&sch.totalQuarters?InvestmentSchedule.activePeriods(taskMap[id],sch.totalQuarters):[]))].sort((a,b)=>a-b),labels=active.map(q=>sch.periods[q]&&sch.periods[q].label).filter(Boolean);rows.push(L(g[0],g[1],active.length,"季度",labels.join("、")));});
    }else{
      const labels=["土地成本→前期工程","地下建筑部分","地上建筑部分→安装工程→精装修","室外工程→竣工验收"];
      [0,1,2,3].forEach(i=>{rows.push(L(String(15+i), labels[i], sch.phaseQuarters[i], "季度", "对应费用 "+sch.phaseCost[i]+" 万元"));});
    }
  }
  return rows;
}

return { estimate, schedule, outline, defaults: INVEST_DEFAULTS };
})();
