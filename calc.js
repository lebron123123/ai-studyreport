// 测算相关模块 —— 从 index.html 内联脚本拆分而来
// 覆盖：测算表单渲染/读取、明细表规格、Excel导出前的数据准备、灵敏度分析、模式对比、AI问答、汇总卡片渲染等
let calcType = null;         // 'gaibao' | 'rent' | 'sale'
let scStep = 0;              // 测算模块步骤 0选类型 1参数 2结果
let scResult = null;         // 测算结果
let scParams = null;
let pgSelectedKey = null;    // 白箱IRR滑块/单参数曲线当前参数
let pgJointCache = null;
let aiChat = [];             // AI问答历史 [{role, content}]
let CALC_CFG = {gaibao:{}, rent:{}, sale:{}, invest:{}, metrics:[], score:[], examples:[], airules:[], calclogic:{}, sensitivity:{}, paramrules:{}, paramdefaults:{}};   // 后台测算参数配置
async function fetchCalcConfig(){
  try{
    const r = await fetch("/api/calcconfig", {headers:authHeaders()});
    const d = await r.json();
    if(d.ok && d.config) CALC_CFG = Object.assign({gaibao:{},rent:{},sale:{},invest:{},metrics:[],score:[],examples:[],airules:[],calclogic:{},sensitivity:{},paramrules:{},paramdefaults:{}}, d.config);
  }catch(e){}
}
let calcResult = null;   // 财务测算结果（null表示跳过测算，走"待填"模式）
let calcParams = null;
function renderCalcModule(){
  if(scStep===0) return scStepType();
  if(scStep===1) return scStepForm();
  return scStepResult();
}
function scStepType(){
  const card=(k,n,d,dis)=>'<div class="domain-card '+(calcType===k?'sel':'')+(dis?'" style="opacity:.55;':'"')+' data-sct="'+k+'"><div class="dn">'+n+'</div><div class="dd">'+d+'</div>'+(dis?'<div class="dc" style="color:var(--seal-red);">建设中 · 下一轮上线</div>':'')+'</div>';
  return '<div class="doc-eyebrow">财务测算 · STEP 01</div><h1 class="doc-title">选择测算类型</h1>'
    +'<div class="step-desc">三种模型与内部Streamlit测算器口径完全一致（已逐位交叉验证）。</div>'
    +'<div class="domain-grid">'
    + card("gaibao","非居改保类","收楼成本+装修摊销+运营+贷款财务费用，增值税价税分离、五年弥补亏损、年中折现IRR/NPV。")
    + card("rent","出租类（公租房/保租房）","住宅+车位+其他收入，八项经营成本（含装修重置20/10年规则）、六税种、还本付息迭代、利息保障倍数。")
    + card("sale","出售类（配保房等）","配保房销售爬坡+商业出租净收益现值+地价抵减增值税+调整所得税，出售类专用现金流与利息保障倍数。")
    +'</div>'
    +'<div class="actions"><button class="btn" id="scNext1" '+(calcType?'':'disabled')+'>下一步：录入参数 →</button></div>';
}
function scStepForm(){
  const inner = calcType==="gaibao"? calcFormHtml() : (calcType==="sale"? saleFormHtml() : rentFormHtml());
  return '<div class="doc-eyebrow">财务测算 · STEP 02 · '+(calcType==="gaibao"?"非居改保":(calcType==="sale"?"出售类":"出租类"))+'</div>'
    +'<h1 class="doc-title">录入测算参数</h1>'+inner
    +'<div class="actions"><button class="btn ghost" id="scBack0">← 上一步</button><button class="btn" id="scRun">执行测算 →</button></div>';
}

/* 出租类/出售类的"运营期年数"不是独立猜测项——住宅用地使用年限是确定的政策常量(默认70年)，
   运营期=土地使用年限-建设期，两者一变operateYears就跟着自动算，不再要求用户/AI去"预测"这个数。
   （非居改保类暂不适用这条规则，保持原样独立填写。） */
function syncOperateYears(buildId, termId, opId){
  const b = parseFloat(document.getElementById(buildId).value)||0;
  const t = parseFloat(document.getElementById(termId).value)||70;
  const opEl = document.getElementById(opId);
  if(opEl) opEl.value = Math.max(0, t - b);
}
function saleFormHtml(){
  const v = scParams||{}; const expert=(CALC_CFG.paramdefaults&&CALC_CFG.paramdefaults.sale)||{};
  const g=(k,d)=>v[k]!==undefined?v[k]:(expert[k]!==undefined?expert[k]:d);
  const F=(label,id,val,step)=>'<div><label>'+label+'</label><input id="'+id+'" type="number" step="'+(step||"any")+'" value="'+val+'"></div>';
  const sBuildYears = g("buildYears",5), sLandTerm = g("landTerm",70);
  return '<div class="step-desc" style="margin-top:14px;"><b>期限与销售</b></div><div class="grid2">'
    +F("建设期起始年","s_buildStart",g("buildStart",2025))
    +'<div><label>建设期年数</label><input id="s_buildYears" type="number" step="any" value="'+sBuildYears+'" oninput="syncOperateYears(\'s_buildYears\',\'s_landTerm\',\'s_operateYears\')"></div>'
    +'<div><label>土地使用年限（年，默认70）</label><input id="s_landTerm" type="number" step="any" value="'+sLandTerm+'" oninput="syncOperateYears(\'s_buildYears\',\'s_landTerm\',\'s_operateYears\')"></div>'
    +'<div><label>运营期年数（=土地使用年限-建设期，自动计算）</label><input id="s_operateYears" type="number" step="any" value="'+g("operateYears", Math.max(0,sLandTerm-sBuildYears))+'" readonly style="background:var(--line-soft);"></div>'
    +F("其他收入（万元，运营首年一次性）","s_otherTotal",g("otherTotal",0))
    +F("配保房销售面积（㎡）","s_saleArea",g("saleArea",56105))+F("可售售价（元/㎡）","s_saleAvgPrice",g("saleAvgPrice",12880))
    +F("运营第1年销售率","s_rate1",g("rate1",1))+F("运营第2年销售率","s_rate2",g("rate2",0))
    +F("运营第3年销售率","s_rate3",g("rate3",0))+'<div></div>'
    +'</div><div class="step-desc" style="margin-top:14px;"><b>商业出租（净收益现值口径）</b></div><div class="grid2">'
    +F("商业出租面积（㎡）","s_commArea",g("commArea",1750))+F("商业起始租金（元/㎡/月）","s_commRent",g("commRent",64))
    +F("商业租金递增跨度（年）","s_commRentSpan",g("commRentSpan",10))+F("商业租金递增率（%）","s_commRentRate",g("commRentRate",0))
    +'<div><label>商业爬坡期出租率（逗号分隔，如 0.125,0.51,0.765）</label><input id="s_commOccRamp" type="text" value="'+(Array.isArray(g("commOccRamp"))?g("commOccRamp").join(","):"0.125,0.51,0.765")+'"></div>'
    +F("商业稳定期出租率","s_commStableOcc",g("commStableOcc",0.96))
    +F("商业租金冻结起始年（该年起不再递增）","s_commRentStableStart",g("commRentStableStart",2030))+F("商业租赁月数（每年）","s_leaseMonths",g("leaseMonths",12))
    +F("商业停车位个数","s_parkCount",g("parkCount",0))+'<div></div>'
    +'</div><div class="step-desc" style="margin-top:14px;"><b>成本与税费参数</b></div><div class="grid2">'
    +F("(非配售)土地成本费（万元）","s_landCost",g("landCost",1020.53))+F("(非配售)建安工程费（万元）","s_constructionCost",g("constructionCost",5096.1))
    +F("(非配售)基础设施建设费（万元）","s_infraCost",g("infraCost",88.83))+F("(非配售)工程建设其他费用（万元）","s_otherEngCost",g("otherEngCost",416.26))
    +F("(非配售)开发成本费（万元）","s_devCost",g("devCost",7230.84))+F("(配售)建安工程费（万元）","s_saleConstructionCost",g("saleConstructionCost",50240.7))
    +F("(配售)基础设施费（万元）","s_saleInfraCost",g("saleInfraCost",875.77))+F("工程进项税（万元）","s_projectInputTax",g("projectInputTax",0))
    +F("用地面积（㎡）","s_landUseArea",g("landUseArea",14596.19))+F("划拨土地楼面价（元/㎡，地价抵减用）","s_landFloorPrice",g("landFloorPrice",1000))
    +F("项目总投资（万元）","s_totalInvestment",g("totalInvestment",71286.39))
    +F("商业成本价移交面积（㎡）","s_transferArea",g("transferArea",305))+F("移交平均售价（元/㎡）","s_transferPrice",g("transferPrice",5096.1))
    +F("房产税2年基数（万元）","s_prop2AnnualBase",g("prop2AnnualBase",23.2688))
    +'<div><label>空置物业费逐年折减系数（逗号分隔）</label><input id="s_vacFactors" type="text" value="'+(Array.isArray(g("vacFactors"))?g("vacFactors").join(","):"0.88,0.98")+'"></div>'
    +'<div style="grid-column:1/-1; margin-top:6px; font-size:12.5px; color:var(--ink-soft);">以下三项取自「配售部分」「不计入配售部分」专表，口径无法由上述参数还原，可直接填入；留空则由引擎按公式推算</div>'
    +F("开发成本·销售部分（万元）","s_devSaleBaseOverride",g("devSaleBaseOverride",63516.05))
    +F("开发成本·折旧摊销部分（万元）","s_devDepBaseOverride",g("devDepBaseOverride",2216.07))
    +F("销售税金及附加合计（万元）","s_saleTaxTotalOverride",g("saleTaxTotalOverride",831.69))+'<div></div>'
    +'</div><div class="step-desc" style="margin-top:14px;"><b>融资与折现</b></div><div class="grid2">'
    +F("总借款额（万元，建设期首年借入）","s_loanAmount",g("loanAmount",9250.22))+F("贷款年利率（%）","s_loanRate",g("loanRate",3))
    +F("借款总年数","s_loanTotalYears",g("loanTotalYears",25))+F("还款开始年","s_repayStart",g("repayStart",2030))
    +F("每年还款额（万元）","s_repayAmount",g("repayAmount",0))+F("还款年数","s_repayYears",g("repayYears",0))
    +F("折现率（%）","s_discountPct",g("discountPct",3.5))+'<div></div>'
    +'</div>';
}
function readSaleForm(){
  const n=id=>parseFloat(document.getElementById(id).value)||0;
  // 留空即"不覆盖"（引擎按 !=null 判断是否采用），不能用 n() —— 那样空值会被当成0去覆盖公式推算值
  const nOrNull=id=>{ const el=document.getElementById(id); if(!el) return null; const v=el.value; return v===""? null : parseFloat(v); };
  const arr=id=>{ const el=document.getElementById(id); if(!el) return [];
    return String(el.value||"").split(/[,，\s]+/).map(x=>parseFloat(x)).filter(x=>isFinite(x)); };
  return { buildStart:n("s_buildStart"), buildYears:n("s_buildYears"), landTerm:n("s_landTerm")||70, operateYears:n("s_operateYears"),
    otherTotal:n("s_otherTotal"), saleArea:n("s_saleArea"), saleAvgPrice:n("s_saleAvgPrice"),
    rate1:n("s_rate1"), rate2:n("s_rate2"), rate3:n("s_rate3"),
    commArea:n("s_commArea"), commRent:n("s_commRent"), commRentSpan:n("s_commRentSpan"), commRentRate:n("s_commRentRate"),
    commOccRamp:arr("s_commOccRamp"), commStableOcc:n("s_commStableOcc"),
    commRentStableStart:n("s_commRentStableStart"), leaseMonths:n("s_leaseMonths"), parkCount:n("s_parkCount"),
    landCost:n("s_landCost"), constructionCost:n("s_constructionCost"), infraCost:n("s_infraCost"),
    otherEngCost:n("s_otherEngCost"), devCost:n("s_devCost"),
    saleConstructionCost:n("s_saleConstructionCost"), saleInfraCost:n("s_saleInfraCost"),
    projectInputTax:n("s_projectInputTax"), landUseArea:n("s_landUseArea"), landFloorPrice:n("s_landFloorPrice"),
    totalInvestment:n("s_totalInvestment"),
    prop2AnnualBase:nOrNull("s_prop2AnnualBase"), vacFactors:arr("s_vacFactors"),
    devSaleBaseOverride:nOrNull("s_devSaleBaseOverride"), devDepBaseOverride:nOrNull("s_devDepBaseOverride"),
    saleTaxTotalOverride:nOrNull("s_saleTaxTotalOverride"),
    loanAmount:n("s_loanAmount"), loanRate:n("s_loanRate"), loanTotalYears:n("s_loanTotalYears"),
    repayStart:n("s_repayStart"), repayAmount:n("s_repayAmount"), repayYears:n("s_repayYears"),
    discountPct:n("s_discountPct") };
}

