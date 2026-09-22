import { _decorator, Component, instantiate, Node, ParticleSystem, Prefab, Vec3 } from 'cc';
import { ItemGraphic } from '../Item/ItemGraphic';
const { ccclass, property } = _decorator;

/**
 * SnapEffect: thả item ĐÚNG chỗ → spawn prefab particle 3D (BlinkEffect3D) tại tâm target trong map,
 * nổ 1 phát (loop = false trong prefab) rồi tự huỷ.
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

    @property({ tooltip: 'Nhân thêm scale cho effect (1 = như prefab)' })
    scale = 1;

    @property({ tooltip: 'Dịch effect lên trên (world Y) bấy nhiêu unit so với tâm bbox target' })
    offsetY = 0;

    /** Nổ effect tại target. Gọi từ ItemManager.onSnapped */
    play(target: Node) {
        const root = this.root ?? target.parent;
        if (!this.prefab || !root) return;

        const fx = instantiate(this.prefab);
        fx.setParent(root, false);
        fx.setWorldScale(this.scale, this.scale, this.scale);
        fx.setWorldRotation(0, 0, 0, 1);
        fx.setWorldPosition(ItemGraphic.worldCenter(target).add3f(0, this.offsetY, 0));

        let maxEnd = 0;
        for (const ps of fx.getComponentsInChildren(ParticleSystem)) {
            ps.loop = false;
            ps.play();
            maxEnd = Math.max(maxEnd, ps.duration + ps.startLifetime.getMax() + (ps.startDelay?.getMax() ?? 0));
        }
        this.scheduleOnce(() => { if (fx.isValid) fx.destroy(); }, maxEnd + 0.1);
    }
}
