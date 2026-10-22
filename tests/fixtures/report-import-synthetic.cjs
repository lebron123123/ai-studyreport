'use strict';
// Entirely fictional documents built for public CI. No user files are copied.
const JSZip = require('../../local-server/node_modules/jszip');
const fs = require('node:fs');
const path = require('node:path');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = text => '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t>' + esc(text) + '</w:t></w:r>';
const para = text => '<w:p>' + run(text) + '</w:p>';

async function documentBytes(title, tableCount, imageCount) {
  const zip = new JSZip();
  const add = (name, data) => zip.file(name, data, {date: new Date('2026-01-01T00:00:00Z')});
  const overrides = [['document', 'document.main'], ['styles', 'styles'], ['comments', 'comments'], ['footnotes', 'footnotes'], ['header1', 'header'], ['footer1', 'footer']];
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' + overrides.map(([file, type]) => '<Override PartName="/word/' + file + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + type + '+xml"/>').join('') + '</Types>');
  add('_rels/.rels', '<Relationships xmlns="' + P + '"><Relationship Id="document" Type="' + R + '/officeDocument" Target="word/document.xml"/></Relationships>');
  const relations = ['styles', 'comments', 'footnotes'].map(type => '<Relationship Id="' + type + '" Type="' + R + '/' + type + '" Target="' + type + '.xml"/>');
  relations.push('<Relationship Id="header" Type="' + R + '/header" Target="header1.xml"/>', '<Relationship Id="footer" Type="' + R + '/footer" Target="footer1.xml"/>');
  let body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + run('第一章 ' + title) + '</w:p>' + para('1.1 项目概况') + para('本项目为公开测试虚构样本。拟设置十八套房源，需核实运营服务安排。');
  body += '<w:p><w:commentRangeStart w:id="0"/>' + run('带批注和脚注的原文，应完整保留。') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/><w:footnoteReference w:id="1"/></w:r></w:p>';
  for (let i = 0; i < tableCount; i++) body += '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + para('虚构表格 ' + (i + 1)) + '</w:tc></w:tr><w:tr><w:tc>' + para('测试指标') + '</w:tc><w:tc>' + para(String(100 + i)) + '</w:tc></w:tr></w:tbl>';
  for (let i = 0; i < imageCount; i++) {
    const id = 'image' + i;
    relations.push('<Relationship Id="' + id + '" Type="' + R + '/image" Target="media/' + id + '.png"/>');
    add('word/media/' + id + '.png', png);
    body += '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="' + (i + 1) + '" name="虚构图片' + i + '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + (i + 1) + '" name="fixture.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  body += '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
  add('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '</w:body></w:document>');
  add('word/_rels/document.xml.rels', '<Relationships xmlns="' + P + '">' + relations.join('') + '</Relationships>');
  add('word/styles.xml', '<w:styles xmlns:w="' + W + '"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  add('word/comments.xml', '<w:comments xmlns:w="' + W + '"><w:comment w:id="0" w:author="系统测试" w:date="2026-01-01T00:00:00Z">' + para('虚构批注：请人工核实。') + '</w:comment></w:comments>');
  add('word/footnotes.xml', '<w:footnotes xmlns:w="' + W + '"><w:footnote w:id="1">' + para('虚构脚注：仅用于自动化测试。') + '</w:footnote></w:footnotes>');
  add('word/header1.xml', '<w:hdr xmlns:w="' + W + '">' + para('[系统测试]公开合成样本页眉') + '</w:hdr>');
  add('word/footer1.xml', '<w:ftr xmlns:w="' + W + '">' + para('[系统测试]公开合成样本页脚') + '</w:ftr>');
  return zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
}

async function loadImportDocuments() {
  const privateDirectory = process.env.REPORT_IMPORT_ORIGINALS_DIR;
  if (privateDirectory) {
    const names = ['市税务局第一批合作房源改造为保障性租赁住房项目可行性研究报告.docx', '税局市场+定位部分内容——（叶德在）.docx'];
    return {kind: 'private original acceptance', blockId: 'source-b102', files: names.map(name => ({name, bytes: fs.readFileSync(path.resolve(privateDirectory, name))}))};
  }
  return {kind: 'public synthetic DOCX workflow', blockId: 'source-b2', files: [
    {name: '[系统测试]虚构项目可研原稿.docx', bytes: await documentBytes('虚构项目可研原稿', 14, 0)},
    {name: '[系统测试]虚构市场定位补充.docx', bytes: await documentBytes('虚构市场定位补充', 5, 5)}
  ]};
}
module.exports = {loadImportDocuments};
