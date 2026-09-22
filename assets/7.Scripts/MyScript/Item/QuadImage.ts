import { _decorator, Color, Component, Enum, Material, MeshRenderer, Size, UITransform, utils, Vec2, Vec4 } from 'cc';

export enum GradientMode { Vertical = 0, Radial = 1 }
Enum(GradientMode);
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

    @property({ group: 'Gradient', tooltip: 'Chuyển màu theo chiều dọc (cần material bật USE_VERTEX_COLOR)' })
    gradient = false;

    @property({ group: 'Gradient', type: GradientMode, tooltip: 'Vertical: trên→dưới. Radial: tâm→4 mép' })
    gradientMode = GradientMode.Radial;

    @property({ group: 'Gradient', tooltip: 'Vertical: màu mép TRÊN. Radial: màu TÂM' })
    colorTop: Color = new Color(255, 255, 255, 255);

    @property({ group: 'Gradient', tooltip: 'Vertical: màu mép DƯỚI. Radial: màu VIỀN' })
    colorBottom: Color = new Color(215, 220, 230, 255);

    @property({ group: 'Gradient', range: [0, 1, 0.05], slide: true, tooltip: 'Radial: vùng giữ nguyên màu tâm (0 = toả từ tâm, 0.5 = nửa thẻ đều màu rồi mới chuyển)' })
    radialInner = 0.3;

    @property({ tooltip: 'Số đoạn mỗi góc bo (càng nhiều càng mượt)' })
    cornerSegments = 6;

    private renderer: MeshRenderer | null = null;
    private lastKey = '';
    private lastColor = new Color(0, 0, 0, 0);
    /** Rect màn hình 0..1 cho shader unlit-clip (thẻ trong tray); (0,0,1,1) = không cắt */
    private clipRect = new Vec4(0, 0, 1, 1);

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
        const fullKey = `${key}|${this.cornerRadius}|${this.cornerSegments}|${this.gradient}|${this.gradientMode}|${this.radialInner}|${this.colorTop.toHEX()}|${this.colorBottom.toHEX()}`;
        if (fullKey !== this.lastKey) this.rebuild();
        if (!this.lastColor.equals(this.color)) { this.lastColor.set(this.color); this.applyMaterial(); }
    }

    rebuild() {
        if (!this.renderer) return;
        const ut = this.getComponent(UITransform)!;
        const w = ut.width, h = ut.height;
        const x0 = -ut.anchorX * w, x1 = x0 + w;
        const y0 = -ut.anchorY * h, y1 = y0 + h;
        this.lastKey = `${w}|${h}|${ut.anchorX}|${ut.anchorY}|${this.cornerRadius}|${this.cornerSegments}|${this.gradient}|${this.gradientMode}|${this.radialInner}|${this.colorTop.toHEX()}|${this.colorBottom.toHEX()}`;

        const r = Math.max(0, Math.min(this.cornerRadius, w / 2, h / 2));
        const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [], colors: number[] = [];

        // đỉnh tâm (quạt tam giác) + viền: 4 góc bo, mỗi góc `seg` đoạn
        const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
        const mix = (t: number) => {                  // t: 0 = colorBottom (dưới/viền), 1 = colorTop (trên/tâm)
            const a = this.colorBottom, b = this.colorTop;
            colors.push((a.r + (b.r - a.r) * t) / 255, (a.g + (b.g - a.g) * t) / 255, (a.b + (b.b - a.b) * t) / 255, (a.a + (b.a - a.a) * t) / 255);
        };
        const push = (x: number, y: number, tOverride?: number) => {
            positions.push(x, y, 0);
            uvs.push((x - x0) / w, 1 - (y - y0) / h);
            normals.push(0, 0, 1);
            if (this.gradient) {
                if (tOverride !== undefined) mix(tOverride);
                else if (this.gradientMode === GradientMode.Radial) mix(0);        // viền
                else mix(h > 0 ? (y - y0) / h : 0);                                 // trên→dưới
            }
        };
        push(cx0, cy0, this.gradientMode === GradientMode.Radial ? 1 : undefined);
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
        const rimCount = positions.length / 3 - 1;          // số đỉnh viền
        if (this.gradient && this.gradientMode === GradientMode.Radial && this.radialInner > 0) {
            // thêm vòng trong = viền thu nhỏ về tâm, giữ màu tâm → vùng giữa đều màu, rồi mới chuyển ra viền
            const k = this.radialInner;
            for (let i = 1; i <= rimCount; i++) {
                const rx = positions[i * 3], ry = positions[i * 3 + 1];
                push(cx0 + (rx - cx0) * k, cy0 + (ry - cy0) * k, 1);
            }
            const inner = (i: number) => rimCount + i;           // index đỉnh vòng trong thứ i (1..rimCount)
            for (let i = 1; i <= rimCount; i++) {
                const j = i < rimCount ? i + 1 : 1;
                indices.push(0, inner(i), inner(j));                        // tâm → vòng trong
                indices.push(inner(i), i, j, inner(i), j, inner(j));        // vòng trong → viền
            }
        } else {
            for (let i = 1; i <= rimCount; i++) indices.push(0, i, i < rimCount ? i + 1 : 1);
        }

        this.renderer.mesh = utils.MeshUtils.createMesh(this.gradient ? { positions, uvs, normals, indices, colors } : { positions, uvs, normals, indices });
        this.applyMaterial();
    }

    /** Material riêng cho node này (instance) để chỉnh màu không ảnh hưởng node khác */
    private applyMaterial() {
        if (!this.material || !this.renderer) return;
        this.renderer.setSharedMaterial(this.material, 0);
        const inst = this.renderer.material;            // tạo instance
        inst?.setProperty('mainColor', this.color);
        this.applyClip();
    }

    /** Cắt theo rect màn hình 0..1 (material phải dùng unlit-clip.effect, không thì bỏ qua) */
    setClip(rect: Vec4) {
        if (Vec4.equals(this.clipRect, rect)) return;
        this.clipRect.set(rect);
        this.applyClip();
    }

    private applyClip() {
        const inst = this.renderer?.material;
        if (!inst) return;
        for (const p of inst.passes) {
            const h = p.getHandle('clipRect');
            if (h) p.setUniform(h, this.clipRect);
        }
    }

    /** Gọi khi đổi color trong Inspector lúc runtime/editor */
    onFocusInEditor() { this.applyMaterial(); }
}
