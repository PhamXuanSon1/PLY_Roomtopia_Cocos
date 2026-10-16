'use strict';
/**
 * Inspector chung: vẽ mọi thông số của component như Inspector mặc định (ui-prop type="dump" → sửa, undo, lưu như thường),
 * thêm 1 dòng mô tả (tooltip trong @property) ngay dưới mỗi thông số. Thông số có visible = false thì ẩn,
 * thông số cùng `group` được gom dưới 1 tiêu đề nhóm.
 */

/** Field nội bộ của component, không vẽ */
const SKIP = new Set(['uuid', 'name', 'enabled', 'enabledInHierarchy', 'node', '_name', '_objFlags', '__scriptAsset', '_enabled', '__prefab', '_id', '__editorExtras__']);

exports.template = `<div class="ply-desc"></div>`;
exports.style = `
.ply-desc { display: flex; flex-direction: column; }
.ply-group {
    margin: 8px 0 2px; padding: 2px 6px;
    font-size: 11px; font-weight: bold; color: var(--color-normal-contrast-emphasis, #ddd);
    border-left: 3px solid #3b82f6; background: rgba(59, 130, 246, 0.12);
}
.ply-item { display: flex; flex-direction: column; }
.ply-text {
    margin: -2px 0 4px; padding-left: 6px;
    font-size: 11px; line-height: 1.4; white-space: normal;
    color: var(--color-normal-contrast-weakest, #8a8a8a);
}
`;
exports.$ = { root: '.ply-desc' };

function groupName(p) {
    const g = p && p.group;
    if (!g) return '';
    return typeof g === 'string' ? g : (g.name || '');
}

exports.update = function (dump) {
    const value = (dump && dump.value) || {};
    const root = this.$.root;
    this._items = this._items || new Map();       // key → { wrap, prop, text }
    this._groups = this._groups || new Map();     // tên nhóm → header

    let lastGroup = '';
    let order = 0;
    const seen = new Set();
    for (const key of Object.keys(value)) {
        const p = value[key];
        if (SKIP.has(key) || !p || typeof p !== 'object' || !('value' in p) || p.visible === false) continue;
        seen.add(key);

        const g = groupName(p);
        if (g && g !== lastGroup) {
            let head = this._groups.get(g);
            if (!head) {
                head = document.createElement('div');
                head.className = 'ply-group';
                head.textContent = g;
                this._groups.set(g, head);
            }
            head.style.order = String(order++);
            if (head.parentNode !== root) root.appendChild(head);
        }
        lastGroup = g || lastGroup;

        let it = this._items.get(key);
        if (!it) {
            const wrap = document.createElement('div');
            wrap.className = 'ply-item';
            const prop = document.createElement('ui-prop');
            prop.setAttribute('type', 'dump');
            const text = document.createElement('div');
            text.className = 'ply-text';
            wrap.appendChild(prop);
            wrap.appendChild(text);
            it = { wrap, prop, text };
            this._items.set(key, it);
        }
        it.wrap.style.order = String(order++);
        it.wrap.style.display = '';
        if (it.wrap.parentNode !== root) root.appendChild(it.wrap);
        it.prop.render(p);
        const tip = typeof p.tooltip === 'string' ? p.tooltip.replace(/^i18n:/, '') : '';
        it.text.textContent = tip;
        it.text.style.display = tip ? '' : 'none';
    }
    // thông số đang ẩn (visible = false, vd sau khi tắt "Hiện thông số nâng cao")
    for (const [key, it] of this._items) if (!seen.has(key)) it.wrap.style.display = 'none';
    // nhóm không còn thông số nào hiện
    for (const [g, head] of this._groups) {
        const any = Object.keys(value).some((k) => seen.has(k) && groupName(value[k]) === g);
        head.style.display = any ? '' : 'none';
    }
};

exports.ready = function () {};
exports.close = function () {
    this._items = null;
    this._groups = null;
};
