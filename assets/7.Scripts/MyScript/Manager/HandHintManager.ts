import { _decorator, Camera, Component, Input, input, MeshRenderer, Node, screen, Tween, tween, v3, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { BoxBg } from '../Item/BoxBg';
import { ItemController } from '../Item/ItemController';
import { ItemManager } from './ItemManager';
import { ModelRotate } from './ModelRotate';
const { ccclass, property } = _decorator;

/**
 * HandHintManager: tay hướng dẫn.
 *
 *  Giai đoạn (tự chuyển theo tiến trình):
 *   1. Drag tutorial : `tutorialDrags` item đầu (mặc định 2) → tay nhấn vào ô item đầu tiên đang hiện trong thanh,
 *                      kéo tới target trong phòng, thả, lặp.
 *   2. Rotate tutorial: xong đủ item → tay quẹt ngang giữa vùng chơi cho tới khi người chơi xoay phòng (ModelRotate).
 *   3. Idle hint      : sau đó, cứ idle `idleDelay` giây lại hint kéo item như bước 1.
 *
 *  Tay là UI 2D: con của uiRoot (node UI, layer UI_2D) do UICam vẽ đè lên tất cả. Vị trí item/target được chiếu
 *  từ WCam ra pixel màn hình rồi đổi sang toạ độ UI qua UICam → tay đi thẳng trên mặt phẳng màn hình.
 *  Người chơi chạm màn hình → tay ẩn ngay, đếm lại idle. Hết item → tắt hẳn.
 */
@ccclass('HandHintManager')
export class HandHintManager extends Component {
    @property({ type: Node, tooltip: 'Node tay (con là Sprite). Để trống = node gắn script' })
    hand: Node | null = null;

    @property({ type: ItemManager, tooltip: 'Lấy item đầu thanh / tiến trình' })
    itemManager: ItemManager | null = null;

    @property({ type: Camera, tooltip: 'WCam: chiếu vị trí item/target ra pixel màn hình' })
    cam: Camera | null = null;

    @property({ type: Camera, tooltip: 'UICam: đổi pixel màn hình → toạ độ UI 2D' })
    uiCam: Camera | null = null;

    @property({ type: Node, tooltip: 'Node cha của tay (layer UI_2D, UICam vẽ). Để trống → node cha của UICam' })
    uiRoot: Node | null = null;

    @property({ type: BoxBg, tooltip: 'Lấy vùng chơi để đặt hint xoay (màn ngang trừ panel)' })
    box: BoxBg | null = null;

    @property({ type: ModelRotate, tooltip: 'Biết người chơi đã xoay phòng chưa' })
    rotate: ModelRotate | null = null;

    @property({ tooltip: 'Vào game bao lâu thì hiện tay lần đầu (s)' })
    firstDelay = 1;

    @property({ tooltip: 'Không chạm bao lâu thì hiện tay lại (s)' })
    idleDelay = 4;

    @property({ tooltip: 'Số item đầu có tay kéo-thả (tutorial). Xong thì chuyển sang hint xoay' })
    tutorialDrags = 2;

    @property({ tooltip: 'Sau khi xong tutorial + đã xoay, còn hint kéo item khi idle không' })
    idleHintAfterTutorial = true;

    @property({ tooltip: 'Thời gian tay đi từ ô tới target (s)' })
    moveTime = 1.2;

    @property({ tooltip: 'Giữ tay ở target trước khi lặp (s)' })
    holdTime = 0.35;

    @property({ tooltip: 'Hint xoay: quẹt ngang bao nhiêu phần bề ngang vùng chơi (0.3 = ±15%)' })
    rotateSwipeFrac = 0.3;

    @property({ tooltip: 'Hint xoay: thời gian 1 lần quẹt (s)' })
    rotateSwipeTime = 0.9;


    private idle = 0;
    private showing = false;
    private mode: 'drag' | 'rotate' | 'none' = 'none';
    private hintItem: ItemController | null = null;
    private rotateHintDone = false;
    private enabledHint = true;
    private lastCollected = 0;
    private lastVertical: boolean | null = null;

    onLoad() {
        if (EDITOR) return;
        if (!this.hand) this.hand = this.node;
        if (!this.itemManager || !this.cam || !this.uiCam) console.warn('[HandHint] thiếu itemManager / cam / uiCam → không hint');
        const root = this.uiRoot ?? this.uiCam?.node.parent ?? null;
        if (root && this.hand.parent !== root) this.hand.setParent(root, false);
        HandHintManager.setLayerRecursive(this.hand, root?.layer ?? this.hand.layer);
        this.hand.setRotationFromEuler(0, 0, 0);
        this.setHandVisible(false);
        this.idle = this.idleDelay - this.firstDelay;      // để lần đầu chỉ chờ firstDelay
    }

    onEnable() {
        if (EDITOR) return;
        input.on(Input.EventType.TOUCH_START, this.onUserTouch, this);
    }

    onDisable() {
        if (EDITOR) return;
        input.off(Input.EventType.TOUCH_START, this.onUserTouch, this);
        this.stop();
    }

    // ============================================================ public
    /** Người chơi vừa làm gì đó (snap/miss/lift...) → ẩn tay, đếm lại idle */
    notify() {
        this.stop();
        this.idle = 0;
    }

    /** Tắt hẳn (win/lose) */
    disable() {
        this.enabledHint = false;
        this.stop();
    }

    // ============================================================ loop
    update(dt: number) {
        if (EDITOR || !this.enabledHint || !this.itemManager) return;
        const im = this.itemManager;

        // hết item / win / lose → tắt
        if ((im.total > 0 && im.remain <= 0) || ui?.win?.active || ui?.fail?.active) { this.disable(); return; }

        // tiến trình đổi (snap) hoặc đổi layout ngang↔dọc → ẩn tay, tính lại
        const vertical = im.bar?.vertical ?? false;
        if (this.lastVertical === null) { this.lastVertical = vertical; this.lastCollected = im.collected; }   // frame đầu: chỉ ghi nhận
        if (im.collected !== this.lastCollected || vertical !== this.lastVertical) {
            this.lastCollected = im.collected;
            this.lastVertical = vertical;
            this.notify();
        }
        if (this.rotate?.rotatedOnce) this.rotateHintDone = true;

        if (this.showing) {
            // item đang hint bị gỡ / trượt ra ngoài màn → hint lại item khác
            if (this.mode === 'drag' && (!this.hintItem || this.hintItem.isCompleted || !this.fullyOnScreen(this.hintItem))) this.restart();
            // đã xoay xong → thôi hint xoay
            if (this.mode === 'rotate' && this.rotateHintDone) this.notify();
            return;
        }

        this.idle += dt;
        if (this.idle >= this.idleDelay) this.play();
    }

    private nextMode(): 'drag' | 'rotate' | 'none' {
        const im = this.itemManager!;
        if (im.collected < this.tutorialDrags) return 'drag';
        if (!this.rotateHintDone) return 'rotate';
        return this.idleHintAfterTutorial ? 'drag' : 'none';
    }

    private play() {
        this.mode = this.nextMode();
        if (this.mode === 'none') { this.idle = 0; return; }
        if (this.mode === 'drag') {
            const item = this.pickItem();
            if (!item) { this.idle = 0; return; }
            this.hintItem = item;
        }
        this.showing = true;
        console.log(`[HandHint] ${this.mode} item=${this.hintItem?.node.name ?? '-'} hand=${this.hand!.name} parent=${this.hand!.parent?.name}`);
        this.setHandVisible(true);
        this.hand!.setScale(1, 1, 1);
        this.mode === 'drag' ? this.dragStep() : this.rotateStep();
    }

    private restart() { this.stop(); this.play(); }

    private stop() {
        if (!this.showing) return;
        this.showing = false;
        Tween.stopAllByTarget(this.hand!);
        this.setHandVisible(false);
        this.hintItem = null;
    }

    /**
     * Item đầu tiên chưa xong mà CẢ Ô nằm trọn trong màn hình.
     * `isOnScreen` của ItemManager còn tính cả cullPad (ô đang trượt qua mép, nửa trong nửa ngoài) →
     * tay sẽ bắt đầu từ ngoài màn. Nên kiểm tra lại bằng pixel: tâm ô cách mép màn ≥ nửa ô.
     */
    private pickItem(): ItemController | null {
        const im = this.itemManager!, cam = this.cam!;
        const W = screen.windowSize.width, H = screen.windowSize.height;
        const half = (im.bar?.hitHeight ?? 200) / 2 * (im.bar?.pixelsPerUnit() ?? 0);   // nửa ô (px màn hình)
        const tmp = new Vec3();
        for (const it of im.items) {
            if (!it.isOnScreen || it.isCompleted || !it.target) continue;
            const s = cam.worldToScreen(it.node.worldPosition, tmp);
            if (s.x >= half && s.x <= W - half && s.y >= half && s.y <= H - half) return it;
        }
        return null;
    }

    // ------------------------------------------------------------ drag: ô → target
    private dragStep() {
        const item = this.hintItem;
        if (!this.showing || !item || !item.target) return;
        const from = this.toHand(this.cam!.worldToScreen(item.node.worldPosition, new Vec3()));
        const to = this.toHand(this.targetScreenCenter(item.target));   // tâm bbox trên màn (pivot FBX có thể nằm xa hình)
        const hand = this.hand!;
        hand.setPosition(from);
        hand.setScale(1, 1, 1);
        tween(hand)
            .to(0.15, { scale: v3(0.85, 0.85, 1) })              // nhấn
            .delay(0.1)
            .to(this.moveTime, { position: to }, { easing: 'smooth' })
            .to(0.15, { scale: v3(1, 1, 1) })                    // thả
            .delay(this.holdTime)
            .call(() => this.dragStep())                         // lặp, đọc lại vị trí mỗi vòng
            .start();
    }

    // ------------------------------------------------------------ rotate: quẹt ngang giữa vùng chơi
    private rotateStep() {
        if (!this.showing) return;
        const hand = this.hand!;
        const r = this.box && this.cam ? this.box.getCamRect(this.cam.orthoHeight, true, true) : null;
        const cx = r ? (r.left + r.right) / 2 : 0, cy = r ? (r.top + r.bottom) / 2 : 0;
        const half = r ? (r.right - r.left) * this.rotateSwipeFrac / 2 : 2;
        // cam space (WCam) → pixel màn hình → UI: cùng orthoHeight/aspect nên pixel = (x/ppu + W/2, y/ppu + H/2)
        const W = screen.windowSize.width, H = screen.windowSize.height, ppu = H / (2 * this.cam!.orthoHeight);
        const a = this.toHand(v3((cx - half) * ppu + W / 2, cy * ppu + H / 2, 0));
        const b = this.toHand(v3((cx + half) * ppu + W / 2, cy * ppu + H / 2, 0));
        hand.setPosition(a);
        hand.setScale(1, 1, 1);
        tween(hand)
            .to(0.15, { scale: v3(0.85, 0.85, 1) })
            .to(this.rotateSwipeTime, { position: b }, { easing: 'sineInOut' })
            .to(this.rotateSwipeTime, { position: a }, { easing: 'sineInOut' })
            .to(0.15, { scale: v3(1, 1, 1) })
            .delay(this.holdTime)
            .call(() => this.rotateStep())
            .start();
    }

    // ------------------------------------------------------------ helpers
    /** Ô của item nằm trọn trong màn hình? (tâm cách mép ≥ nửa ô) */
    private fullyOnScreen(it: ItemController): boolean {
        if (!it.isOnScreen) return false;
        const im = this.itemManager!, W = screen.windowSize.width, H = screen.windowSize.height;
        const half = (im.bar?.hitHeight ?? 200) / 2 * (im.bar?.pixelsPerUnit() ?? 0);
        const s = this.cam!.worldToScreen(it.node.worldPosition, new Vec3());
        return s.x >= half && s.x <= W - half && s.y >= half && s.y <= H - half;
    }

    /** Tâm bbox của mesh target trên màn hình (px). Không có mesh bounds → pivot */
    private targetScreenCenter(target: Node): Vec3 {
        const cam = this.cam!;
        const st = target.getComponent(MeshRenderer)?.mesh?.struct;
        if (!st?.minPosition || !st.maxPosition) return cam.worldToScreen(target.worldPosition, new Vec3());
        const lo = st.minPosition, hi = st.maxPosition, mat = target.worldMatrix, tmp = new Vec3();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
            tmp.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
            Vec3.transformMat4(tmp, tmp, mat);
            cam.worldToScreen(tmp, tmp);
            minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
            minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
        }
        return new Vec3((minX + maxX) / 2, (minY + maxY) / 2, 0);
    }

    /** pixel màn hình → local của node cha tay (UI 2D) qua UICam */
    private toHand(s: Vec3): Vec3 {
        const w = this.uiCam!.screenToWorld(v3(s.x, s.y, 0), new Vec3());
        const parent = this.hand!.parent;
        const l = parent ? parent.inverseTransformPoint(new Vec3(), w) : w;
        l.z = -1;                                   // trước UICam một chút
        return l;
    }

    /** Ẩn/hiện tay. Script nằm ngay trên node tay → chỉ tắt các con (tắt chính node thì update() không chạy nữa) */
    private setHandVisible(on: boolean) {
        const h = this.hand!;
        if (h === this.node) for (const c of h.children) c.active = on;
        else h.active = on;
    }

    private static setLayerRecursive(n: Node, layer: number) {
        n.layer = layer;
        for (const c of n.children) HandHintManager.setLayerRecursive(c, layer);
    }

    private onUserTouch() {
        this.notify();
    }
}
