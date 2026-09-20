// Adapted from local GTA_SZ derivative: city-daylight-environment.ts; original SHA256 11741f021692c37258dcb47bbbf44ccf62b047a6d5cec15e9f2e554f71a9fc5f
const { HDRCubeTexture } = globalThis.BABYLON;
export function daylightHighlightLuminance(luminance) {
    const excess = Math.max(0, luminance - 8);
    return luminance <= 8 ? luminance : 8 + 24 * excess / (24 + excess);
}
export function gradeDaylightRadiance(data) {
    for(let i = 0; i < data.length; i += 3){
        const r = Math.max(0, data[i]), g = Math.max(0, data[i + 1]), b = Math.max(0, data[i + 2]);
        const luminance = .2126 * r + .7152 * g + .0722 * b;
        if (luminance <= 8) continue;
        const t = Math.min(1, (luminance - 8) / 16), warm = t * t * (3 - 2 * t);
        const green = g * (1 - .06 * warm), blue = b * (1 - .16 * warm);
        const scale = daylightHighlightLuminance(luminance) / (.2126 * r + .7152 * green + .0722 * blue);
        data[i] = r * scale;
        data[i + 1] = green * scale;
        data[i + 2] = blue * scale;
    }
    return data;
}
export class ShenzhenDaylightEnvironment extends HDRCubeTexture {
    async _getCubeMapTextureDataAsync(buffer, size, supersample) {
        const cube = await super._getCubeMapTextureDataAsync(buffer, size, supersample);
        for (const face of [
            'right',
            'left',
            'up',
            'down',
            'front',
            'back'
        ])gradeDaylightRadiance(cube[face]);
        return cube;
    }
}
