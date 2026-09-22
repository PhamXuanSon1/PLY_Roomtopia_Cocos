'use strict';
/**
 * Editor entry point: đọc cây node con của 1 node cha (tên, active, contentSize,
 * thumbnail sprite) và ghi lại thứ tự siblingIndex qua message `scene`
 * `move-array-element` (có undo, tự đánh dấu scene dirty).
 */

const PKG = 'item-order-editor';

function log(message) {
    console.log('[' + PKG + '] ' + message);
}

// ---------------------------------------------------------------- node dump helpers

function dumpValue(v) {
    return v && typeof v === 'object' && 'value' in v ? v.value : v;
}

function findComp(dump, type) {
    const comps = (dump && dump.__comps__) || [];
    return comps.find((c) => c && (c.type === type || c.__type__ === type)) || null;
}

function compProp(comp, key) {
    if (!comp) {
        return undefined;
    }
    const value = comp.value && typeof comp.value === 'object' ? comp.value : comp;
    return dumpValue(value[key]);
}

async function queryNode(uuid) {
    try {
        return await Editor.Message.request('scene', 'query-node', uuid);
    } catch (e) {
        return null;
    }
}

async function queryTree(uuid) {
    try {
        return await Editor.Message.request('scene', 'query-node-tree', uuid);
    } catch (e) {
        return null;
    }
}

/** Ảnh thumbnail (đường dẫn file trong library) của 1 spriteFrame uuid. */
async function thumbnailOf(spriteFrameUuid) {
    if (!spriteFrameUuid) {
        return '';
    }
    // spriteFrame là sub-asset "xxx@f9941" -> ảnh nằm ở asset cha "xxx"
    const texUuid = String(spriteFrameUuid).split('@')[0];
    for (const id of [spriteFrameUuid, texUuid]) {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', id).catch(() => null);
        if (!info) {
            continue;
        }
        const lib = info.library || {};
        const file = lib['.png'] || lib['.jpg'] || lib['.jpeg'] || lib['.webp'] || info.file;
        if (file && /\.(png|jpe?g|webp|bmp|gif)$/i.test(file)) {
            return file;
        }
    }
    return '';
}

/** Ảnh preview editor tự sinh cho mesh sub-asset: temp/asset-db/assets/xx/<uuid>/<uuid>.png */
function meshPreviewPath(meshUuid) {
    if (!meshUuid) {
        return '';
    }
    const fs = require('fs');
    const path = require('path');
    const id = String(meshUuid);
    const file = path.join(Editor.Project.path, 'temp', 'asset-db', 'assets', id.slice(0, 2), id, id + '.png');
    return fs.existsSync(file) ? file : '';
}

/** Tìm mesh uuid trên node hoặc node con (item 3D: Icon/IconMesh có MeshRenderer). Bỏ qua quad Cell/Shadow. */
async function findMesh(treeNode, depth) {
    const dump = await queryNode(treeNode.uuid);
    const mr = findComp(dump, 'cc.MeshRenderer');
    const mesh = compProp(mr, 'mesh');
    // mesh của FBX là sub-asset "xxx@yyyyy"; quad tạo runtime không có uuid → bỏ qua
    if (mesh && mesh.uuid && String(mesh.uuid).includes('@')) {
        return mesh.uuid;
    }
    if (depth <= 0) {
        return '';
    }
    for (const child of treeNode.children || []) {
        const found = await findMesh(child, depth - 1);
        if (found) {
            return found;
        }
    }
    return '';
}

/** Tìm spriteFrame uuid trên node hoặc node con (tối đa depth cấp). */
async function findSpriteFrame(treeNode, depth) {
    const dump = await queryNode(treeNode.uuid);
    const sprite = findComp(dump, 'cc.Sprite');
    const sf = compProp(sprite, 'spriteFrame');
    if (sf && sf.uuid) {
        return sf.uuid;
    }
    if (depth <= 0) {
        return '';
    }
    for (const child of treeNode.children || []) {
        const found = await findSpriteFrame(child, depth - 1);
        if (found) {
            return found;
        }
    }
    return '';
}

// ---------------------------------------------------------------- methods

exports.methods = {
    openPanel() {
        Editor.Panel.open(PKG);
    },

    /** Node đang chọn trong Hierarchy. */
    getSelectedNode() {
        let uuids = [];
        try {
            uuids = Editor.Selection.getSelected('node') || [];
        } catch (e) {
            uuids = [];
        }
        return { uuid: uuids[0] || '' };
    },

    /** Danh sách node con của parentUuid theo siblingIndex hiện tại. */
    async loadChildren(parentUuid) {
        if (!parentUuid) {
            return { ok: false, error: 'Chưa chọn node cha.' };
        }
        const tree = await queryTree(parentUuid);
        if (!tree) {
            return { ok: false, error: 'Không tìm thấy node ' + parentUuid + ' trong scene đang mở.' };
        }
        const items = [];
        for (const child of tree.children || []) {
            const dump = await queryNode(child.uuid);
            const ut = findComp(dump, 'cc.UITransform');
            const size = compProp(ut, 'contentSize') || {};
            const sfUuid = await findSpriteFrame(child, 2);
            let thumb = await thumbnailOf(sfUuid);
            if (!thumb) {
                thumb = meshPreviewPath(await findMesh(child, 3));      // item 3D (mesh clone trong Icon)
            }
            items.push({
                uuid: child.uuid,
                name: child.name.replace(/^Item_(Bathroom_)?/, ''),   // tên ngắn cho dễ đọc
                active: child.active !== false,
                width: Number(size.width) || 0,
                height: Number(size.height) || 0,
                thumb,
            });
        }
        return { ok: true, parent: { uuid: tree.uuid, name: tree.name }, items };
    },

    /**
     * Ghi thứ tự mới: `uuids` là danh sách uuid node con theo thứ tự mong muốn.
     * Dùng move-array-element từng bước để editor có undo + đánh dấu dirty.
     */
    async applyOrder(parentUuid, uuids) {
        const tree = await queryTree(parentUuid);
        if (!tree) {
            return { ok: false, error: 'Không tìm thấy node cha trong scene.' };
        }
        const current = (tree.children || []).map((c) => c.uuid);
        const wanted = uuids.filter((u) => current.includes(u));
        // Node có trong scene nhưng không có trong panel (mới thêm) -> giữ ở cuối
        for (const u of current) {
            if (!wanted.includes(u)) {
                wanted.push(u);
            }
        }

        let moves = 0;
        for (let target = 0; target < wanted.length; target++) {
            const from = current.indexOf(wanted[target]);
            if (from === target) {
                continue;
            }
            await Editor.Message.request('scene', 'move-array-element', {
                uuid: parentUuid,
                path: 'children',
                target: from,
                offset: target - from,
            });
            current.splice(from, 1);
            current.splice(target, 0, wanted[target]);
            moves++;
        }

        try {
            await Editor.Message.request('scene', 'snapshot');
        } catch (e) {
            /* editor cũ không có snapshot */
        }
        log('applied order for "' + tree.name + '": ' + moves + ' move(s). Nhấn Ctrl+S để lưu scene.');
        return { ok: true, moves, order: wanted };
    },
};

exports.load = function () {};
exports.unload = function () {};
