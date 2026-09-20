// Adapted from local GTA_SZ derivative: city-sunset-environment.ts; original SHA256 1a3420bb084a7ad787123df62e6cb3e388ddaf0d3b7b7cdde4aafb12f2fda692
const { HDRCubeTexture, RawCubeTexture, Engine, Texture } = globalThis.BABYLON;
const cachedDisplayFaces = new WeakMap();
export const CITY_SUNSET_SOURCE = {
    file: '/project-map/city/environment/belfast-sunset-4k.hdr',
    name: 'Belfast Sunset (Pure Sky) / Poly Haven',
    bytes: 17420114,
    cubeSize: 1024,
    rotationY: 2.80
};
const smooth = (lo, hi, value)=>{
    const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};
export function sunsetFireWeight(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    return smooth(-.48, .25, (.6 * x + .8 * z - .08 * y) / length);
}
export function gradeSunsetRadiance(data, face, size = Math.sqrt(data.length / 3)) {
    for(let i = 0; i < data.length; i += 3){
        const r = Math.max(0, data[i]), g = Math.max(0, data[i + 1]), b = Math.max(0, data[i + 2]);
        let hemisphere = 1, solarGlare = 1;
        if (face !== undefined) {
            const pixel = i / 3, u = pixel % size / size * 2 - 1, v = Math.floor(pixel / size) / size * 2 - 1;
            let x = 0, y = 0, z = 0;
            if (face === 0) {
                x = 1;
                y = -v;
                z = -u;
            } else if (face === 1) {
                x = -1;
                y = -v;
                z = u;
            } else if (face === 2) {
                x = u;
                y = 1;
                z = v;
            } else if (face === 3) {
                x = u;
                y = -1;
                z = -v;
            } else if (face === 4) {
                x = u;
                y = -v;
                z = 1;
            } else {
                x = -u;
                y = -v;
                z = -1;
            }
            const length = Math.hypot(x, y, z) || 1;
            hemisphere = sunsetFireWeight(x, y, z);
            solarGlare = 1 + 9 * Math.max(0, (.6 * x + .8 * z) / length) ** 18 * Math.exp(-Math.max(0, y / length) * 6);
        }
        const luminance = r * .2126 + g * .7152 + b * .0722;
        const cloud = smooth(.56, 1.03, r / (b + .0001));
        const lit = smooth(.50, 1.45, luminance / solarGlare);
        const fire = hemisphere * cloud * (.06 + .94 * lit), contrast = .70 + .68 * lit;
        data[i] = ((r * .28 + b * .11) * (1 - fire) + (r * 1.72 + g * .25) * fire) * contrast;
        data[i + 1] = ((g * .32 + b * .09) * (1 - fire) + (g * .58 + r * .10) * fire) * contrast;
        data[i + 2] = ((b * .72 + r * .15) * (1 - fire) + (b * .17 + r * .022) * fire) * contrast;
    }
    return data;
}
export function sunsetDisplayScale(peak) {
    const knee = 1.8;
    return peak <= knee ? 1 : (knee + 2.5 * (peak - knee) / (2.5 + peak - knee)) / peak;
}
export const SUNSET_DISPLAY_RANGE = 4.3;
export function encodeSunsetDisplayByte(value) {
    return Math.round(Math.pow(Math.max(0, Math.min(1, value)), 1 / 2.2) * 255);
}
export class ShenzhenSunsetEnvironment extends HDRCubeTexture {
    displayFaces = null;
    createDisplayTexture(scene) {
        const internal = this.getInternalTexture();
        const faces = this.displayFaces ?? (internal ? cachedDisplayFaces.get(internal) : null);
        if (!faces) throw Error('Sunset display faces are not ready');
        if (internal) cachedDisplayFaces.set(internal, faces);
        const texture = new RawCubeTexture(scene, faces, this.getSize().width, Engine.TEXTUREFORMAT_RGB, Engine.TEXTURETYPE_UNSIGNED_BYTE, false, false, Texture.BILINEAR_SAMPLINGMODE);
        texture.name = 'sunset-display-only';
        texture.gammaSpace = true;
        texture.level = SUNSET_DISPLAY_RANGE;
        texture.coordinatesMode = Texture.SKYBOX_MODE;
        texture.rotationY = this.rotationY;
        this.displayFaces = null;
        return texture;
    }
    async _getCubeMapTextureDataAsync(buffer, size, supersample) {
        const cube = await super._getCubeMapTextureDataAsync(buffer, size, supersample);
        this.displayFaces = [];
        for (const [index, face] of [
            'right',
            'left',
            'up',
            'down',
            'front',
            'back'
        ].entries()){
            const linear = gradeSunsetRadiance(cube[face], index, size), display = new Uint8Array(linear.length);
            for(let i = 0; i < linear.length; i += 3){
                const scale = sunsetDisplayScale(Math.max(linear[i], linear[i + 1], linear[i + 2])) / SUNSET_DISPLAY_RANGE;
                display[i] = encodeSunsetDisplayByte(linear[i] * scale);
                display[i + 1] = encodeSunsetDisplayByte(linear[i + 1] * scale);
                display[i + 2] = encodeSunsetDisplayByte(linear[i + 2] * scale);
            }
            this.displayFaces.push(display);
        }
        return cube;
    }
}
