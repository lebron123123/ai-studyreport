"""Read DOCX review evidence without changing its source; retain red runs and comments."""
import sys, zipfile, json, hashlib
from pathlib import Path
from xml.etree import ElementTree as ET

source = Path(sys.argv[1])
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
w = '{' + ns['w'] + '}'
with zipfile.ZipFile(source) as z:
    root = ET.fromstring(z.read('word/document.xml'))
    comments = []
    if 'word/comments.xml' in z.namelist():
        for c in ET.fromstring(z.read('word/comments.xml')):
            comments.append({'id': c.get(w+'id'), 'author': c.get(w+'author'), 'text': ''.join(c.itertext())})
    paragraphs = []
    for i, p in enumerate(root.findall('.//w:p', ns)):
        text = ''.join(t.text or '' for t in p.findall('.//w:t', ns))
        if not text.strip():
            continue
        red = []
        for r in p.findall('.//w:r', ns):
            color = r.find('w:rPr/w:color', ns)
            if color is not None:
                value = color.get(w+'val', '').upper()
                if len(value) == 6 and value not in ('AUTO', '000000'):
                    try:
                        rr, gg, bb = [int(value[k:k+2],16) for k in (0,2,4)]
                        if rr > 130 and rr > gg*1.4 and rr > bb*1.4:
                            red.append(''.join(t.text or '' for t in r.findall('.//w:t', ns)))
                    except ValueError:
                        pass
        paragraphs.append({'index':i,'text':text,'red':red,'comments':[c.get(w+'id') for c in p.findall('.//w:commentRangeStart',ns)],'deleted':''.join(t.text or '' for t in p.findall('.//w:delText',ns))})
    tables = [[[ ''.join(c.itertext()) for c in row.findall('w:tc',ns)] for row in table.findall('w:tr',ns)] for table in root.findall('.//w:tbl',ns)]
    structures = []
    for number, table in enumerate(root.findall('.//w:tbl', ns), 1):
        segment = {'sourceTableNumber': number, 'gridWidths': [int(c.get(w+'w')) for c in table.findall('w:tblGrid/w:gridCol', ns)], 'rows': []}
        for row in table.findall('w:tr', ns):
            cells, col = [], 0
            for cell in row.findall('w:tc', ns):
                span = cell.find('w:tcPr/w:gridSpan', ns)
                span = int(span.get(w+'val')) if span is not None else 1
                merge = cell.find('w:tcPr/w:vMerge', ns)
                cells.append({'text': ''.join(t.text or '' for t in cell.findall('.//w:t', ns)).strip(), 'col': col, 'colSpan': span, 'vMerge': '' if merge is None else merge.get(w+'val', 'continue'), 'fill': '', 'align': 'center', 'role': 'static'})
                col += span
            segment['rows'].append({'cells': cells})
        structures.append(segment)
result={'source':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'comments':comments,'paragraphs':paragraphs,'tables':tables,'structures':structures}
output=Path('outputs/0908-logic-review-extracted.json')
output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'output':str(output),'paragraphs':len(paragraphs),'redParagraphs':sum(bool(p['red']) for p in paragraphs),'comments':len(comments),'tables':len(tables)},ensure_ascii=False))
