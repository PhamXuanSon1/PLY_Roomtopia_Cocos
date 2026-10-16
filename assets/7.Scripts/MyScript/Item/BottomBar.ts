import { _decorator, Camera, Component, EventTouch, Input, input, Label, Mat4, math, Node, screen, Size, Sprite, UITransform, Vec2, Vec3, Vec4 } from 'cc';
import { EDITOR } from 'cc/env';
import { ui } from '../../Manager/UI';
import { LANDSCAPE_PANEL_FRAC } from '../Config/TrayConfig';
import { PreviewScreen } from '../Utils/PreviewScreen';
import { BoxBg } from './BoxBg';
import { Ply_Pool } from '../ScriptTemplate/Ply_Pool';
import { PoolType } from '../ScriptTemplate/Ply_Types';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * Thanh bar chứa item (BottomBar).
 *  - Màn DỌC : thanh NGANG dưới màn (vị trí như đặt trong scene), kéo trái/phải để cuộn, kéo LÊN để nhấc.
 *  - Màn NGANG: tự thành PANEL DỌC bám mép phải (panelFrac bề ngang, cao hết màn), kéo lên/xuống để cuộn,
 *               kéo theo verticalLiftDir (mặc định sang trái, vào phòng) để nhấc. Nền trắng của panel do BoxBg vẽ (dưới WCam).
 *  - Hold trong dải content rồi kéo dọc theo trục thanh → cộng dồn `offset` (local px, không giới hạn).
 *    Thả tay → trượt tiếp theo quán tính (`inertia`), chạm lại thì dừng.
 *    ItemManager đọc `offset` + `vertical` mỗi frame để xếp item theo vòng lặp.
 *  - Chỉ kéo được khi ItemManager gọi setScrollable(true) (item tràn thanh).
 *  - Layout (fit theo màn, Content giữa Bg, Tab, label) chạy CẢ trong editor → Scene editor thấy y như lúc Play.
 *    Vị trí/kích thước "nhà" (thanh ngang) được LƯU vào scene: chỉnh tay thanh khi xem màn dọc = chỉnh nhà;
 *    xem trước màn ngang (EditorPreview) rồi lưu scene cũng không làm lệch màn dọc lúc chạy.
 */
@ccclass('BottomBar')
@executeInEditMode
export class BottomBar extends Component {
    @property(Label)
    countLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Node chứa item, sẽ bị dịch theo trục thanh khi kéo. Để trống → tự tạo child "Content"' })
    content: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera render thanh này. Để trống → ui.wCamera' })
    cam: Camera | null = null;

    @property({ group: 'Scroll', tooltip: 'Cho phép kéo scroll' })
    scrollEnabled = true;

    @property({ tooltip: 'Tự đặt kích thước thanh theo màn hình (ngang: rộng = màn; dọc: cao = màn, rộng = panelFrac)' })
    fitWidthToScreen = true;

    @property({ group: 'Scroll', tooltip: 'Chiều cao (local px) của dải chạm quanh content.y (thanh ngang). Bật fitContentToBg thì tự tính = cao Bg − 2·contentPadY', visible(this: BottomBar) { return !this.fitContentToBg; } })
    hitHeight = 250;

    @property({ group: 'Scroll', tooltip: 'Ngón tay phải đi quá số px này mới tính là kéo' })
    dragThresholdPx = 8;

    @property({ group: 'Scroll', tooltip: 'Tốc độ mượt khi content đuổi theo ngón tay (0 = bám sát)' })
    followLerp = 12;

    @property({ group: 'Scroll', tooltip: 'Kéo lệch so với hướng NHẤC dưới góc này (độ) = NHẤC item, không scroll' })
    liftAngle = 70;

    @property({ group: 'Scroll', range: [0, 0.99, 0.01], slide: true, tooltip: 'Quán tính sau khi thả (0 = dừng ngay, 0.9 = trượt lâu)' })
    inertia = 0.9;

    @property({ group: 'Landscape', tooltip: 'Màn ngang → tự chuyển thành panel dọc bên phải' })
    autoVertical = true;

    @property({ group: 'Landscape', range: [0.05, 0.6, 0.01], slide: true, tooltip: 'Panel dọc chiếm bao nhiêu phần bề ngang màn', visible(this: BottomBar) { return this.autoVertical; } })
    panelFrac = LANDSCAPE_PANEL_FRAC;

