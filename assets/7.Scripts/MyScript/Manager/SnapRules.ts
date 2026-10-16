import { _decorator, Component } from 'cc';
const { ccclass, property, disallowMultiple } = _decorator;

/**
 * SnapRules — luật "thả đúng chỗ" + hiệu ứng target khi thả đúng (đặt cùng node với ItemManager).
 * Ghost (item đang kéo) là bản sao đúng mesh/scale/góc của target → thả CHỒNG KHÍT target là đúng nhất.
 */
@ccclass('SnapRules')
@disallowMultiple
export class SnapRules extends Component {
    @property({ serializable: false, displayName: '⚙ Hiện thông số nâng cao', tooltip: 'Hiện thêm các luật / thời gian animation ít khi phải chỉnh' })
    showAdvanced = false;

    @property({ tooltip: 'Độ lệch cho phép giữa ghost và target để tính là thả đúng (px quy về màn rộng 393pt, như iPhone 14 Pro). Lớn hơn = dễ thả hơn. Gizmo đỏ "Snap radius" của EditorPreview vẽ vùng này' })
    snapPx = 40;

    @property({ tooltip: 'Target phóng to tối đa bao nhiêu lần khi thả đúng (1 = không nảy, 1.3 = to thêm 30% rồi thu về)' })
    snapScale = 1.3;

    @property({ visible(this: SnapRules) { return this.showAdvanced; }, tooltip: 'BẬT: cộng thêm nửa cạnh nhỏ của bbox target vào ngưỡng → đồ to dễ thả hơn đồ nhỏ' })
    snapByBounds = true;

    @property({ visible(this: SnapRules) { return this.showAdvanced; }, tooltip: 'BẬT: target của item phải là target GẦN NHẤT dưới ngón tay; thả lên vật khác = trượt dù vẫn trong ngưỡng. (Map có pivot trùng nhau thì luật này không phân biệt được)' })
    requireNearest = true;

    @property({ visible(this: SnapRules) { return this.showAdvanced; }, tooltip: 'Thời gian target phóng to khi thả đúng (giây)' })
    snapScaleUpDuration = 0.12;

    @property({ visible(this: SnapRules) { return this.showAdvanced; }, tooltip: 'Thời gian target thu về scale gốc (giây)' })
    snapScaleDownDuration = 0.18;
}