function rentFormHtml(){
  const v = scParams||{}; const expert=(CALC_CFG.paramdefaults&&CALC_CFG.paramdefaults.rent)||{};
  const g=(k,d)=>v[k]!==undefined?v[k]:(expert[k]!==undefined?expert[k]:d);
  const F=(label,id,val,step)=>'<div><label>'+label+'</label><input id="'+id+'" type="number" step="'+(step||"any")+'" value="'+val+'"></div>';
  const rBuildYears = g("buildYears",4), rLandTerm = g("landTerm",70);
  return '<div class="grid2">'
    +F("建设期起始年","r_buildStart",g("buildStart",2026))
    +'<div><label>建设期年数</label><input id="r_buildYears" type="number" step="any" value="'+rBuildYears+'" oninput="syncOperateYears(\'r_buildYears\',\'r_landTerm\',\'r_operateYears\')"></div>'
    +'<div><label>土地使用年限（年，默认70）</label><input id="r_landTerm" type="number" step="any" value="'+rLandTerm+'" oninput="syncOperateYears(\'r_buildYears\',\'r_landTerm\',\'r_operateYears\')"></div>'
    +'<div><label>运营期年数（=土地使用年限-建设期，自动计算）</label><input id="r_operateYears" type="number" step="any" value="'+g("operateYears", Math.max(0,rLandTerm-rBuildYears))+'" readonly style="background:var(--line-soft);"></div>'
    +F("运营首年月数","r_firstMonths",g("firstMonths",12))
    +F("住宅面积（㎡）","r_area",g("area",34330))+F("起始租金（元/㎡/月）","r_rent",g("rent",45))
    +F("租金递增跨度（年）","r_rentSpan",g("rentSpan",3))+F("租金递增率（%）","r_rentRate",g("rentRate",5))
    +F("首年出租率","r_rampOcc",g("rampOcc",0.7))+F("稳定期出租率","r_stableOcc",g("stableOcc",0.9))
    +'<div><label>爬坡期出租率（逗号分隔，doc示例：运营第1年0.70→第2年0.80→第3年起稳定0.90）</label><input id="r_occRamp" type="text" value="'+(Array.isArray(g("occRamp"))?g("occRamp").join(","):"0.7,0.8")+'"></div>'
    +F("租金折扣系数（1=租金已含折扣）","r_rentDiscount",g("rentDiscount",1))
    +'<div style="grid-column:1/-1; margin-top:6px; font-size:12.5px; color:var(--ink-soft);">'
    +'政府补贴租金收入——<b>面积填0即不启用</b>，单价与出租率留空则沿用住宅租金取值'
    +'</div>'
    +F("补贴对应面积（㎡）","r_subsidyArea",g("subsidyArea",0))+F("补贴单价（元/㎡/月）","r_subsidyPrice",g("subsidyPrice",0))
    +F("补贴折扣系数","r_subsidyDiscount",g("subsidyDiscount",1))+F("补贴部分出租率","r_subsidyStableOcc",g("subsidyStableOcc",0))
    +'<div style="grid-column:1/-1; margin-top:6px; font-size:12.5px; color:var(--ink-soft);">配套与其他收入</div>'
    +F("车位个数","r_parkCount",g("parkCount",420))+F("车位月租金（元/个）","r_parkPrice",g("parkPrice",200))
    +F("车位收入系数","r_parkRatio",g("parkRatio",0.5))+F("其他收入（万元，首年一次性）","r_otherTotal",g("otherTotal",100))
    +'<div><label>车位爬坡期出租率（逗号分隔，doc示例：运营第1年0.65→第2年0.75→第3年起稳定0.90）</label><input id="r_parkOccRamp" type="text" value="'+(Array.isArray(g("parkOccRamp"))?g("parkOccRamp").join(","):"0.65,0.75")+'"></div>'
    +F("邮政支局面积（㎡）","r_areaPostOffice",g("areaPostOffice",0))+F("邮政支局回购单价（元/㎡）","r_postOfficePrice",g("postOfficePrice",0))
    +F("幼儿园面积（㎡）","r_areaKindergarten",g("areaKindergarten",0))
    +F("物业服务用房面积（㎡，doc未拆分四项公配明细，暂计入本项以凑计容总建面38225）","r_areaPropertyRoom",g("areaPropertyRoom",3895))
    +F("社区警务室面积（㎡）","r_areaPoliceRoom",g("areaPoliceRoom",0))
    +F("总建筑面积（㎡，勾选下方自动测算后将被覆盖）","r_totalBuildArea",g("totalBuildArea",61900.75))+F("管理系数","r_manageCoeff",g("manageCoeff",0.9))
    +F("住宅装修造价（万元）","r_decorationCost",g("decorationCost",800))
    +'<div><label>房源类型</label><select id="r_houseType"><option '+(g("houseType","公租房")==="公租房"?"selected":"")+'>公租房</option><option '+(g("houseType","公租房")==="保租房"?"selected":"")+'>保租房</option></select></div>'
    +F("总投资（万元，折旧基数，勾选下方自动测算后将被覆盖）","r_totalInvestment",g("totalInvestment",15000))+F("用地面积（㎡）","r_landArea",g("landArea",8495.2))
    +F("建安工程费（万元，勾选下方自动测算后将被覆盖）","r_constructionCost",g("constructionCost",6000))+F("总借款额（万元）","r_loanAmount",g("loanAmount",9000))
    +F("贷款年利率（%）","r_loanRate",g("loanRate",3))+F("首次还本比例（%）","r_firstRepayRatio",g("firstRepayRatio",3))
    +F("还本递增率（%）","r_repayIncreaseRate",g("repayIncreaseRate",4.5))+F("借款总年数","r_loanTotalYears",g("loanTotalYears",20))
    +F("建设投资（万元，勾选下方自动测算后将被覆盖）","r_invest",g("invest",15000))+F("折现率（%）","r_discountPct",g("discountPct",3.5))
    +'</div>'
    +'<div class="step-desc" style="margin-top:14px;"><b>投资估算自动测算（可选）</b>'
    +'<label style="font-weight:400; margin-left:10px; font-size:12.5px;">'
    +'<input type="checkbox" id="r_ieEnable" '+(g("ieEnable",true)?"checked":"")+' onchange="document.getElementById(\'r_ieBlock\').style.display=this.checked?\'contents\':\'none\';">'
    +' 启用——按面积与单方造价系数自动算出「总投资/建安工程费/用地面积/总建筑面积/建设投资年度计划」，勾选后上方对应四项与建设投资将被自动覆盖（用地面积/住宅面积/公配面积/车位个数取上方已填数值）。默认已勾选并按doc「本项目实例」预填，方便直接核对结果。'
    +'</label></div>'
    +'<div class="grid2" id="r_ieBlock" style="display:'+(g("ieEnable",true)?"contents":"none")+';">'
    +F("地下室面积（㎡）","r_ie_basementArea",g("ie_basementArea",21000))+F("商业面积（㎡，出租类多数为0）","r_ie_commArea",g("ie_commArea",0))
    +F("住宅地价单价（元/㎡，doc本项目实例未给出，需自行填写才能得到完整总投资）","r_ie_landPriceResi",g("ie_landPriceResi",0))+F("邮政支局地价单价（元/㎡）","r_ie_postOfficeLandPrice",g("ie_postOfficeLandPrice",0))
    +F("路口开设个数","r_ie_curbCutCount",g("ie_curbCutCount",0))+F("高压线下地费（万元，人工填入）","r_ie_highVoltageBuryFee",g("ie_highVoltageBuryFee",0))
    +F("苗木迁移费（万元，人工填入）","r_ie_treeRelocFee",g("ie_treeRelocFee",0))+F("围挡面积（㎡）","r_ie_fenceArea",g("ie_fenceArea",0))
    +F("临时设施面积（㎡）","r_ie_facilityArea",g("ie_facilityArea",0))+F("临时设施单价（万元/㎡）","r_ie_facilityUnitPrice",g("ie_facilityUnitPrice",0))
    +F("临时场地占用面积（㎡）","r_ie_occupyArea",g("ie_occupyArea",0))+F("可研费（万元）","r_ie_feasibilityFee",g("ie_feasibilityFee",0))
    +F("环境报告编制费（万元）","r_ie_envReportFee",g("ie_envReportFee",0))+F("地质灾害危险评估费（万元）","r_ie_geoHazardFee",g("ie_geoHazardFee",0))
    +F("充电桩个数","r_ie_chargerCount",g("ie_chargerCount",0))+F("样板展示面积（㎡）","r_ie_displayArea",g("ie_displayArea",0))
    +'<div style="grid-column:1/-1; font-size:12px; color:var(--ink-soft);">住宅地价单价留空(0)时，可改用「标定地价×权重+剩余法×权重」按修正系数折算——该高级用法需通过后台CALC_CFG.rent.landBenchmarkResi等参数传入，此处表单仅覆盖直接填单价的常规场景。</div>'
    +'</div>';
}
function readRentForm(){
  const n=id=>parseFloat(document.getElementById(id).value)||0;
  const arr=id=>{ const el=document.getElementById(id); if(!el) return [];
    return String(el.value||"").split(/[,，\s]+/).map(x=>parseFloat(x)).filter(x=>isFinite(x)); };
  const p = { buildStart:n("r_buildStart"), buildYears:n("r_buildYears"), landTerm:n("r_landTerm")||70, operateYears:n("r_operateYears"), firstMonths:n("r_firstMonths"),
    area:n("r_area"), rent:n("r_rent"), rentSpan:n("r_rentSpan"), rentRate:n("r_rentRate"), rampOcc:n("r_rampOcc"), stableOcc:n("r_stableOcc"),
    occRamp:arr("r_occRamp"), parkOccRamp:arr("r_parkOccRamp"),
    parkCount:n("r_parkCount"), parkPrice:n("r_parkPrice"), parkRatio:n("r_parkRatio"), parkRampOcc:n("r_rampOcc"), parkStableOcc:n("r_stableOcc"),
    // 政府补贴租金收入：面积为0时引擎自动忽略；单价/出租率填0视为"未填"，回退到住宅租金取值
    rentDiscount: n("r_rentDiscount")||1,
    subsidyArea: n("r_subsidyArea"),
    subsidyPrice: n("r_subsidyPrice")||undefined,
    subsidyDiscount: n("r_subsidyDiscount")||1,
    subsidyStableOcc: n("r_subsidyStableOcc")||undefined,
    subsidyRampOcc: n("r_subsidyStableOcc")||undefined,
    // 配套面积与邮政支局成本回购收入
    areaPostOffice:n("r_areaPostOffice"), postOfficePrice:n("r_postOfficePrice"),
    areaKindergarten:n("r_areaKindergarten"), areaPropertyRoom:n("r_areaPropertyRoom"),
    areaPoliceRoom:n("r_areaPoliceRoom"),
    otherTotal:n("r_otherTotal"), totalBuildArea:n("r_totalBuildArea"), manageCoeff:n("r_manageCoeff"),
    decorationCost:n("r_decorationCost"), houseType:document.getElementById("r_houseType").value,
    totalInvestment:n("r_totalInvestment"), landArea:n("r_landArea"), constructionCost:n("r_constructionCost"),
    loanAmount:n("r_loanAmount"), loanRate:n("r_loanRate"), firstRepayRatio:n("r_firstRepayRatio"),
    repayIncreaseRate:n("r_repayIncreaseRate"), loanTotalYears:n("r_loanTotalYears"),
    invest:n("r_invest"), discountPct:n("r_discountPct") };

  const ieEnable = document.getElementById("r_ieEnable") && document.getElementById("r_ieEnable").checked;
  p.ieEnable = !!ieEnable;
  if(ieEnable && window.InvestEstimate){
    const iePar = {
      landArea:p.landArea, resiArea:p.area, areaKindergarten:p.areaKindergarten, areaPostOffice:p.areaPostOffice,
      areaPropertyRoom:p.areaPropertyRoom, areaPoliceRoom:p.areaPoliceRoom, parkCount:p.parkCount, buildYears:p.buildYears,
      basementArea:n("r_ie_basementArea"), commArea:n("r_ie_commArea"),
      landPriceResi:n("r_ie_landPriceResi")||null, postOfficeLandPrice:n("r_ie_postOfficeLandPrice")||null,
      curbCutCount:n("r_ie_curbCutCount"), highVoltageBuryFee:n("r_ie_highVoltageBuryFee"), treeRelocFee:n("r_ie_treeRelocFee"),
      fenceArea:n("r_ie_fenceArea"), facilityArea:n("r_ie_facilityArea"), facilityUnitPrice:n("r_ie_facilityUnitPrice"),
      occupyArea:n("r_ie_occupyArea"), feasibilityFee:n("r_ie_feasibilityFee"), envReportFee:n("r_ie_envReportFee"),
      geoHazardFee:n("r_ie_geoHazardFee"), chargerCount:n("r_ie_chargerCount"), displayArea:n("r_ie_displayArea"),
    };
    const ieCfg = (CALC_CFG&&CALC_CFG.invest)||{};
    const est = window.InvestEstimate.estimate(iePar, ieCfg);
    const sch = window.InvestEstimate.schedule(est, p.buildStart, p.buildYears, ieCfg);
    // 自动覆盖：总投资/建安工程费/用地面积/总建筑面积/建设投资年度计划；建设期财务费用仍由RentCalc按还本付息表另算
    p.totalInvestment = est.summary.buildInvestment;
    p.constructionCost = est.summary.constructionCostTotal;
    p.totalBuildArea = est.summary.totalBuildArea;
    p.invest = est.summary.buildInvestment;
    p.investPlan = sch.investPlan;
    // 借款按投资节奏同比例分年提取（若总投资为0则退化为全额首年借入，交由RentCalc兜底）
    if(p.loanAmount && est.summary.buildInvestment){
      const scale = p.loanAmount/est.summary.buildInvestment;
      p.loanPlan = {}; Object.keys(sch.investPlan).forEach(y=>{ p.loanPlan[y] = Math.round(sch.investPlan[y]*scale*10000)/10000; });
    }
    p.investEstimate = est;
    p.investSchedule = sch;
  }
  return p;
}

/* ================= 测算明细表 + Excel导出（规格共用） =================
   行属性: id=公式引用标识, l=名称, g=取值, f="pct"百分比, t="none"|"last"合计策略, hl=高亮
   xf=Excel公式: {sum:[ids]} | {cum:"id"} | {expr:(ctx,i)=>公式串}
*/
function dtFmt(x, kind){
  if(x===null || x===undefined || (typeof x==="number" && !isFinite(x))) return "—";
  if(kind==="pct") return (x*100).toLocaleString("zh-CN",{maximumFractionDigits:2})+"%";
  return Number(x).toLocaleString("zh-CN",{maximumFractionDigits:4});
}
function dtable(title, R, rows, open){
  const ys = R.allYears;
  let head = '<tr><th class="dt-l">指标</th><th class="dt-sum">全周期合计</th>'
    + ys.map(y=>'<th>'+y+'</th>').join("") + '</tr>';
  let body = rows.map(r=>{
    const vals = ys.map(y=>{ try{ return r.g(R,y); }catch(e){ return null; } });
    let total;
    if(r.t==="none") total = null;
    else if(r.t==="last"){ const nn = vals.filter(v=>v!==null&&v!==undefined); total = nn.length? nn[nn.length-1] : null; }
    else total = vals.reduce((s,v)=> s + (typeof v==="number"&&isFinite(v)? v:0), 0);
    return '<tr><td class="dt-l'+(r.hl?' dt-hl':'')+'">'+r.l+'</td>'
      +'<td class="dt-sum'+(r.hl?' dt-hl':'')+'">'+(total===null?"—":dtFmt(total, r.f))+'</td>'
      + vals.map(v=>'<td'+(r.hl?' class="dt-hl"':'')+'>'+dtFmt(v, r.f)+'</td>').join("") + '</tr>';
  }).join("");
  return '<details class="dt-block"'+(open?' open':'')+'><summary>'+title+'</summary>'
    +'<div class="dt-scroll"><table class="rpt dt">'+head+body+'</table></div></details>';
}

