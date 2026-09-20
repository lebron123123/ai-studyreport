// Adapted from local GTA_SZ derivative: city-daylight.ts; original SHA256 a9e485ea98b1cd128e51d722fd6dc4e9e8414e469351c163feb349e434c13bd0
const { Matrix, Vector3 } = globalThis.BABYLON;
export const CITY_DAYLIGHT_SOURCE = {
    file: '/project-map/city/environment/rustig-blue-sky-4k.hdr',
    name: 'Poly Haven / Rustig Koppie (Pure Sky)',
    bytes: 15257521,
    cubeSize: 1024,
    rotationY: 1.85
};
const sourceSolarDirection = new Vector3(.504674, .473661, .721768).normalize();
export const CITY_DAYLIGHT_SUN_DIRECTION = Vector3.TransformNormal(sourceSolarDirection, Matrix.RotationY(-CITY_DAYLIGHT_SOURCE.rotationY)).normalize();
export const CITY_LIGHTING_LABELS = {
    sunset: '红霞日落',
    night: '月色夜景',
    day: '雨后晴昼'
};
export function nextCinematicLightingMode(mode) {
    return mode === 'sunset' ? 'night' : mode === 'night' ? 'day' : 'sunset';
}
