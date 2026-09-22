import { _decorator, Camera, Component, instantiate, Layers, Node, ParticleSystem, Prefab, Vec3 } from 'cc';
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
            // gravityModifier mô phỏng ở LOCAL space; sau khi xoay theo camera, local -Y ≈ hướng xuống màn hình
            // → hạt "rơi". Tắt hẳn để hạt chỉ toả ra và fade.
            ps.gravityModifier.constant = 0;
            ps.play();
            // Tắt depth-test: hạt bay vào sau mesh (cone bắn theo -Z local = vào sâu scene) vẫn hiện.
            // Prefab không gán material → getMaterialInstance(0) = null, phải override lên default material của processor.
            const mat = ps.getMaterialInstance(0) ?? ps.processor?.getDefaultMaterial();
            mat?.overridePipelineStates({ depthStencilState: { depthTest: false, depthWrite: false } });
            maxEnd = Math.max(maxEnd, ps.duration + ps.startLifetime.getMax() + (ps.startDelay?.getMax() ?? 0));
        }
        this.scheduleOnce(() => { if (fx.isValid) fx.destroy(); }, maxEnd + 0.1);
    }
}