function calcEffK(){
  const eng = calcType==="gaibao"? window.NRCalc : calcType==="rent"? window.RentCalc : window.SaleCalc;
  return Object.assign({}, eng.defaults||{}, (CALC_CFG&&CALC_CFG[calcType])||{});
}

function specGaibao(){
  return [
   {sheet:"收入", title:"收入明细表（万元）", open:1, rows:[
    {id:"i_rent", l:"住宅租金收入", g:(R,y)=>R.income[y].rent, hl:1},
    {id:"i_rat",  l:"租金收入（不含税）", g:(R,y)=>R.income[y].rentAfterTax,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_rent",i)+"/(1+"+c.param("vatOut")+"),4)"}},
    {l:"出租率", g:(R,y)=>R.resiOccupancy[y], f:"pct", t:"none"},
    {l:"租金单价（元/㎡/月）", g:(R,y)=>R.resiRentPrice[y], t:"none"},
   ]},
   {sheet:"成本", title:"总成本费用明细（万元）", rows:[
    {id:"c_col", l:"收楼成本", g:(R,y)=>R.cost[y].collect},
    {id:"c_eng", l:"工程费用（装修摊销）", g:(R,y)=>R.cost[y].eng},
    {id:"c_op",  l:"运营费用", g:(R,y)=>R.cost[y].op},
    {id:"c_fin", l:"财务费用", g:(R,y)=>R.cost[y].fin},
    {id:"c_shr", l:"合作分成支出", g:(R,y)=>R.cost[y].share||0,
      xf:{expr:(c,i)=>{ try{ return "ROUND("+c.cell("i_rent",i)+"*"+c.param("sharePct")+"/100,4)"; }catch(e){ return null; } }}},
    {id:"c_tot", l:"总成本费用", g:(R,y)=>R.cost[y].total, hl:1, xf:{sum:["c_col","c_eng","c_op","c_fin","c_shr"]}},
    {id:"c_totAT", l:"总成本费用（不含税）", g:(R,y)=>R.cost[y].totalAT,
      xf:{expr:(c,i)=>"ROUND(("+c.cell("c_col",i)+"+"+c.cell("c_eng",i)+")/(1+"+c.param("vatOut")+")+"+c.cell("c_op",i)+"/(1+"+c.param("vatOps")+")+IF("+c.cell("c_fin",i)+">0,"+c.cell("c_fin",i)+"/(1+"+c.param("vatOps")+"),0),4)"}},
   ]},
   {sheet:"还本付息", title:"还本付息计划表（万元）", rows:[
    {id:"l_beg", l:"期初借款余额", g:(R,y)=>R.loan[y].begin, t:"none",
      xf:{expr:(c,i)=> i===0? "0" : c.cell("l_end",i-1)}},
    {id:"l_bor", l:"本期借款", g:(R,y)=>R.loan[y].borrow},
    {id:"l_int", l:"本期利息", g:(R,y)=>R.loan[y].interest,
      xf:{expr:(c,i)=>"ROUND(MAX(("+c.cell("l_beg",i)+"+"+c.cell("l_bor",i)+"/2)*"+c.param("loanRate")+"/100*"+c.param("rateDiscount")+"*"+c.param("interestBase")+"/"+c.param("loan")+",0),4)"}},
    {id:"l_rep", l:"本期还本", g:(R,y)=>R.loan[y].repay},
    {id:"l_pay", l:"还本付息合计", g:(R,y)=>R.loan[y].payTotal, xf:{sum:["l_rep","l_int"]}},
    {id:"l_end", l:"期末借款余额", g:(R,y)=>R.loan[y].end, t:"last",
      xf:{expr:(c,i)=>"ROUND(MAX("+c.cell("l_beg",i)+"+"+c.cell("l_bor",i)+"-"+c.cell("l_rep",i)+",0),4)"}},
   ]},
   {sheet:"税金", title:"税金及附加明细（万元）", rows:[
    {id:"t_out", l:"销项税额", g:(R,y)=>R.tax[y].output,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_rent",i)+"/(1+"+c.param("vatOut")+")*"+c.param("vatOut")+",4)"}},
    {id:"t_in", l:"进项税额", g:(R,y)=>R.tax[y].input,
      xf:{expr:(c,i)=>"ROUND("+c.cell("c_eng",i)+"*"+c.param("vatOut")+"/(1+"+c.param("vatOut")+")+("+c.cell("c_op",i)+"+"+c.cell("c_fin",i)+")*"+c.param("vatOps")+"/(1+"+c.param("vatOps")+"),4)"}},
    {id:"t_vat", l:"增值税", g:(R,y)=>R.tax[y].vat, xf:{expr:(c,i)=>"ROUND(MAX("+c.cell("t_out",i)+"-"+c.cell("t_in",i)+",0),4)"}},
    {id:"t_sur", l:"增值税附加", g:(R,y)=>R.tax[y].surcharge, xf:{expr:(c,i)=>"ROUND("+c.cell("t_vat",i)+"*"+c.param("surcharge")+",4)"}},
    {id:"t_stp", l:"印花税", g:(R,y)=>R.tax[y].stamp},
    {id:"t_tot", l:"税金及附加总和", g:(R,y)=>R.tax[y].total, hl:1, xf:{sum:["t_vat","t_sur","t_stp"]}},
   ]},
   {sheet:"利润", title:"利润表（万元）", rows:[
    {id:"p_iat", l:"营业收入（不含税）", g:(R,y)=>R.profit[y].incomeAT, xf:{expr:(c,i)=>c.cell("i_rat",i)}},
    {id:"p_cat", l:"营业成本（不含税）", g:(R,y)=>R.profit[y].costAT, xf:{expr:(c,i)=>c.cell("c_totAT",i)}},
    {id:"p_tot", l:"利润总额", g:(R,y)=>R.profit[y].totalProfit,
      xf:{expr:(c,i)=>"ROUND("+c.cell("p_iat",i)+"-"+c.cell("p_cat",i)+"-"+c.cell("t_tot",i)+",4)"}},
    {id:"p_mk", l:"弥补以前年度亏损", g:(R,y)=>R.profit[y].makeup},
    {id:"p_tx", l:"应纳税所得额", g:(R,y)=>R.profit[y].taxable, xf:{sum:["p_tot","p_mk"]}},
    {id:"p_it", l:"所得税", g:(R,y)=>R.profit[y].incomeTax,
      xf:{expr:(c,i)=>"ROUND(IF("+c.cell("p_tx",i)+">0,"+c.cell("p_tx",i)+"*"+c.param("incomeTax")+",0),4)"}},
    {id:"p_net", l:"净利润", g:(R,y)=>R.profit[y].netProfit, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("p_tot",i)+"-"+c.cell("p_it",i)+",4)"}},
   ]},
   {sheet:"现金流", title:"现金流量表（万元）", rows:[
    {id:"f_in", l:"现金流入", g:(R,y)=>R.cf[y].inflow, xf:{expr:(c,i)=>c.cell("i_rent",i)}},
    {id:"f_out", l:"现金流出", g:(R,y)=>R.cf[y].outflow,
      xf:{expr:(c,i)=>"ROUND("+c.cell("c_tot",i)+"+"+c.cell("t_tot",i)+"+"+c.cell("p_it",i)+",4)"}},
    {id:"f_net", l:"净现金流量", g:(R,y)=>R.cf[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_in",i)+"-"+c.cell("f_out",i)+",4)"}},
    {id:"f_cum", l:"累计净现金流量", g:(R,y)=>R.cf[y].cumNet, t:"last", xf:{cum:"f_net"}},
    {id:"f_npv", l:"净现值", g:(R,y)=>R.cf[y].npv,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_net",i)+"/POWER(1+"+c.param("discount")+"/100,"+(i+0.5)+"),4)"}},
    {id:"f_cnpv", l:"累计净现值", g:(R,y)=>R.cf[y].cumNpv, t:"last", hl:1, xf:{cum:"f_npv"}},
   ]},
  ];
}

