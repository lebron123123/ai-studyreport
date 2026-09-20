"""Read-only differential check against the pinned reference; writes evidence only."""
import ast, json, subprocess, hashlib
from pathlib import Path
import pandas as pd

root = Path(__file__).resolve().parent.parent
source = root / 'outputs/anju-calculator-reference-0908/calculator3.py'
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'calc_non_resi_reform')
scope = {'pd': pd}
exec(compile(ast.Module(body=[fn], type_ignores=[]), 'pinned-reference', 'exec'), scope)
base = dict(buildStart=2025,buildYears=1,operateYears=12,firstMonths=12,area=20000,rent=75,rentSpan=3,rentRate=5,rampOcc=.85,stableOcc=.95,collect=25,deco=1500,decoInt=10,decoRatio=.3,units=500,unitCost=800,startup=50,loan=13892,interestBase=10600,rateDiscount=.8,loanRate=3.5,repay=1157.67,discount=6,mode='lease')
cases = [
 ('legacy-full', {}),
 ('partial-132-months', dict(buildStartMonth='2025-04',buildEndMonth='2026-03',operateStartMonth='2026-04',operateEndMonth='2037-03')),
 ('one-month', dict(buildStartMonth='2025-01',buildEndMonth='2025-02',operateStartMonth='2025-03',operateEndMonth='2025-03')),
 ('same-year', dict(buildStartMonth='2025-01',buildEndMonth='2025-04',operateStartMonth='2025-05',operateEndMonth='2025-12')),
 ('annual-plans', dict(costSpan=2,costRate=3.5,occupancyRamp={2026:.5,2027:.65,2028:.8},stableStart=2029,loanPlan={2025:6000,2026:7892},repayPlan={2027:1000,2029:3000,2032:9892})),
 ('no-loan',dict(loan=0,interestBase=0,repay=0)),
 ('no-income',dict(rent=0)),
 ('gap-years',dict(buildStartMonth='2025-03',buildEndMonth='2025-09',operateStartMonth='2027-07',operateEndMonth='2029-02')),
]
names='residentialArea rentStartPrice rentIncreaseSpan rentIncreaseRate occupancyRamp stableStart stableEnd occupancyStable collectPrice decorationUnitCost decorationInterval redecorationRatio totalUnits unitOperateCost startupFee loanAmount interestBase rateDiscount loanAnnualRate loanPlan repayPlan discountRatePct buildYears costIncreaseSpan costIncreaseRate'.split()
mapping = [
 ('income',{'rent':'住宅租金收入','rentAfterTax':'税后住宅收入'}),
 ('cost',dict(collect='收楼成本',collectAT='税后收楼成本',eng='工程费用',engAT='税后工程费用',op='运营费用',opAT='税后运营费用',fin='财务费用',finAT='税后财务费用',total='总成本费用',totalAT='税后总成本费用',finBuild='财务费用(建设期)',finOperate='财务费用(运营期)')),
 ('tax',dict(output='销项税',input='进项税',vat='增值税',surcharge='增值税附加',stamp='印花税',total='税金及其附加总和')),
 ('profit',dict(incomeAT='税后收入',costAT='税后总成本费用',pretax='税前利润',tax='税金及其附加总和',totalProfit='利润总额',makeup='弥补亏损',taxable='应纳税所得额',incomeTax='所得税',netProfit='净利润')),
 ('cf',dict(inflow='现金流入',outflow='现金流出合计',net='净现金流量',cumNet='累计净现金流量',npv='净现值',cumNpv='累计净现值')),
 ('loan',dict(begin='期初借款本金',borrow='本期借款',interest='本期计息',repay='本期还本',payTotal='本期本息偿还合计',end='期末借款累计')),
]
js="global.window=global;require('./nrcalc.js');const p=NRCalc.fromParams(JSON.parse(require('fs').readFileSync(0,'utf8')));console.log(JSON.stringify({input:p,result:NRCalc.calc(p)}));"
evidence=[]
for label, changes in cases:
 params = base | changes
 current=json.loads(subprocess.check_output(['node','-e',js],input=json.dumps(params).encode(),cwd=root))
 p=current['input']; years=p['allYears']; months={y:p['monthDict'].get(str(y),0) for y in years}
 for key in ('occupancyRamp','loanPlan','repayPlan'): p[key]={int(k):v for k,v in p[key].items()}
 frames=scope['calc_non_resi_reform'](years,months,{y:y in p['operateYears'] for y in years},p['operateYears'],*[p[k] for k in names])
 expected={key:{y:{field:float(frames[i].loc[y,col+'(万元)']) for field,col in cols.items()} for y in years} for i,(key,cols) in enumerate(mapping)}
 differences=[]; count=0
 for key,rows in expected.items():
  for y,fields in rows.items():
   for field,value in fields.items():
    delta=abs(value-current['result'][key][str(y)][field]);count+=1
    # Python/Pandas ties-to-even vs JS rounding: annual tolerance 1 yuan;
    # cumulative fields may accumulate at most one such unit per year.
    tolerance=0.00010001*((years.index(y)+1) if field in ('cumNet','cumNpv') else 1)
    if delta>tolerance: differences.append([key,y,field,value,current['result'][key][str(y)][field],delta])
 evidence.append(dict(name=label,params=params,expected=expected,checks=count,differences=differences))
 print(label,'months',sum(months.values()),'checks',count,'differences',differences[:5])
target=root/'tests/fixtures/nrcalc-reference.json';target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(dict(commit='4d1c23bdb2476cc2ab099b775bc1133b594ce699',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),toleranceWan=0.00010001,cases=evidence),ensure_ascii=False,indent=2),encoding='utf8')
if any(e['differences'] for e in evidence): raise SystemExit(1)
