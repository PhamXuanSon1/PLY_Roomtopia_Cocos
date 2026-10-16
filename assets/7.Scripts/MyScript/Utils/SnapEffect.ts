import { _decorator, Camera, Component, director, Enum, instantiate, Layers, math, MeshRenderer, Node, ParticleSystem, Prefab, v3, Vec3 } from 'cc';
import { WinReact } from './WinReact';
import { GameManager } from '../Manager/GameManager';
import { ItemGraphic } from '../Item/ItemGraphic';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/** Lấy cạnh nào của bbox item (theo mặt phẳng màn hình) để scale effect */
export enum FxFitMode { Mean = 0, Width = 1, Height = 2, Max = 3, Min = 4 }
Enum(FxFitMode);

/**
 * SnapEffect: thả item ĐÚNG chỗ → spawn prefab particle 3D (BlinkEffect3D) tại TÂM bbox target (ItemGraphic.worldCenter — đúng chỗ snap,
 * particle tắt depth-test nên không bị mesh che), xoay theo camera (để mặt phẳng bắn hạt dàn ngang đúng theo màn hình),
 * nổ 1 phát (loop = false trong prefab) rồi tự huỷ.
 *
 *  - Prefab: cc.ParticleSystem billboard, burst 1 lần lúc t=0, alpha fade về 0.
 *  - Fit theo item: scale = clamp(cạnh bbox item trên màn hình × fitPadding / fitRefSize, fitMin, fitMax) × scale
 *    → đồ to (sàn, tường) nổ to, đồ nhỏ (bàn chải, lọ) nổ nhỏ. Tắt fitToItem = scale cố định như cũ.
 *  - Effect vẽ bằng camera phụ FxCam (tự tạo lúc runtime, con của WCam, priority = WCam + 1, chỉ nhìn layer FX)
 *    → vẽ SAU toàn bộ WCam (map 3D + BoxBg/border/panel là Sprite đi qua UI phase, vẽ sau mọi object 3D nên
 *    priority/depth trên material không đủ để nổi lên trên BoxBg ở vùng ngoài room). UICam (priority 4) vẫn đè lên → endcard vẫn trên effect.
 */
@ccclass('SnapEffect')
export class SnapEffect extends Component {
    static readonly FX_LAYER_NAME = 'FX';
    static readonly FX_LAYER_BIT = 1;
    static get fxLayer() { return 1 << SnapEffect.FX_LAYER_BIT; }

    @property({ serializable: false, displayName: '⚙ Hiện thông số nâng cao', tooltip: 'Hiện thêm các thông số ít khi phải chỉnh (node cha, camera, cách fit, vị trí chữ WinReact...)' })
    showAdvanced = false;

