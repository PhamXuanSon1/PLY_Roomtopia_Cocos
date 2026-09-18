import { _decorator, Camera, Component, EventTouch, Input, input, math, screen, Vec2, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { Tray } from './Tray';
import { TrayItem } from './TrayItem';
import { DECISION_PX, SCROLL_GAIN, SCROLL_LERP, SELECT_ANGLE, SPACING, px } from './TrayConfig';
const { ccclass, property } = _decorator;

export enum GestureState { None, Pending, Scrolling, Selecting }

/** Ai muốn nhận drag (bước 5: DragSnap) implement interface này */
export interface IDragHandler {
    begin(item: TrayItem, screenPos: Vec2): void;
    move(screenPos: Vec2): void;
    release(): void;
}

/**
 * Phân biệt 3 gesture trên thanh: chạm ô rồi kéo LÊN = nhấc item,
 * kéo NGANG = scroll thanh, chạm ngoài thanh = không làm gì.
 */
@ccclass('GestureController')
export class GestureController extends Component {
    @property(Tray) tray: Tray | null = null;
    @property(Camera) cam: Camera | null = null;
    @property({ tooltip: 'Cho phép scroll thanh' }) scrollEnabled = true;
    @property({ tooltip: 'Log state ra console' }) debug = false;

    state = GestureState.None;
    dragHandler: IDragHandler | null = null;

    private _touchId = -1;
    private _start = new Vec2();
    private _last = new Vec2();
    private _pending: TrayItem | null = null;
    private _targetX = 0;
    private _scrolling = false;

    onEnable() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onDisable() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private setState(s: GestureState) {
        if (this.state === s) return;
        this.state = s;
        if (this.debug) console.log('[Gesture]', GestureState[s]);
    }

    // ------------------------------------------------------------ touch
    private onTouchStart(e: EventTouch) {
        if (this._touchId !== -1) return;              // chỉ nhận touch đầu
        this._touchId = e.getID();
        e.getLocation(this._start); this._last.set(this._start);

        this._pending = this.pick(this._start);
        this.setState(this._pending ? GestureState.Pending : GestureState.None);
    }

    private onTouchMove(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        const cur = e.getLocation();

        if (this.state === GestureState.Pending) {
            const d = new Vec2(cur.x - this._start.x, cur.y - this._start.y);
            if (d.length() < px(DECISION_PX)) return;
            const angle = math.toDegree(Vec2.angle(d, Vec2.UNIT_Y));
            if (angle <= SELECT_ANGLE) {
                this.setState(GestureState.Selecting);
                this.dragHandler?.begin(this._pending!, cur);
            } else if (this.scrollEnabled) {
                this.setState(GestureState.Scrolling);
                this._targetX = this.tray!.content!.position.x;
            } else {
                this.setState(GestureState.None);
            }
        }

        if (this.state === GestureState.Scrolling) {
            const tray = this.tray!;
            if (GameManager.inst!.remain <= tray.visibleCount) { this._last.set(cur); return; }
            const dx = math.clamp(cur.x - this._last.x, -500, 500);
            this._targetX = math.clamp(this._targetX + dx / this.ppu() * SCROLL_GAIN, tray.scrollMinX(), 0.5);
            this._scrolling = true;
        } else if (this.state === GestureState.Selecting) {
            this.dragHandler?.move(cur);
        }
        this._last.set(cur);
    }

    private onTouchEnd(e: EventTouch) {
        if (e.getID() !== this._touchId) return;
        if (this.state === GestureState.Selecting) this.dragHandler?.release();
        this._touchId = -1;
        this._pending = null;
        this.setState(GestureState.None);
    }

    update(dt: number) {
        if (!this._scrolling) return;
        const c = this.tray!.content!;
        const x = math.lerp(c.position.x, this._targetX, Math.min(1, dt * SCROLL_LERP));
        c.setPosition(x, c.position.y, c.position.z);
        if (Math.abs(x - this._targetX) < 0.005) { c.setPosition(this._targetX, c.position.y, c.position.z); this._scrolling = false; }
    }

    // ------------------------------------------------------------ helpers
    /** world unit / pixel, camera ortho */
    private ppu() { return screen.windowSize.height / (2 * this.cam!.orthoHeight); }

    /** Tìm ô trong thanh dưới ngón tay (AABB screen-space, không physics) */
    pick(p: Vec2): TrayItem | null {
        const half = 0.5 * SPACING * this.ppu();
        const tmp = new Vec3();
        for (const it of this.tray!.items) {
            if (!it.isOnScreen) continue;
            this.cam!.worldToScreen(it.node.worldPosition, tmp);
            if (Math.abs(tmp.x - p.x) < half && Math.abs(tmp.y - p.y) < half) return it;
        }
        return null;
    }
}
