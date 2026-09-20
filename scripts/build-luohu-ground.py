"""Extend flat reference terrain using the audited Luohu boundary, not tile boxes.
The result is a visual datum, not surveyed terrain. Preserve mapped water holes.
"""
import sys, json, math, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tmp/city-terrain-python'))
from shapely import constrained_delaunay_triangles, make_valid, union_all
from shapely.geometry import shape

dest = ROOT / 'project-map/city-relief-v1/luohu-ground.json'
if dest.exists():
    raise RuntimeError('Preserve existing generated asset; choose another version')
boundary_path = ROOT / 'outputs/luohu-source/audit/boundary.geojson'
water_path = ROOT / 'outputs/luohu-source/basemap.json'
boundary = make_valid(shape(json.loads(boundary_path.read_text('utf8'))))
water = [make_valid(shape(f['geometry'])) for f in json.loads(water_path.read_text('utf8'))['features']
         if f['kind'] == 'water' and f['geometry']['type'] in ('Polygon', 'MultiPolygon')]
land = boundary.difference(union_all(water))
triangles = constrained_delaunay_triangles(land)
area = sum(t.area for t in triangles.geoms)
if abs(area-land.area) > max(1e-12, land.area*1e-8):
    raise RuntimeError('Triangulation does not preserve land area')
catalog = json.loads((ROOT/'project-map/models/catalog.json').read_text('utf8'))
lon0,lat0 = catalog['origin']; scale = catalog['scale']
kx = 111320*math.cos(math.radians(lat0))*scale; kz = 111320*scale
positions=[]; indices=[]
for tri in triangles.geoms:
    if not land.covers(tri): raise RuntimeError('Triangle crosses boundary or mapped water')
    ring=list(tri.exterior.coords)[:3]
    start=len(positions)//3
    for lon,lat in ring: positions.extend([round((lon-lon0)*kx,4),-.05,round((lat-lat0)*kz,4)])
    indices.extend([start,start+1,start+2])
result={'version':1,'district':'luohu','datum':'flat visual extension; not surveyed terrain',
        'origin':catalog['origin'],'scale':scale,'positions':positions,'indices':indices,
        'triangles':len(indices)//3,'areaDifference':abs(area-land.area),
        'sources':[{'file':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in (boundary_path,water_path)]}
dest.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
print(json.dumps({'file':str(dest),'triangles':result['triangles'],'bytes':dest.stat().st_size,'areaDifference':result['areaDifference']}))
