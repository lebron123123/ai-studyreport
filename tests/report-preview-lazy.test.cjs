const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../aireport.js'),'utf8');
function fixture(){
 const section={t:'测试小节',content:'原正文',pendingRevision:{content:'候选稿'}};
 const chapter={cn:'一',sections:[section]};let renders=0,observer;
 const element={dataset:{airDeferred:'1',airCn:'一',airSi:'0'},isConnected:true,style:{minHeight:'240px'},innerHTML:''};
 const pane={querySelectorAll:()=>[element],querySelector:()=>({})};
 const context={document:{getElementById:()=>pane,activeElement:null},escapeHtml:x=>x,
  airFindChapterSection:()=>({chapter,section}),airSectionMaterialHtml:()=>'<aside>资料</aside>',
  airRenderCompletedSection:()=>{renders++;element.innerHTML+=section.content+section.pendingRevision.content;},
  IntersectionObserver:class{constructor(cb,options){this.cb=cb;this.options=options;observer=this;}observe(){}disconnect(){this.disconnected=true;}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('var airDocSectionObserver='),source.indexOf('function airApplyDocMaterialStatuses')),context);
 return {context,pane,element,section,renders:()=>renders,observer:()=>observer};
}
test('离屏不生成正文DOM，进入视口读取最新正文及候选且不修改数据',()=>{
 const f=fixture();f.context.airObservePreviewSections(f.pane);assert.equal(f.renders(),0);
 assert.equal(f.observer().options.root,null,'必须以实际视口裁剪，不能把被长正文撑高的容器当作可见范围');
 f.section.content='后来保存的正文';const before=JSON.stringify(f.section);
 f.observer().cb([{isIntersecting:false,target:f.element}]);assert.equal(f.renders(),0);
 f.observer().cb([{isIntersecting:true,target:f.element}]);
 assert.equal(f.renders(),1);assert.match(f.element.innerHTML,/后来保存的正文候选稿/);
 assert.equal(JSON.stringify(f.section),before);assert.equal(f.element.dataset.airDeferred,undefined);
 f.context.airHydratePreviewSection(f.element);assert.equal(f.renders(),1);
 f.observer().cb([{isIntersecting:false,target:f.element}]);
 assert.equal(f.element.dataset.airDeferred,'1');assert.equal(f.element.dataset.airHydrated,undefined);
 assert.doesNotMatch(f.element.innerHTML,/后来保存的正文候选稿/);
 f.observer().cb([{isIntersecting:true,target:f.element}]);assert.equal(f.renders(),2);
});
test('旧页面/已移除元素不被迟到观察回调重新渲染',()=>{
 const f=fixture();f.context.airObservePreviewSections(f.pane);
 f.element.isConnected=false;f.observer().cb([{isIntersecting:true,target:f.element}]);assert.equal(f.renders(),0);
 f.element.isConnected=true;f.context.document.getElementById=()=>({});
 f.observer().cb([{isIntersecting:true,target:f.element}]);assert.equal(f.renders(),0);
});
test('重新建立预览解除旧观察；不支持观察器时正常显示',()=>{
 const f=fixture();f.context.airObservePreviewSections(f.pane);const previous=f.observer();
 f.context.airObservePreviewSections(f.pane);assert.equal(previous.disconnected,true);
 f.context.IntersectionObserver=undefined;f.context.airObservePreviewSections(f.pane);assert.equal(f.renders(),1);
});
