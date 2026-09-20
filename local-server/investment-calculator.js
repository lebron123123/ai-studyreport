// Reuse the browser's canonical routing and engines; never execute project-supplied code.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const CORE={
  gaibao:['firstMonths','area','rent','rentSpan','rentRate','rampOcc','stableOcc','collect','deco','decoInt','decoRatio','units','unitCost','startup','loan','interestBase','rateDiscount','loanRate','discount','repay'],
  rent:['firstMonths','area','rent','rentSpan','rentRate','rampOcc','stableOcc','totalInvestment','invest','loanAmount','loanRate','discountPct'],
  sale:['saleArea','saleAvgPrice','rate1','rate2','rate3','loanAmount','loanRate','discountPct']
};
function validateNumbers(value,path='参数'){
  if(typeof value==='number'&&!Number.isFinite(value))fail(path+'包含非有限数字');
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))validateNumbers(item,path+'.'+key);
}
function functionSource(source,name){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
  if(start<0||end<0)throw new Error('可信测算入口不可用：'+name);
  return source.slice(start,end);
}
export function createInvestmentCalculator(){
  const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const routing=read('calc.js'),files=['nrcalc.js','rentcalc.js','saleestimate.js','salecalc.js','investment-schedule.js'];
  const source=files.map(read).concat(functionSource(routing,'runCalcEngine'),functionSource(routing,'assembleCalcInput')).join('\n;\n');
  const engineVersion='whitebox-sha256:'+hash(source+readFileSync(new URL(import.meta.url),'utf8')),compiled=new vm.Script(source,{filename:'investment-canonical-engines.js'});
  return Object.freeze({engineVersion,calculate({snapshot,configuration={}}={}){
    const type=snapshot?.calcType,p=snapshot?.params;
    if(!CORE[type]||!p||typeof p!=='object'||Array.isArray(p))fail('当前快照类型或参数不支持服务端复算，请重新测算并保存');
    if(JSON.stringify([p,configuration]).length>500000)fail('测算参数过大');
    validateNumbers(p);validateNumbers(configuration);
    for(const key of ['buildStart','buildYears','operateYears',...CORE[type]])if(typeof p[key]!=='number'||!Number.isFinite(p[key]))fail('已保存快照缺少有效参数：'+key+'，请重新测算并保存');
    if(!Number.isInteger(p.buildStart)||p.buildStart<1900||p.buildStart>2300||!Number.isInteger(p.buildYears)||p.buildYears<1||p.buildYears>20||!Number.isInteger(p.operateYears)||p.operateYears<1||p.operateYears>100)fail('建设及运营期间超出可复算范围');
    if(p.currency&&p.currency!=='CNY'||p.moneyUnit&&p.moneyUnit!=='万元')fail('当前引擎仅支持人民币万元口径，不支持自动币种或单位换算');
    const cfg={gaibao:{},rent:{},sale:{},...structuredClone(configuration)};
    const sandbox={CALC_CFG:cfg,investmentParams:structuredClone(p),investmentType:type};sandbox.window=sandbox;
    const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false}});
    compiled.runInContext(context,{timeout:2000});
    const raw=new vm.Script('runCalcEngine(investmentType,investmentParams)').runInContext(context,{timeout:2000});
    if(!raw?.summary||!Array.isArray(raw.allYears)||!raw.allYears.length)fail('引擎未返回有效计算结果');
    for(const year of raw.allYears)if(!Number.isFinite(raw.cf?.[year]?.net))fail('现金流存在非有限值，不能生成可信情景');
    validateNumbers(raw.summary,'计算结果');
    const summary=JSON.parse(JSON.stringify(raw.summary)),period=raw.allYears[0]+'-'+raw.allYears.at(-1)+';annual',currency='CNY';
    const metrics={irr:summary.irr,npv:summary.totalNpv,payback:type==='gaibao'?summary.paybackInfo?.index:type==='sale'?summary.paybackDetailed?.period:summary.payback?.period};
    if(type!=='gaibao')Object.assign(metrics,{capitalIrr:summary.capitalIrr,capitalPayback:summary.capitalPayback?.period,totalInvestment:type==='sale'?raw.saleEstimateInput.totalInvestment:p.totalInvestment});
    const metricMeta={},invalidMetrics=[],configHash=hash(configuration);
    for(const key of Object.keys(metrics)){
      if(!Number.isFinite(metrics[key])){delete metrics[key];invalidMetrics.push(key);continue;}
      const cashFlow=key.startsWith('capital')?type+':capital_after_tax':type==='gaibao'?'gaibao:operating_cf_with_engine_costs':type==='sale'?'sale:project_adjusted_income_tax':'rent:project_after_tax';
      metricMeta[key]={unit:key.toLowerCase().includes('irr')?'%':key.toLowerCase().includes('payback')?'年':'万元',currency,period,cashFlow,irrType:key==='capitalIrr'?'capital':key==='irr'?(type==='gaibao'?'operating':'project'):null,discountRate:type==='gaibao'?p.discount:p.discountPct,engineVersion,configHash,method:key==='payback'&&type==='gaibao'?'first_nonnegative_year':'engine_native'};
    }
    const annualValues=[];
    for(const year of raw.allYears){
      const periodStart=year+'-01-01',periodEnd=year+'-12-31',value=type==='gaibao'?raw.income?.[year]?.rent:raw.income?.[year]?.total;
      if(!Number.isFinite(value))fail('年度收入缺少有限值，不能冻结经营预测');
      annualValues.push({metricKey:'revenue',periodStart,periodEnd,unit:'万元',currency,basis:type+':income.'+(type==='gaibao'?'rent':'total'),value});
      if(type!=='gaibao'){
        const investment=raw.cf?.[year]?.invest;if(!Number.isFinite(investment))fail('年度建设投资缺少有限值');
        annualValues.push({metricKey:'constructionInvestment',periodStart,periodEnd,unit:'万元',currency,basis:type+':cf.invest',value:investment});
      }
    }
    return {summary,metrics,metricMeta,invalidMetrics,annualValues,engineVersion,configHash,period,currency};
  }});
}
