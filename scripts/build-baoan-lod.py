"""Offline GLB + 3D Tiles 1.1: meters in local ENU, exact footprint roofs,
two geometric/material levels, separate explicitly estimated height layer.
No authoritative missing heights are invented. Outputs are versioned.
"""
import sys,json,math,struct,re,statistics,argparse
from pathlib import Path
from collections import Counter,defaultdict
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tmp/baoan-python'))
import numpy as np
from shapely.geometry import shape,Polygon,box
from shapely.ops import transform,unary_union
from shapely import constrained_delaunay_triangles
from shapely.strtree import STRtree
parser=argparse.ArgumentParser();parser.add_argument('--district',choices=['baoan','futian','nanshan','luohu'],default='baoan');args=parser.parse_args()
DEST=ROOT/f'project-map/{args.district}-lod-v2'
if DEST.exists():raise RuntimeError('Preserve existing build; use a new version directory')
AUDIT=ROOT/f'outputs/{args.district}-source/audit'
def numeric(v):
 s=str(v or '').strip()
 if re.fullmatch(r'\d+(\.\d+)?\s*(m)?',s):return float(s.rstrip('m').strip())
 return None
def explicit(tags):
 h=numeric(tags.get('height'));l=numeric(tags.get('building:levels'))
 if h and 0<h<=1000:return h,'tag'
 if l and 0<l<=200:return l*3,'levels'
 return None,'unknown'
def frame(lon,lat):
 lo,la=map(math.radians,(lon,lat));s,c=math.sin(la),math.cos(la);sl,cl=math.sin(lo),math.cos(lo)
 n=6378137/math.sqrt(1-0.00669437999014*s*s)
 return [-sl,cl,0,0,-s*cl,-s*sl,c,0,c*cl,c*sl,s,0,n*c*cl,n*c*sl,n*(1-0.00669437999014)*s,1]
def local(lon,lat):
 # Exact WGS84 ECEF -> ENU horizontal coordinates, not a fixed degrees/meters ratio.
 m=frame(lon,lat);origin=np.array(m[12:15]);east=np.array(m[:3]);north=np.array(m[4:7])
 def project(x,y,z=None):
  lo=np.radians(x);la=np.radians(y);v=6378137/np.sqrt(1-.00669437999014*np.sin(la)**2)
  dx=v*np.cos(la)*np.cos(lo)-origin[0];dy=v*np.cos(la)*np.sin(lo)-origin[1];dz=v*(1-.00669437999014)*np.sin(la)-origin[2]
  return east[0]*dx+east[1]*dy+east[2]*dz,north[0]*dx+north[1]*dy+north[2]*dz
 return project
def polygons(g):
 if g.geom_type=='Polygon':return [g]
 return [p for p in getattr(g,'geoms',[]) if p.geom_type=='Polygon']
class Mesh:
 def __init__(self):self.groups=defaultdict(lambda:[[],[],[]])
 def tri(self,key,points,uv=None):
  p,n,t=self.groups[key];a,b,c=map(np.array,points);normal=np.cross(b-a,c-a);length=np.linalg.norm(normal)
  if length<1e-8:return
  normal=(normal/length).tolist();p.extend(points);n.extend([normal]*3);t.extend(uv or [(0,0)]*3)
 def roof(self,g,height,key):
  for poly in polygons(g):
   for tri in constrained_delaunay_triangles(poly).geoms:
    xy=list(tri.exterior.coords)[:3];pts=[(x,height,-y) for x,y in xy]
    if np.cross(np.array(pts[1])-pts[0],np.array(pts[2])-pts[0])[1]<0:pts.reverse()
    self.tri(key,pts)
 def building(self,g,height,base,key,fine):
  self.roof(g,height,1 if key==0 else key)
  for p in polygons(g):
   for ring in [p.exterior,*p.interiors]:
    xy=list(ring.coords)
    for (x,y),(xx,yy) in zip(xy,xy[1:]):
     a,b,c,d=(x,base,-y),(xx,base,-yy),(xx,height,-yy),(x,height,-y)
     u=math.hypot(xx-x,yy-y)/25;v=(height-base)/35
     self.tri(key,[a,b,c],[(0,0),(u,0),(u,v)]);self.tri(key,[a,c,d],[(0,0),(u,v),(0,v)])
 def save(self,file,fine):
  data=bytearray();views=[];access=[];primitives=[]
  def array(values,kind):
   ar=np.asarray(values,dtype='<f4');offset=len(data);data.extend(ar.tobytes());views.append({'buffer':0,'byteOffset':offset,'byteLength':ar.nbytes,'target':34962})
   a={'bufferView':len(views)-1,'componentType':5126,'count':len(values),'type':kind}
   if kind=='VEC3':a.update(min=ar.min(axis=0).tolist(),max=ar.max(axis=0).tolist())
   access.append(a);return len(access)-1
  for key,(pos,norm,uv) in self.groups.items():
   if pos:primitives.append({'attributes':{'POSITION':array(pos,'VEC3'),'NORMAL':array(norm,'VEC3'),'TEXCOORD_0':array(uv,'VEC2')},'material':key})
  colors=[[.97,.94,.88,1],[.25,.28,.29,1],[.50,.66,.76,1],[.48,.53,.56,1],[.37,.50,.35,1],[.30,.48,.60,1],[.44,.46,.47,1],[.66,.55,.39,1]]
  materials=[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':0,'roughnessFactor':.75}} for c in colors]
  if fine:materials[0]['pbrMetallicRoughness']['baseColorTexture']={'index':0};materials[7]['pbrMetallicRoughness']['baseColorTexture']={'index':0}
  gltf={'asset':{'version':'2.0','generator':'Baoan offline derived OSM; estimates separate'},'buffers':[{'byteLength':len(data)}],'bufferViews':views,'accessors':access,'materials':materials,'meshes':[{'primitives':primitives}],'nodes':[{'mesh':0}],'scenes':[{'nodes':[0]}],'scene':0}
  if fine:gltf.update(images=[{'uri':'../../city/textures/architecture/warm-residential.png'}],textures=[{'source':0,'sampler':0}],samplers=[{'wrapS':10497,'wrapT':10497,'minFilter':9987,'magFilter':9729}])
  js=json.dumps(gltf,separators=(',',':')).encode();js+=b' '*((-len(js))%4);data+=b'\0'*((-len(data))%4)
  file.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(data),0x004e4942)+data)

