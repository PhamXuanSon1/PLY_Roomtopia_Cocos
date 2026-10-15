import { _decorator, Camera, CCObject, Color, Component, director, Enum, gfx, Layers, Mat4, Material, Mesh, MeshRenderer, Node, Size, UITransform, utils, Vec3, view } from 'cc';
import { EDITOR } from 'cc/env';
import { BottomBar } from '../Item/BottomBar';
import { BoxBg } from '../Item/BoxBg';
import { FitInBox } from '../Item/FitInBox';
import { ItemController } from '../Item/ItemController';
import { ItemManager } from '../Manager/ItemManager';
import { PreviewScreen } from './PreviewScreen';
const { ccclass, property, executeInEditMode } = _decorator;

export enum PreviewOrientation { Portrait = 0, Landscape = 1 }
Enum(PreviewOrientation);

/** Kích thước màn DỌC (rộng × cao); Landscape tự đảo */
export enum PreviewDevice { Design = 0, Phone_9x16 = 1, Phone_9x19_5 = 2, Tablet_3x4 = 3, Custom = 4 }
Enum(PreviewDevice);

const DEVICE_SIZES: Record<number, [number, number]> = {
    [PreviewDevice.Phone_9x16]: [1080, 1920],
    [PreviewDevice.Phone_9x19_5]: [1080, 2340],
    [PreviewDevice.Tablet_3x4]: [1536, 2048],
};

/**
 * EditorPreview — CHỈ chạy trong editor (lúc chạy không làm gì). Gắn vào 1 node bất kỳ trong scene.
 *
 *  1. Xem trước màn hình: chọn dọc/ngang + thiết bị → BoxBg, FitInBox, BottomBar, ItemManager, ZoomSlider dựng layout
 *     đúng như trên thiết bị đó ngay trong Scene editor (qua PreviewScreen), WCam.orthoHeight cũng theo công thức của UI.resize.
 *  2. Gizmo (đường kẻ, không lưu vào scene, luôn nổi trên cùng):
 *     - trắng : khung màn hình (vùng WCam nhìn thấy)
 *     - vàng  : hộp BoxBg          - xanh lá: vùng đặt phòng (vùng chơi − padding của FitInBox)
 *     - cyan  : bounds phòng       - xanh dương: thanh BottomBar   - hồng: dải chạm kéo của thanh
 *     - cam   : giới hạn cull ô    - đỏ: bán kính snap của từng target (snapPx + nửa bbox)
 *
 *  Lưu ý: chuyển về Portrait trước khi Save nếu muốn scene lưu đúng trạng thái màn dọc (lúc chạy vẫn tự layout lại).
 */
@ccclass('EditorPreview')
@executeInEditMode
export class EditorPreview extends Component {
    @property({ type: PreviewOrientation, tooltip: 'Xem trước màn dọc / ngang' })
    orientation = PreviewOrientation.Portrait;

    @property({ type: PreviewDevice, tooltip: 'Tỉ lệ màn hình xem trước (Design = Design Resolution của project)' })
    device = PreviewDevice.Design;

    @property({ tooltip: 'Kích thước màn DỌC (rộng, cao) khi device = Custom', visible(this: EditorPreview) { return this.device === PreviewDevice.Custom; } })
    customSize = new Size(1080, 1920);

    @property({ type: Camera, tooltip: 'WCam (camera vẽ map + thanh). Để trống → lấy theo BoxBg / FitInBox / BottomBar' })
    wCam: Camera | null = null;

    @property({ tooltip: 'Đặt WCam.orthoHeight theo màn xem trước (giống UI.resize lúc chạy)' })
    syncCameraOrtho = true;

    @property({ group: 'Gizmos', tooltip: 'Vẽ đường kẻ các vùng layout trong Scene editor' })
    showGizmos = true;

    @property({ group: 'Gizmos', displayName: 'Screen (trắng)', visible(this: EditorPreview) { return this.showGizmos; } })
    gizmoScreen = true;

    @property({ group: 'Gizmos', displayName: 'Box + play area (vàng / xanh lá)', visible(this: EditorPreview) { return this.showGizmos; } })
    gizmoBox = true;

    @property({ group: 'Gizmos', displayName: 'Room bounds (cyan)', visible(this: EditorPreview) { return this.showGizmos; } })
    gizmoRoom = true;

    @property({ group: 'Gizmos', displayName: 'Bar + hit + cull (xanh / hồng / cam)', visible(this: EditorPreview) { return this.showGizmos; } })
    gizmoBar = true;

