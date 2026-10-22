import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {replaceExact, correctTax93FinancialText, buildTax93ParagraphCorrections, repairEscapedTax17GapBoundary} from '../scripts/report-tax-summary-deterministic.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

// Deliberately synthetic prose tests the transformation; it is not historical evidence.
test('exact replacements reject absent, duplicate and empty targets',()=>{
  assert.equal(replaceExact('before target after','target','fixed'),'before fixed after');
  for(const [text,quote] of [['target target','target'],['original','missing'],['original','']])assert.throws(()=>replaceExact(text,quote,'fixed'),/match once/);
});

test('financial corrections alter only exact sentences and preserve surrounding tables, headings and numbers',()=>{
  const combination='若租金下降与装修造价上升同时发生，内部收益率存在跌破8%的可能，该组合情景未在单因素分析中体现，需在决策时予以关注。';
  const cashflow='各年净现金流应另按工程付款、融资本息、税费等现金项目核对';
  const heading='<h3>[系统测试]财务分析</h3>',table='<table><tr><td>样本</td><td>42.50</td></tr></table>';
  const body=heading+'<p>合成测试段落。'+combination+'</p>'+table+'<p>'+cashflow+'。保留其他字句。</p>';
  const rows=buildTax93ParagraphCorrections(body);assert.equal(rows.length,2);
  let after=body;for(const row of rows){assert.ok(!/[<&]/.test(row.quote));assert.equal(row.quoteSha256,sha(row.quote));assert.equal(row.replacementSha256,sha(row.replacementText));after=replaceExact(after,row.quote,row.replacementText);}
  assert.equal(after,correctTax93FinancialText(body));assert.ok(after.includes(heading));assert.ok(after.includes(table));
  assert.match(after,/组合情景尚未测算/);assert.match(after,/归还本金另列还本付息表/);
  assert.deepEqual(after.match(/\d+(?:\.\d+)?/g),body.match(/\d+(?:\.\d+)?/g));
  for(const changed of [body+body,after])assert.throws(()=>buildTax93ParagraphCorrections(changed),/paragraph required/);
  assert.throws(()=>buildTax93ParagraphCorrections(body.replace(rows[0].quote,'<strong>'+rows[0].quote+'</strong>')),/Plain paragraph/);
  for(const quote of [combination,cashflow]){assert.throws(()=>correctTax93FinancialText(body.replace(quote,'')),/match once/);assert.throws(()=>correctTax93FinancialText(body+quote),/match once/);}
});

test('escaped boundary repair changes markup only once and keeps surrounding synthetic content exact',()=>{
  const escaped='<p style="margin:0 0 10px;">&lt;div class="report-gap-boundaries"&gt;&lt;p&gt;&lt;strong&gt;资料核验边界（未定位到具体主题）&lt;/strong&gt;&lt;/p&gt;&lt;p&gt;问题、建议与结论资料待核验，相关判断暂不作确定性结论。&lt;/p&gt;&lt;/div&gt;</p>';
  const body='<h3>[系统测试]原文</h3>'+escaped+'<p>其余文本与数字 123 保留。</p>',fixed=repairEscapedTax17GapBoundary(body);
  assert.equal(fixed.after.replace(fixed.to,fixed.from),body);
  assert.equal(fixed.from.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),fixed.to);
  assert.throws(()=>repairEscapedTax17GapBoundary(body+body),/match once/);
  assert.throws(()=>repairEscapedTax17GapBoundary(fixed.after),/match once/);
});
