import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {frozenCompositionContentEqual} from '../scripts/check-report-full-docx.mjs';

const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});});
after(async()=>{await browser?.close();});
async function withPage(run){
  const page=await browser.newPage();
  try{
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    await page.addScriptTag({content:frozenCompositionContentEqual.toString()});
    return await run(page);
  }finally{await page.close();}
}

test('composition gate ignores only top-level whitespace nodes, keeping significant DOM exact',async()=>{
  const result=await withPage(page=>page.evaluate(()=>{
    const first='<p data-kind="fact">正文甲 乙</p>';
    const figure='<figure data-template-id="actual"><figcaption>表格标题</figcaption><div>\n<table><tr><td>工程款</td><td>18</td></tr></table>\n<p class="note">注：金额单位为万元。</p></div></figure>';
    const tail='<p>结尾</p>',original=first+'\n'+figure+'\n'+tail+'\n';
    const negative={
      'one character':original.replace('正文甲','正文丙'),
      'table value':original.replace('>18<','>19<'),
      'deleted note':original.replace('<p class="note">注：金额单位为万元。</p>',''),
      'reordered elements':figure+'\n'+first+'\n'+tail,
      'changed attribute':original.replace('data-kind="fact"','data-kind="changed"'),
      'deleted internal whitespace':original.replace('<div>\n','<div>'),
      'changed internal text whitespace':original.replace('甲 乙','甲乙'),
      'moved note across table':original.replace('<div>\n<table>','<div>\n<p class="note">注：金额单位为万元。</p><table>').replace('</table>\n<p class="note">注：金额单位为万元。</p>','</table>\n'),
      'repeated note':original.replace('</figure>','<p class="note">注：金额单位为万元。</p></figure>'),
      'changed caption':original.replace('表格标题','另一标题'),
    };
    return {
      exact:frozenCompositionContentEqual(original,original),
      movedTopLevelWhitespace:frozenCompositionContentEqual(original,'\n\t '+first+figure+tail+'\n\n'),
      negative:Object.fromEntries(Object.entries(negative).map(([name,changed])=>[name,frozenCompositionContentEqual(original,changed)])),
      textWhitespace:frozenCompositionContentEqual('开头 文本'+first,'开头文本'+first),
      textOrder:frozenCompositionContentEqual('正文'+first,first+'正文'),
      commentDeleted:frozenCompositionContentEqual('<!--保留审核说明-->'+first,first),
      commentChanged:frozenCompositionContentEqual('<!--甲-->'+first,'<!--乙-->'+first),
      commentReordered:frozenCompositionContentEqual('<!--甲-->'+first,first+'<!--甲-->'),
      commentToText:frozenCompositionContentEqual('<!--甲-->'+first,'甲'+first),
    };
  }));
  assert.equal(result.exact,true);assert.equal(result.movedTopLevelWhitespace,true);
  for(const [name,value] of Object.entries(result.negative))assert.equal(value,false,name+' must fail');
  for(const name of ['textWhitespace','textOrder','commentDeleted','commentChanged','commentReordered','commentToText'])assert.equal(result[name],false,name+' must fail');
});

