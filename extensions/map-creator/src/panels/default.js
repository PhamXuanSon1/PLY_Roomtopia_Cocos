'use strict';

const fs = require('fs');
const path = require('path');

const PKG = 'map-creator';
const STATIC = path.join(__dirname, '..', '..', 'static');
const FIT_KEYS = ['anchorX', 'anchorY', 'padding', 'portraitScale', 'landscapeScale'];
const ITEM_KEYS = ['storeAfterItems', 'iconFill', 'spacing', 'edgePad'];

exports.template = fs.readFileSync(path.join(STATIC, 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(STATIC, 'style', 'default.css'), 'utf8');

exports.$ = {
    sceneName: '#sceneName', refresh: '#refresh', status: '#status',
    roomName: '#roomName', model: '#model', swap: '#swap', keepTransform: '#keepTransform',
    anchorX: '#anchorX', anchorY: '#anchorY', padding: '#padding', portraitScale: '#portraitScale',
    landscapeScale: '#landscapeScale', allowUpscale: '#allowUpscale', applyFit: '#applyFit', alignView: '#alignView',
    filter: '#filter', selAll: '#selAll', selNone: '#selNone', pickCount: '#pickCount', meshList: '#meshList',
    storeAfterItems: '#storeAfterItems', iconFill: '#iconFill', spacing: '#spacing', edgePad: '#edgePad',
    build: '#build', applyItems: '#applyItems',
    validate: '#validate', save: '#save', report: '#report',
};

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function call(method, ...args) {
    return Editor.Message.request(PKG, 'scene-call', method, ...args).catch((e) => ({ ok: false, error: String(e) }));
}

/** State của panel */
const state = {
    meshes: [],     // từ scene.getState
    order: [],      // uuid mesh đã chọn, theo thứ tự ô
};

exports.methods = {
    showStatus(message, level) {
        const el = this.$.status;
        el.classList.remove('hidden', 'error', 'ok');
        if (level) el.classList.add(level);
        el.textContent = message;
    },

    // ------------------------------------------------------------ load
    async loadModels() {
        const list = await Editor.Message.request(PKG, 'list-models').catch(() => []);
        this.$.model.innerHTML = list.map((m) => `<option value="${m.uuid}">${escapeHtml(m.url.replace('db://assets/', ''))}</option>`).join('');
    },

    async load() {
        const res = await call('getState');
        if (!res || !res.ok) {
            this.showStatus((res && res.error) || 'Không đọc được scene.', 'error');
            return;
        }
        this.$.sceneName.textContent = res.scene || '';
        this.$.roomName.textContent = `${res.room.name} › ${res.room.model || '(trống)'} — ${res.meshes.length} mesh, thanh có ${res.previewCount} item`;
        for (const k of FIT_KEYS) if (res.fit[k] !== undefined) this.$[k].value = res.fit[k];
        this.$.allowUpscale.checked = !!res.fit.allowUpscale;
        for (const k of ITEM_KEYS) if (res.items[k] !== undefined) this.$[k].value = res.items[k];
        state.meshes = res.meshes;
        state.order = res.order.filter((u) => res.meshes.some((m) => m.uuid === u));
        this.renderList();
    },

    // ------------------------------------------------------------ mesh list
    renderList() {
        const q = this.$.filter.value.trim().toLowerCase();
        const byUuid = new Map(state.meshes.map((m) => [m.uuid, m]));
        const picked = state.order.map((u) => byUuid.get(u)).filter(Boolean);
        const rest = state.meshes.filter((m) => !state.order.includes(m.uuid));
        const rows = picked.concat(rest).filter((m) => !q || m.name.toLowerCase().includes(q) || m.path.toLowerCase().includes(q));
        this.$.pickCount.textContent = String(state.order.length);
        this.$.meshList.innerHTML = rows.map((m) => {
            const idx = state.order.indexOf(m.uuid);
            const warn = [!m.bounds ? 'không bounds' : '', m.dup ? 'trùng tên' : '', !m.active ? 'đang ẩn' : ''].filter(Boolean).join(', ');
            return `<div class="mesh ${idx >= 0 ? 'picked' : ''}" data-uuid="${m.uuid}" title="${escapeHtml(m.path)}">
                <span class="idx">${idx >= 0 ? idx + 1 : ''}</span>
                <input type="checkbox" data-act="pick" ${idx >= 0 ? 'checked' : ''}>
                <span class="name">${escapeHtml(m.name)}</span>
                ${warn ? `<span class="warn">${warn}</span>` : ''}
                <span class="size">${m.w.toFixed(2)}×${m.h.toFixed(2)}</span>
                ${idx >= 0 ? '<button data-act="up">▲</button><button data-act="down">▼</button>' : ''}
            </div>`;
        }).join('');
    },

    onListClick(e) {
        const act = e.target && e.target.dataset && e.target.dataset.act;
        const row = e.target && e.target.closest && e.target.closest('.mesh');
        if (!act || !row) return;
        const uuid = row.dataset.uuid;
        const i = state.order.indexOf(uuid);
        if (act === 'pick') {
            if (e.target.checked && i < 0) state.order.push(uuid);
            if (!e.target.checked && i >= 0) state.order.splice(i, 1);
        } else if (act === 'up' && i > 0) {
            [state.order[i - 1], state.order[i]] = [state.order[i], state.order[i - 1]];
        } else if (act === 'down' && i >= 0 && i < state.order.length - 1) {
            [state.order[i + 1], state.order[i]] = [state.order[i], state.order[i + 1]];
        }
        this.renderList();
    },

    // ------------------------------------------------------------ actions
    async swap() {
        const uuid = this.$.model.value;
        if (!uuid) return;
        const label = this.$.model.selectedOptions[0] ? this.$.model.selectedOptions[0].textContent : uuid;
        const r = await Editor.Dialog.warn(`Thay model phòng bằng:\n${label}\n\nModel cũ và toàn bộ item trong thanh sẽ bị xoá (Ctrl+Z để hoàn tác, chưa Save thì có thể đóng scene không lưu).`, {
            buttons: ['Thay phòng', 'Huỷ'], default: 0, cancel: 1, title: 'Map Creator',
        });
        if (r && r.response !== 0) return;
        this.showStatus('Đang thay phòng...');
        const res = await call('swapRoom', uuid, this.$.keepTransform.checked);
        if (!res || !res.ok) return this.showStatus((res && res.error) || 'Thay phòng lỗi.', 'error');
        state.order = [];
        await this.load();
        this.showStatus(`Đã thay phòng: ${res.model} (${res.meshes} mesh). Chọn item ở bước 3 rồi Build items.`, 'ok');
    },

    async applyFit() {
        const v = {};
        for (const k of FIT_KEYS) if (this.$[k].value !== '') v[k] = Number(this.$[k].value);
        v.allowUpscale = this.$.allowUpscale.checked;
        const res = await call('setFit', v);
        this.showStatus(res && res.ok ? 'Đã áp dụng khung phòng.' : (res && res.error) || 'Lỗi', res && res.ok ? 'ok' : 'error');
    },

    itemValues() {
        const v = {};
        for (const k of ITEM_KEYS) if (this.$[k].value !== '') v[k] = Number(this.$[k].value);
        return v;
    },

    async applyItems() {
        const res = await call('setItems', this.itemValues());
        this.showStatus(res && res.ok ? 'Đã lưu thông số item.' : (res && res.error) || 'Lỗi', res && res.ok ? 'ok' : 'error');
    },

    async build() {
        if (!state.order.length) return this.showStatus('Chưa chọn mesh nào ở bước 3.', 'error');
        this.showStatus('Đang sinh item...');
        await call('setItems', this.itemValues());
        const res = await call('buildItems', state.order);
        if (!res || !res.ok) return this.showStatus((res && res.error) || 'Build lỗi.', 'error');
        await this.load();
        this.showStatus(`Đã sinh ${res.count} item vào thanh. Bấm Kiểm tra rồi Save.`, 'ok');
    },

    async validate() {
        const res = await call('validate');
        if (!res || !res.ok) return this.showStatus((res && res.error) || 'Kiểm tra lỗi.', 'error');
        const line = (cls, t) => `<div class="${cls}">${escapeHtml(t)}</div>`;
        const html = []
            .concat(res.errors.map((t) => line('e', '✖ ' + t)))
            .concat(res.warnings.map((t) => line('w', '⚠ ' + t)))
            .concat(res.info.map((t) => line('i', '• ' + t)));
        if (!res.errors.length && !res.warnings.length) html.unshift(line('good', '✔ Không có lỗi'));
        this.$.report.innerHTML = html.join('');
        this.showStatus(`Kiểm tra: ${res.errors.length} lỗi, ${res.warnings.length} cảnh báo.`, res.errors.length ? 'error' : 'ok');
    },

    async save() {
        const res = await Editor.Message.request(PKG, 'save-scene');
        this.showStatus(res && res.ok ? 'Đã lưu scene.' : (res && res.error) || 'Lưu lỗi.', res && res.ok ? 'ok' : 'error');
    },
};

exports.ready = async function () {
    const on = (el, fn) => el.addEventListener('click', fn.bind(this));
    on(this.$.refresh, async () => { await this.loadModels(); await this.load(); });
    on(this.$.swap, this.swap);
    on(this.$.applyFit, this.applyFit);
    on(this.$.alignView, async () => {
        const r = await call('alignView');
        if (!r || !r.ok) this.showStatus((r && r.error) || 'Lỗi', 'error');
    });
    on(this.$.selAll, () => { for (const m of state.meshes) if (!state.order.includes(m.uuid)) state.order.push(m.uuid); this.renderList(); });
    on(this.$.selNone, () => { state.order = []; this.renderList(); });
    this.$.filter.addEventListener('input', () => this.renderList());
    this.$.meshList.addEventListener('click', this.onListClick.bind(this));
    on(this.$.build, this.build);
    on(this.$.applyItems, this.applyItems);
    on(this.$.validate, this.validate);
    on(this.$.save, this.save);
    await this.loadModels();
    await this.load();
};

exports.close = function () {};
