'use strict';
/**
 * Editor entry point của Map Creator.
 *  - listModels : FBX / glTF / prefab trong assets (chọn làm phòng mới)
 *  - sceneCall  : gọi 1 method của scene.js (chạy trong tiến trình scene, có `cc`), xong thì snapshot
 *                 → editor có Undo + đánh dấu scene dirty
 *  - saveScene  : Ctrl+S
 */

const PKG = 'map-creator';
const MODEL_ROOT = 'db://assets';
/** method của scene.js chỉ đọc → không cần snapshot */
const READ_ONLY = new Set(['getState', 'validate', 'alignView']);

function log(message) {
    console.log('[' + PKG + '] ' + message);
}

/** Prefab dùng được của 1 asset: prefab → chính nó; FBX/glTF → sub-asset kiểu cc.Prefab */
function prefabOf(info) {
    if (!info) return null;
    if (info.type === 'cc.Prefab') return { uuid: info.uuid, name: info.name };
    for (const sub of Object.values(info.subAssets || {})) {
        if (sub && sub.type === 'cc.Prefab') return { uuid: sub.uuid, name: info.name };
    }
    return null;
}

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    /** Model có thể làm phòng: [{ uuid (prefab), name, url }] — bỏ prefab gameplay (Item, Bg, Tab...) */
    async listModels() {
        const patterns = ['**/*.fbx', '**/*.FBX', '**/*.gltf', '**/*.glb', '8.Models/**/*.prefab'];
        const out = [];
        const seen = new Set();
        for (const p of patterns) {
            const list = await Editor.Message.request('asset-db', 'query-assets', { pattern: MODEL_ROOT + '/' + p }).catch(() => []);
            for (const info of list || []) {
                const pf = prefabOf(info);
                if (!pf || seen.has(pf.uuid)) continue;
                seen.add(pf.uuid);
                out.push({ uuid: pf.uuid, name: pf.name, url: info.url });
            }
        }
        out.sort((a, b) => a.url.localeCompare(b.url));
        return out;
    },

    /** Gọi scene.js `method(...args)`; method sửa scene thì snapshot (Undo + dirty) */
    async sceneCall(method, ...args) {
        let res;
        try {
            res = await Editor.Message.request('scene', 'execute-scene-script', { name: PKG, method, args });
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
        if (!READ_ONLY.has(method) && res && res.ok !== false) {
            try {
                await Editor.Message.request('scene', 'snapshot');
            } catch (e) {
                /* editor cũ không có snapshot */
            }
            log(method + ' xong. Nhấn Save để lưu scene.');
        }
        return res;
    },

    /**
     * Thumbnail từng mesh: [{ uuid (node), meshUuid }] → { uuid: file png }.
     *  1. Ảnh màu thật, nhìn theo góc WCam: dùng scene script `captureNode` của extension item-order-editor
     *     (cache ở temp/map-creator/thumbs, có rồi thì không chụp lại; force = chụp lại hết)
     *  2. Lỗi / thiếu item-order-editor → ảnh xám editor tự sinh cho mesh sub-asset
     */
    async thumbs(list, force) {
        const fs = require('fs');
        const path = require('path');
        const outDir = path.join(Editor.Project.path, 'temp', PKG, 'thumbs');
        const result = {};
        for (const it of list || []) {
            const cached = path.join(outDir, it.uuid.replace(/[\\/:*?"<>|+]/g, '_') + '.png');
            if (!force && fs.existsSync(cached)) { result[it.uuid] = cached; continue; }
            try {
                // captureNode ghi <outDir>/<uuid>.png — uuid có thể chứa "/" → tạo trước thư mục con
                fs.mkdirSync(path.dirname(path.join(outDir, it.uuid + '.png')), { recursive: true });
                const r = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: 'item-order-editor', method: 'captureNode', args: [it.uuid, outDir, 128],
                });
                if (r && r.ok && r.file) {
                    if (r.file !== cached) fs.renameSync(r.file, cached);
                    result[it.uuid] = cached;
                    continue;
                }
            } catch (e) {
                /* item-order-editor chưa bật → ảnh xám */
            }
            const id = String(it.meshUuid || '');
            const gray = id && path.join(Editor.Project.path, 'temp', 'asset-db', 'assets', id.slice(0, 2), id, id + '.png');
            if (gray && fs.existsSync(gray)) result[it.uuid] = gray;
        }
        return result;
    },

    async saveScene() {
        try {
            await Editor.Message.request('scene', 'save-scene');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
