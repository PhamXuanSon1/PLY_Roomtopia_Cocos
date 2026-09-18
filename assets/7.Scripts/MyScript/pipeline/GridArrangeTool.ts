/**
 * GridArrangeTool — xếp các node con thành LƯỚI (ngang x dọc) không chèn lên nhau.
 *
 * Cách dùng: gắn vào 1 node bất kỳ -> kéo node cha (vd: Items) vào `parentNode`
 * -> đặt `columns` / `rows` (vd 7 x 7) -> tick `arrange` -> Ctrl+S.
 *
 * Kích thước mỗi node lấy từ UITransform.contentSize (gộp cả UITransform ở node
 * cháu, nhân scale) nên node to/nhỏ khác nhau vẫn không đè lên nhau:
 *   - Chiều rộng mỗi CỘT = node rộng nhất trong cột đó.
 *   - Chiều cao mỗi HÀNG = node cao nhất trong hàng đó.
 * Thứ tự xếp theo siblingIndex hiện tại (trái -> phải, trên -> xuống).
 */

import { _decorator, Component, Node, UITransform, Vec3, Rect } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('GridArrangeTool')
@executeInEditMode(true)
@menu('Pipeline/GridArrangeTool')
export class GridArrangeTool extends Component {

    // ⚠ Không đặt tên `parent` (trùng setter của Node) — xem SortItemsBySizeTool.
    @property({ type: Node, tooltip: 'Node cha chứa các item cần xếp. BẮT BUỘC.' })
    parentNode: Node | null = null;

    @property({ tooltip: 'Số cột (chiều NGANG). Vd 7.' })
    columns = 7;

    @property({ tooltip: 'Số hàng (chiều DỌC). 0 = tự tính theo số node. '
        + 'Nếu node nhiều hơn cột*hàng thì vẫn xếp tiếp xuống dưới kèm cảnh báo.' })
    rows = 7;

    @property({ tooltip: 'Khoảng cách giữa 2 cột (px).' })
    spacingX = 20;

    @property({ tooltip: 'Khoảng cách giữa 2 hàng (px).' })
    spacingY = 20;

    @property({ tooltip: 'Vị trí lưới (toạ độ local trong parentNode). Là góc TRÁI-TRÊN, hoặc TÂM nếu bật centerGrid.' })
    startPos = new Vec3(0, 0, 0);

    @property({ tooltip: 'Bật: startPos là TÂM của lưới. Tắt: startPos là góc trái-trên.' })
    centerGrid = true;

    @property({ tooltip: 'Bỏ qua node đang inactive.' })
    skipInactive = false;

    // ---- Nút bấm trong Inspector ----

    @property({ tooltip: 'Tick để XẾP lưới.' })
    get arrange(): boolean { return false; }
    set arrange(v: boolean) { if (v) this.doArrange(); }

    @property({ tooltip: 'Tick để IN kích thước từng node + kích thước lưới dự kiến (không sửa gì).' })
    get preview(): boolean { return false; }
    set preview(v: boolean) { if (v) this.doPreview(); }

    // ======================================================== Methods

    doPreview(): void {
        const children = this.resolveChildren();
        if (!children) return;

        const layout = this.computeLayout(children);
        console.log(`[GridArrange] ${children.length} node -> lưới ${layout.cols} x ${layout.rowCount}`
            + ` (tổng ${layout.totalW.toFixed(0)} x ${layout.totalH.toFixed(0)} px):`);
        children.forEach((node, i) => {
            const r = layout.rects[i];
            console.log(`   ${i}. "${node.name}" -> ${r.width.toFixed(1)} x ${r.height.toFixed(1)}`
                + `  [hàng ${Math.floor(i / layout.cols)}, cột ${i % layout.cols}]`);
        });
    }

    doArrange(): void {
        const children = this.resolveChildren();
        if (!children) return;

        const layout = this.computeLayout(children);
        const { cols, colW, rowH, rects } = layout;

        // Gốc trái-trên của lưới
        let originX = this.startPos.x;
        let originY = this.startPos.y;
        if (this.centerGrid) {
            originX -= layout.totalW / 2;
            originY += layout.totalH / 2;
        }

        // Toạ độ mép trái của từng cột / mép trên của từng hàng (tích luỹ)
        const colX: number[] = [];
        let x = originX;
        for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + this.spacingX; }

        const rowY: number[] = [];
        let y = originY;
        for (let r = 0; r < rowH.length; r++) { rowY.push(y); y -= rowH[r] + this.spacingY; }

