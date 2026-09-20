from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import json
import pypdfium2 as pdfium
from pypdf import PdfReader
base=Path('outputs');new=base/'0908税务局可研_黑色文字核验.docx';old=base/'0908税务局可研_表格修复核验.docx'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
def content(path):
 with ZipFile(path) as z:
  root=etree.fromstring(z.read('word/document.xml'))
  return root.xpath('//w:t/text()',namespaces=ns),root.xpath('count(//w:tbl)',namespaces=ns)
assert content(new)==content(old),'Text or tables changed unexpectedly'
colors=set()
with ZipFile(new) as z:
 for name in z.namelist():
  if name.startswith('word/') and name.endswith('.xml'):
   root=etree.fromstring(z.read(name))
   colors.update(root.xpath('//w:color/@w:val',namespaces=ns))
assert colors=={'000000'},colors
pdf=base/'0908税务局可研_黑色文字核验.pdf';reader=PdfReader(pdf)
prior=PdfReader(base/'0908税务局可研_排版核验.pdf')
assert len(reader.pages)==len(prior.pages)
changed=[i+1 for i,(a,b) in enumerate(zip(reader.pages,prior.pages)) if a.extract_text()!=b.extract_text()]
render=pdfium.PdfDocument(str(pdf));out=base/'black-report-qa';out.mkdir(exist_ok=True)
from PIL import Image,ImageDraw
for start in range(0,len(reader.pages),12):
 canvas=Image.new('RGB',(1200,4*445),'#dddddd');draw=ImageDraw.Draw(canvas)
 for i in range(start,min(start+12,len(reader.pages))):
  im=render[i].render(scale=1.2).to_pil().convert('RGB');im.save(out/f'page-{i+1:03}.png');im.thumbnail((390,415))
  x=(i-start)%3*400;y=(i-start)//3*445;canvas.paste(im,(x,y+22));draw.text((x+8,y+4),str(i+1),fill='black')
 canvas.save(out/f'overview-{start+1:03}.png')
print(json.dumps(dict(pages=len(reader.pages),tables=content(new)[1],colors=sorted(colors),textUnchanged=True,perPageTextChanged=changed)))
