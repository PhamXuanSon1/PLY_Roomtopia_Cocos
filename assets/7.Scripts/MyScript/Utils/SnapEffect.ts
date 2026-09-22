import { _decorator, Camera, Component, instantiate, Node, ParticleSystem, Prefab, Vec3 } from 'cc';
import { ItemGraphic } from '../Item/ItemGraphic';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * SnapEffect: thả item ĐÚNG chỗ → spawn prefab particle 3D (BlinkEffect3D) tại ĐỈNH bbox target trong map
 * (không spawn ở tâm vì sẽ lọt trong mesh, bị depth-test che khuất), xoay theo camera (không phải identity,
 * để mặt phẳng bắn hạt dàn ngang đúng theo màn hình), nổ 1 phát (loop = false trong prefab) rồi tự huỷ.
 *
 *  - Prefab: cc.ParticleSystem billboard, burst 1 lần lúc t=0, alpha fade về 0 → không cần scheduler ngoài
 *    ngoài việc destroy node khi hết hạt.
 *  - Cắm dưới `root` (để trống → node cha của target = trong map), layer DEFAULT → WCam vẽ, depth-test với map.
 */
@ccclass('SnapEffect')
export class SnapEffect extends Component {
    @property({ type: Prefab, tooltip: 'Prefab particle 3D (BlinkEffect3D)' })
    prefab: Prefab | null = null;

    @property({ type: Node, tooltip: 'Node cha để cắm effect. Để trống → node cha của target' })
    root: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera để xoay effect theo (dàn hàng ngang đúng góc nhìn). Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Nhân thêm scale cho effect (1 = như prefab)' })
    scale = 1;

    @property({ tooltip: 'Dịch effect lên trên (world Y) bấy nhiêu unit so với ĐỈNH bbox target (spawn ở tâm sẽ lọt trong mesh, bị depth-test che khuất)' })
    offsetY = 0.1;

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

        let maxEnd = 0;
        for (const ps of fx.getComponentsInChildren(ParticleSystem)) {
            ps.loop = false;
            // gravityModifier trong prefab mô phỏng ở LOCAL space của node effect. Trước khi xoay effect
            // theo camera, "trọng lực" này bị lệch vào chiều sâu (Z) nên gần như vô hình; giờ node đứng thẳng
            // theo camera, local -Y ≈ hướng xuống màn hình thật → hạt bị "rơi xuống". Tắt hẳn để hạt chỉ toả ra và fade, không rơi.
            ps.gravityModifier.constant = 0;
            ps.play();
            // Tắt depth-test (khỏi bị mesh/BgBox che) + priority MAX (vẽ SAU CÙNG trong transparent queue → luôn nổi trên hết).
            // Prefab không gán material → getMaterialInstance(0) = null, renderer dùng default-particle-material riêng
            // của processor (MaterialInstance) → phải override trên đó, không thì override thành no-op.
            const mat = ps.getMaterialInstance(0) ?? ps.processor?.getDefaultMaterial();
            mat?.overridePipelineStates({ depthStencilState: { depthTest: false, depthWrite: false }, priority: 255 });
            maxEnd = Math.max(maxEnd, ps.duration + ps.startLifetime.getMax() + (ps.startDelay?.getMax() ?? 0));
        }
        this.scheduleOnce(() => { if (fx.isValid) fx.destroy(); }, maxEnd + 0.1);
    }
}

