import { _decorator, Camera, Component, instantiate, Material, MeshRenderer, Node, primitives, Quat, Tween, tween, utils, Vec3 } from 'cc';
import { CELL_PX, ICON_FILL } from '../Config/TrayConfig';
const { ccclass, property } = _decorator;

/**
 * ItemGraphic: mọi thứ liên quan HÌNH ẢNH của 1 item.
 *
 *  - iconClone : bản sao mesh của target, nằm trong ô của thanh (con của node Icon).
 *                Khi kéo, ItemMovement "bốc" chính node này ra world làm ghost.
 *  - target    : mesh gốc trong map — xám khi chưa xong, trả màu khi snap đúng.
 *  - hiệu ứng  : pop in/out, hint nhún, punch target.
 *
 * Không biết vị trí trong thanh, không bắt input.
 */
@ccclass('ItemGraphic')
export class ItemGraphic extends Component {
    @property({ type: Node, tooltip: 'Node Icon con của prefab — chỗ cắm bản sao mesh' })
    icon: Node | null = null;

    @property({ type: MeshRenderer, tooltip: 'Node Shadow con của prefab (quad tạo runtime)' })
    shadow: MeshRenderer | null = null;

    @property({ type: Material, tooltip: 'Material unlit cho shadow (để trống = không hiện shadow)' })
    shadowMat: Material | null = null;

    @property({ tooltip: 'Xoay thêm cho icon (độ) so với hướng của nó trong map' })
    iconEuler: Vec3 = new Vec3(0, 0, 0);

    /** Node mesh gốc trong map */
    target: Node | null = null;
    targetRenderer: MeshRenderer | null = null;
    /** Material gốc của target (cache trước khi đổi xám) */
    defaultMats: Material[] = [];
    /** Bản sao mesh nằm trong ô */
    iconClone: Node | null = null;
    /** Scale của iconClone khi nằm trong ô (đơn vị local của thanh) */
    iconScale = 1;

    private targetBaseScale = new Vec3(1, 1, 1);
    private static fitCache = new Map<Node, number>();
    private static quadMesh: any = null;

    // =========================================================== setup
    /** Gọi 1 lần lúc build. PHẢI gọi trước setGray() vì cache defaultMats ở đây. */
    bind(target: Node, _cam: Camera | null = null) {
        this.target = target;
        this.targetRenderer = target.getComponent(MeshRenderer);
        if (!this.targetRenderer) { console.error(`[ItemGraphic] ${target.name} không có MeshRenderer`); return; }

        this.defaultMats = this.targetRenderer.sharedMaterials.slice() as Material[];
        this.targetBaseScale.set(target.scale);

        // 1. nhân bản target
        const clone = instantiate(target);
        clone.name = 'IconMesh';

        // 2. bản sao chỉ cần hình: bỏ script khác MeshRenderer, tắt bóng
        for (const comp of clone.getComponentsInChildren(Component)) {
            if (!(comp instanceof MeshRenderer)) comp.destroy();
        }
        for (const r of clone.getComponentsInChildren(MeshRenderer)) {
            r.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
            r.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
        }

        // 3. cắm vào ô, giữ hướng như trong map, scale cho vừa ô
        this.iconScale = ItemGraphic.fitScale(target);
        this.iconClone = clone;
        this.putIconInCell();

        this.setupShadow();
    }

    /** Đặt iconClone về đúng chỗ trong ô (dùng lúc bind và khi thả trượt) */
    putIconInCell() {
        const c = this.iconClone!;
        c.setParent(this.icon!);
        c.setPosition(0, 0, 0);
        c.setScale(this.iconScale, this.iconScale, this.iconScale);
        c.layer = this.icon!.layer;

        // giữ đúng hướng như target trong map → camera nhìn icon y hệt nhìn vật thật (+ iconEuler nếu muốn chỉnh)
        const extra = Quat.fromEuler(new Quat(), this.iconEuler.x, this.iconEuler.y, this.iconEuler.z);
        const q = Quat.multiply(new Quat(), this.target!.worldRotation, extra);
        c.setWorldRotation(q);
    }

    /** Scale để mọi icon to bằng nhau: ICON_FILL của ô CELL_PX, chuẩn theo cạnh lớn nhất (cache theo target) */
    static fitScale(target: Node): number {
        const cached = ItemGraphic.fitCache.get(target);
        if (cached !== undefined) return cached;

        const mesh = target.getComponent(MeshRenderer)!.mesh!;
        const s = mesh.struct;
        const size = Math.max(
            s.maxPosition!.x - s.minPosition!.x,
            s.maxPosition!.y - s.minPosition!.y,
            s.maxPosition!.z - s.minPosition!.z);
        const k = size > 0 ? ICON_FILL * CELL_PX / size : 1;
        ItemGraphic.fitCache.set(target, k);
        return k;
    }

    private setupShadow() {
        if (!this.shadow) return;
        if (!this.shadowMat) { this.shadow.node.active = false; return; }
        if (!ItemGraphic.quadMesh) ItemGraphic.quadMesh = utils.MeshUtils.createMesh(primitives.quad());
        this.shadow.mesh = ItemGraphic.quadMesh;
        this.shadow.setSharedMaterial(this.shadowMat, 0);
        this.shadow.node.active = true;
    }

    // =========================================================== target trong map
    setGray(gray: Material) {
        if (!this.targetRenderer) return;
        this.targetRenderer.sharedMaterials = this.defaultMats.map(() => gray);
    }

    restore() {
        if (!this.targetRenderer) return;
        this.targetRenderer.sharedMaterials = this.defaultMats;
    }

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
            .to(0.12, { scale: this.targetBaseScale.clone().multiplyScalar(1.3) }, { easing: 'quadOut' })
            .to(0.18, { scale: this.targetBaseScale.clone() }, { easing: 'backOut' })
            .start();
    }

    // =========================================================== icon trong ô
    /** Icon scale 0 → iconScale (show) hoặc iconScale → 0 (hide) */
    pop(show: boolean, duration = 0.2) {
        const c = this.iconClone!;
        Tween.stopAllByTarget(c);
        const k = show ? this.iconScale : 0;
        tween(c).to(duration, { scale: new Vec3(k, k, k) }, { easing: show ? 'backOut' : 'quadIn' }).start();
        if (this.shadow) this.shadow.node.active = show && !!this.shadowMat;
    }

    setVisible(on: boolean) {
        if (this.node.active === on) return;
        if (!on) this.stopHint();
        this.node.active = on;
    }

    /** Reset icon về trong ô, scale chuẩn (replay) */
    resetIcon() {
        Tween.stopAllByTarget(this.iconClone!);
        this.putIconInCell();
    }

    // =========================================================== hint
    private hinting = false;

    playHint() {
        if (this.hinting) return;
        this.hinting = true;
        const c = this.iconClone!;
        tween(c)
            .to(0.25, { position: new Vec3(0, CELL_PX * 0.25, 0) }, { easing: 'sineOut' })
            .to(0.25, { position: new Vec3(0, 0, 0) }, { easing: 'sineIn' })
            .union().repeatForever().start();
    }

    stopHint() {
        if (!this.hinting) return;
        this.hinting = false;
        Tween.stopAllByTarget(this.iconClone!);
        this.iconClone!.setPosition(0, 0, 0);
    }
}