function specRent(){
  return [
   {sheet:"收入", title:"收入明细表（万元，行首编号对应doc「四、收入」19.1-19.4，doc原文该处误写1.1/2.2/2.3，已按父项19规范化）", open:1, rows:[
    {id:"i_resi", l:"19.1 住宅租金收入", g:(R,y)=>R.income[y].resi},
    // 有政府补贴租金时分项列出，便于与Excel逐科目对数；无补贴则不显示这两行
    {id:"i_resi1", l:"　其中：19.1 住宅租金收入", g:(R,y)=>(R.income[y].resiTiers||[])[0],
      show:(R)=>R.operateArr.some(y=>((R.income[y].resiTiers||[])[1]||0)>0)},
    {id:"i_resi2", l:"　其中：19.2 政府补贴租金收入", g:(R,y)=>(R.income[y].resiTiers||[])[1],
      show:(R)=>R.operateArr.some(y=>((R.income[y].resiTiers||[])[1]||0)>0)},
    {id:"i_park", l:"19.3 车位收入", g:(R,y)=>R.income[y].park},
    {id:"i_oth", l:"19.4 其他收入", g:(R,y)=>R.income[y].other},
    {id:"i_tot", l:"19. 总收入", g:(R,y)=>R.income[y].total, hl:1, xf:{sum:["i_resi","i_park","i_oth"]}},
    {l:"出租率", g:(R,y)=>R.resiOcc[y], f:"pct", t:"none"},
    {l:"租金单价（元/㎡/月）", g:(R,y)=>R.resiRent[y], t:"none"},
   ]},
   {sheet:"经营成本", title:"经营成本明细（万元，编号对应doc「四、经营费用」21.1-21.7）", rows:[
    {id:"c_mgH", l:"21.1 管理费用（住房）", g:(R,y)=>R.cost[y].mgH},
    {id:"c_mgP", l:"21.2 管理费用（停车位）", g:(R,y)=>R.cost[y].mgP,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_park",i)+"*"+c.param("mgParkRatio")+",4)"}},
    {id:"c_ins", l:"21.3 保险费", g:(R,y)=>R.cost[y].ins},
    {id:"c_rep", l:"21.4 维修费用", g:(R,y)=>R.cost[y].rep},
    {id:"c_fund", l:"21.5 日常物业维修基金", g:(R,y)=>R.cost[y].fund},
    {id:"c_vac", l:"21.6 空置期物业管理费", g:(R,y)=>R.cost[y].vac},
    {id:"c_rst", l:"21.7 装修重置费", g:(R,y)=>R.cost[y].reset},
    {id:"c_dep", l:"27.1 折旧摊销", g:(R,y)=>R.cost[y].dep},
    {id:"c_op", l:"21. 经营费用合计", g:(R,y)=>R.cost[y].operating, hl:1,
      xf:{sum:["c_mgH","c_mgP","c_ins","c_rep","c_fund","c_vac","c_rst","c_dep"]}},
   ]},
   {sheet:"还本付息", title:"还本付息计划表（万元，编号对应doc「七、还本付息表」33.1-33.4）", rows:[
    {id:"l_beg", l:"期初借款余额", g:(R,y)=>R.loan[y].begin, t:"none",
      xf:{expr:(c,i)=> i===0? "0" : c.cell("l_end",i-1)}},
    {id:"l_bor", l:"本期借款", g:(R,y)=>R.loan[y].borrow},
    {id:"l_int", l:"33.1 本期计息", g:(R,y)=>R.loan[y].interest,
      xf:{expr:(c,i)=>"ROUND(("+c.cell("l_beg",i)+"+"+c.cell("l_bor",i)+"/2)*"+c.param("loanRate")+"/100,4)"}},
    {id:"l_rep", l:"33.3 本期还本", g:(R,y)=>R.loan[y].repay},
    {id:"l_pin", l:"33.2 本期还息", g:(R,y)=>R.loan[y].payInt, xf:{expr:(c,i)=>c.cell("l_int",i)}},
    {id:"l_pay", l:"还本付息合计", g:(R,y)=>R.loan[y].total, xf:{sum:["l_rep","l_pin"]}},
    {id:"l_end", l:"33.4 期末借款累计", g:(R,y)=>R.loan[y].end, t:"last",
      xf:{expr:(c,i)=>"ROUND(MAX("+c.cell("l_beg",i)+"+"+c.cell("l_bor",i)+"+"+c.cell("l_int",i)+"-"+c.cell("l_pin",i)+"-"+c.cell("l_rep",i)+",0),4)"}},
   ]},
   {sheet:"税金", title:"税金及附加明细（万元，编号对应doc「四、税金及其附加」22.1-22.6）", rows:[
    {id:"t_vat", l:"22.1 增值税", g:(R,y)=>R.tax[y].vat,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_resi",i)+"*"+c.param("vatResi")+"/(1+"+c.param("vatResiBase")+")+"+c.cell("i_park",i)+"*"+c.param("vatPark")+"/(1+"+c.param("vatPark")+"),4)"}},
    {id:"t_stp", l:"22.2 印花税", g:(R,y)=>R.tax[y].stamp,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_tot",i)+"*"+c.param("stampRate")+"/(1+"+c.param("vatPark")+"),4)"}},
    {id:"t_cty", l:"22.3 城镇维护建设税", g:(R,y)=>R.tax[y].city, xf:{expr:(c,i)=>"ROUND("+c.cell("t_vat",i)+"*"+c.param("citySur")+",4)"}},
    {id:"t_edu", l:"22.4 教育附加和地方教育附加税", g:(R,y)=>R.tax[y].edu, xf:{expr:(c,i)=>"ROUND("+c.cell("t_vat",i)+"*"+c.param("eduSur")+",4)"}},
    {id:"t_prp", l:"22.5 房产税", g:(R,y)=>R.tax[y].prop},
    {id:"t_lnd", l:"22.6 城镇土地使用税", g:(R,y)=>R.tax[y].land},
    {id:"t_tot", l:"22. 税金及其附加", g:(R,y)=>R.tax[y].total, hl:1,
      xf:{sum:["t_vat","t_stp","t_cty","t_edu","t_prp","t_lnd"]}},
   ]},
   {sheet:"总成本", title:"总成本费用表（万元，编号对应doc「六、损益表」27）", rows:[
    {id:"tc_op", l:"经营成本", g:(R,y)=>R.cost[y].operating, xf:{expr:(c,i)=>c.cell("c_op",i)}},
    {id:"tc_fb", l:"27.2.1 财务费用（建设期）", g:(R,y)=>R.totalCost[y].finBuild},
    {id:"tc_fo", l:"27.2.2 财务费用（运营期）", g:(R,y)=>R.totalCost[y].finOp},
    {id:"tc_tot", l:"27. 总成本费用（不含建设期财务费用、不含税金）", g:(R,y)=>R.totalCost[y].total, hl:1,
      xf:{sum:["tc_op","tc_fo"]}},
   ]},
   {sheet:"利润", title:"利润表（万元，编号对应doc「六、损益表」28-32）", rows:[
    {id:"p_tot", l:"28. 利润总额", g:(R,y)=>R.profit[y].total,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_tot",i)+"-"+c.cell("tc_tot",i)+"-"+c.cell("t_tot",i)+",4)"}},
    {id:"p_mk", l:"29. 弥补亏损", g:(R,y)=>R.profit[y].makeup},
    {id:"p_tx", l:"30. 应纳税所得额", g:(R,y)=>R.profit[y].taxable, xf:{sum:["p_tot","p_mk"]}},
    {id:"p_it", l:"31. 所得税", g:(R,y)=>R.profit[y].incomeTax,
      xf:{expr:(c,i)=>"ROUND(IF("+c.cell("p_tx",i)+">0,"+c.cell("p_tx",i)+"*"+c.param("incomeTax")+",0),4)"}},
    {id:"p_net", l:"32.1 净利润", g:(R,y)=>R.profit[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("p_tot",i)+"-"+c.cell("p_it",i)+",4)"}},
   ]},
   {sheet:"现金流", title:"现金流量表（万元，编号对应doc「九、全投资现金流量表」37-42）", rows:[
    {id:"f_in", l:"37. 现金流入", g:(R,y)=>R.cf[y].inflow, xf:{expr:(c,i)=>c.cell("i_tot",i)}},
    {id:"f_inv", l:"其中：建设投资", g:(R,y)=>R.cf[y].invest},
    {id:"f_out", l:"38. 现金流出", g:(R,y)=>R.cf[y].outflow,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_inv",i)+"+"+c.cell("t_tot",i)+"+"+c.cell("c_mgH",i)+"+"+c.cell("c_mgP",i)+"+"+c.cell("c_vac",i)+"+"+c.cell("c_rep",i)+"+"+c.cell("c_ins",i)+"+"+c.cell("c_rst",i)+"+"+c.cell("c_fund",i)+"+"+c.cell("p_it",i)+",4)"}},
    {id:"f_net", l:"39. 净现金流量", g:(R,y)=>R.cf[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_in",i)+"-"+c.cell("f_out",i)+",4)"}},
    {id:"f_cum", l:"40. 累计净现金流量", g:(R,y)=>R.cf[y].cumNet, t:"last", xf:{cum:"f_net"}},
    {id:"f_npv", l:"41. 净现值", g:(R,y)=>R.cf[y].npv,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_net",i)+"/POWER(1+"+c.param("discountPct")+"/100,"+(i+0.5)+"),4)"}},
    {id:"f_cnpv", l:"42. 累计净现值", g:(R,y)=>R.cf[y].cumNpv, t:"last", hl:1, xf:{cum:"f_npv"}},
   ]},
   {sheet:"资金来源运用", title:"资金来源与运用表（万元，编号对应doc「五、资金来源与运用」23-25）", rows:[
    {id:"fu_op", l:"23.1 经营活动现金来源", g:(R,y)=>R.funds[y].opSource, xf:{expr:(c,i)=>c.cell("i_tot",i)}},
    {id:"fu_fin", l:"23.2 筹资活动现金来源（银行借款）", g:(R,y)=>R.funds[y].financeSource, xf:{expr:(c,i)=>c.cell("l_bor",i)}},
    {id:"fu_rec", l:"余值回收", g:(R,y)=>R.funds[y].recover},
    {id:"fu_src", l:"23. 资金来源", g:(R,y)=>R.funds[y].source, hl:1, xf:{sum:["fu_op","fu_fin","fu_rec"]}},
    {id:"fu_inv", l:"其中：建设投资", g:(R,y)=>R.cf[y].invest, xf:{expr:(c,i)=>c.cell("f_inv",i)}},
    {id:"fu_use", l:"24. 资金运用", g:(R,y)=>R.funds[y].use, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("fu_inv",i)+"+"+c.cell("t_tot",i)+"+"+c.cell("c_mgH",i)+"+"+c.cell("c_mgP",i)+"+"+c.cell("c_ins",i)+"+"+c.cell("c_rep",i)+"+"+c.cell("c_fund",i)+"+"+c.cell("c_vac",i)+"+"+c.cell("c_rst",i)+"+"+c.cell("p_it",i)+"+"+c.cell("l_rep",i)+"+"+c.cell("l_pin",i)+",4)"}},
    {id:"fu_sur", l:"25. 盈余资金", g:(R,y)=>R.funds[y].surplus, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("fu_src",i)+"-"+c.cell("fu_use",i)+",4)"}},
   ]},
   {sheet:"调整损益", title:"调整损益表（万元，全投资口径·不含任何财务费用，编号对应doc「八、调整损益表」34-36）", rows:[
    {id:"pa_tot", l:"35. 利润总额（调整）", g:(R,y)=>R.profitAdj[y].total,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_tot",i)+"-"+c.cell("c_op",i)+"-"+c.cell("t_tot",i)+",4)"}},
    {id:"pa_mk", l:"弥补亏损（调整，同六损益表规则）", g:(R,y)=>R.profitAdj[y].makeup},
    {id:"pa_tx", l:"应纳税所得额（调整）", g:(R,y)=>R.profitAdj[y].taxable, xf:{sum:["pa_tot","pa_mk"]}},
    {id:"pa_it", l:"所得税（调整）", g:(R,y)=>R.profitAdj[y].incomeTax,
      xf:{expr:(c,i)=>"ROUND(IF("+c.cell("pa_tx",i)+">0,"+c.cell("pa_tx",i)+"*"+c.param("incomeTax")+",0),4)"}},
    {id:"pa_net", l:"36.1 净利润（调整）", g:(R,y)=>R.profitAdj[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("pa_tot",i)+"-"+c.cell("pa_it",i)+",4)"}},
   ]},
   {sheet:"资本金现金流量", title:"资本金现金流量表（万元，编号对应doc「十、资本金现金流量表」44-45）", rows:[
    {id:"cc_in", l:"现金流入（同全投资现金流量表）", g:(R,y)=>R.capitalCf[y].inflow, xf:{expr:(c,i)=>c.cell("i_tot",i)}},
    {id:"cc_inv", l:"其中：总投资", g:(R,y)=>R.capitalCf[y].invest, xf:{expr:(c,i)=>c.cell("f_inv",i)}},
    {id:"cc_out", l:"44. 现金流出（资本金）", g:(R,y)=>R.capitalCf[y].outflow,
      xf:{expr:(c,i)=>"ROUND("+c.cell("cc_inv",i)+"+"+c.cell("l_rep",i)+"+"+c.cell("l_pin",i)+"+"+c.cell("t_tot",i)+"+"+c.cell("c_mgH",i)+"+"+c.cell("c_mgP",i)+"+"+c.cell("c_ins",i)+"+"+c.cell("c_rep",i)+"+"+c.cell("c_fund",i)+"+"+c.cell("c_vac",i)+"+"+c.cell("c_rst",i)+"+"+c.cell("p_it",i)+",4)"}},
    {id:"cc_net", l:"净现金流量（同全投资口径）", g:(R,y)=>R.capitalCf[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("cc_in",i)+"-"+c.cell("cc_out",i)+",4)"}},
    {id:"cc_cum", l:"45. 累计净现金流量", g:(R,y)=>R.capitalCf[y].cumNet, t:"last", xf:{cum:"cc_net"}},
    {id:"cc_npv", l:"净现值（同全投资口径）", g:(R,y)=>R.capitalCf[y].npv,
      xf:{expr:(c,i)=>"ROUND("+c.cell("cc_net",i)+"/POWER(1+"+c.param("discountPct")+"/100,"+(i+0.5)+"),4)"}},
    {id:"cc_cnpv", l:"累计净现值（同全投资口径）", g:(R,y)=>R.capitalCf[y].cumNpv, t:"last", hl:1, xf:{cum:"cc_npv"}},
   ]},
  ];
}

