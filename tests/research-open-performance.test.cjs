const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('恢复卡片初始展开不触发保存，用户展开收起才保存',()=>{
 const src=fs.readFileSync('aireport.js','utf8');
 const start=src.indexOf("  document.querySelectorAll('.air-persistent-card').forEach");
 const end=src.indexOf("  document.querySelectorAll('.air-location-site-refresh')",start);
 let saves=0;const card={open:true,dataset:{airCard:'info'}};const collapsed={};
 vm.runInNewContext(src.slice(start,end),{document:{querySelectorAll:()=>[card]},aiReportCollapsedCards:collapsed,airSaveLocalState:()=>saves++});
 card.ontoggle();assert.equal(saves,0);
 card.open=false;card.ontoggle();assert.equal(saves,1);assert.equal(collapsed.info,true);
 card.ontoggle();assert.equal(saves,1);
 card.open=true;card.ontoggle();assert.equal(saves,2);assert.equal(collapsed.info,false);
});
test('关闭项目面板不等待报告保存，重复关闭安全且恢复原路由',()=>{
 const src=fs.readFileSync('project-manager.js','utf8');
 const line=src.split(/\r?\n/).find(x=>x.trimStart().startsWith('function close(){'));
 let removed=0,cleanup=0;const paths=[];
 const ctx=vm.createContext({activeCleanup:()=>cleanup++,overlay:{remove:()=>removed++},returnHash:'#aireport',history:{pushState:(_a,_b,p)=>paths.push(p)},authPreserveCurrentDraft:()=>{throw Error('不应阻塞关闭');}});
 vm.runInContext(line,ctx);ctx.close();ctx.close();assert.equal(removed,2);assert.equal(cleanup,2);assert.deepEqual(paths,['#aireport','#aireport']);
});
