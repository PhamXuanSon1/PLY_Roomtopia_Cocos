/**
 * BoxController — port từ Assets/_GAME/Script/Box/BoxController.cs (Unity)
 *
 * KHÁC bản Unity:
 *   - Không poll Input + Physics.Raycast; đăng ký IPointerHandler ở mức Box.
 *   - DOJump -> TweenUtil.jumpTo.
 *   - SaveLayersAndSetTo20 -> ItemGraphic.bringToFront (lớp kéo).
 *   - Bỏ SetLayerRecursively (dead code bên Unity, không nơi nào gọi).
 */

import { _decorator, BoxCollider2D, Component, EventTouch, Node, randomRange, UITransform, Vec2, Vec3 } from 'cc';
import { DreamyInputManager, InputPriority, IPointerHandler } from '../core/DreamyInputManager';
import { BoxGraphic } from './BoxGraphic';
import { ItemManager } from '../managers/ItemManager';
import { UIManager } from '../managers/UIManager';
import { BaseRoomManager } from '../managers/BaseRoomManager';
import { ItemController } from '../item/ItemController';
import { ItemMovement } from '../item/ItemMovement';
import { HolderSlot } from '../utils/HolderSlot';
import { HandOfBox } from '../utils/HandOfBox';
import { Ply_SoundManager, FxType } from '../ScriptTemplate/Ply_SoundManager';
import { TweenUtil } from '../core/TweenUtil';

const { ccclass, property } = _decorator;

@ccclass('BoxController')
export class BoxController extends Component implements IPointerHandler {

    @property({ type: Node, tooltip: 'Vị trí hộp di chuyển tới sau intro.' })
    MoveAfterIntroPosOfBox: Node | null = null;

    @property({ tooltip: 'Thời gian di chuyển hộp tới vị trí MoveAfterIntroPosOfBox (giây).' })
    moveAfterIntroDuration = 1.2;

    @property({ type: Node, tooltip: 'Bàn tay/chữ hướng dẫn click vào hộp.' })
    handText: Node | null = null;

    @property({ type: HandOfBox, tooltip: 'Script di chuyển bàn tay theo hộp lúc intro.' })
    handOfBox: HandOfBox | null = null;

    @property({ type: Node, tooltip: 'Thanh trượt UI hiện khi bắt đầu tương tác.' })
    slider: Node | null = null;

    @property({ tooltip: 'Đã xong lượt click tutorial mở hộp đầu tiên chưa.' })
    finishedTutorial = false;

    // ========================================== THÔNG SỐ NHẢY ITEM (DOJUMP)
    @property({ tooltip: 'Độ cao cực đại của đường bay Parabol (pixel).' })
    jumpHeight = 150;

    @property({ tooltip: 'Thời gian item bay từ hộp tới Holder (giây).' })
    jumpDuration = 1.0;

    @property({ tooltip: 'Số nhịp nảy khi bay (mặc định 1 nhịp).' })
    jumpCount = 1;

    @property({ tooltip: 'Kiểu gia tốc nảy (easing), vd: backOut, quadOut, sineOut.' })
    jumpEasing = 'backOut';

    private isClicked = false;
    private isClosing = false;
    private boxGraphic: BoxGraphic | null = null;

    readonly inputPriority = InputPriority.Box;

    // ======================================================== lifecycle
    onLoad() {
        this.boxGraphic = this.getComponent(BoxGraphic);
        this.boxGraphic?.playReady();
    }

    onEnable() {
        DreamyInputManager.register(this);
        this.node.on(Node.EventType.TOUCH_START, this.onDirectTouch, this);
    }

    onDisable() {
        DreamyInputManager.unregister(this);
        this.node.off(Node.EventType.TOUCH_START, this.onDirectTouch, this);
    }

    private onDirectTouch(): void {
        this.onClick();
    }

