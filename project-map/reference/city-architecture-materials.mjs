// Adapted from local GTA_SZ derivative: city-architecture-materials.ts; original SHA256 1d0954010741e56352ba4d82d109dff8f07b3f92fe90fec6f61197daf332e279
const { Color3, PBRMaterial, Texture, VertexBuffer, Mesh } = globalThis.BABYLON;
import { TencentWindowLighting, attachTencentWindowData } from './city-landmark-lighting.mjs';
const PROFILES = {
    'city-office': {
        color: [
            .80,
            .88,
            .94
        ],
        roughness: .33,
        metallic: .035,
        texture: 'curtain-glass',
        environment: 1.05
    },
    'city-residential': {
        color: [
            .97,
            .94,
            .88
        ],
        roughness: .72,
        metallic: 0,
        texture: 'warm-residential'
    },
    'city-stone': {
        color: [
            .93,
            .92,
            .89
        ],
        roughness: .79,
        metallic: 0,
        texture: 'light-stone'
    },
    'city-concrete': {
        color: [
            .72,
            .69,
            .63
        ],
        roughness: .84,
        metallic: 0
    },
    'city-roof': {
        color: [
            .25,
            .28,
            .29
        ],
        roughness: .88,
        metallic: 0
    },
    'city-shopfront': {
        color: [
            .28,
            .36,
            .39
        ],
        roughness: .34,
        metallic: .025
    },
    'city-steel': {
        color: [
            .43,
            .49,
            .53
        ],
        roughness: .46,
        metallic: .66
    },
    'city-silver': {
        color: [
            .67,
            .70,
            .70
        ],
        roughness: .43,
        metallic: .64
    },
    'tencent-glass': {
        color: [
            .20,
            .31,
            .36
        ],
        roughness: .38,
        metallic: .035,
        environment: .85
    },
    'tencent-window': {
        color: [
            .13,
            .21,
            .25
        ],
        roughness: .36,
        metallic: .025,
        environment: .85
    },
    'tencent-champagne': {
        color: [
            .55,
            .51,
            .43
        ],
        roughness: .44,
        metallic: .56
    },
    'kk100-glass': {
        color: [
            .55,
            .67,
            .75
        ],
        roughness: .29,
        metallic: .04,
        environment: 1.05
    },
    'pingan-glass': {
        color: [
            .61,
            .66,
            .69
        ],
        roughness: .31,
        metallic: .055,
        environment: 1.08
    },
    'diwang-glass': {
        color: [
            .38,
            .61,
            .57
        ],
        roughness: .31,
        metallic: .03,
        environment: 1.04
    },
    'mixc-glass': {
        color: [
            .60,
            .67,
            .70
        ],
        roughness: .37,
        metallic: .025
    },
    'qijie-glass': {
        color: [
            .39,
            .48,
            .54
        ],
        roughness: .35,
        metallic: .025
    },
    'fortune-glass': {
        color: [
            .38,
            .55,
            .66
        ],
        roughness: .34,
        metallic: .03
    },
    'fortune-window': {
        color: [
            .26,
            .38,
            .46
        ],
        roughness: .32,
        metallic: .02
    },
    'bamboo-glass': {
        color: [
            .44,
            .62,
            .66
        ],
        roughness: .30,
        metallic: .04
    },
    'bamboo-ribs': {
        color: [
            .72,
            .76,
            .77
        ],
        roughness: .40,
        metallic: .67,
        lineEmission: [
            .78,
            .9,
            1
        ]
    },
    'recess-glass': {
        color: [
            .28,
            .35,
            .40
        ],
        roughness: .34,
        metallic: .02
    },
    'qijie-render': {
        color: [
            .66,
            .68,
            .67
        ],
        roughness: .78,
        metallic: 0
    },
    'neutral-concrete': {
        color: [
            .73,
            .74,
            .72
        ],
        roughness: .81,
        metallic: 0
    },
    'fortune-band': {
        color: [
            .83,
            .85,
            .84
        ],
        roughness: .42,
        metallic: .46
    },
    'brushed-aluminum': {
        color: [
            .72,
            .76,
            .77
        ],
        roughness: .40,
        metallic: .67
    },
    'landmark-steel': {
        color: [
            .47,
            .53,
            .56
        ],
        roughness: .43,
        metallic: .69
    },
    'landmark-stone': {
        color: [
            .79,
            .77,
            .71
        ],
        roughness: .77,
        metallic: 0
    },
    'civic-gold': {
        color: [
            .68,
            .50,
            .30
        ],
        roughness: .47,
        metallic: .53
    }
};
const TEXTURE_URLS = {
    'curtain-glass': '/project-map/city/textures/architecture/curtain-glass.png',
    'warm-residential': '/project-map/city/textures/architecture/warm-residential.png',
    'light-stone': '/project-map/city/textures/architecture/light-stone.png'
};
const ORDINARY = {
    office: 'city-office',
    residential: 'city-residential',
    stone: 'city-stone',
    concrete: 'city-concrete',
    roof: 'city-roof',
    darkglass: 'city-shopfront',
    steel: 'city-steel',
    silver: 'city-silver'
};
const GLASS = {
    tencent: 'tencent-glass',
    kk100: 'kk100-glass',
    pingan: 'pingan-glass',
    diwang: 'diwang-glass',
    'mixc-world': 'mixc-glass',
    'qijie-gongguan': 'qijie-glass',
    'fortune-plaza': 'fortune-glass',
    bamboo: 'bamboo-glass',
    civic: 'recess-glass'
};
const TEXTURE_CHANNELS = [
    'albedoTexture',
    'baseWeightTexture',
    'baseDiffuseRoughnessTexture',
    'ambientTexture',
    'opacityTexture',
    'reflectionTexture',
    'emissiveTexture',
    'reflectivityTexture',
    'metallicTexture',
    'metallicReflectanceTexture',
    'reflectanceTexture',
    'microSurfaceTexture',
    'bumpTexture',
    'lightmapTexture',
    'environmentBRDFTexture'
];
function assetKind(assetName) {
    const path = assetName.split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/\.glb$/i, '');
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === 'buildings' || name === 'facades' || /(?:^|\/)facade-tiles\//.test(path)) return 'ordinary';
    if (name === 'landmarks') return 'landmark';
    if (name === 'landmark-detail') return 'detail';
    return null;
}
function sourceRole(material) {
    return material.name.toLowerCase().replace(/\.\d+$/, '');
}
function profileFor(mesh, kind, role) {
    if (kind === 'ordinary') {
        if (!/^(?:block|facade)_-?\d+_-?\d+_/.test(mesh.name)) return null;
        return ORDINARY[role] ?? null;
    }
    const prefix = kind === 'detail' ? 'detail_' : 'landmark_';
    if (!mesh.name.startsWith(prefix)) return null;
    const id = Object.keys(GLASS).find((candidate)=>mesh.name.startsWith(prefix + candidate + '_'));
    if (!id) return null;
    if (role === 'landmarkglass' || role === 'office') return GLASS[id];
    if (role === 'darkglass') return id === 'tencent' ? 'tencent-window' : id === 'fortune-plaza' ? 'fortune-window' : id === 'qijie-gongguan' ? 'qijie-glass' : 'recess-glass';
    if (role === 'concrete') return id === 'qijie-gongguan' ? 'qijie-render' : 'neutral-concrete';
    if (role === 'silver') return id === 'bamboo' ? 'bamboo-ribs' : id === 'fortune-plaza' ? 'fortune-band' : 'brushed-aluminum';
    if (role === 'steel') return 'landmark-steel';
    if (role === 'stone') return 'landmark-stone';
    if (role === 'gold') return id === 'tencent' ? 'tencent-champagne' : 'civic-gold';
    return null;
}
function cloneWithoutTextures(source, name) {
    const previous = TEXTURE_CHANNELS.map((channel)=>[
            channel,
            source[channel]
        ]);
    try {
        for (const [channel] of previous)source[channel] = null;
        return source.clone(name, true);
    } finally{
        for (const [channel, texture] of previous)source[channel] = texture;
    }
}
export function createArchitectureMaterials(scene) {
    const materials = new Map();
    const tencentLights = new Map();
    const materialProfiles = new WeakMap();
    const textures = new Map();
    const managed = new WeakSet();
    const applied = new WeakSet();
    const released = new WeakSet();
    const repairs = {
        roof: 0,
        concrete: 0,
        darkglass: 0,
        steel: 0,
        silver: 0
    };
    let mode = 'sunset', night = false, assignments = 0, retiredMaterials = 0, releasedTextures = 0, withoutUV = 0;
    const protectedTextures = ()=>{
        const result = new Set();
        if (scene.environmentTexture) result.add(scene.environmentTexture);
        if (scene.environmentBRDFTexture) result.add(scene.environmentBRDFTexture);
        for (const slot of textures.values()){
            if (slot.texture) result.add(slot.texture);
            if (slot.mask) result.add(slot.mask);
            if (slot.fallback) result.add(slot.fallback);
        }
        return result;
    };
    function releaseUnused(candidates) {
        const inUse = protectedTextures();
        for (const material of scene.materials)for (const texture of material.getActiveTextures())inUse.add(texture);
        for (const texture of candidates)if (!inUse.has(texture) && !released.has(texture)) {
            released.add(texture);
            texture.dispose();
            releasedTextures++;
        }
    }
    function attachAlbedo(kind, material, fallback) {
        let slot = textures.get(kind);
        if (!slot) {
            slot = {
                url: TEXTURE_URLS[kind],
                state: 'loading',
                texture: null,
                fallback,
                users: new Set(),
                maskUrl: '/project-map/city/textures/architecture/' + kind + '-windows.png',
                maskState: 'loading',
                mask: null
            };
            textures.set(kind, slot);
            const entry = slot;
            entry.texture = new Texture(entry.url, scene, {
                noMipmap: false,
                invertY: false,
                samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
                gammaSpace: true,
                onLoad: ()=>queueMicrotask(()=>{
                        if (scene.isDisposed || !entry.texture) return;
                        const size = entry.texture.getSize();
                        if (size.width > 1024 || size.height > 1024) {
                            entry.state = 'failed';
                            entry.failure = 'texture-exceeds-1024';
                            const rejected = entry.texture;
                            entry.texture = null;
                            releaseUnused([
                                rejected
                            ]);
                            return;
                        }
                        entry.state = 'ready';
                        updateTextureUsers(entry);
                        const old = entry.fallback;
                        entry.fallback = null;
                        if (old) releaseUnused([
                            old
                        ]);
                    }),
                onError: ()=>queueMicrotask(()=>{
                        if (scene.isDisposed) return;
                        entry.state = 'failed';
                        entry.failure = 'load-failed';
                        const rejected = entry.texture;
                        entry.texture = null;
                        if (rejected) releaseUnused([
                            rejected
                        ]);
                    })
            });
            entry.texture.name = 'architecture:' + kind;
            entry.texture.wrapU = Texture.WRAP_ADDRESSMODE;
            entry.texture.wrapV = Texture.WRAP_ADDRESSMODE;
            entry.texture.anisotropicFilteringLevel = 2;
            entry.mask = new Texture(entry.maskUrl, scene, {
                noMipmap: false,
                invertY: false,
                samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
                gammaSpace: true,
                onLoad: ()=>queueMicrotask(()=>{
                        if (scene.isDisposed || !entry.mask) return;
                        const size = entry.mask.getSize();
                        if (size.width > 256 || size.height > 256) {
                            entry.maskState = 'failed';
                            entry.maskFailure = 'mask-exceeds-256';
                            const rejected = entry.mask;
                            entry.mask = null;
                            releaseUnused([
                                rejected
                            ]);
                            return;
                        }
                        entry.maskState = 'ready';
                        updateTextureUsers(entry);
                    }),
                onError: ()=>queueMicrotask(()=>{
                        if (scene.isDisposed) return;
                        entry.maskState = 'failed';
                        entry.maskFailure = 'load-failed';
                        const rejected = entry.mask;
                        entry.mask = null;
                        if (rejected) releaseUnused([
                            rejected
                        ]);
                    })
            });
            entry.mask.name = 'architecture:' + kind + '-windows';
            entry.mask.wrapU = Texture.WRAP_ADDRESSMODE;
            entry.mask.wrapV = Texture.WRAP_ADDRESSMODE;
            entry.mask.anisotropicFilteringLevel = 2;
        } else if (!slot.fallback && slot.state !== 'ready' && fallback) {
            slot.fallback = fallback;
            for (const target of slot.users)target.albedoTexture = fallback;
        }
        slot.users.add(material);
        material.albedoTexture = slot.state === 'ready' ? slot.texture : slot.fallback;
        material.emissiveTexture = slot.state === 'ready' && slot.maskState === 'ready' ? slot.mask : null;
    }
    function updateTextureUsers(slot) {
        for (const target of slot.users){
            target.albedoTexture = slot.state === 'ready' ? slot.texture : slot.fallback;
            target.emissiveTexture = slot.state === 'ready' && slot.maskState === 'ready' ? slot.mask : null;
            const profile = materialProfiles.get(target);
            if (profile) applyNight(target, profile);
        }
    }
    function applyNight(material, profile) {
        const slot = profile.texture ? textures.get(profile.texture) : undefined;
        const aligned = Boolean(slot && slot.state === 'ready' && slot.maskState === 'ready' && material.albedoTexture === slot.texture && material.emissiveTexture === slot.mask);
        material.emissiveIntensity = aligned ? night ? 1.35 : mode === 'day' ? 0 : .45 : 0;
        material.emissiveColor = aligned ? new Color3(1, .94, .83) : Color3.Black();
        if (profile.lineEmission) {
            material.emissiveColor = new Color3(...profile.lineEmission);
            material.emissiveIntensity = mode === 'day' ? 0 : night ? 2.8 : 1.2;
        }
        const windows = tencentLights.get(material);
        if (windows) windows.mode = mode;
        material.environmentIntensity = profile.environment ?? .96;
    }
    function materialFor(source, id, hasUV) {
        const profile = PROFILES[id];
        const textured = Boolean(profile.texture && hasUV);
        const key = id + (profile.texture ? textured ? ':uv' : ':solid' : '');
        const cached = materials.get(key);
        if (cached) {
            if (textured && profile.texture) {
                const slot = textures.get(profile.texture);
                if (slot && slot.state !== 'ready' && !slot.fallback && source.albedoTexture) attachAlbedo(profile.texture, cached.material, source.albedoTexture);
            }
            return cached.material;
        }
        const material = cloneWithoutTextures(source, 'architecture:' + key);
        material.albedoColor = new Color3(...profile.color);
        material.metallic = profile.metallic;
        material.roughness = profile.roughness;
        const solidGlazing = /(?:glass|window)$/.test(id) || id === 'city-shopfront';
        if (solidGlazing) {
            material.albedoColor.scaleInPlace(.42);
            material.metallic = 0;
            material.roughness = Math.max(.14, Math.min(.23, profile.roughness * .55));
        }
        material.specularIntensity = 1;
        material.metallicReflectanceColor = Color3.White();
        material.enableSpecularAntiAliasing = true;
        material.indexOfRefraction = 1.5;
        material.metallicF0Factor = 1;
        material.alpha = 1;
        material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
        material.useAlphaFromAlbedoTexture = false;
        material.unlit = false;
        material.clearCoat.isEnabled = false;
        material.subSurface.isRefractionEnabled = false;
        material.subSurface.isTranslucencyEnabled = false;
        material.sheen.isEnabled = false;
        material.disableBumpMap = true;
        materialProfiles.set(material, profile);
        if (id === 'tencent-glass') tencentLights.set(material, new TencentWindowLighting(material));
        if (textured && profile.texture) {
            attachAlbedo(profile.texture, material, source.albedoTexture);
        }
        applyNight(material, profile);
        managed.add(material);
        materials.set(key, {
            material,
            profile,
            id
        });
        return material;
    }
    function applyMeshes(meshes, assetName) {
        if (scene.isDisposed) return;
        const kind = assetKind(assetName);
        if (!kind) return;
        const replaced = new Set();
        for (const mesh of meshes){
            if (mesh.isDisposed() || !mesh.getTotalVertices() || !(mesh.material instanceof PBRMaterial)) continue;
            if (managed.has(mesh.material)) continue;
            const source = mesh.material, role = sourceRole(source), id = profileFor(mesh, kind, role);
            if (!id) continue;
            const hasUV = mesh.isVerticesDataPresent(VertexBuffer.UVKind);
            mesh.material = materialFor(source, id, hasUV);
            if (id === 'tencent-glass' && mesh instanceof Mesh) attachTencentWindowData(mesh);
            if (mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.useVertexColors = true;
            if (!applied.has(mesh)) {
                applied.add(mesh);
                assignments++;
                if (PROFILES[id].texture && !hasUV) withoutUV++;
                if (kind === 'ordinary' && role in repairs) repairs[role]++;
            }
            replaced.add(source);
        }
        const oldTextures = new Set();
        for (const source of replaced){
            if (scene.meshes.some((mesh)=>mesh.material === source) || scene.multiMaterials.some((m)=>m.subMaterials.includes(source))) continue;
            for (const texture of source.getActiveTextures())oldTextures.add(texture);
            source.dispose(false, false);
            retiredMaterials++;
        }
        releaseUnused(oldTextures);
    }
    function setMode(value) {
        mode = value;
        night = value === 'night';
        for (const { material, profile } of materials.values())applyNight(material, profile);
    }
    function stats() {
        return {
            managedMaterials: materials.size,
            materialBudget: 31,
            assignments,
            night,
            withoutUV,
            landmarkLighting: {
                basis: 'user_requested_artistic',
                dayEmission: 0,
                tencentWindowMaterials: tencentLights.size,
                tencentWindowHDR: mode === 'day' ? 0 : night ? 1.5 : .55,
                bambooRibHDR: mode === 'day' ? 0 : night ? 2.8 : 1.2
            },
            repairedOrdinarySurfaces: {
                ...repairs
            },
            retiredMaterials,
            releasedTextures,
            profiles: [
                ...materials.keys()
            ],
            sharedAlbedoTextures: Object.keys(TEXTURE_URLS).map((kind)=>{
                const slot = textures.get(kind);
                return {
                    kind,
                    url: TEXTURE_URLS[kind],
                    state: slot?.state ?? 'not-requested',
                    size: slot?.state === 'ready' ? slot.texture?.getSize() : null,
                    fallback: Boolean(slot?.fallback),
                    failure: slot?.failure ?? null
                };
            }),
            sharedWindowMasks: Object.keys(TEXTURE_URLS).map((kind)=>{
                const slot = textures.get(kind);
                return {
                    kind,
                    url: '/project-map/city/textures/architecture/' + kind + '-windows.png',
                    state: slot?.maskState ?? 'not-requested',
                    size: slot?.maskState === 'ready' ? slot.mask?.getSize() : null,
                    failure: slot?.maskFailure ?? null
                };
            }),
            reusedEmissionMasks: 0,
            architectureEmission: 'aligned-window-masks'
        };
    }
    scene.onDisposeObservable.addOnce(()=>{
        materials.clear();
        textures.clear();
        tencentLights.clear();
    });
    return {
        applyMeshes,
        setMode,
        setNight: (night)=>setMode(night ? 'night' : 'sunset'),
        stats
    };
}