    @property({ group: 'Landscape', tooltip: 'Panel dọc: kéo về hướng này (màn hình) = NHẤC item. (-1,0) = sang trái vào phòng', visible(this: BottomBar) { return this.autoVertical; } })
    verticalLiftDir = new Vec2(-1, 0);

    @property({ group: 'Scroll', tooltip: 'Vùng cắt item (clipRect) nới thêm bấy nhiêu px màn hình mỗi bên (0 = sát mép thanh)' })
    clipPaddingPx = 0;

    @property({ group: 'Skin', type: Node, tooltip: 'Node nền có sẵn trong scene (con của thanh, QuadImage anchor 0.5,0). Để trống → lấy con tên "Bg", không có nữa thì lấy prefab TrayBg từ Ply_Pool lúc chạy' })
    bgNode: Node | null = null;

    @property({ group: 'Skin', type: Node, tooltip: 'Node tab có sẵn trong scene (con của thanh, QuadImage anchor 0.5,0; chứa CountLabel). Để trống → lấy con tên "Tab", không có nữa thì lấy prefab TrayTab từ Ply_Pool lúc chạy' })
    tabNode: Node | null = null;

    @property({ group: 'Skin', tooltip: 'Chiều cao nền (prefab) khi thanh NGANG (local px). 0 = bằng chiều cao thanh. Bg có sẵn trong scene thì chỉnh thẳng UITransform của nó', visible(this: BottomBar) { return !this.sceneBg(); } })
    bgHeight = 0;

    @property({ group: 'Skin', tooltip: 'Tab (prefab) dịch dọc so với MÉP TRÊN nền (local px). Âm = lún xuống đè lên nền. Tab có sẵn trong scene thì kéo thẳng node', visible(this: BottomBar) { return !this.sceneTab(); } })
    tabOffsetY = -29;

    @property({ group: 'Skin', tooltip: 'Độ sâu (local z) của Bg prefab; Tab = +50. Âm = lùi ra SAU icon để mesh item luôn nằm trên nền/tab', visible(this: BottomBar) { return !this.sceneBg() || !this.sceneTab(); } })
    skinZ = -200;

    @property({ group: 'Skin', tooltip: 'Chuyển countLabel vào giữa Tab (tắt khung đếm cũ của BoxBg nếu label đang nằm trong đó)' })
    countLabelInTab = true;

    @property({ group: 'Skin', type: Node, tooltip: 'Khung đếm cũ của BoxBg (CountFrame) — màn NGANG label quay về đây (góc dưới-phải vùng chơi như cũ). Để trống → tự lấy BoxBg.countLabel' })
    countFrame: Node | null = null;

    @property({ group: 'Skin', tooltip: 'Thanh ngang: Content đặt vào GIỮA Bg theo chiều dọc và hitHeight = cao Bg − 2·contentPadY → ô icon (ItemManager.cellSize = 0) luôn nằm trong Bg, cân trên dưới' })
    fitContentToBg = true;

    @property({ group: 'Skin', tooltip: 'Lề trên/dưới (local px) giữa ô icon và mép Bg khi fitContentToBg', visible(this: BottomBar) { return this.fitContentToBg; } })
    contentPadY = 30;

    /** Cạnh ô icon suy từ Bg khi fitContentToBg (0 = không áp). ItemManager ưu tiên giá trị này hơn cellSize */
    get cellFromBg() { return this._cellFromBg; }
    private _cellFromBg = 0;

    private _bg: Node | null = null;
    private _tab: Node | null = null;
    private _countFrame: Node | null = null;
    private _layoutBg = false;    // chỉ tự layout khi Bg/Tab do code instantiate; node đặt sẵn trong scene giữ nguyên
    private _layoutTab = false;

    /** node.emit(EVENT_LIFT, startPos: Vec2) khi người chơi kéo item RA KHỎI thanh */
    static readonly EVENT_LIFT = 'bottombar-lift';
    /** node.emit(EVENT_LAYOUT, vertical: boolean) khi thanh đổi ngang ↔ dọc */
    static readonly EVENT_LAYOUT = 'bottombar-layout';

    /** Đang kéo thanh (để script khác biết mà không xử lý touch) */
    get isDragging() { return this._dragging; }

    /** Offset scroll hiện tại (local px, không giới hạn — ItemManager tự wrap theo chu kỳ) */
    get offset() { return this._offset; }

    /** Có được kéo không (ItemManager bật khi item tràn thanh) */
    get scrollable() { return this._scrollable; }

