/**
 * ItemGraphic — port từ Assets/_GAME/Script/Item/ItemGraphic.cs (Unity)
 *
 * Bản Unity dài 321 dòng, phần lớn là mô phỏng sortingOrder
 * (SaveLayersAndSetTo20 / RestoreOriginalLayers / MatchItemSortingOrderToTarget /
 *  GetTargetSortingOrderFromSaved / GetSortingOrderRecursive).
 *
 * Cocos render theo thứ tự cây nên toàn bộ phần đó được thay bằng "lớp kéo":
 * khi nhấc item thì chuyển tạm nó sang node DragLayer nằm cuối cây; thả ra
 * thì trả về đúng (parent, siblingIndex) cũ.
 *
 * ⚠ DragLayer phải nằm CÙNG CHUỖI SCALE với item, nếu không item sẽ đổi kích thước
 *   lúc nhấc lên. Với Level542: Scale(0.45) > Items(1.4) > DefaultItem(1) > item.
 *   Nên DragLayer đặt dưới "Items" — cùng cấp với DefaultItem/DynamicItem (đều scale 1).
 *
 * Xem COCOS_MIGRATION_PLAN.md mục 5.1.
 */

import { _decorator, Component, Node, Sprite, Color, Vec3, UITransform, Rect } from 'cc';
import { BaseRoom } from '../utils/BaseRoom';

const { ccclass, property } = _decorator;

const DRAG_LAYER_NAME = '__DragLayer__';
/** Tên node con chứa Sprite do SceneBuilder dựng — khớp SceneBuilder.imageNodeName mặc định. */
const IMAGE_NODE_NAME = 'Image';

@ccclass('ItemGraphic')
export class ItemGraphic extends Component {

    // ---- cấu hình chung (bên Unity nằm trên ItemManager) ----
    /** Màu bóng/shadow ở vị trí đích. Unity: ItemManager.targetShadowColor = (51,51,51). */
    static targetShadowColor = new Color(51, 51, 51, 255);
    /** Màu bình thường khi phục hồi. Unity: ItemManager.targetNormalColor = white. */
    static targetNormalColor = new Color(255, 255, 255, 255);
    /** Node chứa DragLayer. InputManager gán. Để null = tự dò (cha của cha item). */
    static dragLayerRoot: Node | null = null;

    // ---- field khớp tên với bản Unity để SceneBuilder gán được từ JSON ----
    @property({ type: Vec3, tooltip: 'Scale của item khi nằm trong danh sách ở dưới cùng.' })
    listScale: Vec3 = new Vec3(1, 1, 1);

    @property({ type: Vec3, tooltip: 'Rotation của item khi nằm trong danh sách ở dưới cùng.' })
    listRotation: Vec3 = new Vec3(0, 0, 0);

    // ---- trạng thái lớp kéo ----
    private savedParent: Node | null = null;
    private savedIndex = -1;

    // ---- trạng thái shadow ở targetPoint ----
    private hiddenTargetSprites: Sprite[] = [];

    // ---- trạng thái đồng bộ zoom phòng ----
    /** undefined = chưa tìm; null = tìm rồi nhưng không có node ảnh nào. */
    private imageNode: Node | null | undefined;
    /** Scale của node ảnh lúc chưa nhân gì (giữ dấu flip X/Y gốc). */
    private imageBaseScale: Vec3 | null = null;
    /** Hệ số đang nhân vào node ảnh. */
    private zoomMult = 1;
    /** Mốc lúc item còn nằm TRONG cây Scale lần cuối: zoom phòng và hệ số đang nhân khi đó. */
    private zoomAtDetach = 1;
    private multAtDetach = 1;
    private zoomRefInitialized = false;

    // ======================================================== lớp kéo
    /** Unity: SaveLayersAndSetTo20 — đẩy item lên trên cùng khi đang cầm. */
    bringToFront(): void {
        if (this.savedParent) return;                 // đã ở trên cùng rồi

        const layer = this.resolveDragLayer();
        if (!layer) return;

        this.savedParent = this.node.parent;
        this.savedIndex = this.node.getSiblingIndex();
        this.node.setParent(layer, true);             // giữ nguyên world transform
    }

