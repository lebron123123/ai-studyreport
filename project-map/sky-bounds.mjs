// Every sky-box corner must be inside the far plane at every camera rotation.
export function skyBoxSize(farPlane) {
    if (!Number.isFinite(farPlane) || farPlane <= 0) throw Error('Invalid camera far plane');
    return farPlane; // corner radius = sqrt(3)/2 * farPlane, leaving 13.4% margin.
}