    /** true = panel dọc (màn ngang): item xếp theo −Y từ trên xuống */
    get vertical() { return this._vertical; }

    /** Độ dài thanh theo trục xếp item (local px): ngang = width, dọc = height */
    get length() {
        const cs = this.getComponent(UITransform)?.contentSize;
        if (!cs) return 1080;
        return this._vertical ? cs.height : cs.width;
    }

    private _touchId = -1;
    private _dragging = false;
    private _start = new Vec2();
    private _last = new Vec2();
    private _offset = 0;
    private _targetOffset = 0;
    private _scrollable = false;
    private _velocity = 0;       // local px / frame, quán tính sau khi thả
    /** LƯU vào scene: editor đang xem màn ngang lúc lưu → lần mở sau biết thanh đang ở chỗ panel dọc, không lấy nhầm làm "nhà" */
    @property({ serializable: true, visible: false })
    private _vertical = false;
    private _tmpA = new Vec3();
    private _tmpB = new Vec3();
    private _fitKey = '';
    private _skinKey = '';
    // trạng thái "nhà" (thanh ngang, màn dọc) để trả lại khi về màn dọc. LƯU vào scene: editor xem trước màn ngang
    // (thanh dời sang phải) rồi lưu scene thì lúc chạy vẫn biết chỗ cũ của thanh
    @property({ serializable: true, visible: false })
    private _homePos = new Vec3();
    @property({ serializable: true, visible: false })
    private _homeContentPos = new Vec3();
    @property({ serializable: true, visible: false })
    private _homeSize = new Size(1080, 344);
    @property({ serializable: true, visible: false })
    private _homeSaved = false;

    onLoad() {
        if (!this.content) {
            if (EDITOR) { console.warn('[BottomBar] chưa gán content'); return; }   // editor không tự sinh node (sẽ bị lưu vào scene)
            this.content = new Node('Content');
            this.content.layer = this.node.layer;
            this.content.setParent(this.node);
        }
        // scene cũ chưa lưu "nhà" → lấy như đặt trong scene; editor đang xem màn dọc → trạng thái scene chính là "nhà".
        // PHẢI trước fitLayout, không thì fitLayout đặt thanh về "nhà" mặc định (0,0,0 / 1080×344)
        if (!this._homeSaved || (EDITOR && !this._vertical)) this.captureHome();
        this.spawnSkin();
        if (this.fitWidthToScreen) this.fitLayout();
        else this.layoutSkin();
    }

    /** Ghi "nhà" = trạng thái thanh hiện tại (chỉ gọi khi đang là thanh NGANG) */
    private captureHome() {
        if (!this.content) return;
        this._homePos.set(this.node.position);
        this._homeContentPos.set(this.content.position);
        const cs = this.getComponent(UITransform)?.contentSize;
        if (cs) this._homeSize.set(cs.width, cs.height);
        this._homeSaved = true;
    }

    /** Bg/Tab đặt sẵn trong hierarchy (gán Inspector hoặc con tên "Bg"/"Tab") */
    private sceneBg() { return this.bgNode ?? this.node.getChildByName('Bg'); }
    private sceneTab() { return this.tabNode ?? this.node.getChildByName('Tab'); }

    /** Bg/Tab: dùng node có sẵn trong scene (bgNode/tabNode); thiếu thì lấy prefab TrayBg/TrayTab từ Ply_Pool, xếp TRƯỚC Content (Bg → Tab → Content) */
    private spawnSkin() {
        const make = (type: PoolType, name: string) => {
            if (EDITOR) return null;                        // editor không sinh prefab (sẽ bị lưu vào scene) → đặt Bg/Tab sẵn trong hierarchy
            const n = Ply_Pool.create(type, this.node);
            if (!n) return null;
            n.name = name;
            n.layer = this.node.layer;
            return n;
        };
        // Node có sẵn trong hierarchy (gán Inspector hoặc con tên "Bg"/"Tab") → dùng NGUYÊN như đặt trong scene, không đụng size/vị trí.
        // Không có thì mới instantiate prefab và tự layout theo thanh.
        const sceneBg = this.sceneBg();
        const sceneTab = this.sceneTab();
        this._bg = sceneBg ?? make(PoolType.TrayBg, 'Bg');
        this._tab = sceneTab ?? make(PoolType.TrayTab, 'Tab');
        this._layoutBg = !sceneBg && !!this._bg;
        this._layoutTab = !sceneTab && !!this._tab;
        let i = 0;
        if (this._bg && this._layoutBg) this._bg.setSiblingIndex(i++);
        if (this._tab && this._layoutTab) this._tab.setSiblingIndex(i++);

        // countLabel vào giữa Tab (bỏ qua nếu đã nằm sẵn trong Tab từ scene).
        // Label đang nằm trong khung đếm của BoxBg (Sprite pill) → ẩn khung đó đi
        if (this.countLabelInTab && this._tab && this.countLabel && this.countLabel.node.parent !== this._tab) {
            const oldFrame = this.countLabel.node.parent;
            if (oldFrame && oldFrame !== this.node && oldFrame.getComponent(Sprite)) this._countFrame = oldFrame;
            this.labelToTab();
        }
        if (!this._countFrame) this._countFrame = this.countFrame ?? this.camera()?.node.getComponentInChildren(BoxBg)?.countLabel ?? null;
    }

