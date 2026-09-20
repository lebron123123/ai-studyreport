"""Extract local OSM roads/landcover, no external tile scraping."""
import sys,json,hashlib,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tmp/baoan-python'))
import osmium
from shapely import wkb
from shapely.geometry import shape,mapping,LineString
source=ROOT/'outputs/baoan-source/guangdong-260912.osm.pbf'
parser=argparse.ArgumentParser();parser.add_argument('--district',choices=['baoan','futian','nanshan','luohu'],default='baoan');args=parser.parse_args()
dest=ROOT/f'outputs/{args.district}-source/basemap.json'
if dest.exists(): raise RuntimeError('Preserve existing basemap extraction')
with source.open('rb') as f: digest=hashlib.file_digest(f,'md5').hexdigest()
if digest!=source.with_suffix('.pbf.md5').read_text().split()[0]:raise RuntimeError('Source checksum mismatch')
boundary=shape(json.loads((ROOT/f'outputs/{args.district}-source/audit/boundary.geojson').read_text()))
factory=osmium.geom.WKBFactory();items=[];errors=0
class Extract(osmium.SimpleHandler):
 def way(self,way):
  global errors
  if 'highway' not in way.tags:return
  try:
   geom=LineString([(n.lon,n.lat) for n in way.nodes])
   if not geom.intersects(boundary):return
   geom=geom.intersection(boundary)
   items.append({'geometry':mapping(geom),'kind':'road','class':way.tags.get('highway'),'name':way.tags.get('name','')})
  except (RuntimeError,ValueError):errors+=1
 def area(self,area):
  global errors
  tags=dict(area.tags)
  kind='water' if tags.get('natural')=='water' or 'water' in tags or tags.get('landuse')=='reservoir' else 'green' if tags.get('landuse') in ('forest','grass','meadow','recreation_ground') or tags.get('leisure') in ('park','garden','golf_course') or tags.get('natural') in ('wood','scrub','grassland') else None
  if not kind:return
  try:
   geom=wkb.loads(factory.create_multipolygon(area),hex=True)
   if geom.is_valid and geom.intersects(boundary):items.append({'geometry':mapping(geom.intersection(boundary)),'kind':kind})
  except (RuntimeError,ValueError):errors+=1
print(f'Extracting {args.district} local roads, parks and water polygons...',flush=True)
Extract().apply_file(str(source),locations=True,filters=[osmium.filter.KeyFilter('highway','landuse','leisure','natural','water')])
dest.write_text(json.dumps({'sourceMd5':digest,'sourceWideErrors':errors,'features':items},ensure_ascii=False),encoding='utf8')
from collections import Counter
print(json.dumps({'features':dict(Counter(i['kind'] for i in items)),'sourceWideErrors':errors}),flush=True)
