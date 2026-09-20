import json, zipfile, hashlib, re
from pathlib import Path
from lxml import etree
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageDraw

base=Path('outputs')
docx=base/'0908税务局可研_表格修复核验.docx'
pdf=base/'0908税务局可研_排版核验.pdf'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(docx) as z: root=etree.fromstring(z.read('word/document.xml'))
inventory=[]; seen={}; duplicates=[]
for i,t in enumerate(root.findall('.//w:tbl',ns),1):
    rows=[[''.join(c.itertext()) if False else ''.join(c.xpath('.//w:t/text()',namespaces=ns)) for c in r.findall('w:tc',ns)] for r in t.findall('w:tr',ns)]
    signature=json.dumps(rows,ensure_ascii=False)
    # Empty models with different captions/business scopes are not duplicate data.
    prev=t.getprevious(); caption=''.join(prev.xpath('.//w:t/text()',namespaces=ns)) if prev is not None else ''
    key=hashlib.sha256((caption+signature).encode()).hexdigest()
    if key in seen: duplicates.append([seen[key],i])
    seen[key]=i
    inventory.append({'table':i,'caption':caption,'headers':rows[0] if rows else [],'rows':len(rows),'captionInCell':bool(rows and any(re.match(r'^表\s*\d',s) for s in rows[0]))})
reader=PdfReader(pdf); renderer=pdfium.PdfDocument(str(pdf)); out=base/'report-page-qa';out.mkdir(exist_ok=True)
table_pages=[]; blank=[]
for i,p in enumerate(reader.pages):
    txt=p.extract_text() or ''
    if len(re.sub(r'\s','',txt))<40:blank.append(i+1)
    if any(x['caption'] and re.sub(r'\s','',x['caption']) in re.sub(r'\s','',txt) for x in inventory):table_pages.append(i+1)
    image=renderer[i].render(scale=1.5).to_pil().convert('RGB');image.save(out/f'page-{i+1:03}.png')
for start in range(0,len(reader.pages),12):
    canvas=Image.new('RGB',(1600,1740),'#cbd5e1'); draw=ImageDraw.Draw(canvas)
    for j in range(start,min(start+12,len(reader.pages))):
        im=Image.open(out/f'page-{j+1:03}.png');im.thumbnail((390,545));x=((j-start)%4)*400;y=((j-start)//4)*580
        canvas.paste(im,(x,y+25));draw.text((x+5,y+5),str(j+1),fill='black')
    canvas.save(out/f'overview-{start+1:03}.png')
result={'pages':len(reader.pages),'xmlTables':len(inventory),'duplicateCaptionAndData':duplicates,'captionInsideTable':[x['table'] for x in inventory if x['captionInCell']],'nearEmptyPages':blank,'tablePages':table_pages,'tables':inventory}
(base/'report-artifact-qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='tables'},ensure_ascii=False))
