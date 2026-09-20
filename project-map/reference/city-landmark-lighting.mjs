// Adapted from local GTA_SZ derivative: city-landmark-lighting.ts; original SHA256 5597c45faa18c16891279217a2f520889167c98eb7b8f465c9da9481ac7d9f40
const { MaterialPluginBase, PBRMaterial, ShaderLanguage, Vector3 } = globalThis.BABYLON;
const WINDOW_ATTRIBUTE = 'tencentWindow';
const hash = (x, y)=>{
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
};
export function attachTencentWindowData(mesh) {
    if (mesh.isVerticesDataPresent(WINDOW_ATTRIBUTE)) return;
    const positions = mesh.getVerticesData('position'), indices = mesh.getIndices();
    if (!positions || !indices) return;
    const count = positions.length / 3, parent = Int32Array.from({
        length: count
    }, (_, i)=>i);
    const root = (i)=>{
        while(parent[i] !== i){
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    for(let i = 0; i < indices.length; i += 3){
        const a = root(indices[i]);
        parent[root(indices[i + 1])] = a;
        parent[root(indices[i + 2])] = a;
    }
    const groups = new Map(), world = mesh.computeWorldMatrix(true), points = [];
    for(let i = 0; i < count; i++){
        points.push(Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world));
        const id = root(i), group = groups.get(id);
        if (group) group.push(i);
        else groups.set(id, [
            i
        ]);
    }
    const data = new Float32Array(count * 4);
    let panes = 0;
    for (const vertices of groups.values()){
        if (vertices.length < 4 || vertices.length > 8) continue;
        const ys = vertices.map((i)=>points[i].y), bottom = Math.min(...ys), height = Math.max(...ys) - bottom;
        if (height < .7 || height > 4.5) continue;
        const base = vertices.filter((i)=>points[i].y < bottom + .04);
        if (base.length < 2) continue;
        const first = points[base[0]], second = points[base[1]], axis = second.subtract(first);
        axis.y = 0;
        const width = axis.length();
        if (width < .5 || width > 4) continue;
        axis.scaleInPlace(1 / width);
        const us = vertices.map((i)=>Vector3.Dot(points[i].subtract(first), axis)), minU = Math.min(...us), span = Math.max(...us) - minU;
        const centre = vertices.reduce((sum, i)=>sum.addInPlace(points[i]), Vector3.Zero()).scaleInPlace(1 / vertices.length);
        const seedX = Math.round(centre.x * .5), seedY = Math.round(centre.z * .5) + Math.round(centre.y * .7) * 31;
        const active = centre.y < 137 && hash(seedX, seedY) > .68 ? .90 + .20 * hash(seedX + 19, seedY + 83) : 0, warmth = hash(seedX + 41, seedY + 97);
        vertices.forEach((index, k)=>data.set([
                (us[k] - minU) / span,
                (points[index].y - bottom) / height,
                warmth,
                active
            ], index * 4));
        panes++;
    }
    mesh.setVerticesData(WINDOW_ATTRIBUTE, data, false, 4);
    mesh.metadata = {
        ...mesh.metadata,
        tencentLightPanes: panes
    };
}
export class TencentWindowLighting extends MaterialPluginBase {
    mode = 'sunset';
    constructor(material){
        super(material, 'TencentWindowLighting', 195, {
            TENCENT_WINDOW_LIGHTING: true
        }, true, true, true);
    }
    isCompatible(language) {
        return language === ShaderLanguage.GLSL;
    }
    getAttributes(attributes) {
        if (!attributes.includes(WINDOW_ATTRIBUTE)) attributes.push(WINDOW_ATTRIBUTE);
    }
    getUniforms() {
        return {
            ubo: [
                {
                    name: 'tencentWindowHDR',
                    size: 1,
                    type: 'float'
                }
            ],
            fragment: 'uniform float tencentWindowHDR;'
        };
    }
    bindForSubMesh(buffer) {
        buffer.updateFloat('tencentWindowHDR', this.mode === 'day' ? 0 : this.mode === 'night' ? 1.5 : .55);
    }
    getCustomCode(type) {
        if (type === 'vertex') return {
            CUSTOM_VERTEX_DEFINITIONS: 'attribute vec4 tencentWindow;\nvarying vec4 vTencentWindow;',
            CUSTOM_VERTEX_MAIN_END: 'vTencentWindow=tencentWindow;'
        };
        if (type !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: 'varying vec4 vTencentWindow;',
            CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
vec2 edge=min(vTencentWindow.xy,1.-vTencentWindow.xy);
float paneMask=smoothstep(.015,.055,edge.x)*smoothstep(.015,.055,edge.y);
vec3 roomColor=mix(vec3(.85,.92,1.),vec3(1.,.86,.66),vTencentWindow.z);
finalEmissive+=roomColor*tencentWindowHDR*vTencentWindow.w*paneMask;
`
        };
    }
}
