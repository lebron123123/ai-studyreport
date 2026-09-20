// Adapted from local GTA_SZ derivative: city-facade-stream.ts; original SHA256 ba71c74b9e4a4eb3d5560550ffc4a2167523fcf1fbd9d001635272bf7adfb5d1
const { ImportMeshAsync, Quaternion, PBRMaterial } = globalThis.BABYLON;
export class CityFacadeStream {
    scene;
    changed;
    applyArchitecture;
    tiles = [];
    resident = new Map();
    pending = false;
    focus = {
        x: 0,
        z: 0
    };
    visible = true;
    failed = new Set();
    loadDelay = 0;
    focusChangedAt = 0;
    pumpTimer = null;
    disposed = false;
    paused = false;
    pressureUntil = 0;
    setPaused(value) {
        this.paused = !!value;
        if (this.paused && this.pumpTimer !== null) {
            clearTimeout(this.pumpTimer);
            this.pumpTimer = null;
        }
        if (!this.paused && !this.disposed) this.queuePump();
    }
    constructor(scene, changed, applyArchitecture, upload=task=>task()){
        this.upload = upload;
        this.scene = scene;
        this.changed = changed;
        this.applyArchitecture = applyArchitecture;
        const unregister=upload.registerEvictor?.(()=>{
            for(const r of this.resident.values())for(const mesh of [...r.meshes].reverse())mesh.dispose(false,!this.applyArchitecture);
            this.resident.clear();this.pressureUntil=Date.now()+30000;
        });
        scene.onDisposeObservable.addOnce(()=>{
            unregister?.();
            this.disposed = true;
            if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
        });
    }
    async init(x, z) {
        const response = await fetch('/project-map/city/facade-tiles.json');
        if (!response.ok) throw Error('精细立面索引未能载入');
        this.tiles = (await response.json()).tiles;
        this.focus = {
            x,
            z
        };
        for (const t of this.near(700)) {
            if (this.paused || this.disposed) break;
            await this.load(t);
        }
    }
    near(radius) {
        return this.tiles.filter((t)=>Math.hypot(t.x - this.focus.x, t.z - this.focus.z) < radius).sort((a, b)=>Math.hypot(a.x - this.focus.x, a.z - this.focus.z) - Math.hypot(b.x - this.focus.x, b.z - this.focus.z));
    }
    noteFocusMotion() {
        this.focusChangedAt = performance.now();
    }
    async load(tile) {
 if(this.disposed || this.paused)return;
        await this.upload(async()=>{
        const result = await ImportMeshAsync('/project-map/city/facade-tiles/' + tile.id + '.glb', this.scene);
        if(!result)return;
        if(this.disposed || this.paused || this.upload.isActive?.()===false){for(const mesh of [...result.meshes].reverse())mesh.dispose(false,true);return;}
 result.meshes[0].rotationQuaternion = Quaternion.Identity();
        for (const mesh of result.meshes){
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            if (mesh.material instanceof PBRMaterial) {
                mesh.material.environmentIntensity = 1;
                mesh.material.forceIrradianceInFragment = true;
                mesh.material.maxSimultaneousLights = 8;
            }
            if (mesh.getTotalVertices()) mesh.freezeWorldMatrix();
        }
        this.applyArchitecture?.(result.meshes, 'facade-tiles/' + tile.id);
        this.resident.set(tile.id, {
            tile,
            meshes: result.meshes
        });
        },{label:'精细窗格',wanted:()=>!this.disposed&&!this.paused&&Date.now()>=this.pressureUntil&&Math.hypot(tile.x-this.focus.x,tile.z-this.focus.z)<1050});
    }
    update(x, z, visible = true, loadDelay = this.loadDelay) {
        if (this.disposed || this.paused) return;
        if (Math.hypot(x - this.focus.x, z - this.focus.z) > 1) this.focusChangedAt = performance.now();
        this.focus = {
            x,
            z
        };
        this.visible = visible;
        this.loadDelay = loadDelay;
        for (const [id, r] of this.resident){
            const distance = Math.hypot(r.tile.x - x, r.tile.z - z);
            if (distance > 1500) {
                for (const mesh of [
                    ...r.meshes
                ].reverse())mesh.dispose(false, !this.applyArchitecture);
                this.resident.delete(id);
            } else r.meshes[0].setEnabled(visible && distance < 700);
        }
        this.queuePump();
    }
    queuePump() {
        if (this.pumpTimer !== null) {
            clearTimeout(this.pumpTimer);
            this.pumpTimer = null;
        }
        if (this.disposed || this.paused || this.pending || !this.visible || Date.now()<this.pressureUntil) return;
        const remaining = this.loadDelay - (performance.now() - this.focusChangedAt);
        if (remaining > 0) this.pumpTimer = setTimeout(()=>{
            this.pumpTimer = null;
            this.queuePump();
        }, remaining);
        else this.pumpTimer=setTimeout(()=>{this.pumpTimer=null;void this.pump();},100);
    }
    async pump() {
        if (this.disposed || this.paused || this.pending) return;
        const tile = this.near(1050).find((t)=>!this.resident.has(t.id) && !this.failed.has(t.id));
        if (!tile) return;
        this.pending = true;
        try {
            await this.load(tile);
        } catch (error) {
            this.failed.add(tile.id);
            console.warn('精细立面稍后可刷新重试', tile.id, error);
        } finally{
            this.pending = false;
            this.update(this.focus.x, this.focus.z, this.visible);
            this.changed();
        }
    }
    get meshes() {
        return [
            ...this.resident.values()
        ].flatMap((r)=>r.meshes.filter((m)=>m.getTotalVertices() > 0 && m.isEnabled()));
    }
    get shadowMeshes() {
        return [
            ...this.resident.values()
        ].filter((r)=>Math.hypot(r.tile.x - this.focus.x, r.tile.z - this.focus.z) < 520).flatMap((r)=>r.meshes.filter((m)=>m.getTotalVertices() > 0 && m.isEnabled()));
    }
    get stats() {
        return {
            residentTiles: this.resident.size,
            visibleTiles: [
                ...this.resident.values()
            ].filter((r)=>r.meshes[0].isEnabled()).length,
            totalTiles: this.tiles.length,
            residentCompressedBytes: [
                ...this.resident.values()
            ].reduce((n, r)=>n + r.tile.bytes, 0),
            focus: {
                ...this.focus
            },
            loadDelayMs: this.loadDelay,
            pending: this.pending,
            failedTiles: [
                ...this.failed
            ]
        };
    }
}
