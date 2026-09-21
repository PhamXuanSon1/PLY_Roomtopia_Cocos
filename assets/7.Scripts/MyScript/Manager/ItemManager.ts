import { _decorator, Camera, Component, director, EventTouch, Input, input, instantiate, MeshRenderer, Node, Prefab, tween, UITransform, Vec2, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { BottomBar } from '../Item/BottomBar';
import { ItemCallbacks, ItemController } from '../Item/ItemController';
import { ReleaseResult } from '../Item/ItemMovement';
import { CELL_PX, CULL_PAD_PX, EDGE_PAD_PX, ICON_FILL, SPACING_PX } from '../Config/TrayConfig';
import { GameManager } from './GameManager';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * ItemManager: quản lý TẤT CẢ item trong thanh.
 *
 *  build()            tạo 1 Item cho mỗi mesh trong map, xếp vào BottomBar/Content
 *  updateVisibility() mỗi frame: ẩn ô nằm ngoài thanh (cull)
 *  nhấc item          nghe BottomBar.EVENT_LIFT → pick() ô dưới ngón tay → item.onSelect
 *                     rồi tự theo dõi TOUCH_MOVE / END cho tới khi thả
 *  onSnapped()        đếm tiến trình, gỡ ô, dồn thanh, báo win
 */
@ccclass('ItemManager')
@executeInEditMode
export class ItemManager extends Component implements ItemCallbacks {

    @property({ type: Prefab, tooltip: 'Prefab Item (ItemController + Graphic + Movement)' })
    itemPrefab: Prefab | null = null;

    @property({ type: BottomBar, tooltip: 'Thanh dưới màn hình' })
    bar: BottomBar | null = null;

    @property({ type: Node, tooltip: 'Node rỗng trong world để cắm icon khi kéo (Gameplay/DragGhost)' })
    ghostRoot: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera vẽ map. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ type: [Node], tooltip: 'Các mesh được chơi, thứ tự = thứ tự ô trong thanh. Để trống → tất cả mesh trong map' })
    pickTargets: Node[] = [];

    // ---- layout (đơn vị local của BottomBar, 1080 = full width). Đổi xong tick Preview để áp ----
    @property({ group: 'Layout', tooltip: 'Cạnh ô vuông chứa icon. 0 = tự lấy chiều cao Bg' })
    cellSize = CELL_PX;

    @property({ group: 'Layout', range: [0.1, 1, 0.05], slide: true, tooltip: 'Icon chiếm bao nhiêu phần của ô' })
    iconFill = ICON_FILL;

    @property({ group: 'Layout', tooltip: 'Khoảng cách tâm 2 ô' })
    spacing = SPACING_PX;

    @property({ group: 'Layout', tooltip: 'Ô đầu cách mép trái thanh' })
    edgePad = EDGE_PAD_PX;

    @property({ group: 'Layout', tooltip: 'Ô còn hiện khi tâm cách mép thanh ≤ giá trị này' })
    cullPad = CULL_PAD_PX;

    @property({ tooltip: 'Mesh KHÔNG có trong pickTargets cũng đổi sang xám' })
    grayOthers = true;

    @property({ serializable: true, visible: false })
    private _showCells = false;

    @property({ tooltip: 'Hiện quad Cell (ranh giới ô). Áp cho mọi item cả editor lẫn khi Play. Mặc định tắt' })
    get showCells() { return this._showCells; }
    set showCells(v: boolean) { this._showCells = v; this.applyShowCells(); }

    // ---- nút xem trước trong editor (tick = chạy, tự bỏ tick) ----
    @property({ displayName: '▶ Preview items', tooltip: 'Sinh item vào Content theo pickTargets (lưu vào scene, Play dùng lại). Bấm lại = sinh lại từ đầu' })
    get previewItems() { return false; }
    set previewItems(v: boolean) { if (v && EDITOR) this.buildPreview(); }

    @property({ displayName: '✖ Clear preview', tooltip: 'Xoá item đang xem trước' })
    get clearPreview() { return false; }
    set clearPreview(v: boolean) { if (v && EDITOR) this.clearContent(); }

    /** Tất cả item, theo thứ tự trong thanh */
    items: ItemController[] = [];
    collected = 0;

    get total() { return this.items.length; }
    get remain() { return this.items.length - this.collected; }

    // ---- nội bộ ----
    private dragging: ItemController | null = null;   // item đang được kéo
    private touchId = -1;
    private barHalfW = 540;

    // =========================================================== vòng đời
    start() {
        if (EDITOR) return;
        this.build();
    }

    onEnable() {
        if (EDITOR) return;
        this.bar?.node.on(BottomBar.EVENT_LIFT, this.onLift, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    onDisable() {
        if (EDITOR) return;
        this.bar?.node.off(BottomBar.EVENT_LIFT, this.onLift, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    update() {
        if (EDITOR) return;
        this.updateVisibility();
    }

    // =========================================================== 1. build
    build() {
        const gm = GameManager.inst!;
        const cam = this.camera();
        const content = this.bar!.content!;
        this.barHalfW = (this.bar!.getComponent(UITransform)?.contentSize.width ?? 1080) / 2;

        // item có sẵn trong Content (sinh từ Preview trong editor) → dùng lại, không sinh mới
        const existing = content.getComponentsInChildren(ItemController)
            .filter(it => it.target && it.target.isValid)
            .sort((a, b) => a.node.position.x - b.node.position.x);

        const allMeshes = gm.model!.getComponentsInChildren(MeshRenderer).map(r => r.node);
        let targets: Node[];
        if (existing.length > 0) {
            targets = existing.map(it => it.target!);
        } else {
            targets = this.pickTargets.length > 0 ? this.pickTargets.slice() : allMeshes.slice();
        }

        // mesh không được chọn chơi: xám luôn (không cần trả màu nên đổi thẳng)
        if (this.grayOthers && gm.grayMat) {
            for (const n of allMeshes) {
                if (targets.includes(n)) continue;
                const r = n.getComponent(MeshRenderer)!;
                r.sharedMaterials = r.sharedMaterials.map(() => gm.grayMat!);
            }
        }

        this.items = [];
        targets.forEach((target, i) => {
            let item = existing[i];
            if (!item) {
                const node = instantiate(this.itemPrefab!);
                node.setParent(content);
                item = node.getComponent(ItemController)!;
                item.node.setPosition(this.slotX(i), 0, 0);
            }
            // item có sẵn: giữ nguyên vị trí/scale như editor; Cell luôn theo showCells (mặc định tắt)
            item.init(target, i, cam, this.ghostRoot!, gm.grayMat, this, this.cellPx(), this.iconFill);
            this.setCellActive(item, this.showCells);
            this.items.push(item);
        });

        this.collected = 0;
        this.bar!.setContentWidth(this.contentWidth(this.items.length));
        this.refreshCount();
        this.updateVisibility();
        console.log(`[ItemManager] ${this.total} items`);
    }

    /** Đẩy `collected/total` lên label của BottomBar */
    refreshCount(total = this.total) {
        this.bar?.setCount(this.collected, total);
    }

    /** x của ô thứ i trong Content */
    private slotX(i: number) {
        return -this.barHalfW + this.edgePad + this.spacing * i;
    }

    /** Tổng chiều rộng content khi còn n ô — để BottomBar tính giới hạn scroll */
    private contentWidth(n: number) {
        return this.edgePad * 2 + this.spacing * Math.max(0, n - 1);
    }

    // =========================================================== 2. cull
    updateVisibility() {
        if (!this.bar?.content) return;
        const cx = this.bar.content.position.x;
        const left = -this.barHalfW - this.cullPad;
        const right = this.barHalfW + this.cullPad;

        for (const item of this.items) {
            if (item === this.dragging) continue;          // đang kéo thì không đụng
            const x = cx + item.node.position.x;
            item.setOnScreen(x >= left && x <= right);
        }
    }

    // =========================================================== 3. nhấc & kéo
    /** BottomBar báo: người chơi kéo LÊN từ điểm startPos */
    private onLift(startPos: Vec2) {
        if (this.dragging) return;
        const item = this.pick(startPos);
        if (!item) return;

        this.dragging = item;
        this.touchId = -2;                 // chờ TOUCH_MOVE đầu tiên để lấy id thật
        item.onSelect(startPos);
    }

    /** Ô nào đang nằm dưới ngón tay (so trên màn hình, nửa ô = cellPx/2) */
    private pick(screenPos: Vec2): ItemController | null {
        const cam = this.camera();
        const half = this.cellPx() / 2 * this.bar!.pixelsPerUnit();   // nửa ô đổi ra pixel màn hình
        const tmp = new Vec3();

        for (const item of this.items) {
            if (!item.isOnScreen || item.isCompleted) continue;
            const s = cam.worldToScreen(item.node.worldPosition, tmp);
            if (Math.abs(s.x - screenPos.x) <= half && Math.abs(s.y - screenPos.y) <= half) return item;
        }
        return null;
    }

    private onTouchMove(e: EventTouch) {
        if (!this.dragging) return;
        if (this.touchId === -2) this.touchId = e.getID();
        if (e.getID() !== this.touchId) return;
        this.dragging.onMove(e.getLocation());
    }

    private onTouchEnd(e: EventTouch) {
        if (!this.dragging || (this.touchId !== -2 && e.getID() !== this.touchId)) return;
        const item = this.dragging;
        this.dragging = null;
        this.touchId = -1;
        item.onRelease();                  // → onSnapped hoặc onReturned
    }

    private onTouchCancel(e: EventTouch) {
        if (!this.dragging) return;
        const item = this.dragging;
        this.dragging = null;
        this.touchId = -1;
        item.onCancel();
    }

    // =========================================================== 4. callback từ item
    onSnapped(item: ItemController) {
        this.collected++;
        this.refreshCount();
        this.removeAndCompact(item);

        if (this.collected >= this.total) {
            ui?.onWin?.();
        }
    }

    onReturned(item: ItemController, result: ReleaseResult) {
        // thả trượt: icon đã tự về ô. Chỗ này để thêm sound / hint nếu cần
    }

    /** Gỡ ô đã xong, các ô phía sau dồn sang trái 1 SPACING */
    private removeAndCompact(item: ItemController) {
        const idx = this.items.indexOf(item);
        if (idx < 0) return;

        // đẩy ô đã xong ra cuối danh sách (đã ẩn bởi complete())
        this.items.splice(idx, 1);
        this.items.push(item);
        item.node.setPosition(this.slotX(this.items.length + 1), 0, 0);

        // các ô từ idx tới ô còn lại cuối cùng dịch trái
        for (let i = idx; i < this.remain; i++) {
            const n = this.items[i].node;
            tween(n).to(0.12, { position: new Vec3(this.slotX(i), 0, 0) }, { easing: 'quadOut' }).start();
        }

        // content ngắn lại → BottomBar tự kẹp scroll về giới hạn mới
        this.bar!.setContentWidth(this.contentWidth(this.remain));
    }

    // =========================================================== editor preview
    /** Sinh item vào Content ngay trong editor. Item được LƯU vào scene và dùng lại khi Play. Không đổi màu map. */
    private buildPreview() {
        const gm = this.findGameManager();
        const content = this.bar?.content;
        if (!gm?.model || !content || !this.itemPrefab) { console.warn('[ItemManager] thiếu GameManager.model / bar.content / itemPrefab'); return; }

        this.clearContent();
        const allMeshes = gm.model.getComponentsInChildren(MeshRenderer).map(r => r.node);
        const targets = this.pickTargets.length > 0 ? this.pickTargets : allMeshes;
        const halfW = (this.bar!.getComponent(UITransform)?.contentSize.width ?? 1080) / 2;

        targets.forEach((target, i) => {
            const node = instantiate(this.itemPrefab!);
            node.name = `Item_${target.name}`;
            node.setParent(content);                              // LƯU vào scene → Play dùng lại
            node.setPosition(-halfW + this.edgePad + this.spacing * i, 0, 0);
            const item = node.getComponent(ItemController)!;
            item.target = target;
            item.graphic!.bind(target, this.bar!.cam ?? this.cam, this.cellPx(), this.iconFill);   // chỉ hình, không gray
        });
        this.applyShowCells();
        this.collected = 0;
        this.refreshCount(targets.length);           // label trong editor cũng hiện 0/max
        console.log(`[ItemManager] preview ${targets.length} items`);
    }

    /** Bật/tắt quad Cell của 1 item (fallback tìm con tên "Cell" cho item sinh từ prefab cũ) */
    private setCellActive(item: ItemController, on: boolean) {
        const cell = item.graphic?.cell ?? item.node.getChildByName('Cell');
        if (cell) cell.active = on;
    }

    /** Áp showCells cho mọi item đang có trong Content */
    private applyShowCells() {
        const content = this.bar?.content;
        if (!content) return;
        for (const it of content.getComponentsInChildren(ItemController)) this.setCellActive(it, this._showCells);
    }

    /** Xoá mọi con của Content */
    private clearContent() {
        const content = this.bar?.content;
        if (!content) return;
        for (const c of content.children.slice()) c.destroy();
    }

    private findGameManager(): GameManager | null {
        return GameManager.inst ?? director.getScene()?.getComponentInChildren(GameManager) ?? null;
    }

    // =========================================================== helpers
    /** Ô vuông chứa icon: cellSize, hoặc (=0) chiều cao Bg của BottomBar */
    private cellPx(): number {
        if (this.cellSize > 0) return this.cellSize;
        return this.bar?.bgNode?.getComponent(UITransform)?.contentSize.height ?? CELL_PX;
    }

    private camera(): Camera {
        return this.cam ?? ui.wCamera;
    }

}
