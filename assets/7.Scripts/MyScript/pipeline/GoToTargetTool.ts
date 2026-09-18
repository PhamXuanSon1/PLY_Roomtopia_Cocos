/**
 * GoToTargetTool — dịch từng Item con về đúng vị trí targetPoint của chính nó.
 * Dùng để xem trước layout "đã ghép xong" ngay trong Editor mà không cần Play,
 * hoặc dùng ở lúc runtime để dồn nhanh nhiều item về đích (debug/cheat).
 *
 * DÙNG TRONG EDITOR:
 *   1. Gán component này vào node cha chứa các Item (vd "ITEMS/Dynamic"),
 *      hoặc gán vào node bất kỳ rồi kéo node cha đó vào ô "Item Parent".
 *   2. Tick "Go To Target" -> mọi ItemController con có targetPoint sẽ nhảy
 *      (hoặc bay, nếu bật Animate) đến đúng vị trí/góc xoay của targetPoint.
 *   3. Ctrl+S nếu muốn lưu vị trí mới vào scene. Ctrl+Z để hoàn tác ngay sau khi bấm.
 *
 * Item đã isPlaced = true (đã ghép đúng lúc Play trước đó) mặc định bị bỏ qua,
 * xem property "Skip Placed".
 */

import { _decorator, Component, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { ItemController } from '../item/ItemController';
import { TweenUtil } from '../core/TweenUtil';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('GoToTargetTool')
@executeInEditMode(true)
@menu('Pipeline/GoToTargetTool')
export class GoToTargetTool extends Component {

    @property({
        type: Node,
        tooltip: 'Node cha chứa các Item (component ItemController). Bỏ trống = dùng chính node gắn tool này.'
    })
    itemParent: Node | null = null;

    @property({ tooltip: 'Tìm đệ quy trong toàn bộ node con, không chỉ con trực tiếp' })
    recursive = true;

    @property({ tooltip: 'Xoay Item theo đúng góc của targetPoint (giống lúc ghép đúng lúc Play)' })
    matchRotation = true;

    @property({ tooltip: 'Bỏ qua Item đã isPlaced = true (đã ghép đúng từ trước)' })
    skipPlaced = true;

    @property({
        tooltip: 'Bay mượt theo Move Duration của từng item thay vì dịch chuyển tức thì.\n'
            + '⚠ Tween chỉ tự chạy khi đang Play. Ở Editor (không Play) node sẽ vẫn nhảy tức thì dù bật cờ này,\n'
            + 'vì vòng lặp update của Editor không tick theo thời gian thực liên tục.'
    })
    animate = false;

    @property({ tooltip: 'Easing dùng khi Animate = true (theo tên easing của cc.tween, vd quadOut, backOut...)' })
    animateEasing = 'quadOut';

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để đưa tất cả Item con về đúng vị trí targetPoint của chúng' })
    get goToTarget(): boolean { return false; }
    set goToTarget(v: boolean) { if (v) this.moveAllToTarget(); }

    @property({ tooltip: 'Tick để kiểm tra Item nào chưa có targetPoint (không di chuyển được)' })
    get checkMissingTarget(): boolean { return false; }
    set checkMissingTarget(v: boolean) { if (v) this.doCheckMissingTarget(); }

    // ======================================================== Methods

    /** Node gốc để duyệt: itemParent nếu có gán, không thì dùng chính node gắn tool. */
    private resolveRoot(): Node | null {
        return this.itemParent ?? this.node;
    }

    /** Duyệt subtree, gọi `fn` cho mỗi node có ItemController. */
    private forEachItem(root: Node, fn: (item: Node, ic: ItemController) => void): void {
        const walk = (parent: Node) => {
            for (const child of parent.children) {
                const ic = child.getComponent(ItemController);
                if (ic) fn(child, ic);
                if (this.recursive && child.children.length > 0) walk(child);
            }
        };
        walk(root);
    }

    /** Đưa mọi Item con về đúng vị trí (và góc xoay, nếu bật) của targetPoint. */
    moveAllToTarget(): void {
        const root = this.resolveRoot();
        if (!root) { console.error('[GoToTargetTool] Không xác định được Item Parent.'); return; }

        let moved = 0;
        let skippedPlaced = 0;
        let missing = 0;

        this.forEachItem(root, (item, ic) => {
            if (this.skipPlaced && ic.isPlaced) { skippedPlaced++; return; }

            const target = ic.targetPoint;
            if (!target || !target.isValid) {
                missing++;
                console.warn(`[GoToTargetTool] "${item.name}" chưa có targetPoint — bỏ qua.`);
                return;
            }

            if (this.animate && !EDITOR) {
                // Runtime (Play): bay mượt theo đúng thời lượng cấu hình trên item.
                TweenUtil.killAll(item);
                TweenUtil.moveTo(item, target.worldPosition, ic.moveDuration, this.animateEasing, () => {
                    if (this.matchRotation) item.setWorldRotation(target.worldRotation);
                });
            } else {
                item.setWorldPosition(target.worldPosition);
                if (this.matchRotation) item.setWorldRotation(target.worldRotation);
            }

            moved++;
            console.log(`[GoToTargetTool] "${item.name}" -> "${target.name}"`);
        });

        console.log(`[GoToTargetTool] DONE! Đã chuyển ${moved} item.`
            + `${skippedPlaced > 0 ? ` (${skippedPlaced} bỏ qua vì đã isPlaced)` : ''}`
            + `${missing > 0 ? ` (${missing} thiếu targetPoint)` : ''}`);

        if (EDITOR) {
            try {
                Ed?.Message?.send('scene', 'snapshot');
                console.log('[GoToTargetTool] Nhấn Ctrl+S để lưu, hoặc Ctrl+Z để hoàn tác.');
            } catch { /* để Ctrl+Z được */ }
        }
    }

    /** Kiểm tra Item nào chưa có targetPoint. */
    doCheckMissingTarget(): void {
        const root = this.resolveRoot();
        if (!root) { console.error('[GoToTargetTool] Không xác định được Item Parent.'); return; }

        let total = 0;
        let missing = 0;
        this.forEachItem(root, (item, ic) => {
            total++;
            if (!ic.targetPoint || !ic.targetPoint.isValid) {
                missing++;
                console.warn(`[GoToTargetTool] Item chưa có targetPoint: "${item.name}"`);
            }
        });

        if (missing === 0) {
            console.log(`[GoToTargetTool] Tất cả ${total} item đều ĐÃ CÓ targetPoint!`);
        } else {
            console.warn(`[GoToTargetTool] Có ${missing}/${total} item CHƯA CÓ targetPoint!`);
        }
    }
}
