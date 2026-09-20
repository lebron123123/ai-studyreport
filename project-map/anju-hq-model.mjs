import {buildHQGeometry,buildHQFacadePixels} from './anju-hq-geometry.mjs';
import {createAnjuRooftopSign} from './anju-rooftop-sign.mjs';

// Isolated model factory. The city adapter must remove verified overlapping
// source geometry before enabling this reconstruction in the live city.
export function createHQModel(B,scene,catalog,{withLogo=true,detail=true}={}){
 const data=buildHQGeometry(catalog,undefined,{detail}),root=new B.TransformNode('anju-hq-reference',scene);
 root.position.set(data.anchor.x,0,data.anchor.z);
 root.metadata={status:data.status,source:'anju-hq-evidence.mjs'};
 const materials=[],meshes=[],textures=[];let sign,disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;sign?.dispose();for(const m of meshes)m.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();root.dispose();};
 try{
  const material=new B.StandardMaterial('anju-hq-glazing',scene);
  material.diffuseColor=new B.Color3(1,1,1);material.specularColor=new B.Color3(.24,.28,.31);material.specularPower=48;
  material.emissiveColor=new B.Color3(.12,.14,.16);
  material.backFaceCulling=false;materials.push(material);
  // Separate depth bias for close facade layers: the city camera has a much
  // wider depth range than the standalone preview. Physical offsets alone
  // can quantize to the same depth and produce large diagonal interference.
  const panelMaterial=material.clone('anju-hq-panels');
  const frameMaterial=material.clone('anju-hq-frames');
  panelMaterial.zOffset=-2;frameMaterial.zOffset=-4;
  materials.push(panelMaterial,frameMaterial);
  const hosts=new Map();
  for(const body of data.bodies){
   const host=new B.TransformNode('anju-hq-'+body.id,scene);host.parent=root;hosts.set(body.id,host);
   let facade=panelMaterial;
   if(detail){
    const image=buildHQFacadePixels(body.floors);
    const texture=B.RawTexture.CreateRGBATexture(image.pixels,image.width,image.height,scene,true,false,B.Texture.TRILINEAR_SAMPLINGMODE);
    texture.wrapU=B.Texture.WRAP_ADDRESSMODE;texture.anisotropicFilteringLevel=4;textures.push(texture);
    facade=panelMaterial.clone('anju-hq-facade-'+body.id);facade.diffuseTexture=texture;materials.push(facade);
   }
   for(const part of (detail?['shell','panels','frames']:['shell'])){
    const geometry=body[part],mesh=new B.Mesh('anju-hq-'+body.id+'-'+part,scene),v=new B.VertexData();
    v.positions=geometry.positions;v.indices=geometry.indices.map((_,i,a)=>a[i-i%3+[0,2,1][i%3]]);v.colors=geometry.colors;v.normals=[];
    if(geometry.uvs.length)v.uvs=geometry.uvs;
    B.VertexData.ComputeNormals(v.positions,v.indices,v.normals);v.applyToMesh(mesh);
    mesh.parent=host;mesh.material=part==='panels'?facade:part==='frames'?frameMaterial:material;mesh.metadata={building:body.id,status:data.status};meshes.push(mesh);
   }
  }
  if(withLogo)sign=createAnjuRooftopSign(B,scene,{parent:hosts.get(data.logo.host),width:data.logo.width,imageWidth:1495,imageHeight:1426,position:data.logo.position});
  root.onDisposeObservable.addOnce(dispose);
  return {root,meshes,data,dispose,get logo(){return sign?.mesh;}};
 }catch(e){dispose();throw e;}
}