    @property({ type: Prefab, tooltip: 'Prefab particle 3D nổ khi thả đúng (BlinkEffect3D)' })
    prefab: Prefab | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, type: Node, tooltip: 'Node cha để cắm effect (nên scale 1). Để trống → gốc scene (không bị scale của room ảnh hưởng)' })
    root: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, type: Camera, tooltip: 'Camera map (để xoay effect theo + FxCam bám theo). Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Nhân thêm scale cho effect (1 = như prefab / như kết quả fit)' })
    scale = 1;

    @property({ group: 'Fit Item', tooltip: 'Effect to/nhỏ theo kích thước item trên màn hình' })
    fitToItem = true;

    @property({ group: 'Fit Item', type: FxFitMode, tooltip: 'Đo item theo: Mean = trung bình nhân rộng×cao (đồ dài như sàn không bị quá to), Width/Height/Max/Min', visible(this: SnapEffect) { return this.showAdvanced && this.fitToItem; } })
    fitMode = FxFitMode.Mean;

    @property({ group: 'Fit Item', tooltip: 'Item có cạnh (world unit) bằng giá trị này → effect scale 1 (prefab dàn hạt ~1.8 unit)', visible(this: SnapEffect) { return this.showAdvanced && this.fitToItem; } })
    fitRefSize = 1.8;

    @property({ group: 'Fit Item', tooltip: 'Effect to hơn item bấy nhiêu lần (1 = vừa khít)', visible(this: SnapEffect) { return this.showAdvanced && this.fitToItem; } })
    fitPadding = 1.2;

    @property({ group: 'Fit Item', tooltip: 'Scale nhỏ nhất (đồ rất nhỏ vẫn thấy rõ effect)', visible(this: SnapEffect) { return this.showAdvanced && this.fitToItem; } })
    fitMin = 0.35;

    @property({ group: 'Fit Item', tooltip: 'Scale lớn nhất (đồ rất to không nổ tràn màn)', visible(this: SnapEffect) { return this.showAdvanced && this.fitToItem; } })
    fitMax = 2;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, tooltip: 'Dịch effect lên trên (world Y) bấy nhiêu unit so với TÂM bbox target (vị trí snap)' })
    offsetY = 0;

    @property({ group: 'WinReact', type: Prefab, tooltip: 'Prefab chữ phản hồi (WinReact, UI 2D). Để trống = không hiện' })
    reactPrefab: Prefab | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', type: Node, tooltip: 'Node cha UI 2D (UICam vẽ). Để trống → node cha của UICam' })
    reactRoot: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'Scale chữ (UI ở đây tính world unit, ~0.003 như HandSprite)' })
    reactScale = 0.003;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', type: Node, tooltip: 'Chữ hiện tại vị trí (world) của node này. Để trống → GameManager.model (Lv50_Bathroom_Root)' })
    reactAnchor: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'true = tâm bbox (world) của mọi mesh trong anchor = chính giữa room nhìn thấy. false = đúng pivot của anchor (pivot FBX room nằm cao, có thể ngoài màn)' })
    reactAtBoundsCenter = true;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'Dịch chữ lên bấy nhiêu px màn hình so với vị trí anchor' })
    reactOffsetPx = 0;

    @property({ group: 'WinReact', min: 1, step: 1, tooltip: 'Cứ thả đúng bấy nhiêu item thì hiện chữ 1 lần (1 = mỗi lần)' })
    reactEvery = 3;

    /** Số item đã thả đúng từ đầu ván (đếm cho reactEvery) */
    private snapCount = 0;

    private fxCam: Camera | null = null;

    onLoad() {
        const existing = Layers.nameToLayer(SnapEffect.FX_LAYER_NAME);
        if (existing === undefined || existing < 0) Layers.addLayer(SnapEffect.FX_LAYER_NAME, SnapEffect.FX_LAYER_BIT);
    }

    lateUpdate() {
        const cam = this.cam ?? ui?.wCamera;
        if (cam && this.fxCam?.isValid) this.syncFxCam(cam);
    }

    /** Camera phụ vẽ layer FX, bám theo transform + projection của WCam (orthoHeight đổi khi resize) */
    private ensureFxCam(cam: Camera): Camera {
        if (this.fxCam?.isValid) return this.fxCam;
        const n = new Node('FxCam');
        n.setParent(cam.node, false);
        n.layer = cam.node.layer;
        const c = n.addComponent(Camera);
        c.priority = cam.priority + 2;              // sau WCam (+0) và RoomCam (+1, FitInBox.clipToBox) → effect nổi trên room
        c.visibility = SnapEffect.fxLayer;
        c.clearFlags = Camera.ClearFlag.DEPTH_ONLY;   // xoá depth của map → hạt nằm trong mesh vẫn hiện trọn (không bị depth test che)
        this.fxCam = c;
        this.syncFxCam(cam);
        return c;
    }

    private syncFxCam(cam: Camera) {
        const c = this.fxCam!;
        c.projection = cam.projection;
        c.fovAxis = cam.fovAxis;
        c.fov = cam.fov;
        c.orthoHeight = cam.orthoHeight;
        c.near = cam.near;
        c.far = cam.far;
        c.rect = cam.rect;
        c.targetTexture = cam.targetTexture;
    }

    /** Scale effect cho target: fit theo bbox trên màn hình (fitToItem) × scale */
    fxScale(target: Node, cam: Camera | null): number {
        if (!this.fitToItem || !cam) return this.scale;
        const { w, h } = ItemGraphic.screenPlaneSize(target, cam);
        if (w <= 0 || h <= 0) return this.scale;
        let size: number;
        switch (this.fitMode) {
            case FxFitMode.Width: size = w; break;
            case FxFitMode.Height: size = h; break;
            case FxFitMode.Max: size = Math.max(w, h); break;
            case FxFitMode.Min: size = Math.min(w, h); break;
            default: size = Math.sqrt(w * h);
        }
        const k = size * this.fitPadding / (this.fitRefSize || 1);
        return math.clamp(k, this.fitMin, this.fitMax) * this.scale;
    }

    /** Nổ effect tại target. Gọi từ ItemManager.onSnapped */
    play(target: Node) {
        // gốc scene (scale 1): particle scaleSpace = Local → scale effect = đúng scale mình đặt, không nhân scale của room
        const root = this.root ?? director.getScene();
        if (!this.prefab || !root) return;

        const cam = this.cam ?? ui.wCamera;

        const fx = instantiate(this.prefab);
        fx.setParent(root, false);
        const s = this.fxScale(target, cam);
        fx.setWorldScale(s, s, s);
        // Xoay theo camera (thay vì identity) → mặt phẳng bắn hạt (shape module) đối diện camera,
        // dàn thành hàng ngang đúng theo góc nhìn màn hình thay vì lệch theo trục world.
        if (cam) fx.setWorldRotation(cam.node.worldRotation);
        else fx.setWorldRotation(0, 0, 0, 1);
        fx.setWorldPosition(ItemGraphic.worldCenter(target).add3f(0, this.offsetY, 0));   // tâm bbox target = đúng chỗ snap (như bản 1c62485)

        if (cam) {
            this.ensureFxCam(cam);
            ItemGraphic.setLayerRecursive(fx, SnapEffect.fxLayer);
        }

        let maxEnd = 0;
        for (const ps of fx.getComponentsInChildren(ParticleSystem)) {
            ps.loop = false;
            ps.play();
            // Tắt depth-test: hạt bay vào sau mesh (cone bắn theo -Z local = vào sâu scene) vẫn hiện.
            // Prefab không gán material → getMaterialInstance(0) = null, phải override lên default material của processor.
            const mat = ps.getMaterialInstance(0) ?? ps.processor?.getDefaultMaterial();
            mat?.overridePipelineStates({ depthStencilState: { depthTest: false, depthWrite: false } });
            maxEnd = Math.max(maxEnd, ps.duration + ps.startLifetime.getMax() + (ps.startDelay?.getMax() ?? 0));
        }
        this.scheduleOnce(() => { if (fx.isValid) fx.destroy(); }, maxEnd + 0.1);
        this.snapCount++;
        if (cam && this.reactEvery > 0 && this.snapCount % this.reactEvery === 0) this.playReact(target, cam);
    }

    /** Tâm AABB world của mọi MeshRenderer đang active trong node (không có mesh → worldPosition) */
    static boundsCenter(n: Node, out = new Vec3()): Vec3 {
        const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
        for (const r of n.getComponentsInChildren(MeshRenderer)) {
            const b = r.model?.worldBounds;
            if (!b || !r.node.activeInHierarchy) continue;
            Vec3.min(min, min, Vec3.subtract(out, b.center, b.halfExtents));
            Vec3.max(max, max, Vec3.add(out, b.center, b.halfExtents));
        }
        if (!isFinite(min.x)) return out.set(n.worldPosition);
        return Vec3.add(out, min, max).multiplyScalar(0.5);
    }

    /** Reset đếm khi chơi lại */
    resetCount() { this.snapCount = 0; }

    /** Chữ WinReact (UI 2D) tại vị trí anchor (gốc room): world → px màn hình (WCam) → toạ độ UI (UICam) */
    private playReact(_target: Node, wCam: Camera) {
        const uiCam = ui?.uiCamera;
        const root = this.reactRoot ?? uiCam?.node.parent ?? null;
        const anchor = this.reactAnchor ?? GameManager.inst?.model ?? null;
        if (!this.reactPrefab || !uiCam || !root || !anchor) return;
        const s = wCam.worldToScreen(this.reactAtBoundsCenter ? SnapEffect.boundsCenter(anchor) : anchor.worldPosition, new Vec3());
        const w = uiCam.screenToWorld(v3(s.x, s.y + this.reactOffsetPx, 0), new Vec3());
        w.z = root.worldPosition.z - 1;                 // trước UICam một chút, như tay hướng dẫn
        WinReact.spawn(this.reactPrefab, root, w, this.reactScale);
    }
}
