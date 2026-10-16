import { _decorator, Component, MeshRenderer, Node } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property, executeInEditMode, disallowMultiple } = _decorator;

/** 1 ô trong thanh: mesh trong phòng + scale icon đã đo sẵn */
@ccclass('LevelItem')
export class LevelItem {
    @property({ type: Node, tooltip: 'Mesh trong phòng mà ô này đại diện' })
    target: Node | null = null;

    @property({ tooltip: 'Scale icon đã đo sẵn cho ô (0 = lúc chạy tự đo). Chỉ dùng khi iconFitKey khớp cỡ ô / iconFill hiện tại' })
    iconScale = 0;
}

/**
 * LevelConfig — mọi thứ RIÊNG của 1 map, đặt trên node gốc phòng (cùng ModelRotate + FitInBox).
 * Mỗi map = 1 prefab `5.Prefabs/Levels/Level_<Tên>.prefab`; scene PlayScene chỉ chứa 1 instance của prefab đó.
 * Đổi map = thay instance trong scene (hoặc dùng Tool → Map Creator). Các script khác lấy map hiện tại qua LevelConfig.current.
 *
 * Sửa xong nhớ bấm Apply (thanh trên Inspector của prefab instance) để lưu vào prefab.
 */
@ccclass('LevelConfig')
@executeInEditMode
@disallowMultiple
export class LevelConfig extends Component {
    /** Map đang có trong scene (editor + lúc chạy) */
    static current: LevelConfig | null = null;

    @property({ type: [LevelItem], tooltip: 'Các ô trong thanh, theo thứ tự từ đầu thanh. Để trống → mọi mesh trong phòng. Dễ chỉnh nhất bằng Tool → Map Creator' })
    items: LevelItem[] = [];

    @property({ tooltip: 'Chơi đủ N item thì mọi chạm / kéo / xoay đều mở store (CTA). 0 = tắt, chỉ mở store khi xếp xong hết' })
    storeAfterItems = 0;

    @property({ tooltip: 'Ngưỡng thả đúng riêng cho map này (px @393pt). 0 = dùng SnapRules.snapPx của scene' })
    snapPx = 0;

    @property({ visible: false, tooltip: 'Cỡ ô | iconFill lúc đo iconScale của items (khác hiện tại → đo lại)' })
    iconFitKey = '';

    // ---- proxy: chỉnh ngay trên LevelConfig, giá trị lưu ở ModelRotate / FitInBox cùng node ----
    /** Đọc góc Y của node model thực tế, mặc định 0 khi không tìm thấy node. */
    @property({ group: 'Phòng', tooltip: 'Góc xoay ban đầu của phòng quanh trục Y (độ) — xoay node model của ModelRotate' })
    get startYaw() { return this.rotateModel()?.eulerAngles.y ?? 0; }
    /** Đổi góc Y của phòng và giữ nguyên góc nghiêng trên hai trục còn lại. */
    set startYaw(v: number) {
        const m = this.rotateModel();
        if (m) { const e = m.eulerAngles; m.setRotationFromEuler(e.x, v, e.z); }
    }

    /** Đọc vị trí neo ngang từ FitInBox, mặc định căn giữa nếu thiếu component. */
    @property({ group: 'Phòng', range: [0, 1, 0.01], slide: true, tooltip: 'Vị trí NGANG của phòng trong vùng chơi (FitInBox.anchorX): 0 = sát trái, 0.5 = giữa, 1 = sát phải' })
    get anchorX() { return this.fit('anchorX', 0.5); }
    /** Ghi neo ngang và yêu cầu FitInBox tính lại vị trí phòng. */
    set anchorX(v: number) { this.setFit('anchorX', v); }

    /** Đọc vị trí neo dọc từ FitInBox, mặc định căn giữa nếu thiếu component. */
    @property({ group: 'Phòng', range: [0, 1, 0.01], slide: true, tooltip: 'Vị trí DỌC của phòng trong vùng chơi (FitInBox.anchorY): 0 = sát đáy (gần thanh item), 1 = sát đỉnh' })
    get anchorY() { return this.fit('anchorY', 0.5); }
    /** Ghi neo dọc và yêu cầu FitInBox tính lại vị trí phòng. */
    set anchorY(v: number) { this.setFit('anchorY', v); }

