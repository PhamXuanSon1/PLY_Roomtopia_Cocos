'use strict';
/**
 * Editor entry point của Map Creator.
 *  - listModels : FBX / glTF / prefab trong assets (chọn làm phòng mới)
 *  - sceneCall  : gọi 1 method của scene.js (chạy trong tiến trình scene, có `cc`), xong thì snapshot
 *                 → editor có Undo + đánh dấu scene dirty
 *  - levelCall  : thao tác GHI vào prefab Level (setFit / setItems / buildItems / createLevel / save) qua Editor.Message
 *                 (set-property, create-node, create-prefab, apply-prefab) → có Undo và lưu được vào prefab
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

// ================================================================ GHI vào prefab Level (qua Editor.Message → có Undo, Apply được)

const LEVEL_DIR = 'db://assets/5.Prefabs/Levels';

function M(message, ...args) {
    return Editor.Message.request('scene', message, ...args);
}

/** Gọi 1 method chỉ-đọc của scene.js */
function sceneRead(method, ...args) {
    return Editor.Message.request('scene', 'execute-scene-script', { name: PKG, method, args });
}

const dump = {
    num: (v) => ({ type: 'Number', value: Number(v) }),
    bool: (v) => ({ type: 'Boolean', value: !!v }),
    str: (v) => ({ type: 'String', value: String(v) }),
    node: (uuid) => ({ type: 'cc.Node', value: { uuid: uuid || '' } }),
    vec3: (v) => ({ type: 'cc.Vec3', value: { x: v.x, y: v.y, z: v.z } }),
};

/** Dump của 1 giá trị thường (số / bool / chuỗi) */
function plain(v) {
    return typeof v === 'boolean' ? dump.bool(v) : typeof v === 'number' ? dump.num(v) : dump.str(v);
}

/** Gán nhiều property của component `type` trên node `uuid`: values = { key: dump } */
async function setComp(uuid, type, values) {
    const d = await M('query-node', uuid);
    const i = d.__comps__.findIndex((c) => c.type === type);
    if (i < 0) throw new Error(`node ${uuid} không có ${type}`);
    for (const [key, dmp] of Object.entries(values)) {
        await M('set-property', { uuid, path: `__comps__.${i}.${key}`, dump: dmp });
    }
}

/** Ghi LevelConfig.items = rows [[uuidTarget, iconScale]] + iconFitKey */
async function writeItems(rootUuid, rows, key) {
    const d = await M('query-node', rootUuid);
    const i = d.__comps__.findIndex((c) => c.type === 'LevelConfig');
    if (i < 0) throw new Error('node gốc level không có LevelConfig');
    const items = d.__comps__[i].value.items;
    const els = rows.map(([uuid, scale]) => {
        const e = JSON.parse(JSON.stringify(items.elementTypeData));
        e.value.target.value = { uuid };
        e.value.iconScale.value = scale || 0;
        return e;
    });
    const full = JSON.parse(JSON.stringify(items));
    full.value = els;
    await M('set-property', { uuid: rootUuid, path: `__comps__.${i}.items`, dump: full });
    await M('set-property', { uuid: rootUuid, path: `__comps__.${i}.iconFitKey`, dump: dump.str(key || '') });
}

/** Lưu thay đổi của instance level vào file prefab (nếu node là prefab instance) */
async function applyLevel(rootUuid) {
    const d = await M('query-node', rootUuid);
    if (!d.__prefab__) return false;
    try { await M('apply-prefab', rootUuid); } catch (e) { log('apply-prefab lỗi: ' + e); return false; }
    try { await sceneRead('resyncLevel', rootUuid); } catch (e) { log('resync lỗi: ' + e); }   // ref trong instance trỏ lại node mới
    return true;
}

async function snapshot() {
    try { await M('snapshot'); } catch (e) { /* editor cũ */ }
}

async function currentLevel() {
    const info = await sceneRead('levelInfo');
    if (!info || !info.has) throw new Error('Scene chưa có prefab Level (LevelConfig).');
    return info;
}

