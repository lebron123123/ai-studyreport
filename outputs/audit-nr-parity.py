import ast,json,subprocess
from pathlib import Path
import pandas as pd
root=Path.cwd()
tree=ast.parse((root/'outputs/anju-calculator-reference-0908/calculator3.py').read_text(encoding='utf-8-sig'))
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='calc_non_resi_reform')
scope={'pd':pd}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'reviewed-reference-function','exec'),scope)
p=dict(buildYears=[2025],operateYears=list(range(2026,2038)),firstOperateMonths=12,residentialArea=20000,rentStartPrice=75,rentIncreaseSpan=3,rentIncreaseRate=5,occupancyRamp={2026:.85},stableStart=2027,stableEnd=2037,occupancyStable=.95,collectPrice=25,decorationUnitCost=1500,decorationInterval=10,redecorationRatio=.3,totalUnits=500,unitOperateCost=800,startupFee=50,loanAmount=13892,interestBase=10600,rateDiscount=.8,loanAnnualRate=3.5,loanPlan={2025:13892},repayPlan={y:1157.67 for y in range(2027,2038)},discountRatePct=6,costIncreaseSpan=1,costIncreaseRate=0)
names='residentialArea rentStartPrice rentIncreaseSpan rentIncreaseRate occupancyRamp stableStart stableEnd occupancyStable collectPrice decorationUnitCost decorationInterval redecorationRatio totalUnits unitOperateCost startupFee loanAmount interestBase rateDiscount loanAnnualRate loanPlan repayPlan discountRatePct buildYears costIncreaseSpan costIncreaseRate'.split()
js="const fs=require('fs'),vm=require('vm');global.window={};vm.runInThisContext(fs.readFileSync('nrcalc.js','utf8'));console.log(JSON.stringify(window.NRCalc.calc(JSON.parse(fs.readFileSync(0,'utf8')))));"
out=[]
for label,first,last in [('full-years',12,12),('partial-first-and-last',9,3)]:
 p['firstOperateMonths']=first
 years=sorted(set(p['buildYears']+p['operateYears']))
 months={y:12 if y in p['operateYears'] else 0 for y in years};months[2026]=first;months[2037]=last
 result=scope['calc_non_resi_reform'](years,months,{y:y in p['operateYears'] for y in years},p['operateYears'],*[p[k] for k in names])
 current=json.loads(subprocess.check_output(['node','-e',js],input=json.dumps(p).encode(),cwd=root))
 frames=[df.to_dict(orient='index') for df in result[:6]]
 out.append(dict(case=label,referenceMonths=sum(months[y] for y in p['operateYears']),currentMonths=sum(current['monthDict'][str(y)] for y in p['operateYears']),reference=frames,current=current))
(root/'outputs/nr-parity-evidence.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
for item in out:
 print(item['case'],item['referenceMonths'],item['currentMonths'])
 for idx,key in [(0,'income'),(1,'cost'),(4,'cf')]:
  print(key,'reference columns',list(item['reference'][idx][2026]))
 print('current summary',item['current']['summary'])