    /** Đọc lề vùng chơi từ FitInBox, dùng 0.2 world unit khi thiếu component. */
    @property({ group: 'Phòng', tooltip: 'Lề trống quanh phòng trong vùng chơi (world unit, FitInBox.padding). Lớn hơn = phòng nhỏ lại' })
    get padding() { return this.fit('padding', 0.2); }
    /** Cập nhật lề và buộc FitInBox đo lại kích thước phòng. */
    set padding(v: number) { this.setFit('padding', v); }

    /** Đọc hệ số phóng phòng ở màn dọc, mặc định giữ nguyên scale đã fit. */
    @property({ group: 'Phòng', range: [0.5, 2, 0.05], slide: true, tooltip: 'Màn DỌC: nhân thêm độ to của phòng sau khi fit (FitInBox.portraitScale)' })
    get portraitScale() { return this.fit('portraitScale', 1); }
    /** Lưu hệ số màn dọc vào FitInBox và yêu cầu fit lại. */
    set portraitScale(v: number) { this.setFit('portraitScale', v); }

    /** Đọc hệ số phóng phòng ở màn ngang, mặc định giữ nguyên scale đã fit. */
    @property({ group: 'Phòng', range: [0.5, 2, 0.05], slide: true, tooltip: 'Màn NGANG: nhân thêm độ to của phòng sau khi fit (FitInBox.landscapeScale)' })
    get landscapeScale() { return this.fit('landscapeScale', 1); }
    /** Lưu hệ số màn ngang vào FitInBox và yêu cầu fit lại. */
    set landscapeScale(v: number) { this.setFit('landscapeScale', v); }

    /** Đăng ký level hiện tại và cảnh báo nếu scene đang có nhiều cấu hình level. */
    onLoad() {
        // editor: lúc tạo / đổi prefab level có 1 khoảnh khắc 2 instance cùng tồn tại → chỉ cảnh báo lúc chạy
        if (!EDITOR && LevelConfig.current && LevelConfig.current !== this && LevelConfig.current.isValid) {
            console.warn(`[LevelConfig] scene có nhiều hơn 1 level (${LevelConfig.current.node.name}, ${this.node.name}) — dùng ${this.node.name}`);
        }
        LevelConfig.current = this;
    }

    /** Bỏ level hiện tại khi chính instance đang được giữ bị huỷ. */
    onDestroy() {
        if (LevelConfig.current === this) LevelConfig.current = null;
    }

    /** Mesh được chơi theo thứ tự ô (items trống → mọi mesh trong phòng) */
    targets(): Node[] {
        const list = this.items.map((it) => it.target).filter((n): n is Node => !!n && n.isValid);
        return list.length ? list : this.allMeshes();
    }

    /** Scale icon đã đo cho target (0 = chưa có / không khớp `fitKey`) */
    presetScale(target: Node, fitKey: string): number {
        if (fitKey !== this.iconFitKey) return 0;
        return this.items.find((it) => it.target === target)?.iconScale ?? 0;
    }

    /** Mọi mesh trong phòng */
    allMeshes(): Node[] {
        return this.node.getComponentsInChildren(MeshRenderer).map((r) => r.node);
    }

    /** Lấy node được ModelRotate điều khiển, nếu thiếu thì dùng gốc prefab level. */
    private rotateModel(): Node | null {
        const mr = this.getComponent('ModelRotate') as unknown as { model: Node | null } | null;
        return mr?.model ?? this.node;
    }

    /** Đọc thuộc tính số của FitInBox cùng node, dùng giá trị dự phòng khi thiếu component. */
    private fit(key: string, def: number): number {
        const f = this.getComponent('FitInBox') as unknown as Record<string, number> | null;
        return f ? f[key] : def;
    }

    /** Ghi thuộc tính FitInBox và xoá khoá bố cục để lần cập nhật sau fit lại. */
    private setFit(key: string, v: number) {
        const f = this.getComponent('FitInBox') as unknown as Record<string, unknown> | null;
        if (f) { f[key] = v; f._key = ''; }
    }
}