    /** Label đếm vào giữa Tab; khung đếm cũ (BoxBg) tắt */
    private labelToTab() {
        const ln = this.countLabel?.node, tab = this._tab;
        if (!ln || !tab) return;
        const th = tab.getComponent(UITransform)?.contentSize.height ?? 70;
        if (ln.parent !== tab) ln.setParent(tab, false);
        ln.layer = tab.layer;
        ln.setPosition(0, th / 2, 1);
        ln.setRotationFromEuler(0, 0, 0);
        if (this._countFrame) this._countFrame.active = false;
    }

    /** Màn ngang: label về khung đếm cũ của BoxBg (BoxBg tự đặt góc dưới-phải vùng chơi), Bg/Tab ẩn */
    private labelToFrame() {
        const ln = this.countLabel?.node, f = this._countFrame;
        if (!ln || !f) return;
        f.active = true;
        if (ln.parent !== f) ln.setParent(f, false);
        ln.layer = f.layer;
        ln.setPosition(0, 0, 1);
        ln.setScale(1, 1, 1);
    }

    /**
     * Chỉ áp cho Bg/Tab do code instantiate từ prefab (node đặt sẵn trong hierarchy giữ nguyên như scene).
     * Đặt kích thước/vị trí theo thanh hiện tại (gốc thanh = giữa-đáy, anchor 0.5,0):
     *  - ngang: Bg rộng = thanh, cao = bgHeight (0 → cao prefab), sát đáy; Tab giữa mép trên Bg + tabOffsetY.
     *  - dọc  : Bg = cả panel; Tab (nếu bật) giữa mép trên panel + tabOffsetY.
     */
    private layoutSkin() {
        const ut = this.getComponent(UITransform);
        if (!ut) return;
        const { width: w, height: h } = ut.contentSize;
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;   // view chưa có size (frame đầu / pane 0px) → đợi lần fit sau

        // chỉ làm lại khi có gì đổi (editor gọi mỗi frame: đổi Inspector / kéo Bg là thấy ngay, không set node thừa)
        const but0 = this._bg?.getComponent(UITransform);
        const key = `${w}|${h}|${this._vertical}|${this.bgHeight}|${this.tabOffsetY}|${this.skinZ}|${this.countLabelInTab}|${this.fitContentToBg}|${this.contentPadY}`
            + `|${this._bg?.position.y}|${but0?.height}|${but0?.anchorY}|${this._tab?.uuid}|${this.countLabel?.node.parent?.uuid}`;
        if (key === this._skinKey) return;
        this._skinKey = key;

        // Màn NGANG giữ nguyên thiết kế cũ: không Bg/Tab, cell hiện, label đếm ở khung BoxBg (góc dưới-phải vùng chơi), cellSize theo ItemManager
        if (this._vertical) {
            if (this._bg) this._bg.active = false;
            if (this._tab) this._tab.active = false;
            if (this.countLabelInTab) this.labelToFrame();
            this._cellFromBg = 0;
            return;
        }
        if (this._bg) this._bg.active = true;
        if (this._tab) this._tab.active = true;
        if (this.countLabelInTab) this.labelToTab();
        let bgTop = h;
        if (this._bg && this._layoutBg) {
            const but = this._bg.getComponent(UITransform)!;
            const bh = this.bgHeight <= 0 ? h : this.bgHeight;
            but.setContentSize(w, bh);
            this._bg.setPosition(0, 0, this.skinZ);
            bgTop = bh;
        }
        if (this._tab && this._layoutTab) {
            // nhô trên mép Bg (tabOffsetY âm = lún xuống đè lên nền)
            this._tab.setPosition(0, bgTop + this.tabOffsetY, this.skinZ + 50);
        }
        // Ô icon nằm gọn trong Bg, cân trên dưới: Content ở giữa Bg, hitHeight (= cellPx khi ItemManager.cellSize = 0) = cao Bg − 2·pad
        if (this.fitContentToBg && this._bg && this.content && !this._vertical) {
            const but = this._bg.getComponent(UITransform);
            const bh = but?.contentSize.height ?? 0;
            const ay = but?.anchorY ?? 0;
            if (bh > 0) {
                const cy = this._bg.position.y + (0.5 - ay) * bh;        // tâm Bg theo trục Y (local thanh)
                this.content.setPosition(this.content.position.x, cy, this.content.position.z);
                this.hitHeight = Math.max(1, bh - 2 * this.contentPadY);
                this._cellFromBg = this.hitHeight;
            }
        }
    }

