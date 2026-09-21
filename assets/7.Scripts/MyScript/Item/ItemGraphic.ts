import { _decorator, Camera, Color, Component, Material, Mesh, MeshRenderer, Node, primitives, Tween, tween, utils, Vec3 } from 'cc';
import { ICON_FILL } from '../Config/TrayConfig';
const { ccclass, property } = _decorator;

/** Ô trong thanh rộng CELL world → icon chiếm ICON_FILL của ô */
const CELL = 0.8;

/**
 * Mọi thứ liên quan HÌNH ẢNH của 1 item:
 *  - icon trong thanh (mesh + material lấy từ target trong map, scale chuẩn hoá, nhìn thẳng camera)
 *  - shadow dưới icon
 *  - material của target trong map (xám khi chưa xong, trả màu khi snap)
 *  - hiệu ứng: pop in/out, hint nhún, punch target
 * Không biết vị trí trong thanh, không bắt input.
 */
@ccclass('ItemGraphic')
export class ItemGraphic extends Component {
    @property({ type: MeshRenderer, tooltip: 'Node Icon con của prefab' })
    icon: MeshRenderer | null = null;

    @property({ type: MeshRenderer, tooltip: 'Node Shadow con của prefab (quad tạo runtime)' })
    shadow: MeshRenderer | null = null;

    @property({ type: Material, tooltip: 'Material unlit cho shadow (để trống = không hiện shadow)' })
    shadowMat: Material | null = null;

    @property({ tooltip: 'Xoay thêm cho icon (độ) nếu mesh nhìn thẳng camera không đẹp' })
    iconEuler: Vec3 = new Vec3(0, 0, 0);

    /** Node mesh trong map mà item này đại diện */
    target: Node | null = null;
    targetRenderer: MeshRenderer | null = null;
    defaultMats: Material[] = [];
    scaleCache = new Vec3(1, 1, 1);

    private _targetBaseScale = new Vec3(1, 1, 1);
    private static _fitCache = new Map<Mesh, number>();
    private static _quad: Mesh | null = null;

    // ------------------------------------------------------------ setup
    /**
     * Gán target trong map cho icon. Gọi 1 lần lúc build.
     * PHẢI gọi trước setGray() vì cache defaultMats ở đây.
     */
    bind(target: Node) {
        this.target = target;
        this.targetRenderer = target.getComponent(MeshRenderer);
        if (!this.targetRenderer) { console.error(`[ItemGraphic] ${target.name} không có MeshRenderer`); return; }

        this.defaultMats = this.targetRenderer.sharedMaterials.slice() as Material[];
        this._targetBaseScale.set(target.scale);

        const mesh = this.targetRenderer.mesh!;
        this.icon!.mesh = mesh;
        this.defaultMats.forEach((m, i) => this.icon!.setSharedMaterial(m, i));

        const k = ItemGraphic.fitScale(mesh);
        this.scaleCache.set(k, k, k);
        this.icon!.node.setScale(this.scaleCache);
        // Tray là con của camera → rotation local 0 = nhìn thẳng camera (không copy rotation của target)
        this.icon!.node.setRotationFromEuler(this.iconEuler);

        this.setupShadow();
    }

    /** Scale để mọi icon to bằng nhau: chuẩn theo cạnh lớn nhất của bounding box (cache theo mesh) */
    static fitScale(mesh: Mesh): number {
        let k = ItemGraphic._fitCache.get(mesh);
        if (k !== undefined) return k;
        const s = mesh.struct;
        const size = Math.max(
            s.maxPosition!.x - s.minPosition!.x,
            s.maxPosition!.y - s.minPosition!.y,
            s.maxPosition!.z - s.minPosition!.z);
        k = size > 0 ? ICON_FILL * CELL / size : 1;
        ItemGraphic._fitCache.set(mesh, k);
        return k;
    }

    private setupShadow() {
        if (!this.shadow) return;
        if (!this.shadowMat) { this.shadow.node.active = false; return; }
        if (!ItemGraphic._quad) ItemGraphic._quad = utils.MeshUtils.createMesh(primitives.quad());
        this.shadow.mesh = ItemGraphic._quad;
        this.shadow.setSharedMaterial(this.shadowMat, 0);
        this.shadow.node.active = true;
    }

    // ------------------------------------------------------------ target trong map
    /** Target chưa hoàn thành → xám */
    setGray(gray: Material) {
        if (!this.targetRenderer) return;
        this.targetRenderer.sharedMaterials = this.defaultMats.map(() => gray);
    }

    /** Trả lại material gốc */
    restore() {
        if (!this.targetRenderer) return;
        this.targetRenderer.sharedMaterials = this.defaultMats;
    }

    /** Target đổi sang material hint (nhấp nháy) — dùng cho tutorial */
    setHintMat(hint: Material) {
        if (!this.targetRenderer) return;
        this.targetRenderer.sharedMaterials = this.defaultMats.map(() => hint);
    }

    /** Target scale 1 → 1.3 → 1 khi snap đúng */
    punchTarget() {
        if (!this.target) return;
        const n = this.target;
        Tween.stopAllByTarget(n);
        tween(n)
            .to(0.12, { scale: this._targetBaseScale.clone().multiplyScalar(1.3) }, { easing: 'quadOut' })
            .to(0.18, { scale: this._targetBaseScale.clone() }, { easing: 'backOut' })
            .start();
    }

    // ------------------------------------------------------------ icon trong thanh
    /** Icon scale 0 → cache (show) hoặc cache → 0 (hide) */
    pop(show: boolean, duration = 0.2) {
        const n = this.icon!.node;
        Tween.stopAllByTarget(n);
        const to = show ? this.scaleCache.clone() : new Vec3(0, 0, 0);
        tween(n).to(duration, { scale: to }, { easing: show ? 'backOut' : 'quadIn' }).start();
        if (this.shadow) this.shadow.node.active = show && !!this.shadowMat;
    }

    /** Đặt icon về scale cache ngay lập tức (không tween) */
    resetIcon() {
        Tween.stopAllByTarget(this.icon!.node);
        this.icon!.node.setScale(this.scaleCache);
        this.icon!.node.setPosition(0, 0, 0);
    }

    setVisible(on: boolean) {
        if (this.node.active === on) return;
        if (!on) this.stopHint();
        this.node.active = on;
    }

    // ------------------------------------------------------------ hint
    private _hinting = false;

    /** Icon nhún lên xuống (yoyo) */
    playHint() {
        if (this._hinting) return;
        this._hinting = true;
        const n = this.icon!.node;
        tween(n)
            .to(0.25, { position: new Vec3(0, 0.2, 0) }, { easing: 'sineOut' })
            .to(0.25, { position: new Vec3(0, 0, 0) }, { easing: 'sineIn' })
            .union().repeatForever().start();
    }

    stopHint() {
        if (!this._hinting) return;
        this._hinting = false;
        Tween.stopAllByTarget(this.icon!.node);
        this.icon!.node.setPosition(0, 0, 0);
        this.icon!.node.setScale(this.scaleCache);
    }

    get isHinting() { return this._hinting; }
}
