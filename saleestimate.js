// 出售类全量投资估算与配售(A)/非配售(B)分摊引擎
// 依据《【配保房】项目测算逻辑说明_第二版》1~46条建立白箱公式树。
// 本文件只负责技术指标、投资估算、A/B分摊和配售价格；销售/出租、损益、贷款和现金流继续由
// salecalc.js 承接。这样可用原 anju-calculator 的已验证结果做回归守门，同时消除“只填汇总数”的最短路径。
window.SaleEstimate = (function(){
const DEFAULTS={
  aboveIncreaseRate:.07, commercialLandTaxRate:.0005,
  pitAreaRate:.85,pitDepth:13.5,pitEarthUnit:150,pitSupportUnit:350,pileUnit:345,basementUnit:2700,
  commercialBuildUnit:2600,residentialBuildUnit:2600,increaseBuildUnit:2500,supportBuildUnit:2600,
  floorHeightUnit:45,acPlatformUnit:80,soundWindowUnit:300,soundFloorUnit:10,railingUnit:65,
  waterUnit:130,electricUnit:265,smartUnit:85,fireUnit:135,gasUnit:40,elevatorUnit:70,hvacUnit:20,
  lightingUnit:10,seismicUnit:12,chargerUnit:1500,pvUnit:20,refuseFireFee:5,civilDefenseUnit:40,installOtherUnit:5,
  interiorUnit:1100,commonRatio:.25,commonUnit:1200,supportDecorationUnit:1100,showroomUnit:1100,
  outdoorPipeUnit:100,landscapeUnit:500,
  surveyUnit:25,pileTestRate:.005,thirdPartyUnit:18,designUnit:75,reviewUnit:5,
  tempWaterUnit:5,tempPowerUnit:10,pipeRelocUnit:15,gradingUnit:5,curbCutFee:50,
  fenceUnit:.15,occupyUnit:.02,feasibilityFee:9.6,envReportFee:15,soilCoeff:.6,trafficCoeff:1.15,geoHazardFee:9,
  managementBase:540,managementThreshold:50000,managementExcessRate:.008,supervisionUnit:62,
  bidAgentUnit:5,bidServiceUnit:8,costConsultUnit:20,onSitePerYear:22.5,costReviewUnit:5,
  insuranceRate:.001,repairFundRate:.02,propertyPrepUnits:[3.5,4,1.5,10],
  gcElevatorRate:.22,gcDecorationRate:.94,gcRate:.025,measureUnit:4,displayUnit:300,
  contingencyRate:0,allocationTaxRate:.0305,housingProfitRate:.05,housingFinanceRate:.03,
  housingFinanceYears:4,vatSale:.09,vatIn6:.06,cityTaxRate:.07,incomeTaxRate:.25,
};
const n=v=>Number(v)||0, r4=x=>Math.round((Number(x)||0)*10000)/10000;
const amount=(area,unit)=>r4(n(area)*n(unit)/10000);
function row(no,name,value,formula,source){return {no,name,value:r4(value),unit:"万元",formula,source:source||"公式计算"};}
function sum(obj,keys){return r4(keys.reduce((s,k)=>s+n(obj[k]),0));}

function estimate(p,cfgIn){
  const K=Object.assign({},DEFAULTS,cfgIn||{}), P=p||{};
  const residentialArea=n(P.residentialArea||P.saleArea), commercialArea=n(P.commercialArea||P.commArea);
  const supportBreakdown=n(P.toiletArea)+n(P.recyclingArea)+n(P.sanitationArea)+n(P.propertyServiceArea);
  const supportArea=n(P.supportArea)||supportBreakdown;
  const capacityArea=r4(residentialArea+commercialArea+supportArea);
  const aboveIncreaseArea=r4(P.aboveIncreaseArea!=null?n(P.aboveIncreaseArea):capacityArea*K.aboveIncreaseRate);
  const basementArea=n(P.basementArea), totalBuildArea=r4(capacityArea+aboveIncreaseArea+basementArea);
  const landArea=n(P.landArea||P.landUseArea), plotRatio=landArea?r4(capacityArea/landArea):null;
  const saleBase=residentCommercialBase(residentialArea,commercialArea), ratioSale=saleBase?residentialArea/saleBase:0, ratioComm=1-ratioSale;

  // 5 土地成本费用
  const residentialLandPrice=n(P.residentialLandPrice)||(n(P.allocatedLandFloorPrice||P.landFloorPrice)*residentialArea/10000);
  const commercialLandPrice=n(P.commercialLandPrice)||(n(P.commercialLandUnitPrice)*commercialArea/10000);
  const pipelineRelocation=n(P.pipelineRelocationFee), outsideMunicipal=n(P.outsideMunicipalFee), landOther=n(P.landOtherFee);
  const landPriceTotal=r4(residentialLandPrice+commercialLandPrice+pipelineRelocation+outsideMunicipal+landOther);
  const landTax=r4(commercialLandPrice*K.commercialLandTaxRate), landCostTotal=r4(landPriceTotal+landTax);

  // 6 建筑安装工程费
  const c={};
  c.slope=0;c.pitEarth=r4(landArea*K.pitAreaRate*K.pitDepth*K.pitEarthUnit/10000);
  c.pitSupport=amount(totalBuildArea,K.pitSupportUnit);c.pile=amount(totalBuildArea,K.pileUnit);c.basement=amount(basementArea,K.basementUnit);
  c.undergroundTotal=sum(c,["slope","pitEarth","pitSupport","pile","basement"]);
  c.commercialBuild=amount(commercialArea,K.commercialBuildUnit);c.residentialBuild=amount(residentialArea,K.residentialBuildUnit);
  c.increaseBuild=amount(aboveIncreaseArea,K.increaseBuildUnit);c.supportBuild=amount(supportArea,K.supportBuildUnit);
  c.transferredSupport=n(P.transferredSupportBuildFee);c.aboveOther=n(P.aboveOtherFee);
  c.floorHeight=amount(totalBuildArea,K.floorHeightUnit);c.acPlatform=amount(totalBuildArea,K.acPlatformUnit);
  c.soundWindow=amount(totalBuildArea,K.soundWindowUnit);c.soundFloor=amount(totalBuildArea,K.soundFloorUnit);c.railing=amount(totalBuildArea,K.railingUnit);
  c.newRuleTotal=sum(c,["floorHeight","acPlatform","soundWindow","soundFloor","railing"]);
  c.aboveTotal=sum(c,["commercialBuild","residentialBuild","increaseBuild","supportBuild","transferredSupport","aboveOther","newRuleTotal"]);
  const structArea=r4(residentialArea+commercialArea+aboveIncreaseArea+supportArea);
  c.water=amount(totalBuildArea,K.waterUnit);c.electric=amount(totalBuildArea,K.electricUnit);c.smart=amount(totalBuildArea,K.smartUnit);
  c.fire=amount(totalBuildArea,K.fireUnit);c.gas=amount(totalBuildArea,K.gasUnit);c.elevator=amount(totalBuildArea,K.elevatorUnit);
  c.hvac=amount(totalBuildArea,K.hvacUnit);c.lighting=amount(structArea,K.lightingUnit);c.seismic=amount(totalBuildArea,K.seismicUnit);
  c.charger=r4(n(P.chargerCount)*K.chargerUnit/10000);c.pv=r4(n(P.pvCount)*K.pvUnit);c.refuseFire=K.refuseFireFee;
  c.supercharge=n(P.superchargeFee);c.smartConstruction=n(P.smartConstructionFee);c.civilDefense=amount(totalBuildArea,K.civilDefenseUnit);
  c.installOther=amount(totalBuildArea,K.installOtherUnit);
  c.installTotal=sum(c,["water","electric","smart","fire","gas","elevator","hvac","lighting","seismic","charger","pv","refuseFire","supercharge","smartConstruction","civilDefense","installOther"]);
  c.interior=amount(residentialArea,K.interiorUnit);c.common=amount(residentialArea*K.commonRatio,K.commonUnit);
  c.supportDecoration=amount(supportArea,K.supportDecorationUnit);c.transferredDecoration=n(P.transferredDecorationFee);
  c.showroom=amount(n(P.showroomArea),K.showroomUnit);c.commercialDecoration=n(P.commercialDecorationFee);c.outerDecoration=n(P.outerDecorationFee);
  c.decorationTotal=sum(c,["interior","common","supportDecoration","transferredDecoration","showroom","commercialDecoration","outerDecoration"]);
  c.total=r4(c.undergroundTotal+c.aboveTotal+c.installTotal+c.decorationTotal);

  // 7 基础设施建设费
  const infra={outdoorPipe:amount(landArea,K.outdoorPipeUnit),landscape:amount(landArea,K.landscapeUnit),green:n(P.greenBuildingFee)};
  infra.total=sum(infra,["outdoorPipe","landscape","green"]);

  // 8 前期工程费
  const pre={survey:amount(totalBuildArea,K.surveyUnit),pileTest:r4(c.total*K.pileTestRate),thirdParty:amount(totalBuildArea,K.thirdPartyUnit)};
  pre.surveyTotal=sum(pre,["survey","pileTest","thirdParty"]);pre.design=amount(totalBuildArea,K.designUnit);pre.review=amount(totalBuildArea,K.reviewUnit);pre.designTotal=sum(pre,["design","review"]);
  pre.tempWater=amount(totalBuildArea,K.tempWaterUnit);pre.tempPower=amount(totalBuildArea,K.tempPowerUnit);pre.pipeReloc=amount(totalBuildArea,K.pipeRelocUnit);pre.grading=amount(totalBuildArea,K.gradingUnit);
  pre.curbCut=r4(n(P.curbCutCount)*K.curbCutFee);pre.utilityOther=n(P.utilityOtherFee);pre.utilityTotal=sum(pre,["tempWater","tempPower","pipeReloc","grading","curbCut","utilityOther"]);
  pre.fence=r4(n(P.fenceArea)*K.fenceUnit);pre.facility=r4(n(P.facilityArea)*n(P.facilityUnitPrice));pre.occupy=r4(n(P.occupyArea)*K.occupyUnit);pre.temporaryTotal=sum(pre,["fence","facility","occupy"]);
  pre.feasibility=P.feasibilityFee!=null?n(P.feasibilityFee):K.feasibilityFee;pre.environment=P.envReportFee!=null?n(P.envReportFee):K.envReportFee;
  pre.soil=r4(K.soilCoeff*landArea/10000);pre.traffic=r4(K.trafficCoeff*totalBuildArea/10000);pre.geo=P.geoHazardFee!=null?n(P.geoHazardFee):K.geoHazardFee;
  pre.consultTotal=sum(pre,["feasibility","environment","soil","traffic","geo"]);pre.approval=n(P.approvalFee);
  pre.total=r4(pre.surveyTotal+pre.designTotal+pre.utilityTotal+pre.temporaryTotal+pre.consultTotal+pre.approval);

  // 9 开发间接费
  const basicForManagement=r4(c.total+infra.total+pre.total), excess=Math.max(0,basicForManagement-K.managementThreshold);
  const indirect={management:r4(K.managementBase+excess*K.managementExcessRate),supervision:amount(totalBuildArea,K.supervisionUnit)};
  indirect.bidAgent=amount(totalBuildArea,K.bidAgentUnit);indirect.bidService=amount(totalBuildArea,K.bidServiceUnit);indirect.biddingTotal=sum(indirect,["bidAgent","bidService"]);
  indirect.costBase=amount(totalBuildArea,K.costConsultUnit);indirect.onSite=r4(n(P.buildYears)*K.onSitePerYear);indirect.costReview=amount(totalBuildArea,K.costReviewUnit);indirect.costTotal=sum(indirect,["costBase","onSite","costReview"]);
  indirect.insurance=r4(c.total*K.insuranceRate);indirect.propertyFund=r4(c.total*K.repairFundRate);
  indirect.propertyPrep=amount(totalBuildArea,K.propertyPrepUnits.reduce((s,x)=>s+x,0));
  indirect.gcManagement=r4((c.elevator*K.gcElevatorRate+c.decorationTotal*K.gcDecorationRate+infra.landscape)*K.gcRate);
  indirect.measure=amount(totalBuildArea,K.measureUnit);indirect.display=amount(n(P.displayArea),K.displayUnit);
  indirect.total=sum(indirect,["management","supervision","biddingTotal","costTotal","insurance","propertyFund","propertyPrep","gcManagement","measure","display"]);
  const repairFund=r4(c.total*K.repairFundRate), contingency=r4((pre.total+c.total+indirect.total)*K.contingencyRate);
  const baseInvestment=r4(landCostTotal+c.total+infra.total+pre.total+indirect.total+repairFund+contingency);

  // 19~43 A/B分摊。专属住宅/商业地价与地上主体按直接归属，其余共用项按面积比例；强制保证A+B=总额。
  const allocComponent=(total,aDirect,bDirect)=>{const shared=r4(total-n(aDirect)-n(bDirect));return {a:r4(n(aDirect)+shared*ratioSale),b:r4(n(bDirect)+shared*ratioComm)};};
  const alloc={ratioSale:r4(ratioSale),ratioComm:r4(ratioComm)};
  alloc.land={a:r4(residentialLandPrice),b:r4(landCostTotal-residentialLandPrice)};
  alloc.construction=allocComponent(c.total,c.residentialBuild+c.interior+c.common,c.commercialBuild+c.commercialDecoration);
  alloc.infrastructure=allocComponent(infra.total,0,0);alloc.preConstruction=allocComponent(pre.total,0,0);alloc.indirect=allocComponent(indirect.total,0,0);
  alloc.repairFund=allocComponent(repairFund,0,0);alloc.contingency=allocComponent(contingency,0,0);
  alloc.aBase=r4(alloc.land.a+alloc.construction.a+alloc.infrastructure.a+alloc.preConstruction.a+alloc.indirect.a+alloc.repairFund.a+alloc.contingency.a);
  alloc.bBase=r4(baseInvestment-alloc.aBase);
  const saleTotalBuildArea=r4(residentialArea+(supportArea+aboveIncreaseArea+basementArea)*ratioSale);
  const nonSaleTotalBuildArea=r4(totalBuildArea-saleTotalBuildArea);

  // 46 配售住房销售价格（不含最终税项中的循环影响，财务费由 salecalc bridge 回填）
  const transferIncome=n(P.costTransferIncome);
  const engineeringUnit=residentialArea?r4((alloc.construction.a+alloc.infrastructure.a+alloc.contingency.a-transferIncome*ratioSale)/residentialArea*10000):0;
  const otherUnit=residentialArea?r4((alloc.preConstruction.a+alloc.indirect.a)/residentialArea*10000):0;
  const repairUnit=residentialArea?r4(alloc.repairFund.a/residentialArea*10000):0;
  const landUnit=n(P.allocatedLandFloorPrice||P.landFloorPrice);
  const financeUnit=r4(landUnit*(Math.pow(1+K.housingFinanceRate,K.housingFinanceYears)-1)+(engineeringUnit+otherUnit)*(Math.pow(1+K.housingFinanceRate,K.housingFinanceYears/2)-1));
  const profitUnit=r4((landUnit+engineeringUnit+otherUnit)*K.housingProfitRate);
  const vatUnit=r4((engineeringUnit+otherUnit+repairUnit)*K.vatSale-(engineeringUnit/1.09*K.vatSale+otherUnit/1.06*K.vatIn6));
  const cityTaxUnit=r4(vatUnit*K.cityTaxRate), incomeTaxUnit=r4(profitUnit*K.incomeTaxRate);
  const housingPrice=r4(landUnit+engineeringUnit+otherUnit+repairUnit+financeUnit+profitUnit+vatUnit+cityTaxUnit+incomeTaxUnit);

  const rows=[
    row("1","总建筑面积",totalBuildArea,"计容建筑面积+地面核增面积+地下室面积"),row("1.1","计容建筑面积",capacityArea,"住宅+商业+公共配套"),row("1.2","地面核增面积",aboveIncreaseArea,"计容建筑面积×7%"),
    row("5","土地成本费用",landCostTotal,"地价+土地税费"),row("5.1","地价",landPriceTotal,"住宅地价+商业地价+管线迁改+红线外市政+其他"),row("5.2","土地税费",landTax,"商业地价×0.05%"),
    row("6","建筑安装工程费",c.total,"地下+地上+安装+装修"),row("6.1","地下建筑部分",c.undergroundTotal,"土方+支护+桩基+地下室"),row("6.2","地上建筑部分",c.aboveTotal,"商业+住宅+核增+公配+新规"),row("6.3","安装工程",c.installTotal,"给排水+电气+智能化+消防+燃气+电梯等"),row("6.4","装修工程",c.decorationTotal,"户内+公区+公配+样板房等"),
    row("7","基础设施建设费",infra.total,"室外管线+景观+绿色建筑"),row("8","前期工程费",pre.total,"勘察+设计+三通一平+临设+咨询+报批"),row("9","开发间接费",indirect.total,"管理+监理+招标+造价+保险+物业筹备等"),row("10","物业维修基金",repairFund,"建安工程费×2%"),row("13","不可预见费",contingency,"(前期+建安+间接)×费率"),row("14","不含财务费及销售费投资",baseInvestment,"土地+建安+基础设施+前期+间接+维修基金+不可预见费"),
    row("29","计入配售部分投资(A·暂不含财务/销售费)",alloc.aBase,"A部分各项之和"),row("41","不计入配售部分投资(B·暂不含财务/销售费)",alloc.bBase,"B部分各项之和"),
    row("46","配售住房测算价格",housingPrice,"项目地价+工程建设+财务成本+利润+税金","元/㎡")
  ];
  rows[0].unit="㎡";rows[1].unit="㎡";rows[2].unit="㎡";
  rows[rows.length-1].unit="元/㎡";
  rows.push(
    row("1.3","容积率",plotRatio||0,"计容建筑面积÷用地面积","公式计算"),
    row("5.1.1","住宅地价",residentialLandPrice,"划拨楼面价×住宅面积，或直接输入住宅地价"),row("5.1.2","商业地价",commercialLandPrice,"商业标准地价×商业面积，或直接输入商业地价"),
    row("5.1.3","管线迁改费",pipelineRelocation,"项目事实输入"),row("5.1.4","红线外市政设施费",outsideMunicipal,"项目事实输入"),row("5.1.5","土地其他费用",landOther,"项目事实输入"),
    row("6.1.1","山体削坡工程",c.slope,"本版固定为0"),row("6.1.2","基坑土石方工程",c.pitEarth,"用地面积×0.85×13.5×150÷10000"),row("6.1.3","基坑支护工程",c.pitSupport,"总建筑面积×350÷10000"),row("6.1.4","桩基工程",c.pile,"总建筑面积×345÷10000"),row("6.1.5","地下室建筑工程",c.basement,"地下室面积×2700÷10000"),
    row("6.2.1","商业建筑工程",c.commercialBuild,"商业面积×2600÷10000"),row("6.2.2","住宅建筑工程",c.residentialBuild,"住宅面积×2600÷10000"),row("6.2.3","地面核增工程",c.increaseBuild,"地面核增面积×2500÷10000"),row("6.2.4","公共配套工程",c.supportBuild,"公配面积×2600÷10000"),row("6.2.7","新规增量成本",c.newRuleTotal,"层高+空调板+隔声窗+隔声楼板+栏杆"),
    row("6.2.7.1","层高增量",c.floorHeight,"总建筑面积×45÷10000"),row("6.2.7.2","空调板增量",c.acPlatform,"总建筑面积×80÷10000"),row("6.2.7.3","隔声窗增量",c.soundWindow,"总建筑面积×300÷10000"),row("6.2.7.4","楼板隔声增量",c.soundFloor,"总建筑面积×10÷10000"),row("6.2.7.5","栏杆增量",c.railing,"总建筑面积×65÷10000"),
    row("6.3.1","给排水工程",c.water,"总建筑面积×130÷10000"),row("6.3.2","电气工程",c.electric,"总建筑面积×265÷10000"),row("6.3.3","智能化工程",c.smart,"总建筑面积×85÷10000"),row("6.3.4","消防工程",c.fire,"总建筑面积×135÷10000"),row("6.3.5","燃气工程",c.gas,"总建筑面积×40÷10000"),row("6.3.6","电梯工程",c.elevator,"总建筑面积×70÷10000"),row("6.3.7","暖通工程",c.hvac,"总建筑面积×20÷10000"),row("6.3.8","外立面照明",c.lighting,"地上结构面积×10÷10000"),row("6.3.9","抗震支架",c.seismic,"总建筑面积×12÷10000"),row("6.3.10","充电桩",c.charger,"充电桩数量×1500÷10000"),row("6.3.11","光伏工程",c.pv,"光伏计量项×20"),row("6.3.12","垃圾收集及消防站",c.refuseFire,"本版5万元"),row("6.3.15","人防工程",c.civilDefense,"总建筑面积×40÷10000"),row("6.3.16","安装其他工程",c.installOther,"总建筑面积×5÷10000"),
    row("6.4.1","户内装修",c.interior,"住宅面积×1100÷10000"),row("6.4.2","公共区域装修",c.common,"住宅面积×25%×1200÷10000"),row("6.4.3","公配装修",c.supportDecoration,"公配面积×1100÷10000"),row("6.4.5","样板房装修",c.showroom,"样板房面积×1100÷10000"),
    row("7.1","室外管线",infra.outdoorPipe,"用地面积×100÷10000"),row("7.2","景观工程",infra.landscape,"用地面积×500÷10000"),row("7.3","绿色建筑",infra.green,"本版项目输入，默认0"),
    row("8.1","勘察检测费",pre.surveyTotal,"工程勘察+桩基检测+第三方监测"),row("8.1.1","工程勘察",pre.survey,"总建筑面积×25÷10000"),row("8.1.2","桩基检测",pre.pileTest,"建安工程费×0.5%"),row("8.1.3","第三方监测",pre.thirdParty,"总建筑面积×18÷10000"),
    row("8.2","规划设计费",pre.designTotal,"工程设计+施工图审查"),row("8.2.1","工程设计费",pre.design,"总建筑面积×75÷10000"),row("8.2.2","施工图审查费",pre.review,"总建筑面积×5÷10000"),
    row("8.3","三通一平费",pre.utilityTotal,"临水+临电+管线迁改+平整+路口+其他"),row("8.4","临时设施费",pre.temporaryTotal,"围挡+临设+临时占地"),row("8.5","前期论证咨询费",pre.consultTotal,"可研+环评+水保+交评+地灾"),row("8.5.1","可研费",pre.feasibility,"出售类第二版本项目9.6万元，可由项目值覆盖"),row("8.5.2","环境报告编制",pre.environment,"本版15万元"),row("8.5.3","水土保持",pre.soil,"0.6×用地面积÷10000"),row("8.5.4","交通影响评估",pre.traffic,"1.15×总建筑面积÷10000"),row("8.5.5","地质灾害评估",pre.geo,"出售类第二版本项目9万元，可由项目值覆盖"),
    row("9.1","项目管理费",indirect.management,"540+(基础费用-50000)×0.8%"),row("9.2","工程监理费",indirect.supervision,"总建筑面积×62÷10000"),row("9.3","招标费用",indirect.biddingTotal,"招标代理+交易服务"),row("9.4","造价咨询费",indirect.costTotal,"基本咨询+驻场+结算审核"),row("9.5","工程保险费",indirect.insurance,"建安工程费×0.1%"),row("9.6","物业前期费用",indirect.propertyPrep,"总建筑面积×(3.5+4+1.5+10)÷10000"),row("9.7","总包管理费",indirect.gcManagement,"(电梯×22%+装修×94%+景观)×2.5%"),row("9.8","面积测绘费",indirect.measure,"总建筑面积×4÷10000"),row("9.9","展示区费用",indirect.display,"展示面积×300÷10000")
  );
  const farRow=rows.find(x=>x.no==="1.3");if(farRow)farRow.unit="";
  const reconciliation={
    totalVsAB:r4(baseInvestment-alloc.aBase-alloc.bBase),
    constructionVsAB:r4(c.total-alloc.construction.a-alloc.construction.b),
    infrastructureVsAB:r4(infra.total-alloc.infrastructure.a-alloc.infrastructure.b),
    passed:false
  };
  const abRows=[
    ["20/32","土地成本",alloc.land.a,alloc.land.b,landCostTotal],
    ["21/33","建筑安装工程费",alloc.construction.a,alloc.construction.b,c.total],
    ["22/34","基础设施建设费",alloc.infrastructure.a,alloc.infrastructure.b,infra.total],
    ["23/35","前期工程费",alloc.preConstruction.a,alloc.preConstruction.b,pre.total],
    ["24/36","开发间接费",alloc.indirect.a,alloc.indirect.b,indirect.total],
    ["25/37","物业维修基金",alloc.repairFund.a,alloc.repairFund.b,repairFund],
    ["28/40","不可预见费",alloc.contingency.a,alloc.contingency.b,contingency],
  ].map(x=>({no:x[0],name:x[1],a:r4(x[2]),b:r4(x[3]),total:r4(x[4]),difference:r4(x[4]-x[2]-x[3])}));
  reconciliation.passed=Object.values(reconciliation).filter(v=>typeof v==="number").every(v=>Math.abs(v)<.01);
  return {mode:"full",technical:{residentialArea,commercialArea,supportArea,capacityArea,aboveIncreaseArea,basementArea,totalBuildArea,plotRatio,saleTotalBuildArea,nonSaleTotalBuildArea},land:{residentialLandPrice,commercialLandPrice,pipelineRelocation,outsideMunicipal,landOther,landPriceTotal,landTax,total:landCostTotal},construction:c,infrastructure:infra,preConstruction:pre,indirect,repairFund,contingency,baseInvestment,allocation:alloc,allocationRows:abRows,housingPrice:{landUnit,engineeringUnit,otherUnit,repairUnit,financeUnit,profitUnit,vatUnit,cityTaxUnit,incomeTaxUnit,total:housingPrice},rows,reconciliation};
}
function residentCommercialBase(a,b){return n(a)+n(b);}
function bridge(p,est,financeTotal,saleFeeTotal){
  if(!est)return Object.assign({},p);
  const A=est.allocation, total=r4(est.baseInvestment+n(financeTotal)+n(saleFeeTotal));
  return Object.assign({},p,{
    saleArea:est.technical.residentialArea,commArea:est.technical.commercialArea,landUseArea:p.landArea||p.landUseArea,
    // 以下字段均由 Word 第二版的 A/B 分摊表直接派生，不再接受旧引擎的汇总值覆盖。
    landCost:A.land.b,constructionCost:A.construction.b,infraCost:A.infrastructure.b,
    otherEngCost:r4(A.preConstruction.b+A.indirect.b+A.repairFund.b+A.contingency.b),
    devCost:r4(A.bBase),saleConstructionCost:A.construction.a,saleInfraCost:A.infrastructure.a,
    saleOtherCost6:r4(A.preConstruction.a+A.indirect.a+n(saleFeeTotal)),
    nonSalePropertyBase:r4(A.land.b+A.construction.b+A.infrastructure.b+A.preConstruction.b+A.indirect.b+A.repairFund.b),
    totalInvestment:total,
    saleDevelopmentCost:r4(A.aBase),
    nonSaleDepreciableCost:r4(A.bBase*.8),
    nonSaleRecoverableFixed:r4(A.bBase*.2),
    saleEstimate:est,
  });
}
return {estimate,bridge,defaults:DEFAULTS};
})();
