import { _decorator, Camera, Component, EventTouch, Input, input, Label, math, Node, UITransform, Vec2, Vec3, view } from 'cc';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * Thanh bar phía dưới (BottomBar).
 *  - Hold trong dải content rồi kéo ngang → cộng dồn `offset` (local px, không giới hạn).
 *    Thả tay → trượt tiếp theo quán tính (`inertia`), chạm lại thì dừng.
 *    ItemManager đọc `offset` mỗi frame để xếp item theo vòng lặp.
 *  - Kéo lên → phát EVENT_LIFT để ItemManager nhấc item.
 *  - Chỉ kéo được khi ItemManager gọi setScrollable(true) (item tràn thanh).
 */
@ccclass('BottomBar')
export class BottomBar extends Component {
    @property(Label)
    countLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Node chứa item, sẽ bị dịch theo trục X khi kéo. Để trống → tự tạo child "Content"' })
    content: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera render thanh này. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Cho phép kéo scroll' })
    scrollEnabled = true;

    @property({ tooltip: 'Tự đặt UITransform.width của thanh = chiều ngang màn hình (theo camera) → vùng hiện item phủ hết màn' })
    fitWidthToScreen = true;

    @property({ tooltip: 'Chiều cao (local px) của dải content quanh content.y — chỉ chạm trong dải này mới kéo được' })
    hitHeight = 250;

    @property({ tooltip: 'Ngón tay phải đi quá số px này mới tính là kéo' })
    dragThresholdPx = 8;

    @property({ tooltip: 'Tốc độ mượt khi content đuổi theo ngón tay (0 = bám sát)' })
    followLerp = 12;

    @property({ tooltip: 'Kéo lệch so với phương thẳng đứng dưới góc này (độ) = NHẤC item, không scroll' })
    liftAngle = 70;

    @property({ range: [0, 0.99, 0.01], slide: true, tooltip: 'Quán tính sau khi thả (0 = dừng ngay, 0.9 = trượt lâu)' })
    inertia = 0.9;

    /** node.emit(EVENT_LIFT, startPos: Vec2) khi người chơi kéo LÊN từ trong thanh */
    static readonly EVENT_LIFT = 'bottombar-lift';

    /** Đang kéo thanh (để script khác biết mà không xử lý touch) */
    get isDragging() { return this._dragging; }

    /** Offset scroll hiện tại (local px, không giới hạn — ItemManager tự wrap theo chu kỳ) */
    get offset() { return this._offset; }

    /** Có được kéo trái/phải không (ItemManager bật khi item tràn màn hình) */
    get scrollable() { return this._scrollable; }

    private _touchId = -1;
    private _dragging = false;
    private _start = new Vec2();
    private _last = new Vec2();
    private _offset = 0;
    private _targetOffset = 0;
    private _scrollable = false;
    private _velocity = 0;       // local px / frame, quán tính sau khi thả
    private _tmpA = new Vec3();
    private _tmpB = new Vec3();
    private _fitKey = '';

    onLoad() {
        if (!this.content) {
            this.content = new Node('Content');
            this.content.layer = this.node.layer;
            this.content.setParent(this.node);
        }
        if (this.fitWidthToScreen) this.fitWidth();
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
            this.countLabel.string = `${current} / ${total}`;
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
     * Bật/tắt kéo. ItemManager gọi: item tràn thanh → true (loop), đủ chỗ → false.
     * Tắt thì offset về 0.
     */
    setScrollable(on: boolean) {
        this._scrollable = on;
        if (!on) {
            this._offset = this._targetOffset = 0;
            this._velocity = 0;
            this._touchId = -1;
            this._dragging = false;
        }
    }

    resetScroll() {
        this._offset = this._targetOffset = 0;
        this._velocity = 0;
    }

    // ------------------------------------------------------------ touch

    private onTouchStart(e: EventTouch) {
        if (!this.scrollEnabled || this._touchId !== -1) return;
        // không scroll được vẫn cần bắt touch để phát EVENT_LIFT
        const loc = e.getLocation();
        if (!this.hitTest(loc)) return;
        this._touchId = e.getID();
        this._start.set(loc);
        this._last.set(loc);
        this._dragging = false;
        this._velocity = 0;                       // chạm lại → dừng trượt
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

            if (!this._scrollable) { this._touchId = -1; return; }   // đủ chỗ → không kéo ngang
            this._dragging = true;
            this._last.set(cur);
        }

        const dxPx = cur.x - this._last.x;
        const ppu = this.pixelsPerUnit();
        if (ppu > 0) {
            this._velocity = dxPx / ppu;
            this._targetOffset += this._velocity;
        }
        this._last.set(cur);
    }

    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        this._touchId = -1;
        this._dragging = false;
    }

    update(dt: number) {
        if (this.fitWidthToScreen) this.fitWidth();
        if (!this._dragging && this._scrollable && Math.abs(this._velocity) >= 0.01) {
            this._targetOffset += this._velocity;   // trượt theo quán tính
            this._velocity *= this.inertia;
        } else if (!this._dragging) {
            this._velocity = 0;
        }
        if (Math.abs(this._offset - this._targetOffset) < 0.01) { this._offset = this._targetOffset; return; }
        this._offset = this.followLerp > 0
            ? math.lerp(this._offset, this._targetOffset, Math.min(1, dt * this.followLerp))
            : this._targetOffset;
    }

    // ------------------------------------------------------------ fit

    /** Chiều ngang màn hình đổi ra local px của thanh (camera ortho: 2·orthoHeight·aspect / worldScale.x) */
    screenWidthLocal(): number {
        const cam = this.camera();
        if (!cam) return this.getComponent(UITransform)?.contentSize.width ?? 1080;
        const size = view.getVisibleSize();
        const worldW = 2 * cam.orthoHeight * (size.width / size.height);
        return worldW / (this.node.worldScale.x || 1);
    }

    /** UITransform.width = chiều ngang màn hình; chỉ tính lại khi camera/màn hình đổi */
    fitWidth() {
        const cam = this.camera();
        const ut = this.getComponent(UITransform);
        if (!cam || !ut) return;
        const size = view.getVisibleSize();
        const key = `${cam.orthoHeight}|${size.width}|${size.height}|${this.node.worldScale.x}`;
        if (key === this._fitKey) return;
        this._fitKey = key;
        ut.setContentSize(this.screenWidthLocal(), ut.contentSize.height);
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

    /**
     * Touch có nằm trong dải content không: rộng = UITransform.width của thanh,
     * cao = hitHeight, tâm dọc = content.y (AABB screen-space).
     */
    hitTest(p: Vec2): boolean {
        const cam = this.camera();
        if (!cam || !this.content) return true;
        const width = this.getComponent(UITransform)?.contentSize.width ?? 1080;
        const cy = this.content.position.y;
        const h = this.hitHeight / 2;
        const mat = this.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const corners = [
            [-width / 2, cy - h], [width / 2, cy - h],
            [-width / 2, cy + h], [width / 2, cy + h],
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
