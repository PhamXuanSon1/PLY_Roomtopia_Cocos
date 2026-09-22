import { _decorator, Camera, Component, EventTouch, math, MeshRenderer, Node, UITransform, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * ZoomSlider: thanh trượt dọc (+ trên, − dưới) phóng to / thu nhỏ phòng.
 *
 *  - Zoom = nhân scale của `model` (root phòng, node có FitInBox) quanh TÂM bbox của phòng (không phải pivot)
 *    → phòng to/nhỏ tại chỗ, không trôi. Không đụng WCam.orthoHeight vì tray / label / BgCam đều bám theo camera đó.
 *  - FitInBox có thể set lại scale khi resize → lateUpdate phát hiện scale bị đổi từ bên ngoài,
 *    coi đó là scale gốc mới rồi nhân zoom lại.
 *  - Tự bắt touch trên node này (không dùng cc.Slider: nó đổi touch → toạ độ theo Canvas/design resolution,
 *    UI ở đây vẽ bằng UICam ortho riêng nên progress nhảy thẳng min→max). Touch chuyển qua uiCam.screenToWorld
 *    → local của node → progress theo trục Y của UITransform. Kéo/chạm bất kỳ đâu trên thanh đều được.
 *  - Handle chỉ là Sprite (không Button, để touch lọt xuống node thanh), tự đặt y theo progress.
 */
@ccclass('ZoomSlider')
export class ZoomSlider extends Component {
    @property({ type: Node, tooltip: 'Root phòng (Gameplay/Lv50_Bathroom_Root)' })
    model: Node | null = null;

    @property({ type: Node, tooltip: 'Node handle (con của thanh). Tự đặt y theo progress' })
    handle: Node | null = null;

    @property({ type: Camera, tooltip: 'UICam vẽ thanh này (đổi touch → toạ độ UI). Để trống → ui.uiCamera' })
    uiCam: Camera | null = null;

    @property({ tooltip: 'Zoom nhỏ nhất (handle ở đáy)' })
    minZoom = 0.8;

    @property({ tooltip: 'Zoom lớn nhất (handle ở đỉnh)' })
    maxZoom = 1.2;

    @property({ tooltip: 'Mỗi lần bấm +/− đổi bấy nhiêu zoom' })
    step = 0.1;

    @property({ tooltip: 'Zoom lúc vào game (1 = scale gốc). Handle tự nằm đúng tỉ lệ trên thanh (0.8→1.2, start 1 → giữa)' })
    startZoom = 1;

    private _zoom = 1;
    private _base = 1;              // scale gốc của model (do FitInBox / editor đặt)
    private _lastSet = NaN;         // scale mình vừa set → nhận ra khi ai đó đổi scale
    private _basePos = new Vec3();  // world pos gốc của model (lúc scale gốc)
    private _lastPos = new Vec3(NaN, NaN, NaN);   // world pos mình vừa set → nhận ra khi FitInBox dời
    private _centerOff = new Vec3();// tâm bbox − pivot (world, ở scale gốc)
    private _tmp = new Vec3();
    private _tmp2 = new Vec3();
    private _touchId = -1;

    get zoom() { return this._zoom; }
    get progress() { return this.maxZoom > this.minZoom ? (this._zoom - this.minZoom) / (this.maxZoom - this.minZoom) : 0; }

    onLoad() {
        if (EDITOR) return;
        if (!this.handle) this.handle = this.node.getChildByName('Handle');     // chưa gán trong Inspector → lấy con "Handle"
        if (this.model) { this._base = this.model.scale.x; this._lastSet = NaN; }
        this.setZoom(this.startZoom);
    }

    onEnable() {
        if (EDITOR) return;
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        if (EDITOR) return;
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        this._touchId = -1;
    }

    lateUpdate() {
        if (EDITOR || !this.model) return;
        const m = this.model;
        const cur = m.scale.x, wp = m.worldPosition;
        // FitInBox / resize vừa set scale hoặc pos gốc mới → ghi lại base + tâm bbox ở base
        const extScale = cur !== this._lastSet;
        const extPos = !wp.equals(this._lastPos, 1e-6);
        if (extScale || extPos) {
            if (extScale) this._base = cur;
            // pos gốc = pos hiện tại quy về scale gốc (nếu chỉ scale bị đổi thì pos hiện tại đã là pos gốc)
            this._basePos.set(wp);
            if (!extScale && cur !== this._base) {
                // ai đó dời model khi đang zoom → suy ngược pos gốc từ tâm cố định
                const f = cur / this._base;
                this._basePos.set(wp.x + this._centerOff.x * (f - 1), wp.y + this._centerOff.y * (f - 1), wp.z + this._centerOff.z * (f - 1));
            }
            this.captureCenter();
        }
        const s = this._base * this._zoom;
        // pivot mới sao cho tâm bbox đứng yên: pivot = basePos + centerOff·(1 − zoom)
        const k = 1 - this._zoom;
        this._tmp2.set(this._basePos.x + this._centerOff.x * k, this._basePos.y + this._centerOff.y * k, this._basePos.z + this._centerOff.z * k);
        if (Math.abs(cur - s) > 1e-6) m.setScale(this._tmp.set(s, s, s));
        if (!m.worldPosition.equals(this._tmp2, 1e-6)) m.setWorldPosition(this._tmp2);
        this._lastSet = s;
        this._lastPos.set(m.worldPosition);
    }

    /** tâm bbox (world) của mọi mesh trong model − pivot, quy về scale gốc */
    private captureCenter() {
        const m = this.model!;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const t = this._tmp;
        for (const mr of m.getComponentsInChildren(MeshRenderer)) {
            const st = mr.mesh?.struct;
            if (!st?.minPosition || !st.maxPosition || !mr.node.activeInHierarchy) continue;
            const lo = st.minPosition, hi = st.maxPosition, mat = mr.node.worldMatrix;
            for (let i = 0; i < 8; i++) {
                t.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
                Vec3.transformMat4(t, t, mat);
                minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
                minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
                minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
            }
        }
        if (!isFinite(minX)) { this._centerOff.set(0, 0, 0); return; }
        const wp = m.worldPosition, f = this._base / (m.scale.x || 1);   // quy về scale gốc
        this._centerOff.set(((minX + maxX) / 2 - wp.x) * f, ((minY + maxY) / 2 - wp.y) * f, ((minZ + maxZ) / 2 - wp.z) * f);
    }

    // ------------------------------------------------------------ touch: kéo dọc trên thanh
    private onTouchStart(e: EventTouch) {
        if (this._touchId !== -1) return;
        this._touchId = e.getID();
        this.setProgress(this.progressAt(e));
    }

    private onTouchMove(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        this.setProgress(this.progressAt(e));
    }

    private onTouchEnd(e: EventTouch) {
        if (e.getID() === this._touchId) this._touchId = -1;
    }

    /** touch (px màn hình) → progress 0..1 theo chiều cao UITransform của thanh */
    private progressAt(e: EventTouch): number {
        const cam = this.uiCam ?? ui?.uiCamera;
        const ut = this.getComponent(UITransform);
        if (!cam || !ut) return this.progress;
        const loc = e.getLocation();
        cam.screenToWorld(this._tmp.set(loc.x, loc.y, 0), this._tmp);
        this.node.inverseTransformPoint(this._tmp, this._tmp);
        const h = ut.contentSize.height, bottom = -ut.anchorY * h;
        return h > 0 ? math.clamp((this._tmp.y - bottom) / h, 0, 1) : 0;
    }

    // ------------------------------------------------------------ zoom
    onPlus() { this.setZoom(this._zoom + this.step); }
    onMinus() { this.setZoom(this._zoom - this.step); }

    setProgress(p: number) {
        this.setZoom(math.lerp(this.minZoom, this.maxZoom, math.clamp(p, 0, 1)));
    }

    setZoom(z: number) {
        this._zoom = math.clamp(z, this.minZoom, this.maxZoom);
        this.placeHandle();
    }

    private placeHandle() {
        const h = this.handle, ut = this.getComponent(UITransform);
        if (!h || !ut) return;
        const H = ut.contentSize.height, bottom = -ut.anchorY * H;
        h.setPosition(h.position.x, bottom + H * this.progress, h.position.z);
    }
}
