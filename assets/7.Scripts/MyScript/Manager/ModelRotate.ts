import { _decorator, Component, director, EventTouch, Input, input, Node, Vec2 } from 'cc';
import { EDITOR } from 'cc/env';
import { BottomBar } from '../Item/BottomBar';
import { ItemManager } from './ItemManager';
const { ccclass, property } = _decorator;

/**
 * ModelRotate: kéo ngón tay trái/phải trên vùng map → xoay node model quanh trục Y.
 * Bỏ qua touch bắt đầu trong BottomBar (để thanh scroll/nhấc item) và khi đang kéo item.
 */
@ccclass('ModelRotate')
export class ModelRotate extends Component {
    @property({ type: Node, tooltip: 'Node cần xoay. Để trống = node gắn script này' })
    model: Node | null = null;

    @property({ type: BottomBar, tooltip: 'Touch bắt đầu trong thanh thì không xoay. Để trống → BottomBar trong scene' })
    bar: BottomBar | null = null;

    @property({ type: ItemManager, tooltip: 'Đang kéo item thì không xoay. Để trống → ItemManager trong scene' })
    itemManager: ItemManager | null = null;

    @property({ tooltip: 'Độ xoay cho mỗi px ngón tay đi ngang' })
    degPerPx = 0.3;

    @property({ tooltip: 'Quán tính sau khi thả (0 = dừng ngay, 0.9 = trượt lâu)' })
    inertia = 0.85;

    @property({ tooltip: 'Ngón tay phải đi quá số px này mới tính là kéo' })
    dragThresholdPx = 6;

    @property({ tooltip: 'Xoay quá bao nhiêu độ thì tính là người chơi đã biết xoay (HandHintManager thôi hint xoay)' })
    rotatedDeg = 10;

    /** Người chơi đã tự xoay phòng (≥ rotatedDeg) chưa */
    get rotatedOnce() { return this._rotatedOnce; }
    private _rotatedOnce = false;

    private touchId = -1;
    private touchStartPosition = new Vec2();
    private last = new Vec2();
    private dragging = false;
    private velocity = 0;        // độ/frame
    private baseY = 0;           // góc Y ban đầu
    private angle = 0;           // góc lệch so với baseY

    /** Chọn node cần xoay và ghi góc Y ban đầu làm mốc cho thao tác kéo/reset. */
    onLoad() {
        if (!this.model) this.model = this.node;
        this.baseY = this.model.eulerAngles.y;
    }

    /** Tìm thanh/manager ngoài prefab và đăng ký sự kiện xoay phòng khi chơi. */
    onEnable() {
        if (EDITOR) return;
        // component nằm trong prefab Level → không lưu được ref ra scene, tự tìm
        const scene = director.getScene();
        if (!this.bar?.isValid) this.bar = scene?.getComponentInChildren(BottomBar) ?? null;
        if (!this.itemManager?.isValid) this.itemManager = scene?.getComponentInChildren(ItemManager) ?? null;
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    /** Gỡ các sự kiện chạm để component bị tắt không tiếp tục điều khiển phòng. */
    onDisable() {
        if (EDITOR) return;
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    /** Nhận một ngón tay ngoài thanh khi chưa vào chế độ store và xoá quán tính cũ. */
    private onTouchStart(e: EventTouch) {
        if (this.touchId !== -1) return;
        const loc = e.getLocation();
        if (this.itemManager?.storeMode) return;                  // đã vào chế độ store → không xoay
        if (this.bar && this.bar.hitTest(loc)) return;          // chạm trong thanh → của BottomBar
        this.touchId = e.getID();
        this.touchStartPosition.set(loc); this.last.set(loc);
        this.dragging = false;
        this.velocity = 0;
    }

    /** Qua ngưỡng kéo thì xoay theo độ dịch ngang; bỏ lượt xoay nếu đang kéo item. */
    private onTouchMove(e: EventTouch) {
        if (e.getID() !== this.touchId) return;
        if (this.itemManager?.isDragging) { this.touchId = -1; return; }   // đang kéo item → bỏ
        const cur = e.getLocation();
        if (!this.dragging) {
            if (Vec2.distance(cur, this.touchStartPosition) < this.dragThresholdPx) return;
            this.dragging = true; this.last.set(cur);
        }
        const dx = cur.x - this.last.x;
        this.velocity = dx * this.degPerPx;
        this.rotateBy(this.velocity);
        this.last.set(cur);
        if (Math.abs(this.angle) >= this.rotatedDeg) this._rotatedOnce = true;
    }

    /** Nhả ngón tay xoay, giữ vận tốc cuối để update tiếp tục quán tính. */
    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this.touchId) return;
        this.touchId = -1;
        this.dragging = false;
    }

    /** Tiếp tục xoay theo vận tốc còn lại và giảm dần bằng hệ số quán tính. */
    update() {
        if (this.dragging || Math.abs(this.velocity) < 0.01) return;
        this.rotateBy(this.velocity);
        this.velocity *= this.inertia;
    }

    /** Cộng góc lệch vào mốc Y ban đầu, giữ nguyên góc X/Z của model. */
    private rotateBy(deg: number) {
        this.angle += deg;
        const e = this.model!.eulerAngles;
        this.model!.setRotationFromEuler(e.x, this.baseY + this.angle, e.z);
    }

    /** Về góc ban đầu */
    reset() { this.angle = 0; this.velocity = 0; this.rotateBy(0); }
}
