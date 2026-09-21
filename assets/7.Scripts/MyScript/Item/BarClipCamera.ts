import { _decorator, Camera, Component, Rect, screen, UITransform, Vec3 } from 'cc';
import { BottomBar } from './BottomBar';
const { ccclass, property } = _decorator;

/**
 * BarClipCamera: camera phụ chỉ vẽ layer TRAY (thẻ + icon) với viewport = vùng thanh trên màn hình.
 * → cái gì ra khỏi vùng thanh tự bị CẮT (không cần stencil).
 *
 * Với camera ortho: đặt camera này tại tâm vùng thanh, orthoHeight = orthoHeight chính × (cao vùng / cao màn)
 * thì pixel vẽ ra trùng khít với camera chính, chỉ khác là bị giới hạn trong rect.
 * Node này phải là CON của camera chính (cùng rotation).
 */
@ccclass('BarClipCamera')
export class BarClipCamera extends Component {
    @property(BottomBar) bar: BottomBar | null = null;
    @property({ tooltip: 'Nới vùng cắt thêm bấy nhiêu px màn hình mỗi bên (0 = sát mép thanh)' })
    paddingPx = 0;

    /**
     * true = bỏ cắt, viewport = cả màn hình. ItemManager bật khi đang kéo item:
     * ghost giữ layer TRAY nên được camera này (chạy SAU WCam) vẽ đè lên map + CountLabel.
     */
    fullScreen = false;

    private cam: Camera | null = null;
    private mainCam: Camera | null = null;
    private tmp = new Vec3();
    private corner = new Vec3();

    onLoad() {
        this.cam = this.getComponent(Camera);
        this.mainCam = this.node.parent?.getComponent(Camera) ?? null;
        if (!this.mainCam) console.error('[BarClipCamera] phải là con của camera chính (WCam)');
    }

    lateUpdate() {
        if (!this.cam || !this.mainCam || !this.bar) return;

        // 1. vùng thanh trên màn hình (px) từ 4 góc UITransform của BottomBar
        const ut = this.bar.getComponent(UITransform)!;
        const { width: w, height: h } = ut.contentSize;
        const ax = ut.anchorX, ay = ut.anchorY;
        const mat = this.bar.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of [[-ax * w, -ay * h], [(1 - ax) * w, -ay * h], [-ax * w, (1 - ay) * h], [(1 - ax) * w, (1 - ay) * h]]) {
            Vec3.transformMat4(this.corner, this.corner.set(x, y, 0), mat);
            const s = this.mainCam.worldToScreen(this.corner, this.tmp);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        minX -= this.paddingPx; maxX += this.paddingPx; minY -= this.paddingPx; maxY += this.paddingPx;

        const W = screen.windowSize.width, H = screen.windowSize.height;
        if (this.fullScreen) { minX = 0; minY = 0; maxX = W; maxY = H; }
        minX = Math.max(0, minX); minY = Math.max(0, minY); maxX = Math.min(W, maxX); maxY = Math.min(H, maxY);
        const rw = maxX - minX, rh = maxY - minY;
        if (rw <= 1 || rh <= 1) { this.cam.enabled = false; return; }
        this.cam.enabled = true;

        // 2. viewport (0..1)
        this.cam.rect = new Rect(minX / W, minY / H, rw / W, rh / H);

        // 3. ortho: thu orthoHeight theo tỉ lệ cao, dịch camera tới tâm vùng
        const mainH = this.mainCam.orthoHeight;
        const ppu = H / (2 * mainH);                          // px / world unit
        this.cam.orthoHeight = mainH * (rh / H);
        this.cam.near = this.mainCam.near;
        this.cam.far = this.mainCam.far;

        const cx = (minX + rw / 2 - W / 2) / ppu;             // lệch tâm (world) so với camera chính
        const cy = (minY + rh / 2 - H / 2) / ppu;
        this.node.setPosition(cx, cy, 0);                     // local của camera chính = trục right/up
    }
}
