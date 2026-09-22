'use strict';
/**
 * Scene script (chạy trong tiến trình scene, có `cc`): chụp 1 node thành PNG màu thật
 * bằng camera tạm + RenderTexture. Dùng cho thumbnail item 3D trong Item Order Editor.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CAPTURE_LAYER_BIT = 19;                 // layer tạm, không đụng layer game
const CAPTURE_LAYER = 1 << CAPTURE_LAYER_BIT;

function findByUuid(node, uuid) {
    if (node.uuid === uuid) return node;
    for (const c of node.children) {
        const f = findByUuid(c, uuid);
        if (f) return f;
    }
    return null;
}

function setLayer(node, layer, map) {
    map.set(node, node.layer);
    node.layer = layer;
    for (const c of node.children) setLayer(c, layer, map);
}

function restoreLayer(map) {
    for (const [n, l] of map) if (n.isValid) n.layer = l;
}

// ---- PNG encoder tối giản (RGBA 8-bit) ----
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, w, h, flipY) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        const srcY = flipY ? h - 1 - y : y;
        raw[y * (w * 4 + 1)] = 0;
        Buffer.from(rgba.buffer, rgba.byteOffset + srcY * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Bounding box world của mọi MeshRenderer trong node (min/max Vec3) */
function worldBounds(cc, node) {
    const { Vec3, MeshRenderer } = cc;
    const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
    const tmp = new Vec3();
    for (const r of node.getComponentsInChildren(MeshRenderer)) {
        const st = r.mesh && r.mesh.struct;
        if (!st || !st.minPosition || !st.maxPosition) continue;
        const lo = st.minPosition, hi = st.maxPosition, m = r.node.worldMatrix;
        for (let i = 0; i < 8; i++) {
            tmp.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
            Vec3.transformMat4(tmp, tmp, m);
            Vec3.min(min, min, tmp); Vec3.max(max, max, tmp);
        }
    }
    return isFinite(min.x) ? { min, max } : null;
}

exports.methods = {
    /**
     * Chụp node `uuid` (item) → PNG `size×size` tại outDir. Trả về { ok, file } hoặc { ok:false, error }.
     * Camera ortho nhìn theo hướng camera chính (WCam) nếu có, else -Z.
     */
    async captureNode(uuid, outDir, size) {
        const cc = require('cc');
        const { director, Node, Camera, RenderTexture, Vec3, Quat, Color, gfx, Layers } = cc;
        const scene = director.getScene();
        const node = scene && findByUuid(scene, uuid);
        if (!node) return { ok: false, error: 'node not found' };

        const wb = worldBounds(cc, node);
        if (!wb) return { ok: false, error: 'no mesh' };
        const center = Vec3.lerp(new Vec3(), wb.min, wb.max, 0.5);
        const ext = Vec3.subtract(new Vec3(), wb.max, wb.min);
        const radius = Math.max(ext.x, ext.y, ext.z) * 0.5 || 0.01;

        // hướng nhìn: copy camera chính (node tên WCam) để icon ra giống trong game
        let rot = new Quat();
        const wcam = scene.getComponentsInChildren(Camera).find(c => c.node.name === 'WCam');
        if (wcam) rot.set(wcam.node.worldRotation);

        const layerMap = new Map();
        setLayer(node, CAPTURE_LAYER, layerMap);

        const camNode = new Node('__capture_cam');
        camNode.setParent(scene);
        camNode.setWorldRotation(rot);
        const back = Vec3.transformQuat(new Vec3(), Vec3.FORWARD, rot);   // camera nhìn -Z local → forward = -Z
        camNode.setWorldPosition(Vec3.scaleAndAdd(new Vec3(), center, back, -radius * 10));

        const rt = new RenderTexture();
        rt.reset({ width: size, height: size });
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = radius * 1.15;
        cam.near = 0.01; cam.far = radius * 40;
        cam.visibility = CAPTURE_LAYER;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = new Color(0, 0, 0, 0);
        cam.priority = 9999;
        cam.targetTexture = rt;

        let file = '';
        try {
            // render 1 frame vào RT
            director.root.frameMove(0);
            cam.camera.update(true);
            director.root.pipeline.render([cam.camera]);
            const pixels = rt.readPixels();
            if (!pixels) throw new Error('readPixels null');
            fs.mkdirSync(outDir, { recursive: true });
            file = path.join(outDir, uuid + '.png');
            fs.writeFileSync(file, encodePng(pixels, size, size, true));
        } catch (e) {
            restoreLayer(layerMap);
            camNode.destroy();
            rt.destroy();
            return { ok: false, error: String(e && e.message || e) };
        }
        restoreLayer(layerMap);
        camNode.destroy();
        rt.destroy();
        return { ok: true, file };
    },
};
