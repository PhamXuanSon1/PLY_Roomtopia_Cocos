'use strict';

const fs = require('fs');
const path = require('path');

const PKG = 'item-order-editor';
const STATIC = path.join(__dirname, '..', '..', 'static');

exports.template = fs.readFileSync(path.join(STATIC, 'template', 'default.html'), 'utf8');
exports.style = fs.readFileSync(path.join(STATIC, 'style', 'default.css'), 'utf8');

exports.$ = {
    parentName: '#parentName',
    useSelected: '#useSelected',
    reload: '#reload',
    perColumn: '#perColumn',
    save: '#save',
    status: '#status',
    board: '#board',
};

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fileUrl(p) {
    return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '');
}

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PKG) || '{}');
    } catch (e) {
        return {};
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(PKG, JSON.stringify(prefs));
    } catch (e) {
        /* convenience only */
    }
}

/** State của panel (không bind vào this để tránh đụng hàm lifecycle). */
const state = {
    parent: null,       // { uuid, name }
    columns: [],        // Item[][]
    picked: null,       // { col, row } — ô đang chọn để swap
    drag: null,         // { col, row }
    dirty: false,
};

exports.methods = {
    // ------------------------------------------------------------ status

    showStatus(message, level) {
        this.$.status.classList.remove('hidden', 'error', 'ok');
        if (level) {
            this.$.status.classList.add(level);
        }
        this.$.status.textContent = message;
    },

    hideStatus() {
        this.$.status.classList.add('hidden');
    },

    // ------------------------------------------------------------ data

    perColumn() {
        return Math.max(1, Math.floor(Number(this.$.perColumn.value) || 7));
    },

    flatten() {
        return state.columns.reduce((all, col) => all.concat(col), []);
    },

    /** Chia danh sách phẳng thành các cột, mỗi cột perColumn ô. */
    splitColumns(items) {
        const n = this.perColumn();
        const cols = [];
        for (let i = 0; i < items.length; i += n) {
            cols.push(items.slice(i, i + n));
        }
        return cols;
    },

    async loadFromSelection() {
        const res = await Editor.Message.request(PKG, 'get-selected-node').catch(() => null);
        const uuid = res && res.uuid;
        if (!uuid) {
            this.showStatus('Hãy chọn node cha (vd: Items) trong Hierarchy trước.', 'error');
            return;
        }
        await this.load(uuid);
    },

    async load(uuid) {
        const target = uuid || (state.parent && state.parent.uuid);
        if (!target) {
            this.showStatus('Chưa có node cha. Chọn node trong Hierarchy rồi bấm "Load selected node".', 'error');
            return;
        }
        this.showStatus('Đang đọc node con...');
        const res = await Editor.Message.request(PKG, 'load-children', target).catch((e) => ({ ok: false, error: String(e) }));
        if (!res || !res.ok) {
            this.showStatus((res && res.error) || 'Không đọc được node.', 'error');
            return;
        }
        state.parent = res.parent;
        state.columns = this.splitColumns(res.items);
        state.picked = null;
        state.dirty = false;
        this.$.parentName.textContent = res.parent.name + '  (' + res.items.length + ' items)';
        savePrefs({ parentUuid: res.parent.uuid, perColumn: this.perColumn() });
        this.hideStatus();
        this.render();
    },

    async save() {
        if (!state.parent) {
            this.showStatus('Chưa load node cha.', 'error');
            return;
        }
        const uuids = this.flatten().map((it) => it.uuid);
        this.$.save.disabled = true;
        this.showStatus('Đang ghi thứ tự...');
        const res = await Editor.Message.request(PKG, 'apply-order', state.parent.uuid, uuids)
            .catch((e) => ({ ok: false, error: String(e) }));
        this.$.save.disabled = false;
        if (!res || !res.ok) {
            this.showStatus((res && res.error) || 'Ghi thất bại.', 'error');
            return;
        }
        state.dirty = false;
        this.showStatus('Đã sắp xếp lại ' + uuids.length + ' node (' + res.moves + ' lần di chuyển). Nhấn Ctrl+S trong editor để lưu scene.', 'ok');
        await this.load(state.parent.uuid);
    },

    // ------------------------------------------------------------ mutations

    markDirty() {
        state.dirty = true;
        this.render();
    },

    /** Lấy item ra khỏi vị trí (col,row) — trả về item. */
    take(pos) {
        return state.columns[pos.col].splice(pos.row, 1)[0];
    },

    /** Chèn item vào (col,row); tự tạo cột nếu col vượt quá. */
    put(pos, item) {
        while (state.columns.length <= pos.col) {
            state.columns.push([]);
        }
        const col = state.columns[pos.col];
        col.splice(Math.min(pos.row, col.length), 0, item);
    },

    /** Xoá cột rỗng, gộp lại theo perColumn để thứ tự phẳng luôn đúng. */
    normalize() {
        state.columns = this.splitColumns(this.flatten());
    },

    move(from, to) {
        if (from.col === to.col && from.row === to.row) {
            return;
        }
        const item = this.take(from);
        // Nếu cùng cột và kéo xuống dưới thì index đích lệch 1 sau khi take
        if (from.col === to.col && to.row > from.row) {
            to = { col: to.col, row: to.row - 1 };
        }
        this.put(to, item);
        this.normalize();
        state.picked = null;
        this.markDirty();
    },

    swap(a, b) {
        const ia = state.columns[a.col][a.row];
        state.columns[a.col][a.row] = state.columns[b.col][b.row];
        state.columns[b.col][b.row] = ia;
        state.picked = null;
        this.markDirty();
    },

    shiftInColumn(pos, delta) {
        const col = state.columns[pos.col];
        const to = pos.row + delta;
        if (to < 0 || to >= col.length) {
            return;
        }
        this.swap(pos, { col: pos.col, row: to });
    },

    shiftColumn(pos, delta) {
        const toCol = pos.col + delta;
        if (toCol < 0) {
            return;
        }
        if (toCol >= state.columns.length) {
            // sang cột mới bên phải -> thành phần tử cuối
            this.move(pos, { col: state.columns.length, row: 0 });
            return;
        }
        this.move(pos, { col: toCol, row: pos.row });
    },

    // ------------------------------------------------------------ render

    render() {
        const board = this.$.board;
        board.innerHTML = '';
        if (!state.parent) {
            board.innerHTML = '<div class="empty-board">Chọn node cha trong Hierarchy rồi bấm <b>Load selected node</b>.</div>';
            return;
        }
        if (!state.columns.length) {
            board.innerHTML = '<div class="empty-board">"' + escapeHtml(state.parent.name) + '" không có node con.</div>';
            return;
        }

        const perCol = this.perColumn();
        let flatIndex = 0;
        state.columns.forEach((items, c) => {
            const colEl = document.createElement('div');
            colEl.className = 'column';
            colEl.dataset.col = String(c);
            colEl.innerHTML = '<div class="column-head"><span>Column ' + (c + 1) + '</span>'
                + '<span class="count">' + items.length + ' / ' + perCol + '</span></div>';
            const cells = document.createElement('div');
            cells.className = 'cells';
            colEl.appendChild(cells);

            items.forEach((item, r) => {
                cells.appendChild(this.renderCell(item, { col: c, row: r }, flatIndex++, items.length));
            });

            // Thả vào khoảng trống cuối cột
            colEl.addEventListener('dragover', (e) => {
                if (!state.drag) {
                    return;
                }
                e.preventDefault();
                colEl.classList.add('drop-target');
            });
            colEl.addEventListener('dragleave', () => colEl.classList.remove('drop-target'));
            colEl.addEventListener('drop', (e) => {
                if (!state.drag) {
                    return;
                }
                e.preventDefault();
                colEl.classList.remove('drop-target');
                // Nếu thả trúng cell thì cell đã xử lý + stopPropagation
                this.move(state.drag, { col: c, row: items.length });
                state.drag = null;
            });

            board.appendChild(colEl);
        });

        this.$.save.disabled = false;
        this.$.save.textContent = state.dirty ? 'Save *' : 'Save';
    },

    renderCell(item, pos, flatIndex, colLen) {
        const el = document.createElement('div');
        el.className = 'cell';
        if (flatIndex === 0) {
            el.classList.add('first');
        }
        if (!item.active) {
            el.classList.add('inactive');
        }
        if (state.picked && state.picked.col === pos.col && state.picked.row === pos.row) {
            el.classList.add('picked');
        }
        el.draggable = true;
        el.title = item.name + '\n' + item.width + ' x ' + item.height + (item.active ? '' : '\n(inactive)');

        const thumb = item.thumb
            ? '<img class="thumb" src="' + escapeHtml(fileUrl(item.thumb)) + '" onerror="this.classList.add(\'empty\');this.removeAttribute(\'src\')">'
            : '<span class="thumb empty"></span>';

        el.innerHTML = '<span class="idx">' + (flatIndex + 1) + '</span>'
            + thumb
            + '<span class="name">' + escapeHtml(item.name) + '</span>'
            + '<span class="size">' + Math.round(item.width) + '×' + Math.round(item.height) + '</span>'
            + '<span class="btns">'
            + '<button data-act="up" title="Lên"' + (pos.row === 0 ? ' disabled' : '') + '>&#9650;</button>'
            + '<button data-act="down" title="Xuống"' + (pos.row >= colLen - 1 ? ' disabled' : '') + '>&#9660;</button>'
            + '<button data-act="left" title="Sang cột trái"' + (pos.col === 0 ? ' disabled' : '') + '>&#9666;</button>'
            + '<button data-act="right" title="Sang cột phải">&#9656;</button>'
            + '</span>';

        // ---- click: chọn 2 ô để swap
        el.addEventListener('click', (e) => {
            if (e.target.closest('button')) {
                return;
            }
            if (!state.picked) {
                state.picked = pos;
                this.render();
                return;
            }
            if (state.picked.col === pos.col && state.picked.row === pos.row) {
                state.picked = null;
                this.render();
                return;
            }
            this.swap(state.picked, pos);
        });

        // ---- buttons
        el.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                switch (btn.dataset.act) {
                    case 'up': this.shiftInColumn(pos, -1); break;
                    case 'down': this.shiftInColumn(pos, 1); break;
                    case 'left': this.shiftColumn(pos, -1); break;
                    case 'right': this.shiftColumn(pos, 1); break;
                }
            });
        });

        // ---- drag & drop
        el.addEventListener('dragstart', (e) => {
            state.drag = pos;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.uuid);
        });
        el.addEventListener('dragend', () => {
            state.drag = null;
            el.classList.remove('dragging');
            this.$.board.querySelectorAll('.drop-before, .drop-after, .drop-target')
                .forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-target'));
        });
        el.addEventListener('dragover', (e) => {
            if (!state.drag) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const rect = el.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            el.classList.toggle('drop-before', !after);
            el.classList.toggle('drop-after', after);
        });
        el.addEventListener('dragleave', () => {
            el.classList.remove('drop-before', 'drop-after');
        });
        el.addEventListener('drop', (e) => {
            if (!state.drag) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const rect = el.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            const from = state.drag;
            state.drag = null;
            this.move(from, { col: pos.col, row: pos.row + (after ? 1 : 0) });
        });

        return el;
    },
};

exports.ready = async function () {
    const prefs = loadPrefs();
    if (prefs.perColumn) {
        this.$.perColumn.value = prefs.perColumn;
    }

    this.$.useSelected.addEventListener('confirm', this.loadFromSelection.bind(this));
    this.$.reload.addEventListener('confirm', () => this.load());
    this.$.save.addEventListener('confirm', this.save.bind(this));
    this.$.perColumn.addEventListener('change', () => {
        savePrefs({ parentUuid: state.parent && state.parent.uuid, perColumn: this.perColumn() });
        if (state.parent) {
            this.normalize();
            this.render();
        }
    });

    this.render();
    if (prefs.parentUuid) {
        // Scene khác có thể không có node này -> load() sẽ báo lỗi nhẹ, không sao
        await this.load(prefs.parentUuid);
    }
};

exports.beforeClose = async function () {};
exports.close = function () {};
