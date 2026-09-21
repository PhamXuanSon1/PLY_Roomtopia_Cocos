import { _decorator, Camera, Component, EventTouch, Input, input, Label, math, Node, UITransform, Vec2, Vec3 } from 'cc';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * Điều khiển giao diện thanh bar phía dưới (BottomBar).
 * Hỗ trợ kéo trái/phải để scroll `content` (đơn vị local của BottomBar, 1080 = full width).
 */
@ccclass('BottomBar')
export class BottomBar extends Component {
    @property(Label)
    countLabel: Label | null = null;

    @property(Node)
    tabNode: Node | null = null;

    @property(Node)
    bgNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa item, sẽ bị dịch theo trục X khi kéo. Để trống → tự tạo child "Content"' })
    content: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera render thanh này. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Cho phép kéo scroll' })
    scrollEnabled = true;

    @property({ tooltip: 'Giới hạn X nhỏ nhất của content (local)' })
    minX = 0;

    @property({ tooltip: 'Giới hạn X lớn nhất của content (local)' })
    maxX = 0;

    @property({ tooltip: 'Ngón tay phải đi quá số px này mới tính là kéo' })
    dragThresholdPx = 8;

    @property({ tooltip: 'Tốc độ mượt khi content đuổi theo ngón tay (0 = bám sát)' })
    followLerp = 12;

    @property({ tooltip: 'Kéo lệch so với phương thẳng đứng dưới góc này (độ) = NHẤC item, không scroll' })
    liftAngle = 70;

    /** node.emit(EVENT_LIFT, startPos: Vec2) khi người chơi kéo LÊN từ trong thanh */
    static readonly EVENT_LIFT = 'bottombar-lift';

    /** Đang kéo thanh (để script khác biết mà không xử lý touch) */
    get isDragging() { return this._dragging; }

    private _touchId = -1;
    private _dragging = false;
    private _start = new Vec2();
    private _last = new Vec2();
    private _targetX = 0;
    private _contentWidth = 0;
    private _tmpA = new Vec3();
    private _tmpB = new Vec3();

    onLoad() {
        if (!this.content) {
            this.content = new Node('Content');
            this.content.layer = this.node.layer;
            this.content.setParent(this.node);
        }
        this._targetX = this.content.position.x;
    }

    onEnable() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        this._touchId = -1;
        this._dragging = false;
    }

    // ------------------------------------------------------------ public API

    /**
     * Cập nhật số đếm tiến trình (ví dụ: 0/63)
     */
    setCount(current: number, total: number) {
        if (this.countLabel) {
            this.countLabel.string = `${current}/${total}`;
        }
    }

    /**
     * Thiết lập chuỗi text tùy ý
     */
    setText(text: string) {
        if (this.countLabel) {
            this.countLabel.string = text;
        }
    }

    /**
     * Đặt giới hạn scroll theo tổng chiều rộng content (local px).
     * Content rộng hơn thanh mới được kéo; content neo mép trái.
     */
    setContentWidth(contentWidth: number) {
        this._contentWidth = contentWidth;
        const barW = this.getComponent(UITransform)?.contentSize.width ?? 1080;
        this.maxX = 0;
        this.minX = Math.min(0, barW - contentWidth);
        this.scrollTo(this._targetX, true);
    }

    scrollTo(x: number, immediate = false) {
        this._targetX = math.clamp(x, this.minX, this.maxX);
        if (immediate && this.content) {
            const p = this.content.position;
            this.content.setPosition(this._targetX, p.y, p.z);
        }
    }

    // ------------------------------------------------------------ touch

    private onTouchStart(e: EventTouch) {
        if (!this.scrollEnabled || this._touchId !== -1) return;
        const loc = e.getLocation();
        if (!this.hitTest(loc)) return;
        this._touchId = e.getID();
        this._start.set(loc);
        this._last.set(loc);
        this._dragging = false;
    }

    private onTouchMove(e: EventTouch) {
        if (e.getID() !== this._touchId || !this.content) return;
        const cur = e.getLocation();

        if (!this._dragging) {
            if (Vec2.distance(cur, this._start) < this.dragThresholdPx) return;

            // lần đầu vượt ngưỡng: quyết định NHẤC hay SCROLL theo góc kéo
            const dir = new Vec2(cur.x - this._start.x, cur.y - this._start.y);
            const angle = math.toDegree(Vec2.angle(dir, Vec2.UNIT_Y));   // 0 = thẳng lên, 90 = ngang
            if (angle <= this.liftAngle) {
                const start = this._start.clone();
                this._touchId = -1;                       // nhả touch, thanh không scroll nữa
                this.node.emit(BottomBar.EVENT_LIFT, start);
                return;
            }

            this._dragging = true;
            this._last.set(cur);
        }

        const dxPx = cur.x - this._last.x;
        const ppu = this.pixelsPerUnit();
        if (ppu > 0) {
            this._targetX = math.clamp(this._targetX + dxPx / ppu, this.minX, this.maxX);
        }
        this._last.set(cur);
    }

    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        this._touchId = -1;
        this._dragging = false;
    }

    update(dt: number) {
        if (!this.content) return;
        const p = this.content.position;
        if (Math.abs(p.x - this._targetX) < 0.01) return;
        const x = this.followLerp > 0
            ? math.lerp(p.x, this._targetX, Math.min(1, dt * this.followLerp))
            : this._targetX;
        this.content.setPosition(x, p.y, p.z);
    }

    // ------------------------------------------------------------ helpers

    private camera(): Camera | null {
        return this.cam ?? ui?.wCamera ?? null;
    }

    /** Số pixel màn hình ứng với 1 đơn vị local X của content */
    pixelsPerUnit(): number {
        const cam = this.camera();
        if (!cam || !this.content) return 0;
        const mat = this.node.worldMatrix;
        const lp = this.content.position;
        Vec3.transformMat4(this._tmpA, this._tmpA.set(lp.x, lp.y, lp.z), mat);
        Vec3.transformMat4(this._tmpB, this._tmpB.set(lp.x + 1, lp.y, lp.z), mat);
        const a = cam.worldToScreen(this._tmpA, new Vec3());
        const b = cam.worldToScreen(this._tmpB, new Vec3());
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    /** Touch có nằm trong AABB screen-space của thanh không (UITransform của node này) */
    hitTest(p: Vec2): boolean {
        const cam = this.camera();
        const ut = this.getComponent(UITransform);
        if (!cam || !ut) return true;
        const { width, height } = ut.contentSize;
        const ax = ut.anchorX, ay = ut.anchorY;
        const mat = this.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const corners = [
            [-ax * width, -ay * height], [(1 - ax) * width, -ay * height],
            [-ax * width, (1 - ay) * height], [(1 - ax) * width, (1 - ay) * height],
        ];
        for (const [x, y] of corners) {
            Vec3.transformMat4(this._tmpA, this._tmpA.set(x, y, 0), mat);
            const s = cam.worldToScreen(this._tmpA, this._tmpB);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    }
}