    @property({ group: 'Gizmos', displayName: 'Snap radius (đỏ)', visible(this: EditorPreview) { return this.showGizmos; } })
    gizmoSnap = false;

    @property({ group: 'Refs', type: BoxBg, tooltip: 'Để trống → tự tìm trong scene' })
    box: BoxBg | null = null;

    @property({ group: 'Refs', type: FitInBox, tooltip: 'Để trống → tự tìm trong scene' })
    fit: FitInBox | null = null;

    @property({ group: 'Refs', type: BottomBar, tooltip: 'Để trống → tự tìm trong scene' })
    bar: BottomBar | null = null;

    @property({ group: 'Refs', type: ItemManager, tooltip: 'Để trống → tự tìm trong scene' })
    items: ItemManager | null = null;

    private static readonly GIZMO_NAME = '__EditorPreviewGizmo';
    private static readonly C_SCREEN = new Color(255, 255, 255, 255);
    private static readonly C_BOX = new Color(255, 214, 0, 255);
    private static readonly C_PLAY = new Color(60, 220, 90, 255);
    private static readonly C_ROOM = new Color(0, 230, 255, 255);
    private static readonly C_BAR = new Color(60, 120, 255, 255);
    private static readonly C_HIT = new Color(255, 70, 200, 255);
    private static readonly C_CULL = new Color(255, 140, 0, 255);
    private static readonly C_SNAP = new Color(255, 40, 40, 255);

    private _size = new Size();
    private _gizmo: Node | null = null;
    private _renderer: MeshRenderer | null = null;
    private _mat: Material | null = null;
    private _pos: number[] = [];
    private _col: number[] = [];
    private _lastPos: number[] = [];
    private _lastCol: number[] = [];
    private _inv = new Mat4();
    private _m = new Mat4();
    private _a = new Vec3();
    private _b = new Vec3();

    // =========================================================== vòng đời
    onLoad() {
        if (!EDITOR) return;
        this.findRefs();
    }

    onDisable() {
        if (!EDITOR) return;
        if (PreviewScreen.override === this._size) PreviewScreen.override = null;
        this.destroyGizmo();
    }

    onDestroy() {
        if (!EDITOR) return;
        if (PreviewScreen.override === this._size) PreviewScreen.override = null;
        this.destroyGizmo();
    }

    update() {
        if (!EDITOR) return;
        this.findRefs();
        const [w, h] = this.portraitSize();
        if (this.orientation === PreviewOrientation.Landscape) this._size.set(Math.max(w, h), Math.min(w, h));
        else this._size.set(Math.min(w, h), Math.max(w, h));
        PreviewScreen.override = this._size;

        const cam = this.camera();
        if (cam && this.syncCameraOrtho) {
            const o = PreviewScreen.worldOrthoHeight(this._size);
            if (Math.abs(cam.orthoHeight - o) > 1e-4) cam.orthoHeight = o;
        }
        if (cam && this.showGizmos) this.drawGizmos(cam);
        else this.destroyGizmo();
    }

    private portraitSize(): [number, number] {
        if (this.device === PreviewDevice.Custom) return [this.customSize.width || 1080, this.customSize.height || 1920];
        if (this.device === PreviewDevice.Design) {
            const d = view.getDesignResolutionSize();
            return [d.width || 1080, d.height || 1920];
        }
        return DEVICE_SIZES[this.device] ?? [1080, 1920];
    }

    private findRefs() {
        const scene = director.getScene();
        if (!scene) return;
        if (!this.box?.isValid) this.box = scene.getComponentInChildren(BoxBg);
        if (!this.fit?.isValid) this.fit = scene.getComponentInChildren(FitInBox);
        if (!this.bar?.isValid) this.bar = scene.getComponentInChildren(BottomBar);
        if (!this.items?.isValid) this.items = scene.getComponentInChildren(ItemManager);
    }

    private camera(): Camera | null {
        return this.wCam ?? this.box?.cam ?? this.fit?.cam ?? this.bar?.cam ?? null;
    }

