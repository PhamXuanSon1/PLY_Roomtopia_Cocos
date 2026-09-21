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

    /** Node mesh gốc trong map (lưu vào scene để Play dùng lại item đã preview) */
    @property({ type: Node, visible: false })
    target: Node | null = null;
    targetRenderer: MeshRenderer | null = null;
    /** Material gốc của target (cache trước khi đổi xám) */
    defaultMats: Material[] = [];
    /** Bản sao mesh nằm trong ô (lưu vào scene để không phải clone lại) */
    @property({ type: Node, visible: false })
    iconClone: Node | null = null;

    @property({ type: Node, tooltip: 'Quad vuông hiện ranh giới ô (tuỳ chọn)' })
    cell: Node | null = null;
    /** Scale của iconClone khi nằm trong ô (lưu vào scene) */
    @property({ visible: false })
    iconScale = 1;
    /** Vị trí local của iconClone trong ô (đã căn tâm, lưu vào scene) */
    @property({ visible: false })
    iconBasePos = new Vec3();
    /** Camera dùng để đo kích thước icon "như mắt nhìn" */
    cam: Camera | null = null;
    /** Cạnh ô vuông (local px của thanh) mà icon phải nằm gọn */
    cellPx = CELL_PX;
    /** Icon chiếm bao nhiêu phần của ô (0..1) */
    iconFill = ICON_FILL;

    private targetBaseScale = new Vec3(1, 1, 1);
    private static fitCache = new Map<string, number>();
    private static posCache = new Map<string, Vec3>();
    private static quadMesh: any = null;

    // =========================================================== setup
    /** Gọi 1 lần lúc build. PHẢI gọi trước setGray() vì cache defaultMats ở đây. */
    bind(target: Node, _cam: Camera | null = null, cellPx = CELL_PX, iconFill = ICON_FILL) {
        this.target = target;
        this.cellPx = cellPx;
        this.iconFill = iconFill;
        this.targetRenderer = target.getComponent(MeshRenderer);
        if (!this.targetRenderer) { console.error(`[ItemGraphic] ${target.name} không có MeshRenderer`); return; }

        this.defaultMats = this.targetRenderer.sharedMaterials.slice() as Material[];
        this.targetBaseScale.set(target.scale);

        // 1. nhân bản target — nếu đã có clone (item sinh từ Preview trong editor) thì dùng lại
        let clone = this.iconClone && this.iconClone.isValid ? this.iconClone : null;
        // mất reference nhưng trong Icon vẫn còn IconMesh cũ → dùng lại nó thay vì clone thêm
        if (!clone && this.icon) clone = this.icon.getChildByName('IconMesh');
        // dọn mọi con thừa trong Icon (tránh 2 bản mesh chồng nhau)
        if (this.icon) for (const ch of this.icon.children.slice()) if (ch !== clone) ch.destroy();
        if (!clone) {
            clone = instantiate(target);
            clone.name = 'IconMesh';
            // 2. bản sao chỉ cần hình: bỏ script khác MeshRenderer, tắt bóng
            for (const comp of clone.getComponentsInChildren(Component)) {
                if (!(comp instanceof MeshRenderer)) comp.destroy();
            }
            for (const r of clone.getComponentsInChildren(MeshRenderer)) {
                r.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
                r.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
            }
        }

        // 3. cắm vào ô. Clone tái dùng (từ Preview) → giữ nguyên scale/vị trí đã lưu, KHÔNG đo lại
        const reused = clone === this.iconClone;
        this.iconClone = clone;
        if (!reused) {
            this.iconScale = 1;
            this.putIconInCell();
            this.iconScale = this.fitScale();
            clone.setScale(this.iconScale, this.iconScale, this.iconScale);
            clone.setPosition(this.iconBasePos);
        }

        this.setupShadow();
    }

    /** Icon xoay theo target (gọi khi model root xoay): đổi rotation rồi căn lại tâm bbox vào giữa ô, giữ scale */
    syncRotation() {
        const c = this.iconClone;
        if (!c || !this.target || c.parent !== this.icon) return;   // đang kéo (ở ghostRoot) thì bỏ
        const extra = Quat.fromEuler(new Quat(), this.iconEuler.x, this.iconEuler.y, this.iconEuler.z);
        c.setWorldRotation(Quat.multiply(new Quat(), this.target.worldRotation, extra));
        this.recenter();
    }

    /** Tính lại iconBasePos để tâm bbox (theo rotation hiện tại) nằm giữa ô */
    recenter() {
        const c = this.iconClone!;
        const invIcon = Quat.invert(new Quat(), this.icon!.worldRotation);
        const iconWS = this.icon!.worldScale;
        const qr = new Quat(), sc = new Vec3(), tmp = new Vec3();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const r of c.getComponentsInChildren(MeshRenderer)) {
            const st = r.mesh?.struct;
            if (!st?.minPosition || !st.maxPosition) continue;
            Quat.multiply(qr, invIcon, r.node.worldRotation);
            Vec3.divide(sc, r.node.worldScale, iconWS);        // đã gồm iconScale
            const lo = st.minPosition, hi = st.maxPosition;
            for (let i = 0; i < 8; i++) {
                tmp.set((i & 1 ? hi.x : lo.x) * sc.x, (i & 2 ? hi.y : lo.y) * sc.y, (i & 4 ? hi.z : lo.z) * sc.z);
                Vec3.transformQuat(tmp, tmp, qr);
                minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
                minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
                minZ = Math.min(minZ, tmp.z); maxZ = Math.max(maxZ, tmp.z);
            }
        }
        if (!isFinite(minX)) return;
        // tmp ở trên đã nhân scale → tâm bbox tính ra là offset thật của pivot, dời ngược lại
        // (cả Z: mesh nhỏ + pivot xa → scale lớn → lệch Z hàng chục unit, lọt ra ngoài near/far của BarCam)
        this.iconBasePos.set(-(minX + maxX) / 2, -(minY + maxY) / 2, -(minZ + maxZ) / 2);
        c.setPosition(this.iconBasePos);
    }

    /** Đặt iconClone về đúng chỗ trong ô (dùng lúc bind và khi thả trượt) */
    putIconInCell() {
        const c = this.iconClone!;
        c.setParent(this.icon!);
        c.setPosition(0, 0, 0);
        c.setScale(this.iconScale, this.iconScale, this.iconScale);
        ItemGraphic.setLayerRecursive(c, this.icon!.layer);

        // giữ đúng hướng như target trong map → camera nhìn icon y hệt nhìn vật thật (+ iconEuler nếu muốn chỉnh)
        const extra = Quat.fromEuler(new Quat(), this.iconEuler.x, this.iconEuler.y, this.iconEuler.z);
        const q = Quat.multiply(new Quat(), this.target!.worldRotation, extra);
        c.setWorldRotation(q);

        // căn tâm bbox vào giữa ô theo rotation HIỆN TẠI (map có thể đã xoay so với lúc sinh)
        if (this.iconScale !== 1) this.recenter();
        else c.setPosition(this.iconBasePos);            // lúc bind lần đầu (scale tạm = 1) fitScale sẽ tự căn
    }

    /**
     * Scale để bbox của icon (SAU khi xoay như trong map) nằm gọn trong ô vuông cạnh `cellPx`,
     * chiếm ICON_FILL của ô. So theo chiều ngang & dọc trong không gian local của node Icon
     * (trục X/Y của thanh ≈ trục màn hình vì camera ortho nhìn thẳng).
     */
    fitScale(): number {
        const c = this.iconClone!;
        const key = `${this.target!.uuid}|${this.cellPx}|${this.iconFill}`;
        const cached = ItemGraphic.fitCache.get(key);
        if (cached !== undefined) {
            this.iconBasePos.set(ItemGraphic.posCache.get(key) ?? Vec3.ZERO);
            return cached;
        }

        // rotation của từng mesh so với node Icon (clone đang scale 1)
        const invIcon = Quat.invert(new Quat(), this.icon!.worldRotation);
        const iconWS = this.icon!.worldScale;
        const qr = new Quat();
        const sc = new Vec3();

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const tmp = new Vec3();
        for (const r of c.getComponentsInChildren(MeshRenderer)) {
            const st = r.mesh?.struct;
            if (!st?.minPosition || !st.maxPosition) continue;
            Quat.multiply(qr, invIcon, r.node.worldRotation);
            const lo = st.minPosition, hi = st.maxPosition;
            // scale của mesh so với node Icon (bỏ scale của thanh/parent)
            Vec3.divide(sc, r.node.worldScale, iconWS);
            for (let i = 0; i < 8; i++) {
                tmp.set((i & 1 ? hi.x : lo.x) * sc.x, (i & 2 ? hi.y : lo.y) * sc.y, (i & 4 ? hi.z : lo.z) * sc.z);
                Vec3.transformQuat(tmp, tmp, qr);
                minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
                minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
                minZ = Math.min(minZ, tmp.z); maxZ = Math.max(maxZ, tmp.z);
            }
        }
        const size = Math.max(maxX - minX, maxY - minY);
        const k = isFinite(size) && size > 0 ? this.iconFill * this.cellPx / size : 1;

        // căn TÂM bbox (đã xoay) vào giữa ô: dời ngược tâm, nhân với scale — cả Z để icon nằm đúng mặt phẳng thanh
        if (isFinite(size)) {
            this.iconBasePos.set(-(minX + maxX) / 2 * k, -(minY + maxY) / 2 * k, -(minZ + maxZ) / 2 * k);
        }
        ItemGraphic.fitCache.set(key, k);
        ItemGraphic.posCache.set(key, this.iconBasePos.clone());
        return k;
    }

    static setLayerRecursive(n: Node, layer: number) {
        n.layer = layer;
        for (const ch of n.children) ItemGraphic.setLayerRecursive(ch, layer);
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
        const base = this.iconBasePos.clone();
        tween(c)
            .to(0.25, { position: base.clone().add3f(0, this.cellPx * 0.25, 0) }, { easing: 'sineOut' })
            .to(0.25, { position: base }, { easing: 'sineIn' })
            .union().repeatForever().start();
    }

    stopHint() {
        if (!this.hinting) return;
        this.hinting = false;
        Tween.stopAllByTarget(this.iconClone!);
        this.iconClone!.setPosition(this.iconBasePos);
    }
}
