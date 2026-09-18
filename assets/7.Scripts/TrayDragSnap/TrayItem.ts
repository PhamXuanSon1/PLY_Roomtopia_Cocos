import { _decorator, Component, MeshRenderer, Node, tween, Vec3 } from 'cc';
import { TargetItem } from './TargetItem';
const { ccclass, property } = _decorator;

/** Một ô trong thanh. Icon = mesh thật của target, scale chuẩn hoá cho bằng nhau. */
@ccclass('TrayItem')
export class TrayItem extends Component {
    @property(MeshRenderer) icon: MeshRenderer | null = null;
    @property(Node) shadow: Node | null = null;

    target: TargetItem | null = null;
    isOnScreen = false;
    scaleCache = new Vec3(1, 1, 1);

    /** Gán mesh + material của target vào icon, set scale chuẩn hoá */
    bind(target: TargetItem, fitScale: number) {
        this.target = target;
        const r = target.renderer!;
        this.icon!.mesh = r.mesh;
        target.defaultMats.forEach((m, i) => this.icon!.setSharedMaterial(m, i));
        this.icon!.node.setScale(fitScale, fitScale, fitScale);
        this.icon!.node.setWorldRotation(target.node.worldRotation);
        this.scaleCache.set(fitScale, fitScale, fitScale);
    }

    setActive(on: boolean) {
        if (this.node.active === on) return;
        this.node.active = on;
    }

    /** Icon scale 0 → cache (xuất hiện) hoặc cache → 0 (biến mất) */
    pop(show: boolean, duration = 0.2) {
        const n = this.icon!.node;
        const to = show ? this.scaleCache.clone() : new Vec3(0, 0, 0);
        tween(n).to(duration, { scale: to }, { easing: show ? 'backOut' : 'quadIn' }).start();
    }
}
