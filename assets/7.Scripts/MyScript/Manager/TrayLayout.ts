import { _decorator, Component } from 'cc';
import { EDITOR } from 'cc/env';
import { CELL_PX, CULL_PAD_PX, EDGE_PAD_PX, ICON_FILL, SPACING_PX } from '../Config/TrayConfig';
const { ccclass, property, disallowMultiple } = _decorator;

/** Phần ItemManager mà TrayLayout gọi (import bằng tên class để tránh vòng import ItemManager ↔ TrayLayout) */
interface TrayHost {
    onLayoutChanged(): void;
    buildPreview(): void;
    clearContent(): void;
    shufflePreview(): void;
    shuffle(): void;
    applyOrderPreview(): void;
}

/**
 * TrayLayout — cách xếp item trong thanh (đặt cùng node với ItemManager).
 * Đơn vị: local px của BottomBar (thanh dọc màn hình rộng ~1080).
 * Đổi số là thấy ngay trong Scene editor. Tick "Hiện thông số nâng cao" để thấy các số ít khi phải chỉnh.
 */
@ccclass('TrayLayout')
@disallowMultiple
export class TrayLayout extends Component {
    @property({ serializable: false, displayName: '⚙ Hiện thông số nâng cao', tooltip: 'Hiện thêm các thông số ít khi phải chỉnh (cullPad, cellSize, thẻ Cell, thứ tự)' })
    showAdvanced = false;

    @property({ range: [0.1, 1, 0.05], slide: true, tooltip: 'Icon chiếm bao nhiêu phần ô vuông trong thanh (0.65 = 65% cạnh ô). Tăng nếu icon nhỏ, giảm nếu icon chạm mép / dính nhau. Đổi là đo lại icon ngay' })
    iconFill = ICON_FILL;

    @property({ tooltip: 'Khoảng cách giữa tâm 2 ô liền nhau (px). Lớn hơn = ô thưa hơn, ít ô hiện cùng lúc' })
    spacing = SPACING_PX;

    @property({ tooltip: 'Ô đầu tiên cách mép trái thanh bao nhiêu px' })
    edgePad = EDGE_PAD_PX;

    @property({ visible(this: TrayLayout) { return this.showAdvanced; }, tooltip: 'Ô còn hiện khi tâm cách mép thanh ≤ giá trị này (px). Lớn hơn = ô ló ra ở 2 mép nhiều hơn khi cuộn' })
    cullPad = CULL_PAD_PX;

    @property({ serializable: true, visible: false })
    private _cellSize = CELL_PX;

    /** Cạnh ô dự phòng tính bằng px local, dùng khi BottomBar không suy kích thước từ nền. */
    @property({ visible(this: TrayLayout) { return this.showAdvanced; }, tooltip: 'Cạnh ô vuông (px) khi thanh KHÔNG tự tính ô theo nền Bg (màn ngang, hoặc tắt BottomBar.fitContentToBg). Màn dọc thường dùng cao Bg − 2·lề' })
    get cellSize() { return this._cellSize; }
    /** Lưu cạnh ô và báo ItemManager cập nhật kích thước thẻ ngay. */
    set cellSize(v: number) { this._cellSize = v; this.host()?.onLayoutChanged(); }

    @property({ serializable: true, visible: false })
    private _showCells = true;

    /** Cờ cho phép hiện thẻ Cell; lúc chơi còn phụ thuộc hướng thanh và showCellsInPlay. */
    @property({ visible(this: TrayLayout) { return this.showAdvanced; }, tooltip: 'Hiện thẻ Cell (ô trắng bo góc) dưới icon trong EDITOR để nhìn layout. Lúc chơi còn tuỳ showCellsInPlay' })
    get showCells() { return this._showCells; }
    /** Lưu cờ hiện thẻ và báo ItemManager áp dụng ngay cho các item đang có. */
    set showCells(v: boolean) { this._showCells = v; this.host()?.onLayoutChanged(); }

    @property({ visible(this: TrayLayout) { return this.showAdvanced; }, tooltip: 'Lúc chơi (màn dọc) có hiện thẻ Cell không. Tắt = icon nằm thẳng trên nền Bg (màn ngang luôn hiện)' })
    showCellsInPlay = false;

    /** Không còn dùng: thứ tự ô nằm ở LevelConfig.items (giữ field để scene cũ đọc không lỗi) */
    @property({ visible: false })
    orderByHierarchy = true;

    // ---- xem trước trong editor (không ảnh hưởng lúc chạy) ----
    @property({ group: 'Editor Preview', tooltip: 'Editor: hiện TẤT CẢ item thành 1 hàng dài (không cắt theo thanh) để dễ nhìn / chọn / sắp. Tắt = giống hệt lúc chơi' })
    showHiddenItems = false;

    @property({ group: 'Editor Preview', range: [0, 1, 0.01], slide: true, tooltip: 'Editor: cuộn thanh để xem các item phía sau (0 = đầu thanh như lúc vào game)' })
    previewScroll = 0;

    @property({ group: 'Editor Preview', step: 1, tooltip: 'Editor: coi như đã gom xong N item đầu → các ô dồn lên + label "N / tổng" như lúc chơi' })
    previewCollected = 0;

    /** Luôn trả false để nút sinh preview có thể được bấm lại trong Inspector. */
    @property({ group: 'Editor Preview', displayName: '▶ Preview items', tooltip: 'Sinh lại item xem trước theo LevelConfig của map, đo lại icon (chỉ để xem, không lưu vào scene). Lưu scale icon / thứ tự bằng Tool → Map Creator → Build items' })
    get previewItems() { return false; }
    /** Chỉ sinh lại item preview khi bật nút trong editor. */
    set previewItems(v: boolean) { if (v && EDITOR) this.host()?.buildPreview(); }

    /** Luôn trả false để thao tác xoá preview là nút bấm, không lưu trạng thái bật. */
    @property({ group: 'Editor Preview', displayName: '✖ Clear preview', tooltip: 'Xoá item xem trước trong thanh (frame sau tự sinh lại theo LevelConfig)' })
    get clearPreview() { return false; }
    /** Chỉ xoá nội dung thanh khi bật nút trong editor. */
    set clearPreview(v: boolean) { if (v && EDITOR) this.host()?.clearContent(); }

    /** Luôn trả false để nút xáo thứ tự sẵn sàng cho lần bấm tiếp theo. */
    @property({ group: 'Editor Preview', displayName: '🔀 Shuffle items', tooltip: 'Xáo ngẫu nhiên thứ tự ô. Editor: xáo LevelConfig.items trên instance — lưu vào prefab Level bằng Map Creator → Build items' })
    get shuffleItems() { return false; }
    /** Xáo preview trong editor hoặc các item chưa hoàn thành khi đang chơi. */
    set shuffleItems(v: boolean) { if (v) { const h = this.host(); EDITOR ? h?.shufflePreview() : h?.shuffle(); } }

    /** Luôn trả false vì áp thứ tự là thao tác tức thời trong Inspector. */
    @property({ group: 'Editor Preview', displayName: '↕ Apply order', tooltip: 'Xếp lại item xem trước theo thứ tự ô trong LevelConfig' })
    get applyOrder() { return false; }
    /** Chỉ xếp lại preview theo Hierarchy khi bật nút trong editor. */
    set applyOrder(v: boolean) { if (v && EDITOR) this.host()?.applyOrderPreview(); }

    /** Tìm ItemManager cùng node qua tên lớp để tránh vòng import giữa hai component. */
    private host(): TrayHost | null {
        return this.getComponent('ItemManager') as unknown as TrayHost | null;
    }
}
