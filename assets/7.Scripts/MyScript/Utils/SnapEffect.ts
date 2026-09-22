import { _decorator, Camera, Component, instantiate, Layers, MeshRenderer, Node, ParticleSystem, Prefab, v3, Vec3 } from 'cc';
import { WinReact } from './WinReact';
import { GameManager } from '../Manager/GameManager';
import { ItemGraphic } from '../Item/ItemGraphic';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * SnapEffect: thả item ĐÚNG chỗ → spawn prefab particle 3D (BlinkEffect3D) tại ĐỈNH bbox target trong map
 * (không spawn ở tâm vì sẽ lọt trong mesh), xoay theo camera (để mặt phẳng bắn hạt dàn ngang đúng theo màn hình),
 * nổ 1 phát (loop = false trong prefab) rồi tự huỷ.
 *
 *  - Prefab: cc.ParticleSystem billboard, burst 1 lần lúc t=0, alpha fade về 0.
 *  - Effect vẽ bằng camera phụ FxCam (tự tạo lúc runtime, con của WCam, priority = WCam + 1, chỉ nhìn layer FX)
 *    → vẽ SAU toàn bộ WCam (map 3D + BoxBg/border/panel là Sprite đi qua UI phase, vẽ sau mọi object 3D nên
 *    priority/depth trên material không đủ để nổi lên trên BoxBg ở vùng ngoài room). UICam (priority 4) vẫn đè lên → endcard vẫn trên effect.
 */
@ccclass('SnapEffect')
export class SnapEffect extends Component {
    static readonly FX_LAYER_NAME = 'FX';
    static readonly FX_LAYER_BIT = 1;
    static get fxLayer() { return 1 << SnapEffect.FX_LAYER_BIT; }

    @property({ type: Prefab, tooltip: 'Prefab particle 3D (BlinkEffect3D)' })
    prefab: Prefab | null = null;

    @property({ type: Node, tooltip: 'Node cha để cắm effect. Để trống → node cha của target' })
    root: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera map (để xoay effect theo + FxCam bám theo). Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Nhân thêm scale cho effect (1 = như prefab)' })
    scale = 1;

    @property({ tooltip: 'Dịch effect lên trên (world Y) bấy nhiêu unit so với ĐỈNH bbox target' })
    offsetY = 0.1;

    @property({ group: 'WinReact', type: Prefab, tooltip: 'Prefab chữ phản hồi (WinReact, UI 2D). Để trống = không hiện' })
    reactPrefab: Prefab | null = null;

    @property({ group: 'WinReact', type: Node, tooltip: 'Node cha UI 2D (UICam vẽ). Để trống → node cha của UICam' })
    reactRoot: Node | null = null;

    @property({ group: 'WinReact', tooltip: 'Scale chữ (UI ở đây tính world unit, ~0.003 như HandSprite)' })
    reactScale = 0.003;

    @property({ group: 'WinReact', type: Node, tooltip: 'Chữ hiện tại vị trí (world) của node này. Để trống → GameManager.model (Lv50_Bathroom_Root)' })
    reactAnchor: Node | null = null;

    @property({ group: 'WinReact', tooltip: 'true = tâm bbox (world) của mọi mesh trong anchor = chính giữa room nhìn thấy. false = đúng pivot của anchor (pivot FBX room nằm cao, có thể ngoài màn)' })
    reactAtBoundsCenter = true;

    @property({ group: 'WinReact', tooltip: 'Dịch chữ lên bấy nhiêu px màn hình so với vị trí anchor' })
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
        c.priority = cam.priority + 1;
        c.visibility = SnapEffect.fxLayer;
        c.clearFlags = Camera.ClearFlag.DONT_CLEAR;
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

    /** Nổ effect tại target. Gọi từ ItemManager.onSnapped */
    play(target: Node) {
        const root = this.root ?? target.parent;
        if (!this.prefab || !root) return;

        const cam = this.cam ?? ui.wCamera;

        const fx = instantiate(this.prefab);
        fx.setParent(root, false);
        fx.setWorldScale(this.scale, this.scale, this.scale);
        // Xoay theo camera (thay vì identity) → mặt phẳng bắn hạt (shape module) đối diện camera,
        // dàn thành hàng ngang đúng theo góc nhìn màn hình thay vì lệch theo trục world.
        if (cam) fx.setWorldRotation(cam.node.worldRotation);
        else fx.setWorldRotation(0, 0, 0, 1);
        fx.setWorldPosition(ItemGraphic.worldTop(target).add3f(0, this.offsetY, 0));

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
