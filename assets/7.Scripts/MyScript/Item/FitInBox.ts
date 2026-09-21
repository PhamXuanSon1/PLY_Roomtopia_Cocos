import { _decorator, Camera, Component, Mat4, MeshRenderer, Node, v3, Vec3, view } from 'cc';
import { BoxBg } from './BoxBg';
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

    private baseScale = 1;
    private _key = '';
    private meshes: { node: Node; min: Vec3; max: Vec3 }[] = [];

    private static readonly _m = new Mat4();
    private static readonly _inv = new Mat4();
    private static readonly _p = v3();

    onLoad() {
        this.baseScale = this.node.scale.x || 1;
        this.collect();
    }

    /** Gom mesh con 1 lần (mesh đặt thêm sau vẫn nằm trong phòng nên không cần gom lại) */
    collect() {
        this.meshes = [];
        this.node.getComponentsInChildren(MeshRenderer).forEach(mr => {
            const st = mr.mesh?.struct;
            if (!st || !st.minPosition || !st.maxPosition) return;
            this.meshes.push({ node: mr.node, min: st.minPosition.clone(), max: st.maxPosition.clone() });
        });
    }

    lateUpdate() {
        const cam = this.cam, box = this.box;
        if (!cam || !box) return;
        const size = view.getVisibleSize();
        const key = `${size.width}|${size.height}|${cam.orthoHeight}|${box.heightPercent}|${box.sideMargin}|${this.padding}`;
        if (key === this._key) return;
        this._key = key;
        this.fit();
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
        if (rot && this.rotationSamples > 1) {
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
