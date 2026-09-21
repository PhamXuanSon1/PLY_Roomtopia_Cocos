import { _decorator, Camera, Component, geometry, MeshRenderer, Node, Vec2, Vec3 } from 'cc';
import { FOLLOW_LERP, HEIGHT_OFFSET, SNAP_PX, SNAP_PX_TUT, WRONG_PX } from '../Config/TrayConfig';
import { ItemGraphic } from './ItemGraphic';
const { ccclass, property } = _decorator;

export type ReleaseResult = 'snap' | 'wrong' | 'miss';

/**
 * Logic KÉO – THẢ của 1 item:
 *  - begin: icon trong thanh biến mất, ghost full-size xuất hiện dưới ngón tay
 *  - move : ghost lerp theo ngón tay (+ HEIGHT_OFFSET để không bị tay che)
 *  - release: so khoảng cách pixel với target → snap / wrong / miss
 * Không quyết định gesture (ItemManager làm), không đổi material (ItemGraphic làm).
 */
@ccclass('ItemMovement')
export class ItemMovement extends Component {
    @property(ItemGraphic) graphic: ItemGraphic | null = null;

    /** Gán bởi ItemManager lúc init */
    cam: Camera | null = null;
    ghost: MeshRenderer | null = null;
    /** Các target KHÁC (chưa hoàn thành) để phát hiện thả nhầm — ItemManager cấp */
    otherTargets: () => Node[] = () => [];
    /** Tutorial/hint đang bật → ngưỡng snap rộng hơn */
    isTutorial: () => boolean = () => false;

    dragging = false;

    private _goal = new Vec3();
    private _ray = new geometry.Ray();
    private _plane = geometry.Plane.fromNormalAndPoint(new geometry.Plane(), new Vec3(0, 0, 1), Vec3.ZERO);
    private _tmp = new Vec3();
    private _tmp2 = new Vec3();

    // ------------------------------------------------------------ drag
    begin(screenPos: Vec2) {
        const g = this.graphic!;
        const t = g.target!;
        g.pop(false, 0.1);

        const ghost = this.ghost!;
        ghost.mesh = g.targetRenderer!.mesh;
        g.defaultMats.forEach((m, i) => ghost.setSharedMaterial(m, i));
        ghost.node.setWorldScale(t.worldScale);          // ghost = kích thước thật của target
        ghost.node.setWorldRotation(t.worldRotation);
        this.toWorld(screenPos, this._goal).y += HEIGHT_OFFSET;
        ghost.node.setWorldPosition(this._goal);
        ghost.node.active = true;
        this.dragging = true;
    }

    move(screenPos: Vec2) {
        if (!this.dragging) return;
        this.toWorld(screenPos, this._goal).y += HEIGHT_OFFSET;
    }

    update(dt: number) {
        if (!this.dragging) return;
        const n = this.ghost!.node;
        Vec3.lerp(this._tmp, n.worldPosition, this._goal, Math.min(1, dt * FOLLOW_LERP));
        n.setWorldPosition(this._tmp);
    }

    /** Thả ngón tay. Trả về kết quả để ItemController quyết định complete hay trả về thanh */
    release(): ReleaseResult {
        if (!this.dragging) return 'miss';
        this.dragging = false;

        const cam = this.cam!;
        const gs = cam.worldToScreen(this.ghost!.node.worldPosition, this._tmp);
        const thr = this.isTutorial() ? SNAP_PX_TUT() : SNAP_PX();

        let result: ReleaseResult = 'miss';
        const ts = cam.worldToScreen(this.graphic!.target!.worldPosition, this._tmp2);
        if (Vec2.distance(gs as any, ts as any) < thr) {
            result = 'snap';
        } else if (this.nearestOtherPx(gs) < WRONG_PX()) {
            result = 'wrong';
        }

        this.ghost!.node.active = false;
        if (result !== 'snap') this.graphic!.pop(true);   // icon hiện lại trong thanh
        return result;
    }

    /** Huỷ drag (touch cancel, app pause) — như thả sai */
    cancel() {
        if (!this.dragging) return;
        this.dragging = false;
        this.ghost!.node.active = false;
        this.graphic!.pop(true);
    }

    // ------------------------------------------------------------ helpers
    /** Điểm world dưới ngón tay trên mặt phẳng z=0 (camera nghiêng nên không dùng screenToWorld(depth)) */
    toWorld(p: Vec2, out: Vec3): Vec3 {
        this.cam!.screenPointToRay(p.x, p.y, this._ray);
        const d = geometry.intersect.rayPlane(this._ray, this._plane);
        if (d > 0) {
            out.set(this._ray.d).multiplyScalar(d).add(this._ray.o);
        } else {
            out.set(this._ray.o);
        }
        return out;
    }

    private nearestOtherPx(gs: Vec3): number {
        let best = Number.POSITIVE_INFINITY;
        for (const t of this.otherTargets()) {
            const s = this.cam!.worldToScreen(t.worldPosition, this._tmp2);
            const d = Vec2.distance(gs as any, s as any);
            if (d < best) best = d;
        }
        return best;
    }
}
