import { _decorator, Camera, Component, EventTouch, Input, input, Label, Mat4, math, Node, Size, UITransform, Vec2, Vec3, view } from 'cc';
import { ui } from '../../Manager/UI';
import { LANDSCAPE_PANEL_FRAC } from '../Config/TrayConfig';
const { ccclass, property } = _decorator;

/**
 * Thanh bar chứa item (BottomBar).
 *  - Màn DỌC : thanh NGANG dưới màn (vị trí như đặt trong scene), kéo trái/phải để cuộn, kéo LÊN để nhấc.
 *  - Màn NGANG: tự thành PANEL DỌC bám mép phải (panelFrac bề ngang, cao hết màn), kéo lên/xuống để cuộn,
 *               kéo theo verticalLiftDir (mặc định sang trái, vào phòng) để nhấc. Nền trắng của panel do BoxBg vẽ (BgCam).
 *  - Hold trong dải content rồi kéo dọc theo trục thanh → cộng dồn `offset` (local px, không giới hạn).
 *    Thả tay → trượt tiếp theo quán tính (`inertia`), chạm lại thì dừng.
 *    ItemManager đọc `offset` + `vertical` mỗi frame để xếp item theo vòng lặp.
 *  - Chỉ kéo được khi ItemManager gọi setScrollable(true) (item tràn thanh).
 */
@ccclass('BottomBar')
export class BottomBar extends Component {
    @property(Label)
    countLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Node chứa item, sẽ bị dịch theo trục thanh khi kéo. Để trống → tự tạo child "Content"' })
    content: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera render thanh này. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Cho phép kéo scroll' })
    scrollEnabled = true;

    @property({ tooltip: 'Tự đặt kích thước thanh theo màn hình (ngang: rộng = màn; dọc: cao = màn, rộng = panelFrac)' })
    fitWidthToScreen = true;

    @property({ tooltip: 'Chiều cao (local px) của dải content quanh content.y — chỉ chạm trong dải này mới kéo được (thanh ngang)' })
    hitHeight = 250;

    @property({ tooltip: 'Ngón tay phải đi quá số px này mới tính là kéo' })
    dragThresholdPx = 8;

    @property({ tooltip: 'Tốc độ mượt khi content đuổi theo ngón tay (0 = bám sát)' })
    followLerp = 12;

    @property({ tooltip: 'Kéo lệch so với hướng NHẤC dưới góc này (độ) = NHẤC item, không scroll' })
    liftAngle = 70;

    @property({ range: [0, 0.99, 0.01], slide: true, tooltip: 'Quán tính sau khi thả (0 = dừng ngay, 0.9 = trượt lâu)' })
    inertia = 0.9;

    @property({ group: 'Landscape', tooltip: 'Màn ngang → tự chuyển thành panel dọc bên phải' })
    autoVertical = true;

    @property({ group: 'Landscape', range: [0.05, 0.6, 0.01], slide: true, tooltip: 'Panel dọc chiếm bao nhiêu phần bề ngang màn' })
    panelFrac = LANDSCAPE_PANEL_FRAC;

    @property({ group: 'Landscape', tooltip: 'Panel dọc: kéo về hướng này (màn hình) = NHẤC item. (-1,0) = sang trái vào phòng' })
    verticalLiftDir = new Vec2(-1, 0);

    /** node.emit(EVENT_LIFT, startPos: Vec2) khi người chơi kéo item RA KHỎI thanh */
    static readonly EVENT_LIFT = 'bottombar-lift';
    /** node.emit(EVENT_LAYOUT, vertical: boolean) khi thanh đổi ngang ↔ dọc */
    static readonly EVENT_LAYOUT = 'bottombar-layout';

    /** Đang kéo thanh (để script khác biết mà không xử lý touch) */
    get isDragging() { return this._dragging; }

    /** Offset scroll hiện tại (local px, không giới hạn — ItemManager tự wrap theo chu kỳ) */
    get offset() { return this._offset; }

    /** Có được kéo không (ItemManager bật khi item tràn thanh) */
    get scrollable() { return this._scrollable; }

    /** true = panel dọc (màn ngang): item xếp theo −Y từ trên xuống */
    get vertical() { return this._vertical; }

    /** Độ dài thanh theo trục xếp item (local px): ngang = width, dọc = height */
    get length() {
        const cs = this.getComponent(UITransform)?.contentSize;
        if (!cs) return 1080;
        return this._vertical ? cs.height : cs.width;
    }

    private _touchId = -1;
    private _dragging = false;
    private _start = new Vec2();
    private _last = new Vec2();
    private _offset = 0;
    private _targetOffset = 0;
    private _scrollable = false;
    private _velocity = 0;       // local px / frame, quán tính sau khi thả
    private _vertical = false;
    private _tmpA = new Vec3();
    private _tmpB = new Vec3();
    private _fitKey = '';
    // trạng thái "nhà" (thanh ngang, như đặt trong scene) để trả lại khi về màn dọc
    private _homePos = new Vec3();
    private _homeContentPos = new Vec3();
    private _homeSize = new Size(1080, 344);

    onLoad() {
        if (!this.content) {
            this.content = new Node('Content');
            this.content.layer = this.node.layer;
            this.content.setParent(this.node);
        }
        this._homePos.set(this.node.position);
        this._homeContentPos.set(this.content.position);
        const cs = this.getComponent(UITransform)?.contentSize;
        if (cs) this._homeSize.set(cs.width, cs.height);
        if (this.fitWidthToScreen) this.fitLayout();
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

            // lần đầu vượt ngưỡng: quyết định NHẤC hay SCROLL theo góc kéo so với hướng nhấc
            const dir = new Vec2(cur.x - this._start.x, cur.y - this._start.y);
            const liftDir = this._vertical ? this.verticalLiftDir : Vec2.UNIT_Y;
            const angle = math.toDegree(Vec2.angle(dir, liftDir));   // 0 = đúng hướng nhấc, 90 = dọc theo thanh
            if (angle <= this.liftAngle) {
                const start = this._start.clone();
                this._touchId = -1;                       // nhả touch, thanh không scroll nữa
                this.node.emit(BottomBar.EVENT_LIFT, start);
                return;
            }

            if (!this._scrollable) { this._touchId = -1; return; }   // đủ chỗ → không kéo
            this._dragging = true;
            this._last.set(cur);
        }