function specSale(R0){
  R0 = R0 || scResult;
  const nz = R0.allYears.filter(y=>Math.abs(R0.cf[y].net)>1e-9);
  const firstIdx = nz.length? R0.allYears.indexOf(nz[0]) : 0;
  const rr=(R,y,k)=>R.rental[y]?R.rental[y][k]:null;
  return [
   {sheet:"收入", title:"收入明细表（万元）", open:1, rows:[
    {id:"i_sale", l:"配保房销售收入", g:(R,y)=>R.income[y].sale, hl:1},
    {id:"i_pv", l:"出租净收益现值（计入首年）", g:(R,y)=>R.income[y].rentPv},
    {id:"i_oth", l:"其他收入", g:(R,y)=>R.income[y].other},
    {id:"i_tot", l:"总收入", g:(R,y)=>R.income[y].total, hl:1, xf:{sum:["i_sale","i_pv","i_oth"]}},
    {id:"i_comm", l:"商业出租收入（参考，不计入总收入）", g:(R,y)=>rr(R,y,"income")},
   ]},
   {sheet:"商业出租", title:"商业出租情况表（万元）", rows:[
    {l:"出租率", g:(R,y)=>rr(R,y,"occ"), f:"pct", t:"none"},
    {l:"租金单价（元/㎡/月）", g:(R,y)=>rr(R,y,"rent"), t:"none"},
    {id:"r_inc", l:"商业出租收入", g:(R,y)=>rr(R,y,"income"), hl:1},
    {id:"r_t1", l:"房产税（从租）", g:(R,y)=>rr(R,y,"tax1"),
      xf:{expr:(c,i)=>"ROUND("+c.cell("r_inc",i)+"*"+c.param("prop1Rate")+"/(1+"+c.param("vatSale")+"),4)"}},
    {id:"r_t2", l:"房产税（从价·空置）", g:(R,y)=>rr(R,y,"tax2")},
    {id:"r_mgC", l:"管理费用（商业）", g:(R,y)=>rr(R,y,"mgC"),
      xf:{expr:(c,i)=>"ROUND("+c.cell("r_inc",i)+"*"+c.param("mgCommRate")+",4)"}},
    {id:"r_mgP", l:"管理费用（停车）", g:(R,y)=>rr(R,y,"mgP")},
    {id:"r_fund", l:"维修金", g:(R,y)=>rr(R,y,"fund")},
    {id:"r_rep", l:"维修费", g:(R,y)=>rr(R,y,"rep"),
      xf:{expr:(c,i)=>"ROUND("+c.cell("r_inc",i)+"*"+c.param("repairRate")+",4)"}},
    {id:"r_vac", l:"空置服务费", g:(R,y)=>rr(R,y,"vac")},
    {id:"r_ins", l:"保险费", g:(R,y)=>rr(R,y,"ins")},
    {id:"r_lnd", l:"土地使用税", g:(R,y)=>rr(R,y,"landT")},
    {id:"r_ct", l:"出租营运成本合计", g:(R,y)=>rr(R,y,"costTotal"), hl:1,
      xf:{sum:["r_t1","r_t2","r_mgC","r_mgP","r_fund","r_rep","r_vac","r_ins","r_lnd"]}},
    {id:"r_out", l:"销项税额", g:(R,y)=>rr(R,y,"outputT")},
    {l:"期初可抵进项", g:(R,y)=>rr(R,y,"inputT"), t:"none"},
    {id:"r_vat", l:"增值税", g:(R,y)=>rr(R,y,"vat")},
    {id:"r_sur", l:"增值税附加", g:(R,y)=>rr(R,y,"vatSur"), xf:{expr:(c,i)=>"ROUND("+c.cell("r_vat",i)+"*"+c.param("surcharge")+",4)"}},
    {id:"r_stp", l:"印花税", g:(R,y)=>rr(R,y,"stamp")},
    {id:"r_tt", l:"出租经营税金合计", g:(R,y)=>rr(R,y,"taxTotal"), hl:1, xf:{sum:["r_vat","r_sur","r_stp"]}},
    {id:"r_net", l:"出租净收入", g:(R,y)=>rr(R,y,"netIncome"),
      xf:{expr:(c,i)=>"ROUND("+c.cell("r_inc",i)+"-"+c.cell("r_ct",i)+"-"+c.cell("r_tt",i)+",4)"}},
    {id:"r_pv", l:"出租净收益现值", g:(R,y)=>rr(R,y,"pv"), hl:1},
   ]},
   {sheet:"出售成本", title:"出售成本费用表（万元）", rows:[
    {id:"s_ds", l:"累计开发成本（销售部分）", g:(R,y)=>R.cost[y].devSale},
    {id:"s_dd", l:"累计开发成本（折旧摊销部分）", g:(R,y)=>R.cost[y].devDep},
    {id:"s_dd2", l:"折旧摊销（/"+(calcEffK().depYears||50)+"年）", g:(R,y)=>R.cost[y].devDep2},
    {id:"s_fee", l:"销售费用", g:(R,y)=>R.cost[y].saleFee,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_sale",i)+"*"+c.param("saleFeeRate")+",4)"}},
    {id:"s_ov", l:"销项税额", g:(R,y)=>R.cost[y].outVat},
    {id:"s_iv", l:"进项税额", g:(R,y)=>R.cost[y].inVat},
    {l:"地价抵减额", g:(R,y)=>R.cost[y].landDeduct},
    {id:"s_vat", l:"增值税", g:(R,y)=>R.cost[y].vat},
    {id:"s_sur", l:"增值税附加", g:(R,y)=>R.cost[y].vatSur, xf:{expr:(c,i)=>"ROUND("+c.cell("s_vat",i)+"*"+c.param("surcharge")+",4)"}},
    {id:"s_tax", l:"销售税金合计", g:(R,y)=>R.cost[y].saleTax, hl:1},
    {id:"s_fb", l:"财务费用（建设期）", g:(R,y)=>R.cost[y].finBuild},
    {id:"s_fo", l:"财务费用（运营期）", g:(R,y)=>R.cost[y].finOp},
    {id:"s_tot", l:"总成本费用", g:(R,y)=>R.cost[y].total, hl:1,
      xf:{sum:["s_ds","s_dd","s_fee","s_tax","s_fb","s_fo"]}},
   ]},
   {sheet:"还本付息", title:"还本付息计划表（万元）", rows:[
    {id:"l_beg", l:"期初借款余额", g:(R,y)=>R.loan[y].begin, t:"none",
      xf:{expr:(c,i)=> i===0? "0" : c.cell("l_end",i-1)}},
    {id:"l_bor", l:"本期借款", g:(R,y)=>R.loan[y].borrow},
    {id:"l_int", l:"本期利息", g:(R,y)=>R.loan[y].interest,
      xf:{expr:(c,i)=>"ROUND(("+c.cell("l_beg",i)+"+"+c.cell("l_bor",i)+"/2)*"+c.param("loanRate")+"/100,4)"}},
    {id:"l_rep", l:"本期还本", g:(R,y)=>R.loan[y].repay},
    {id:"l_pay", l:"还本付息合计", g:(R,y)=>R.loan[y].total},
    {id:"l_end", l:"期末借款余额", g:(R,y)=>R.loan[y].end, t:"last"},
   ]},
   {sheet:"利润", title:"利润表（万元）", rows:[
    {id:"p_tot", l:"利润总额", g:(R,y)=>R.profit[y].total,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_tot",i)+"-"+c.cell("s_tot",i)+",4)"}},
    {id:"p_mk", l:"弥补以前年度亏损", g:(R,y)=>R.profit[y].makeup},
    {id:"p_tx", l:"应纳税所得额", g:(R,y)=>R.profit[y].taxable, xf:{sum:["p_tot","p_mk"]}},
    {id:"p_it", l:"所得税", g:(R,y)=>R.profit[y].incomeTax,
      xf:{expr:(c,i)=>"ROUND(IF("+c.cell("p_tx",i)+">0,"+c.cell("p_tx",i)+"*"+c.param("incomeTax")+",0),4)"}},
    {id:"p_net", l:"净利润", g:(R,y)=>R.profit[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("p_tot",i)+"-"+c.cell("p_it",i)+",4)"}},
   ]},
   {sheet:"现金流", title:"现金流量表（万元）", rows:[
    {id:"f_in", l:"现金流入", g:(R,y)=>R.cf[y].inflow,
      xf:{expr:(c,i)=>"ROUND("+c.cell("i_sale",i)+"+"+c.cell("i_oth",i)+"+IFERROR("+c.cell("i_comm",i)+",0)+"+c.cell("f_rec",i)+",4)"}},
    {l:"其中：配保房销售", g:(R,y)=>R.income[y].sale, xf:{expr:(c,i)=>c.cell("i_sale",i)}},
    {id:"f_rec", l:"其中：回收固定资产余值", g:(R,y)=>R.cf[y].recover},
    {id:"f_inv", l:"开发成本投资", g:(R,y)=>R.cf[y].invest},
    {id:"f_fee", l:"销售费用", g:(R,y)=>R.cf[y].saleFee, xf:{expr:(c,i)=>c.cell("s_fee",i)}},
    {id:"f_stx", l:"销售税金", g:(R,y)=>R.cf[y].saleTax, xf:{expr:(c,i)=>c.cell("s_tax",i)}},
    {id:"f_rtx", l:"出租经营税金", g:(R,y)=>R.cf[y].rentTax},
    {id:"f_rct", l:"出租营运成本", g:(R,y)=>R.cf[y].rentCost},
    {id:"f_adj", l:"调整所得税", g:(R,y)=>R.cf[y].adjTax,
      xf:{expr:(c,i)=>"ROUND(MAX(("+c.cell("f_in",i)+"-"+c.cell("f_rec",i)+"-("+c.cell("s_ds",i)+"+"+c.cell("s_dd2",i)+"+"+c.cell("f_fee",i)+"+"+c.cell("f_stx",i)+"+"+c.cell("f_rct",i)+"+"+c.cell("f_rtx",i)+"))*"+c.param("adjTaxRate")+",0),4)"}},
    {id:"f_out", l:"现金流出合计", g:(R,y)=>R.cf[y].outflow,
      xf:{sum:["f_inv","f_fee","f_stx","f_rtx","f_rct","f_adj"]}},
    {id:"f_net", l:"净现金流量", g:(R,y)=>R.cf[y].net, hl:1,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_in",i)+"-"+c.cell("f_out",i)+",4)"}},
    {id:"f_cum", l:"累计净现金流量", g:(R,y)=>R.cf[y].cumNet, t:"last", xf:{cum:"f_net"}},
    {id:"f_npv", l:"净现值", g:(R,y)=>R.cf[y].npv,
      xf:{expr:(c,i)=>"ROUND("+c.cell("f_net",i)+"/POWER(1+"+c.param("discountPct")+"/100,"+Math.max(i-firstIdx,0)+"),4)"}},
    {id:"f_cnpv", l:"累计净现值", g:(R,y)=>R.cf[y].cumNpv, t:"last", hl:1, xf:{cum:"f_npv"}},
   ]},
  ];
}

function calcSpecs(type, R){
  type = type || calcType;
  R = R || scResult;
  const specs = type==="gaibao"? specGaibao() : type==="rent"? specRent() : specSale(R);
  // 统一在此过滤带 show 条件的行（如租金分档明细），保证明细表与Excel导出看到同一批行；
  // 否则两边行号错位，会导致导出的Excel公式引用到错误的单元格
  if(!R) return specs;
  return specs.map(t=>Object.assign({}, t, {
    rows: t.rows.filter(r=>{
      if(typeof r.show!=="function") return true;
      try{ return !!r.show(R); }catch(e){ return false; }
    })
  }));
}
function detailTablesHtml(R, type){
  R = R || scResult;
  return '<div class="doc-eyebrow" style="margin-top:22px;">DETAIL · 测算明细表</div>'
    + calcSpecs(type, R).map((t,i)=>dtable(t.title, R, t.rows, i===0)).join("");
}

/* 投资估算(一/二/三)按doc原文序号(1、1.1、1.1.1...18)展开成可逐级折叠的大纲表：
   顶层(1、2、3...)直接摆开，子项(1.1、1.1.1...)收进<details>，点开才展开，避免一次性铺开上百行。
   不复用dtable的年份列结构——这部分是一次性算出来的成本构成，不按年份分列。 */
function outlineTreeHtml(rows){
  const fmt=r=>{
    if(r.value===null||r.value===undefined) return r.note? ('<span style="color:var(--ink-soft);">'+escapeHtml(r.note)+'</span>') : "—";
    const numStr = Number(r.value).toLocaleString("zh-CN",{maximumFractionDigits:4});
    return numStr + (r.unit? ' '+r.unit : '') + (r.note? '　<span style="color:var(--ink-soft); font-size:12px;">'+escapeHtml(r.note)+'</span>' : '');
  };
  const map={}; const roots=[];
  rows.forEach(r=>{ map[r.no]=Object.assign({},r,{children:[]}); });
  rows.forEach(r=>{
    const parts=r.no.split(".");
    if(parts.length===1){ roots.push(map[r.no]); return; }
    const parentNo=parts.slice(0,-1).join(".");
    if(map[parentNo]) map[parentNo].children.push(map[r.no]); else roots.push(map[r.no]);
  });
  const renderNode=node=>{
    const head='<span class="outline-no">'+node.no+'.</span> <span class="outline-l">'+escapeHtml(node.label)+'</span>'
      +'　<span class="outline-v">'+fmt(node)+'</span>';
    if(!node.children.length) return '<div class="outline-row" style="padding:5px 0 5px '+(node.level*16)+'px; border-bottom:1px dashed var(--line); font-size:13px;">'+head+'</div>';
    return '<details class="outline-node" style="margin-left:'+(node.level*16)+'px;"><summary style="padding:5px 0; font-size:13px; border-bottom:1px dashed var(--line);">'+head+'</summary>'
      + '<div style="margin-left:4px;">' + node.children.map(renderNode).join("") + '</div></details>';
  };
  return roots.map(renderNode).join("");
}
function investEstimateHtml(est, sch){
  if(!est || !window.InvestEstimate) return "";
  const rows = window.InvestEstimate.outline(est, sch);
  return '<details class="dt-block" open><summary>投资估算大纲（一、二、三 · 按doc原文序号，点击展开子项）</summary>'
    + '<div class="dt-scroll">' + outlineTreeHtml(rows) + '</div></details>';
}

/* ---------- Excel 导出（带真公式引用） ---------- */
function scStepResult(){
  if(!scResult) return '<div class="step-desc">尚未测算</div>';
  const s=scResult.summary;
  const fmt=x=>x===null?"—":Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  const tile=(l,v,hl)=>'<div class="metric'+(hl?' hl':'')+'"><div class="mv">'+v+'</div><div class="ml">'+l+'</div></div>';
  const pct=x=>x===null||x===undefined?"—":(x*100).toLocaleString("zh-CN",{maximumFractionDigits:2})+"%";
  let extra = (calcType==="rent"||calcType==="sale")? tile("利息保障倍数", s.icr) : "";
  if(calcType==="sale") extra += tile("配保房销售收入合计（万元）", fmt(s.totalSaleIncome)) + tile("出租净收益现值合计（万元）", fmt(s.rentalPvTotal));
  const paybackStr=pb=> pb? pb.period+"年" : "未回正";
  if(calcType==="rent"){
    extra += tile("动态投资回收期", paybackStr(s.paybackDynamic))
      + tile("投资回报率", pct(s.investReturnRate)) + tile("净投资回报率", pct(s.netInvestReturnRate))
      + tile("经营收入利润率", pct(s.opProfitMargin))
      + tile("调整口径净利润合计（万元）", fmt(s.totalNetProfitAdj))
      + tile("调整口径投资回报率", pct(s.investReturnRateAdj)) + tile("调整口径净投资回报率", pct(s.netInvestReturnRateAdj))
      + tile("资本金现金流IRR", s.capitalIrr===null?"—":s.capitalIrr+" %")
      + tile("资本金静态回收期", paybackStr(s.capitalPayback)) + tile("资本金动态回收期", paybackStr(s.capitalPaybackDynamic));
  }
  extra += customMetricTiles();
  return '<div class="doc-eyebrow">财务测算 · STEP 03 · 结果</div>'
    +'<h1 class="doc-title">测算结果</h1>'
    +'<div class="metric-grid">'
    + tile("全投资IRR", s.irr===null?"—":s.irr+" %", true)
    + tile("累计净现值（万元）", fmt(s.totalNpv))
    + tile("净利润合计（万元）", fmt(s.totalNetProfit))
    + tile("全周期总收入（万元）", fmt(s.totalIncome))
    + tile("总成本费用（万元）", fmt(s.totalCost))
    + tile("现金流回正", s.payback? (s.payback.period!=null? s.payback.period : s.payback.year)+"年" : "未回正")
    + extra
    +'</div>'
    + scoreCardHtml()
    + parameterGovernanceHtml()
    + (calcType==="rent" && scParams && scParams.investEstimate ? investEstimateHtml(scParams.investEstimate, scParams.investSchedule) : "")
    + detailTablesHtml()
    + aiChatHtml()
    +'<div class="actions"><button class="btn ghost" id="scBack1">← 修改参数</button><button class="btn" id="scExcel">导出 Excel</button><button class="btn ghost" id="scWord" style="margin-left:8px;">导出测算说明书（Word）</button></div>';
}

