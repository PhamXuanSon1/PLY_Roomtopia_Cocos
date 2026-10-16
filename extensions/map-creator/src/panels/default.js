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
    portrait: '#portrait', landscape: '#landscape', device: '#device', showHiddenItems: '#showHiddenItems',
    noPreview: '#noPreview', rethumb: '#rethumb', perColumn: '#perColumn', restList: '#restList', restCount: '#restCount',
};

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fileUrl(p) {
    return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '');
}

function call(method, ...args) {
    return Editor.Message.request(PKG, 'scene-call', method, ...args).catch((e) => ({ ok: false, error: String(e) }));
}

/** State của panel */
const state = {
    meshes: [],     // từ scene.getState
    order: [],      // uuid mesh đã chọn, theo thứ tự ô
    thumbs: {},     // uuid node → file png
    thumbGen: 0,    // lần chụp hiện tại (đổi phòng / reload → bỏ kết quả cũ)
    drag: null,     // uuid card đang kéo
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
        this.renderPreview(res.preview);
        this.renderList();
        this.loadThumbs(false);
    },

    renderPreview(p) {
        if (!p) return;
        this.$.portrait.classList.toggle('on', p.orientation === 0);
        this.$.landscape.classList.toggle('on', p.orientation === 1);
        this.$.device.value = String(p.device);
        this.$.showHiddenItems.checked = !!p.showHiddenItems;
        this.$.noPreview.classList.toggle('hidden', !!p.hasEditorPreview);
    },

    async setPreview(values) {
        const res = await call('setPreview', values);
        if (!res || !res.ok) return this.showStatus((res && res.error) || 'Lỗi', 'error');
        const st = await call('getState');
        if (st && st.ok) this.renderPreview(st.preview);
    },

    /** Ảnh mesh: chụp màu thật theo góc camera game (chạy nền, từng đợt) rồi gắn vào từng dòng */
    async loadThumbs(force) {
        const gen = ++state.thumbGen;
        const list = state.meshes.map((m) => ({ uuid: m.uuid, meshUuid: m.meshUuid }));
        for (let i = 0; i < list.length; i += 8) {
            const map = await Editor.Message.request(PKG, 'thumbs', list.slice(i, i + 8), force).catch(() => ({}));
            if (gen !== state.thumbGen) return;
            Object.assign(state.thumbs, map);
            for (const uuid of Object.keys(map)) {
                const img = this.boardEls(`.card[data-uuid="${CSS.escape(uuid)}"] img`)[0];
                if (img) img.src = fileUrl(map[uuid]) + (force ? '?t=' + Date.now() : '');
            }
        }
    },

    // ------------------------------------------------------------ mesh board (cột dọc, kéo thả)
    perColumn() {
        return Math.max(1, Math.floor(Number(this.$.perColumn.value) || 8));
    },

    cardHtml(m, idx) {
        const warn = [!m.bounds ? 'không bounds' : '', m.dup ? 'trùng tên' : '', !m.active ? 'đang ẩn' : ''].filter(Boolean).join(', ');
        const src = state.thumbs[m.uuid] ? `src="${fileUrl(state.thumbs[m.uuid])}"` : '';
        return `<div class="card ${idx >= 0 ? 'picked' : ''}" draggable="true" data-uuid="${m.uuid}"
                title="${escapeHtml(m.path)}&#10;Kích thước trên màn hình: ${m.w.toFixed(2)} × ${m.h.toFixed(2)} (world unit)&#10;Kéo thả để đổi thứ tự / chọn / bỏ chọn">
            <img class="thumb" ${src} alt="" draggable="false">
            <div class="meta">
                <div class="top">
                    ${idx >= 0 ? `<span class="idx">${idx + 1}</span>` : ''}
                    <input type="checkbox" data-act="pick" ${idx >= 0 ? 'checked' : ''} title="Tick = mesh này thành 1 item trong thanh">
                </div>
                <span class="name">${escapeHtml(m.name.replace(/^[A-Za-z]+_/, ''))}</span>
                <span class="size">${m.w.toFixed(1)}×${m.h.toFixed(1)}</span>
                ${warn ? `<span class="warn">${warn}</span>` : ''}
            </div>
        </div>`;
    },

    /** Cột dọc: cột 1 từ trên xuống, rồi cột 2... (= thứ tự ô trong thanh) */
    columnsHtml(list, picked, startIdx) {
        const per = this.perColumn();
        const cols = [];
        for (let i = 0; i < list.length; i += per) cols.push(list.slice(i, i + per));
        if (picked && !cols.length) cols.push([]);
        return cols.map((col, c) => `<div class="col" data-col="${c}">
            ${picked ? `<div class="colhead">Cột ${c + 1}</div>` : ''}
            ${col.map((m) => this.cardHtml(m, picked ? state.order.indexOf(m.uuid) : -1)).join('')}
        </div>`).join('');
    },

    renderList() {
        const q = this.$.filter.value.trim().toLowerCase();
        const match = (m) => !q || m.name.toLowerCase().includes(q) || m.path.toLowerCase().includes(q);
        const byUuid = new Map(state.meshes.map((m) => [m.uuid, m]));
        const picked = state.order.map((u) => byUuid.get(u)).filter(Boolean);
        const rest = state.meshes.filter((m) => !state.order.includes(m.uuid));
        this.$.pickCount.textContent = String(state.order.length);
        this.$.restCount.textContent = String(rest.length);
        this.$.meshList.innerHTML = this.columnsHtml(picked.filter(match), true);
        this.$.restList.innerHTML = this.columnsHtml(rest.filter(match), false)
            || '<div class="empty">Mọi mesh đều đã được chọn</div>';
    },

    /** Chèn `uuid` vào thứ tự tại vị trí `index` (bỏ chỗ cũ trước) */
    moveTo(uuid, index) {
        const from = state.order.indexOf(uuid);
        if (from >= 0) {
            state.order.splice(from, 1);
            if (from < index) index--;
        }
        state.order.splice(Math.max(0, Math.min(index, state.order.length)), 0, uuid);
    },

    /** Phần tử khớp selector trong 2 bảng (kể cả chính bảng) */
    boardEls(sel) {
        const out = [];
        for (const b of [this.$.meshList, this.$.restList]) {
            if (b.matches(sel)) out.push(b);
            out.push(...b.querySelectorAll(sel));
        }
        return out;
    },

    clearDropMarks() {
        for (const el of this.boardEls('.drop-before, .drop-after, .drop-target')) {
            el.classList.remove('drop-before', 'drop-after', 'drop-target');
        }
    },

    bindBoard() {
        const boards = [this.$.meshList, this.$.restList];
        for (const board of boards) {
            board.addEventListener('click', (e) => {
                if (!(e.target && e.target.dataset && e.target.dataset.act === 'pick')) return;
                const uuid = e.target.closest('.card').dataset.uuid;
                const i = state.order.indexOf(uuid);
                if (e.target.checked && i < 0) state.order.push(uuid);
                if (!e.target.checked && i >= 0) state.order.splice(i, 1);
                this.renderList();
            });
            board.addEventListener('dragstart', (e) => {
                const card = e.target.closest && e.target.closest('.card');
                if (!card) return;
                state.drag = card.dataset.uuid;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', state.drag);
            });
            board.addEventListener('dragend', () => {
                state.drag = null;
                this.clearDropMarks();
                for (const el of this.boardEls('.dragging')) el.classList.remove('dragging');
            });
            board.addEventListener('dragover', (e) => {
                if (!state.drag) return;
                e.preventDefault();
                this.clearDropMarks();
                const card = e.target.closest && e.target.closest('.card');
                if (board === this.$.meshList && card) {
                    const r = card.getBoundingClientRect();
                    card.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
                } else {
                    const col = e.target.closest && e.target.closest('.col');
                    (col && board === this.$.meshList ? col : board).classList.add('drop-target');
                }
            });
            board.addEventListener('drop', (e) => {
                if (!state.drag) return;
                e.preventDefault();
                const uuid = state.drag;
                if (board === this.$.restList) {
                    const i = state.order.indexOf(uuid);         // kéo xuống "Chưa chọn" = bỏ chọn
                    if (i >= 0) state.order.splice(i, 1);
                } else {
                    const card = e.target.closest && e.target.closest('.card');
                    const col = e.target.closest && e.target.closest('.col');
                    let index = state.order.length;
                    if (card && card.dataset.uuid !== uuid) {
                        const r = card.getBoundingClientRect();
                        index = state.order.indexOf(card.dataset.uuid) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
                    } else if (card) {
                        index = state.order.indexOf(uuid);
                    } else if (col) {
                        // thả vào chỗ trống của 1 cột → cuối cột đó
                        const cards = col.querySelectorAll('.card');
                        const last = cards[cards.length - 1];
                        index = last ? state.order.indexOf(last.dataset.uuid) + 1 : Number(col.dataset.col) * this.perColumn();
                    }
                    this.moveTo(uuid, index);
                }
                state.drag = null;
                this.renderList();
            });
        }
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
        state.thumbs = {};
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
        this.showStatus(res && res.ok ? 'Đã áp dụng thông số vào ItemManager (item giữ nguyên, chưa build lại).' : (res && res.error) || 'Lỗi', res && res.ok ? 'ok' : 'error');
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
    on(this.$.portrait, () => this.setPreview({ orientation: 0 }));
    on(this.$.landscape, () => this.setPreview({ orientation: 1 }));
    this.$.device.addEventListener('change', () => this.setPreview({ device: Number(this.$.device.value) }));
    this.$.showHiddenItems.addEventListener('change', () => this.setPreview({ showHiddenItems: this.$.showHiddenItems.checked }));
    on(this.$.rethumb, () => this.loadThumbs(true));
    on(this.$.alignView, async () => {
        const r = await call('alignView');
        if (!r || !r.ok) this.showStatus((r && r.error) || 'Lỗi', 'error');
    });
    on(this.$.selAll, () => { for (const m of state.meshes) if (!state.order.includes(m.uuid)) state.order.push(m.uuid); this.renderList(); });
    on(this.$.selNone, () => { state.order = []; this.renderList(); });
    this.$.filter.addEventListener('input', () => this.renderList());
    this.bindBoard();
    this.$.perColumn.addEventListener('change', () => this.renderList());
    on(this.$.build, this.build);
    on(this.$.applyItems, this.applyItems);
    on(this.$.validate, this.validate);
    on(this.$.save, this.save);
    await this.loadModels();
    await this.load();
};

exports.close = function () {};
