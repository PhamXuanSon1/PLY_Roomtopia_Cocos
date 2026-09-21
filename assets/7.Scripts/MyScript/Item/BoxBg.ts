import { _decorator, Camera, Component, Layers, UITransform, view } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * BoxBg: hộp nền (bo góc, màu tím) nằm SAU map 3D, chiếm `heightPercent` phía trên màn hình.
 *
 *  - BgCam (priority thấp nhất, chỉ vẽ layer BG) vẽ node này; WCam clear DEPTH_ONLY → map đè lên.
 *  - Node là CON của BgCam, scale 0.01 → local = camera space (100 px = 1 world unit).
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

    @property({ tooltip: 'Tràn lên trên bấy nhiêu px để giấu góc bo trên (0 = thấy góc bo)' })
    topOverflow = 100;

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

        const size = view.getVisibleSize();
        const k = 1 / (this.node.scale.x || 0.01);           // local px / world unit
        const screenH = 2 * cam.orthoHeight * k;
        const screenW = screenH * size.width / size.height;

        const top = screenH / 2 + this.topOverflow;
        const bottom = screenH / 2 - screenH * this.heightPercent / 100;
        const w = screenW - 2 * this.sideMargin;
        const h = top - bottom;

        const key = `${w.toFixed(2)}|${h.toFixed(2)}|${(top + bottom).toFixed(2)}`;
        if (key === this._key) return;
        this._key = key;

        ut.setContentSize(w, h);
        this.node.setPosition(0, (top + bottom) / 2 / k, this.node.position.z);
    }

    /**
     * Rect phần hộp NHÌN THẤY trên màn hình, trong camera space (world unit, gốc = tâm camera).
     * Dùng cho camera bất kỳ có cùng orthoHeight (WCam) → FitInBox căn map 3D vào hộp.
     */
    getCamRect(orthoHeight: number) {
        const size = view.getVisibleSize();
        const k = 1 / (this.node.scale.x || 0.01);
        const halfH = orthoHeight;
        const halfW = halfH * size.width / size.height;
        return {
            left:   Math.max(-halfW, -halfW + this.sideMargin / k),
            right:  Math.min( halfW,  halfW - this.sideMargin / k),
            top:    halfH,                                            // topOverflow tràn ra ngoài màn hình → cắt
            bottom: halfH - 2 * halfH * this.heightPercent / 100,
        };
    }
}