// Explicit opt-in real-project fixture: no private project HTML is copied into
// repository tests. Normal CI runs the synthetic boundary test without a skip.
if(process.env.REPORT_COMPOSITION_FIXTURE){
  test('real frozen 43-section input: seven whitespace-only differences pass, substantive mutations fail',async()=>{
    const fixture=await fs.realpath(process.env.REPORT_COMPOSITION_FIXTURE),allowed=await fs.realpath(path.join(root,'outputs','report-standardization'));
    assert.ok(fixture.startsWith(allowed+path.sep),'Fixture must be a local frozen QA artifact');
    const {records}=JSON.parse(await fs.readFile(fixture,'utf8'));
    assert.equal(records.length,43);
    const templates={};
    for(const type of ['rent','gaibao-housing','gaibao-commercial']){
      const file='data/report-table-templates-'+type+'-v1.json';templates[file]=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
    }
    const result=await withPage(async page=>{
      await page.evaluate(local=>{window.fetch=async url=>{
        const key=String(url).replace(/^\.\//,'');
        if(Object.hasOwn(local,key))return {ok:true,json:async()=>structuredClone(local[key])};
        if(key.startsWith('/api/reporttables?'))return {ok:true,json:async()=>({ok:true,config:null})};
        throw Error('Unexpected test network request: '+key);
      };},templates);
      for(const file of ['report-output-policy.js','report-table-templates.js','report-section-layout.js'])await page.addScriptTag({path:path.join(root,file)});
      await page.evaluate(()=>ReportTableTemplates.load('gaibao-housing'));
      return page.evaluate(records=>{
        const entries=records.map(r=>({key:r.key,html:r.frozenHtml,context:{type:'gaibao-housing',number:r.number,chapter:r.key.split(' / ')[0],section:r.key.split(' / ').slice(1).join(' / ')}}));
        const composed=ReportSectionLayout.composeDocument(entries,ReportTableTemplates);
        const parser=new DOMParser(),body=html=>parser.parseFromString(html,'text/html').body;
        return records.map((r,i)=>{
          const html=r.frozenHtml,actual=composed[i],mutations={};
          if(html!==actual){
            let doc=body(actual);const walker=doc.ownerDocument.createTreeWalker(doc,NodeFilter.SHOW_TEXT);let text;
            while((text=walker.nextNode())&&!text.nodeValue.trim()){}
            if(!text)throw Error('Real section has no substantive text: '+r.number);
            text.nodeValue+='改';mutations.character=frozenCompositionContentEqual(html,doc.innerHTML);
            doc=body(actual);const cell=[...doc.querySelectorAll('td,th')].find(c=>/\d/.test(c.textContent));
            if(!cell)throw Error('Real section has no numeric table cell: '+r.number);
            cell.textContent=cell.textContent.replace(/\d/,digit=>String((Number(digit)+1)%10));mutations.value=frozenCompositionContentEqual(html,doc.innerHTML);
            doc=body(actual);const elements=[...doc.children];
            if(elements.length<2)throw Error('Real section cannot test element order: '+r.number);
            elements[0].before(elements[1]);mutations.order=frozenCompositionContentEqual(html,doc.innerHTML);
            doc=body(actual);doc.firstElementChild.setAttribute('data-qa-changed','true');mutations.attribute=frozenCompositionContentEqual(html,doc.innerHTML);
            // Add a clearly synthetic note to a real figure, then prove its
            // deletion cannot hide behind the real top-level whitespace drift.
            const source=body(html),changed=body(actual);
            source.querySelector('figure').insertAdjacentHTML('beforeend','<p>【待补：独立 QA 备注，不写回项目。】</p>');
            changed.querySelector('figure').insertAdjacentHTML('beforeend','<p>【待补：独立 QA 备注，不写回项目。】</p>');
            mutations.notePreserved=frozenCompositionContentEqual(source.innerHTML,changed.innerHTML);
            changed.querySelector('figure').lastElementChild.remove();mutations.noteDeleted=frozenCompositionContentEqual(source.innerHTML,changed.innerHTML);
          }
          return {number:r.number,byteEqual:html===actual,equivalent:frozenCompositionContentEqual(html,actual),mutations};
        });
      },records);
    });
    assert.deepEqual(result.filter(r=>!r.byteEqual).map(r=>r.number),['1.3','1.5','3.2','3.5','3.6','7.2','9.3']);
    for(const row of result){
      assert.equal(row.equivalent,true,row.number+' content must remain exact');
      if(!row.byteEqual){
        assert.equal(row.mutations.notePreserved,true,row.number+' unchanged note');
        for(const name of ['character','value','order','attribute','noteDeleted'])assert.equal(row.mutations[name],false,row.number+' '+name+' must fail');
      }
    }
  });
}
