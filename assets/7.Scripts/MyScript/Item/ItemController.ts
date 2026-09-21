import { _decorator, Camera, Component, Material, Node, Vec2 } from 'cc';
import { ItemGraphic } from './ItemGraphic';
import { ItemMovement, ReleaseResult } from './ItemMovement';
const { ccclass, property } = _decorator;

export enum ItemState { InTray, Dragging, Completed }

export interface ItemCallbacks {
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

    /** Node mesh trong map */
    target: Node | null = null;
    /** Vị trí trong thanh (thứ tự ban đầu) */
    index = 0;
    state = ItemState.InTray;
    /** Đang nằm trong vùng nhìn thấy của thanh (ItemManager cập nhật) */
    isOnScreen = false;

    private _cb: ItemCallbacks | null = null;

    get isCompleted() { return this.state === ItemState.Completed; }

    /** Gọi 1 lần lúc ItemManager build */
    init(target: Node, index: number, cam: Camera, ghostRoot: Node, gray: Material | null, cb: ItemCallbacks) {
        this.target = target;
        this.index = index;
        this._cb = cb;

        this.graphic!.bind(target, cam);
        if (gray) this.graphic!.setGray(gray);

        const m = this.movement!;
        m.graphic = this.graphic;
        m.cam = cam;
        m.ghostRoot = ghostRoot;
    }

    // ------------------------------------------------------------ input (từ ItemManager)
    onSelect(screenPos: Vec2) {
        if (this.state !== ItemState.InTray) return;
        this.state = ItemState.Dragging;
        this.graphic!.stopHint();
        this.movement!.begin(screenPos);
    }

    onMove(screenPos: Vec2) {
        if (this.state !== ItemState.Dragging) return;
        this.movement!.move(screenPos);
    }

    onRelease() {
        if (this.state !== ItemState.Dragging) return;
        const result = this.movement!.release();
        if (result === 'snap') {
            this.complete();
        } else {
            this.state = ItemState.InTray;
            this._cb?.onReturned(this, result);
        }
    }

    onCancel() {
        if (this.state !== ItemState.Dragging) return;
        this.movement!.cancel();
        this.state = ItemState.InTray;
        this._cb?.onReturned(this, 'miss');
    }

    // ------------------------------------------------------------ state
    /** Đánh dấu hoàn thành (snap đúng, hoặc bot/booster gọi thẳng) */
    complete() {
        if (this.state === ItemState.Completed) return;
        this.state = ItemState.Completed;
        this.graphic!.restore();
        this.graphic!.punchTarget();
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