/* ================= AI 智能问答 ================= */
function aiChatHtml(){
  return '<div class="cf-chart" style="margin-top:16px;">'
    +'<div class="cf-head"><span>AI 智能问答（可自主检索测算结果与知识库）</span></div>'
    +'<div id="aiMsgs"></div>'
    +'<div style="display:flex; gap:8px; margin-top:10px;">'
    +'<input id="aiQ" type="text" placeholder="例如：为什么IRR这么低？有没有类似项目的政策依据？" style="flex:1;">'
    +'<button class="btn" id="aiAsk" style="flex-shrink:0;">提问</button></div></div>';
}
function buildScDigest(){
  if(!scResult) return "";
  const s=scResult.summary, R=scResult;
  const fmt=x=>x===null?"—":Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  let lines = "【测算类型】"+(calcType==="rent"?"出租类(公租房/保租房)":(calcType==="sale"?"出售类(配保房/可售型人才房)":"非居改保类"))+"\n";
  lines += "【输入参数】"+JSON.stringify(scParams)+"\n";
  lines += "【汇总】总收入"+fmt(s.totalIncome)+"万｜总成本"+fmt(s.totalCost)+"万"+(s.totalTax!==undefined?"｜税金"+fmt(s.totalTax)+"万":"")+"｜净利润"+fmt(s.totalNetProfit)+"万｜NPV "+fmt(s.totalNpv)+"万｜IRR "+(s.irr===null?"—":s.irr+"%")+(s.icr!==undefined?"｜利息保障倍数"+s.icr:"")+(s.totalSaleIncome!==undefined?"｜配保房销售收入合计"+fmt(s.totalSaleIncome)+"万｜出租净收益现值合计"+fmt(s.rentalPvTotal)+"万":"")+"\n";
  if(CALC_CFG.metrics && CALC_CFG.metrics.length){
    const scope2 = metricScope();
    const ms = CALC_CFG.metrics.filter(m=>!m.scope||m.scope==="all"||m.scope===calcType)
      .map(m=>{ const v=safeEval(String(m.expr||""),scope2); return v===null?null:(m.name+"="+v.toFixed(2)+"（公式:"+m.expr+"）"); }).filter(Boolean);
    if(ms.length) lines += "【自定义指标】"+ms.join("；")+"\n";
  }
  try{ const sc = evalScore(); if(sc.rows.length) lines += "【测算评分】综合"+sc.total+"分("+sc.grade+")："+sc.rows.map(r=>r.name+"="+Number(r.v).toFixed(2)+"("+r.band+")").join("；")+"\n"; }catch(e){}
  lines += "【分年净现金流】"+R.allYears.map(y=>y+":"+fmt(R.cf[y].net)).join("，")+"\n";
  if(calcType==="sale"){
    lines += "【核心公式】配保房销售收入=销售面积×售价×当年销售率/1e4；总收入=配保房销售+出租净收益现值(全周期折现合计,计入运营首年)+其他收入；出租净收入=商业租金收入-出租营运成本(房产税1=租金×12%/1.09、房产税2=(土地+建安+基础设施+工程其他+建安×2%×商业面积占比)×70%×1.2%×(1-出租率)、管理费=租金×8%、停车管理=车位×80×12、维修金=面积×月×0.25、维修=租金×2%、空置服务=面积×(1-出租率)×8×12、保险=面积×1.86、土地使用税按商业面积占比)-出租经营税金(销项=租金×9%/1.09,进项按全周期合计逐年抵扣,增值税附加12%,印花税0.05%)，按3.5%逐年折现；累计开发成本(销售部分)=总投资-建设期财务费用×销售面积占比-销售收入×1.5%,按销售率分摊；折旧摊销部分=(土地+非配售开发成本-建设期财务费用×商业占比)×0.8,一次性计入首年(现金流用/50摊销版)；销售增值税=max(累计销项-累计进项-已缴,0),销项含地价抵减(销售面积×楼面价×销售率)；调整所得税=max((现金流入-回收余值-开发成本销售-摊销/50-销售费税-出租成本税)×25%,0)；现金流出=开发成本投资+销售费用+销售税金+出租税金+出租成本+调整所得税；回收固定资产余值=(土地+开发成本-建设期财务费用×商业占比)×20%计入运营首年流入；NPV从首个非零现金流年按0期折现；利息保障倍数=(净利润+经营期财务费用+所得税+折旧摊销部分-0.8×其他收入)/(建设期+经营期财务费用)。";
  }else if(calcType==="rent"){
    lines += "【核心公式】管理费(住房)=面积×出租率×12×1.92×管理系数/1e4；管理费(车位)=车位收入×0.4；保险=总建面×0.3/1e4；维修=住宅租金收入×2%；维修基金=面积×出租率×月×0.25/1e4；空置物业费=面积×(1-出租率)×月×3.9/1e4；装修重置=装修造价×70%按公租房20年/保租房10年到期后10年分摊；折旧=总投资×80%/50年；增值税=住宅租金×1.5%/1.05+车位×9%/1.09；房产税前3年免征；现金流出不含折旧与财务费用；NPV年中折现。";
  }
  return lines;
}
// 知识库分类名单（与后台 admin.html 的 RAG_CATEGORIES 保持一致；此处仅用于工具参数校验）
const KB_CATEGORY_NAMES = ["可研报告","项目复盘","风险案例","政策文件","制度规范","成本标准","产品标准",
  "技术方案","报批经验","市场研究","行业报告","业务逻辑","会议纪要","模板范文","其他"];

// ===== Agent问答:注册工具 + 调用通用引擎(agent-core.js) =====
// 工具注册在文件加载时执行一次;引擎负责ReAct循环、参数校验、链路日志
(function registerCalcTools(){
  if(!window.AgentCore) return;   // 防御:引擎未加载时不报错
  const AC = window.AgentCore;

  AC.registerTool("get_calc_summary", {
    schema: {
      type: "function",
      function: {
        name: "get_calc_summary",
        description: "获取本次财务测算的完整真实数据摘要(收入/成本/税金/利润/IRR/NPV/分年现金流/评分/核心公式口径)。回答任何涉及具体数字、计算过程、测算结果的问题前，必须先调用此工具获取真实数据，禁止凭记忆编造数字。",
        parameters: { type:"object", properties:{}, required:[] },
      },
    },
    label: ()=>"📊 读取本次测算结果",
    run: async ()=> buildScDigest() || "（本次尚未完成测算，暂无数据）",
  });

  AC.registerTool("search_knowledge_base", {
    schema: {
      type: "function",
      function: {
        name: "search_knowledge_base",
        description: "检索单位内部知识库(历史可研报告、项目复盘、风险案例、政策文件、制度规范、成本标准、产品标准、技术方案、报批经验、市场研究、行业报告等真实资料)。当问题涉及政策依据、行业惯例、成本基准、历史项目参考、需要引用真实文档来源时调用。",
        parameters: {
          type:"object",
          properties:{
            query:{type:"string", description:"检索关键词或问题"},
            category:{type:"string", description:"限定分类(可选)。项目资料类：可研报告/项目复盘/风险案例；政策标准类：政策文件/制度规范/成本标准/产品标准；专业方案类：技术方案/报批经验；市场研究类：市场研究/行业报告；其他：业务逻辑/会议纪要/模板范文/其他。不确定时不传此参数，检索全部分类。"},
          },
          required:["query"],
        },
      },
    },
    validate: (args)=> AC.V.all([
      AC.V.requiredString(args, "query", 200, "query"),
      AC.V.optionalEnum(args, "category", KB_CATEGORY_NAMES, "category"),
    ]),
    label: (args)=>"🔍 检索知识库：" + (args.query || ""),
    run: async (args)=>{
      const r = await fetch("/api/rag",{method:"POST",
        headers:Object.assign({"Content-Type":"application/json"}, authHeaders()),
        body:JSON.stringify({action:"query", query:args.query||"", category:args.category, topK:4})});
      const d = await r.json();
      if(!d.ok || !(d.matches||[]).length) return "（知识库未检索到相关内容）";
      // 分层标注：让AI知道每条资料的可信程度，低匹配的不要当权威依据用
      const tier = (s)=> s>=0.85 ? "高匹配" : s>=0.70 ? "中匹配" : "低匹配·仅供参考";
      return "以下资料按匹配度标注，高匹配可作为依据引用，低匹配仅作背景参考、不要据此下结论：\n\n"
        + d.matches.map(m=>{
            const lifeTag = (m.lifecycle && m.lifecycle !== "valid") ? "｜⚠"+(m.lifecycleNote||"时效异常")+"，不可作为现行依据" : "";
            return "【"+m.title+(m.chapter?" · "+m.chapter:"")+"｜"+tier(Number(m.score)||0)+lifeTag+"】"
              +String(m.text||"").slice(0,300);
          }).join("\n\n");
    },
  });
})();

async function askAI(){
  const inp = document.getElementById("aiQ");
  const q = inp.value.trim();
  if(!q) return;
  const btn = document.getElementById("aiAsk");
  btn.disabled = true; btn.textContent = "思考中…";
  aiChat.push({role:"user", content:q});
  renderAiMsgs();
  inp.value = "";

  const sys = "你是保障性住房项目财务测算专家。你可以调用工具获取真实数据后再回答，禁止在未调用工具、没有真实依据的情况下编造具体数字。回答简明、专业、分点，200-400字，涉及数字必须逐字引用工具返回的真实结果。"
    + "\n\n【工具选择优先级，请严格遵守】"
    + "\n1. 问题涉及IRR、净现值、回本周期、收入成本利润等具体数字或测算结果 → 优先调用 get_calc_summary"
    + "\n2. 问题涉及政策依据、行业规范、历史项目参考等需要真实文档来源的内容 → 优先调用 search_knowledge_base"
    + "\n3. 每一轮只调用最匹配问题的那一个工具，不要在同一轮里同时请求多个工具"
    + "\n4. 已经通过工具拿到足够回答问题的信息后，直接给出最终答案，不要为已经掌握的信息重复查询";
  const msgs = aiChat.slice(-6).filter(m=>!m.hidden).map(m=>({role:m.role, content:m.content}));

  const res = await window.AgentCore.run({
    system: sys,
    messages: msgs,
    tools: ["get_calc_summary", "search_knowledge_base"],
    traceQuery: q,
    onTrace: (lines)=>{
      const t = document.getElementById("aiTrace");
      if(t) t.innerHTML = lines.map(x=>'<div style="font-size:11.5px; color:var(--ink-soft);">'+escapeHtml(x)+'…</div>').join("");
    },
  });

  aiChat.push({role:"assistant", content: res.text || "（未返回内容）", trace: res.trace});
  renderAiMsgs();
  btn.disabled = false; btn.textContent = "提问";
}

function renderAiMsgs(){
  const box = document.getElementById("aiMsgs");
  if(!box) return;
  box.innerHTML = aiChat.map(m=>{
    const traceHtml = (m.trace && m.trace.length) ? '<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed var(--line);">'+m.trace.map(t=>'<div style="font-size:11px; color:var(--ink-soft);">'+escapeHtml(t)+'</div>').join("")+'</div>' : "";
    return '<div style="margin:8px 0; padding:10px 14px; font-size:13px; line-height:1.75; '+(m.role==="user"?'background:#EDF1F5; border-radius:8px;':'background:#FFF; border:1px solid var(--line); border-radius:8px;')+'">'
      +(m.role==="user"?"<b>你：</b>":"<b>AI：</b>")+traceHtml+escapeHtml(m.content).replace(/\n/g,"<br>")+'</div>';
  }).join("") + '<div id="aiTrace" style="margin-top:6px;"></div>';
}
/* 三种测算类型的引擎调用逻辑，calc.js自己的#scRun、report.js的runRptCalcOther/runCalc、
   aireport.js的确认测算，四处都要跑同一套分支——统一成一个函数，改一处四处都生效，
   不然像这次一样，哪次改动漏改了一处，症状就是某个入口"点了没反应"。 */
function runCalcEngine(type, params){
  const p = params;
  if(type === "gaibao"){
    return window.NRCalc.calc(assembleCalcInput(p), CALC_CFG.gaibao);
  }else if(type === "sale"){
    const opStart = p.buildStart + p.buildYears;
    const ramp = {}; if(p.rate1) ramp[opStart]=p.rate1; if(p.rate2) ramp[opStart+1]=p.rate2; if(p.rate3) ramp[opStart+2]=p.rate3;
    const repay = {}; for(let i=0;i<p.repayYears;i++) repay[p.repayStart+i]=p.repayAmount;
    // 开发成本投资：填了总额则在建设期各年平摊，未填则由引擎兜底（平摊项目总投资）
    let devPlan = undefined;
    if(p.devInvestTotal>0){ devPlan={};
      for(let i=0;i<p.buildYears;i++) devPlan[p.buildStart+i]=p.devInvestTotal/p.buildYears; }
    return window.SaleCalc.calc(Object.assign({}, p, {saleRamp:ramp, customRepay:repay, devCostPlan:devPlan}), CALC_CFG.sale);
  }else{
    // investPlan若已由「投资估算自动测算」算出(readRentForm里的p.investPlan)，直接沿用其分年节奏；
    // 否则退回原有行为——建设投资全额计入建设期首年
    const investPlan = (p.investPlan && Object.keys(p.investPlan).length) ? p.investPlan
      : (function(){ const o={}; o[p.buildStart]=p.invest; return o; })();
    return window.RentCalc.calc(Object.assign({}, p, {investPlan}), CALC_CFG.rent);
  }
}

