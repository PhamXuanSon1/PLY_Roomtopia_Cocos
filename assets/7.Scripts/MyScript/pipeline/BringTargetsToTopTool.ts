/**
 * BringTargetsToTopTool — đưa các node con là Target (targetPoint) của Item lên
 * trên cùng (siblingIndex lớn nhất) trong 1 Node cha, để chúng không bị các
 * sprite trang trí khác đè lên.
 *
 * "Target của Item" = node được gán vào field `targetPoint` của bất kỳ
 * ItemController nào trong phạm vi tìm kiếm (Item Search Root, mặc định cả
 * scene) — không dựa vào tên node, nên đổi tên/đặt sai suffix vẫn nhận ra đúng.
 *
 * ⚠ Chỉ sắp lại thứ tự giữa các CON TRỰC TIẾP của Parent Node (siblingIndex chỉ
 *   có ý nghĩa giữa các node cùng cha). Node con nào KHÔNG phải target thì giữ
 *   nguyên thứ tự tương đối với nhau, chỉ bị đẩy xuống dưới nhóm target.
 *
 * DÙNG TRONG EDITOR:
 *   1. Gán component vào node bất kỳ, kéo node cha chứa các con cần sắp xếp
 *      vào ô "Parent Node".
 *   2. (Tuỳ chọn) Kéo 1 node vào "Item Search Root" nếu chỉ muốn dò
 *      ItemController trong 1 nhánh thay vì quét cả scene.
 *   3. Tick "Preview" để xem trước node nào sẽ được nhận diện là Target.
 *   4. Tick "Bring Targets To Top" để áp dụng, rồi Ctrl+S để lưu scene.
 */

import { _decorator, Component, Node, director } from 'cc';
import { EDITOR } from 'cc/env';
import { ItemController } from '../item/ItemController';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('BringTargetsToTopTool')
@executeInEditMode(true)
@menu('Pipeline/BringTargetsToTopTool')
export class BringTargetsToTopTool extends Component {

    /**
     * ⚠ KHÔNG đặt tên field này là `parent`: Node của Cocos có setter `parent`
     *   gọi thẳng vào setParent(), editor dump/apply property trùng tên sẽ ném
     *   "e.setParent is not a function".
     */
    @property({
        type: Node,
        tooltip: 'Node cha chứa các con cần sắp lại thứ tự trên/dưới. BẮT BUỘC phải kéo vào.',
    })
    parentNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node gốc để dò ItemController.targetPoint. Bỏ trống = quét toàn bộ scene hiện tại.',
    })
    itemSearchRoot: Node | null = null;

    @property({
        tooltip: 'Một Target lồng sâu trong con (không phải chính con đó) vẫn tính node con là Target '
            + 'và được kéo theo lên trên. Tắt đi nếu chỉ muốn khớp CHÍNH XÁC node con = targetPoint.',
    })
    matchDescendants = true;

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để đưa các node con là Target lên trên cùng (siblingIndex lớn nhất).' })
    get bringTargetsToTop(): boolean { return false; }
    set bringTargetsToTop(v: boolean) { if (v) this.apply(); }

    @property({ tooltip: 'Tick để IN ra Console node con nào sẽ được nhận diện là Target (không sửa gì).' })
    get preview(): boolean { return false; }
    set preview(v: boolean) { if (v) this.doPreview(); }

    // ======================================================== Methods

    /** In trước danh sách con nào là Target / không phải Target, theo đúng thứ tự hiện tại. */
    doPreview(): void {
        const parent = this.resolveParent();
        if (!parent) return;
        const targets = this.collectTargetPoints();

        console.log(`[BringTargetsToTop] ${parent.children.length} node con của "${parent.name}"`
            + ` — ${targets.size} targetPoint tìm thấy trong ${this.itemSearchRoot ? `"${this.itemSearchRoot.name}"` : 'toàn scene'}:`);
        parent.children.forEach((node, i) => {
            const isTarget = this.isTargetNode(node, targets);
            console.log(`   ${i}. "${node.name}" ${isTarget ? '-> TARGET (sẽ lên trên)' : ''}`);
        });
    }

    /** Đưa các node con là Target lên siblingIndex lớn nhất, giữ nguyên thứ tự tương đối trong từng nhóm. */
    apply(): void {
        const parent = this.resolveParent();
        if (!parent) return;

        const children = parent.children.filter((n) => n && n.isValid);
        if (children.length === 0) {
            console.error(`[BringTargetsToTop] "${parent.name}" không có node con nào để sắp xếp!`);
            return;
        }

        const targets = this.collectTargetPoints();
        if (targets.size === 0) {
            console.warn('[BringTargetsToTop] Không tìm thấy ItemController nào có targetPoint trong phạm vi tìm kiếm — không có gì để đưa lên trên.');
            return;
        }

        const isTop: boolean[] = children.map((n) => this.isTargetNode(n, targets));
        const rest = children.filter((_, i) => !isTop[i]);
        const top = children.filter((_, i) => isTop[i]);

        if (top.length === 0) {
            console.warn(`[BringTargetsToTop] Không có node con nào của "${parent.name}" khớp với Target — không đổi gì.`);
            return;
        }

        [...rest, ...top].forEach((node, i) => node.setSiblingIndex(i));

        console.log(`[BringTargetsToTop] DONE! Đã đưa ${top.length}/${children.length} node lên trên cùng của "${parent.name}":`);
        top.forEach((node) => console.log(`   -> "${node.name}"`));

        this.saveSnapshot();
    }

    // ======================================================== Helpers

    private resolveParent(): Node | null {
        if (this.parentNode && this.parentNode.isValid) return this.parentNode;
        console.error('[BringTargetsToTop] Chưa gán "Parent Node"! Kéo node cha chứa các con cần sắp xếp vào ô Parent Node trong Inspector.');
        return null;
    }

    /** Tập hợp mọi node đang được gán làm targetPoint của ItemController trong phạm vi tìm kiếm. */
    private collectTargetPoints(): Set<Node> {
        const root = (this.itemSearchRoot && this.itemSearchRoot.isValid)
            ? this.itemSearchRoot
            : (this.node.scene ?? director.getScene());
        const targets = new Set<Node>();
        if (!root) return targets;

        for (const ic of root.getComponentsInChildren(ItemController)) {
            if (ic.targetPoint && ic.targetPoint.isValid) targets.add(ic.targetPoint);
        }
        return targets;
    }

    /** `node` có phải là Target không: khớp đúng, hoặc (nếu bật matchDescendants) chứa 1 Target ở con/cháu. */
    private isTargetNode(node: Node, targets: Set<Node>): boolean {
        if (targets.has(node)) return true;
        if (!this.matchDescendants) return false;

        const walk = (n: Node): boolean => {
            for (const c of n.children) {
                if (targets.has(c) || walk(c)) return true;
            }
            return false;
        };
        return walk(node);
    }

    private saveSnapshot(): void {
        if (!EDITOR) return;
        try {
            Ed?.Message?.send('scene', 'snapshot');
            console.log('[BringTargetsToTop] Nhấn Ctrl+S để lưu scene.');
        } catch { /* không có editor thì thôi */ }
    }
}