    // =========================================================== gizmo
    private drawGizmos(cam: Camera) {
        this._pos.length = 0;
        this._col.length = 0;
        Mat4.invert(this._inv, cam.node.worldMatrix);           // world → camera space (gizmo là con của camera)

        const halfH = cam.orthoHeight, halfW = halfH * this._size.width / this._size.height;
        const box = this.box, fit = this.fit;
        const z = box ? box.node.position.z + 1 : -cam.near - 1;    // mặt phẳng nền BoxBg (trong camera space)

        if (this.gizmoScreen) this.rectCam(-halfW, halfW, -halfH, halfH, z, EditorPreview.C_SCREEN);
        if (this.gizmoBox && box) {
            const r = box.getCamRect(halfH, false);
            this.rectCam(r.left, r.right, r.bottom, r.top, z, EditorPreview.C_BOX);
            const p = box.getCamRect(halfH, true, true), pad = fit?.padding ?? 0;
            this.rectCam(p.left + pad, p.right - pad, p.bottom + pad, p.top - pad, z, EditorPreview.C_PLAY);
        }
        if (this.gizmoRoom && fit) {
            const b = fit.currentBounds();
            if (b) {
                const rz = Vec3.transformMat4(this._a, fit.node.worldPosition, this._inv).z;
                this.rectCam(b.minX, b.maxX, b.minY, b.maxY, rz, EditorPreview.C_ROOM);
            }
        }
        if (this.gizmoBar) this.drawBar();
        if (this.gizmoSnap) this.drawSnap(cam, halfW);
        this.flush(cam);
    }

    /** Thanh (UITransform), dải chạm kéo (hitHeight quanh Content), giới hạn cull ô của ItemManager */
    private drawBar() {
        const bar = this.bar, ut = bar?.getComponent(UITransform);
        if (!bar || !ut) return;
        const { width: w, height: h } = ut.contentSize, ax = ut.anchorX, ay = ut.anchorY;
        this.rectLocal(bar.node, -ax * w, (1 - ax) * w, -ay * h, (1 - ay) * h, EditorPreview.C_BAR);

        const content = bar.content;
        if (!content) return;
        const c = content.position;
        if (!bar.vertical) {
            const hh = bar.hitHeight / 2;
            this.rectLocal(bar.node, -w / 2, w / 2, c.y - hh, c.y + hh, EditorPreview.C_HIT);
        }
        const im = this.items;
        if (!im) return;
        const L = im.cullHalfLen, half = im.cellPx() / 2;
        // Content local: thanh ngang xếp theo +X, thanh dọc theo −Y
        for (const s of [-1, 1]) {
            if (bar.vertical) this.lineLocal(content, -half, s * L, half, s * L, EditorPreview.C_CULL);
            else this.lineLocal(content, s * L, -half, s * L, half, EditorPreview.C_CULL);
        }
    }

    /** Vòng snap quanh pivot target: snapPx (pt @393 → world) + nửa cạnh nhỏ bbox (snapByBounds), như ItemManager.judgeSnap */
    private drawSnap(cam: Camera, halfW: number) {
        const im = this.items, content = this.bar?.content;
        if (!im || !content) return;
        const base = im.snapPx / 393 * 2 * halfW;               // px(snapPx) đổi ra world unit theo bề ngang màn
        for (const it of content.getComponentsInChildren(ItemController)) {
            const t = it.target;
            if (!t?.isValid || !it.node.active) continue;
            const r = base + (im.snapByBounds ? this.halfMinExtent(t) : 0);
            const o = Vec3.transformMat4(this._a, t.worldPosition, this._inv);
            const seg = 24;
            for (let i = 0; i < seg; i++) {
                const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
                this.push(o.x + Math.cos(a0) * r, o.y + Math.sin(a0) * r, o.z, EditorPreview.C_SNAP);
                this.push(o.x + Math.cos(a1) * r, o.y + Math.sin(a1) * r, o.z, EditorPreview.C_SNAP);
            }
        }
    }

