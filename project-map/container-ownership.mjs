// Babylon constructors register assets immediately. A detached container must
// own them exclusively before addAllToScene(), otherwise disposal leaves ghosts.
export function adoptSceneAsset(container, scene, collection, asset) {
 const remove={textures:'removeTexture',meshes:'removeMesh',materials:'removeMaterial'}[collection];
 if(!remove)throw new TypeError('Unsupported asset collection: '+collection);
 while(scene[collection].includes(asset))scene[remove](asset);
 if(!container[collection].includes(asset))container[collection].push(asset);
 return asset;
}
