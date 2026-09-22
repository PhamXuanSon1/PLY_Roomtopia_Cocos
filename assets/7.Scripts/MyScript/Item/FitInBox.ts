import { _decorator, Camera, Component, DirectionalLight, Layers, Mat4, MeshRenderer, Node, Rect, SphereLight, SpotLight, v3, Vec3, view } from 'cc';
import { BoxBg } from './BoxBg';
import { EDITOR } from 'cc/env';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * FitInBox: giữ node (Lv50_Bathroom_Root) LUÔN nằm gọn trong BoxBg.
 *
 *  Chỉ fit khi màn hình / orthoHeight / hộp đổi (KHÔNG fit theo từng frame xoay → không giật).
 *  Bounds = hợp của bounds ở nhiều góc xoay Y của `rotator` → xoay kiểu gì cũng không lòi ra hộp.
 *  Chiếu bounds mọi MeshRenderer con lên camera space của WCam (ortho), rồi scale (quanh gốc node)
 *  + dời node để bounds nằm trong rect BoxBg (trừ padding).
 *
 *  Chỉ thu nhỏ so với scale gốc (đặt trong editor), không phóng to, trừ khi bật allowUpscale.
 */
@ccclass('FitInBox')
@executeInEditMode
export class FitInBox extends Component {
    @property({ type: Camera, tooltip: 'Camera 3D vẽ map (WCam)' })
    cam: Camera | null = null;

    @property({ type: BoxBg, tooltip: 'Hộp nền cần nằm gọn trong' })
    box: BoxBg | null = null;

    @property({ type: Node, tooltip: 'Node bị ModelRotate xoay quanh Y. Bounds lấy hợp mọi góc xoay của node này' })
    rotator: Node | null = null;

    @property({ tooltip: 'Số góc xoay lấy mẫu để tính bounds (càng nhiều càng chính xác)' })
    rotationSamples = 24;

    @property({ tooltip: 'Lề trong hộp (world unit)' })
    padding = 0.2;

    @property({ tooltip: 'Cho phép phóng to hơn scale gốc để lấp đầy hộp' })
    allowUpscale = false;

    @property({ tooltip: 'Màn ngang: luôn phóng to/thu nhỏ cho lấp đầy vùng chơi (room to như ảnh tham chiếu)' })
    landscapeUpscale = true;

    @property({ range: [0, 1, 0.01], slide: true, tooltip: 'Vị trí ngang trong hộp: 0 = sát trái, 0.5 = giữa, 1 = sát phải' })
    anchorX = 0.5;

    @property({ range: [0, 1, 0.01], slide: true, tooltip: 'Vị trí dọc trong hộp: 0 = sát đáy, 0.5 = giữa, 1 = sát đỉnh' })
    anchorY = 0.5;

    @property({ group: 'Portrait', range: [0.5, 2, 0.05], slide: true, tooltip: 'Màn DỌC: nhân thêm scale sau khi fit (1 = vừa hộp theo bounds mọi góc xoay; >1 = to hơn, chấp nhận lòi hộp ở vài góc xoay)' })
    portraitScale = 1;

    @property({ group: 'Portrait', tooltip: 'Màn DỌC: chỉ fit theo góc xoay HIỆN TẠI thay vì hợp mọi góc xoay → room to hơn (bounds hợp mọi góc là hình vuông rộng hơn góc nhìn thật)' })
    portraitFitCurrentRotation = true;

    @property({ group: 'Landscape', range: [0.5, 2, 0.05], slide: true, tooltip: 'Màn NGANG: nhân thêm scale sau khi fit' })
    landscapeScale = 1;

    @property({ group: 'Clip', tooltip: 'Room chỉ hiện trong vùng BoxBg: room chuyển sang layer ROOM và vẽ bằng camera phụ RoomCam có viewport = rect hộp (crop cứng, không lòi ra ngoài)' })
    clipToBox = true;

    static readonly ROOM_LAYER_NAME = 'ROOM';
    static readonly ROOM_LAYER_BIT = 2;
    static get roomLayer() { return 1 << FitInBox.ROOM_LAYER_BIT; }

    private roomCam: Camera | null = null;

    private baseScale = 1;
    private _key = '';
    private meshes: { node: Node; min: Vec3; max: Vec3 }[] = [];