    onEnable() {
        if (EDITOR) return;
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        if (EDITOR) return;
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        this._touchId = -1;
        this._dragging = false;
    }

    // ------------------------------------------------------------ public API

    /**
     * Cập nhật số đếm tiến trình (ví dụ: 0/63)
     */
    setCount(current: number, total: number) {
        if (this.countLabel) {
            this.countLabel.string = `${current} / ${total}`;
        }
    }

    /**
     * Thiết lập chuỗi text tùy ý
     */
    setText(text: string) {
        if (this.countLabel) {
            this.countLabel.string = text;
        }
    }

    /**
     * Bật/tắt kéo. ItemManager gọi: item tràn thanh → true (loop), đủ chỗ → false.
     * Tắt thì offset về 0.
     */
    setScrollable(on: boolean) {
        this._scrollable = on;
        if (!on) {
            this._offset = this._targetOffset = 0;
            this._velocity = 0;
            this._touchId = -1;
            this._dragging = false;
        }
    }

    resetScroll() {
        this._offset = this._targetOffset = 0;
        this._velocity = 0;
    }

    // ------------------------------------------------------------ touch

    private onTouchStart(e: EventTouch) {
        if (!this.scrollEnabled || this._touchId !== -1) return;
        // không scroll được vẫn cần bắt touch để phát EVENT_LIFT
        const loc = e.getLocation();
        if (!this.hitTest(loc)) return;
        this._touchId = e.getID();
        this._start.set(loc);
        this._last.set(loc);
        this._dragging = false;
        this._velocity = 0;                       // chạm lại → dừng trượt
    }