function pgParamDefs(type){
  return (window.SensitivityCore&&SensitivityCore.REGISTRY&&SensitivityCore.REGISTRY[type]) ? SensitivityCore.REGISTRY[type].params : [];
}
function pgImpactRows(type){
  if(!window.ParamGovernance) return [];
  const sens=CALC_CFG.sensitivity&&CALC_CFG.sensitivity[type];
  if(sens&&Array.isArray(sens.table)&&sens.table.length) return ParamGovernance.classifyParameters(sens.table);
  const defs=pgParamDefs(type), rules=ParamGovernance.fallbackRuleTable(type,(CALC_CFG.paramrules&&CALC_CFG.paramrules[type])||[]);
  const priority=new Map(rules.map((r,i)=>[r.key,i+1]));
  return ParamGovernance.classifyParameters(defs.map((d,i)=>({key:d.k,label:d.label,group:d.group,combinedRank:priority.has(d.k)?priority.get(d.k):rules.length+i+1})));
}
function pgFmtNum(v,d){ return Number.isFinite(v)?Number(v).toLocaleString("zh-CN",{maximumFractionDigits:d==null?3:d}):"—"; }
function pgCurveHtml(curve,def){
  if(!curve.length) return '<div style="font-size:12px;color:var(--ink-soft);">当前参数无法生成曲线</div>';
  const vals=curve.map(x=>x.irr).filter(Number.isFinite), min=vals.length?Math.min(...vals):0, max=vals.length?Math.max(...vals):1, span=max-min||1;
  return '<div style="display:grid;grid-template-columns:repeat('+curve.length+',1fr);gap:5px;align-items:end;height:130px;margin-top:12px;">'
    +curve.map(x=>{const h=Number.isFinite(x.irr)?18+82*(x.irr-min)/span:4;return '<div style="text-align:center;min-width:0;"><div style="font-size:10px;color:var(--ink-soft);">'+pgFmtNum(x.irr,2)+'%</div><div style="height:'+h+'px;background:var(--bp);border-radius:4px 4px 1px 1px;margin:3px auto;width:72%;opacity:.82;"></div><div style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="'+x.value+'">'+pgFmtNum(x.value,2)+'</div></div>';}).join("")
    +'</div><div style="font-size:10.5px;color:var(--ink-soft);text-align:center;margin-top:5px;">横轴：'+escapeHtml((def&&def.label)||"")+'　纵轴：白箱引擎IRR（不是模型预测）</div>';
}
function parameterGovernanceHtml(){
  if(!scParams||!scResult||!window.ParamGovernance) return "";
  const defs=pgParamDefs(calcType), rows=pgImpactRows(calcType), defMap=Object.fromEntries(defs.map(d=>[d.k,d]));
  const eligible=rows.filter(x=>["core","important"].includes(x.impactLevel)&&Number.isFinite(scParams[x.key])&&defMap[x.key]);
  if(!pgSelectedKey||!eligible.some(x=>x.key===pgSelectedKey)) pgSelectedKey=(eligible[0]||{}).key||null;
  const selected=rows.find(x=>x.key===pgSelectedKey), def=defMap[pgSelectedKey];
  const overrides=(CALC_CFG.paramrules&&CALC_CFG.paramrules[calcType])||[];
  const issues=ParamGovernance.explainAnomalyImpacts(scParams,ParamGovernance.anomalyChecks(calcType,scParams,defs,overrides),p=>runCalcEngine(calcType,p));
  const issueHtml=issues.length?issues.map(x=>'<div style="padding:7px 9px;border-left:3px solid '+(x.severity==="error"?'var(--seal-red)':'#D99A24')+';background:'+(x.severity==="error"?'#FFF3F1':'#FFF8E8')+';margin-top:6px;font-size:12px;"><b>'+escapeHtml(x.label)+'：</b>'+escapeHtml(x.message)+(x.rule?'　<span style="color:var(--ink-soft);">依据：'+escapeHtml(x.rule)+'</span>':'')+(x.impactAvailable?'<div style="margin-top:4px;color:#38546B;">白箱影响说明：'+escapeHtml(x.explanation)+'</div>':'')+'</div>').join("")
    :'<div style="font-size:12px;color:var(--ok-green);">✓ 未发现类型、范围、档位或参数关系硬异常</div>';
  const layerRows=ParamGovernance.anomalyLayerStatus((CALC_CFG.caseCount&&CALC_CFG.caseCount[calcType])||0,false);
  const layerHtml='<div style="display:grid;grid-template-columns:repeat(3,minmax(145px,1fr));gap:6px;margin:9px 0 12px;">'+layerRows.map(x=>'<div style="padding:7px 8px;border:1px solid var(--line);border-radius:5px;font-size:11px;background:'+(x.status==="active"||x.status==="ready"?'#F1F8F4':'#F7F7F7')+';"><b>'+x.level+'. '+escapeHtml(x.label)+'</b><div style="color:'+(x.status==="active"||x.status==="ready"?'var(--ok-green)':'var(--ink-soft)')+';margin-top:2px;">'+(x.status==="active"?'已启用':x.status==="ready"?'数据条件已满足':'等待真实案例')+(x.reason?'｜'+escapeHtml(x.reason):'')+'</div></div>').join('')+'</div>';
  let slider="";
  if(selected&&def){
    const base=Number(scParams[selected.key]), step=Math.max((def.hi-def.lo)/100,0.0001);
    const curve=ParamGovernance.singleParameterCurve(scParams,selected.key,def,p=>runCalcEngine(calcType,p),7);
    slider='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;"><select id="pgParamSelect">'
      +eligible.map(x=>'<option value="'+x.key+'" '+(x.key===selected.key?'selected':'')+'>'+escapeHtml(x.impactLabel+'｜'+x.label)+'</option>').join("")+'</select>'
      +'<span style="font-size:11px;color:var(--ink-soft);">有效域 '+pgFmtNum(def.lo,3)+' ~ '+pgFmtNum(def.hi,3)+'</span></div>'
      +'<div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;margin-top:10px;"><input id="pgIrrSlider" type="range" min="'+def.lo+'" max="'+def.hi+'" step="'+step+'" value="'+Math.min(def.hi,Math.max(def.lo,base))+'"><div style="min-width:180px;font-size:12px;"><b id="pgSliderValue">'+pgFmtNum(base,3)+'</b> → IRR <b id="pgSliderIrr">'+pgFmtNum(scResult.summary.irr,2)+'%</b>（Δ <span id="pgSliderDelta">0.00 pp</span>）</div></div>'
      +'<button class="btn sm ghost" id="pgApplyScenario" style="margin-top:8px;">将滑块值应用为正式参数并重算</button>'
      +'<div style="font-weight:700;font-size:12.5px;margin-top:16px;">单参数场景曲线</div>'+pgCurveHtml(curve,def);
  }
  const cacheKey=calcType+"|"+JSON.stringify(scParams)+"|"+rows.map(x=>x.key+":"+x.impactLevel).join(",");
  if(!pgJointCache||pgJointCache.key!==cacheKey) pgJointCache={key:cacheKey,value:ParamGovernance.jointLowSensitivityValidation(scParams,rows,defs,p=>runCalcEngine(calcType,p),{samples:48,perturb:0.1,maxIrrDeltaPp:0.5})};
  const j=pgJointCache.value;
  const joint=j.available?'<div style="font-size:12px;line-height:1.8;"><b>'+(j.pass?'✓ 验证通过':'⚠ 验证未通过')+'</b>：'+j.parameterCount+'个低影响参数同时做±'+Math.round(j.perturb*100)+'%扰动，'+j.samples+'组白箱复算；IRR绝对变化 P50='+pgFmtNum(j.p50,3)+' pp，P95='+pgFmtNum(j.p95,3)+' pp，最大='+pgFmtNum(j.max,3)+' pp；验收线 P95≤'+j.threshold+' pp。<details><summary>查看参与参数</summary>'+escapeHtml(j.parameters.join('、'))+'</details></div>'
    :'<div style="font-size:12px;color:var(--ink-soft);">'+escapeHtml(j.reason||"暂不可验证")+'</div>';
  const count=l=>rows.filter(x=>x.impactLevel===l).length;
  return '<div class="cf-chart" style="margin-top:16px;"><div class="cf-head"><span>白箱参数治理与IRR场景验证</span><span class="cf-legend">核心 '+count("core")+'｜重要 '+count("important")+'｜一般 '+count("general")+'｜低影响 '+count("low")+'</span></div>'
    +'<div style="font-size:11.5px;color:var(--ink-soft);margin:8px 0 12px;">这里只改变输入后调用原测算公式重新计算；RF/统计模型不参与正式IRR。影响等级来自后台敏感性结果；尚未实测时按兜底规则优先级临时分级。</div>'
    +'<details open><summary style="font-weight:700;cursor:pointer;">六层异常检测（当前发现 '+issues.length+' 项）</summary>'+layerHtml+issueHtml+'</details>'
    +'<details open style="margin-top:14px;"><summary style="font-weight:700;cursor:pointer;">白箱IRR滑块与单参数曲线</summary>'+slider+'</details>'
    +'<details open style="margin-top:14px;"><summary style="font-weight:700;cursor:pointer;">低敏感参数联合扰动验证</summary>'+joint+'</details></div>';
}
function bindParameterGovernanceEvents(){
  const sel=document.getElementById("pgParamSelect"), slider=document.getElementById("pgIrrSlider"), apply=document.getElementById("pgApplyScenario");
  if(sel) sel.onchange=()=>{ pgSelectedKey=sel.value; renderSheet(); };
  if(slider) slider.oninput=()=>{
    const v=Number(slider.value), p=Object.assign({},scParams,{[pgSelectedKey]:v}), r=runCalcEngine(calcType,p);
    const irr=r&&r.summary?r.summary.irr:null, base=scResult.summary.irr, d=Number.isFinite(irr)&&Number.isFinite(base)?irr-base:null;
    document.getElementById("pgSliderValue").textContent=pgFmtNum(v,3);
    document.getElementById("pgSliderIrr").textContent=pgFmtNum(irr,2)+"%";
    document.getElementById("pgSliderDelta").textContent=d==null?"—":(d>=0?"+":"")+d.toFixed(2)+" pp";
  };
  if(apply) apply.onclick=()=>{
    scParams=Object.assign({},scParams,{[pgSelectedKey]:Number(document.getElementById("pgIrrSlider").value)});
    scResult=runCalcEngine(calcType,scParams); pgJointCache=null; renderSheet();
  };
}

function bindCalcEvents(){
  const s=id=>document.getElementById(id);
  document.querySelectorAll("[data-sct]").forEach(c=>{ c.onclick=()=>{ if(calcType!==c.dataset.sct){ scParams=null; scResult=null; aiChat=[]; } calcType=c.dataset.sct; renderSheet(); }; });
  if(s("scNext1")) s("scNext1").onclick=()=>{ scStep=1; renderTOC(); renderSheet(); };
  if(s("scBack0")) s("scBack0").onclick=()=>{ scStep=0; renderTOC(); renderSheet(); };
  if(s("scBack1")) s("scBack1").onclick=()=>{ scStep=1; renderTOC(); renderSheet(); };
  if(s("scRun")) s("scRun").onclick=()=>{
    if(calcType==="gaibao") scParams = readCalcForm();
    else if(calcType==="sale") scParams = readSaleForm();
    else scParams = readRentForm();
    scResult = runCalcEngine(calcType, scParams);
    pgSelectedKey=null; pgJointCache=null;
    aiChat = [];
    scStep=2; renderTOC(); renderSheet();
  };
  if(s("scExcel")) s("scExcel").onclick = exportCalcExcel;
  if(s("scWord")) s("scWord").onclick = exportCalcWord;
  if(s("aiAsk")) s("aiAsk").onclick = askAI;
  bindParameterGovernanceEvents();
  if(s("aiQ")) s("aiQ").addEventListener("keydown", e=>{ if(e.key==="Enter") askAI(); });
  if(s("homeAiReport")) s("homeAiReport").onclick=()=>{ appMode="aireport"; renderTOC(); renderSheet(); };
  if(s("homeCalc")) s("homeCalc").onclick=()=>{ appMode="calc"; scStep=0; renderTOC(); renderSheet(); };
  if(s("homeReport")) s("homeReport").onclick=()=>{ appMode="report"; renderTOC(); renderSheet(); };
  if(s("homeReview")) s("homeReview").onclick=()=>{ appMode="review"; rvStep=0; renderTOC(); renderSheet(); };
  if(s("homeOffice")) s("homeOffice").onclick=()=>{ appMode="office"; renderTOC(); renderSheet(); };
}

function calcFormHtml(){
  const v = calcParams || {};
  const expert=(CALC_CFG.paramdefaults&&CALC_CFG.paramdefaults.gaibao)||{};
  const g = (k,d)=> v[k]!==undefined? v[k]:(expert[k]!==undefined?expert[k]:d);
  return ''
  +'<div class="grid2">'
  +'<div><label>建设期起始年</label><input id="c_buildStart" type="number" value="'+g("buildStart",2026)+'"></div>'
  +'<div><label>建设期年数</label><input id="c_buildYears" type="number" value="'+g("buildYears",1)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>运营期年数</label><input id="c_operateYears" type="number" value="'+g("operateYears",12)+'"></div>'
  +'<div><label>运营首年实际月数</label><input id="c_firstMonths" type="number" value="'+g("firstMonths",12)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>住宅面积（㎡）</label><input id="c_area" type="number" value="'+g("area",20000)+'"></div>'
  +'<div><label>起始租金（元/㎡/月）</label><input id="c_rent" type="number" step="0.1" value="'+g("rent",75)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>租金递增跨度（年）</label><input id="c_rentSpan" type="number" value="'+g("rentSpan",3)+'"></div>'
  +'<div><label>租金递增率（%）</label><input id="c_rentRate" type="number" step="0.1" value="'+g("rentRate",5)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>首年出租率（爬坡）</label><input id="c_rampOcc" type="number" step="0.01" value="'+g("rampOcc",0.85)+'"></div>'
  +'<div><label>稳定期出租率</label><input id="c_stableOcc" type="number" step="0.01" value="'+g("stableOcc",0.95)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>收楼单价（元/㎡/月）</label><input id="c_collect" type="number" step="0.1" value="'+g("collect",25)+'"></div>'
  +'<div><label>合作模式</label><select id="c_mode" onchange="document.getElementById(\'modeExtra\').style.display=this.value===\'share\'?\'contents\':\'none\';"><option value="lease" '+(g("mode","lease")==="lease"?"selected":"")+'>满租金整租经营</option><option value="share" '+(g("mode","lease")==="share"?"selected":"")+'>减租金合作分成</option></select></div>'
  +'<div id="modeExtra" style="display:'+(g("mode","lease")==="share"?"contents":"none")+';">'
  +'<div><label>收楼租金支付比例（%，减租后实付业主）</label><input id="c_collectPct" type="number" step="any" value="'+g("collectPct",50)+'"></div>'
  +'<div><label>业主分成比例（%，占租金收入）</label><input id="c_sharePct" type="number" step="any" value="'+g("sharePct",30)+'"></div>'
  +'</div>'
  +'<div><label>首次装修单方造价（元/㎡）</label><input id="c_deco" type="number" value="'+g("deco",1500)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>装修间隔（年）</label><input id="c_decoInt" type="number" value="'+g("decoInt",10)+'"></div>'
  +'<div><label>二次装修成本系数</label><input id="c_decoRatio" type="number" step="0.05" value="'+g("decoRatio",0.30)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>总套数</label><input id="c_units" type="number" value="'+g("units",500)+'"></div>'
  +'<div><label>单套月运营成本（元/套/月）</label><input id="c_unitCost" type="number" value="'+g("unitCost",800)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>开办费（万元，首年计入）</label><input id="c_startup" type="number" value="'+g("startup",50)+'"></div>'
  +'<div><label>总借款额（万元）</label><input id="c_loan" type="number" value="'+g("loan",13892)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>计息本金（万元）</label><input id="c_interestBase" type="number" value="'+g("interestBase",10600)+'"></div>'
  +'<div><label>利率折扣系数</label><input id="c_rateDiscount" type="number" step="0.05" value="'+g("rateDiscount",0.80)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>贷款年利率（%）</label><input id="c_loanRate" type="number" step="0.05" value="'+g("loanRate",3.5)+'"></div>'
  +'<div><label>折现率（%）</label><input id="c_discount" type="number" step="0.5" value="'+g("discount",6)+'"></div>'
  +'</div><div class="grid2">'
  +'<div><label>年均还款额（万元/年，运营第2年起）</label><input id="c_repay" type="number" value="'+g("repay",1157.67)+'"></div>'
  +'<div></div>'
  +'</div>';
}

