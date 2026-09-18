/**
 * LockImageNodesTool — khoá (Lock trong Hierarchy) hàng loạt các node ảnh đã dựng
 * SẴN TỪ TRƯỚC trong scene, để click vào hình trong Scene view chọn trúng node CHA
 * (chỗ gắn component gameplay) thay vì chọn nhầm node ảnh con.
 *
 * SceneBuilder (property `lockImageNode`, mặc định bật) đã tự làm việc này cho mọi
 * lần Build Now MỚI. Tool này chỉ cần dùng cho scene build TRƯỚC khi có tính năng đó,
 * hoặc khi muốn khoá/mở khoá hàng loạt theo tên tuỳ ý.
 *
 * Cơ chế: bật cờ CCObject.Flags.LockedInEditor trên node — đây chính là cờ đứng sau
 * icon ổ khoá trong Hierarchy. Node bị khoá vẫn chọn được bình thường qua Hierarchy
 * panel, chỉ riêng việc click trúng nó trong Scene view là bị chặn (theo đúng tài
 * liệu engine: "cannot be clicked in the scene"), lúc đó click sẽ rơi xuống node cha.
 *
 * DÙNG TRONG EDITOR:
 *   1. Gán component vào node bất kỳ, kéo node cha chứa các item vào ô "Search Root".
 *   2. Đặt đúng tên node ảnh ở "Node Name" (mặc định "Image", khớp SceneBuilder.imageNodeName).
 *   3. Tick "Lock Matching Nodes" để khoá, hoặc "Unlock Matching Nodes" để mở lại. Ctrl+S để lưu.
 */

import { _decorator, Component, Node, CCObject } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode, menu } = _decorator;

const Ed: any = (globalThis as any).Editor;

@ccclass('LockImageNodesTool')
@executeInEditMode(true)
@menu('Pipeline/LockImageNodesTool')
export class LockImageNodesTool extends Component {

    /**
     * ⚠ KHÔNG đặt tên field này là `parent`: Node của Cocos có setter `parent`
     *   gọi thẳng vào setParent(), editor dump/apply property trùng tên sẽ ném
     *   "e.setParent is not a function".
     */
    @property({ type: Node, tooltip: 'Node gốc để dò node ảnh cần khoá/mở khoá. BẮT BUỘC phải kéo vào.' })
    searchRoot: Node | null = null;

    @property({ tooltip: 'Tên node ảnh cần khoá (khớp chính xác, không phân biệt hoa/thường). Mặc định "Image" khớp SceneBuilder.imageNodeName.' })
    nodeName = 'Image';

    @property({ tooltip: 'Tìm đệ quy trong toàn bộ node con, không chỉ con trực tiếp.' })
    recursive = true;

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để khoá mọi node khớp Node Name — click trong Scene view sẽ chọn node cha.' })
    get lockMatchingNodes(): boolean { return false; }
    set lockMatchingNodes(v: boolean) { if (v) this.apply(true); }

    @property({ tooltip: 'Tick để mở khoá lại mọi node khớp Node Name.' })
    get unlockMatchingNodes(): boolean { return false; }
    set unlockMatchingNodes(v: boolean) { if (v) this.apply(false); }

    @property({ tooltip: 'Tick để IN ra Console node nào khớp và trạng thái khoá hiện tại (không sửa gì).' })
    get preview(): boolean { return false; }
    set preview(v: boolean) { if (v) this.doPreview(); }

    // ======================================================== Methods

    doPreview(): void {
        const nodes = this.collectMatches();
        if (!nodes) return;

        console.log(`[LockImageNodesTool] ${nodes.length} node tên "${this.nodeName}" trong "${this.searchRoot!.name}":`);
        for (const n of nodes) {
            const locked = (n.hideFlags & CCObject.Flags.LockedInEditor) !== 0;
            console.log(`   "${n.getPathInHierarchy?.() ?? n.name}" -> ${locked ? 'ĐÃ KHOÁ' : 'chưa khoá'}`);
        }
    }

    apply(lock: boolean): void {
        const nodes = this.collectMatches();
        if (!nodes) return;
        if (nodes.length === 0) {
            console.warn(`[LockImageNodesTool] Không tìm thấy node nào tên "${this.nodeName}" trong "${this.searchRoot!.name}".`);
            return;
        }

        for (const n of nodes) {
            n.hideFlags = lock
                ? (n.hideFlags | CCObject.Flags.LockedInEditor)
                : (n.hideFlags & ~CCObject.Flags.LockedInEditor);
        }

        console.log(`[LockImageNodesTool] DONE! Đã ${lock ? 'khoá' : 'mở khoá'} ${nodes.length} node tên "${this.nodeName}".`);
        this.saveSnapshot();
    }

    // ======================================================== Helpers

    private collectMatches(): Node[] | null {
        if (!this.searchRoot || !this.searchRoot.isValid) {
            console.error('[LockImageNodesTool] Chưa gán "Search Root"! Kéo node cha chứa các item vào ô Search Root trong Inspector.');
            return null;
        }
        const name = (this.nodeName || '').trim().toLowerCase();
        if (!name) {
            console.error('[LockImageNodesTool] "Node Name" đang trống.');
            return null;
        }

        const found: Node[] = [];
        const walk = (n: Node) => {
            for (const c of n.children) {
                if (c.name.toLowerCase() === name) found.push(c);
                if (this.recursive) walk(c);
            }
        };
        walk(this.searchRoot);
        return found;
    }

    private saveSnapshot(): void {
        if (!EDITOR) return;
        try {
            Ed?.Message?.send('scene', 'snapshot');
            console.log('[LockImageNodesTool] Nhấn Ctrl+S để lưu scene.');
        } catch { /* không có editor thì thôi */ }
    }
}
