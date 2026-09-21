import { _decorator, Component, EventTouch, Input, input, Node, Vec2 } from 'cc';
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

    @property({ type: BottomBar, tooltip: 'Touch bắt đầu trong thanh thì không xoay' })
    bar: BottomBar | null = null;

    @property({ type: ItemManager, tooltip: 'Đang kéo item thì không xoay' })
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

    onLoad() {
        if (!this.model) this.model = this.node;
        this.baseY = this.model.eulerAngles.y;
    }

    onEnable() {
        if (EDITOR) return;
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        if (EDITOR) return;
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onTouchStart(e: EventTouch) {
        if (this.touchId !== -1) return;
        const loc = e.getLocation();
        if (this.bar && this.bar.hitTest(loc)) return;          // chạm trong thanh → của BottomBar
        this.touchId = e.getID();
        this.touchStartPosition.set(loc); this.last.set(loc);
        this.dragging = false;
        this.velocity = 0;
    }

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

    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this.touchId) return;
        this.touchId = -1;
        this.dragging = false;
    }

    update() {
        if (this.dragging || Math.abs(this.velocity) < 0.01) return;
        this.rotateBy(this.velocity);
        this.velocity *= this.inertia;
    }

    private rotateBy(deg: number) {
        this.angle += deg;
        const e = this.model!.eulerAngles;
        this.model!.setRotationFromEuler(e.x, this.baseY + this.angle, e.z);
    }

    /** Về góc ban đầu */
    reset() { this.angle = 0; this.velocity = 0; this.rotateBy(0); }
}
