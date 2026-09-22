import { _decorator, Camera, Component, instantiate, Layers, Node, ParticleSystem2D, Prefab, Vec3 } from 'cc';
import { ui } from '../../Manager/UI';
import { ItemGraphic } from '../Item/ItemGraphic';
const { ccclass, property } = _decorator;

/**
 * SnapEffect: thả item ĐÚNG chỗ → spawn prefab particle 2D (BlinkEffect) NGAY TẠI target trong world 3D,
 * nổ 1 phát rồi tự huỷ.
 *
 *  - Đặt trong world (layer DEFAULT, WCam vẽ): vị trí = tâm bbox target, dịch về phía camera `towardCam` unit
 *    để không chui vào trong mesh; xoay như WCam (ortho) → mặt particle luôn hướng camera.
 *  - Particle 2D vẫn cần nằm dưới RenderRoot2D (node UI) → `root` để trống = node cha của WCam (= UI).
 *  - Particle 2D vẽ sau mesh 3D trong cùng camera nên hiện đè lên map, nhưng nằm DƯỚI UI 2D (tay, nút, endcard).
 *  - Prefab dựng theo px → `scale` đổi sang world unit (0.03 ≈ 33 px = 1 unit).
 *  - Particle trong prefab để duration = -1 (loop); ở đây ép duration = `burstTime` + autoRemoveOnFinish.
 */
@ccclass('SnapEffect')
export class SnapEffect extends Component {
    @property({ type: Prefab, tooltip: 'Prefab particle 2D (BlinkEffect)' })
    prefab: Prefab | null = null;

    @property({ type: Node, tooltip: 'Node cha để cắm effect (phải nằm dưới RenderRoot2D, vd node UI). Để trống → node cha của WCam' })
    root: Node | null = null;

    @property({ type: Camera, tooltip: 'WCam: effect xoay theo camera này. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ tooltip: 'Phát particle trong bao lâu (s) rồi ngừng; node tự huỷ khi hết hạt' })
    burstTime = 0.4;

    @property({ tooltip: 'Nhân scale prefab (dựng theo px) sang world unit: 0.03 ≈ 33 px = 1 unit' })
    scale = 0.03;

    @property({ tooltip: 'Dịch effect về phía camera bấy nhiêu world unit để nổi trên mặt target' })
    towardCam = 1;

    /** Nổ effect tại target. Gọi từ ItemManager.onSnapped */
    play(target: Node) {
        const wCam = this.cam ?? ui?.wCamera ?? null;
        const root = this.root ?? wCam?.node.parent ?? null;
        if (!this.prefab || !wCam || !root) return;

        const fx = instantiate(this.prefab);
        fx.setParent(root, false);
        ItemGraphic.setLayerRecursive(fx, Layers.Enum.DEFAULT);          // prefab là UI_2D → chuyển sang layer WCam vẽ
        fx.setWorldRotation(wCam.node.worldRotation);                    // mặt hướng camera (ortho)
        fx.setWorldScale(Vec3.multiplyScalar(new Vec3(), fx.scale, this.scale));

        // tâm bbox target, dịch về phía camera (ortho: hướng camera = -forward của WCam)
        const pos = ItemGraphic.worldCenter(target);
        const toCam = Vec3.transformQuat(new Vec3(), Vec3.FORWARD, wCam.node.worldRotation).negative();
        pos.add(toCam.multiplyScalar(this.towardCam));
        fx.setWorldPosition(pos);

        for (const ps of fx.getComponentsInChildren(ParticleSystem2D)) {
            // GROUPED: hạt tính theo local + scale/rotation của node. FREE thì hạt ở world space, không ăn scale/xoay
            ps.positionType = ParticleSystem2D.PositionType.GROUPED;
            ps.duration = this.burstTime;
            ps.autoRemoveOnFinish = true;      // hết hạt → tự destroy node của particle
            ps.resetSystem();
        }
        // node gốc prefab (nếu particle nằm ở node con) không tự xoá → dọn sau khi chắc chắn hạt đã tắt
        const maxLife = Math.max(0, ...fx.getComponentsInChildren(ParticleSystem2D).map(p => p.life + p.lifeVar));
        this.scheduleOnce(() => { if (fx.isValid) fx.destroy(); }, this.burstTime + maxLife + 0.1);
    }
}
