/* 项目空间数据分析白箱内核：浏览器/Node共用，不访问网络、不读写数据库。 */
(function(root){
  "use strict";
  const EARTH_KM=6371;
  const SCOPES=[1,3,5];
  const METRICS=[
    ["resident_population","居住人口","population","人","核心"],
    ["working_population","工作人口","employment","人","核心"],
    ["area_km2","分析范围面积","scope","km²","核心"],
    ["age_18_34_share","18—34岁人口占比","population","%","重要"],
    ["age_35_59_share","35—59岁人口占比","population","%","一般"],
    ["children_share","未成年人口占比","population","%","一般"],
    ["female_share","女性人口占比","population","%","一般"],
    ["college_share","大专及以上人口占比","population","%","重要"],
    ["talent_share","产业人才人口占比","population","%","重要"],
    ["median_income","家庭月收入中位数","population","元/月","重要"],
    ["renter_share","租住人口占比","population","%","重要"],
    ["internal_commuters","区内居住且区内就业人数","commute","人","核心"],
    ["inbound_commuters","外部流入就业人数","commute","人","重要"],
    ["outbound_commuters","区内居住外出就业人数","commute","人","重要"],
    ["target_population","目标客群人数","demand","人","核心"],
    ["rent_propensity","租住倾向","demand","%","核心"],
    ["eligibility_rate","资格覆盖率","demand","%","重要"],
    ["affordability_rate","支付能力覆盖率","demand","%","重要"],
    ["effective_supply","现有及可替代有效供给","demand","套","核心"],
    ["planned_supply","在建及规划供给","demand","套","重要"],
  ].map(([key,name,domain,unit,level])=>({key,name,domain,unit,level}));
  const POI_CATEGORIES={
    transport:{name:"交通",radiusKm:3,minimum:3,weight:1},
    employment:{name:"产业就业",radiusKm:5,minimum:3,weight:1.1},
    medical:{name:"医疗",radiusKm:5,minimum:2,weight:1},
    education:{name:"教育",radiusKm:3,minimum:3,weight:1},
    commercial:{name:"商业",radiusKm:3,minimum:2,weight:.9},
    landscape:{name:"景观",radiusKm:3,minimum:1,weight:.6},
    housing:{name:"住房供给",radiusKm:5,minimum:1,weight:1},
    negative:{name:"负面设施",radiusKm:3,minimum:0,weight:-1},
  };
  const CHAPTER_MAP={
    population:["区域概况","人口分析","需求分析","客群定位"],
    employment:["产业基础","就业需求","建设必要性"],
    commute:["职住平衡","通勤需求","区位分析","建设必要性"],
    demand:["需求分析","建设规模","项目定位","研究结论"],
    market:["市场分析","价格依据","风险分析"],
    poi:["周边配套","建设条件","社会效益","风险分析"],
  };
  const LOGIC_RULES=[
    {key:"scope",order:1,name:"项目1/3/5km圈层数据包",domain:"scope",purpose:"统一人口、通勤、需求和配套分析的空间边界。",inputs:["项目经度","项目纬度","数据点经纬度"],formula:"Haversine球面距离；距离≤1/3/5km分别进入对应圈层。",thresholds:"默认圈层为1km、3km、5km。",missingPolicy:"无项目坐标时不做距离归类，不推测位置。",outputs:["各圈层数据包","每条数据距离","圈层命中情况"],chapters:["区域概况","区位分析","周边配套"],config:{scopes:[1,3,5]}},
    {key:"portrait",order:2,name:"人口和目标客群画像",domain:"population",purpose:"识别项目服务人口的规模、结构与支付特征。",inputs:["居住人口","工作人口","面积","年龄/学历/收入/租住等结构指标"],formula:"人口密度=人口÷圈层面积；结构指标按同一统计期直接展示，不跨期拼接。",thresholds:"居住人口、工作人口、面积为基础必需项；画像指标可分项补充。",missingPolicy:"基础项缺失则不形成人口总量结论；画像缺项逐项标注待补。",outputs:["人口密度","工作人口密度","客群画像"],chapters:CHAPTER_MAP.population,config:{required:["resident_population","working_population","area_km2"]}},
    {key:"balance",order:3,name:"可解释的职住平衡结论",domain:"commute",purpose:"判断区域就业与居住功能的相对强弱。",inputs:["居住人口","工作人口","内部通勤人数","流入/流出通勤人数"],formula:"职住比=工作人口÷居住人口；净通勤流入=流入人数-流出人数。",thresholds:"<0.6居住显著强；0.6~0.9居住略强；0.9~1.1相对平衡；1.1~1.6就业略强；>1.6就业显著集中。",missingPolicy:"缺居住人口或工作人口时禁止形成职住结论。",outputs:["职住比","平衡等级","内部通勤率","净通勤流入","解释文字"],chapters:CHAPTER_MAP.commute,config:{cuts:[0.6,0.9,1.1,1.6]}},
    {key:"commute",order:4,name:"通勤来源和去向分析",domain:"commute",purpose:"识别主要居住来源地、就业去向和跨区通勤方向。",inputs:["起点","终点","OD方向","通勤人数","统计期"],formula:"按起点、终点分别汇总人数并降序排序，输出Top10；总流量为全部审核通过记录之和。",thresholds:"只采用审核通过且人数≥0的OD记录。",missingPolicy:"没有OD数据时明确显示不可分析，不用POI或人口数据替代。",outputs:["来源地Top10","去向地Top10","总流量"],chapters:["职住平衡","通勤需求","区位分析"],config:{topN:10}},
    {key:"demand",order:5,name:"住房需求区间与供需缺口",domain:"demand",purpose:"在透明假设下估算保障性住房需求区间。",inputs:["目标客群","租住倾向","资格覆盖率","支付能力覆盖率","有效供给","规划供给"],formula:"潜在需求=目标客群×租住倾向×资格覆盖率×支付能力覆盖率×场景系数；净需求=潜在需求-有效供给-规划供给。",thresholds:"谨慎/基准/乐观场景系数默认0.85/1.00/1.15。",missingPolicy:"五项核心输入任一缺失时禁止形成正式供需结论。",outputs:["三场景潜在需求","总供给","净需求","供需缺口"],chapters:CHAPTER_MAP.demand,config:{scenarioFactors:{cautious:0.85,base:1,optimistic:1.15}}},
    {key:"facilities",order:6,name:"周边设施与负面因素分析",domain:"poi",purpose:"评价交通、教育、医疗、商业、产业、景观和住房供给便利度，并识别负面设施。",inputs:["设施名称","设施类别","经纬度","等级权重"],formula:"命中分=等级权重×max(0,1-距离÷评价半径)；分类得分按最低数量归一化；负面设施反向扣分。",thresholds:"各类别评价半径、最低数量和权重见分类配置。",missingPolicy:"没有POI时不评分；某类无数据标记为待补，不等同于确实不存在。",outputs:["分类得分","最近距离","配套短板","负面设施预警"],chapters:CHAPTER_MAP.poi,config:{categories:POI_CATEGORIES}},
    {key:"provenance",order:7,name:"数字来源与版本溯源",domain:"governance",purpose:"保证每个正式数字可回到原始文件和具体位置。",inputs:["资料ID","版本ID","工作簿","Sheet","单元格","统计期"],formula:"来源链随数据记录和分析快照固化；报告章节引用快照，不直接引用待审核数据。",thresholds:"正式数据至少应有来源标签；关键指标建议达到文件+Sheet+单元格级。",missingPolicy:"来源不完整时降低质量等级并提示补录，不伪造来源。",outputs:["来源链","质量等级","快照版本"],chapters:["全部引用数据的章节"],config:{requiredForOfficial:["sourceLabel"]}},
    {key:"report_binding",order:8,name:"分析结果写入可研章节",domain:"report",purpose:"把正式分析结论接入现有可研生成，而非新建第二套生成器。",inputs:["正式分析快照","章节映射","人工锁定状态"],formula:"按变化领域匹配相关章节；仅将official快照注入生成上下文。",thresholds:"不完整快照不得作为正式结论写入；人工锁定章节不得自动覆盖。",missingPolicy:"无正式快照时只提示待补数据，不生成确定性分析数字。",outputs:["章节分析上下文","引用来源","待同步章节"],chapters:["区域概况","人口分析","职住平衡","需求分析","周边配套"],config:{officialOnly:true}},
    {key:"impact",order:9,name:"数据变化影响预演与选择性更新",domain:"workflow",purpose:"数据变化后只更新真正受影响的章节。",inputs:["前一分析快照","新分析快照","章节映射"],formula:"逐领域比较结果哈希；变化领域映射到章节并标记待同步。",thresholds:"无变化不触发更新；人工锁定章节保持锁定且标记过期。",missingPolicy:"缺少前版时按首次形成结果处理。",outputs:["变化领域","受影响章节","前后哈希"],chapters:["由变化领域动态决定"],config:{}},
    {key:"provider",order:10,name:"数据Provider接入规范",domain:"provider",purpose:"让本地Excel、数据库及未来中指接口使用同一字段契约。",inputs:["项目范围","指标记录","POI","OD流量"],formula:"Provider只负责取数和标准化；审核、分析、快照和报告逻辑保持不变。",thresholds:"外部Provider默认关闭，取得授权和字段验收后启用。",missingPolicy:"无Provider或无数据时返回明确缺项，不回退到AI猜测。",outputs:["标准化数据包","来源元数据","校验错误"],chapters:["不直接写章节"],config:{providers:["manual","excel","local_database","future_external_api"]}},
  ];
  function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function hash(v){const s=JSON.stringify(v||{});let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,"0");}
  function rad(v){return v*Math.PI/180;}
  function haversineKm(a,b){
    const lat1=num(a&&a.latitude),lon1=num(a&&a.longitude),lat2=num(b&&b.latitude),lon2=num(b&&b.longitude);
    if([lat1,lon1,lat2,lon2].some(x=>x===null)||Math.abs(lat1)>90||Math.abs(lat2)>90||Math.abs(lon1)>180||Math.abs(lon2)>180)return null;
    const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1),q=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return EARTH_KM*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
  }
  function assignScopes(project,items,scopes=SCOPES){return (items||[]).map(x=>{const d=haversineKm(project,x);return{...clone(x),distanceKm:d,scopes:d===null?[]:scopes.filter(r=>d<=r)};});}
  function metricMap(observations,scopeKm){const out={};(observations||[]).filter(x=>x.reviewStatus==="approved"&&(!scopeKm||Number(x.scopeKm)===Number(scopeKm))).forEach(x=>{if(Object.prototype.hasOwnProperty.call(out,x.metricKey))return;const v=num(x.value);out[x.metricKey]=v===null?x.value:v;});return out;}
  function population(metrics){
    const resident=num(metrics.resident_population),working=num(metrics.working_population),area=num(metrics.area_km2),missing=[];
    if(resident===null)missing.push("resident_population");if(working===null)missing.push("working_population");if(area===null||area<=0)missing.push("area_km2");
    const portrait={};["age_18_34_share","age_35_59_share","children_share","female_share","college_share","talent_share","median_income","renter_share"].forEach(k=>{if(num(metrics[k])!==null)portrait[k]=num(metrics[k]);});
    return{available:!missing.length,missing,residentPopulation:resident,workingPopulation:working,
      residentDensity:resident!==null&&area>0?resident/area:null,workingDensity:working!==null&&area>0?working/area:null,portrait,portraitAvailable:Object.keys(portrait).length>0};
  }
  function balance(metrics,rule){
    const resident=num(metrics.resident_population),working=num(metrics.working_population),inside=num(metrics.internal_commuters),inbound=num(metrics.inbound_commuters),outbound=num(metrics.outbound_commuters),missing=[];
    if(resident===null||resident<=0)missing.push("resident_population");if(working===null||working<=0)missing.push("working_population");
    const ratio=resident>0&&working!==null?working/resident:null;
    let level=null,conclusion="数据不足，暂不能形成职住平衡结论";
    const cuts=rule&&rule.config&&Array.isArray(rule.config.cuts)&&rule.config.cuts.length===4?rule.config.cuts.map(Number):[.6,.9,1.1,1.6];
    if(ratio!==null){if(ratio<cuts[0]){level="居住显著强于就业";conclusion="区域岗位相对不足，存在通勤外流倾向";}else if(ratio<cuts[1]){level="居住略强";conclusion="居住功能略强于就业功能";}else if(ratio<=cuts[2]){level="总量相对平衡";conclusion="职住总量相对平衡，仍需结合OD流向判断";}else if(ratio<=cuts[3]){level="就业略强";conclusion="就业岗位略强，可能存在住房补充需求";}else{level="就业显著集中";conclusion="就业高度集中，应重点核查通勤流入和租住需求";}}
    return{available:ratio!==null,missing,workLiveRatio:ratio,level,conclusion,internalCommuteRate:inside!==null&&resident>0?inside/resident:null,
      employmentSelfSufficiency:inside!==null&&working>0?inside/working:null,residenceSelfSufficiency:inside!==null&&resident>0?inside/resident:null,
      netCommuteInflow:inbound!==null&&outbound!==null?inbound-outbound:null};
  }
  function commute(od){
    const rows=(od||[]).filter(x=>x.reviewStatus==="approved"&&num(x.population)!==null&&num(x.population)>=0),missing=rows.length?[]:["od_flows"];
    const group=(field)=>{const m={};rows.forEach(x=>{const k=String(x[field]||"未标明");m[k]=(m[k]||0)+Number(x.population);});return Object.entries(m).map(([name,population])=>({name,population})).sort((a,b)=>b.population-a.population).slice(0,10);};
    return{available:!!rows.length,missing,totalFlow:rows.reduce((s,x)=>s+Number(x.population),0),originTop10:group("originName"),destinationTop10:group("destinationName")};
  }
  function facilities(project,pois,rules=POI_CATEGORIES){
    const rows=assignScopes(project,(pois||[]).filter(x=>x.reviewStatus==="approved")),categories={};
    Object.entries(rules).forEach(([key,r])=>{const hit=rows.filter(x=>x.category===key&&x.distanceKm!==null&&x.distanceKm<=r.radiusKm).sort((a,b)=>a.distanceKm-b.distanceKm);
      const raw=hit.reduce((s,x)=>s+(num(x.levelWeight)||1)*Math.max(0,1-x.distanceKm/r.radiusKm),0),score=key==="negative"?Math.max(0,100-Math.min(100,raw*35)):Math.min(100,raw*100/Math.max(1,r.minimum));
      categories[key]={name:r.name,count:hit.length,nearestKm:hit.length?hit[0].distanceKm:null,score,items:hit.slice(0,20),shortage:key!=="negative"&&hit.length<r.minimum};});
    const positives=Object.entries(categories).filter(([k])=>k!=="negative"),negative=categories.negative;
    return{available:rows.length>0,missing:rows.length?[]:["pois"],categories,overallScore:positives.length?positives.reduce((s,[,x])=>s+x.score,0)/positives.length-(negative?Math.max(0,100-negative.score)*.2:0):null,
      shortages:positives.filter(([,x])=>x.shortage).map(([,x])=>x.name),negativeWarnings:negative?negative.items:[]};
  }
  function demand(metrics,rule){
    const target=num(metrics.target_population),rent=num(metrics.rent_propensity),eligible=num(metrics.eligibility_rate),afford=num(metrics.affordability_rate),existing=num(metrics.effective_supply),planned=num(metrics.planned_supply)||0;
    const missing=[];[[target,"target_population"],[rent,"rent_propensity"],[eligible,"eligibility_rate"],[afford,"affordability_rate"],[existing,"effective_supply"]].forEach(([v,k])=>{if(v===null)missing.push(k);});
    if(missing.length)return{available:false,missing,scenarios:[],conclusion:"缺少需求参数，禁止生成正式供需结论"};
    const rates=[rent,eligible,afford].map(x=>x>1?x/100:x),factors=rule&&rule.config&&rule.config.scenarioFactors||{cautious:.85,base:1,optimistic:1.15};
    const scenarios=Object.entries(factors).map(([scenario,f])=>{const pool=target*rates[0]*rates[1]*rates[2]*f,net=pool-existing-planned;return{scenario,potentialDemand:pool,totalSupply:existing+planned,netDemand:net,shortage:Math.max(0,net)};});
    return{available:true,missing,scenarios,conclusion:scenarios[1].netDemand>0?"基准场景存在住房供给缺口":"基准场景下现有及规划供给可覆盖测算需求"};
  }
  function analyze(input){
    input=input||{};const ruleMap=input.rules||{},scopeKm=Number(input.scopeKm)||3,metrics=metricMap(input.observations,scopeKm),poiRules=ruleMap.facilities&&ruleMap.facilities.config&&ruleMap.facilities.config.categories||input.poiRules,result={scopeKm,metrics,population:population(metrics),balance:balance(metrics,ruleMap.balance),commute:commute(input.odFlows),facilities:facilities(input.project||{},input.pois,poiRules),demand:demand(metrics,ruleMap.demand)};
    result.missing=[...new Set(Object.values(result).flatMap(x=>x&&Array.isArray(x.missing)?x.missing:[]))];result.ready=result.missing.length===0;result.hash=hash(result);return result;
  }
  function changedDomains(before,after){const domains=[];["population","balance","commute","facilities","demand"].forEach(k=>{if(hash(before&&before[k])!==hash(after&&after[k]))domains.push(k==="balance"?"commute":k==="facilities"?"poi":k);});return[...new Set(domains)];}
  function impactPreview(before,after){const domains=changedDomains(before,after),chapters=[...new Set(domains.flatMap(d=>CHAPTER_MAP[d]||[]))];return{changedDomains:domains,affectedChapters:chapters,beforeHash:hash(before),afterHash:hash(after)};}
  function providerContract(){return{version:"1.0",methods:["loadProjectScope","loadObservations","loadPois","loadOdFlows"],providers:["manual","excel","local_database","future_external_api"]};}
  const api={SCOPES,METRICS,POI_CATEGORIES,CHAPTER_MAP,LOGIC_RULES,haversineKm,assignScopes,metricMap,population,balance,commute,facilities,demand,analyze,impactPreview,providerContract,hash,clone};
  root.AnalysisCore=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