sources=[];observed=defaultdict(list)
# Preserve the author's existing blocks, rather than double-rendering OSM buildings.
legacy=None;excluded=0
if args.district!='baoan':
 old=json.loads((ROOT/'project-map/city-stream-v1/index.json').read_text())
 def ll(x,z):return (114.025+x/.6/(111320*math.cos(math.radians(22.536))),22.536+z/.6/111320)
 legacy=unary_union([box(*ll(*t['bounds'][:2]),*ll(*t['bounds'][2:])) for t in old['tiles']])
for f in sorted(AUDIT.glob('*.geojson')):
 if f.name=='boundary.geojson':continue
 features=json.loads(f.read_text(encoding='utf8'))['features']
 if legacy is not None:
  keep=[feature for feature in features if not legacy.intersects(shape(feature['geometry']))]
  excluded+=len(features)-len(keep);features=keep
 sources.append((f.stem,features))
 for feature in features:
  tags=feature['properties']['tags'];h,k=explicit(tags)
  if h:observed[tags.get('building','yes')].append(h)
basemap=json.loads((ROOT/f'outputs/{args.district}-source/basemap.json').read_text(encoding='utf8'))
if legacy is not None:
 from shapely.geometry import mapping
 basemap['features']=[{**f,'geometry':mapping(shape(f['geometry']).difference(legacy))} for f in basemap['features']]
 basemap['features']=[f for f in basemap['features'] if not shape(f['geometry']).is_empty]
geoms=[shape(f['geometry']) for f in basemap['features']];tree=STRtree(geoms)
# Include context-only cells. Restricting context to building cells leaves
# artificial square holes in forests, reservoirs and low-density areas.
dx=1000/(111320*math.cos(math.radians(22.536)));dy=1000/111320
present={key for key,_ in sources};extra=set()
for g in geoms:
 w,s,e,n=g.bounds
 for x in range(math.floor((w-114.025)/dx),math.floor((e-114.025)/dx)+1):
  for y in range(math.floor((s-22.536)/dy),math.floor((n-22.536)/dy)+1):
   key=f'{x}_{y}'
   if key not in present and key not in extra and g.intersects(box(114.025+x*dx,22.536+y*dy,114.025+(x+1)*dx,22.536+(y+1)*dy)):extra.add(key)
sources.extend((key,[]) for key in sorted(extra));print(f'Context-only cells: {len(extra)}',flush=True)
cells=[]
for key,_ in sources:
 x,y=map(int,key.split('_'));cells.append(box(114.025+x*dx,22.536+y*dy,114.025+(x+1)*dx,22.536+(y+1)*dy))
