import { _decorator, Camera, Component, Material, Node, Vec2 } from 'cc';
import { ItemGraphic } from './ItemGraphic';
import { ItemMovement, ReleaseResult } from './ItemMovement';
const { ccclass, property } = _decorator;

export enum ItemState { InTray, Dragging, Completed }

export interface ItemCallbacks {
    /** Thả tay tại ghostPos (pixel màn hình) → có snap vào target của item không? */
    judgeSnap(item: ItemController, ghostPos: Vec2): boolean;
    /** Thả đúng target → ItemManager gỡ ô, đếm tiến trình */
    onSnapped(item: ItemController): void;
    /** Thả sai / huỷ → icon đã về thanh */
    onReturned(item: ItemController, result: ReleaseResult): void;
}

/**
 * Facade của 1 item trong thanh. ItemManager chỉ nói chuyện với class này,
 * class này điều phối ItemGraphic (hình ảnh) và ItemMovement (kéo thả).
 */
@ccclass('ItemController')
export class ItemController extends Component {
    @property(ItemGraphic) graphic: ItemGraphic | null = null;
    @property(ItemMovement) movement: ItemMovement | null = null;

    /** Node mesh trong map (lưu vào scene) */
    @property({ type: Node, tooltip: 'Mesh trong map mà item này đại diện' })
    target: Node | null = null;
    /** Vị trí trong thanh (thứ tự ban đầu) */
    index = 0;
    state = ItemState.InTray;
    /** Đang nằm trong vùng nhìn thấy của thanh (ItemManager cập nhật) */
    isOnScreen = false;

    private _cb: ItemCallbacks | null = null;
    private _snapScale = 1;
    private _snapScaleUpDuration = 0;
    private _snapScaleDownDuration = 0;

    get isCompleted() { return this.state === ItemState.Completed; }

    /** Gọi 1 lần lúc ItemManager build */
    init(target: Node, index: number, cam: Camera, ghostRoot: Node, gray: Material | null, cb: ItemCallbacks, cellPx?: number, iconFill?: number, snapScale = 1, snapScaleUpDuration = 0, snapScaleDownDuration = 0) {
        this.target = target;
        this.index = index;
        this._cb = cb;
        this._snapScale = snapScale;
        this._snapScaleUpDuration = snapScaleUpDuration;
        this._snapScaleDownDuration = snapScaleDownDuration;

        this.graphic!.bind(target, cam, cellPx, iconFill);
        if (gray) this.graphic!.setGray(gray);

        const m = this.movement!;
        m.graphic = this.graphic;
        m.cam = cam;
        m.ghostRoot = ghostRoot;
    }

    // ------------------------------------------------------------ input (từ ItemManager)
    private _cellWasActive = false;

    onSelect(screenPos: Vec2) {
        if (this.state !== ItemState.InTray) return;
        this.state = ItemState.Dragging;
        this.graphic!.stopHint();
        // ẩn thẻ Cell của ô này khi đang kéo (ô trống)
        const cell = this.graphic!.cell;
        if (cell) { this._cellWasActive = cell.active; cell.active = false; }
        this.movement!.begin(screenPos);
    }

    /** Thả trượt/huỷ → thẻ Cell hiện lại như trước */
    private restoreCell() {
        const cell = this.graphic!.cell;
        if (cell) cell.active = this._cellWasActive;
    }

    onMove(screenPos: Vec2) {
        if (this.state !== ItemState.Dragging) return;
        this.movement!.move(screenPos);
    }

    onRelease() {
        if (this.state !== ItemState.Dragging) return;
        const ghostPos = this.movement!.release();
        const snap = !!ghostPos && !!this._cb?.judgeSnap(this, ghostPos);
        if (snap) {
            this.complete();
        } else {
            this.state = ItemState.InTray;
            this.restoreCell();
            this._cb?.onReturned(this, 'miss');
        }
    }

    onCancel() {
        if (this.state !== ItemState.Dragging) return;
        this.movement!.cancel();
        this.state = ItemState.InTray;
        this.restoreCell();
        this._cb?.onReturned(this, 'miss');
    }

    // ------------------------------------------------------------ state
    /** Đánh dấu hoàn thành (snap đúng, hoặc bot/booster gọi thẳng) */
    complete() {
        if (this.state === ItemState.Completed) return;
        this.state = ItemState.Completed;
        this.graphic!.restore();
        this.graphic!.punchTarget(this._snapScale, this._snapScaleUpDuration, this._snapScaleDownDuration);
        this.graphic!.setVisible(false);
        this._cb?.onSnapped(this);
    }

    /** Ẩn/hiện theo cull của thanh */
    setOnScreen(on: boolean) {
        this.isOnScreen = on;
        this.graphic!.setVisible(on && this.state !== ItemState.Completed);
    }

    /** Reset về trạng thái ban đầu (replay) */
    reset(gray: Material | null) {
        this.state = ItemState.InTray;
        this.graphic!.stopHint();
        this.graphic!.resetIcon();
        if (gray) this.graphic!.setGray(gray);
    }
}
