import { _decorator, Camera, CCObject, Component, director, EventTouch, Input, input, instantiate, MeshRenderer, Node, Prefab, tween, UITransform, Vec2, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { BottomBar } from '../Item/BottomBar';
import { ItemCallbacks, ItemController } from '../Item/ItemController';
import { ReleaseResult } from '../Item/ItemMovement';
import { CELL_PX, CULL_PAD_PX, EDGE_PAD_PX, SPACING_PX } from '../Config/TrayConfig';
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

    @property({ tooltip: 'Mesh KHÔNG có trong pickTargets cũng đổi sang xám' })
    grayOthers = true;

    // ---- nút xem trước trong editor (tick = chạy, tự bỏ tick) ----
    @property({ displayName: '▶ Preview items', tooltip: 'Sinh item vào Content để xem trước (không lưu vào scene, không đổi màu map)' })
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
        this.clearContent();                          // bỏ item preview còn sót

        // target = danh sách chọn tay, hoặc mọi node có MeshRenderer trong map
        const allMeshes = gm.model!.getComponentsInChildren(MeshRenderer).map(r => r.node);
        const targets = this.pickTargets.length > 0 ? this.pickTargets.slice() : allMeshes.slice();

        // mesh không được chọn chơi: xám luôn (không cần trả màu nên đổi thẳng)
        if (this.grayOthers && gm.grayMat) {
            for (const n of allMeshes) {
                if (targets.includes(n)) continue;
                const r = n.getComponent(MeshRenderer)!;
                r.sharedMaterials = r.sharedMaterials.map(() => gm.grayMat!);
            }
        }

        this.barHalfW = (this.bar!.getComponent(UITransform)?.contentSize.width ?? 1080) / 2;

        this.items = [];
        targets.forEach((target, i) => {
            const node = instantiate(this.itemPrefab!);
            node.setParent(content);
            node.setPosition(this.slotX(i), 0, 0);

            const item = node.getComponent(ItemController)!;
            item.init(target, i, cam, this.ghostRoot!, gm.grayMat, this);
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
        return -this.barHalfW + EDGE_PAD_PX + SPACING_PX * i;
    }

    /** Tổng chiều rộng content khi còn n ô — để BottomBar tính giới hạn scroll */
    private contentWidth(n: number) {
        return EDGE_PAD_PX * 2 + SPACING_PX * Math.max(0, n - 1);
    }

    // =========================================================== 2. cull
    updateVisibility() {
        if (!this.bar?.content) return;
        const cx = this.bar.content.position.x;
        const left = -this.barHalfW - CULL_PAD_PX;
        const right = this.barHalfW + CULL_PAD_PX;

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

    /** Ô nào đang nằm dưới ngón tay (so trên màn hình, nửa ô = CELL_PX/2) */
    private pick(screenPos: Vec2): ItemController | null {
        const cam = this.camera();
        const half = CELL_PX / 2 * this.bar!.pixelsPerUnit();   // nửa ô đổi ra pixel màn hình
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
    /** Sinh item vào Content để xem bố cục ngay trong editor. Không đổi màu map, không lưu vào scene. */
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
            node.hideFlags |= CCObject.Flags.DontSave;            // không ghi vào scene
            node.setParent(content);
            node.setPosition(-halfW + EDGE_PAD_PX + SPACING_PX * i, 0, 0);
            node.getComponent(ItemController)!.graphic!.bind(target, this.bar!.cam ?? this.cam);   // chỉ hình, không gray
        });
        this.collected = 0;
        this.refreshCount(targets.length);           // label trong editor cũng hiện 0/max
        console.log(`[ItemManager] preview ${targets.length} items`);
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
    private camera(): Camera {
        return this.cam ?? ui.wCamera;
    }

}