    private static readonly _m = new Mat4();
    private static readonly _inv = new Mat4();
    private static readonly _p = v3();

    onLoad() {
        this.baseScale = this.node.scale.x || 1;
        this.collect();
        if (this.clipToBox && !EDITOR) {
            const existing = Layers.nameToLayer(FitInBox.ROOM_LAYER_NAME);
            if (existing === undefined || existing < 0) Layers.addLayer(FitInBox.ROOM_LAYER_NAME, FitInBox.ROOM_LAYER_BIT);
            FitInBox.setLayerRecursive(this.node, FitInBox.roomLayer);
            // Đèn có mask visibility riêng (scene: DEFAULT|TRAY) → model ở layer ROOM sẽ bị receiveDirLight = false.
            // Thêm ROOM vào mask mọi đèn để room vẫn nhận sáng/bóng như khi còn ở DEFAULT.
            const scene = this.node.scene;
            if (scene) {
                for (const l of scene.getComponentsInChildren(DirectionalLight)) l.visibility |= FitInBox.roomLayer;
                for (const l of scene.getComponentsInChildren(SphereLight)) l.visibility |= FitInBox.roomLayer;
                for (const l of scene.getComponentsInChildren(SpotLight)) l.visibility |= FitInBox.roomLayer;
            }
        }
    }

    static setLayerRecursive(n: Node, layer: number) {
        n.layer = layer;
        for (const c of n.children) FitInBox.setLayerRecursive(c, layer);
    }

    /** Camera phụ vẽ layer ROOM, con của WCam. Viewport + orthoHeight + offset = đúng rect hộp → phần room ngoài hộp bị cắt */
    private syncRoomCam(cam: Camera, box: BoxBg) {
        if (EDITOR || !this.clipToBox) return;
        if (!this.roomCam?.isValid) {
            const n = new Node('RoomCam');
            n.setParent(cam.node, false);
            n.layer = cam.node.layer;
            const c = n.addComponent(Camera);
            c.priority = cam.priority + 1;              // sau WCam (nền BoxBg đã vẽ), trước FxCam (+2)
            // ROOM + DEFAULT: pipeline chỉ dựng shadow map cho camera có bit DEFAULT trong visibility (engine check
            // `camera.visibility & DEFAULT`), thiếu nó room mất bóng. Object DEFAULT lọt trong viewport hộp (BoxBg, viền...)
            // bị vẽ lại y hệt (depth-test với room) — vô hại; thanh item nằm ngoài viewport nên bị cắt.
            c.visibility = FitInBox.roomLayer | Layers.Enum.DEFAULT;
            c.clearFlags = Camera.ClearFlag.DONT_CLEAR;
            this.roomCam = c;
            // WCam không vẽ layer ROOM nữa (tránh vẽ 2 lần / lòi ra ngoài hộp)
            cam.visibility &= ~FitInBox.roomLayer;
        }
        const c = this.roomCam!;
        const size = view.getVisibleSize();
        const halfH = cam.orthoHeight, halfW = halfH * size.width / size.height;
        const r = box.getCamRect(cam.orthoHeight, true, true);        // vùng chơi (đã cắt theo màn, màn ngang trừ panel)
        const w = r.right - r.left, h = r.top - r.bottom;
        if (w <= 0 || h <= 0) { c.enabled = false; return; }
        c.enabled = true;
        c.projection = cam.projection;
        c.fovAxis = cam.fovAxis;
        c.fov = cam.fov;
        c.near = cam.near;
        c.far = cam.far;
        c.targetTexture = cam.targetTexture;
        c.orthoHeight = h / 2;
        c.node.setPosition((r.left + r.right) / 2, (r.top + r.bottom) / 2, 0);   // cam-space offset = tâm hộp
        c.rect = new Rect((r.left + halfW) / (2 * halfW), (r.bottom + halfH) / (2 * halfH), w / (2 * halfW), h / (2 * halfH));
    }

    /** Gom mesh con 1 lần (mesh đặt thêm sau vẫn nằm trong phòng nên không cần gom lại) */
    collect() {
        this.meshes = [];
        this.node.getComponentsInChildren(MeshRenderer).forEach(mr => {
            const st = mr.mesh?.struct;
            if (!st || !st.minPosition || !st.maxPosition) return;
            // minPosition/maxPosition đôi khi không phải instance Vec3 thật (vd mesh qua meshopt/quantization) → không có .clone()
            const mn = st.minPosition, mx = st.maxPosition;
            this.meshes.push({ node: mr.node, min: v3(mn.x, mn.y, mn.z), max: v3(mx.x, mx.y, mx.z) });
        });
    }

