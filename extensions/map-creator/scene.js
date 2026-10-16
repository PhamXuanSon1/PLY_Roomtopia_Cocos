'use strict';
/**
 * Scene script của Map Creator (chạy trong tiến trình scene, có `cc`). Làm việc trên SCENE ĐANG MỞ.
 *
 * Phòng = GameManager.model (node gốc có ModelRotate + FitInBox). Mọi ref (GameManager.model, BoxBg.frame,
 * ZoomSlider.model, FitInBox.rotator) trỏ vào node gốc này → thay phòng chỉ thay node CON (model), giữ node gốc.
 * Model mới được cắt link prefab (như ItemManager.unlinkPrefab) để ref tới từng mesh (pickTargets, item.target)
 * lưu vào scene như node thường.
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

function unlinkPrefab(n) {
    n._prefab = null;
    for (const c of n.children) unlinkPrefab(c);
}

function setLayer(n, layer) {
    n.layer = layer;
    for (const c of n.children) setLayer(c, layer);
}

/** Đường dẫn node tính từ `root` (không gồm root) */
function relPath(node, root) {
    const parts = [];
    for (let n = node; n && n !== root; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
}

function roomRoot() {
    const gm = comp('GameManager');
    return gm && gm.model && gm.model.isValid ? gm.model : null;
}

/** WCam: camera vẽ map */
function wcam() {
    const box = comp('BoxBg');
    if (box && box.cam) return box.cam;
    const fit = comp('FitInBox');
    if (fit && fit.cam) return fit.cam;
    const s = scene();
    return s ? s.getComponentsInChildren(cc().Camera).find((c) => c.node.name === 'WCam') || null : null;
}

/** Màn đang xem trước (EditorPreview) hoặc design size */
function screenSize() {
    const ep = comp('EditorPreview');
    if (ep && ep._size && ep._size.width > 0) return ep._size;
    return cc().view.getVisibleSize();
}

/** Bbox mesh chiếu lên mặt phẳng camera: { w, h, cx, cy } (world unit). null = mesh không có bounds */
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
    return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
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

function loadAsset(uuid) {
    return new Promise((resolve, reject) => {
        cc().assetManager.loadAny({ uuid }, (err, asset) => (err ? reject(err) : resolve(asset)));
    });
}

const FIT_KEYS = ['anchorX', 'anchorY', 'padding', 'portraitScale', 'landscapeScale', 'allowUpscale'];
const ITEM_KEYS = ['storeAfterItems', 'iconFill', 'spacing', 'edgePad'];

exports.methods = {
    /** Trạng thái hiện tại cho panel */
    getState() {
        const root = roomRoot();
        if (!root) return { ok: false, error: 'Không tìm thấy GameManager.model (node gốc phòng) trong scene đang mở.' };
        const im = comp('ItemManager');
        const fit = comp('FitInBox');
        const cam = wcam();
        const picked = new Set(((im && im.pickTargets) || []).filter((n) => n && n.isValid).map((n) => n.uuid));
        const counts = {};
        const meshes = roomMeshes(root).map((n) => {
            counts[n.name] = (counts[n.name] || 0) + 1;
            const b = cam ? camPlaneBox(n, cam) : null;
            return { uuid: n.uuid, name: n.name, path: relPath(n, root), picked: picked.has(n.uuid), w: b ? b.w : 0, h: b ? b.h : 0, bounds: !!b, active: n.activeInHierarchy };
        });
        for (const m of meshes) m.dup = counts[m.name] > 1;
        // thứ tự ô: theo item trong thanh (Hierarchy của Content — có thể đã sắp tay / Item Order Editor), không có thì theo pickTargets
        const content = im && im.bar && im.bar.content;
        const ItemController = cc().js.getClassByName('ItemController');
        const barItems = content && ItemController ? content.getComponentsInChildren(ItemController)
            .sort((a, b) => a.node.getSiblingIndex() - b.node.getSiblingIndex()) : [];
        let order = barItems.map((it) => it.target).filter((n) => n && n.isValid && findByUuid(root, n.uuid)).map((n) => n.uuid);
        if (!order.length) order = ((im && im.pickTargets) || []).filter((n) => n && n.isValid).map((n) => n.uuid);
        for (const m of meshes) m.picked = order.includes(m.uuid);
        const fitVals = {};
        if (fit) for (const k of FIT_KEYS) fitVals[k] = fit[k];
        const itemVals = {};
        if (im) for (const k of ITEM_KEYS) itemVals[k] = im[k];
        return {
            ok: true,
            scene: scene().name,
            room: { uuid: root.uuid, name: root.name, model: root.children.map((c) => c.name).join(', ') },
            meshes,
            order,
            fit: fitVals,
            items: itemVals,
            previewCount: content ? content.children.length : 0,
        };
    },

    /**
     * Thay model phòng: prefab (FBX/glTF/prefab) → con của node gốc phòng, thay model cũ.
     * keepTransform: model mới nhận position/rotation/scale local của model cũ (cùng pipeline art thì thường khớp).
     * Item cũ trong thanh + pickTargets bị xoá (trỏ vào mesh cũ).
     */
    async swapRoom(prefabUuid, keepTransform) {
        const root = roomRoot();
        if (!root) return { ok: false, error: 'Không tìm thấy node gốc phòng (GameManager.model).' };
        let prefab;
        try {
            prefab = await loadAsset(prefabUuid);
        } catch (e) {
            return { ok: false, error: 'Không load được model: ' + e };
        }
        const { instantiate, Prefab } = cc();
        if (!(prefab instanceof Prefab)) return { ok: false, error: 'Asset không phải prefab/model.' };

        const old = root.children.slice();
        const ref = old[0] || null;
        const n = instantiate(prefab);
        unlinkPrefab(n);
        n.setParent(root, false);
        if (ref && keepTransform) {
            n.setPosition(ref.position);
            n.setRotation(ref.rotation);
            n.setScale(ref.scale);
        }
        setLayer(n, ref ? ref.layer : root.layer);
        for (const c of old) { c.removeFromParent(); c.destroy(); }   // tách ngay (destroy hoãn tới cuối frame) → collect / đếm mesh không lẫn model cũ

        // gameplay trỏ vào mesh cũ → dọn
        const im = comp('ItemManager');
        if (im) {
            im.pickTargets = [];
            im.clearPreview = true;            // setter: xoá item trong Content
        }
        const fit = comp('FitInBox');
        if (fit) {
            fit.collect();                     // gom lại mesh của phòng mới để fit
            fit._key = '';
        }
        const zs = comp('ZoomSlider');
        if (zs) zs._editorKey = '';
        return { ok: true, model: n.name, meshes: roomMeshes(root).length };
    },

    /** Gán thông số FitInBox (anchorX/Y, padding, portraitScale, landscapeScale, allowUpscale) */
    setFit(values) {
        const fit = comp('FitInBox');
        if (!fit) return { ok: false, error: 'Không có FitInBox.' };
        for (const k of FIT_KEYS) if (values && values[k] !== undefined) fit[k] = values[k];
        fit._key = '';
        return { ok: true };
    },

    /** Gán thông số ItemManager (storeAfterItems, iconFill, spacing, edgePad) */
    setItems(values) {
        const im = comp('ItemManager');
        if (!im) return { ok: false, error: 'Không có ItemManager.' };
        for (const k of ITEM_KEYS) if (values && values[k] !== undefined) im[k] = values[k];
        return { ok: true };
    },

    /** pickTargets = mesh theo đúng thứ tự `uuids`, rồi sinh item preview vào thanh (lưu vào scene) */
    buildItems(uuids) {
        const root = roomRoot();
        const im = comp('ItemManager');
        if (!root || !im) return { ok: false, error: 'Thiếu node gốc phòng hoặc ItemManager.' };
        const nodes = [];
        for (const u of uuids || []) {
            const n = findByUuid(root, u);
            if (n) nodes.push(n);
        }
        if (!nodes.length) return { ok: false, error: 'Chưa chọn mesh nào.' };
        im.pickTargets = nodes;
        im.previewItems = true;                // setter: xoá item cũ + sinh item mới theo pickTargets
        return { ok: true, count: nodes.length };
    },

    /** Kiểm tra map: { ok, errors[], warnings[], info[] } */
    validate() {
        const errors = [], warnings = [], info = [];
        const root = roomRoot();
        const im = comp('ItemManager');
        const fit = comp('FitInBox');
        const box = comp('BoxBg');
        const cam = wcam();
        if (!root) return { ok: true, errors: ['Không tìm thấy GameManager.model (node gốc phòng).'], warnings, info };
        if (!im) errors.push('Không có ItemManager trong scene.');
        if (!cam) errors.push('Không tìm thấy WCam.');
        const meshes = roomMeshes(root);
        if (!meshes.length) errors.push('Phòng không có MeshRenderer nào.');
        info.push('Phòng: ' + root.children.map((c) => c.name).join(', ') + ' — ' + meshes.length + ' mesh');

        const targets = ((im && im.pickTargets) || []);
        const valid = targets.filter((n) => n && n.isValid && findByUuid(root, n.uuid));
        if (targets.length !== valid.length) errors.push((targets.length - valid.length) + ' pickTargets trỏ vào mesh không còn trong phòng (bấm Build items lại).');
        const playing = valid.length ? valid : meshes;
        info.push('Item chơi: ' + playing.length + (valid.length ? ' (pickTargets)' : ' (pickTargets trống → mọi mesh)'));

        // item trong thanh
        const content = im && im.bar && im.bar.content;
        if (content) {
            const ItemController = cc().js.getClassByName('ItemController');
            const items = ItemController ? content.getComponentsInChildren(ItemController) : [];
            const bad = items.filter((it) => !it.target || !it.target.isValid || !findByUuid(root, it.target.uuid));
            if (bad.length) errors.push(bad.length + ' item trong thanh trỏ vào mesh cũ / không tồn tại: ' + bad.slice(0, 5).map((it) => it.node.name).join(', ') + (bad.length > 5 ? '…' : ''));
            if (!items.length) warnings.push('Thanh chưa có item preview (bấm Build items) — lúc chạy vẫn tự sinh, nhưng không xem trước được.');
            else if (items.length !== playing.length) warnings.push('Thanh có ' + items.length + ' item nhưng có ' + playing.length + ' mesh được chơi → Build items lại.');
        }
        if (im && im.storeAfterItems > playing.length) warnings.push('storeAfterItems = ' + im.storeAfterItems + ' lớn hơn số item (' + playing.length + ') → chỉ mở store khi win.');

        // tên trùng: build() tìm lại target theo "Item_<tên mesh>"
        const names = {};
        for (const n of playing) names[n.name] = (names[n.name] || 0) + 1;
        const dups = Object.keys(names).filter((k) => names[k] > 1);
        if (dups.length) warnings.push('Tên mesh trùng (nên đổi tên): ' + dups.slice(0, 8).join(', '));

        if (cam) {
            // mesh thiếu bounds → icon/snap đo sai
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
                // FBX bake toạ độ vào đỉnh → mọi pivot cùng 1 điểm: bình thường (ghost chồng khít target), requireNearest không phân biệt được
                info.push('Pivot của hầu hết target trùng nhau (FBX bake toạ độ vào đỉnh) — snap vẫn đúng, nhưng requireNearest không có tác dụng.');
            } else if (close.length) warnings.push(close.length + ' cặp target có pivot gần như trùng (dễ thả nhầm, pivot FBX bake vào đỉnh?): ' + close.slice(0, 6).join('; ') + (close.length > 6 ? '…' : ''));

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