function readCalcForm(){
  const n = id=>parseFloat(document.getElementById(id).value)||0;
  return {
    buildStart:n("c_buildStart"), buildYears:n("c_buildYears"), operateYears:n("c_operateYears"),
    firstMonths:n("c_firstMonths"), area:n("c_area"), rent:n("c_rent"),
    rentSpan:n("c_rentSpan"), rentRate:n("c_rentRate"), rampOcc:n("c_rampOcc"), stableOcc:n("c_stableOcc"),
    collect:n("c_collect"), deco:n("c_deco"), decoInt:n("c_decoInt"), decoRatio:n("c_decoRatio"),
    units:n("c_units"), unitCost:n("c_unitCost"), startup:n("c_startup"),
    loan:n("c_loan"), interestBase:n("c_interestBase"), rateDiscount:n("c_rateDiscount"),
    loanRate:n("c_loanRate"), discount:n("c_discount"), repay:n("c_repay"),
    mode: document.getElementById("c_mode")? document.getElementById("c_mode").value : "lease",
    collectPct:n("c_collectPct")||100, sharePct:n("c_sharePct")||0,
  };
}

function assembleCalcInput(p){
  const buildYearsArr = Array.from({length:p.buildYears},(_,i)=>p.buildStart+i);
  const opStart = p.buildStart + p.buildYears;
  const operateYearsArr = Array.from({length:p.operateYears},(_,i)=>opStart+i);
  const loanPlan = {}; loanPlan[p.buildStart] = p.loan;
  const repayPlan = {};
  for(let i=1;i<p.operateYears;i++){ repayPlan[opStart+i] = p.repay; }
  const ramp = {}; ramp[opStart] = p.rampOcc;
  return {
    buildYears:buildYearsArr, operateYears:operateYearsArr, firstOperateMonths:p.firstMonths,
    residentialArea:p.area, rentStartPrice:p.rent, rentIncreaseSpan:p.rentSpan, rentIncreaseRate:p.rentRate,
    costIncreaseSpan:1, costIncreaseRate:0,
    occupancyRamp:ramp, stableStart:opStart+1, stableEnd:operateYearsArr[operateYearsArr.length-1], occupancyStable:p.stableOcc,
    collectPrice:p.collect, decorationUnitCost:p.deco, decorationInterval:p.decoInt, redecorationRatio:p.decoRatio,
    totalUnits:p.units, unitOperateCost:p.unitCost, startupFee:p.startup,
    loanAmount:p.loan, interestBase:p.interestBase, rateDiscount:p.rateDiscount, loanAnnualRate:p.loanRate,
    loanPlan:loanPlan, repayPlan:repayPlan, discountRatePct:p.discount,
    collectFactor: p.mode==="share"? (p.collectPct||50)/100 : 1,
    shareRatio: p.mode==="share"? (p.sharePct||0)/100 : 0,
  };
}

function computeSensitivity(p){
  const cases = [
    {label:"租金 +10%",       mod:{rent:p.rent*1.1}},
    {label:"租金 −10%",       mod:{rent:p.rent*0.9}},
    {label:"出租率 +5个百分点", mod:{stableOcc:Math.min(1,p.stableOcc+0.05), rampOcc:Math.min(1,p.rampOcc+0.05)}},
    {label:"出租率 −5个百分点", mod:{stableOcc:Math.max(0,p.stableOcc-0.05), rampOcc:Math.max(0,p.rampOcc-0.05)}},
    {label:"运营成本 +10%",    mod:{unitCost:p.unitCost*1.1}},
    {label:"装修造价 +10%",    mod:{deco:p.deco*1.1}},
  ];
  return cases.map(cs=>{
    const r = window.NRCalc.calc(assembleCalcInput(Object.assign({}, p, cs.mod)), CALC_CFG.gaibao);
    return {label:cs.label, irr:r.summary.irr, npv:r.summary.totalNpv};
  });
}


function modeCompareHtml(){
  const mc = calcResult && calcResult.modeCompare;
  if(!mc || !mc.length) return "";
  const fmt = x=> x===null||x===undefined? "—" : Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  const cur = (calcParams&&calcParams.mode)==="share"? 1 : 0;
  let rows = mc.map((m,i)=>'<tr'+(i===cur?' style="background:#EFF2F6; font-weight:700;"':'')+'><td style="text-align:left;">'+escapeHtml(m.label)+(i===cur?'（当前）':'')+'</td>'
    +'<td>'+fmt(m.totalIncome)+'</td><td>'+fmt(m.totalCost)+'</td><td>'+fmt(m.totalNetProfit)+'</td>'
    +'<td>'+fmt(m.totalNpv)+'</td><td>'+(m.irr===null?"—":m.irr+"%")+'</td>'
    +'<td>'+(m.payback? m.payback.year+"年":"未回正")+'</td></tr>').join("");
  return '<div class="cf-chart" style="margin-top:16px;"><div class="cf-head"><span>合作模式比选（同一组参数下两种模式的测算对比）</span></div>'
    +'<table class="rpt"><tr><th style="text-align:left;">模式</th><th>总收入(万)</th><th>总成本(万)</th><th>净利润(万)</th><th>净现值(万)</th><th>IRR</th><th>回正</th></tr>'+rows+'</table>'
    +'<div style="font-size:11px; color:var(--ink-soft); margin-top:6px;">分成模式口径：收楼成本×支付比例；分成支出=租金收入×分成比例计入成本（不计进项抵扣，请财务确认口径）。AI生成"合作模式比选"相关内容时将引用此表。</div></div>';
}

function computeModeCompare(p){
  // 两种合作模式同参数对比:整租 vs 减租分成
  const mk = (label, mode, collectPct, sharePct)=>{
    const r = window.NRCalc.calc(assembleCalcInput(Object.assign({}, p, {mode, collectPct, sharePct})), CALC_CFG.gaibao);
    const s = r.summary;
    return {label, totalIncome:s.totalIncome, totalCost:s.totalCost, totalNetProfit:s.totalNetProfit,
      totalNpv:s.totalNpv, irr:s.irr, payback:s.payback};
  };
  const cp = p.collectPct||50, sp = p.sharePct||30;
  return [
    mk("满租金整租经营","lease",100,0),
    mk("减租金合作分成（收楼付"+cp+"%｜分成"+sp+"%）","share",cp,sp),
  ];
}

function sensTableHtml(){
  if(!calcResult || !calcResult.sens) return "";
  const base = calcResult.summary;
  const fmt = x=> x===null? "—" : Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  let rows = calcResult.sens.map(r=>{
    const dIrr = (r.irr!==null&&base.irr!==null)? (r.irr-base.irr) : null;
    return '<tr><td>'+r.label+'</td><td>'+fmt(r.irr)+(r.irr!==null?' %':'')+'</td>'
      +'<td style="color:'+(dIrr!==null&&dIrr<0?'var(--seal-red)':'var(--ok-green)')+';">'+(dIrr===null?'—':(dIrr>=0?'+':'')+dIrr.toFixed(2)+' pp')+'</td>'
      +'<td>'+fmt(r.npv)+'</td></tr>';
  }).join("");
  return '<div class="cf-chart" style="margin-top:14px;">'
    +'<div class="cf-head"><span>单因素敏感性分析</span><span class="cf-legend">基准 IRR '+fmt(base.irr)+' %　NPV '+fmt(base.totalNpv)+' 万元</span></div>'
    +'<table class="rpt"><tr><th>变动因素</th><th>IRR</th><th>较基准变化</th><th>累计净现值（万元）</th></tr>'+rows+'</table></div>';
}

function calcResultHtml(){
  if(!calcResult) return "";
  const s = calcResult.summary;
  const payback = s.paybackInfo? (s.paybackInfo.year+"年") : "未回正";
  const tile = (label,val,dec,suffix,hl)=>'<div class="metric'+(hl?' hl':'')+'">'
    +'<div class="mv"><span class="cnum" data-val="'+val+'" data-dec="'+dec+'" data-suffix="'+(suffix||"")+'">0</span></div>'
    +'<div class="ml">'+label+'</div></div>';
  return '<div class="metric-grid">'
    + tile("全投资内部收益率 IRR", s.irr===null?0:s.irr, 2, " %", true)
    + tile("累计净现值（万元）", s.totalNpv, 2, "")
    + tile("净利润合计（万元）", s.totalNetProfit, 2, "")
    + tile("全周期总收入（万元）", s.totalIncome, 0, "")
    + tile("总成本费用（万元）", s.totalCost, 0, "")
    +'<div class="metric"><div class="mv" style="font-size:17px; padding-top:3px;">'+payback+'</div><div class="ml">累计现金流回正</div></div>'
    +'</div>'
    + cashflowChartHtml()
    + detailTablesHtml(calcResult, (calcResult&&calcResult.__ctype)||"gaibao")
    + sensTableHtml()
    +'<div class="note-box" style="margin-top:14px;">以上结果由内置公式实时计算（与内部测算器口径一致），将自动写入报告财务章节；数值可复算、可追溯。</div>';
}

function animateCountUps(){
  document.querySelectorAll(".cnum").forEach(el=>{
    if(el.dataset.done) return;
    el.dataset.done = "1";
    const target = parseFloat(el.dataset.val)||0;
    const dec = parseInt(el.dataset.dec||"2");
    const suffix = el.dataset.suffix||"";
    const dur = 950, t0 = performance.now();
    const fmt = v=> v.toLocaleString("zh-CN",{minimumFractionDigits:0, maximumFractionDigits:dec});
    function tick(t){
      const p = Math.min(1,(t-t0)/dur);
      const e = 1-Math.pow(1-p,3);
      el.textContent = fmt(target*e)+suffix;
      if(p<1) requestAnimationFrame(tick); else el.textContent = fmt(target)+suffix;
    }
    requestAnimationFrame(tick);
  });
}

function buildCalcDigest(){
  if(!calcResult) return null;
  const r = calcResult, s = r.summary, p = calcParams;
  const y0 = r.allYears[0], yN = r.allYears[r.allYears.length-1];
  const fmt = x=> Number(x).toLocaleString("zh-CN",{maximumFractionDigits:2});
  let modeBlock = "";
  if((r.__ctype||"gaibao") !== "gaibao"){ /* 非改保无合作模式块 */ }
  else{
  const modeName = (p&&p.mode)==="share"? ("减租金合作分成（收楼支付"+(p.collectPct||50)+"%，业主分成"+(p.sharePct||30)+"%）") : "满租金整租经营";
  modeBlock += "【合作模式】本项目采用："+modeName+"\n";
  if(r.modeCompare && r.modeCompare.length){
    modeBlock += "【合作模式比选表】模式|总收入(万)|总成本(万)|净利润(万)|净现值(万)|IRR|回正\n";
    r.modeCompare.forEach(m=>{ modeBlock += m.label+"|"+fmt(m.totalIncome)+"|"+fmt(m.totalCost)+"|"+fmt(m.totalNetProfit)+"|"+fmt(m.totalNpv)+"|"+(m.irr===null?"—":m.irr+"%")+"|"+(m.payback?m.payback.year+"年":"未回正")+"\n"; });
  }
  }
  // 分年现金流表（节选前若干年+汇总）
  let cfRows = "年份|现金流入(万元)|现金流出(万元)|净现金流量(万元)|累计净现金流量(万元)\n";
  r.allYears.forEach(y=>{
    const c=r.cf[y];
    cfRows += y+"|"+fmt(c.inflow)+"|"+fmt(c.outflow)+"|"+fmt(c.net)+"|"+fmt(c.cumNet)+"\n";
  });
  let incomeRows = "年份|住宅租金收入(万元)|出租率|租金单价(元/㎡/月)\n";
  r.allYears.forEach(y=>{
    if(r.income[y].rent>0){
      incomeRows += y+"|"+fmt(r.income[y].rent)+"|"+((r.resiOccupancy[y]||0)*100).toFixed(0)+"%|"+fmt(r.resiRentPrice[y]||0)+"\n";
    }
  });
  let costRows = "年份|收楼成本(万元)|工程费用(万元)|运营费用(万元)|财务费用(万元)|总成本(万元)\n";
  r.allYears.forEach(y=>{
    const c=r.cost[y];
    if(c.total>0) costRows += y+"|"+fmt(c.collect)+"|"+fmt(c.eng)+"|"+fmt(c.op)+"|"+fmt(c.fin)+"|"+fmt(c.total)+"\n";
  });
  const digest = "【真实财务测算结果（由内置公式计算，可直接引用）】\n"
    +"测算周期："+y0+"—"+yN+"年（建设期"+p.buildYears+"年，运营期"+p.operateYears+"年）\n"
    +"核心参数：住宅面积"+fmt(p.area)+"㎡，起始租金"+p.rent+"元/㎡/月（每"+p.rentSpan+"年递增"+p.rentRate+"%），首年出租率"+(p.rampOcc*100)+"%，稳定期"+(p.stableOcc*100)+"%；收楼单价"+p.collect+"元/㎡/月；首次装修"+p.deco+"元/㎡（共装修"+s.decoTimes+"次，工程费合计"+fmt(s.totalEngCost)+"万元）；总套数"+p.units+"套，单套运营成本"+p.unitCost+"元/套/月；总借款"+fmt(p.loan)+"万元（计息本金"+fmt(p.interestBase)+"万元，利率"+p.loanRate+"%×折扣"+p.rateDiscount+"），折现率"+p.discount+"%。\n"
    +"汇总结果：全周期总收入"+fmt(s.totalIncome)+"万元；总成本费用"+fmt(s.totalCost)+"万元；税金及附加合计"+fmt(s.totalTax)+"万元；净利润合计"+fmt(s.totalNetProfit)+"万元；累计净现值"+fmt(s.totalNpv)+"万元；全投资内部收益率IRR为"+(s.irr===null?"无法计算":s.irr+"%")+"；累计净现金流"+(s.paybackInfo?("于"+s.paybackInfo.year+"年（第"+s.paybackInfo.index+"年）回正"):"全周期内未回正")+"。\n"
    +"\n分年收入明细：\n"+incomeRows
    +"\n分年成本明细：\n"+costRows
    +"\n分年现金流量：\n"+cfRows
    + (r.sens? "\n单因素敏感性分析（较基准IRR "+(s.irr===null?"—":s.irr+"%")+"）：\n"
        + r.sens.map(x=>x.label+"：IRR "+(x.irr===null?"—":x.irr+"%")+"，累计净现值 "+fmt(x.npv)+"万元").join("\n") : "");
  return modeBlock + digest;
}