    private onTouchMove(e: EventTouch) {
        if (e.getID() !== this._touchId || !this.content) return;
        const cur = e.getLocation();

        if (!this._dragging) {
            if (Vec2.distance(cur, this._start) < this.dragThresholdPx) return;

            // lần đầu vượt ngưỡng: quyết định NHẤC hay SCROLL theo góc kéo so với hướng nhấc
            const dir = new Vec2(cur.x - this._start.x, cur.y - this._start.y);
            const liftDir = this._vertical ? this.verticalLiftDir : Vec2.UNIT_Y;
            const angle = math.toDegree(Vec2.angle(dir, liftDir));   // 0 = đúng hướng nhấc, 90 = dọc theo thanh
            if (angle <= this.liftAngle) {
                const start = this._start.clone();
                this._touchId = -1;                       // nhả touch, thanh không scroll nữa
                this.node.emit(BottomBar.EVENT_LIFT, start);
                return;
            }

            if (!this._scrollable) { this._touchId = -1; return; }   // đủ chỗ → không kéo
            this._dragging = true;
            this._last.set(cur);
        }

        // dọc: item xếp theo −Y (ô đầu ở trên) → ngón tay đi lên = offset giảm
        const dPx = this._vertical ? -(cur.y - this._last.y) : (cur.x - this._last.x);
        const ppu = this.pixelsPerUnit();
        if (ppu > 0) {
            this._velocity = dPx / ppu;
            this._targetOffset += this._velocity;
        }
        this._last.set(cur);
    }

    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        this._touchId = -1;
        this._dragging = false;
    }

    update(dt: number) {
        if (EDITOR) {
            if (!this.content) return;
            if (!this._vertical) this.captureHome();       // đang xem màn dọc: chỉnh tay thanh / Content = chỉnh "nhà"
            if (this.fitWidthToScreen) this.fitLayout();
            this.layoutSkin();                             // có key, chỉ chạy khi có gì đổi
            return;
        }
        if (this.fitWidthToScreen) this.fitLayout();
        if (!this._dragging && this._scrollable && Math.abs(this._velocity) >= 0.01) {
            this._targetOffset += this._velocity;   // trượt theo quán tính
            this._velocity *= this.inertia;
        } else if (!this._dragging) {
            this._velocity = 0;
        }
        if (Math.abs(this._offset - this._targetOffset) < 0.01) { this._offset = this._targetOffset; return; }
        this._offset = this.followLerp > 0
            ? math.lerp(this._offset, this._targetOffset, Math.min(1, dt * this.followLerp))
            : this._targetOffset;
    }

    // ------------------------------------------------------------ fit / layout

    /** Chiều ngang màn hình đổi ra local px của thanh (camera ortho: 2·orthoHeight·aspect / worldScale.x) */
    screenWidthLocal(): number {
        const cam = this.camera();
        if (!cam) return this.getComponent(UITransform)?.contentSize.width ?? 1080;
        const size = PreviewScreen.visibleSize();
        const worldW = 2 * cam.orthoHeight * (size.width / size.height);
        return worldW / (this.node.worldScale.x || 1);
    }

    /** Chiều cao màn hình đổi ra local px của thanh */
    screenHeightLocal(): number {
        const cam = this.camera();
        if (!cam) return this.getComponent(UITransform)?.contentSize.height ?? 1080;
        return 2 * cam.orthoHeight / (this.node.worldScale.y || 1);
    }

    /**
     * Kích thước + vị trí thanh theo màn hình; chỉ tính lại khi camera/màn hình đổi.
     *  - ngang: width = màn, height/vị trí như trong scene
     *  - dọc  : width = panelFrac·màn, height = cao màn, bám mép phải, Content ở giữa panel
     */
    fitLayout() {
        const cam = this.camera();
        const ut = this.getComponent(UITransform);
        if (!cam || !ut || !this.content) return;
        const size = PreviewScreen.visibleSize();
        const vertical = this.autoVertical && size.width > size.height;
        const key = `${cam.orthoHeight}|${size.width}|${size.height}|${this.node.worldScale.x}|${vertical}|${this.panelFrac}`;
        if (key === this._fitKey) return;
        this._fitKey = key;
        const changed = vertical !== this._vertical;
        this._vertical = vertical;

        if (vertical) {
            const pw = this.screenWidthLocal() * this.panelFrac;
            const sh = this.screenHeightLocal();
            ut.setContentSize(pw, sh);
            this.content.setPosition(0, sh / 2, this._homeContentPos.z);
            this.dockRight(cam, pw);
        } else {
            ut.setContentSize(this.screenWidthLocal(), this._homeSize.height);
            this.content.setPosition(this._homeContentPos);
            this.node.setPosition(this._homePos);
        }
        this._skinKey = '';                        // Content vừa về "nhà" → phải căn lại giữa Bg
        this.layoutSkin();
        if (changed) {
            this.resetScroll();
            this._touchId = -1; this._dragging = false;
            this.node.emit(BottomBar.EVENT_LAYOUT, vertical);
        }
    }

    /** Đặt gốc thanh (anchor 0.5,0 = giữa-đáy) tại mép phải-đáy màn hình trong camera space, giữ nguyên độ sâu */
    private dockRight(cam: Camera, panelLocalW: number) {
        const size = PreviewScreen.visibleSize();
        const halfH = cam.orthoHeight, halfW = halfH * size.width / size.height;
        const ws = this.node.worldScale.x || 1;
        const camMat = cam.node.worldMatrix;
        const inv = Mat4.invert(new Mat4(), camMat);
        const p = Vec3.transformMat4(new Vec3(), this.node.worldPosition, inv);
        p.x = halfW - panelLocalW * ws / 2;
        p.y = -halfH;
        Vec3.transformMat4(p, p, camMat);
        this.node.setWorldPosition(p);
    }

    /**
     * Mép TRÊN cao nhất của thanh (Tab nhô lên trên Bg; không có thì Bg; không có nữa thì UITransform), giữa thanh, toạ độ world.
     * BoxBg dùng để kéo đáy hộp nền màn dọc xuống sát thanh. Lấy mép Tab vì nền BoxBg là Sprite vẽ sau → đè mất Tab nếu phủ qua.
     * false = đang là panel dọc (màn ngang).
     */
    topEdgeWorld(out: Vec3): boolean {
        if (this._vertical) return false;
        const ut = this.getComponent(UITransform);
        let top = ut ? (1 - ut.anchorY) * ut.height : 0;
        const edge = (n: Node | null) => {
            const t = n?.activeInHierarchy ? n.getComponent(UITransform) : null;
            return n && t ? n.position.y + (1 - t.anchorY) * t.height : -Infinity;
        };
        const skinTop = Math.max(edge(this._bg ?? this.sceneBg()), edge(this._tab ?? this.sceneTab()));
        if (isFinite(skinTop)) top = skinTop;
        Vec3.transformMat4(out, out.set(0, top, 0), this.node.worldMatrix);
        return true;
    }

    // ------------------------------------------------------------ helpers

    private camera(): Camera | null {
        return this.cam ?? ui?.wCamera ?? null;
    }

    /** Số pixel màn hình ứng với 1 đơn vị local của content theo TRỤC THANH (X ngang / Y dọc) */
    pixelsPerUnit(): number {
        const cam = this.camera();
        if (!cam || !this.content) return 0;
        const mat = this.node.worldMatrix;
        const lp = this.content.position;
        const dx = this._vertical ? 0 : 1, dy = this._vertical ? 1 : 0;
        Vec3.transformMat4(this._tmpA, this._tmpA.set(lp.x, lp.y, lp.z), mat);
        Vec3.transformMat4(this._tmpB, this._tmpB.set(lp.x + dx, lp.y + dy, lp.z), mat);
        const a = cam.worldToScreen(this._tmpA, new Vec3());
        const b = cam.worldToScreen(this._tmpB, new Vec3());
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    /**
     * Touch có nằm trong dải content không (AABB screen-space quanh content):
     *  ngang: rộng = width thanh, cao = hitHeight;  dọc: rộng = width panel, cao = height thanh.
     */
    hitTest(p: Vec2): boolean {
        const cam = this.camera();
        if (!cam || !this.content) return true;
        const cs = this.getComponent(UITransform)?.contentSize ?? new Size(1080, 344);
        const c = this.content.position;
        const hw = cs.width / 2;
        const hh = this._vertical ? cs.height / 2 : this.hitHeight / 2;
        const mat = this.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const corners = [
            [c.x - hw, c.y - hh], [c.x + hw, c.y - hh],
            [c.x - hw, c.y + hh], [c.x + hw, c.y + hh],
        ];
        for (const [x, y] of corners) {
            Vec3.transformMat4(this._tmpA, this._tmpA.set(x, y, 0), mat);
            const s = cam.worldToScreen(this._tmpA, this._tmpB);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    }

    /**
     * Vùng thanh trên màn hình, chuẩn hoá 0..1 (xMin, yMin, xMax, yMax) — dùng làm `clipRect` cho shader
     * của item trong tray (thay camera phụ cắt theo viewport). AABB hình chiếu 4 góc UITransform qua camera.
     * Trả về false nếu thanh không hiện trên màn (rect rỗng).
     */
    screenRect01(out: Vec4): boolean {
        const cam = this.camera();
        const ut = this.getComponent(UITransform);
        if (!cam || !ut) return false;
        const { width: w, height: h } = ut.contentSize;
        const ax = ut.anchorX, ay = ut.anchorY;
        const mat = this.node.worldMatrix;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of [[-ax * w, -ay * h], [(1 - ax) * w, -ay * h], [-ax * w, (1 - ay) * h], [(1 - ax) * w, (1 - ay) * h]]) {
            Vec3.transformMat4(this._tmpA, this._tmpA.set(x, y, 0), mat);
            const s = cam.worldToScreen(this._tmpA, this._tmpB);
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        const pad = this.clipPaddingPx;
        const W = screen.windowSize.width, H = screen.windowSize.height;
        minX = math.clamp(minX - pad, 0, W); maxX = math.clamp(maxX + pad, 0, W);
        minY = math.clamp(minY - pad, 0, H); maxY = math.clamp(maxY + pad, 0, H);
        if (maxX - minX <= 1 || maxY - minY <= 1) return false;
        out.set(minX / W, minY / H, maxX / W, maxY / H);
        return true;
    }
}
