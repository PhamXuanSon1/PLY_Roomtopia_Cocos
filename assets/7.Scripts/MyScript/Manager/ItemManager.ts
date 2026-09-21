import { _decorator, Camera, Component, director, EventTouch, Input, input, instantiate, Layers, MeshRenderer, Node, Prefab, Quat, tween, UITransform, Vec2, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { BottomBar } from '../Item/BottomBar';
import { BarClipCamera } from '../Item/BarClipCamera';
import { ItemCallbacks, ItemController } from '../Item/ItemController';
import { ReleaseResult } from '../Item/ItemMovement';
import { CELL_PX, CULL_PAD_PX, EDGE_PAD_PX, ICON_FILL, SPACING_PX, px } from '../Config/TrayConfig';
import { GameManager } from './GameManager';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * ItemManager: quản lý TẤT CẢ item trong thanh.
 *
 *  build()            tạo 1 Item cho mỗi mesh trong map, xếp vào BottomBar/Content
 *  updateVisibility() mỗi frame: xếp ô theo bar.offset (vòng lặp nếu tràn thanh), ẩn ô ngoài thanh.
 *                     Thanh ngang: ô xếp theo +X; thanh dọc (màn ngang, bar.vertical): theo −Y từ trên xuống
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

    @property({ type: Node, tooltip: 'Node rỗng trong world để cắm icon khi kéo (Gameplay/DragGhost). Layer = TRAY để BarCam vẽ' })
    ghostRoot: Node | null = null;

    @property({ type: BarClipCamera, tooltip: 'BarCam: khi kéo item sẽ mở viewport cả màn → ghost (layer TRAY) vẽ đè lên map + CountLabel' })
    clipCam: BarClipCamera | null = null;

    @property({ type: Camera, tooltip: 'Camera vẽ map. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ type: [Node], tooltip: 'Các mesh được chơi, thứ tự = thứ tự ô trong thanh. Để trống → tất cả mesh trong map' })
    pickTargets: Node[] = [];

    // ---- layout (đơn vị local của BottomBar, 1080 = full width). Đổi xong tick Preview để áp ----
    @property({ serializable: true, visible: false })
    private _cellSize = CELL_PX;

    @property({ group: 'Layout', tooltip: 'Cạnh ô vuông (thẻ Cell) chứa icon. Đổi là áp ngay cho thẻ; icon cần tick Preview để đo lại' })
    get cellSize() { return this._cellSize; }
    set cellSize(v: number) { this._cellSize = v; this.applyCellSize(); }

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

    // ---- snap (px quy về màn 393pt, xem px() trong TrayConfig) ----
    @property({ group: 'Snap', tooltip: 'Ghost lệch so với target (pt @393) dưới ngưỡng này = snap (ghost chồng khít target = 0)' })
    snapPx = 40;

    @property({ group: 'Snap', tooltip: 'Cộng thêm nửa cạnh nhỏ bbox target vào ngưỡng (vật to dễ thả hơn)' })
    snapByBounds = true;

    @property({ group: 'Snap', tooltip: 'Target của item phải là target GẦN NHẤT dưới ngón tay; thả lên vật khác = trượt dù trong ngưỡng' })
    requireNearest = true;

    @property({ group: 'Snap Animation', tooltip: 'Scale tối đa của target khi snap, tính theo scale gốc' })
    snapScale = 1.3;

    @property({ group: 'Snap Animation', tooltip: 'Thời gian target phóng to khi snap (giây)' })
    snapScaleUpDuration = 0.12;

    @property({ group: 'Snap Animation', tooltip: 'Thời gian target thu về scale gốc (giây)' })
    snapScaleDownDuration = 0.18;

    /** Layer riêng cho thẻ + icon trong thanh → BarClipCamera vẽ & cắt theo vùng thanh */
    static readonly TRAY_LAYER_NAME = 'TRAY';
    static readonly TRAY_LAYER_BIT = 0;
    static get trayLayer() { return 1 << ItemManager.TRAY_LAYER_BIT; }

    /** Đặt layer TRAY cho item và toàn bộ con */
    static setTrayLayer(n: Node) {
        n.layer = ItemManager.trayLayer;
        for (const c of n.children) ItemManager.setTrayLayer(c);
    }

    @property({ serializable: true, visible: false })
    private _showCells = true;

    @property({ tooltip: 'Hiện thẻ Cell (ô trắng bo góc) dưới icon. Áp cho mọi item cả editor lẫn khi Play' })
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
    get isDragging() { return !!this.dragging; }
    private touchId = -1;
    /** nửa độ dài thanh theo trục xếp (local px): ngang = width/2, dọc = height/2 */
    private barHalfW = 540;
    private lastVertical = false;
    /** true = item tràn thanh → xếp vòng lặp + cho kéo; false = đủ chỗ, căn giữa, không kéo */
    private loop = false;
    /** chu kỳ vòng lặp (local px) khi loop */
    private period = 0;

    // =========================================================== vòng đời
    onLoad() {
        // đăng ký layer TRAY (bit 0) nếu project chưa khai báo trong Project Settings → Layers
        const existing = Layers.nameToLayer(ItemManager.TRAY_LAYER_NAME);
        if (existing === undefined || existing < 0) Layers.addLayer(ItemManager.TRAY_LAYER_NAME, ItemManager.TRAY_LAYER_BIT);
    }

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

    private lastModelRot = new Quat();

    update() {
        this.syncIconRotation();          // chạy cả trong editor: xoay model root là icon xoay theo ngay
        if (EDITOR) return;
        this.updateVisibility();
    }

    /** Target xoay (ModelRotate xoay node nào cũng được, hoặc xoay tay trong editor) → icon trong thanh xoay theo */
    private syncIconRotation() {
        const list = this.items.length ? this.items : (this.bar?.content?.getComponentsInChildren(ItemController) ?? []);
        const probe = list.find(it => it.target?.isValid)?.target;
        if (!probe) return;
        const r = probe.worldRotation;                 // theo dõi 1 target đại diện (cùng cha nên xoay cùng nhau)
        if (Quat.equals(r, this.lastModelRot)) return;
        this.lastModelRot.set(r);
        for (const it of list) if (!it.isCompleted) it.graphic?.syncRotation();
    }

    // =========================================================== 1. build
    build() {
        const gm = GameManager.inst!;
        const cam = this.camera();
        const content = this.bar!.content!;
        this.barHalfW = this.barHalfLen();
        this.lastVertical = this.bar!.vertical;

        const allMeshes = gm.model!.getComponentsInChildren(MeshRenderer).map(r => r.node);

        // item có sẵn trong Content (sinh từ Preview trong editor) → dùng lại, KHÔNG sinh thêm
        const existing = content.getComponentsInChildren(ItemController)
            .sort((a, b) => a.node.position.x - b.node.position.x);
        // tìm target cho item cũ: ItemController.target → ItemGraphic.target → theo tên "Item_<tên mesh>"
        for (const it of existing) {
            if (it.target?.isValid) continue;
            const byGraphic = it.graphic?.target;
            const byName = allMeshes.find(m => it.node.name === `Item_${m.name}`);
            it.target = byGraphic?.isValid ? byGraphic : (byName ?? null);
            if (!it.target) console.warn(`[ItemManager] ${it.node.name} không tìm được target — xoá`);
        }
        const usable = existing.filter(it => it.target);
        for (const it of existing) if (!it.target) it.node.destroy();

        let targets: Node[];
        if (usable.length > 0) {
            targets = usable.map(it => it.target!);
        } else {
            targets = this.pickTargets.length > 0 ? this.pickTargets.slice() : allMeshes.slice();
        }
        existing.length = 0; existing.push(...usable);

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
                this.placeSlot(item, this.slotX(i));
            }
            // item có sẵn: giữ nguyên vị trí/scale như editor; Cell luôn theo showCells (mặc định tắt)
            item.init(
                target,
                i,
                cam,
                this.ghostRoot!,
                gm.grayMat,
                this,
                this.cellPx(),
                this.iconFill,
                this.snapScale,
                this.snapScaleUpDuration,
                this.snapScaleDownDuration,
            );
            this.setCellActive(item, this.showCells);
            ItemManager.setTrayLayer(item.node);
            this.items.push(item);
        });

        this.collected = 0;
        this.bar!.resetScroll();
        this.setLayout(this.remain);
        this.refreshCount();
        this.updateVisibility();
        console.log(`[ItemManager] ${this.total} items`);
    }

    /** Đẩy `collected/total` lên label của BottomBar */
    refreshCount(total = this.total) {
        this.bar?.setCount(this.collected, total);
    }

    /** Tổng chiều rộng content khi còn n ô */
    private contentWidth(n: number) {
        return n <= 0 ? 0 : this.edgePad * 2 + this.spacing * (n - 1);
    }

    /**
     * Quyết định chế độ xếp theo số ô còn lại:
     *  - tràn thanh → loop, cho kéo
     *  - đủ chỗ     → căn giữa, khoá kéo
     */
    private setLayout(n: number) {
        const barW = this.barHalfW * 2;
        this.loop = this.contentWidth(n) > barW;
        // chu kỳ ≥ barW + 1 ô để không bao giờ phải vẽ 1 item ở 2 chỗ
        this.period = Math.max(n * this.spacing, barW + this.spacing);
        this.bar!.setScrollable(this.loop);
    }

    /** Nửa độ dài thanh theo trục xếp item */
    private barHalfLen() {
        return (this.bar?.length ?? 1080) / 2;
    }

    /** Đặt ô tại toạ độ `pos` dọc theo trục thanh: ngang → x, dọc → −y (ô đầu ở trên) */
    private placeSlot(item: ItemController, pos: number) {
        if (this.bar!.vertical) item.node.setPosition(0, -pos, 0);
        else item.node.setPosition(pos, 0, 0);
    }

    /** toạ độ dọc trục thanh (local trong Content) của ô thứ i với offset hiện tại */
    private slotX(i: number, n = this.remain) {
        if (this.loop) {
            const off = this.bar!.offset;
            // mod về [−SPACING, period − SPACING): ô vừa rời mép phải sẽ hiện lại từ mép trái
            let rel = (i * this.spacing + off + this.spacing) % this.period;
            if (rel < 0) rel += this.period;
            return -this.barHalfW + this.edgePad + rel - this.spacing;
        }
        return -this.contentWidth(n) / 2 + this.edgePad + this.spacing * i;
    }

    // =========================================================== 2. layout + cull (mỗi frame)
    updateVisibility() {
        if (!this.bar?.content) return;
        // thanh đổi độ dài / đổi ngang↔dọc (resize / fitLayout) → tính lại loop/period
        const halfW = this.barHalfLen();
        const vertical = this.bar.vertical;
        if (halfW !== this.barHalfW || vertical !== this.lastVertical) {
            this.barHalfW = halfW; this.lastVertical = vertical;
            this.setLayout(this.remain);
        }
        const left = -this.barHalfW - this.cullPad;
        const right = this.barHalfW + this.cullPad;
        const n = this.remain;

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item === this.dragging) continue;          // đang kéo thì không đụng
            if (i >= n) { item.setOnScreen(false); continue; }   // đã xong → ẩn
            const x = this.slotX(i, n);
            this.placeSlot(item, x);
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
        if (this.clipCam) this.clipCam.fullScreen = true;   // ghost nổi trên map + label
        item.onSelect(startPos);
    }

    /** Kết thúc kéo (thả / huỷ): đóng viewport BarCam về vùng thanh */
    private endDrag() {
        this.dragging = null;
        this.touchId = -1;
        if (this.clipCam) this.clipCam.fullScreen = false;
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
        this.endDrag();
        item.onRelease();                  // → onSnapped hoặc onReturned
    }

    private onTouchCancel(e: EventTouch) {
        if (!this.dragging) return;
        const item = this.dragging;
        this.endDrag();
        item.onCancel();
    }

    // =========================================================== 4. callback từ item
    /** Phán snap khi thả tại ghostPos (pixel màn hình). Cấu hình ở group Snap. */
    judgeSnap(item: ItemController, ghostPos: Vec2): boolean {
        const own = item.target;
        if (!own) return false;

        // Ghost là cùng mesh/scale/rotation với target → ghost CHỒNG KHÍT target khi pivot trùng pivot.
        // (Mesh FBX bake toạ độ vào đỉnh nên pivot có thể nằm xa hình, đo bbox sẽ sai.)
        const dOwn = this.distToCenter(own, ghostPos);
        const tol = px(this.snapPx) + (this.snapByBounds ? this.halfMinExtentPx(own) : 0);
        if (dOwn > tol) return false;

        if (this.requireNearest) {
            for (const other of this.items) {
                if (other === item || other.isCompleted || !other.target) continue;
                // pivot trùng nhau (cùng FBX) thì không phân biệt được → bỏ qua
                if (this.distToCenter(other.target, ghostPos) < dOwn - 1) return false;
            }
        }
        return true;
    }

    /** Khoảng cách (px màn hình) từ p tới pivot của target */
    private distToCenter(target: Node, p: Vec2): number {
        const s = this.camera().worldToScreen(target.worldPosition, new Vec3());
        return Math.hypot(s.x - p.x, s.y - p.y);
    }

    /** Nửa cạnh nhỏ của bbox target trên màn hình (px) — vật to thì dung sai lớn hơn */
    private halfMinExtentPx(target: Node): number {
        const cam = this.camera();
        const st = target.getComponent(MeshRenderer)?.mesh?.struct;
        if (!st?.minPosition || !st.maxPosition) return 0;
        const lo = st.minPosition, hi = st.maxPosition, mat = target.worldMatrix, tmp = new Vec3();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
            tmp.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
            Vec3.transformMat4(tmp, tmp, mat);
            const s = cam.worldToScreen(tmp, tmp);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        return Math.min(maxX - minX, maxY - minY) / 2;
    }

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

    /** Gỡ ô đã xong: đẩy ra cuối danh sách, các ô sau tự dồn lên ở frame kế (updateVisibility) */
    private removeAndCompact(item: ItemController) {
        const idx = this.items.indexOf(item);
        if (idx < 0) return;
        this.items.splice(idx, 1);
        this.items.push(item);
        item.setOnScreen(false);
        this.setLayout(this.remain);
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
        this.barHalfW = this.barHalfLen();
        this.loop = this.contentWidth(targets.length) > this.barHalfW * 2;
        this.period = Math.max(targets.length * this.spacing, this.barHalfW * 2 + this.spacing);

        targets.forEach((target, i) => {
            const node = instantiate(this.itemPrefab!);
            node.name = `Item_${target.name}`;
            node.setParent(content);                              // LƯU vào scene → Play dùng lại
            const item = node.getComponent(ItemController)!;
            this.placeSlot(item, this.slotX(i, targets.length));
            item.target = target;
            item.graphic!.bind(target, this.bar!.cam ?? this.cam, this.cellPx(), this.iconFill);   // chỉ hình, không gray
            ItemManager.setTrayLayer(node);
        });
        this.applyShowCells();
        this.collected = 0;
        this.refreshCount(targets.length);           // label trong editor cũng hiện 0/max
        console.log(`[ItemManager] preview ${targets.length} items`);
    }

    /** Bật/tắt quad Cell của 1 item (fallback tìm con tên "Cell" cho item sinh từ prefab cũ) */
    private setCellActive(item: ItemController, on: boolean) {
        const cell = item.graphic?.cell ?? item.node.getChildByName('Cell');
        if (cell) { cell.active = on; this.resizeCell(cell); }
    }

    /** Thẻ Cell = ô vuông cạnh cellPx (QuadImage tự dựng lại khi UITransform đổi) */
    private resizeCell(cell: Node) {
        const size = this.cellPx();
        cell.getComponent(UITransform)?.setContentSize(size, size);
    }

    /** Áp cellSize cho mọi item đang có trong Content */
    private applyCellSize() {
        const content = this.bar?.content;
        if (!content) return;
        for (const it of content.getComponentsInChildren(ItemController)) {
            const cell = it.graphic?.cell ?? it.node.getChildByName('Cell');
            if (cell) this.resizeCell(cell);
        }
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
    /** Ô vuông chứa icon: cellSize, hoặc (=0) chiều cao dải content của BottomBar */
    private cellPx(): number {
        if (this._cellSize > 0) return this._cellSize;
        return this.bar?.hitHeight ?? CELL_PX;
    }

    private camera(): Camera {
        return this.cam ?? ui.wCamera;
    }

}
