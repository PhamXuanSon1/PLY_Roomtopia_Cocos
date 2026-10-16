'use strict';
/**
 * Scene script của Map Creator (chạy trong tiến trình scene, có `cc`). CHỈ ĐỌC / TÍNH TOÁN trên scene đang mở.
 *
 * Map = prefab Level (5.Prefabs/Levels/Level_<Tên>.prefab): node gốc phòng có ModelRotate + FitInBox + LevelConfig,
 * con là model (FBX đã cắt link). Scene chỉ chứa 1 instance của prefab đó — LevelConfig.current.
 * Mọi thao tác GHI (thông số, danh sách item, thay phòng, tạo level) do main.js làm qua Editor.Message
 * (set-property / create-node / apply-prefab) để có Undo và lưu được vào prefab.
 */

function cc() {
    return require('cc');
}

function scene() {
    return cc().director.getScene();
}

function comp(name) {
    const s = scene();
    return s ? s.getComponentInChildren(name) : null;
}

function findByUuid(node, uuid) {
    if (!node) return null;
    if (node.uuid === uuid) return node;
    for (const c of node.children) {
        const f = findByUuid(c, uuid);
        if (f) return f;
    }
    return null;
}

/** Đường dẫn node tính từ `root` (không gồm root) */
function relPath(node, root) {
    const parts = [];
    for (let n = node; n && n !== root; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
}

/** LevelConfig của map hiện tại (null = scene chưa có prefab Level) */
function level() {
    const L = cc().js.getClassByName('LevelConfig');
    const cur = L && L.current;
    return cur && cur.isValid ? cur : comp('LevelConfig');
}

function roomRoot() {
    const lv = level();
    return lv ? lv.node : null;
}

/** WCam: camera vẽ map */
function wcam() {
    const box = comp('BoxBg');
    if (box && box.cam) return box.cam;
    const s = scene();
    return s ? s.getComponentsInChildren(cc().Camera).find((c) => c.node.name === 'WCam') || null : null;
}

/** Màn đang xem trước (EditorPreview) hoặc design size */
function screenSize() {
    const ep = comp('EditorPreview');
    if (ep && ep._size && ep._size.width > 0) return ep._size;
    return cc().view.getVisibleSize();
}

/** Bbox mesh chiếu lên mặt phẳng camera: { w, h } (world unit). null = mesh không có bounds */
function camPlaneBox(node, cam) {
    const { MeshRenderer, Vec3 } = cc();
    const mr = node.getComponent(MeshRenderer);
    const st = mr && mr.mesh && mr.mesh.struct;
    if (!st || !st.minPosition || !st.maxPosition) return null;
    const right = Vec3.transformQuat(new Vec3(), Vec3.RIGHT, cam.node.worldRotation);
    const up = Vec3.transformQuat(new Vec3(), Vec3.UP, cam.node.worldRotation);
    const lo = st.minPosition, hi = st.maxPosition, p = new Vec3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
        Vec3.transformMat4(p, p, node.worldMatrix);
        const x = Vec3.dot(p, right), y = Vec3.dot(p, up);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { w: maxX - minX, h: maxY - minY };
}

/** Pivot của node chiếu lên mặt phẳng camera (judgeSnap so theo pivot) */
function camPlanePivot(node, cam) {
    const { Vec3 } = cc();
    const right = Vec3.transformQuat(new Vec3(), Vec3.RIGHT, cam.node.worldRotation);
    const up = Vec3.transformQuat(new Vec3(), Vec3.UP, cam.node.worldRotation);
    return { x: Vec3.dot(node.worldPosition, right), y: Vec3.dot(node.worldPosition, up) };
}

function roomMeshes(root) {
    const { MeshRenderer } = cc();
    return root ? root.getComponentsInChildren(MeshRenderer).map((r) => r.node) : [];
}

function vec(v) {
    return { x: v.x, y: v.y, z: v.z };
}

const FIT_KEYS = ['anchorX', 'anchorY', 'padding', 'portraitScale', 'landscapeScale', 'allowUpscale', 'landscapeUpscale', 'portraitFitCurrentRotation', 'rotationSamples', 'clipToBox'];
const ROTATE_KEYS = ['degPerPx', 'inertia', 'dragThresholdPx', 'rotatedDeg'];

exports.methods = {
    /** Trạng thái hiện tại cho panel */
    getState() {
        const lv = level();
        const root = roomRoot();
        if (!lv || !root) return { ok: false, error: 'Scene đang mở chưa có prefab Level (LevelConfig). Kéo 1 prefab trong 5.Prefabs/Levels vào UI/Scenes/Gameplay, hoặc dùng "Tạo level mới".' };
        const im = comp('ItemManager');
        const fit = root.getComponent('FitInBox');
        const cam = wcam();
        const counts = {};
        const meshes = roomMeshes(root).map((n) => {
            counts[n.name] = (counts[n.name] || 0) + 1;
            const b = cam ? camPlaneBox(n, cam) : null;
            const mr = n.getComponent(cc().MeshRenderer);
            const meshUuid = mr && mr.mesh ? mr.mesh._uuid : '';
            return { uuid: n.uuid, name: n.name, path: relPath(n, root), meshUuid, w: b ? b.w : 0, h: b ? b.h : 0, bounds: !!b, active: n.activeInHierarchy };
        });
        for (const m of meshes) m.dup = counts[m.name] > 1;
        const order = lv.items.map((it) => it.target).filter((n) => n && n.isValid && findByUuid(root, n.uuid)).map((n) => n.uuid);
        for (const m of meshes) m.picked = order.includes(m.uuid);
        const fitVals = {};
        if (fit) for (const k of ['anchorX', 'anchorY', 'padding', 'portraitScale', 'landscapeScale', 'allowUpscale']) fitVals[k] = fit[k];
        const itemVals = { storeAfterItems: lv.storeAfterItems, snapPx: lv.snapPx };
        if (im) for (const k of ['iconFill', 'spacing', 'edgePad']) itemVals[k] = im[k];
        const ep = comp('EditorPreview');
        const pf = root._prefab;
        return {
            ok: true,
            preview: {
                hasEditorPreview: !!ep,
                orientation: ep ? ep.orientation : 0,
                device: ep ? ep.device : 0,
                showHiddenItems: !!(im && im.showHiddenItems),
            },
            scene: scene().name,
            room: { uuid: root.uuid, name: root.name, model: root.children.map((c) => c.name).join(', '), prefabUuid: pf && pf.asset ? pf.asset._uuid : '' },
            meshes,
            order,
            fit: fitVals,
            items: itemVals,
            previewCount: im && im.bar && im.bar.content ? im.bar.content.children.length : 0,
            managers: { itemManager: im ? im.node.uuid : '' },
        };
    },

    /**
     * Thông tin level hiện tại để main.js dựng level mới / thay phòng: transform, thông số FitInBox / ModelRotate / LevelConfig,
     * danh sách ô (path tính từ model, tên mesh) để nối sang model mới.
     */
    levelInfo() {
        const lv = level();
        const root = roomRoot();
        const g = scene().getChildByName('UI') && scene().getChildByName('UI').getChildByName('Scenes');
        const gameplay = g && g.getChildByName('Gameplay');
        if (!lv || !root) return { ok: true, has: false, gameplay: gameplay ? gameplay.uuid : '' };
        const fit = root.getComponent('FitInBox');
        const mr = root.getComponent('ModelRotate');
        const model = (mr && mr.model && mr.model !== root) ? mr.model : root.children[0] || null;
        const fitVals = {}; if (fit) for (const k of FIT_KEYS) fitVals[k] = fit[k];
        const rotVals = {}; if (mr) for (const k of ROTATE_KEYS) rotVals[k] = mr[k];
        const pf = root._prefab;
        return {
            ok: true, has: true,
            gameplay: root.parent ? root.parent.uuid : (gameplay ? gameplay.uuid : ''),
            root: { uuid: root.uuid, name: root.name, pos: vec(root.position), euler: vec(root.eulerAngles), scale: vec(root.scale), prefabUuid: pf && pf.asset ? pf.asset._uuid : '' },
            model: model ? { uuid: model.uuid, name: model.name, pos: vec(model.position), euler: vec(model.eulerAngles), scale: vec(model.scale) } : null,
            fit: fitVals, rotate: rotVals,
            level: { storeAfterItems: lv.storeAfterItems, snapPx: lv.snapPx },
            items: lv.items.filter((it) => it.target && it.target.isValid).map((it) => ({ name: it.target.name, path: model ? relPath(it.target, model) : relPath(it.target, root) })),
        };
    },

    /** Mesh trong node `uuid` (model mới) → [{ uuid, name, path (tính từ node đó) }] */
    meshesUnder(uuid) {
        const n = findByUuid(scene(), uuid);
        if (!n) return [];
        return roomMeshes(n).map((m) => ({ uuid: m.uuid, name: m.name, path: relPath(m, n) }));
    },

    /**
     * Đồng bộ instance level với file prefab (sau apply-prefab editor dựng lại node con nhưng ref cũ
     * trong LevelConfig.items vẫn trỏ vào node đã huỷ → null). Revert = nạp lại đúng như asset vừa lưu.
     */
    async resyncLevel(uuid) {
        const P = globalThis.cce && globalThis.cce.Prefab;
        if (!P || !P.revertPrefab) return false;
        await P.revertPrefab(uuid);
        return true;
    },

    /** Đo lại scale icon của mọi ô theo cỡ ô / iconFill hiện tại (ItemManager.measureIcons) */
    measureIcons() {
        const im = comp('ItemManager');
        if (!im || !im.measureIcons) return { ok: false, error: 'ItemManager chưa có measureIcons (script cũ?).' };
        return Object.assign({ ok: true }, im.measureIcons());
    },

    /** Kiểm tra map: { ok, errors[], warnings[], info[] } */
    validate() {
        const errors = [], warnings = [], info = [];
        const lv = level();
        const root = roomRoot();
        const im = comp('ItemManager');
        const box = comp('BoxBg');
        const cam = wcam();
        if (!root) return { ok: true, errors: ['Scene chưa có prefab Level (LevelConfig).'], warnings, info };
        const levels = scene().getComponentsInChildren('LevelConfig');
        if (levels.length > 1) errors.push('Scene có ' + levels.length + ' level (' + levels.map((l) => l.node.name).join(', ') + ') — chỉ để 1.');
        if (!root._prefab) warnings.push('Level "' + root.name + '" chưa là prefab — dùng "Tạo level mới" hoặc tạo prefab trong 5.Prefabs/Levels để dùng lại.');
        if (!im) errors.push('Không có ItemManager trong scene.');
        if (!cam) errors.push('Không tìm thấy WCam.');
        const meshes = roomMeshes(root);
        if (!meshes.length) errors.push('Phòng không có MeshRenderer nào.');

        const mr = root.getComponent('ModelRotate');
        const fit = root.getComponent('FitInBox');
        if (!mr) errors.push('Node gốc level thiếu ModelRotate.');
        else if (!mr.model || !mr.model.isValid) warnings.push('ModelRotate.model đang trống (= xoay chính node gốc) — thường phải là node model con.');
        if (!fit) errors.push('Node gốc level thiếu FitInBox.');
        info.push('Level: ' + root.name + ' — model ' + root.children.map((c) => c.name).join(', ') + ' — ' + meshes.length + ' mesh');

        const items = lv.items;
        const bad = items.filter((it) => !it.target || !it.target.isValid || !findByUuid(root, it.target.uuid));
        if (bad.length) errors.push(bad.length + ' ô trong LevelConfig.items trỏ vào mesh không còn trong phòng (Build items lại).');
        const playing = lv.targets();
        info.push('Item chơi: ' + playing.length + (items.length ? ' (LevelConfig.items)' : ' (items trống → mọi mesh)'));
        const key = im && im.iconFitKey ? im.iconFitKey() : '';
        const noScale = items.filter((it) => !(it.iconScale > 0)).length;
        if (items.length && (lv.iconFitKey !== key || noScale)) warnings.push('Scale icon chưa đo cho cỡ ô / iconFill hiện tại (' + key + ', đã lưu: ' + (lv.iconFitKey || 'chưa') + ') → lúc chạy tự đo lại; bấm Build items để lưu sẵn.');
        if (lv.storeAfterItems > playing.length) warnings.push('storeAfterItems = ' + lv.storeAfterItems + ' lớn hơn số item (' + playing.length + ') → chỉ mở store khi win.');

        // tên trùng → item khó phân biệt
        const names = {};
        for (const n of playing) names[n.name] = (names[n.name] || 0) + 1;
        const dups = Object.keys(names).filter((k) => names[k] > 1);
        if (dups.length) warnings.push('Tên mesh trùng (nên đổi tên): ' + dups.slice(0, 8).join(', '));

        if (cam) {
            const noBounds = playing.filter((n) => !camPlaneBox(n, cam));
            if (noBounds.length) errors.push(noBounds.length + ' mesh không có bounds (icon / snap đo sai): ' + noBounds.slice(0, 5).map((n) => n.name).join(', '));

            // pivot trùng nhau: judgeSnap so theo pivot → không phân biệt được
            const size = screenSize();
            const worldW = 2 * cam.orthoHeight * size.width / size.height;
            const snapR = im ? im.snapPx / 393 * worldW : 0;
            const piv = playing.map((n) => ({ n, p: camPlanePivot(n, cam) }));
            const close = [];
            for (let i = 0; i < piv.length; i++) {
                for (let j = i + 1; j < piv.length; j++) {
                    const d = Math.hypot(piv[i].p.x - piv[j].p.x, piv[i].p.y - piv[j].p.y);
                    if (d < Math.max(0.05, snapR * 0.25)) close.push(piv[i].n.name + ' ↔ ' + piv[j].n.name);
                }
            }
            const pairs = piv.length * (piv.length - 1) / 2;
            if (close.length && close.length > pairs * 0.5) {
                info.push('Pivot của hầu hết target trùng nhau (FBX bake toạ độ vào đỉnh) — snap vẫn đúng, nhưng requireNearest không có tác dụng.');
            } else if (close.length) warnings.push(close.length + ' cặp target có pivot gần như trùng (dễ thả nhầm): ' + close.slice(0, 6).join('; ') + (close.length > 6 ? '…' : ''));

            // phòng lòi khỏi vùng chơi
            if (fit && box && fit.currentBounds) {
                const b = fit.currentBounds();
                const r = box.getCamRect(cam.orthoHeight, true, true);
                const pad = fit.padding || 0;
                if (b) {
                    const over = Math.max(r.left + pad - b.minX, b.maxX - (r.right - pad), r.bottom + pad - b.minY, b.maxY - (r.top - pad));
                    if (over > 0.05) warnings.push('Bounds phòng lòi khỏi vùng chơi ' + over.toFixed(2) + ' unit (giảm portraitScale / padding, hoặc mesh có phần thừa như sàn lớn).');
                }
            }
        }
        return { ok: true, errors, warnings, info };
    },

    /**
     * Chế độ xem trước trong editor (CHỈ editor, không lưu vào prefab Level):
     *  orientation 0 = dọc, 1 = ngang; device = PreviewDevice (0 Design, 1 9:16, 2 9:19.5, 3 3:4) — qua EditorPreview
     *  showHiddenItems = hiện MỌI item thẳng hàng dài (không cắt theo thanh)
     */
    async setPreview(values) {
        const v = values || {};
        if (v.orientation !== undefined || v.device !== undefined) {
            let ep = comp('EditorPreview');
            if (!ep) {
                const gm = comp('GameManager');
                const host = (gm && gm.node.parent) || scene();
                ep = host.addComponent('EditorPreview');
            }
            if (!ep) return { ok: false, error: 'Không thêm được EditorPreview (script chưa compile?).' };
            if (v.orientation !== undefined) ep.orientation = v.orientation;
            if (v.device !== undefined) ep.device = v.device;
        }
        const im = comp('ItemManager');
        if (im && v.showHiddenItems !== undefined) im.showHiddenItems = !!v.showHiddenItems;
        // editor đứng yên thì không chạy update → vẽ lại vài frame cho layout áp ngay
        const E = globalThis.cce && globalThis.cce.Engine;
        for (let i = 0; i < 6 && E && E.repaintInEditMode; i++) {
            E.repaintInEditMode();
            await new Promise((r) => setTimeout(r, 80));
        }
        return { ok: true };
    },

    /** Scene view: ortho + căn theo WCam (nhìn y như màn hình game) */
    alignView() {
        const cam = wcam();
        const C = globalThis.cce && globalThis.cce.Camera;
        if (!cam || !C) return { ok: false, error: 'Không tìm thấy WCam / camera editor.' };
        if (C.camera && C.camera.projection === 1) C.changeProjection();
        C.alignSceneViewToNode([cam.node.uuid]);
        return { ok: true };
    },
};
