import { _decorator, Camera, Component, Layers, Mat4, Node, UITransform, v3, Vec3, view } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * BoxBg: hộp nền (bo góc, màu tím) nằm SAU map 3D, chiếm `heightPercent` phía trên màn hình.
 *
 *  - BgCam (priority thấp nhất, chỉ vẽ layer BG) vẽ node này; WCam clear DEPTH_ONLY → map đè lên.
 *  - Node là CON của BgCam, scale 0.01 → local = camera space (100 px = 1 world unit).
 *  - Gán `frame` (node 3D có UITransform, vd BoxFrame) → hộp khớp đúng hình chiếu của khung đó qua WCam,
 *    bỏ qua heightPercent. BgCam & WCam cùng orthoHeight + aspect nên toạ độ camera space của 2 cam trùng nhau.
 */
@ccclass('BoxBg')
@executeInEditMode
export class BoxBg extends Component {
    static readonly LAYER_NAME = 'BG';
    static readonly LAYER_BIT = 2;
    static get layer() { return 1 << BoxBg.LAYER_BIT; }

    @property({ type: Camera, tooltip: 'Camera nền (BgCam). Để trống → Camera trên node cha' })
    cam: Camera | null = null;

    @property({ type: Camera, tooltip: 'Đồng bộ orthoHeight từ camera này (WCam) để khớp map khi UI.resize đổi orthoHeight' })
    syncOrthoFrom: Camera | null = null;

    @property({ range: [0, 100, 1], slide: true, tooltip: 'Hộp chiếm bao nhiêu % chiều cao màn hình, tính từ mép trên' })
    heightPercent = 60;

    @property({ tooltip: 'Lề trái/phải (px, 100px = 1 world unit). Âm = tràn ra ngoài để giấu góc bo' })
    sideMargin = 16;

    @property({ type: Node, tooltip: 'Khung 3D (có UITransform, vd BoxFrame) mà hộp phải khớp theo hình chiếu qua WCam. Để trống → dùng heightPercent' })
    frame: Node | null = null;

    @property({ tooltip: 'Tràn lên trên bấy nhiêu px để giấu góc bo trên (0 = thấy góc bo)' })
    topOverflow = 100;

    @property({ tooltip: 'Màn NGANG: bề ngang hộp = chiều cao màn × tỉ lệ này (1080/2350 = giống hộp ở màn dọc), căn giữa. 0 = phủ cả bề ngang' })
    landscapeWidthRatio = 1080 / 2350;

    @property({ type: Node, tooltip: 'Label đếm (con của node này): tự đặt ở đáy hộp + labelBottomPx, cùng layer BG' })
    countLabel: Node | null = null;

    @property({ tooltip: 'Label cách đáy hộp bao nhiêu px (local, 100 px = 1 world unit)' })
    labelBottomPx = 60;

    private _key = '';

    onLoad() {
        const existing = Layers.nameToLayer(BoxBg.LAYER_NAME);
        if (existing === undefined || existing < 0) Layers.addLayer(BoxBg.LAYER_NAME, BoxBg.LAYER_BIT);
        this.node.layer = BoxBg.layer;
        if (!this.cam) this.cam = this.node.parent?.getComponent(Camera) ?? null;
    }

    update() {
        this.fit();
    }

    fit() {
        const cam = this.cam;
        const ut = this.getComponent(UITransform);
        if (!cam || !ut) return;
        if (this.syncOrthoFrom && cam.orthoHeight !== this.syncOrthoFrom.orthoHeight) cam.orthoHeight = this.syncOrthoFrom.orthoHeight;

        const k = 1 / (this.node.scale.x || 0.01);           // local px / world unit
        const r = this.getCamRect(cam.orthoHeight, false);
        const w = (r.right - r.left) * k, h = (r.top - r.bottom) * k;
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;

        const key = `${w.toFixed(2)}|${h.toFixed(2)}|${cx.toFixed(3)}|${cy.toFixed(3)}|${this.labelBottomPx}|${this.countLabel?.uuid}`;
        if (key === this._key) return;
        this._key = key;

        ut.setContentSize(w, h);
        this.node.setPosition(cx, cy, this.node.position.z);
        this.placeLabel(h);
    }

    /** CountLabel nằm giữa theo ngang, cách đáy hộp labelBottomPx (local px của hộp) */
    private placeLabel(h: number) {
        const l = this.countLabel;
        if (!l) return;
        if (l.parent !== this.node) l.setParent(this.node, false);
        l.layer = this.node.layer;
        l.setRotationFromEuler(0, 0, 0);
        l.setScale(1, 1, 1);
        l.setPosition(0, -h / 2 + this.labelBottomPx, 1);        // z=1 → vẽ trước mặt hộp
    }

    /**
     * Rect của hộp trong camera space (world unit, gốc = tâm camera, cùng cho BgCam & WCam).
     *  - Có `frame` → AABB hình chiếu 4 góc UITransform của frame qua WCam (syncOrthoFrom).
     *  - Không → cả bề ngang màn hình, cao heightPercent từ mép trên.
     *  Đã trừ sideMargin, cộng topOverflow. clipToScreen = true → cắt theo màn hình (FitInBox dùng).
     */
    getCamRect(orthoHeight: number, clipToScreen = true) {
        const size = view.getVisibleSize();
        const k = 1 / (this.node.scale.x || 0.01);
        const halfH = orthoHeight;
        const halfW = halfH * size.width / size.height;
        let left = -halfW, right = halfW, top = halfH, bottom = halfH - 2 * halfH * this.heightPercent / 100;
        if (size.width > size.height && this.landscapeWidthRatio > 0) {          // màn ngang → hộp hẹp như màn dọc, giữa màn
            const hw = Math.min(halfW, halfH * this.landscapeWidthRatio);
            left = -hw; right = hw;
        }

        const fut = this.frame?.getComponent(UITransform);
        const wcam = this.syncOrthoFrom ?? this.cam;
        if (fut && wcam) {
            const inv = Mat4.invert(BoxBg._inv, wcam.node.worldMatrix);
            Mat4.multiply(inv, inv, this.frame!.worldMatrix);          // frame local → WCam space
            const { width: fw, height: fh } = fut.contentSize, a = fut.anchorPoint;
            left = bottom = Infinity; right = top = -Infinity;
            for (let i = 0; i < 4; i++) {
                const p = Vec3.transformMat4(BoxBg._p, BoxBg._p.set((i & 1 ? 1 - a.x : -a.x) * fw, (i & 2 ? 1 - a.y : -a.y) * fh, 0), inv);
                left = Math.min(left, p.x); right = Math.max(right, p.x);
                bottom = Math.min(bottom, p.y); top = Math.max(top, p.y);
            }
        }
        left += this.sideMargin / k; right -= this.sideMargin / k; top += this.topOverflow / k;
        if (clipToScreen) {
            left = Math.max(left, -halfW); right = Math.min(right, halfW);
            top = Math.min(top, halfH); bottom = Math.max(bottom, -halfH);
        }
        return { left, right, top, bottom };
    }

    private static readonly _inv = new Mat4();
    private static readonly _p = v3();
}