coverage=unary_union(cells).buffer(1e-9)
assert all(coverage.covers(g) for g in geoms),'Basemap geometries must not fall through missing grid cells'
DEST.mkdir();(DEST/'mesh').mkdir();(DEST/'metadata').mkdir()
children={'known':[],'estimated':[]};stats=Counter();records=[]
for number,(key,features) in enumerate(sources):
 shapes=[shape(f['geometry']) for f in features];bounds=[g.bounds for g in shapes]
 if not bounds:
  gx,gy=map(int,key.split('_'));bounds=[(114.025+gx*dx,22.536+gy*dy,114.025+(gx+1)*dx,22.536+(gy+1)*dy)]
 w=min(b[0] for b in bounds);s=min(b[1] for b in bounds);e=max(b[2] for b in bounds);n=max(b[3] for b in bounds);lon=(w+e)/2;lat=(s+n)/2;project=local(lon,lat)
 metadata=[];maxheight=1
 for f,g in zip(features,shapes):
  tags=f['properties']['tags'];h,kind=explicit(tags);group=tags.get('building','yes');sample=observed[group]
  estimated=h is None
  if estimated:h=round(statistics.median(sample),1) if len(sample)>=10 and group!='yes' else 12
  base=numeric(tags.get('min_height')) or 0
  if base>=h:base=0;stats['invalidMinHeight']+=1
  maxheight=max(maxheight,h)
  metadata.append({'id':f['id'],'name':tags.get('name',f['id']),'height':h,'base':base,'kind':kind,'basis':f'同类{len(sample)}项高度/楼层样本中位数，非实测' if estimated and len(sample)>=10 and group!='yes' else '12米示意，非实测' if estimated else 'OSM高度标签，未测绘核实' if kind=='tag' else 'OSM楼层×3米估算','geometry':f['geometry']})
  stats[kind]+=1
 # Small flat offline context around the source grid; no terrain elevations implied.
 gridx,gridy=map(int,key.split('_'));cw=114.025+gridx*1000/(111320*math.cos(math.radians(22.536)));ce=114.025+(gridx+1)*1000/(111320*math.cos(math.radians(22.536)));cs=22.536+gridy*1000/111320;cn=22.536+(gridy+1)*1000/111320
 clip=box(cw,cs,ce,cn);context=[]
 for idx in tree.query(clip,predicate='intersects'):
  item=basemap['features'][idx];g=transform(project,geoms[idx].intersection(clip))
  if item['kind']=='road':
   width=12 if item.get('class') in ('motorway','trunk') else 7 if item.get('class') in ('primary','secondary') else 3
   g=g.buffer(width/2,quad_segs=1);material=6
  else:material=4 if item['kind']=='green' else 5
  context.append((g,material))
 w=min(w,cw);s=min(s,cs);e=max(e,ce);n=max(n,cn)
 # Road buffers extend outside their clipping box. Include a conservative margin
 # in culling volumes so edge roads do not disappear before leaving the view.
 region=[math.radians(v) for v in [w-.00025,s-.00025,e+.00025,n+.00025]]+[-5,maxheight+5]
 for layer in children:
  selected=[(m,g) for m,g in zip(metadata,shapes) if (m['kind']=='unknown')==(layer=='estimated')]
  if not selected and layer=='estimated':continue
  for fine in (False,True):
   mesh=Mesh()
   if layer=='known':
    for g,mat in context:mesh.roof(g,0.15 if mat==6 else .05,mat)
    for m,g in zip(metadata,shapes):
     if m['kind']=='unknown':mesh.roof(transform(project,g),.2,3)
   for m,g in selected:
    g=transform(project,g);g=g if fine else g.simplify(1,preserve_topology=True)
    mesh.building(g,m['height'],m['base'],7 if layer=='estimated' else 0 if fine else 2, fine)
   if not mesh.groups:continue
   mesh.save(DEST/'mesh'/f'{key}-{layer}-{"fine" if fine else "coarse"}.glb',fine)
  coarse=f'mesh/{key}-{layer}-coarse.glb';fine=f'mesh/{key}-{layer}-fine.glb'
  if not (DEST/coarse).exists():continue
  children[layer].append({'boundingVolume':{'region':region},'transform':frame(lon,lat),'geometricError':24,'refine':'REPLACE','content':{'uri':coarse},'children':[{'boundingVolume':{'region':region},'geometricError':0,'content':{'uri':fine}}]})
 (DEST/'metadata'/f'{key}.json').write_text(json.dumps(metadata,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 if (DEST/'mesh'/f'{key}-known-fine.glb').exists():records.append({'key':key,'center':[lon,lat],'count':len(features),'known':sum(m['kind']!='unknown' for m in metadata),'bounds':[w,s,e,n]})
 if number%25==0:print(f'Built {number+1}/{len(sources)} grids',flush=True)
allregions=[c['boundingVolume']['region'] for c in children['known']]
region=[min(r[0] for r in allregions),min(r[1] for r in allregions),max(r[2] for r in allregions),max(r[3] for r in allregions),-5,max(r[5] for r in allregions)]
for layer,value in children.items():(DEST/f'{layer}.json').write_text(json.dumps({'asset':{'version':'1.1'},'extras':{'boundsPaddingDegrees':.00025},'geometricError':10000,'root':{'boundingVolume':{'region':region},'geometricError':10000,'refine':'REPLACE','children':value}},separators=(',',':')))
report={'counts':dict(stats),'tiles':records,'heightPolicy':'Observed tags retained; levels estimated at 3m; unknown heights separate optional median/default layer; no authoritative height completion claim.','basemap':'OSM roads/green/water, flat ellipsoid, no imagery or DEM','sourceMd5':basemap['sourceMd5'],'bytes':sum(f.stat().st_size for f in DEST.rglob('*') if f.is_file())}
report.update(district=args.district,legacyOverlapExcluded=excluded,completeDistrictClaim=False)
(DEST/'index.json').write_text(json.dumps(report,ensure_ascii=False),encoding='utf8');print(json.dumps({k:v for k,v in report.items() if k!='tiles'},ensure_ascii=False),flush=True)