    /** Nửa cạnh nhỏ bbox mesh trong camera space (world unit) */
    private halfMinExtent(target: Node): number {
        const st = target.getComponent(MeshRenderer)?.mesh?.struct;
        if (!st?.minPosition || !st.maxPosition) return 0;
        const lo = st.minPosition, hi = st.maxPosition, p = this._b;
        Mat4.multiply(this._m, this._inv, target.worldMatrix);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
            Vec3.transformMat4(p, p.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z), this._m);
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return Math.min(maxX - minX, maxY - minY) / 2;
    }

    // ---- primitive (toạ độ camera space) ----
    private push(x: number, y: number, z: number, c: Color) {
        this._pos.push(x, y, z);
        this._col.push(c.r / 255, c.g / 255, c.b / 255, 1);
    }

    private rectCam(l: number, r: number, b: number, t: number, z: number, c: Color) {
        this.push(l, b, z, c); this.push(r, b, z, c);
        this.push(r, b, z, c); this.push(r, t, z, c);
        this.push(r, t, z, c); this.push(l, t, z, c);
        this.push(l, t, z, c); this.push(l, b, z, c);
    }

    /** Đoạn thẳng trong local của node → camera space */
    private lineLocal(n: Node, x0: number, y0: number, x1: number, y1: number, c: Color) {
        Mat4.multiply(this._m, this._inv, n.worldMatrix);
        const a = Vec3.transformMat4(this._a, this._a.set(x0, y0, 0), this._m);
        this.push(a.x, a.y, a.z, c);
        const b = Vec3.transformMat4(this._b, this._b.set(x1, y1, 0), this._m);
        this.push(b.x, b.y, b.z, c);
    }

    private rectLocal(n: Node, l: number, r: number, b: number, t: number, c: Color) {
        this.lineLocal(n, l, b, r, b, c);
        this.lineLocal(n, r, b, r, t, c);
        this.lineLocal(n, r, t, l, t, c);
        this.lineLocal(n, l, t, l, b, c);
    }

    /** Dựng lại mesh đường kẻ khi hình đổi (không đổi thì để nguyên) */
    private flush(cam: Camera) {
        const node = this.ensureGizmo(cam);
        if (!node || !this._renderer) return;
        if (!this._pos.length) { this._renderer.enabled = false; return; }
        this._renderer.enabled = true;
        if (this.same(this._pos, this._lastPos) && this.same(this._col, this._lastCol)) return;
        this._lastPos = this._pos.slice();
        this._lastCol = this._col.slice();

        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < this._pos.length; i += 3) {
            const x = this._pos[i], y = this._pos[i + 1], z = this._pos[i + 2];
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        const old = this._renderer.mesh;
        this._renderer.mesh = utils.MeshUtils.createMesh({
            positions: this._pos.slice(),
            colors: this._col.slice(),
            primitiveMode: gfx.PrimitiveMode.LINE_LIST,
            minPos: new Vec3(minX, minY, minZ),
            maxPos: new Vec3(maxX, maxY, maxZ),
        });
        this._renderer.setSharedMaterial(this.material(), 0);
        if (old && old !== this._renderer.mesh) (old as Mesh).destroy();
    }

    private same(a: number[], b: number[]) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false;
        return true;
    }

    /** Node gizmo: con của camera (local = camera space), ẩn khỏi Hierarchy, KHÔNG lưu vào scene */
    private ensureGizmo(cam: Camera): Node | null {
        if (this._gizmo?.isValid && this._gizmo.parent === cam.node) return this._gizmo;
        this.destroyGizmo();
        // script reload: gizmo cũ (không lưu, ẩn) còn treo dưới camera → dọn
        for (const ch of cam.node.children.slice()) if (ch.name === EditorPreview.GIZMO_NAME) ch.destroy();
        const n = new Node(EditorPreview.GIZMO_NAME);
        n.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy | CCObject.Flags.LockedInEditor;
        n.layer = Layers.Enum.DEFAULT;
        n.setParent(cam.node, false);
        const r = n.addComponent(MeshRenderer);
        r.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        r.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        this._gizmo = n;
        this._renderer = r;
        this._lastPos = [];
        this._lastCol = [];
        return n;
    }

    private destroyGizmo() {
        if (this._gizmo?.isValid) this._gizmo.destroy();
        this._gizmo = null;
        this._renderer = null;
        this._lastPos = [];
        this._lastCol = [];
    }

    /** builtin-unlit + màu đỉnh, vẽ đường, depthFunc ALWAYS → luôn nổi trên mesh */
    private material(): Material {
        if (this._mat) return this._mat;
        const m = new Material();
        m.initialize({
            effectName: 'builtin-unlit',
            defines: { USE_VERTEX_COLOR: true },
            states: {
                primitive: gfx.PrimitiveMode.LINE_LIST,
                priority: 250,
                // ALWAYS: luôn nổi trên mesh vẽ trước, nhưng vẫn GHI depth (WebGL tắt depthTest là tắt luôn ghi depth):
                // nền BoxBg là Sprite 2D vẽ SAU, có depth test → không đè được đường kẻ (đường kẻ nằm trước mặt nền)
                depthStencilState: { depthTest: true, depthWrite: true, depthFunc: gfx.ComparisonFunc.ALWAYS },
                // bật blend → vào hàng TRANSPARENT (vẽ sau mọi mesh đặc). Ở hàng opaque, mesh vẽ sau đè mất đường kẻ
                blendState: { targets: [{ blend: true, blendSrc: gfx.BlendFactor.SRC_ALPHA, blendDst: gfx.BlendFactor.ONE_MINUS_SRC_ALPHA }] },
            },
        });
        this._mat = m;
        return m;
    }
}
