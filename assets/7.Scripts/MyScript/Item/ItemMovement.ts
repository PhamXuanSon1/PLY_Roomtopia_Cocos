import { _decorator, Camera, Component, geometry, Node, Vec2, Vec3 } from 'cc';
import { FOLLOW_LERP, HEIGHT_OFFSET, SNAP_PX } from '../Config/TrayConfig';
import { ItemGraphic } from './ItemGraphic';
const { ccclass, property } = _decorator;

/** Kết quả khi thả tay */
export type ReleaseResult = 'snap' | 'miss';

/**
 * ItemMovement: lo phần KÉO – THẢ của 1 item.
 * Ghost chính là iconClone trong thanh được "bốc" ra world.
 *
 * Luồng chạy:
 *   1. begin(ngón tay)  -> bốc iconClone ra ghostRoot (world), phóng to bằng target, đặt dưới ngón tay
 *   2. move(ngón tay)   -> ghi nhớ điểm cần tới;  update(dt) -> trượt dần tới đó cho mượt
 *   3. release()        -> đo khoảng cách icon ↔ target trên màn hình
 *                          gần => 'snap' (đúng chỗ)  |  xa => 'miss' (icon quay về ô)
 *
 * Script này KHÔNG tự bắt touch (ItemManager làm) và KHÔNG đổi màu (ItemGraphic làm).
 */
@ccclass('ItemMovement')
export class ItemMovement extends Component {

    @property(ItemGraphic)
    graphic: ItemGraphic | null = null;

    // ---- ItemManager gán 2 thứ này lúc init ----
    /** Camera vẽ map (WCam) */
    cam: Camera | null = null;
    /** Node rỗng trong world, icon được cắm vào đây khi kéo */
    ghostRoot: Node | null = null;

    /** Đang kéo hay không */
    dragging = false;

    // ---- biến nội bộ ----
    private goal = new Vec3();                  // điểm icon cần tới
    private ray = new geometry.Ray();
    private floorPlane = new geometry.Plane();  // mặt phẳng z = 0 để "chiếu" ngón tay xuống world

    onLoad() {
        // mặt phẳng đi qua gốc toạ độ, hướng theo trục Z (map nằm quanh z = 0)
        geometry.Plane.fromNormalAndPoint(this.floorPlane, new Vec3(0, 0, 1), new Vec3(0, 0, 0));
    }

    // =========================================================== 1. bắt đầu kéo
    begin(fingerPos: Vec2) {
        const g = this.graphic!;
        const target = g.target!;
        const icon = g.iconClone!;

        // bốc icon ra world: to bằng target, xoay như target
        icon.setParent(this.ghostRoot!);
        icon.setWorldScale(target.worldScale);
        icon.setWorldRotation(target.worldRotation);
        icon.layer = this.ghostRoot!.layer;

        // đặt ngay dưới ngón tay (cao hơn 1 chút để tay không che)
        this.fingerToWorld(fingerPos, this.goal);
        this.goal.y += HEIGHT_OFFSET;
        icon.setWorldPosition(this.goal);

        this.dragging = true;
    }

    // =========================================================== 2. đang kéo
    move(fingerPos: Vec2) {
        if (!this.dragging) return;
        this.fingerToWorld(fingerPos, this.goal);
        this.goal.y += HEIGHT_OFFSET;
    }

    update(dt: number) {
        if (!this.dragging) return;
        const icon = this.graphic!.iconClone!;

        // trượt dần từ vị trí hiện tại tới goal (lerp) cho mượt
        const now = icon.worldPosition;
        const t = Math.min(1, dt * FOLLOW_LERP);   // 0..1
        icon.setWorldPosition(
            now.x + (this.goal.x - now.x) * t,
            now.y + (this.goal.y - now.y) * t,
            now.z + (this.goal.z - now.z) * t,
        );
    }

    // =========================================================== 3. thả tay
    release(): ReleaseResult {
        if (!this.dragging) return 'miss';
        this.dragging = false;

        const g = this.graphic!;
        const icon = g.iconClone!;

        // đổi icon và target sang toạ độ màn hình (pixel) rồi đo khoảng cách
        const distance = Vec2.distance(this.toScreen(icon.worldPosition), this.toScreen(g.target!.worldPosition));
        const result: ReleaseResult = distance < SNAP_PX() ? 'snap' : 'miss';

        // dù đúng hay sai, icon về lại ô (snap thì ItemController sẽ ẩn cả ô)
        g.putIconInCell();
        return result;
    }

    /** Huỷ giữa chừng (touch cancel, app bị pause) — coi như thả trượt */
    cancel() {
        if (!this.dragging) return;
        this.dragging = false;
        this.graphic!.putIconInCell();
    }

    // =========================================================== hàm phụ
    /**
     * Ngón tay (pixel màn hình) -> điểm trong world trên mặt phẳng z = 0.
     * Bắn 1 tia từ camera qua ngón tay, xem tia cắt mặt phẳng ở đâu.
     * (Camera đang nghiêng nên không dùng screenToWorld được.)
     */
    private fingerToWorld(fingerPos: Vec2, out: Vec3): Vec3 {
        this.cam!.screenPointToRay(fingerPos.x, fingerPos.y, this.ray);
        const dist = geometry.intersect.rayPlane(this.ray, this.floorPlane);  // 0 = không cắt
        if (dist > 0) {
            // điểm = gốc tia + hướng tia * khoảng cách
            out.x = this.ray.o.x + this.ray.d.x * dist;
            out.y = this.ray.o.y + this.ray.d.y * dist;
            out.z = this.ray.o.z + this.ray.d.z * dist;
        } else {
            out.set(this.ray.o);
        }
        return out;
    }

    /** World -> pixel màn hình (chỉ lấy x, y) */
    private toScreen(worldPos: Vec3): Vec2 {
        const s = this.cam!.worldToScreen(worldPos, new Vec3());
        return new Vec2(s.x, s.y);
    }
}
