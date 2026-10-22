import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSourceInBrowser,inspectOuterHeadingsInBrowser,openOfflinePage} from '../scripts/report-final-fidelity-check.mjs';
import {expectedSections} from '../scripts/report-actual-word-acceptance.mjs';

test('independent actual-body and 12/43 outer-heading checks reject losses',async()=>{
  const {page,browser}=await openOfflinePage();
  try{
    const state={chapters:Array.from({length:12},(_,ci)=>({name:'章节'+ci,sections:Array.from({length:ci<7?4:3},(_,si)=>({t:'小节'+si,editedHtml:'<h3>一、分类</h3><p>完整的分析'+ci+'-'+si+'。</p><p>来源：应去除</p><table><tr><td>项目</td><td>值</td></tr><tr><td>甲</td><td>12</td></tr></table>'}))}))};
    const payload={chapters:state.chapters.map((c,ci)=>({cn:ci+1,num:ci+1,name:c.name,sections:c.sections.map((s,si)=>({title:s.t,num:si+1,blocks:[{type:'h',level:3,text:(ci+1)+'.'+(si+1)+'.1 分类'},{type:'p',text:'完整的分析'+ci+'-'+si+'。'},{type:'table',rows:[['项目','值'],['甲','12']]}]}))}))};
    const compare=async p=>page.evaluate(compareSourceInBrowser,{state,payload:p,expected:expectedSections(p)});
    assert.equal((await compare(payload)).passed,true,'existing numbering and source-note removal allowed');
    const lost=structuredClone(payload);lost.chapters[0].sections[0].blocks.splice(1,1);assert.equal((await compare(lost)).passed,false,'missing analysis rejected');
    const table=structuredClone(payload);table.chapters[0].sections[0].blocks[2].rows[1][1]='13';assert.equal((await compare(table)).passed,false,'changed cell rejected');
    const title=structuredClone(payload);title.chapters[0].sections[0].title='错误标题';assert.equal((await compare(title)).passed,false,'changed section title rejected');
    const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const p=(bookmark,level,text)=>'<w:p><w:pPr><w:pStyle w:val="Heading'+level+'"/></w:pPr><w:bookmarkStart w:id="1" w:name="'+bookmark+'"/><w:r><w:t>'+esc(text)+'</w:t></w:r></w:p>';
    const body=payload.chapters.map((c,ci)=>p('_tc'+ci,1,'第'+c.cn+'章　'+c.name)+c.sections.map((s,si)=>p('_tc'+ci+'_'+si,2,c.num+'.'+s.num+'　'+s.title)).join('')).join('');
    const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>',stylesXml='<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';
    const inspect=xml=>page.evaluate(inspectOuterHeadingsInBrowser,{xml,stylesXml,payload});
    const clean=await inspect(xml);assert.equal(clean.passed,true);assert.equal(clean.chapterCount,12);assert.equal(clean.sectionCount,43);
    assert.equal((await inspect(xml.replace('Heading2','Normal'))).passed,false,'flattened section heading rejected');
    assert.equal((await inspect(xml.replace('小节0','丢失'))).passed,false,'wrong outer title rejected');
    assert.equal((await inspect(xml.replace('w:name="_tc0_0"','w:name="_removed"'))).passed,false,'lost section bookmark rejected');
  }finally{await browser.close();}
});