    lateUpdate() {
        const cam = this.cam, box = this.box;
        if (!cam || !box) return;
        const size = view.getVisibleSize();
        const key = `${size.width}|${size.height}|${cam.orthoHeight}|${box.heightPercent}|${box.sideMargin}|${this.padding}|${this.portraitScale}|${this.landscapeScale}|${this.portraitFitCurrentRotation}`;
        if (key === this._key) return;
        this._key = key;
        this.fit();
        this.syncRoomCam(cam, box);
    }

    /** Bounds (cam space) của map ở góc xoay HIỆN TẠI, cộng dồn vào b */
    private accumBounds(inv: Mat4, b: { minX: number; maxX: number; minY: number; maxY: number }) {
        const m = FitInBox._m, p = FitInBox._p;
        for (const { node, min, max } of this.meshes) {
            if (!node.isValid || !node.activeInHierarchy) continue;
            Mat4.multiply(m, inv, node.worldMatrix);
            for (let i = 0; i < 8; i++) {
                p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
                Vec3.transformMat4(p, p, m);
                if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
                if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
            }
        }
    }

    fit() {
        const cam = this.cam, box = this.box;
        if (!cam || !box || !this.meshes.length) return;

        // ---- bounds của map trong camera space: hợp mọi góc xoay Y của rotator ----
        const inv = Mat4.invert(FitInBox._inv, cam.node.worldMatrix);
        const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        const rot = this.rotator;
        const sampleRot = !(this.portraitFitCurrentRotation && !box.landscape);
        if (rot && this.rotationSamples > 1 && sampleRot) {
            const e = rot.eulerAngles.clone();
            for (let i = 0; i < this.rotationSamples; i++) {
                rot.setRotationFromEuler(e.x, i * 360 / this.rotationSamples, e.z);
                this.accumBounds(inv, b);
            }
            rot.setRotationFromEuler(e.x, e.y, e.z);
        } else {
            this.accumBounds(inv, b);
        }
        const { minX, maxX, minY, maxY } = b;
        if (!isFinite(minX)) return;

        // ---- rect hộp (đã trừ padding) ----
        const r = box.getCamRect(cam.orthoHeight, true, true);      // vùng chơi (màn ngang trừ panel item)
        const bw = r.right - r.left - 2 * this.padding;
        const bh = r.top - r.bottom - 2 * this.padding;
        if (bw <= 0 || bh <= 0) return;

        // ---- scale quanh gốc node ----
        const s0 = this.node.scale.x || 1;
        let s = s0 * Math.min(bw / (maxX - minX), bh / (maxY - minY));
        const upscale = this.allowUpscale || (this.landscapeUpscale && box.landscape);
        if (!upscale) s = Math.min(s, this.baseScale);
        s *= box.landscape ? this.landscapeScale : this.portraitScale;
        const k = s / s0;

        const o = Vec3.transformMat4(FitInBox._p, this.node.worldPosition, inv);   // gốc node trong cam space
        const nMinX = o.x + (minX - o.x) * k, nMaxX = o.x + (maxX - o.x) * k;
        const nMinY = o.y + (minY - o.y) * k, nMaxY = o.y + (maxY - o.y) * k;

        // ---- dời để bounds nằm trong hộp theo anchor ----
        const dx = (r.left + this.padding + (bw - (nMaxX - nMinX)) * this.anchorX) - nMinX;
        const dy = (r.bottom + this.padding + (bh - (nMaxY - nMinY)) * this.anchorY) - nMinY;
        if (Math.abs(k - 1) < 1e-6 && Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) return;

        const right = Vec3.transformQuat(v3(), Vec3.RIGHT, cam.node.worldRotation);
        const up = Vec3.transformQuat(v3(), Vec3.UP, cam.node.worldRotation);
        const wp = this.node.worldPosition.clone().add(right.multiplyScalar(dx)).add(up.multiplyScalar(dy));

        if (Math.abs(k - 1) >= 1e-6) this.node.setScale(s, s, s);
        this.node.setWorldPosition(wp);
    }
}
