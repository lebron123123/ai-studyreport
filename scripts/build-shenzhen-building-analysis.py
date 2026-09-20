"""Build a reproducible city-wide OSM footprint analysis, independent of 3D assets."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tmp/baoan-python'))
import hashlib, json, math
from collections import defaultdict, Counter
import osmium
from shapely import wkb
from shapely.geometry import Point, box, mapping
from shapely.ops import transform, unary_union

SOURCE = ROOT / 'outputs/baoan-source/guangdong-260912.osm.pbf'
OUT = ROOT / 'project-map/building-analysis-v1'
SX = 111320 * math.cos(math.radians(22.6))
SY = 111320
def project(x, y, z=None): return ((x-114)*SX, (y-22.6)*SY)
def inverse(x, y, z=None): return (x/SX+114, y/SY+22.6)
def save(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def main():
    if OUT.exists(): raise RuntimeError('Output exists; preserve previous dataset.')
    with SOURCE.open('rb') as f: digest = hashlib.file_digest(f, 'md5').hexdigest()
    if digest != SOURCE.with_suffix('.pbf.md5').read_text().split()[0]: raise RuntimeError('Checksum mismatch')
    factory = osmium.geom.WKBFactory()
    boundaries = {}
    class Boundaries(osmium.SimpleHandler):
        def area(self, a):
            t = dict(a.tags)
            if t.get('boundary') != 'administrative': return
            name = t.get('name:zh', t.get('name', ''))
            if name not in ['深圳市','宝安区','南山区','福田区','罗湖区','龙华区','龙岗区','光明区','坪山区','盐田区','大鹏新区','深汕特别合作区']: return
            g = wkb.loads(factory.create_multipolygon(a), hex=True)
            if g.is_valid: boundaries[name] = (a.orig_id(), g)
    print('1/3 Reading Shenzhen and district boundaries', flush=True)
    Boundaries().apply_file(str(SOURCE), locations=True, filters=[osmium.filter.KeyFilter('boundary')])
    if '深圳市' not in boundaries: raise RuntimeError('No city boundary; cannot substitute bounding box')
    city = boundaries['深圳市'][1]
    if not city.covers(Point(114.057,22.543)): raise RuntimeError('Wrong city boundary')
    districts = {n:g for n, (_,g) in boundaries.items() if n!='深圳市'}
    grid, points, district_counts, errors = defaultdict(list), [], Counter(), Counter()
    seen = set()
    class Buildings(osmium.SimpleHandler):
        def area(self, a):
            t = dict(a.tags)
            if t.get('building', 'no') in ['no','false','0']: return
            try:
                g = wkb.loads(factory.create_multipolygon(a), hex=True)
                if not g.is_valid: errors['invalidGeometry']+=1; return
                if not g.intersects(city): return
                g = g.intersection(city)
                if g.is_empty or g.area==0: return
                key = g.normalize().wkb
                if key in seen: errors['duplicateGeometry']+=1; return
                seen.add(key)
                p = g.representative_point()
                district = next((n for n,d in districts.items() if d.covers(p)), '区界未匹配')
                district_counts[district]+=1
                pg = transform(project,g)
                points.append([round(p.x,7),round(p.y,7),round(pg.area,1),district])
                x0,y0,x1,y1 = pg.bounds
                for x in range(math.floor(x0/500),math.floor(x1/500)+1):
                    for y in range(math.floor(y0/500),math.floor(y1/500)+1):
                        clipped = pg.intersection(box(x*500,y*500,(x+1)*500,(y+1)*500))
                        if clipped.area: grid[(x,y)].append(clipped)
            except (RuntimeError, ValueError): errors['geometryError']+=1
    print('2/3 Extracting ALL buildings inside Shenzhen boundary (not four districts)',flush=True)
    Buildings().apply_file(str(SOURCE), locations=True, filters=[osmium.filter.KeyFilter('building')])
    if not points: raise RuntimeError('Empty extraction')
    print(f'3/3 Unioning footprint areas in {len(grid)} grids; {len(points)} records',flush=True)
    counts=Counter((math.floor(project(p[0],p[1])[0]/500),math.floor(project(p[0],p[1])[1]/500)) for p in points)
    projected_city=transform(project,city)
    features=[]
    for (x,y), shapes in grid.items():
        cell=box(x*500,y*500,(x+1)*500,(y+1)*500).intersection(projected_city)
        occupied=unary_union(shapes).area
        features.append({'type':'Feature','properties':{'count':counts[(x,y)],'footprint':round(occupied,1),'cellArea':round(cell.area,1),'density':round(occupied/cell.area*100,3)},'geometry':mapping(transform(inverse,cell))})
    OUT.mkdir()
    save('grid.geojson',{'type':'FeatureCollection','features':features})
    save('points.json',points)
    save('boundary.geojson',{'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':n},'geometry':mapping(g.simplify(.00008,preserve_topology=True))} for n,(_,g) in boundaries.items()]})
    manifest={'version':1,'source':SOURCE.name,'sourceDate':'2026-09-12','md5':digest,'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','cityRelation':boundaries['深圳市'][0],'records':len(points),'gridSizeMetres':500,'gridCells':len(features),'districtCounts':dict(district_counts),'sourceWideErrors':dict(errors),'completeCityClaim':False,'bounds':list(city.bounds),'limitations':['覆盖深圳市OSM行政边界，不代表全市建筑普查完整。深汕是否纳入以边界文件为准。','只统计building轮廓，不单独叠加building:part；同形轮廓去重，记录数不等于产权楼栋数。','密度为已有建筑轮廓并集面积/500米网格市界内面积，不是容积率。','采用深圳局部米制近似投影，非测绘成果；无记录区域为数据未知，不是零建筑。','缓冲统计按轮廓代表点落入统计，不是精确相交建筑数量。']}
    save('manifest.json',manifest)
    print(json.dumps(manifest,ensure_ascii=True),flush=True)

if __name__=='__main__': main()