    /** Unity: RestoreOriginalLayers — trả item về đúng chỗ cũ trong cây. */
    restoreOriginalLayers(): void {
        if (!this.savedParent || !this.savedParent.isValid) {
            this.savedParent = null;
            this.savedIndex = -1;
            return;
        }
        this.node.setParent(this.savedParent, true);
        this.node.setSiblingIndex(this.savedIndex);
        this.savedParent = null;
        this.savedIndex = -1;
    }

    /** Có đang được nhấc lên lớp kéo không. */
    get isLifted(): boolean { return this.savedParent !== null; }

    private resolveDragLayer(): Node | null {
        const root = (ItemGraphic.dragLayerRoot && ItemGraphic.dragLayerRoot.isValid)
            ? ItemGraphic.dragLayerRoot
            : this.node.parent ?? this.node.parent?.parent ?? null;
        if (!root) return null;

        let layer = root.getChildByName(DRAG_LAYER_NAME);
        if (!layer) {
            layer = new Node(DRAG_LAYER_NAME);
            layer.layer = root.layer;      // phải là UI_2D, xem ghi chú ở SceneBuilder
            layer.addComponent(UITransform);
            layer.setParent(root);
        }
        layer.setSiblingIndex(root.children.length - 1);   // luôn ở cuối = trên cùng
        return layer;
    }

    /**
     * Unity: MatchItemSortingOrderToTarget — gán order của item bằng order của đích.
     * Cocos: đặt item ngay sau targetPoint trong cây.
     * (Bên Unity item bị tắt ngay sau đó nên phần này gần như không đổi hình ảnh.)
     */
    matchItemSortingOrderToTarget(targetPoint: Node | null): void {
        if (!targetPoint || !targetPoint.parent) return;
        this.node.setParent(targetPoint.parent, true);
        this.node.setSiblingIndex(targetPoint.getSiblingIndex() + 1);
        this.savedParent = null;
        this.savedIndex = -1;
    }

    // ======================================================== shadow ở đích
    /**
     * Unity: HandleTargetSprites — bật shadow (đổi màu tối) hoặc ẩn hẳn sprite ở đích.
     */
    handleTargetSprites(targetPoint: Node | null, isShadowEnabled = true): void {
        if (!targetPoint) return;

        this.hiddenTargetSprites.length = 0;

        const sprites = targetPoint.getComponentsInChildren(Sprite);
        // glue Cocos: node "<tên>_cut" (cùng cấp với "<tên>Place", cùng vị trí) là mảnh
        // đè lên item sau khi ghép. Nó vẽ đè lên Place nên phải tô/ẩn cùng, nếu không
        // phần bị _cut che vẫn giữ màu gốc -> bóng loang lổ.
        const cutNode = ItemGraphic.findCutNode(targetPoint);
        if (cutNode) sprites.push(...cutNode.getComponentsInChildren(Sprite));

        for (const sr of sprites) {
            this.hiddenTargetSprites.push(sr);
            if (isShadowEnabled) {
                sr.color = ItemGraphic.targetShadowColor.clone();
            } else {
                sr.enabled = false;
            }
        }
    }

    /** Node "<tên>_cut" nằm cùng cha với targetPoint "<tên>Place" (SceneBuilder đặt tên theo quy ước này). */
    private static findCutNode(targetPoint: Node): Node | null {
        const parent = targetPoint.parent;
        if (!parent) return null;
        const base = targetPoint.name.replace(/Place$/, '');
        const cut = parent.getChildByName(base + '_cut');
        return cut && cut !== targetPoint ? cut : null;
    }

    /** Unity: RestoreTargetSprites — trả sprite ở đích về màu bình thường. */
    restoreTargetSprites(): void {
        for (const sr of this.hiddenTargetSprites) {
            if (!sr || !sr.isValid) continue;
            sr.enabled = true;
            sr.color = ItemGraphic.targetNormalColor.clone();
        }
        this.hiddenTargetSprites.length = 0;
    }

