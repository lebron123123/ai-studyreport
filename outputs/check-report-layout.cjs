const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ReportSectionLayout&&window.ReportTableTemplates);
 const result=await page.evaluate(async()=>{
   await ReportTableTemplates.load('gaibao-housing');
   const t=ReportTableTemplates.current('gaibao-housing').templates[0];
   const lib={forSection:()=>[t],renderTemplate:ReportTableTemplates.renderTemplate};
   const old='<h3>1.1.1 房源概况</h3><table><tr><th>项目名称</th><th>建筑面积（㎡）</th><th>周边交通条件</th></tr><tr><td>松园小区</td><td>584.76</td><td>距红岭地铁站约0.4公里</td></tr></table>';
   const html=ReportSectionLayout.compose(old+lib.renderTemplate(t),{type:'gaibao-housing',chapter:'项目总论',section:'问题、建议与结论',number:'1.7'},lib);
   document.body.innerHTML='<main style="padding:28px;background:white"><h2>1.7 问题、建议与结论</h2>'+html+'</main>';
   return {tableCount:document.querySelectorAll('table').length,heading:document.querySelector('h3').textContent,hasData:document.body.textContent.includes('584.76')};
 });
 if(result.tableCount!==1||!result.hasData||!result.heading.startsWith('1.7.1'))throw Error(JSON.stringify(result));
 await page.screenshot({path:'outputs/report-layout-browser.png'});
 console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
