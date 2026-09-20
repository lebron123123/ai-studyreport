const test=require('node:test');
const assert=require('node:assert/strict');
const {libraryTables,researchRows}=require('../project-manager.js');
test('formal and research tables retain legacy reports without inventing research identities',()=>{
 const projects=[{id:'p1',name:'旧可研',sections:8,updated_at:2},{id:'p2',name:'纯项目',sections:0}];
 const studies=[{id:'r1',title:'私人方案',visibility:'private',formal_project_id:'p1',created_at:3,status:'active'}];
 const rows=researchRows(projects,studies,'','updated');
 assert.equal(rows.length,2);assert.equal(rows[0].id,'r1');assert.equal(rows[0].projectName,'旧可研');assert.equal(rows[1].kind,'legacy');
 const html=libraryTables(projects,studies,'','updated');assert.equal((html.match(/<table>/g)||[]).length,2);assert.match(html,/data-pm-legacy="p1"/);assert.match(html,/data-pm-research="r1"/);assert.match(html,/data-pm-select="p2"/);
 assert.deepEqual(studies[0],{id:'r1',title:'私人方案',visibility:'private',formal_project_id:'p1',created_at:3,status:'active'});
});
test('search, errors and empty/loading states remain independent and escape metadata',()=>{
 const studies=[{id:'r',title:'<script>x</script>',status:'abandoned'}];
 assert.equal(researchRows([],studies,'absent','name').length,0);
 const html=libraryTables([],studies,'','updated',{projects:'项目失败'},false);assert.match(html,/项目失败/);assert.match(html,/&lt;script&gt;/);assert.match(html,/已废止/);assert.doesNotMatch(html,/<script>/);
 assert.match(libraryTables([],[],'','updated',{},true),/正在读取研究/);
 assert.match(libraryTables([],[],'','updated',{research:'未登录'}),/重试研究列表/);
});
test('formal and legacy research lifecycle filters are independent and actions respect roles',()=>{
 const p={id:'p1',name:'正式甲',sections:2,archived:false,legacyResearchAbandoned:true,permissions:{manage:true,delete:true}};
 const active=libraryTables([p],[],'','updated',{},false,'active');
 assert.match(active,/data-pm-select="p1"/);assert.doesNotMatch(active,/data-pm-legacy="p1"/);assert.match(active,/data-pm-create="project"/);assert.match(active,/data-pm-create="research"/);assert.match(active,/data-pm-purge="p1"/);
 const abandoned=libraryTables([p],[],'','updated',{},false,'archived');assert.doesNotMatch(abandoned,/data-pm-select="p1"/);assert.match(abandoned,/data-pm-legacy="p1"/);assert.match(abandoned,/data-pm-study-action="restore"/);
 const archivedFormal={...p,archived:true,legacyResearchAbandoned:false};assert.match(libraryTables([archivedFormal],[],'','updated',{},false,'active'),/data-pm-legacy="p1"/);
 const viewer=libraryTables([{...p,permissions:{view:true}}],[{id:'r1',title:'只读研究',role:'viewer'}],'','updated');assert.doesNotMatch(viewer,/data-pm-purge|data-pm-archive|data-pm-study-action/);
 const editor=libraryTables([],[{id:'r2',title:'本人研究',role:'owner'}],'','updated');assert.match(editor,/data-pm-study-action="restart"/);assert.match(editor,/data-pm-study-action="abandon"/);
});