    // ======================================================== đồng bộ zoom phòng
    /**
     * glue Cocos: Item khi nằm trong Holder / đang bị kéo (ItemGraphic.bringToFront)
     * không còn là con cháu của Scale nữa (xem HolderSlot.setItem/bringToFront), nên
     * không tự ăn theo scale của phòng qua cây node — phải tự đọc BaseRoom.currentZoomFactor
     * mỗi frame rồi nhân thêm vào NODE ẢNH (không phải node gốc, node gốc còn đang bị
     * ItemMovement tween scale cho hiệu ứng pop/kéo, đụng vào sẽ đánh nhau).
     * Gọi liên tục từ ItemController.update().
     */
    syncRoomZoomScale(): void {
        const zoom = BaseRoom.currentZoomFactor;

        // Mốc ban đầu: coi như item vừa "rời" phòng ở zoom hiện tại, hệ số 1.
        if (!this.zoomRefInitialized) {
            this.zoomAtDetach = zoom;
            this.multAtDetach = this.zoomMult;
            this.zoomRefInitialized = true;
        }

        // Đang nằm TRONG cây Scale (vd vừa spawn dưới Scale/Items, chưa bay vào Holder):
        // cây node tự nhân zoom rồi, KHÔNG nhân thêm. Chỉ ghi lại mốc để lúc rời phòng
        // (setParent keepWorldTransform đóng băng kích thước world) biết mình rời ở zoom nào.
        if (BaseRoom.isInsideRoom(this.node)) {
            this.zoomAtDetach = zoom;
            this.multAtDetach = this.zoomMult;
            return;
        }

        // Đang ở NGOÀI (Holder / DragLayer): kích thước world đã bị đóng băng ở zoomAtDetach,
        // bù đúng phần chênh lệch kể từ lúc rời: mult = multLúcRời × zoomHiệnTại / zoomLúcRời.
        const mult = this.zoomAtDetach > 0 ? this.multAtDetach * zoom / this.zoomAtDetach : this.zoomMult;
        if (Math.abs(mult - this.zoomMult) < 1e-6) return;

        const img = this.resolveImageNode();
        if (!img) return;   // item không theo cấu trúc node ảnh của SceneBuilder -> bỏ qua, không lỗi

        if (!this.imageBaseScale) {
            // chụp base = scale hiện tại chia cho hệ số đang nhân (lần đầu zoomMult = 1 nên = scale gốc)
            const s = img.scale;
            this.imageBaseScale = new Vec3(s.x / this.zoomMult, s.y / this.zoomMult, s.z);
        }
        const base = this.imageBaseScale;
        img.setScale(base.x * mult, base.y * mult, base.z);
        this.zoomMult = mult;
    }

    /** Node con chứa Sprite (do SceneBuilder dựng). Tên "Image" mặc định, fallback: con đầu tiên có Sprite. */
    private resolveImageNode(): Node | null {
        if (this.imageNode !== undefined) return this.imageNode;

        let found = this.node.getChildByName(IMAGE_NODE_NAME);
        if (!found) found = this.node.children.find((c) => !!c.getComponent(Sprite)) ?? null;

        this.imageNode = found;
        return found;
    }

    // ======================================================== bounds
    /**
     * Unity: GetCombinedBounds — gộp bounds của mọi renderer trong item.
     * Cocos: gộp bounding box (world) của mọi UITransform.
     */
    getCombinedBounds(): Rect | null {
        const uts = this.node.getComponentsInChildren(UITransform);
        if (uts.length === 0) return null;

        let box: Rect | null = null;
        for (const ut of uts) {
            const b = ut.getBoundingBoxToWorld();
            if (b.width <= 0 && b.height <= 0) continue;
            box = box ? box.union(box, b) : b.clone();
        }
        return box;
    }
}