        // dọc: item xếp theo −Y (ô đầu ở trên) → ngón tay đi lên = offset giảm
        const dPx = this._vertical ? -(cur.y - this._last.y) : (cur.x - this._last.x);
        const ppu = this.pixelsPerUnit();
        if (ppu > 0) {
            this._velocity = dPx / ppu;
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
        if (this.fitWidthToScreen) this.fitLayout();
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

    // ------------------------------------------------------------ fit / layout

    /** Chiều ngang màn hình đổi ra local px của thanh (camera ortho: 2·orthoHeight·aspect / worldScale.x) */
    screenWidthLocal(): number {
        const cam = this.camera();
        if (!cam) return this.getComponent(UITransform)?.contentSize.width ?? 1080;
        const size = view.getVisibleSize();
        const worldW = 2 * cam.orthoHeight * (size.width / size.height);
        return worldW / (this.node.worldScale.x || 1);
    }

    /** Chiều cao màn hình đổi ra local px của thanh */
    screenHeightLocal(): number {
        const cam = this.camera();
        if (!cam) return this.getComponent(UITransform)?.contentSize.height ?? 1080;
        return 2 * cam.orthoHeight / (this.node.worldScale.y || 1);
    }

    /**
     * Kích thước + vị trí thanh theo màn hình; chỉ tính lại khi camera/màn hình đổi.
     *  - ngang: width = màn, height/vị trí như trong scene
     *  - dọc  : width = panelFrac·màn, height = cao màn, bám mép phải, Content ở giữa panel
     */
    fitLayout() {
        const cam = this.camera();
        const ut = this.getComponent(UITransform);
        if (!cam || !ut || !this.content) return;
        const size = view.getVisibleSize();
        const vertical = this.autoVertical && size.width > size.height;
        const key = `${cam.orthoHeight}|${size.width}|${size.height}|${this.node.worldScale.x}|${vertical}|${this.panelFrac}`;
        if (key === this._fitKey) return;
        this._fitKey = key;
        const changed = vertical !== this._vertical;
        this._vertical = vertical;

        if (vertical) {
            const pw = this.screenWidthLocal() * this.panelFrac;
            const sh = this.screenHeightLocal();
            ut.setContentSize(pw, sh);
            this.content.setPosition(0, sh / 2, this._homeContentPos.z);
            this.dockRight(cam, pw);
        } else {
            ut.setContentSize(this.screenWidthLocal(), this._homeSize.height);
            this.content.setPosition(this._homeContentPos);
            this.node.setPosition(this._homePos);
        }
        if (changed) {
            this.resetScroll();
            this._touchId = -1; this._dragging = false;
            this.node.emit(BottomBar.EVENT_LAYOUT, vertical);
        }
    }

    /** Đặt gốc thanh (anchor 0.5,0 = giữa-đáy) tại mép phải-đáy màn hình trong camera space, giữ nguyên độ sâu */
    private dockRight(cam: Camera, panelLocalW: number) {
        const size = view.getVisibleSize();
        const halfH = cam.orthoHeight, halfW = halfH * size.width / size.height;
        const ws = this.node.worldScale.x || 1;
        const camMat = cam.node.worldMatrix;
        const inv = Mat4.invert(new Mat4(), camMat);
        const p = Vec3.transformMat4(new Vec3(), this.node.worldPosition, inv);
        p.x = halfW - panelLocalW * ws / 2;
        p.y = -halfH;
        Vec3.transformMat4(p, p, camMat);
        this.node.setWorldPosition(p);
    }

    // ------------------------------------------------------------ helpers

    private camera(): Camera | null {
        return this.cam ?? ui?.wCamera ?? null;
    }

    /** Số pixel màn hình ứng với 1 đơn vị local của content theo TRỤC THANH (X ngang / Y dọc) */
    pixelsPerUnit(): number {
        const cam = this.camera();
        if (!cam || !this.content) return 0;
        const mat = this.node.worldMatrix;
        const lp = this.content.position;
        const dx = this._vertical ? 0 : 1, dy = this._vertical ? 1 : 0;
        Vec3.transformMat4(this._tmpA, this._tmpA.set(lp.x, lp.y, lp.z), mat);
        Vec3.transformMat4(this._tmpB, this._tmpB.set(lp.x + dx, lp.y + dy, lp.z), mat);
        const a = cam.worldToScreen(this._tmpA, new Vec3());
        const b = cam.worldToScreen(this._tmpB, new Vec3());
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    /**
     * Touch có nằm trong dải content không (AABB screen-space quanh content):
     *  ngang: rộng = width thanh, cao = hitHeight;  dọc: rộng = width panel, cao = height thanh.
     */
    hitTest(p: Vec2): boolean {
        const cam = this.camera();
        if (!cam || !this.content) return true;
        const cs = this.getComponent(UITransform)?.contentSize ?? new Size(1080, 344);
        const c = this.content.position;
        const hw = cs.width / 2;
        const hh = this._vertical ? cs.height / 2 : this.hitHeight / 2;
        const mat = this.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const corners = [
            [c.x - hw, c.y - hh], [c.x + hw, c.y - hh],
            [c.x - hw, c.y + hh], [c.x + hw, c.y + hh],
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
