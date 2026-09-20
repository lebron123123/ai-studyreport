// User-supplied artwork, kept unchanged. Coordinates must come from the host model.
export const ANJU_LOGO_URL = new URL('./models/anju-logo-user.png', import.meta.url).href;
export function signDimensions(width, imageWidth, imageHeight) {
  if (![width, imageWidth, imageHeight].every(v => Number.isFinite(v) && v > 0)) {
    throw new TypeError('标牌尺寸必须为正数');
  }
  return {width, height: width * imageHeight / imageWidth};
}

export function createAnjuRooftopSign(B, scene, {
  parent, width, imageWidth, imageHeight, position, rotationY = 0
}) {
  const dimensions = signDimensions(width, imageWidth, imageHeight);
  if (!parent || !position || ![position.x, position.y, position.z, rotationY].every(Number.isFinite)) {
    throw new TypeError('标牌必须绑定已定位的楼体和有效局部坐标');
  }
  let mesh, material, texture, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    mesh?.dispose(); material?.dispose(); texture?.dispose();
  };
  try {
    mesh = B.MeshBuilder.CreatePlane('anju-rooftop-sign', {
      ...dimensions, sideOrientation: B.Mesh.DOUBLESIDE
    }, scene);
    mesh.parent = parent;
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.y = rotationY;
    mesh.isPickable = false;
    material = new B.StandardMaterial('anju-rooftop-sign-material', scene);
    texture = new B.Texture(ANJU_LOGO_URL, scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new B.Color3(1, 1, 1);
    material.zOffset = -8;
    material.disableLighting = true;
    material.specularColor = new B.Color3(0, 0, 0);
    mesh.material = material;
    mesh.metadata = {source: 'user-supplied-logo', status: 'requested-signage-not-surveyed'};
    parent.onDisposeObservable.addOnce(dispose);
    return {mesh, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
