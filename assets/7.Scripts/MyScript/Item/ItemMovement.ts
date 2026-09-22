import { _decorator, Camera, Component, geometry, MeshRenderer, Node, Vec2, Vec3 } from 'cc';
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
 *   2. move(ngón tay)   -> icon bám ĐÚNG dưới ngón tay (tâm bbox của icon = điểm chạm, không lerp)
 *   3. release()        -> trả vị trí ghost trên màn hình cho ItemManager phán snap/miss
 *                          (ngưỡng, bbox, gần nhất... cấu hình ở ItemManager), icon quay về ô
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

    @property({ tooltip: 'Mặt phẳng z mà item bám theo ngón tay khi kéo. Đặt GẦN camera hơn thanh (BottomBar z≈3.8) để không bị thẻ che' })
    dragZ = 6;

    /** Đang kéo hay không */
    dragging = false;

    // ---- biến nội bộ ----
    private goal = new Vec3();                  // điểm ngón tay trong world (trên mặt z = 0)
    private pivotOffset = new Vec3();           // tâm bbox − pivot của icon (world), để tâm hình nằm dưới ngón tay
    private ray = new geometry.Ray();
    private floorPlane = new geometry.Plane();  // mặt phẳng z = 0 để "chiếu" ngón tay xuống world

    onLoad() {
        // mặt phẳng z = dragZ, hướng theo trục Z (gần camera hơn thanh → item kéo luôn nổi trên thẻ)
        geometry.Plane.fromNormalAndPoint(this.floorPlane, new Vec3(0, 0, 1), new Vec3(0, 0, this.dragZ));
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
        ItemGraphic.setLayerRecursive(icon, this.ghostRoot!.layer);   // DragGhost layer TRAY (đèn chiếu); ghost gần camera hơn map + nền nên đè lên (clipRect = không cắt khi kéo)

        // pivot của mesh có thể lệch tâm hình (vd nằm ở đáy) → tính offset để TÂM bbox nằm dưới ngón tay
        this.computePivotOffset(icon);

        // đặt ngay dưới ngón tay
        this.dragging = true;
        this.move(fingerPos);
    }

    // =========================================================== 2. đang kéo
    /** Icon bám thẳng theo ngón tay, không lerp, không cộng offset */
    move(fingerPos: Vec2) {
        if (!this.dragging) return;
        this.fingerToWorld(fingerPos, this.goal);
        const icon = this.graphic!.iconClone!;
        icon.setWorldPosition(
            this.goal.x - this.pivotOffset.x,
            this.goal.y - this.pivotOffset.y,
            this.goal.z - this.pivotOffset.z,
        );
    }

    /** offset (world) từ pivot tới tâm bbox của icon, tính theo rotation + scale hiện tại của icon */
    private computePivotOffset(icon: Node) {
        this.pivotOffset.set(0, 0, 0);
        const st = icon.getComponent(MeshRenderer)?.mesh?.struct;
        if (!st?.minPosition || !st.maxPosition) return;
        const c = new Vec3(
            (st.minPosition.x + st.maxPosition.x) / 2,
            (st.minPosition.y + st.maxPosition.y) / 2,
            (st.minPosition.z + st.maxPosition.z) / 2,
        );
        Vec3.multiply(c, c, icon.worldScale);
        Vec3.transformQuat(this.pivotOffset, c, icon.worldRotation);
    }

    // =========================================================== 3. thả tay
    /**
     * Thả tay: đưa icon về ô, trả về vị trí ghost trên màn hình (pixel) để ItemManager phán.
     * null = không đang kéo.
     */
    release(): Vec2 | null {
        if (!this.dragging) return null;
        this.dragging = false;
        const g = this.graphic!;
        const pos = this.toScreen(g.iconClone!.worldPosition);
        g.putIconInCell();
        return pos;
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
