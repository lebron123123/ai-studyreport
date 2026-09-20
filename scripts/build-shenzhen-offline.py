"""Build bounded, attributed local OSM geometry; never scrape public tile servers."""
import sys, json, hashlib, math
from pathlib import Path
from collections import defaultdict, Counter
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tmp/baoan-python'))
import osmium
from shapely import wkb
from shapely.geometry import box, mapping

source = ROOT / 'outputs/baoan-source/guangdong-260912.osm.pbf'
expected = source.with_suffix('.pbf.md5').read_text().split()[0]
with source.open('rb') as f:
    assert hashlib.file_digest(f, 'md5').hexdigest() == expected, 'Source checksum mismatch'
dest = ROOT / 'project-map/offline-shenzhen-v1'
if dest.exists():
    raise RuntimeError('Destination exists; preserve previous package')
bounds = [113.72, 22.38, 114.65, 22.88]
extent = box(*bounds)
factory = osmium.geom.WKBFactory()
tiles, overview, counts = defaultdict(list), [], Counter()

def feature(geom, props):
    return dict(type='Feature', properties=props, geometry=mapping(geom))

def add(geom, props, broad=False):
    if not geom.is_valid or not geom.intersects(extent): return
    geom = geom.intersection(extent)
    if geom.is_empty: return
    counts[props['kind']] += 1
    if broad: overview.append(feature(geom.simplify(.00012, preserve_topology=True), props))
    a,b,c,d = geom.bounds
    for x in range(math.floor(a*20), math.floor(c*20)+1):
        for y in range(math.floor(b*20), math.floor(d*20)+1):
            part = geom.intersection(box(x/20,y/20,(x+1)/20,(y+1)/20))
            if not part.is_empty: tiles[f'{x}_{y}'].append(feature(part.simplify(.000008, preserve_topology=True), props))

class Extract(osmium.SimpleHandler):
    def way(self, way):
        road = way.tags.get('highway')
        if not road or len(way.nodes)<2: return
        try:
            g = wkb.loads(factory.create_linestring(way), hex=True)
            add(g, dict(kind='road', name=way.tags.get('name:zh',way.tags.get('name','')), road=road), road in ['motorway','trunk','primary','secondary'])
        except (RuntimeError, ValueError): counts['invalid_road'] += 1
    def area(self, area):
        t = dict(area.tags)
        kind = 'building' if 'building' in t else 'water' if t.get('natural')=='water' or 'water' in t else 'park' if t.get('leisure') in ['park','garden'] else None
        if not kind: return
        try:
            add(wkb.loads(factory.create_multipolygon(area),hex=True), dict(kind=kind,name=t.get('name:zh',t.get('name',''))), kind!='building')
        except (RuntimeError, ValueError): counts['invalid_area'] += 1

print('Extracting local roads, water, parks and building footprints...',flush=True)
Extract().apply_file(str(source),locations=True)
dest.mkdir()
def write(name, value):
    (dest/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
write('overview.json',dict(type='FeatureCollection',features=overview))
for key, features in tiles.items(): write(key+'.json',dict(type='FeatureCollection',features=features))
write('manifest.json',dict(version=1,bounds=bounds,step=.05,tiles=list(tiles),counts=counts,source='Geofabrik Guangdong 2026-09-12 / OpenStreetMap contributors',license='ODbL-1.0',sourceMD5=expected,scope='深圳及周边矩形范围，非深圳行政边界；非权威测绘、非完整地块图'))
print(json.dumps(dict(tiles=len(tiles),counts=counts,bytes=sum(p.stat().st_size for p in dest.iterdir())),ensure_ascii=False),flush=True)
