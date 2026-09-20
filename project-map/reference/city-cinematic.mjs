// Adapted from local GTA_SZ derivative: city-cinematic.ts; original SHA256 a027d56f11828a2fb0dcbf47088821fd576f9839b8502256279c3ea0b1777dd6
const { BackgroundMaterial, Color3, Color4, ColorCurves, HDRCubeTexture, ImageProcessingConfiguration, Texture, Vector3 } = globalThis.BABYLON;
import { ShenzhenSunsetEnvironment, CITY_SUNSET_SOURCE } from './city-sunset-environment.mjs';
import { createCityNightSky, CITY_MOON_DIRECTION } from './city-night-sky.mjs';
import { CITY_DAYLIGHT_SOURCE, CITY_DAYLIGHT_SUN_DIRECTION } from './city-daylight.mjs';
import { ShenzhenDaylightEnvironment } from './city-daylight-environment.mjs';
export const CINEMATIC_FINISH = {
    msaa: 4,
    fxaa: false,
    sharpen: false,
    sharpenEdge: .22,
    sharpenColor: 1,
    grain: 6.5,
    vignetteWeight: 1,
    vignetteStretch: 1,
    chromaticAberration: 1.8,
    aberrationRadial: .8
};
export const DAYLIGHT_FINISH = {
    grain: false,
    chromaticAberration: false,
    vignetteWeight: .25
};
export function applyModeFinish(pipeline, ip, mode) {
    const day = mode === 'day';
    pipeline.grainEnabled = day ? DAYLIGHT_FINISH.grain : true;
    pipeline.chromaticAberrationEnabled = day ? DAYLIGHT_FINISH.chromaticAberration : true;
    ip.vignetteWeight = day ? DAYLIGHT_FINISH.vignetteWeight : CINEMATIC_FINISH.vignetteWeight;
}
export const AERIAL_FINISH = {
    msaa: 1,
    fxaa: true
};
export function applyAntiAliasing(pipeline, aerial) {
    const { msaa, fxaa } = aerial ? AERIAL_FINISH : CINEMATIC_FINISH;
    if (pipeline.samples === msaa && pipeline.fxaaEnabled === fxaa) return false;
    const scene = pipeline.scene, blocked = scene.blockMaterialDirtyMechanism, automatic = pipeline.automaticBuild;
    scene._forceBlockMaterialDirtyMechanism(true);
    try {
        pipeline.automaticBuild = false;
        pipeline.samples = msaa;
        pipeline.fxaaEnabled = fxaa;
        pipeline.automaticBuild = automatic;
        pipeline.prepare();
    } finally{
        scene._forceBlockMaterialDirtyMechanism(blocked);
    }
    return true;
}
export const CINEMATIC_LOOK = {
    sunset: {
        sun: 1.4,
        sunColor: [
            1,
            .60,
            .33
        ],
        hemi: .12,
        hemiSky: [
            .55,
            .62,
            .95
        ],
        hemiGround: [
            .20,
            .16,
            .17
        ],
        environment: .40,
        fogDensity: .00011,
        fogColor: [
            .44,
            .27,
            .31
        ],
        exposure: 1.0,
        contrast: 1.09,
        bloomThreshold: 1.35,
        bloomWeight: .19,
        grade: {
            shadowsHue: 235,
            shadowsDensity: 28,
            highlightsHue: 32,
            highlightsDensity: 18,
            saturation: -6,
            shadowsSaturation: -4
        }
    },
    night: {
        sun: .30,
        sunColor: [
            .70,
            .79,
            1
        ],
        hemi: .08,
        hemiSky: [
            .42,
            .50,
            .82
        ],
        hemiGround: [
            .06,
            .06,
            .09
        ],
        environment: .55,
        fogDensity: .00010,
        fogColor: [
            .055,
            .05,
            .095
        ],
        exposure: .83,
        contrast: 1.09,
        bloomThreshold: 1.30,
        bloomWeight: .24,
        grade: {
            shadowsHue: 225,
            shadowsDensity: 30,
            highlightsHue: 45,
            highlightsDensity: 10,
            saturation: -10,
            shadowsSaturation: -8
        }
    },
    day: {
        sun: 3.0,
        sunColor: [
            1,
            .91,
            .78
        ],
        hemi: .28,
        hemiSky: [
            .74,
            .80,
            .94
        ],
        hemiGround: [
            .30,
            .27,
            .22
        ],
        environment: .78,
        fogDensity: .000045,
        fogColor: [
            .57,
            .70,
            .84
        ],
        exposure: 1.08,
        contrast: 1.10,
        bloomThreshold: 2.5,
        bloomWeight: .045,
        grade: {
            shadowsHue: 215,
            shadowsDensity: 5,
            highlightsHue: 42,
            highlightsDensity: 2,
            saturation: 3,
            shadowsSaturation: 0
        }
    }
};
export function applyCinematicFinish(pipeline, ip, balanced = false) {
    pipeline.fxaaEnabled = CINEMATIC_FINISH.fxaa;
    // Choose the budget before allocating targets, rather than briefly allocating 4x MSAA.
    pipeline.samples = balanced ? 1 : CINEMATIC_FINISH.msaa;
    pipeline.sharpenEnabled = CINEMATIC_FINISH.sharpen;
    pipeline.sharpen.edgeAmount = CINEMATIC_FINISH.sharpenEdge;
    pipeline.sharpen.colorAmount = CINEMATIC_FINISH.sharpenColor;
    pipeline.grainEnabled = true;
    pipeline.grain.intensity = CINEMATIC_FINISH.grain;
    pipeline.grain.animated = true;
    pipeline.chromaticAberrationEnabled = true;
    pipeline.chromaticAberration.aberrationAmount = CINEMATIC_FINISH.chromaticAberration;
    pipeline.chromaticAberration.radialIntensity = CINEMATIC_FINISH.aberrationRadial;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = CINEMATIC_FINISH.vignetteWeight;
    ip.vignetteStretch = CINEMATIC_FINISH.vignetteStretch;
    ip.vignetteColor = new Color4(.01, .01, .025, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = ip.colorCurves ?? new ColorCurves();
}
export const SSAO_SCENE_PASS = 'SSAOOriginalSceneColor';
export function syncPostChain(scene, pipeline, camera) {
    const manager = scene.postProcessRenderPipelineManager, passes = ()=>camera._postProcesses.filter((p)=>!!p);
    if (passes().findIndex((p)=>p.name === SSAO_SCENE_PASS) > 0) {
        manager.detachCamerasFromRenderPipeline(pipeline.name, camera);
        manager.attachCamerasToRenderPipeline(pipeline.name, camera);
    }
    return passes().map((p, i)=>{
        const samples = i === 0 ? pipeline.samples : 1;
        if (p.samples !== samples) p.samples = samples;
        return {
            name: p.name,
            samples: p.samples,
            width: p.width,
            height: p.height
        };
    });
}
export function applyCinematicGrade(ip, grade) {
    const curves = ip.colorCurves ?? (ip.colorCurves = new ColorCurves());
    curves.shadowsHue = grade.shadowsHue;
    curves.shadowsDensity = grade.shadowsDensity;
    curves.shadowsSaturation = grade.shadowsSaturation;
    curves.highlightsHue = grade.highlightsHue;
    curves.highlightsDensity = grade.highlightsDensity;
    curves.highlightsSaturation = 0;
    curves.midtonesHue = 0;
    curves.midtonesDensity = 0;
    curves.midtonesSaturation = 0;
    curves.globalHue = 0;
    curves.globalDensity = 0;
    curves.globalSaturation = grade.saturation;
    curves.globalExposure = 0;
}
export async function createCinematicLook(world, options = {}) {
    const { scene, sun, hemi, pipeline, camera } = world;
    // Desktop integration may cap radiance resolution without changing the author's grade.
    const balanced = options.balanced === true;
    const sunsetSize = balanced ? 512 : CITY_SUNSET_SOURCE.cubeSize;
    const daylightSize = balanced ? 512 : CITY_DAYLIGHT_SOURCE.cubeSize;
    const sky = scene.getMeshByName('atmosphere');
    const fallbackEnvironment = scene.environmentTexture;
    const fallbackMaterial = sky?.material ?? null;
    let textureLoaded;
    let textureFailed;
    const loaded = new Promise((resolve, reject)=>{
        textureLoaded = resolve;
        textureFailed = (message)=>reject(new Error(message ?? 'HDR environment load failed'));
    });
    const environment = new ShenzhenSunsetEnvironment(CITY_SUNSET_SOURCE.file, scene, sunsetSize, false, true, false, true, textureLoaded, textureFailed);
    let status = 'loading';
    let failure = null;
    let skyMaterial = null;
    let skyTexture = null;
    let night = false, mode = 'sunset', disposed = false;
    const sceneDisposal = scene.onDisposeObservable.addOnce(()=>{
        disposed = true;
    });
    const nightSky = createCityNightSky(scene);
    let daylightEnvironment = null, daylightSkyTexture = null, daylightMaterial = null;
    let daylightStatus = 'idle', daylightFailure = null;
    let daylightTimeout;
    let daylightLoaded = null;
    function loadDaylight() {
     if (daylightLoaded || disposed) return daylightLoaded;
     daylightStatus = 'loading';
     daylightLoaded = new Promise((resolve)=>{
        daylightTimeout = window.setTimeout(()=>{
            daylightStatus = 'failed';
            daylightFailure = 'Daylight HDR load timed out';
            resolve();
        }, 45000);
        daylightEnvironment = new ShenzhenDaylightEnvironment(CITY_DAYLIGHT_SOURCE.file, scene, daylightSize, false, true, false, true, ()=>{
            window.clearTimeout(daylightTimeout);
            if (!disposed && !scene.isDisposed) {
                daylightSkyTexture = daylightEnvironment.clone();
                daylightSkyTexture.name = 'daylight-visible-sky-shared-radiance';
                daylightSkyTexture.coordinatesMode = Texture.SKYBOX_MODE;
                daylightSkyTexture.rotationY = CITY_DAYLIGHT_SOURCE.rotationY;
                daylightMaterial.reflectionTexture = daylightSkyTexture;
                daylightStatus = 'ready';
                if (mode === 'day') setMode('day');
            }
            resolve();
        }, (message)=>{
            window.clearTimeout(daylightTimeout);
            daylightStatus = 'failed';
            daylightFailure = message ?? 'Daylight HDR could not load';
            resolve();
        });
    });
     daylightEnvironment.rotationY = CITY_DAYLIGHT_SOURCE.rotationY;
     return daylightLoaded;
    }
    daylightMaterial = new BackgroundMaterial('cinematic-blue-sky-white-clouds', scene);
    daylightMaterial.transparencyMode = BackgroundMaterial.MATERIAL_OPAQUE;
    daylightMaterial.backFaceCulling = false;
    daylightMaterial.disableDepthWrite = true;
    daylightMaterial.useRGBColor = false;
    daylightMaterial.enableNoise = true;
    daylightMaterial.reflectionBlur = 0;
    daylightMaterial.maxSimultaneousLights = 0;
    daylightMaterial.primaryColor.copyFromFloats(.76, .90, 1.03);
    let nightEnvironment = null, nightEnvironmentReady = false;
    let nightLoaded = null;
    function loadNight() {
     if (nightLoaded || disposed) return nightLoaded;
     nightLoaded = new Promise((resolve)=>{
        nightEnvironment = new HDRCubeTexture('/project-map/city/environment/rooftop-night-2k.hdr', scene, 512, false, true, false, true, ()=>{
            if (!disposed && !scene.isDisposed) {
                nightEnvironmentReady = true;
                if (night) scene.environmentTexture = nightEnvironment;
            }
            resolve();
        }, ()=>resolve());
     });
     nightEnvironment.rotationY = .65;
     return nightLoaded;
    }
    const timeout = window.setTimeout(()=>textureFailed('HDR environment load timed out'), 45000);
    const disposeObserver = scene.onDisposeObservable.addOnce(()=>textureFailed('Scene disposed'));
    try {
        await loaded;
        if (scene.isDisposed) throw new Error('Scene disposed');
        environment.rotationY = CITY_SUNSET_SOURCE.rotationY;
        scene.environmentTexture = environment;
        if (sky) {
            skyTexture = environment.createDisplayTexture(scene);
            skyMaterial = new BackgroundMaterial('cinematic-photographic-sky', scene);
            skyMaterial.transparencyMode = BackgroundMaterial.MATERIAL_OPAQUE;
            skyMaterial.reflectionTexture = skyTexture;
            skyMaterial.backFaceCulling = false;
            skyMaterial.disableDepthWrite = true;
            skyMaterial.useRGBColor = false;
            skyMaterial.enableNoise = true;
            skyMaterial.reflectionBlur = 0;
            skyMaterial.maxSimultaneousLights = 0;
            sky.material = skyMaterial;
            sky.applyFog = false;
            sky.receiveShadows = false;
        }
        status = 'ready';
    } catch (error) {
        status = 'failed';
        failure = error instanceof Error ? error.message : String(error);
        environment.dispose();
    } finally{
        window.clearTimeout(timeout);
        scene.onDisposeObservable.remove(disposeObserver);
    }
    // Only the selected sky is decoded/prefiltered. Loading three HDR cubes at
    // startup overlapped the streaming meshes and could reset integrated GPUs.
    if (disposed || scene.isDisposed) {
        environment.dispose();
        skyMaterial?.dispose(false, false);
        skyTexture?.dispose();
        nightSky.dispose();
        nightEnvironment?.dispose();
        daylightMaterial?.dispose(false, false);
        daylightSkyTexture?.dispose();
        daylightEnvironment?.dispose();
        throw Error('Scene disposed');
    }
    if (nightEnvironment) nightEnvironment.rotationY = .65;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.contrast = 1.09;
    applyCinematicFinish(pipeline, ip, balanced);
    if (balanced) { pipeline.samples = 1; pipeline.fxaaEnabled = true; }
    pipeline.bloomEnabled = true;
    pipeline.bloomScale = .5;
    syncPostChain(scene, pipeline, camera);
    function setMode(next) {
        if (disposed || scene.isDisposed) return;
        mode = next;
        night = next === 'night';
        const day = next === 'day';
        if (day && daylightStatus === 'idle') loadDaylight();
        if (night && !nightLoaded) loadNight();
        const look = CINEMATIC_LOOK[next];
        pipeline.bloomThreshold = look.bloomThreshold;
        pipeline.bloomWeight = look.bloomWeight;
        pipeline.bloomKernel = day ? 36 : 56;
        ip.exposure = look.exposure;
        ip.contrast = look.contrast;
        applyCinematicGrade(ip, look.grade);
        applyModeFinish(pipeline, ip, next);
        syncPostChain(scene, pipeline, camera);
        sun.direction.copyFrom(night ? CITY_MOON_DIRECTION.scale(-1) : day ? CITY_DAYLIGHT_SUN_DIRECTION.scale(-1) : new Vector3(.95, -.19, .31).normalize());
        sun.diffuse.copyFromFloats(...look.sunColor);
        sun.specular.copyFrom(day ? sun.diffuse : Color3.White());
        sun.intensity = look.sun;
        hemi.diffuse.copyFromFloats(...look.hemiSky);
        hemi.groundColor.copyFromFloats(...look.hemiGround);
        hemi.intensity = look.hemi;
        scene.environmentTexture = night ? nightEnvironmentReady ? nightEnvironment : nightSky.environment : day && daylightStatus === 'ready' ? daylightEnvironment : status === 'ready' ? environment : fallbackEnvironment;
        scene.environmentIntensity = look.environment;
        scene.fogDensity = look.fogDensity;
        scene.fogColor.copyFromFloats(...look.fogColor);
        if (skyMaterial) skyMaterial.primaryColor.copyFromFloats(.20, .20, .20);
        if (sky) {
            sky.material = night ? nightSky.material : day && daylightStatus === 'ready' ? daylightMaterial : skyMaterial ?? fallbackMaterial;
            // Never draw the default white cube while the HDR is loading/failed.
            sky.setEnabled(!!sky.material);
        }
    }
    function setNight(active) {
        setMode(active ? 'night' : 'sunset');
    }
    function tune(overrides) {
        Object.assign(CINEMATIC_LOOK[mode], overrides);
        setMode(mode);
        return CINEMATIC_LOOK[mode];
    }
    function finish(o) {
        if (o.msaa !== undefined) pipeline.samples = o.msaa;
        if (o.fxaa !== undefined) pipeline.fxaaEnabled = o.fxaa;
        if (o.sharpen !== undefined) pipeline.sharpenEnabled = o.sharpen;
        if (o.bloom !== undefined) pipeline.bloomEnabled = o.bloom;
        if (o.grain !== undefined) pipeline.grainEnabled = o.grain;
        if (o.chromaticAberration !== undefined) pipeline.chromaticAberrationEnabled = o.chromaticAberration;
        if (o.vignette !== undefined) ip.vignetteEnabled = o.vignette;
        if (o.vignetteWeight !== undefined) ip.vignetteWeight = o.vignetteWeight;
        if (o.vignetteStretch !== undefined) ip.vignetteStretch = o.vignetteStretch;
        if (o.colorCurves !== undefined) ip.colorCurvesEnabled = o.colorCurves;
        const manager = scene.postProcessRenderPipelineManager, ssao = manager.supportedPipelines.find((p)=>p.name === 'contact-shading');
        if (o.ssao !== undefined && ssao) {
            if (o.ssao) manager.attachCamerasToRenderPipeline('contact-shading', pipeline.cameras);
            else manager.detachCamerasFromRenderPipeline('contact-shading', pipeline.cameras);
        }
        if (o.gbuffer === false && scene.geometryBufferRenderer) scene.geometryBufferRenderer.renderList = [];
        const chain = syncPostChain(scene, pipeline, camera);
        return {
            samples: pipeline.samples,
            fxaa: pipeline.fxaaEnabled,
            sharpen: pipeline.sharpenEnabled,
            grain: pipeline.grainEnabled,
            vignette: ip.vignetteEnabled,
            colorCurves: ip.colorCurvesEnabled,
            chromaticAberration: pipeline.chromaticAberrationEnabled,
            bloom: pipeline.bloomEnabled,
            ssao: ssao ? ssao.cameras.length > 0 : null,
            chain
        };
    }
    setNight(false);
    return {
        setMode,
        async prepareMode(next) {
            if (next === 'day') await loadDaylight();
            if (next === 'night') await loadNight();
            if (!disposed) setMode(next);
        },
        setNight,
        tune,
        finish,
        get stats () {
            return {
                status,
                failure,
                mode,
                night,
                source: mode === 'day' ? CITY_DAYLIGHT_SOURCE.name : CITY_SUNSET_SOURCE.name,
                radianceGrade: mode === 'day' ? 'shared linear HDR; solar-only luminance shoulder 8→32 before irradiance and reflection filtering' : 'directional vermilion/amber fire hemisphere and dark indigo reverse; HDR for PBR, display-only highlight shoulder',
                nightSky: 'directional Milky Way, dense stars and moonlit cirrus with matching moonlight',
                nightReflections: nightEnvironmentReady ? 'Poly Haven / Rooftop Night / 512px HDR' : 'neutral fallback',
                daylight: {
                    status: daylightStatus,
                    failure: daylightFailure,
                    source: CITY_DAYLIGHT_SOURCE.name,
                    sourceBytes: CITY_DAYLIGHT_SOURCE.bytes,
                    cubeSize: daylightSize,
                    rotationY: CITY_DAYLIGHT_SOURCE.rotationY,
                    sunDirection: CITY_DAYLIGHT_SUN_DIRECTION.asArray(),
                    skyAndReflection: 'shared solar-balanced HDR cube; sharp level for sky; prefiltered levels for PBR',
                    solarHighlight: {
                        knee: 8,
                        ceiling: 32
                    },
                    sunColor: sun.diffuse.asArray(),
                    sunIntensity: sun.intensity,
                    skyFill: hemi.intensity,
                    carFill: world.carFill?.intensity ?? null,
                    fogDensity: scene.fogDensity
                },
                cubeSize: sunsetSize,
                sourceBytes: mode === 'day' ? CITY_DAYLIGHT_SOURCE.bytes : CITY_SUNSET_SOURCE.bytes,
                exposure: ip.exposure,
                look: CINEMATIC_LOOK[mode],
                finish: {
                    ...CINEMATIC_FINISH,
                    vignetteWeight: ip.vignetteWeight,
                    vignetteStretch: ip.vignetteStretch,
                    samples: pipeline.samples,
                    fxaa: pipeline.fxaaEnabled,
                    sharpen: pipeline.sharpenEnabled,
                    grain: pipeline.grainEnabled,
                    vignette: ip.vignetteEnabled,
                    colorCurves: ip.colorCurvesEnabled,
                    chromaticAberration: pipeline.chromaticAberrationEnabled
                },
                postChain: camera._postProcesses.filter((p)=>!!p).map((p)=>({
                        name: p.name,
                        samples: p.samples,
                        width: p.width,
                        height: p.height
                    })),
                lightBalance: {
                    sun: sun.intensity,
                    hemisphere: hemi.intensity,
                    environment: scene.environmentIntensity,
                    directToFill: +(sun.intensity / (hemi.intensity + scene.environmentIntensity * .5)).toFixed(2)
                },
                bloom: {
                    enabled: pipeline.bloomEnabled,
                    threshold: pipeline.bloomThreshold,
                    weight: pipeline.bloomWeight,
                    kernel: pipeline.bloomKernel,
                    scale: pipeline.bloomScale
                },
                environmentIntensity: scene.environmentIntensity
            };
        },
        dispose () {
            disposed = true;
            window.clearTimeout(daylightTimeout);
            scene.onDisposeObservable.remove(sceneDisposal);
            if (scene.environmentTexture === environment || scene.environmentTexture === nightSky.environment || scene.environmentTexture === nightEnvironment || scene.environmentTexture === daylightEnvironment) scene.environmentTexture = fallbackEnvironment;
            if (sky && (sky.material === skyMaterial || sky.material === nightSky.material || sky.material === daylightMaterial)) sky.material = fallbackMaterial;
            skyMaterial?.dispose(false, false);
            skyTexture?.dispose();
            nightSky.dispose();
            nightEnvironment?.dispose();
            daylightMaterial?.dispose(false, false);
            daylightSkyTexture?.dispose();
            daylightEnvironment?.dispose();
            if (status === 'ready') environment.dispose();
        }
    };
}