    // ======================================================== input
    hitTest(worldPos: Vec3): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isClicked || this.isClosing) return false;
        if (DreamyInputManager.hitTestCollider(this.node, worldPos)) return true;
        const ut = this.getComponent(UITransform);
        if (ut && ut.getBoundingBoxToWorld().contains(new Vec2(worldPos.x, worldPos.y))) {
            return true;
        }
        return false;
    }

    onPointerDown(_worldPos: Vec3, _ev: EventTouch): boolean {
        if (UIManager.instance?.isGameEnded) return false;
        if (this.isClicked || this.isClosing) return false;
        this.onClick();
        return true;
    }

    // ======================================================== logic
    /** Unity: OnClick */
    private onClick(): void {
        if (UIManager.instance?.isGameEnded) {
            UIManager.instance.gotoStore();
            return;
        }
        if (this.isClicked || this.isClosing) return;

        Ply_SoundManager.Ins?.playFx(FxType.ClickBox);

        const im = ItemManager.instance;
        if (im) {
            if (im.handIntro) im.handIntro.active = false;
            im.enableFirstClickObjects();
            im.onBoxFirstClicked();
        }

        // Đồng hồ tự ép ra Store (UIManager.autoEndAfterSeconds) chỉ bắt đầu đếm từ click Box đầu tiên.
        UIManager.instance?.startAutoEndTimer();

        if (this.handText) {
            this.handText.active = false;
        }

        if (this.handOfBox) {
            this.handOfBox.moveAfterIntro(this.moveAfterIntroDuration);
            this.handOfBox.node.active = false;
        }

        this.isClicked = true;

        if (this.slider) this.slider.active = true;

        // ---- CLICK ĐẦU TIÊN ----
        if (!this.finishedTutorial) {
            this.boxGraphic?.playFirstOpen();

            TweenUtil.delayedCall(this, 1, () => this.spawnItem());

            if (this.MoveAfterIntroPosOfBox) {
                TweenUtil.moveTo(this.node, this.MoveAfterIntroPosOfBox.worldPosition, this.moveAfterIntroDuration, 'linear');
            }

            const finish = () => {
                this.finishedTutorial = true;
                // Unity giữ cờ này trên ItemManager — đồng bộ để script khác đọc được
                if (ItemManager.instance) ItemManager.instance.finishedTutorial = true;
                this.isClicked = false;
            };

            if (BaseRoomManager.instance) BaseRoomManager.instance.playIntroAnimation(finish);
            else finish();

            return;
        }

        // ---- NHỮNG CLICK SAU ----
        this.boxGraphic?.playItemDispense();
        this.spawnItem();
        this.isClicked = false;
    }

    /** Unity: SpawnItem */
    private spawnItem(): void {
        const im = ItemManager.instance;
        if (!im) return;

        if (!im.hasAvailableHolder()) {
            console.warn('[BoxController] Hết holder trống!');
            return;
        }

        const currentItem = im.getCurrentItem();
        if (!currentItem) {
            console.warn('[BoxController] Hết item rồi!');
            return;
        }

        currentItem.setWorldPosition(this.node.worldPosition.clone());
        currentItem.active = true;

        const itemScript = currentItem.getComponent(ItemController);

        // ⚠ Chốt scale gốc TRƯỚC khi setScale(0), nếu không ItemMovement.start()
        //   sẽ chụp nhầm [0,0,0] và item bị scale về 0 ngay khi click.
        currentItem.getComponent(ItemMovement)?.captureOriginal();

        // Đặt scale ban đầu bằng 0 khi vừa sinh ra tại hộp
        currentItem.setScale(0, 0, 0);

        // Tween scale phóng to dần từ 0 lên 1 (hoặc target scale) trong quá trình bay
        const targetScale = im.enablePopScale ? im.popScaleAmount : 1;
        TweenUtil.scaleTo(currentItem, new Vec3(targetScale, targetScale, targetScale), 0.4, 'backOut');

        currentItem.setRotationFromEuler(0, 0, randomRange(-90, 90));

        const holder = im.getCurrentHolder();
        if (!holder) return;

        const holderSlot = holder.getComponent(HolderSlot);
        if (holderSlot) {
            holderSlot.isEmpty = false;
            if (itemScript) itemScript.currentHolderSlot = holderSlot;
        }

        // Unity: DOJump(holder.position, 1.5f, 1, 1f).SetEase(Ease.OutBack)
        TweenUtil.jumpTo(
            currentItem,
            holder.worldPosition,
            this.jumpHeight,
            this.jumpCount,
            this.jumpDuration,
            this.jumpEasing,
            () => {
                if (!holderSlot) return;
                holderSlot.setItem(currentItem);
                if (im.isStoreTriggerItem(currentItem)) {
                    UIManager.instance?.enableStoreOnAnyClick();
                    return;
                }
                if (itemScript) im.showFirstDragHint(itemScript);
            },
        );
    }

    /** Khóa tương tác, chạy hiệu ứng đóng và ẩn Box sau thời gian giữ nguyên gameplay cũ. */
    closeAndHide(delay = 2): void {
        if (this.isClosing) return;
        this.isClosing = true;
        this.isClicked = true;
        this.boxGraphic?.playClosing();
        this.scheduleOnce(() => this.goToEndPos(), delay);
    }

    /** Hiệu ứng kết thúc trên node Box; chỉ BoxController được quyền ẩn node này. */
    private goToEndPos(): void {
        TweenUtil.scaleTo(this.node, Vec3.ZERO, 0.5, 'sineInOut', () => {
            this.node.active = false;
        });
    }
}
