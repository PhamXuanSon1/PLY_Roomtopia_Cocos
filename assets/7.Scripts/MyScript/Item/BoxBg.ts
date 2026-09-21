import { _decorator, Camera, Component, Layers, Mat4, Node, UITransform, v3, Vec3, view } from 'cc';
import { LANDSCAPE_PANEL_FRAC } from '../Config/TrayConfig';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * BoxBg: hộp nền (bo góc, màu tím) nằm SAU map 3D, chiếm `heightPercent` phía trên màn hình.
 *
 *  - BgCam (priority thấp nhất, chỉ vẽ layer BG) vẽ node này; WCam clear DEPTH_ONLY → map đè lên.
 *  - Node là CON của BgCam, scale 0.01 → local = camera space (100 px = 1 world unit).
 *  - Gán `frame` (node 3D có UITransform, vd BoxFrame) → hộp khớp đúng hình chiếu của khung đó qua WCam,
 *    bỏ qua heightPercent. BgCam & WCam cùng orthoHeight + aspect nên toạ độ camera space của 2 cam trùng nhau.
 *  - Màn NGANG (landscapeFullScreen): hộp phủ cả màn (tràn ra ngoài để giấu góc bo); "vùng chơi" cho FitInBox /
 *    CountLabel = màn trừ panel item dọc bên phải (landscapePanelFrac).
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

    @property({ group: 'Landscape', tooltip: 'Màn ngang: hộp phủ cả màn hình (vẫn trừ sideMargin, cộng topOverflow như màn dọc)' })
    landscapeFullScreen = true;

    @property({ group: 'Landscape', tooltip: 'Màn ngang: hộp cách đáy màn bấy nhiêu px (âm = tràn xuống để giấu góc bo)' })
    landscapeBottomMargin = -100;

    @property({ group: 'Landscape', tooltip: 'Màn ngang: nền panel item tràn ra ngoài màn bấy nhiêu px để giấu góc bo' })
    landscapeOverflow = 100;

    @property({ group: 'Landscape', range: [0, 0.6, 0.01], slide: true, tooltip: 'Màn ngang: panel item dọc bên phải chiếm bao nhiêu phần bề ngang → vùng chơi = phần còn lại (khớp BottomBar.panelFrac)' })
    landscapePanelFrac = LANDSCAPE_PANEL_FRAC;

    @property({ group: 'Landscape', type: Node, tooltip: 'Nền trắng panel item (Sprite, em kế sau BoxBg dưới BgCam, scale 0.01). Chỉ hiện màn ngang, tự đặt phủ vùng panel + overflow' })
    panelBg: Node | null = null;

    @property({ type: Node, tooltip: 'Label đếm (con của node này): tự đặt ở đáy hộp + labelBottomPx, cùng layer BG' })
    countLabel: Node | null = null;

    @property({ group: 'Border', type: Node, tooltip: 'Sprite viền (em đứng TRƯỚC BoxBg dưới BgCam, scale 0.01). Tự đặt to hơn hộp borderPx mỗi bên, nằm sau hộp → thành viền' })
    borderNode: Node | null = null;

    @property({ group: 'Border', tooltip: 'Độ dày viền (px local, 100 px = 1 world unit). 0 = ẩn viền' })
    borderPx = 10;

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

        const key = `${w.toFixed(2)}|${h.toFixed(2)}|${cx.toFixed(3)}|${cy.toFixed(3)}|${this.labelBottomPx}|${this.countLabel?.uuid}|${this.borderPx}|${this.borderNode?.uuid}`;
        if (key === this._key) return;
        this._key = key;

        ut.setContentSize(w, h);
        this.node.setPosition(cx, cy, this.node.position.z);
        this.placeLabel(cx, cy, k);
        this.placePanelBg(cam.orthoHeight, k);
        this.placeBorder(w, h, cx, cy);
    }

    /** Viền: sprite trắng to hơn hộp borderPx mỗi bên, vẽ TRƯỚC hộp (sibling đứng trước) → chỉ lòi phần mép */
    private placeBorder(w: number, h: number, cx: number, cy: number) {
        const b = this.borderNode;
        if (!b) return;
        const on = this.borderPx > 0;
        b.active = on;
        if (!on) return;
        if (b.parent !== this.node.parent && this.node.parent) b.setParent(this.node.parent, false);
        if (b.getSiblingIndex() > this.node.getSiblingIndex()) b.setSiblingIndex(this.node.getSiblingIndex());
        b.layer = this.node.layer;
        b.setScale(this.node.scale);
        b.getComponent(UITransform)?.setContentSize(w + 2 * this.borderPx, h + 2 * this.borderPx);
        b.setPosition(cx, cy, this.node.position.z);
    }

    /** Nền panel item bên phải (màn ngang): từ mép vùng chơi tới hết màn, tràn overflow để giấu góc bo */
    private placePanelBg(orthoHeight: number, k: number) {
        const bg = this.panelBg;
        if (!bg) return;
        const on = this.landscape && this.landscapePanelFrac > 0;
        bg.active = on;
        if (!on) return;
        const size = view.getVisibleSize();
        const halfH = orthoHeight, halfW = halfH * size.width / size.height, o = this.landscapeOverflow / k;
        const left = halfW - 2 * halfW * this.landscapePanelFrac, right = halfW + o, top = halfH + o, bottom = -halfH - o;
        bg.layer = this.node.layer;
        bg.setScale(this.node.scale);
        bg.getComponent(UITransform)?.setContentSize((right - left) * k, (top - bottom) * k);
        bg.setPosition((left + right) / 2, (top + bottom) / 2, this.node.position.z);
    }

    /** CountLabel: giữa vùng chơi theo ngang, cách đáy vùng chơi labelBottomPx (local px của hộp) */
    private placeLabel(cx: number, cy: number, k: number) {
        const l = this.countLabel;
        if (!l || !this.cam) return;
        if (l.parent !== this.node) l.setParent(this.node, false);
        l.layer = this.node.layer;
        l.setRotationFromEuler(0, 0, 0);
        l.setScale(1, 1, 1);
        const pr = this.getCamRect(this.cam.orthoHeight, true, true);
        l.setPosition(((pr.left + pr.right) / 2 - cx) * k, (pr.bottom - cy) * k + this.labelBottomPx, 1);   // z=1 → trước mặt hộp
    }

    /** Màn ngang? */
    get landscape() {
        const size = view.getVisibleSize();
        return size.width > size.height;
    }

    /**
     * Rect của hộp trong camera space (world unit, gốc = tâm camera, cùng cho BgCam & WCam).
     *  - Màn ngang + landscapeFullScreen → cả màn (đáy + landscapeBottomMargin).
     *  - Có `frame` → AABB hình chiếu 4 góc UITransform của frame qua WCam (syncOrthoFrom).
     *  - Không → cả bề ngang màn hình, cao heightPercent từ mép trên.
     *  Đã trừ sideMargin, cộng topOverflow. clipToScreen = true → cắt theo màn hình (FitInBox dùng).
     *  playArea = true → màn ngang trừ thêm panel item bên phải (vùng đặt room / label).
     */
    getCamRect(orthoHeight: number, clipToScreen = true, playArea = false) {
        const size = view.getVisibleSize();
        const k = 1 / (this.node.scale.x || 0.01);
        const halfH = orthoHeight;
        const halfW = halfH * size.width / size.height;
        const landscape = size.width > size.height;
        const full = landscape && this.landscapeFullScreen;
        let left = -halfW, right = halfW, top = halfH, bottom = halfH - 2 * halfH * this.heightPercent / 100;

        const fut = this.frame?.getComponent(UITransform);
        const wcam = this.syncOrthoFrom ?? this.cam;
        if (full) {
            bottom = -halfH + this.landscapeBottomMargin / k;
        } else if (fut && wcam) {
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
        if (playArea && landscape) right = Math.min(right, halfW - 2 * halfW * this.landscapePanelFrac);
        return { left, right, top, bottom };
    }

    private static readonly _inv = new Mat4();
    private static readonly _p = v3();
}
