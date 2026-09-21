import { _decorator, Color, Component, Material, MeshRenderer, Size, UITransform, utils, Vec2 } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

/**
 * QuadImage: vẽ 1 ảnh bằng mesh 3D (quad) thay cho Sprite 2D.
 *
 * Vì sao: trong cùng 1 camera, Cocos vẽ mesh 3D trước rồi mới vẽ Sprite 2D đè lên,
 * nên Sprite làm nền thanh sẽ che mất icon 3D. Đổi nền sang quad 3D thì nền và icon
 * cùng "thế giới", cái nào gần camera hơn thì hiện trước.
 *
 * Kích thước & anchor lấy từ UITransform của node (giữ nguyên để BottomBar.fitBg vẫn dùng được).
 * Material: builtin-unlit + texture (tạo sẵn trong 8.Models/Materials/Misc).
 */
@ccclass('QuadImage')
@executeInEditMode
@requireComponent(UITransform)
export class QuadImage extends Component {
    @property({ type: Material, tooltip: 'Material unlit (có hoặc không texture)' })
    material: Material | null = null;

    @property({ tooltip: 'Màu nhân với texture (alpha = độ trong). Đổi ở đây, không cần sửa material' })
    color: Color = new Color(255, 255, 255, 255);

    @property({ tooltip: 'Kích thước quad (đơn vị local). Đồng bộ với UITransform của node' })
    get size(): Size { const ut = this.getComponent(UITransform); return ut ? ut.contentSize.clone() : new Size(100, 100); }
    set size(v: Size) { this.getComponent(UITransform)?.setContentSize(v); this.rebuild(); }

    @property({ tooltip: 'Điểm neo (0.5,0.5 = giữa; 0.5,0 = đáy giữa)' })
    get anchor(): Vec2 { const ut = this.getComponent(UITransform); return ut ? new Vec2(ut.anchorX, ut.anchorY) : new Vec2(0.5, 0.5); }
    set anchor(v: Vec2) { this.getComponent(UITransform)?.setAnchorPoint(v); this.rebuild(); }

    @property({ tooltip: 'Bo tròn 4 góc (đơn vị local, 0 = vuông)' })
    cornerRadius = 0;

    @property({ tooltip: 'Số đoạn mỗi góc bo (càng nhiều càng mượt)' })
    cornerSegments = 6;

    private renderer: MeshRenderer | null = null;
    private lastKey = '';
    private lastColor = new Color(0, 0, 0, 0);

    onLoad() {
        this.renderer = this.getComponent(MeshRenderer) ?? this.addComponent(MeshRenderer)!;
        this.renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        this.renderer.receiveShadow = MeshRenderer.ShadowReceivingMode.OFF;
    }

    start() {
        // dựng ở start (sau onLoad của MeshRenderer) — dựng trong onLoad mesh sẽ bị MeshRenderer reset
        this.rebuild();
    }

    update() {
        // UITransform đổi size (fitBg) → dựng lại quad
        const ut = this.getComponent(UITransform)!;
        const key = `${ut.width}|${ut.height}|${ut.anchorX}|${ut.anchorY}`;
        const fullKey = `${key}|${this.cornerRadius}|${this.cornerSegments}`;
        if (fullKey !== this.lastKey) this.rebuild();
        if (!this.lastColor.equals(this.color)) { this.lastColor.set(this.color); this.applyMaterial(); }
    }

    rebuild() {
        if (!this.renderer) return;
        const ut = this.getComponent(UITransform)!;
        const w = ut.width, h = ut.height;
        const x0 = -ut.anchorX * w, x1 = x0 + w;
        const y0 = -ut.anchorY * h, y1 = y0 + h;
        this.lastKey = `${w}|${h}|${ut.anchorX}|${ut.anchorY}|${this.cornerRadius}|${this.cornerSegments}`;

        const r = Math.max(0, Math.min(this.cornerRadius, w / 2, h / 2));
        const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];

        // đỉnh tâm (quạt tam giác) + viền: 4 góc bo, mỗi góc `seg` đoạn
        const push = (x: number, y: number) => {
            positions.push(x, y, 0);
            uvs.push((x - x0) / w, 1 - (y - y0) / h);
            normals.push(0, 0, 1);
        };
        push((x0 + x1) / 2, (y0 + y1) / 2);
        const seg = r > 0 ? Math.max(1, this.cornerSegments) : 0;
        const corners = [
            [x1 - r, y1 - r, 0],            // phải-trên: góc 0 → 90
            [x0 + r, y1 - r, Math.PI / 2],  // trái-trên
            [x0 + r, y0 + r, Math.PI],      // trái-dưới
            [x1 - r, y0 + r, Math.PI * 1.5] // phải-dưới
        ];
        for (const [cx, cy, a0] of corners) {
            for (let i = 0; i <= seg; i++) {
                const a = a0 + (Math.PI / 2) * (seg ? i / seg : i);
                push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
        }
        const n = positions.length / 3;
        for (let i = 1; i < n; i++) indices.push(0, i, i + 1 < n ? i + 1 : 1);

        this.renderer.mesh = utils.MeshUtils.createMesh({ positions, uvs, normals, indices });
        this.applyMaterial();
    }

    /** Material riêng cho node này (instance) để chỉnh màu không ảnh hưởng node khác */
    private applyMaterial() {
        if (!this.material || !this.renderer) return;
        this.renderer.setSharedMaterial(this.material, 0);
        const inst = this.renderer.material;            // tạo instance
        inst?.setProperty('mainColor', this.color);
    }

    /** Gọi khi đổi color trong Inspector lúc runtime/editor */
    onFocusInEditor() { this.applyMaterial(); }
}