        children.forEach((node, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            const box = rects[i];

            // Căn giữa node trong ô của nó.
            // box.x / box.y là offset mép trái / mép dưới so với gốc node (đã nhân scale),
            // nên position = mép mong muốn - offset đó.
            const cellLeft = colX[c] + (colW[c] - box.width) / 2;
            const cellBottom = rowY[r] - rowH[r] + (rowH[r] - box.height) / 2;

            const pos = node.position.clone();
            pos.x = cellLeft - box.x;
            pos.y = cellBottom - box.y;
            node.setPosition(pos);
        });

        console.log(`[GridArrange] DONE! Đã xếp ${children.length} node thành lưới `
            + `${cols} x ${rowH.length} (tổng ${layout.totalW.toFixed(0)} x ${layout.totalH.toFixed(0)} px).`);
        if (this.rows > 0 && rowH.length > this.rows) {
            console.warn(`[GridArrange] Số node (${children.length}) > ${cols} x ${this.rows} = ${cols * this.rows}`
                + ` -> đã xếp thêm ${rowH.length - this.rows} hàng phía dưới.`);
        }

        this.saveSnapshot();
    }

    // ======================================================== Helpers

    private computeLayout(children: Node[]) {
        const cols = Math.max(1, Math.floor(this.columns));
        const rects = children.map(n => this.measure(n));
        const rowCount = Math.ceil(children.length / cols);

        const colW = new Array<number>(cols).fill(0);
        const rowH = new Array<number>(rowCount).fill(0);
        rects.forEach((r, i) => {
            const c = i % cols;
            const row = Math.floor(i / cols);
            colW[c] = Math.max(colW[c], r.width);
            rowH[row] = Math.max(rowH[row], r.height);
        });

        const usedCols = Math.min(cols, children.length);
        const totalW = colW.slice(0, usedCols).reduce((a, b) => a + b, 0) + this.spacingX * (usedCols - 1);
        const totalH = rowH.reduce((a, b) => a + b, 0) + this.spacingY * (rowCount - 1);

        return { cols, rowCount, colW, rowH, rects, totalW, totalH };
    }

    private resolveChildren(): Node[] | null {
        if (!this.parentNode || !this.parentNode.isValid) {
            console.error('[GridArrange] Chưa gán "Parent Node"! Kéo node cha chứa các item vào Inspector.');
            return null;
        }
        const children = this.parentNode.children.filter(n => n && n.isValid
            && (!this.skipInactive || n.active));
        if (children.length === 0) {
            console.error(`[GridArrange] "${this.parentNode.name}" không có node con nào để xếp!`);
            return null;
        }
        return children;
    }

    /**
     * Bounding rect của node (gộp UITransform của node + các node cháu),
     * tính trong toạ độ của node cha, đã nhân scale. x/y = mép trái/dưới so với gốc node.
     */
    private measure(node: Node): Rect {
        let box: Rect | null = null;

        for (const ut of node.getComponentsInChildren(UITransform)) {
            const size = ut.contentSize;
            if (size.width <= 0 && size.height <= 0) continue;

            // Rect của UITransform trong toạ độ local của chính nó
            const local = new Rect(-size.width * ut.anchorX, -size.height * ut.anchorY,
                                   size.width, size.height);
            // Chuyển về toạ độ của `node` (chưa tính scale của node)
            const r = ut.node === node ? local : this.rectToNodeSpace(local, ut.node, node);
            box = box ? Rect.union(box, box, r) : r;
        }

        if (!box) {
            console.warn(`[GridArrange] Không đo được kích thước: "${node.name}" (không có UITransform).`);
            return new Rect(0, 0, 0, 0);
        }

        const s = node.scale;
        return new Rect(box.x * Math.abs(s.x), box.y * Math.abs(s.y),
                        box.width * Math.abs(s.x), box.height * Math.abs(s.y));
    }

    /** Chuyển rect từ toạ độ local của `from` sang toạ độ local của `to` (to là tổ tiên của from). */
    private rectToNodeSpace(r: Rect, from: Node, to: Node): Rect {
        const inv = to.worldMatrix.clone().invert();
        const corners = [
            new Vec3(r.xMin, r.yMin, 0), new Vec3(r.xMax, r.yMin, 0),
            new Vec3(r.xMin, r.yMax, 0), new Vec3(r.xMax, r.yMax, 0),
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of corners) {
            const w = Vec3.transformMat4(new Vec3(), c, from.worldMatrix);
            const l = Vec3.transformMat4(new Vec3(), w, inv);
            minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x);
            minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y);
        }
        return new Rect(minX, minY, maxX - minX, maxY - minY);
    }

    private saveSnapshot(): void {
        if (!EDITOR) return;
        try {
            Ed?.Message?.send('scene', 'snapshot');
            console.log('[GridArrange] Nhấn Ctrl+S để lưu scene.');
        } catch (e) { /* không có editor thì thôi */ }
    }
}
