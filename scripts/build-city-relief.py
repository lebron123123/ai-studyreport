"""Versioned four-district visual relief. DSM is NOT a surveyed bare-earth DTM.

Preserves the existing flat road/building datum, following the reference city's
reserved-corridor approach. Does not claim bridges or roads have surveyed grades.
"""
import sys, json, math, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tmp/city-terrain-python'))
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import grey_opening, gaussian_filter, distance_transform_edt
from shapely.geometry import shape, mapping

DISTRICTS = ['baoan', 'futian', 'nanshan', 'luohu']
DEST = ROOT / 'project-map/city-relief-v1'
if DEST.exists():
    raise RuntimeError('Preserve published assets; choose a new version to rebuild')
catalog = json.loads((ROOT / 'project-map/models/catalog.json').read_text('utf8'))
lon0, lat0 = catalog['origin']; scale = catalog['scale']
kx, kz = 111320 * math.cos(math.radians(lat0)) * scale, 111320 * scale
step = 36  # 60 real metres; source is native 30 metres
boundaries = [shape(json.loads((ROOT / f'outputs/{d}-source/audit/boundary.geojson').read_text('utf8'))) for d in DISTRICTS]
w = min(g.bounds[0] for g in boundaries); s = min(g.bounds[1] for g in boundaries)
e = max(g.bounds[2] for g in boundaries); n = max(g.bounds[3] for g in boundaries)
x0 = math.floor((w-lon0)*kx/step)*step; z0 = math.floor((s-lat0)*kz/step)*step
cols = math.ceil(((e-lon0)*kx-x0)/step)+1; rows = math.ceil(((n-lat0)*kz-z0)/step)+1
transform = from_origin(lon0+(x0-step/2)/kx, lat0+(z0+(rows-.5)*step)/kz, step/kx, step/kz)
dem = np.full((rows, cols), -9999, dtype=np.float32)
sources = []
for longitude, expected in [('113','074e13244e6da6745bcf76150fdc6e06f774140a7aac796785922fce962eacbb'), ('114','b950ab75642d6684fe08c82b6aa3bb087c1d35acd229ef0e6e6586e1b0868fa3')]:
    name = f'Copernicus_DSM_COG_10_N22_00_E{longitude}_00_DEM'
    path = ROOT / f'outputs/city-dem-source/{name}.tif'
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected: raise RuntimeError('DSM checksum mismatch')
    with rasterio.open(path) as src:
        reproject(rasterio.band(src,1), dem, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=transform, dst_crs='EPSG:4326', dst_nodata=-9999,
                  init_dest_nodata=False, resampling=Resampling.bilinear)
    sources.append({'file':name+'.tif','sha256':digest,'bytes':path.stat().st_size})
inside = rasterize([(mapping(g),1) for g in boundaries], out_shape=dem.shape, transform=transform, dtype='uint8')
if np.any((dem == -9999) & (inside > 0)): raise RuntimeError('DSM has missing cells inside requested districts')
reserved = np.zeros(dem.shape, dtype=np.uint8)
counts = {}
for district in DISTRICTS:
    shapes = []
    items = json.loads((ROOT/f'outputs/{district}-source/basemap.json').read_text('utf8'))['features']
    for item in items:
        # All existing routes remain on their original datum in this first pass.
        if item['kind'] in ('road','water'): shapes.append((item['geometry'],1))
    buildings = 0
    for path in (ROOT/f'outputs/{district}-source/audit').glob('*.geojson'):
        if path.name == 'boundary.geojson': continue
        for feature in json.loads(path.read_text('utf8'))['features']:
            shapes.append((feature['geometry'],1)); buildings += 1
    if shapes:
        reserved |= rasterize(shapes, out_shape=dem.shape, transform=transform, all_touched=True, dtype='uint8')
    counts[district] = {'buildingFootprints':buildings, 'contextFeatures':len(items)}
    print(district, counts[district], flush=True)
dem = np.maximum(0, np.where(dem == -9999, 0, dem)-20)
dem = gaussian_filter(grey_opening(dem, size=3), .8)
# Fade from the protected road/building/water corridors, never bury city assets.
clearance = distance_transform_edt(reserved == 0)*step
blend = np.clip((clearance-54)/180, 0, 1)
edge = np.clip(distance_transform_edt(inside > 0)*step/180, 0, 1)
heights = np.flipud(dem*scale*blend*edge).astype('<f4').copy()
assert np.isfinite(heights).all() and heights.min() >= 0
DEST.mkdir()
tiles=[]
for rz in range(0, rows-1, 64):
    for cx in range(0, cols-1, 64):
        grid=heights[rz:min(rows,rz+65),cx:min(cols,cx+65)]
        if grid.max() < .05: continue
        filename=f'{cx}_{rz}.bin'; data=grid.tobytes(); (DEST/filename).write_bytes(data)
        tiles.append({'file':filename,'x0':x0+cx*step,'z0':z0+rz*step,'columns':grid.shape[1],
                      'rows':grid.shape[0],'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
# One small complete overview remains visible at district-wide distances.
coarse=heights[::4,::4].copy(); (DEST/'overview.bin').write_bytes(coarse.tobytes())
manifest={'schema':1,'origin':catalog['origin'],'scale':scale,'step':step,'x0':x0,'z0':z0,
          'columns':cols,'rows':rows,'tiles':tiles,'overview':{'file':'overview.bin','step':step*4,
          'columns':coarse.shape[1],'rows':coarse.shape[0]},'sources':sources,'districts':counts,
          'maxVisualHeight':float(heights.max()),'policy':'Visual DSM relief, not survey terrain. 20m datum removal; filtered; roads, buildings and water reserved at original flat datum. No surveyed road grades.',
          'attribution':'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Context © OpenStreetMap contributors, ODbL.'}
(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'tiles':len(tiles),'bytes':sum(p.stat().st_size for p in DEST.iterdir()),'grid':[cols,rows], 'maxVisualHeight':manifest['maxVisualHeight']}),flush=True)