const levelOps = {
    /** Thông số khung phòng → FitInBox của level, Apply vào prefab */
    async setFit(values) {
        const lv = await currentLevel();
        const v = {};
        for (const k of ['anchorX', 'anchorY', 'padding', 'portraitScale', 'landscapeScale', 'allowUpscale']) if (values && values[k] !== undefined) v[k] = plain(values[k]);
        await setComp(lv.root.uuid, 'FitInBox', v);
        const applied = await applyLevel(lv.root.uuid);
        return { ok: true, applied };
    },

    /** storeAfterItems / snapPx → LevelConfig (prefab); iconFill / spacing / edgePad → TrayLayout (scene) */
    async setItems(values) {
        const lv = await currentLevel();
        const st = await sceneRead('getState');
        const lvVals = {}, trayVals = {};
        for (const k of ['storeAfterItems', 'snapPx']) if (values && values[k] !== undefined) lvVals[k] = dump.num(values[k]);
        for (const k of ['iconFill', 'spacing', 'edgePad']) if (values && values[k] !== undefined) trayVals[k] = dump.num(values[k]);
        if (Object.keys(lvVals).length) await setComp(lv.root.uuid, 'LevelConfig', lvVals);
        if (Object.keys(trayVals).length && st.managers && st.managers.itemManager) await setComp(st.managers.itemManager, 'TrayLayout', trayVals);
        const applied = Object.keys(lvVals).length ? await applyLevel(lv.root.uuid) : false;
        return { ok: true, applied };
    },

    /** Danh sách ô theo thứ tự `order` (uuid mesh) → đo scale icon → ghi LevelConfig.items + iconFitKey → Apply */
    async buildItems(order) {
        const lv = await currentLevel();
        if (!order || !order.length) return { ok: false, error: 'Chưa chọn mesh nào.' };
        await writeItems(lv.root.uuid, order.map((u) => [u, 0]), '');
        const m = await sceneRead('measureIcons');
        if (!m || !m.ok) return { ok: false, error: (m && m.error) || 'Đo icon lỗi' };
        await writeItems(lv.root.uuid, m.items.map((it) => [it.uuid, it.scale]), m.key);
        const applied = await applyLevel(lv.root.uuid);
        return { ok: true, count: order.length, key: m.key, applied };
    },

    /**
     * Dựng level từ model (FBX / glTF / prefab):
     *  mode 'new'     → prefab mới 5.Prefabs/Levels/Level_<name>.prefab, thay level đang có trong scene
     *  mode 'replace' → THAY PHÒNG của level hiện tại: ghi đè chính prefab đó (giữ uuid), giữ thông số + nối lại các ô theo đường dẫn / tên mesh
     *  keepTransform  → node gốc + model nhận transform của level cũ
     */
    async createLevel(modelUuid, name, opts) {
        const o = opts || {};
        const info = await sceneRead('levelInfo');
        if (!info || !info.gameplay) return { ok: false, error: 'Không tìm thấy node UI/Scenes/Gameplay trong scene.' };
        const replace = o.mode === 'replace';
        if (replace && !info.has) return { ok: false, error: 'Scene chưa có level để thay phòng — dùng "Tạo level mới".' };

        let url = '';
        if (replace && info.root.prefabUuid) url = await Editor.Message.request('asset-db', 'query-url', info.root.prefabUuid);
        if (!url) {
            const safe = String(name || '').trim().replace(/[^\w\-]+/g, '_');
            if (!safe) return { ok: false, error: 'Nhập tên level (vd Kitchen).' };
            url = `${LEVEL_DIR}/Level_${safe}.prefab`;
            if (!replace && await Editor.Message.request('asset-db', 'query-asset-info', url)) return { ok: false, error: `${url} đã có — đặt tên khác.` };
        }
        if (!await Editor.Message.request('asset-db', 'query-asset-info', LEVEL_DIR)) await Editor.Message.request('asset-db', 'create-asset', LEVEL_DIR, null);
        const rootName = url.split('/').pop().replace(/\.prefab$/, '');

        // 1. node gốc + 3 component
        const root = await M('create-node', { parent: info.gameplay, name: rootName });
        if (info.has) {                                                    // cùng vị trí trong Hierarchy với level cũ
            const tree = await M('query-node-tree', info.gameplay);
            const at = tree.children.findIndex((c) => c.uuid === info.root.uuid);
            const idx = tree.children.findIndex((c) => c.uuid === root);
            if (at >= 0 && idx > at) await M('move-array-element', { uuid: info.gameplay, path: 'children', target: idx, offset: at - idx });
        }
        if (info.has && o.keepTransform !== false) {
            await M('set-property', { uuid: root, path: 'position', dump: dump.vec3(info.root.pos) });
            await M('set-property', { uuid: root, path: 'rotation', dump: dump.vec3(info.root.euler) });
            await M('set-property', { uuid: root, path: 'scale', dump: dump.vec3(info.root.scale) });
        }
        for (const c of ['ModelRotate', 'FitInBox', 'LevelConfig']) await M('create-component', { uuid: root, component: c });

        // 2. model: instance của model rồi cắt link (mesh thành node thường trong prefab Level)
        const model = await M('create-node', { parent: root, assetUuid: modelUuid });
        try { await M('unlink-prefab', model, true); } catch (e) { log('unlink-prefab: ' + e); }
        if (info.has && info.model && o.keepTransform !== false) {
            await M('set-property', { uuid: model, path: 'position', dump: dump.vec3(info.model.pos) });
            await M('set-property', { uuid: model, path: 'rotation', dump: dump.vec3(info.model.euler) });
            await M('set-property', { uuid: model, path: 'scale', dump: dump.vec3(info.model.scale) });
        }

        // 3. thông số copy từ level cũ
        const fitVals = { rotator: dump.node(root) };
        for (const [k, v] of Object.entries(info.fit || {})) fitVals[k] = plain(v);
        await setComp(root, 'FitInBox', fitVals);
        const rotVals = { model: dump.node(model) };
        for (const [k, v] of Object.entries(info.rotate || {})) rotVals[k] = plain(v);
        await setComp(root, 'ModelRotate', rotVals);
        if (info.has) await setComp(root, 'LevelConfig', { storeAfterItems: dump.num(info.level.storeAfterItems), snapPx: dump.num(info.level.snapPx) });

        // 4. thay phòng: nối các ô cũ sang mesh mới (cùng đường dẫn, không thì cùng tên duy nhất)
        const lost = [];
        let rows = [];
        if (replace) {
            const meshes = await sceneRead('meshesUnder', model);
            const byPath = new Map(meshes.map((m) => [m.path, m.uuid]));
            const nameCount = {};
            for (const m of meshes) nameCount[m.name] = (nameCount[m.name] || 0) + 1;
            const tail = (p) => p.split('/').slice(1).join('/');          // bỏ tầng gốc (FBX import có thể bọc thêm 1 node)
            const byTail = new Map(meshes.map((m) => [tail(m.path), m.uuid]));
            for (const it of info.items) {
                const u = byPath.get(it.path) || byTail.get(it.path) || byPath.get(tail(it.path))
                    || (nameCount[it.name] === 1 ? meshes.find((m) => m.name === it.name).uuid : '');
                if (u) rows.push(u); else lost.push(it.name);
            }
            if (rows.length) await writeItems(root, rows.map((u) => [u, 0]), '');
        }

        // 5. lưu thành prefab (ghi đè giữ uuid nếu thay phòng), bỏ level cũ khỏi scene
        await M('create-prefab', root, url);
        if (info.has) await M('remove-node', { uuid: info.root.uuid });
        await snapshot();

        // 6. đo + lưu scale icon cho các ô đã nối
        let built = null;
        if (rows.length) {
            const st = await sceneRead('getState');
            if (st && st.ok) built = await levelOps.buildItems(st.order);
        }
        return { ok: true, url, mapped: rows.length, lost, built };
    },

    /** Danh sách prefab Level có sẵn: [{ uuid, name, url }] */
    async listLevels() {
        const list = await Editor.Message.request('asset-db', 'query-assets', { pattern: LEVEL_DIR + '/*.prefab' }).catch(() => []);
        return { ok: true, levels: (list || []).map((a) => ({ uuid: a.uuid, name: a.name.replace(/\.prefab$/, ''), url: a.url })) };
    },

    /** ĐỔI MAP: thay instance level trong scene bằng prefab Level `prefabUuid` (giữ đúng vị trí trong Hierarchy) */
    async useLevel(prefabUuid) {
        const info = await sceneRead('levelInfo');
        if (!info || !info.gameplay) return { ok: false, error: 'Không tìm thấy node UI/Scenes/Gameplay trong scene.' };
        if (info.has && info.root.prefabUuid === prefabUuid) return { ok: true, same: true };
        const tree = await M('query-node-tree', info.gameplay);
        const at = info.has ? tree.children.findIndex((c) => c.uuid === info.root.uuid) : 0;
        if (info.has) await M('remove-node', { uuid: info.root.uuid });
        const n = await M('create-node', { parent: info.gameplay, assetUuid: prefabUuid, type: 'cc.Prefab' });   // type cc.Prefab = giữ link prefab
        const t2 = await M('query-node-tree', info.gameplay);
        const idx = t2.children.findIndex((c) => c.uuid === n);
        if (at >= 0 && idx > at) await M('move-array-element', { uuid: info.gameplay, path: 'children', target: idx, offset: at - idx });
        return { ok: true, node: n };
    },

    /** Apply level hiện tại vào prefab rồi lưu scene */
    async save() {
        let applied = false;
        try { const lv = await currentLevel(); applied = await applyLevel(lv.root.uuid); } catch (e) { /* không có level */ }
        await M('save-scene');
        return { ok: true, applied };
    },
};

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

    /** Thao tác ghi vào level: op = setFit | setItems | buildItems | createLevel | save */
    async levelCall(op, ...args) {
        const fn = levelOps[op];
        if (!fn) return { ok: false, error: 'Không có thao tác ' + op };
        try {
            const res = await fn(...args);
            await snapshot();
            log(op + ' xong.');
            return res;
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
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
