import { _decorator, Camera, CCObject, Component, EventTouch, Input, input, Layers, MeshRenderer, Node, Quat, UITransform, Vec2, Vec3, Vec4 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { BottomBar } from '../Item/BottomBar';
import { ItemCallbacks, ItemController } from '../Item/ItemController';
import { ItemGraphic } from '../Item/ItemGraphic';
import { ReleaseResult } from '../Item/ItemMovement';
import { CELL_PX, px } from '../Config/TrayConfig';
import { GameManager } from './GameManager';
import { LevelConfig } from './LevelConfig';
import { SnapEffect } from '../Utils/SnapEffect';
import { AppLovinAnalytics } from '../../Tool/AppLovinAnalytics';
import { TrayLayout } from './TrayLayout';
import { SnapRules } from './SnapRules';
import { ItemSfx } from './ItemSfx';
import { Ply_Pool } from '../ScriptTemplate/Ply_Pool';
import { PoolType } from '../ScriptTemplate/Ply_Types';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * ItemManager: quản lý TẤT CẢ item trong thanh.
 * Thông số tách sang component cùng node: TrayLayout (xếp ô + xem trước), SnapRules (luật thả), ItemSfx (âm thanh).
 * Danh sách item + thứ tự + storeAfterItems là của MAP → nằm ở LevelConfig (prefab Level), không lưu trong scene.
 *
 *  build()            lúc chạy: lấy prefab Item từ Ply_Pool cho mỗi ô của LevelConfig, xếp vào BottomBar/Content
 *  editor             item xem trước sinh từ LevelConfig, là node DontSave (không lưu vào scene)
 *  updateVisibility() mỗi frame: xếp ô theo bar.offset (vòng lặp nếu tràn thanh), ẩn ô ngoài thanh.
 *                     Thanh ngang: ô xếp theo +X; thanh dọc (màn ngang, bar.vertical): theo −Y từ trên xuống
 *  nhấc item          nghe BottomBar.EVENT_LIFT → pick() ô dưới ngón tay → item.onSelect
 *                     rồi tự theo dõi TOUCH_MOVE / END cho tới khi thả
 *  onSnapped()        đếm tiến trình, gỡ ô, dồn thanh, báo win
 */
@ccclass('ItemManager')
@executeInEditMode
export class ItemManager extends Component implements ItemCallbacks {

    @property({ serializable: false, displayName: '⚙ Hiện thông số nâng cao', tooltip: 'Hiện các tham chiếu (prefab, thanh, camera, effect...) — thường đã gán sẵn, ít khi phải đổi' })
    showAdvanced = false;

    /** Map hiện tại (prefab Level trong scene) */
    get level(): LevelConfig | null { return LevelConfig.current; }
    /** Mesh được chơi theo thứ tự ô (LevelConfig.items; trống → mọi mesh trong phòng) */
    get pickTargets(): Node[] { return this.level?.targets() ?? []; }
    /** Chơi đủ N item thì vào store mode — cấu hình theo map (LevelConfig) */
    get storeAfterItems() { return this.level?.storeAfterItems ?? 0; }

    @property({ visible(this: ItemManager) { return this.showAdvanced; }, tooltip: 'BẬT: mesh KHÔNG có trong pickTargets cũng đổi sang xám (chỉ đồ được chơi mới có màu khi xếp xong)' })
    grayOthers = true;

    @property({ type: BottomBar, visible(this: ItemManager) { return this.showAdvanced; }, tooltip: 'Thanh chứa item (BottomBar)' })
    bar: BottomBar | null = null;

    @property({ type: Node, visible(this: ItemManager) { return this.showAdvanced; }, tooltip: 'Node rỗng trong world để cắm icon khi kéo (Gameplay/DragGhost). Layer = TRAY (đèn chiếu layer này)' })
    ghostRoot: Node | null = null;

    @property({ type: Camera, visible(this: ItemManager) { return this.showAdvanced; }, tooltip: 'Camera vẽ phòng (WCam). Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ type: SnapEffect, visible(this: ItemManager) { return this.showAdvanced; }, tooltip: 'Effect nổ tại target khi thả đúng (để trống = không có)' })
    snapEffect: SnapEffect | null = null;

    // ---- thông số con: tách sang component cùng node (tự thêm nếu thiếu) ----
    /** Cách xếp ô trong thanh + xem trước trong editor */
    get layout(): TrayLayout { return this.sub(TrayLayout); }
    /** Luật thả đúng + animation target */
    get rules(): SnapRules { return this.sub(SnapRules); }
    /** Âm thanh nhấc / thả */
    get sfx(): ItemSfx { return this.sub(ItemSfx); }

    /** Lấy component cấu hình cùng node, tự thêm nếu scene cũ chưa có component đó. */
    private sub<T extends Component>(type: new () => T): T {
        return this.getComponent(type) ?? this.addComponent(type)!;
    }

    // tên cũ giữ lại (đọc / ghi qua component con) để code + Map Creator dùng như trước
    /** Đọc cạnh ô dự phòng từ TrayLayout qua API cũ của ItemManager. */
    get cellSize() { return this.layout.cellSize; }
    /** Ghi cạnh ô qua TrayLayout để kích hoạt cập nhật thẻ Cell. */
    set cellSize(v: number) { this.layout.cellSize = v; }
    /** Tỉ lệ cạnh ô mà icon được phép chiếm, lấy từ TrayLayout. */
    get iconFill() { return this.layout.iconFill; }
    /** Chuyển cấu hình tỉ lệ icon từ API cũ sang TrayLayout. */
    set iconFill(v: number) { this.layout.iconFill = v; }
    /** Khoảng cách giữa hai tâm ô liền nhau, tính bằng px local của thanh. */
    get spacing() { return this.layout.spacing; }
    /** Chuyển khoảng cách ô từ API cũ sang TrayLayout. */
    set spacing(v: number) { this.layout.spacing = v; }
    /** Lề từ mép đầu thanh tới tâm ô đầu tiên, tính bằng px local. */
    get edgePad() { return this.layout.edgePad; }
    /** Chuyển lề đầu thanh từ API cũ sang TrayLayout. */
    set edgePad(v: number) { this.layout.edgePad = v; }
    /** Khoảng nới ngoài mép thanh trước khi ẩn ô, tính bằng px local. */
    get cullPad() { return this.layout.cullPad; }
    /** Đọc cờ cho phép hiện thẻ Cell từ TrayLayout. */
    get showCells() { return this.layout.showCells; }
    /** Đọc cờ hiện thẻ Cell lúc chơi ở màn dọc. */
    get showCellsInPlay() { return this.layout.showCellsInPlay; }
    /** Cho biết item lấy thứ tự Hierarchy thay cho vị trí ngang hiện tại. */
    get orderByHierarchy() { return this.layout.orderByHierarchy; }
    /** Vị trí cuộn preview từ 0 đến 1, không thay đổi tiến trình lúc chơi. */
    get previewScroll() { return this.layout.previewScroll; }
    /** Số item đầu được coi là đã gom trong preview của editor. */
    get previewCollected() { return this.layout.previewCollected; }
    /** Cờ hiện cả các item ngoài vùng thanh trong preview của editor. */
    get showHiddenItems() { return this.layout.showHiddenItems; }
    /** Chuyển cờ xem toàn bộ hàng item sang TrayLayout. */
    set showHiddenItems(v: boolean) { this.layout.showHiddenItems = v; }
    /** Ngưỡng thả đúng (px chuẩn màn rộng 393pt): LevelConfig.snapPx nếu > 0, không thì SnapRules. */
    get snapPx() { const l = this.level?.snapPx ?? 0; return l > 0 ? l : this.rules.snapPx; }
    /** Cho biết ngưỡng thả đúng có cộng thêm kích thước bao của target hay không. */
    get snapByBounds() { return this.rules.snapByBounds; }
    /** Cho biết target của item có bắt buộc gần điểm thả nhất hay không. */
    get requireNearest() { return this.rules.requireNearest; }
    /** Hệ số phóng to target khi thả đúng, lấy từ SnapRules. */
    get snapScale() { return this.rules.snapScale; }
    /** Thời gian target phóng to khi thả đúng, tính bằng giây. */
    get snapScaleUpDuration() { return this.rules.snapScaleUpDuration; }
    /** Thời gian target thu về kích thước gốc, tính bằng giây. */
    get snapScaleDownDuration() { return this.rules.snapScaleDownDuration; }

    // nút editor cũ (Map Creator gọi): tick = chạy
    /** Giữ API cũ để Map Creator yêu cầu sinh preview, chỉ thực hiện trong editor. */
    set previewItems(v: boolean) { if (v && EDITOR) this.buildPreview(); }
    /** Luôn trả false vì sinh preview là thao tác tức thời. */
    get previewItems() { return false; }
    /** Giữ API cũ để Map Creator yêu cầu xoá preview, chỉ thực hiện trong editor. */
    set clearPreview(v: boolean) { if (v && EDITOR) this.clearContent(); }
    /** Luôn trả false để thao tác xoá preview không giữ trạng thái bật. */
    get clearPreview() { return false; }

    /** TrayLayout đổi cellSize / showCells → áp ngay cho thẻ Cell */
    onLayoutChanged() {
        this.applyCellSize();
        this.applyShowCells();
    }

    /** Đã vào chế độ "chạm đâu cũng ra store" */
    get storeMode() { return this._storeMode; }
    private _storeMode = false;

    /** Layer riêng cho thẻ + icon trong thanh (đèn chiếu, phân biệt với map). Cắt theo vùng thanh do shader clipRect lo */
    static readonly TRAY_LAYER_NAME = 'TRAY';
    static readonly TRAY_LAYER_BIT = 0;
    /** Mặt nạ layer riêng dùng chung cho icon trong thanh và ghost đang kéo. */
    static get trayLayer() { return 1 << ItemManager.TRAY_LAYER_BIT; }

    /** Đặt layer TRAY cho item và toàn bộ con */
    static setTrayLayer(n: Node) {
        n.layer = ItemManager.trayLayer;
        for (const c of n.children) ItemManager.setTrayLayer(c);
    }

    /** Cell có hiện không ở ngữ cảnh hiện tại (editor theo showCells, Play cần thêm showCellsInPlay) */
    private get cellsVisible() { return this.showCells && (EDITOR || this.showCellsInPlay || !!this.bar?.vertical); }   // màn ngang giữ cell như cũ

    /** Tất cả item, theo thứ tự trong thanh */
    items: ItemController[] = [];
    collected = 0;

    /** Tổng số item của lượt chơi, gồm cả item đã hoàn thành. */
    get total() { return this.items.length; }
    /** Số item chưa hoàn thành để tính bố cục thanh và điều kiện kết thúc. */
    get remain() { return this.items.length - this.collected; }

    // ---- nội bộ ----
    // ---- analytics (AppLovin) ----
    /** CHALLENGE_STARTED đã bắn (lần nhấc item đầu tiên) */
    private startedSent = false;
    /** Số mốc 25/50/75 đã bắn (0..3), bắn theo thứ tự, mỗi mốc 1 lần */
    private milestonesSent = 0;
    private solvedSent = false;

    private dragging: ItemController | null = null;   // item đang được kéo
    /** Vùng thanh trên màn hình (0..1) → clipRect cho shader icon/thẻ; item ngoài vùng bị cắt */
    private barRect = new Vec4(0, 0, 1, 1);
    private _tmpRect = new Vec4();
    /** Báo đang kéo item để tạm chặn xoay phòng và ẩn tay hướng dẫn. */
    get isDragging() { return !!this.dragging; }
    private touchId = -1;
    /** nửa độ dài thanh theo trục xếp (local px): ngang = width/2, dọc = height/2 */
    private barHalfW = 540;
    private lastVertical = false;
    /** true = item tràn thanh → xếp vòng lặp + cho kéo; false = đủ chỗ, căn giữa, không kéo */
    private loop = false;
    /** chu kỳ vòng lặp (local px) khi loop */
    private period = 0;

    // =========================================================== vòng đời
    /** Đảm bảo layer TRAY tồn tại trước khi dựng icon và ghost. */
    onLoad() {
        // đăng ký layer TRAY (bit 0) nếu project chưa khai báo trong Project Settings → Layers
        const existing = Layers.nameToLayer(ItemManager.TRAY_LAYER_NAME);
        if (existing === undefined || existing < 0) Layers.addLayer(ItemManager.TRAY_LAYER_NAME, ItemManager.TRAY_LAYER_BIT);
    }

    /** Dựng thanh item lúc chơi sau khi các component đã hoàn tất onLoad. */
    start() {
        if (EDITOR) return;
        this.build();
    }

    /** Nhận yêu cầu nhấc item/đổi bố cục từ thanh và theo dõi ngón tay kéo item. */
    onEnable() {
        if (EDITOR) return;
        this.bar?.node.on(BottomBar.EVENT_LIFT, this.onLift, this);
        this.bar?.node.on(BottomBar.EVENT_LAYOUT, this.onBarLayout, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    /** Gỡ sự kiện của thanh, kéo-thả và mở store khi manager bị tắt. */
    onDisable() {
        if (EDITOR) return;
        this.bar?.node.off(BottomBar.EVENT_LIFT, this.onLift, this);
        this.bar?.node.off(BottomBar.EVENT_LAYOUT, this.onBarLayout, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.off(Input.EventType.TOUCH_START, this.onStoreTouch, this);
    }

    private lastModelRot = new Quat();

    /** Đồng bộ góc icon theo phòng; cập nhật bố cục editor hoặc vùng item hiện khi chơi. */
    update() {
        this.syncIconRotation();          // chạy cả trong editor: xoay model root là icon xoay theo ngay
        if (EDITOR) { this.editorLayout(); return; }
        this.updateVisibility();
    }

    private _editorKey = '';
    private _previewKey = '';

    /**
     * Editor: xếp item preview Y NHƯ lúc Play (vòng lặp khi tràn thanh, ô ngoài thanh ẩn, item đã gom ẩn + dồn lên).
     * Chỉ chạy lại khi có gì đổi (thứ tự node, Layout, kích thước / dọc-ngang của thanh, nhóm Editor Preview).
     */
    private editorLayout() {
        const bar = this.bar, content = bar?.content;
        if (!bar || !content) return;
        this.ensurePreview();
        const list = this.previewList();

        const cell = this.cellPx();
        const key = `${list.map(it => it.node.uuid).join(',')}|${this.spacing}|${this.edgePad}|${this.cullPad}|${bar.length}|${bar.vertical}|${cell}`
            + `|${this.previewScroll}|${this.previewCollected}|${this.showHiddenItems}|${this.showCells}`;
        if (key === this._editorKey) return;
        this._editorKey = key;

        const n = list.length;
        const done = Math.min(Math.max(0, Math.floor(this.previewCollected)), n);
        const remain = n - done;
        this.barHalfW = this.barHalfLen();
        this.computeLoop(remain);
        const off = -this.previewScroll * this.period;
        const left = -this.barHalfW - this.cullPad, right = this.barHalfW + this.cullPad;
        list.forEach((it, i) => {
            if (this.showHiddenItems) {                   // xếp thẳng hàng hết, không cắt
                this.placeSlot(it, -this.barHalfW + this.edgePad + this.spacing * i);
                ItemManager.setPreviewVisible(it, true);
                return;
            }
            if (i < done) { ItemManager.setPreviewVisible(it, false); return; }   // N item đầu coi như đã gom → các ô sau dồn lên
            const x = this.slotX(i - done, remain, off);
            this.placeSlot(it, x);
            ItemManager.setPreviewVisible(it, x >= left && x <= right);
        });
        this.applyCellSize();
        this.applyShowCells();
        if (n > 0) bar.setCount(done, n);
    }

    /** Editor: item preview trong Content theo thứ tự ô của LevelConfig */
    private previewList(): ItemController[] {
        const content = this.bar?.content;
        if (!content) return [];
        const order = new Map(this.pickTargets.map((t, i) => [t, i] as [Node, number]));
        /** Lấy thứ tự target trong level; item không có target hợp lệ được đẩy xuống cuối. */
        const rank = (it: ItemController) => (it.target && order.has(it.target) ? order.get(it.target)! : 1e9);
        return content.getComponentsInChildren(ItemController).sort((a, b) => rank(a) - rank(b));
    }

    /** Cỡ ô | iconFill hiện tại — scale icon đo sẵn trong LevelConfig chỉ dùng khi khớp key này */
    iconFitKey() {
        return `${this.cellPx()}|${this.iconFill}`;
    }

    /**
     * Editor: item xem trước khớp LevelConfig chưa (danh sách, thứ tự, scale icon, cỡ ô / iconFill)? Chưa → sinh lại.
     * Item xem trước là node DontSave: không lưu vào scene, lúc chạy build() sinh từ Ply_Pool.
     */
    private ensurePreview() {
        const level = this.level, content = this.bar?.content;
        if (!content) return;
        const targets = level ? level.targets() : [];
        const key = targets.map(t => t.uuid).join(',') + '|' + this.iconFitKey() + '|' + (level?.iconFitKey ?? '')
            + '|' + (level?.items.map(it => it.iconScale.toFixed(4)).join(',') ?? '');
        const have = content.getComponentsInChildren(ItemController);
        const fine = have.length === targets.length && have.every(it => it.target?.isValid && it.graphic?.iconClone?.isValid);
        if (key === this._previewKey && fine) return;
        this._previewKey = key;
        this.rebuildPreview(targets, true);
    }

    /** Editor: xoá preview cũ, sinh 1 item DontSave cho mỗi target. usePreset = dùng scale icon đã lưu trong LevelConfig (nếu khớp key) */
    private rebuildPreview(targets: Node[], usePreset: boolean) {
        const content = this.bar?.content, level = this.level;
        if (!content) return;
        this.clearContent();
        const cam = this.bar!.cam ?? this.cam;
        const px = this.cellPx(), fill = this.iconFill, key = this.iconFitKey();
        for (const target of targets) {
            const node = Ply_Pool.create(PoolType.Item);               // editor: instantiate prefab Item khai báo ở Ply_Pool
            if (!node) return;
            ItemManager.unlinkPrefab(node);
            node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;   // chỉ để xem, không lưu vào scene
            node.name = `Item_${target.name}`;
            node.setParent(content);
            const item = node.getComponent(ItemController)!;
            item.target = target;
            item.graphic!.bind(target, cam, px, fill, usePreset && level ? level.presetScale(target, key) : 0);   // chỉ hình, không gray
            ItemManager.unlinkPrefab(node);
            ItemManager.setTrayLayer(node);
        }
        this.applyShowCells();
        this._editorKey = '';                                          // editorLayout xếp / cull lại
    }

    /**
     * Editor (Map Creator gọi): đo lại scale icon của mọi ô theo cỡ ô / iconFill hiện tại.
     * Trả về { key, items: [{ uuid (target), scale }] } để ghi vào LevelConfig của prefab Level.
     */
    measureIcons(): { key: string; items: { uuid: string; scale: number }[] } {
        const targets = this.pickTargets;
        this.rebuildPreview(targets, false);
        this._previewKey = '';                                         // frame sau ensurePreview so lại với LevelConfig mới
        const byTarget = new Map(this.bar!.content!.getComponentsInChildren(ItemController).map(it => [it.target, it] as [Node | null, ItemController]));
        return { key: this.iconFitKey(), items: targets.map(t => ({ uuid: t.uuid, scale: byTarget.get(t)?.graphic?.iconScale ?? 0 })) };
    }

    /** Editor: ẩn/hiện item preview (lúc chạy build() bật lại hết rồi tự cull) */
    private static setPreviewVisible(it: ItemController, on: boolean) {
        if (it.node.active !== on) it.node.active = on;
    }


    /** Cập nhật vùng cắt sau bước bố cục để icon không vẽ lòi ra ngoài thanh. */
    lateUpdate() {
        if (EDITOR) return;
        this.updateClip();
    }

    /** Thanh đổi vị trí/kích thước (resize, xoay ngang) → cập nhật clipRect cho mọi item đang nằm trong thanh */
    private updateClip() {
        if (!this.bar || !this.bar.screenRect01(this._tmpRect)) return;
        if (Vec4.equals(this.barRect, this._tmpRect, 1e-4)) return;
        this.barRect.set(this._tmpRect);
        for (const item of this.items) {
            if (item === this.dragging) continue;          // ghost đang kéo: không cắt
            item.graphic?.setClip(this.barRect);
        }
    }

    /** Target xoay (ModelRotate xoay node nào cũng được, hoặc xoay tay trong editor) → icon trong thanh xoay theo */
    private syncIconRotation() {
        const list = this.items.length ? this.items : (this.bar?.content?.getComponentsInChildren(ItemController) ?? []);
        const probe = list.find(it => it.target?.isValid)?.target;
        if (!probe) return;
        const r = probe.worldRotation;                 // theo dõi 1 target đại diện (cùng cha nên xoay cùng nhau)
        if (Quat.equals(r, this.lastModelRot)) return;
        this.lastModelRot.set(r);
        for (const it of list) if (!it.isCompleted) it.graphic?.syncRotation();
    }

    // =========================================================== 1. build
    /** Lúc chạy: 1 ô cho mỗi target của LevelConfig, prefab Item lấy từ Ply_Pool */
    build() {
        const gm = GameManager.inst!;
        const level = this.level;
        if (!level) { console.error('[ItemManager] scene chưa có prefab Level (LevelConfig) — không có item'); return; }
        const cam = this.camera();
        const content = this.bar!.content!;
        this.barHalfW = this.barHalfLen();
        this.lastVertical = this.bar!.vertical;
        for (const c of content.children.slice()) c.destroy();         // scene cũ còn lưu item preview → bỏ, sinh mới

        const allMeshes = level.allMeshes();
        const targets = level.targets();

        // mesh không được chọn chơi: xám luôn (không cần trả màu nên đổi thẳng)
        if (this.grayOthers && gm.grayMat) {
            for (const n of allMeshes) {
                if (targets.includes(n)) continue;
                const r = n.getComponent(MeshRenderer)!;
                r.sharedMaterials = r.sharedMaterials.map(() => gm.grayMat!);
            }
        }

        const fitKey = this.iconFitKey();
        this.items = [];
        targets.forEach((target, i) => {
            const node = Ply_Pool.create(PoolType.Item, content);          // prefab Item khai báo ở Ply_Pool
            const item = node?.getComponent(ItemController) ?? null;
            if (!node || !item) { console.error('[ItemManager] Ply_Pool chưa khai báo prefab Item'); return; }
            node.name = `Item_${target.name}`;
            this.placeSlot(item, this.slotX(i));
            item.init(
                target,
                i,
                cam,
                this.ghostRoot!,
                gm.grayMat,
                this,
                this.cellPx(),
                this.iconFill,
                this.snapScale,
                this.snapScaleUpDuration,
                this.snapScaleDownDuration,
                level.presetScale(target, fitKey),                     // scale icon đã đo sẵn (khớp cỡ ô / iconFill) → khỏi đo lại
            );
            item.graphic!.blinkColor = gm.blinkOnDrag ? gm.blinkColor : null;   // fade màu target khi kéo
            item.graphic!.blinkCycle = gm.blinkCycle;
            item.graphic!.blinkIdle = gm.blinkIdle;
            this.setCellActive(item, this.cellsVisible);
            ItemManager.setTrayLayer(item.node);
            this.items.push(item);
        });

        this.collected = 0;
        this.snapEffect?.resetCount();
        this.bar!.resetScroll();
        this.setLayout(this.remain);
        this.refreshCount();
        this.updateVisibility();
        this.barRect.set(-1, -1, -1, -1);              // ép updateClip() gán clipRect cho item mới ở lateUpdate
        console.log(`[ItemManager] ${this.total} items (${level.node.name})`);
    }

    /** Đẩy `collected/total` lên label của BottomBar */
    refreshCount(total = this.total) {
        this.bar?.setCount(this.collected, total);
    }

    /** Tổng chiều rộng content khi còn n ô */
    private contentWidth(n: number) {
        return n <= 0 ? 0 : this.edgePad * 2 + this.spacing * (n - 1);
    }

    /**
     * Quyết định chế độ xếp theo số ô còn lại:
     *  - tràn thanh → loop, cho kéo
     *  - đủ chỗ     → căn giữa, khoá kéo
     */
    private setLayout(n: number) {
        this.computeLoop(n);
        this.bar!.setScrollable(this.loop);
    }

    /** loop + period cho n ô (không đụng thanh) */
    private computeLoop(n: number) {
        const barW = this.barHalfW * 2;
        this.loop = this.contentWidth(n) > barW;
        // chu kỳ ≥ barW + 1 ô để không bao giờ phải vẽ 1 item ở 2 chỗ
        this.period = Math.max(n * this.spacing, barW + this.spacing);
    }

    /** Nửa độ dài thanh theo trục xếp item */
    private barHalfLen() {
        return (this.bar?.length ?? 1080) / 2;
    }

    /** Đặt ô tại toạ độ `pos` dọc theo trục thanh: ngang → x, dọc → −y (ô đầu ở trên) */
    private placeSlot(item: ItemController, pos: number) {
        if (this.bar!.vertical) item.node.setPosition(0, -pos, 0);
        else item.node.setPosition(pos, 0, 0);
    }

    /** toạ độ dọc trục thanh (local trong Content) của ô thứ i với offset (mặc định = offset scroll của thanh) */
    private slotX(i: number, n = this.remain, off = this.bar!.offset) {
        if (this.loop) {
            // mod về [−SPACING, period − SPACING): ô vừa rời mép phải sẽ hiện lại từ mép trái
            let rel = (i * this.spacing + off + this.spacing) % this.period;
            if (rel < 0) rel += this.period;
            return -this.barHalfW + this.edgePad + rel - this.spacing;
        }
        return -this.contentWidth(n) / 2 + this.edgePad + this.spacing * i;
    }

    // =========================================================== 2. layout + cull (mỗi frame)
    /** Xếp các item còn lại theo vòng cuộn và chỉ hiện ô nằm trong vùng thanh cho phép. */
    updateVisibility() {
        if (!this.bar?.content) return;
        // thanh đổi độ dài / đổi ngang↔dọc (resize / fitLayout) → tính lại loop/period
        const halfW = this.barHalfLen();
        const vertical = this.bar.vertical;
        if (halfW !== this.barHalfW || vertical !== this.lastVertical) {
            this.barHalfW = halfW; this.lastVertical = vertical;
            this.setLayout(this.remain);
        }
        const left = -this.barHalfW - this.cullPad;
        const right = this.barHalfW + this.cullPad;
        const n = this.remain;

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (item === this.dragging) continue;          // đang kéo thì không đụng
            if (i >= n) { item.setOnScreen(false); continue; }   // đã xong → ẩn
            const x = this.slotX(i, n);
            this.placeSlot(item, x);
            item.setOnScreen(x >= left && x <= right);
        }
    }

    // =========================================================== 3. nhấc & kéo
    /** BottomBar báo: người chơi kéo LÊN từ điểm startPos */
    private onLift(startPos: Vec2) {
        if (this.dragging || this._storeMode) return;
        const item = this.pick(startPos);
        if (!item) return;

        if (!this.startedSent) { this.startedSent = true; AppLovinAnalytics.challengeStarted(); }
        this.dragging = item;
        this.touchId = -2;                 // chờ TOUCH_MOVE đầu tiên để lấy id thật
        item.graphic?.setClip(ItemGraphic.CLIP_NONE);   // ghost nổi trên map + label, không bị cắt theo thanh
        item.onSelect(startPos);
        this.sfx.playPick();
    }

    /** Kết thúc kéo (thả / huỷ): icon về ô → cắt lại theo vùng thanh */
    private endDrag() {
        this.dragging?.graphic?.setClip(this.barRect);
        this.dragging = null;
        this.touchId = -1;
    }

    /** Ô nào đang nằm dưới ngón tay (so trên màn hình, nửa ô = cellPx/2) */
    private pick(screenPos: Vec2): ItemController | null {
        const cam = this.camera();
        const half = this.cellPx() / 2 * this.bar!.pixelsPerUnit();   // nửa ô đổi ra pixel màn hình
        const tmp = new Vec3();

        for (const item of this.items) {
            if (!item.isOnScreen || item.isCompleted) continue;
            const s = cam.worldToScreen(item.node.worldPosition, tmp);
            if (Math.abs(s.x - screenPos.x) <= half && Math.abs(s.y - screenPos.y) <= half) return item;
        }
        return null;
    }

    /** Gắn ngón tay cho lượt kéo mới rồi chuyển vị trí chạm tới item đang được kéo. */
    private onTouchMove(e: EventTouch) {
        if (!this.dragging) return;
        if (this.touchId === -2) this.touchId = e.getID();
        if (e.getID() !== this.touchId) return;
        this.dragging.onMove(e.getLocation());
    }

    /** Kết thúc lượt kéo của đúng ngón tay và để item tự kiểm tra kết quả thả. */
    private onTouchEnd(e: EventTouch) {
        if (!this.dragging || (this.touchId !== -2 && e.getID() !== this.touchId)) return;
        const item = this.dragging;
        this.endDrag();
        item.onRelease();                  // → onSnapped hoặc onReturned
    }

    /** Huỷ lượt kéo hiện tại và yêu cầu item trở về thanh. */
    private onTouchCancel(e: EventTouch) {
        if (!this.dragging) return;
        const item = this.dragging;
        this.endDrag();
        item.onCancel();
    }

    // =========================================================== 4. callback từ item
    /** Phán snap khi thả tại ghostPos (pixel màn hình). Cấu hình ở group Snap. */
    judgeSnap(item: ItemController, ghostPos: Vec2): boolean {
        const own = item.target;
        if (!own) return false;

        // Ghost là cùng mesh/scale/rotation với target → ghost CHỒNG KHÍT target khi pivot trùng pivot.
        // (Mesh FBX bake toạ độ vào đỉnh nên pivot có thể nằm xa hình, đo bbox sẽ sai.)
        const dOwn = this.distToCenter(own, ghostPos);
        const tol = px(this.snapPx) + (this.snapByBounds ? this.halfMinExtentPx(own) : 0);
        if (dOwn > tol) return false;

        if (this.requireNearest) {
            for (const other of this.items) {
                if (other === item || other.isCompleted || !other.target) continue;
                // pivot trùng nhau (cùng FBX) thì không phân biệt được → bỏ qua
                if (this.distToCenter(other.target, ghostPos) < dOwn - 1) return false;
            }
        }
        return true;
    }

    /** Khoảng cách (px màn hình) từ p tới pivot của target */
    private distToCenter(target: Node, p: Vec2): number {
        const s = this.camera().worldToScreen(target.worldPosition, new Vec3());
        return Math.hypot(s.x - p.x, s.y - p.y);
    }

    /** Nửa cạnh nhỏ của bbox target trên màn hình (px) — vật to thì dung sai lớn hơn */
    private halfMinExtentPx(target: Node): number {
        const cam = this.camera();
        const st = target.getComponent(MeshRenderer)?.mesh?.struct;
        if (!st?.minPosition || !st.maxPosition) return 0;
        const lo = st.minPosition, hi = st.maxPosition, mat = target.worldMatrix, tmp = new Vec3();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
            tmp.set(i & 1 ? hi.x : lo.x, i & 2 ? hi.y : lo.y, i & 4 ? hi.z : lo.z);
            Vec3.transformMat4(tmp, tmp, mat);
            const s = cam.worldToScreen(tmp, tmp);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        return Math.min(maxX - minX, maxY - minY) / 2;
    }

    /** Phát hiệu ứng thả đúng, ghi tiến trình, dồn thanh rồi xét thắng hoặc chuyển sang mở store. */
    onSnapped(item: ItemController) {
        this.sfx.playDrop();
        if (item.target) this.snapEffect?.play(item.target);
        this.collected++;
        this.refreshCount();
        this.trackProgress();              // trước store/win để CHALLENGE_SOLVED đi trước ENDCARD_SHOWN
        this.removeAndCompact(item);

        if (this.collected >= this.total) {
            ui?.onWin?.();
        } else if (this.storeAfterItems > 0 && this.collected >= this.storeAfterItems) {
            this.enterStoreMode();
        }
    }

    /** Số item tính là "xong challenge": storeAfterItems nếu có, không thì tổng item */
    private challengeMax() {
        return this.storeAfterItems > 0 ? Math.min(this.storeAfterItems, this.total) : this.total;
    }

    /**
     * Bắn CHALLENGE_PASS_25/50/75 + CHALLENGE_SOLVED theo collected / challengeMax.
     * Mỗi mốc đúng 1 lần, theo thứ tự — max nhỏ (vd 3 item) thì 1 snap có thể nhảy qua 2 mốc, bắn cả 2.
     */
    private trackProgress() {
        const max = this.challengeMax();
        if (max <= 0) return;
        const pct = this.collected / max;
        const steps: [number, () => void][] = [
            [0.25, () => AppLovinAnalytics.challenge25()],
            [0.50, () => AppLovinAnalytics.challenge50()],
            [0.75, () => AppLovinAnalytics.challenge75()],
        ];
        while (this.milestonesSent < steps.length && pct >= steps[this.milestonesSent][0]) {
            steps[this.milestonesSent][1]();
            this.milestonesSent++;
        }
        if (!this.solvedSent && this.collected >= max) {
            this.solvedSent = true;
            AppLovinAnalytics.challengeSolved();
        }
    }

    /** Chơi đủ N item: khoá gameplay, chạm bất kỳ đâu (kể cả kéo thanh / xoay map) → store */
    enterStoreMode() {
        if (this._storeMode) return;
        this._storeMode = true;
        if (this.bar) this.bar.scrollEnabled = false;
        input.on(Input.EventType.TOUCH_START, this.onStoreTouch, this);
        console.log(`[ItemManager] store mode sau ${this.collected} item`);
    }

    /** Mở store khi người chơi chạm trong chế độ CTA sau ngưỡng hoàn thành của map. */
    private onStoreTouch() {
        ui?.openStore?.();
    }

    /** Điểm nhận kết quả thả trượt/huỷ; hiện chưa xử lý thêm vì item đã tự về ô. */
    onReturned(item: ItemController, result: ReleaseResult) {
        // thả trượt: icon đã tự về ô. Chỗ này để thêm sound / hint nếu cần
    }

    /**
     * Xáo thứ tự các ô CHƯA xong trong thanh (nút Shuffle gọi). Ô đã xong giữ ở cuối.
     * Không xáo khi đang kéo item. Thanh cuộn về đầu, ô pop nhẹ để thấy đổi.
     */
    shuffle() {
        if (this.dragging) return;
        const n = this.remain;
        if (n < 2) return;
        const rest = this.items.slice(0, n);
        for (let i = rest.length - 1; i > 0; i--) {            // Fisher–Yates
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        this.items = rest.concat(this.items.slice(n));
        this.bar?.resetScroll();
        this.setLayout(n);
        this.updateVisibility();
        for (const it of rest) {
            const g = it.graphic;
            if (!it.isOnScreen || !g?.iconClone) continue;
            g.iconClone.setScale(0, 0, 0);
            g.pop(true, 0.25);                                 // 0 → iconScale
        }
    }

    /** Gỡ ô đã xong: đẩy ra cuối danh sách, các ô sau tự dồn lên ở frame kế (updateVisibility) */
    private removeAndCompact(item: ItemController) {
        const idx = this.items.indexOf(item);
        if (idx < 0) return;
        this.items.splice(idx, 1);
        this.items.push(item);
        item.setOnScreen(false);
        this.setLayout(this.remain);
    }

    // =========================================================== editor preview
    /** Nút ▶ Preview items: sinh lại item xem trước, đo lại icon (chỉ để xem — lưu scale / thứ tự bằng Map Creator) */
    buildPreview() {
        if (!this.level) { console.warn('[ItemManager] scene chưa có prefab Level (LevelConfig)'); return; }
        this.rebuildPreview(this.pickTargets, false);
        this.collected = 0;
        this.refreshCount(this.pickTargets.length);
    }

    /**
     * Cắt liên kết prefab của node vừa instantiate (và toàn bộ con).
     *
     * Prefab instance khi lưu scene chỉ ghi `propertyOverrides` — mà override chỉ sinh ra khi
     * property bị đổi qua Inspector / Editor.Message. Gán bằng script trong editor KHÔNG đánh dấu
     * dirty → `ItemController.target` / `ItemGraphic.target` không được lưu, reload là mất (null).
     * Bỏ `_prefab` → node serialize đầy đủ vào scene như node thường, mọi property giữ nguyên.
     */
    static unlinkPrefab(n: Node) {
        (n as any)._prefab = null;
        for (const c of n.children) ItemManager.unlinkPrefab(c);
    }

    /** Editor: xếp lại item xem trước theo thứ tự ô của LevelConfig */
    applyOrderPreview() {
        this._editorKey = '';
        console.log('[ItemManager] order:', this.pickTargets.map(t => t.name).join(' → '));
    }

    /** Editor: xáo thứ tự ô trong LevelConfig (chỉ trên instance — lưu vào prefab bằng Map Creator / Apply) */
    shufflePreview() {
        const items = this.level?.items;
        if (!items || items.length < 2) return;
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        this._previewKey = '';
        console.log('[ItemManager] đã xáo thứ tự ô — mở Tool → Map Creator → Build items để lưu vào prefab Level');
    }

    /** Bật/tắt quad Cell của 1 item (fallback tìm con tên "Cell" cho item sinh từ prefab cũ) */
    private setCellActive(item: ItemController, on: boolean) {
        const cell = item.graphic?.cell ?? item.node.getChildByName('Cell');
        if (cell) { if (cell.active !== on) cell.active = on; this.resizeCell(cell); }
    }

    /** Thẻ Cell = ô vuông cạnh cellPx (QuadImage tự dựng lại khi UITransform đổi) */
    private resizeCell(cell: Node) {
        const size = this.cellPx();
        const ut = cell.getComponent(UITransform);
        if (ut && (ut.width !== size || ut.height !== size)) ut.setContentSize(size, size);
    }

    /** Áp cellSize cho mọi item đang có trong Content */
    private applyCellSize() {
        const content = this.bar?.content;
        if (!content) return;
        for (const it of content.getComponentsInChildren(ItemController)) {
            const cell = it.graphic?.cell ?? it.node.getChildByName('Cell');
            if (cell) this.resizeCell(cell);
        }
    }

    /** Thanh đổi ngang ↔ dọc: cellPx đổi (dọc theo cellSize, ngang theo Bg) → đo lại icon, thẻ Cell, ẩn/hiện cell */
    private onBarLayout() {
        const content = this.bar?.content;
        if (!content) return;
        const px = this.cellPx();
        for (const it of content.getComponentsInChildren(ItemController)) {
            const g = it.graphic;
            if (g) { g.cellPx = px; g.putIconInCell(); }
            this.setCellActive(it, this.cellsVisible);
        }
    }

    /** Áp showCells cho mọi item đang có trong Content */
    private applyShowCells() {
        const content = this.bar?.content;
        if (!content) return;
        for (const it of content.getComponentsInChildren(ItemController)) this.setCellActive(it, this.cellsVisible);
    }

    /** Xoá mọi con của Content (tách ngay, destroy hoãn tới cuối frame) */
    clearContent() {
        const content = this.bar?.content;
        if (!content) return;
        for (const c of content.children.slice()) { c.removeFromParent(); c.destroy(); }
    }

    // =========================================================== helpers
    /** Ô vuông chứa icon: cellSize, hoặc (=0) chiều cao dải content của BottomBar */
    cellPx(): number {
        const fromBg = this.bar?.cellFromBg ?? 0;        // thanh có Bg + fitContentToBg → ô luôn vừa trong Bg, cân trên dưới
        if (fromBg > 0) return fromBg;
        if (this.cellSize > 0) return this.cellSize;
        return this.bar?.hitHeight ?? CELL_PX;
    }

    /** Lấy camera đã gán cho manager, nếu thiếu thì dùng camera world của UI. */
    private camera(): Camera {
        return this.cam ?? ui.wCamera;
    }

    /** Nửa độ dài thanh + cullPad: ô có tâm ngoài khoảng này bị ẩn — EditorPreview vẽ gizmo */
    get cullHalfLen() { return this.barHalfLen() + this.cullPad; }

}
