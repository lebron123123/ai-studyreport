"""Offline OSM coverage audit; no publishing, no inferred buildings/heights.

Run after the source PBF and its official checksum have downloaded completely.
The output is an audited geometry input for modelling, NOT finished 3D assets.
"""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tmp/baoan-python'))
import hashlib
import json
import math
import argparse
from collections import Counter, defaultdict


def main():
    import osmium
    from shapely import wkb
    from shapely.geometry import mapping
    parser = argparse.ArgumentParser()
    parser.add_argument('--district', choices=['baoan','futian','nanshan','luohu'], default='baoan')
    args = parser.parse_args()
    name, anchor = {'baoan':('宝安区',(113.88,22.60)), 'futian':('福田区',(114.055,22.54)), 'nanshan':('南山区',(113.93,22.53)), 'luohu':('罗湖区',(114.13,22.56))}[args.district]
    source = ROOT / 'outputs/baoan-source/guangdong-260912.osm.pbf'
    checksum = source.with_suffix(source.suffix + '.md5')
    if not source.exists() or not checksum.exists():
        raise RuntimeError('Source or official checksum missing; wait for download.')
    expected = checksum.read_text().split()[0].lower()
    if len(expected) != 32 or any(c not in '0123456789abcdef' for c in expected):
        raise RuntimeError('Invalid official checksum')
    with source.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'md5').hexdigest()
    if actual != expected:
        raise RuntimeError('Incomplete or corrupt PBF: checksum mismatch; no outputs published.')
    destination = ROOT / f'outputs/{args.district}-source/audit'
    if destination.exists():
        raise RuntimeError('Audit directory already exists; preserve the previous audit.')
    factory = osmium.geom.WKBFactory()

    class Boundary(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.matches = []
        def area(self, area):
            tags = dict(area.tags)
            if tags.get('boundary') != 'administrative':
                return
            if tags.get('name:zh', tags.get('name')) != name:
                return
            geometry = wkb.loads(factory.create_multipolygon(area), hex=True)
            if geometry.is_valid and geometry.covers(__import__('shapely').geometry.Point(*anchor)):
                self.matches.append((area.orig_id(), geometry))

    print(f'Step 1/2: locating {args.district} administrative boundary', flush=True)
    boundary_reader = Boundary()
    boundary_reader.apply_file(str(source), locations=True, filters=[osmium.filter.KeyFilter('boundary')])
    if len(boundary_reader.matches) != 1:
        raise RuntimeError('Expected one valid Baoan boundary; refuse a bounding-box substitute.')
    relation_id, boundary = boundary_reader.matches[0]
    tiles, counts, failures = defaultdict(list), Counter(), Counter()

    class Buildings(osmium.SimpleHandler):
        def area(self, area):
            tags = dict(area.tags)
            if not ('building' in tags or 'building:part' in tags):
                return
            try:
                geometry = wkb.loads(factory.create_multipolygon(area), hex=True)
                if not geometry.is_valid:
                    failures['invalid_geometry'] += 1
                    return
                if not geometry.intersects(boundary):
                    return
                point = geometry.representative_point()
                x = (point.x - 114.025) * 111320 * math.cos(math.radians(22.536))
                z = (point.y - 22.536) * 111320
                tile = f'{math.floor(x/1000)}_{math.floor(z/1000)}'
                status = 'height_tag_unverified' if 'height' in tags else 'levels_only_unverified' if 'building:levels' in tags else 'unknown'
                counts[status] += 1
                tiles[tile].append({'type': 'Feature', 'id': f'{"way" if area.from_way() else "relation"}/{area.orig_id()}',
                    'properties': {'tags': tags, 'heightStatus': status, 'source': 'OpenStreetMap', 'license': 'ODbL-1.0'},
                    'geometry': mapping(geometry)})
            except (RuntimeError, ValueError):
                failures['geometry_error'] += 1

    print('Step 2/2: assembling building polygons and 1km preparation tiles', flush=True)
    Buildings().apply_file(str(source), locations=True, filters=[osmium.filter.KeyFilter('building', 'building:part')])
    if not tiles:
        raise RuntimeError('No buildings extracted; no successful audit published.')
    destination.mkdir(parents=True)
    for key, features in tiles.items():
        (destination / f'{key}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False), encoding='utf-8')
    (destination / 'boundary.geojson').write_text(json.dumps(mapping(boundary)), encoding='utf-8')
    report = {'source': source.name, 'md5': actual, 'boundaryRelation': relation_id,
        'features': sum(counts.values()), 'tiles': len(tiles), 'heightStatus': dict(counts), 'sourceWideGeometryFailures': dict(failures),
        'completeDistrictClaim': False, 'modelPublished': False,
        'limitations': ['OSM coverage completeness is unknown without an independent authoritative inventory.',
            'Counts include building parts; not a count of unique physical buildings.',
            'Height tags are not verified survey heights; unknowns are retained.',
            'Buildings intersecting the boundary retain their full geometry.']}
    (destination / 'coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
