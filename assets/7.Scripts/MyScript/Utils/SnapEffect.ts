import { _decorator, Camera, Component, Layers, MeshRenderer, Node, v3, Vec3 } from 'cc';
import { WinReact } from './WinReact';
import { BlinkFx } from './BlinkFx';
import { GameManager } from '../Manager/GameManager';
import { Ply_Pool } from '../ScriptTemplate/Ply_Pool';
import { PoolType } from '../ScriptTemplate/Ply_Types';
import { ui } from '../../Manager/UI';
const { ccclass, property } = _decorator;

/**
 * SnapEffect: thả item ĐÚNG chỗ → lấy effect BlinkFx từ Ply_Pool (PoolType.BlinkFx) và cho nó nổ tại target;
 * cứ `reactEvery` lần thì hiện chữ WinReact (PoolType.WinReact). Cách nổ / fit theo item nằm ở script BlinkFx trên prefab.
 *
 *  Effect vẽ bằng camera phụ FxCam (tự tạo lúc chạy, con của WCam, chỉ nhìn layer FX) → vẽ SAU toàn bộ WCam
 *  (map 3D + BoxBg/border/panel là Sprite đi qua UI phase, vẽ sau mọi object 3D nên priority/depth trên material
 *  không đủ để nổi lên trên BoxBg ở vùng ngoài room). UICam (priority 4) vẫn đè lên → endcard vẫn trên effect.
 */
@ccclass('SnapEffect')
export class SnapEffect extends Component {
    static readonly FX_LAYER_NAME = 'FX';
    static readonly FX_LAYER_BIT = 1;
    /** Mặt nạ layer dành riêng cho camera và các hạt hiệu ứng snap. */
    static get fxLayer() { return 1 << SnapEffect.FX_LAYER_BIT; }

    @property({ serializable: false, displayName: '⚙ Hiện thông số nâng cao', tooltip: 'Hiện thêm các thông số ít khi phải chỉnh (node cha, camera, vị trí chữ WinReact...)' })
    showAdvanced = false;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, type: Node, tooltip: 'Node cha để cắm effect (nên scale 1). Để trống → giữ dưới node Ply_Pool' })
    root: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, type: Camera, tooltip: 'Camera map (để xoay effect theo + FxCam bám theo). Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ group: 'WinReact', min: 0, step: 1, tooltip: 'Cứ thả đúng bấy nhiêu item thì hiện chữ "Great!/Perfect!" 1 lần (1 = mỗi lần, 0 = tắt). Prefab chữ khai báo ở Ply_Pool (WinReact)' })
    reactEvery = 3;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', type: Node, tooltip: 'Node cha UI 2D (UICam vẽ). Để trống → node cha của UICam' })
    reactRoot: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'Scale chữ (UI ở đây tính world unit, ~0.003 như HandSprite)' })
    reactScale = 0.003;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', type: Node, tooltip: 'Chữ hiện tại vị trí (world) của node này. Để trống → GameManager.model (phòng)' })
    reactAnchor: Node | null = null;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'BẬT: chữ ở tâm bbox mọi mesh của anchor (= giữa phòng nhìn thấy). TẮT: đúng pivot của anchor (pivot FBX phòng nằm cao, có thể ngoài màn)' })
    reactAtBoundsCenter = true;

    @property({ visible(this: SnapEffect) { return this.showAdvanced; }, group: 'WinReact', tooltip: 'Dịch chữ lên bấy nhiêu px màn hình so với vị trí anchor' })
    reactOffsetPx = 0;

    /** Số item đã thả đúng từ đầu ván (đếm cho reactEvery) */
    private snapCount = 0;

    private fxCam: Camera | null = null;

    /** Đăng ký layer FX nếu project chưa có để camera phụ lọc đúng hiệu ứng. */
    onLoad() {
        const existing = Layers.nameToLayer(SnapEffect.FX_LAYER_NAME);
        if (existing === undefined || existing < 0) Layers.addLayer(SnapEffect.FX_LAYER_NAME, SnapEffect.FX_LAYER_BIT);
    }

    /** Đồng bộ camera hiệu ứng sau khi camera phòng cập nhật, kể cả lúc đổi kích thước màn hình. */
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

    /** Sao chép phép chiếu, vùng vẽ và đích render của camera phòng sang camera FX đã tạo. */
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
        const cam = this.cam ?? ui?.wCamera ?? null;
        const unit = Ply_Pool.Ins?.spawn(PoolType.BlinkFx, target.worldPosition, undefined, this.root);
        const fx = unit?.getComponent(BlinkFx);
        if (cam) this.ensureFxCam(cam);
        if (fx) fx.play(target, cam, cam ? SnapEffect.fxLayer : 0);
        else unit?.despawn();                  // prefab chưa gắn BlinkFx
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
        if (!uiCam || !root || !anchor) return;
        const s = wCam.worldToScreen(this.reactAtBoundsCenter ? SnapEffect.boundsCenter(anchor) : anchor.worldPosition, new Vec3());
        const w = uiCam.screenToWorld(v3(s.x, s.y + this.reactOffsetPx, 0), new Vec3());
        w.z = root.worldPosition.z - 1;                 // trước UICam một chút, như tay hướng dẫn
        WinReact.spawn(root, w, this.reactScale);
    }
}
